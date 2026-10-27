import * as commands from '../../src/lib/ttrpg/runtime-commands'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../src/lib/types'
import type { ChatResult } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { operationInput, rt } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { generateTtrpgOpenKpCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { prepareTtrpgOpenKpInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { recordTtrpgOpenHumanNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readTtrpgOpenTableV1, repairTtrpgOpenTableHumanNarrationV1 } from '../../src/lib/ttrpg/open-table-service'
import { readTtrpgOpenImportedCallOwnerV1 } from '../../src/lib/ttrpg/open-run-portability'
import { readTtrpgOpenHistoricalResponseV1 } from '../../src/lib/ttrpg/open-imported-response'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import * as artifacts from '../../src/lib/memory/artifact-store'
const text = '我复核了当前结算，明确以真人身份补写调查结果。'
const output = JSON.stringify({ paragraphs: [{ text: '调查留下了可核对的结果。', sourceKeys: ['action.receipt'] }] })
async function copy(projectId: number) {
  const id = await importProjectJSON(await exportProjectJSON(projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(id).toArray())[0]
  const scope = await resolveScope({ scope: { projectId: id, worldId: session.worldId!, workId: session.workId! } })
  return { scope, sessionId: session.id!, viewerKey: OPEN_HUMAN_VIEWER }
}
async function setup(mode: 'candidate' | 'persisted-candidate' | 'saved-response' | 'unknown' | 'prepared' = 'candidate', competing = false) {
  const f = await setupChecksFixtureV1({ ai: true });await resumeTtrpgOpenPlayV1(f.command)
  const input = { ...await openEnvelopeV1(f.command.sessionId, 'import.kp'), scope: f.f.scope, viewerKey: f.command.viewerKey,
    rawInput: '只依据实际共同结算', maximumOutputTokens: 800, maximumCostUsd: 0.1 }
  let sends = 0
  const runAI = async (_messages: ChatMessage[], _signal: AbortSignal, result: ChatResult) => {
    sends++;if (mode === 'unknown') throw new Error('simulated unknown transport')
    result.usage = { inputTokens: 2200, outputTokens: 60, totalTokens: 2260 };return output
  }
  const record = artifacts.recordAgentRunArtifactV1
  if (mode === 'saved-response') vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async args => {
    if (args.artifactKind === 'source-snapshot' && args.content.includes('storyforge.ttrpg-open-kp-candidate')) throw new Error('saved response interrupted')
    return record(args)
  })
  if (mode === 'persisted-candidate') vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockRejectedValueOnce(new Error('candidate checkpoint interrupted'))
  let release: (() => void) | undefined, rejected: Promise<void> | undefined
  if (competing) {
    const actualReserve = commands.reserveTtrpgOpenModelCallV1
    let entered!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(commands, 'reserveTtrpgOpenModelCallV1').mockImplementationOnce(async args => { entered();await gate;return actualReserve(args) })
    const first = prepareTtrpgOpenKpInputV1({ ...input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    rejected = expect(first).rejects.toThrow()
    await waiting
  }
  if (mode === 'prepared') await prepareTtrpgOpenKpInputV1({ ...input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
  else if (mode === 'candidate') await generateTtrpgOpenKpCandidateV1({ ...input, runAI })
  else await expect(generateTtrpgOpenKpCandidateV1({ ...input, runAI })).rejects.toThrow(mode === 'unknown' ? 'unknown transport' : mode === 'persisted-candidate' ? 'checkpoint interrupted' : 'saved response interrupted')
  release?.();await rejected
  vi.restoreAllMocks()
  const original = await readProductRuntimeState(f.command.sessionId), current = await copy(f.f.scope.projectId)
  const requestKey = rt(original).openRun!.coordination.calls.find(c => c.skillId === 'prose.ttrpg-open-kp')!.requestKey
  const owner = (await readTtrpgOpenImportedCallOwnerV1({ ...current, requestKey }))!
  return { f, original, current, requestKey, owner, sends, operationKey: f.command.operationKey,
    command: async () => ({ ...await operationInput(current.sessionId, f.command.operationKey, 'narration'), text, reason: 'replace-candidate' as const }) }
}
async function replay(sessionId: number) {
  const session = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGIMPORT3 human narration replaces only its exact imported KP owner', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => { vi.restoreAllMocks();db.close() })
  it.each(['candidate','persisted-candidate','saved-response','unknown'] as const)('closes %s without resending, rebilling or adopting historical output', async mode => {
    const x = await setup(mode), before = await readProductRuntimeState(x.current.sessionId), originalProof = x.owner.origin
    const command = await x.command(), event = await recordTtrpgOpenHumanNarrationV1(command)
    expect(await recordTtrpgOpenHumanNarrationV1(command)).toEqual(event)
    const after = await readProductRuntimeState(x.current.sessionId), run = rt(after).openRun!
    expect(run.narrations).toHaveLength(1);expect(run.narrations![0]).toMatchObject({ sourceKind: 'human', narration: { paragraphs: [{ text }] } })
    expect(run.coordination).toEqual(rt(before).openRun!.coordination);expect(after.entities).toEqual(before.entities)
    expect(run.knowledge).toEqual(rt(before).openRun!.knowledge);expect(run.factLedger).toEqual(rt(before).openRun!.factLedger);expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    const stopped = await readInstanceAgentRunV1(x.current.scope, x.owner.runId)
    expect(stopped.projection.state).toBe(mode === 'candidate' ? 'cancelled' : 'failed')
    if (mode === 'persisted-candidate') expect(stopped.projection.steps['ttrpg.open.kp'].confirmation).toBe('reject')
    expect(stopped.events.filter(e => e.type === 'confirmation.recorded').every(e => e.type === 'confirmation.recorded' && e.payload.decision !== 'adopt')).toBe(true)
    expect((await readTtrpgOpenTableV1(x.current)).player!.humanNarrationRepairs).toEqual([])
    expect((await readTtrpgOpenImportedCallOwnerV1({ ...x.current, requestKey: x.requestKey }))!.origin).toEqual(originalProof)
    if (mode !== 'unknown') expect(await readTtrpgOpenHistoricalResponseV1({ ...x.current, requestKey: x.requestKey, runId: x.owner.runId })).toMatchObject({ text: output, executable: false })
    expect((await resumeTtrpgOpenPlayV1({ ...await operationInput(x.current.sessionId,x.operationKey,'narration') })).status).toBe('completed')
    expect(await readProductRuntimeState(x.f.command.sessionId)).toEqual(x.original)
    expect(x.sends).toBe(1);await replay(x.current.sessionId)
  })
  it('restores an interrupted stop after another full backup/import, visible on the real player desk and idempotent', async () => {
    const x = await setup('persisted-candidate'), record = artifacts.recordAgentRunArtifactV1
    vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async args => {
      const result = await record(args)
      if (args.content.includes('storyforge.ttrpg-human-narration-replacement')) throw new Error('closed after replacement artifact')
      return result
    })
    await expect(recordTtrpgOpenHumanNarrationV1(await x.command())).rejects.toThrow(/人工叙述已保存/)
    vi.restoreAllMocks()
    expect((await readTtrpgOpenTableV1(x.current)).player!.humanNarrationRepairs).toEqual([x.operationKey])
    const next = await copy(x.current.scope.projectId), before = await readProductRuntimeState(next.sessionId)
    expect((await readTtrpgOpenTableV1(next)).player!.humanNarrationRepairs).toEqual([x.operationKey])
    await repairTtrpgOpenTableHumanNarrationV1({ ...next, operationKey: x.operationKey })
    const rows = await db.agentRunEvents.toArray()
    await repairTtrpgOpenTableHumanNarrationV1({ ...next, operationKey: x.operationKey })
    expect(await db.agentRunEvents.toArray()).toEqual(rows);expect(await readProductRuntimeState(next.sessionId)).toEqual(before)
    expect((await readTtrpgOpenTableV1(next)).player!.humanNarrationRepairs).toEqual([])
    const owner = (await readTtrpgOpenImportedCallOwnerV1({ ...next, requestKey: x.requestKey }))!
    expect(owner.origin).toEqual(x.owner.origin);expect((await readInstanceAgentRunV1(next.scope, owner.runId)).projection.state).toBe('failed')
    expect(await readProductRuntimeState(x.f.command.sessionId)).toEqual(x.original);await replay(next.sessionId)
  })
  it('stops the actual winning KP Run after a same-contract earlier preparation failed, in source and imported scopes', async () => {
    const x = await setup('persisted-candidate', true), rows = await db.agentRuns.where('productRuntimeSessionId').equals(x.f.command.sessionId).sortBy('id')
    expect(rows).toHaveLength(2);expect(rows[0].status).toBe('failed');expect(rows[0].contractHash).toBe(rows[1].contractHash)
    const loserEvents = await db.agentRunEvents.where('runId').equals(rows[0].id!).toArray()
    await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(x.f.command.sessionId,x.operationKey,'narration'),text,reason:'replace-candidate' })
    expect((await readInstanceAgentRunV1(x.f.f.scope,rows[1].id!)).projection.state).toBe('failed')
    expect(await db.agentRunEvents.where('runId').equals(rows[0].id!).toArray()).toEqual(loserEvents)
    await recordTtrpgOpenHumanNarrationV1(await x.command())
    expect((await readInstanceAgentRunV1(x.current.scope,x.owner.runId)).projection.state).toBe('failed')
    expect((await readTtrpgOpenTableV1(x.current)).player!.humanNarrationRepairs).toEqual([])
  })
  it.each(['wrong-viewer','changed-human-event'] as const)('cannot finish a pending original stop with %s', async mode => {
    const x = await setup('persisted-candidate')
    vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockRejectedValueOnce(new Error('pending stop'))
    await expect(recordTtrpgOpenHumanNarrationV1(await x.command())).rejects.toThrow(/人工叙述已保存/)
    vi.restoreAllMocks()
    const before = await db.agentRunEvents.toArray()
    if (mode === 'changed-human-event') {
      const ref = rt(await readProductRuntimeState(x.current.sessionId)).openRun!.narrations![0].sourceRef
      const event = (await db.productRuntimeEvents.where('[sessionId+sequence]').equals([x.current.sessionId,ref.sequence]).first())!
      const payload = JSON.parse(event.payloadJson);payload.receipt.narration.paragraphs[0].text = 'changed after receipt'
      await db.productRuntimeEvents.update(event.id!,{payloadJson:JSON.stringify(payload)})
    }
    await expect(repairTtrpgOpenTableHumanNarrationV1({ ...x.current,operationKey:x.operationKey,
      ...(mode === 'wrong-viewer' ? {viewerKey:'viewer.other'} : {}) })).rejects.toThrow()
    expect(await db.agentRunEvents.toArray()).toEqual(before)
    expect((await readInstanceAgentRunV1(x.current.scope,x.owner.runId)).projection.state).not.toBe('failed')
  })
  it('keeps an imported unsent KP request pending and refuses manual replacement before explicit cancellation', async () => {
    const x = await setup('prepared'), before = await readProductRuntimeState(x.current.sessionId)
    await expect(recordTtrpgOpenHumanNarrationV1(await x.command())).rejects.toThrow(/原请求/)
    expect(await readProductRuntimeState(x.current.sessionId)).toEqual(before);expect(x.sends).toBe(0)
  })
  it('preserves saved human prose and visible pending repair when original raw evidence is missing', async () => {
    const x = await setup('persisted-candidate'), row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([x.current.scope.projectId,'raw-response',rt(x.original).openRun!.coordination.calls.find(c => c.requestKey === x.requestKey)!.responseArtifactHash!]).first()
    await db.agentRunArtifacts.delete(row!.id!)
    await expect(recordTtrpgOpenHumanNarrationV1(await x.command())).rejects.toThrow(/人工叙述已保存/)
    const before = await readProductRuntimeState(x.current.sessionId), view = await readTtrpgOpenTableV1(x.current)
    expect(view.player!.humanNarrationRepairs).toEqual([x.operationKey]);expect(view.player!.narrations[0].paragraphs).toEqual([text])
    await expect(repairTtrpgOpenTableHumanNarrationV1({ ...x.current, operationKey: x.operationKey })).rejects.toThrow()
    expect(await readProductRuntimeState(x.current.sessionId)).toEqual(before)
    expect((await readInstanceAgentRunV1(x.current.scope,x.owner.runId)).projection.state).not.toBe('failed')
  })
})
