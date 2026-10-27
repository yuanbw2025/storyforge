import { beforeEach,afterEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { rt,operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { delegateTtrpgOpenHostingV1,stopTtrpgOpenHostingV1,acceptTtrpgOpenDelegatedKpNarrationV1,acceptTtrpgOpenKpNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenKpCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { reconcileTtrpgOpenKpRunV1 } from '../../src/lib/ttrpg/open-kp-adoption'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
const raw = JSON.stringify({ paragraphs: [{ text: '你们确认了眼前行动的结果，新的线索仍需亲自调查。',sourceKeys: ['action.receipt'] }] })

describe('R-TTRPGOPEN3 delegated KP adoption authority', { timeout: 60000 },() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  async function setup(bound = true) {
    const f = await setupChecksFixtureV1({ ai: true });await resumeTtrpgOpenChecksV1(f.command)
    const epoch = rt(await readProductRuntimeState(f.command.sessionId)).openRun!.coordination.epochs[0]
    await delegateTtrpgOpenHostingV1({ ...await openEnvelopeV1(f.command.sessionId,'delegated-kp.grant'),viewerKey: f.command.viewerKey,
      epochKey: epoch.epochKey,maximumCostUsdPerCall: 0.1,decision: 'delegate-this-epoch' })
    const permission = rt(await readProductRuntimeState(f.command.sessionId)).openRun!.coordination.epochs[0].hostingDelegation!
    const generated = await generateTtrpgOpenKpCandidateV1({ ...await openEnvelopeV1(f.command.sessionId,'delegated-kp.prepare'),scope: f.f.scope,
      viewerKey: f.command.viewerKey,rawInput: '按真实已结算结果叙述',maximumOutputTokens: 800,maximumCostUsd: 0.1,
      ...(bound ? { hostingDelegationRef: permission.sourceRef } : {}),runAI: async () => raw })
    const input = async () => ({ ...await operationInput(f.command.sessionId,f.command.operationKey,'narration'),runId: generated.prepared.runId,
      requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash,hostingDelegationRef: permission.sourceRef })
    const stop = async () => stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(f.command.sessionId,'delegated-kp.stop'),viewerKey: f.command.viewerKey,epochKey: epoch.epochKey,reason: '停止本轮自动采用' })
    return { f,permission,generated,input,stop }
  }
  it('adopts exact party narration under real prior authority, without fabricating individual human confirmation',async () => {
    const x = await setup(),before = await readProductRuntimeState(x.f.command.sessionId),command = await x.input()
    await expect(acceptTtrpgOpenDelegatedKpNarrationV1({ ...command,hostingDelegationRef: { ...x.permission.sourceRef,sequence: x.permission.sourceRef.sequence + 1 } })).rejects.toThrow(/来源|过期/)
    expect(await readProductRuntimeState(x.f.command.sessionId)).toEqual(before)
    const event = await acceptTtrpgOpenDelegatedKpNarrationV1(command)
    expect(await acceptTtrpgOpenDelegatedKpNarrationV1(await x.input())).toEqual(event)
    const after = await readProductRuntimeState(x.f.command.sessionId),run = rt(after).openRun!
    expect(run.narrations![0]).toMatchObject({ hostingDelegationRef: x.permission.sourceRef,narration: JSON.parse(raw) })
    expect(after.entities).toEqual(before.entities);expect(run.worldTime).toEqual(rt(before).openRun!.worldTime);expect(run.factLedger).toEqual(rt(before).openRun!.factLedger)
    expect(run.knowledge).toEqual(rt(before).openRun!.knowledge)
    const snapshot = await readInstanceAgentRunV1(x.f.f.scope,x.generated.prepared.runId)
    expect(snapshot.projection.state).toBe('completed')
    const confirmation = snapshot.events.find(e => e.type === 'confirmation.recorded')!
    expect(confirmation.payload).not.toHaveProperty('reviewItemId');expect(confirmation.payload).not.toHaveProperty('reviewDecision');expect(confirmation.payload).not.toHaveProperty('note')
    expect(snapshot.events.filter(e => e.type === 'runtime.candidate.adopted')).toHaveLength(1)
    const verification = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot')
    let found = false
    for (const e of verification) if (e.type === 'evidence.artifact.recorded') {
      const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: x.f.f.scope.projectId,artifactKind: 'source-snapshot',contentHash: e.payload.contentHash }))
      if (body.schema === 'storyforge.ttrpg-kp-verification') {
        expect(body.decisionAuthority).toEqual({ kind: 'runtime-delegation',sourceRef: x.permission.sourceRef })
        found = body.receipt.criteria.some((c: { id: string }) => c.id === 'kp.delegation')
      }
    }
    expect(found).toBe(true)
    const row = (await db.productRuntimeSessions.get(x.f.command.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.command.sessionId).sortBy('sequence'))).toEqual(after)
    const payload = JSON.parse(event.payloadJson);delete payload.intent.hostingDelegationRef
    expect(() => replayProductRuntimeEvents(before,[{ ...event,payloadJson: JSON.stringify(payload) }])).toThrow()
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.f.scope.projectId)),copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    expect(rt(await readProductRuntimeState(copy.id!)).openRun!.narrations![0]).toEqual(run.narrations![0])
    await x.stop()
    expect(await reconcileTtrpgOpenKpRunV1({ scope: x.f.f.scope,...command })).toBe(snapshot.projection.terminalReceiptHash)
  })
  it('rejects revoked automatic adoption but permits a fresh explicit human review of the retained candidate',async () => {
    const x = await setup();await x.stop()
    const before = await readProductRuntimeState(x.f.command.sessionId)
    await expect(acceptTtrpgOpenDelegatedKpNarrationV1(await x.input())).rejects.toThrow(/停止|过期/)
    expect(await readProductRuntimeState(x.f.command.sessionId)).toEqual(before)
    const { hostingDelegationRef: _ref,...human } = await x.input()
    await acceptTtrpgOpenKpNarrationV1(human)
    expect(rt(await readProductRuntimeState(x.f.command.sessionId)).openRun!.narrations![0]).not.toHaveProperty('hostingDelegationRef')
  })
  it('cannot borrow a regular request and preserves explicit human admission',async () => {
    const x = await setup(false),before = await readProductRuntimeState(x.f.command.sessionId)
    await expect(acceptTtrpgOpenDelegatedKpNarrationV1(await x.input())).rejects.toThrow(/缺少同窗口/)
    expect(await readProductRuntimeState(x.f.command.sessionId)).toEqual(before)
    const { hostingDelegationRef: _ref,...human } = await x.input()
    await acceptTtrpgOpenKpNarrationV1(human)
    expect(rt(await readProductRuntimeState(x.f.command.sessionId)).openRun!.narrations![0]).not.toHaveProperty('hostingDelegationRef')
  })
})
