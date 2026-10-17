import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { createTtrpgOpenPublicSituationAuthorizationV1 } from '../../src/lib/ttrpg/open-public-situation-authorization'
import { prepareTtrpgOpenPublicSituationInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { verifyTtrpgOpenModelCallEvidenceV1 } from '../../src/lib/ttrpg/open-model-call-evidence'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import * as skills from '../../src/lib/agent/skill-registry'

async function setup(configure?: Parameters<typeof readyOpenTtrpgSessionV1>[1]) {
  const f = await readyOpenTtrpgSessionV1('Public original input', p => {
    const c = p.ttrpg!.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
    c.characterTemplates.find(actor => actor.role === 'npc')!.gmProfile!.secret = 'PRIVATE-GM-PREPARED-PACKET'
    c.characterTemplates.find(actor => actor.characterKey === 'hero')!.playerProfile!.secret = 'PRIVATE-PLAYER-PREPARED-PACKET'
    c.situationTemplates[0].evidence[0].description = 'PRIVATE-UNDISCOVERED-PREPARED-PACKET'
    c.fronts[0].goal = 'PRIVATE-FRONT-PREPARED-PACKET'
    configure?.(p)
  })
  const rawInput = '  按共同资料拟定新局势 e\u0301。\n'
  const authorized = await createTtrpgOpenPublicSituationAuthorizationV1({ ...await openEnvelopeV1(f.sessionId, 'public.input.authorize'),
    scope: f.scope, viewerKey: OPEN_HUMAN_VIEWER, rawInput, sharingDecision: 'share-this-request-with-current-party',
    delegationDecision: 'draft-only', modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 4000, maximumCostUsd: 0.1 })
  return { f, rawInput, authorized, read: { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
    runId: authorized.runId, requestKey: authorized.requestKey } }
}
describe('R-TTRPGOPEN10 complete shared input in the same original Run', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('freezes the actual registered shared-input body, full Manifest and one reservation without creating a second Run or sending', async () => {
    const { f, rawInput, authorized, read } = await setup(), prepared = await prepareTtrpgOpenPublicSituationInputV1(read)
    expect(prepared.runId).toBe(authorized.runId); expect(await db.agentRuns.count()).toBe(1)
    expect(prepared.evidence.manifest.sources.map(source => source.key)).toEqual(['ttrpgOpenPublicSituationInput'])
    expect(prepared.evidence.selector.selected.some(row => row.resourceKey.endsWith(':public-situation-shared-input'))).toBe(true)
    const source = prepared.evidence.preflight.artifacts.find(ref => ref.role === 'source-snapshot' && ref.resourceKey?.endsWith(':public-situation-shared-input'))!
    const wrapper = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'source-snapshot', contentHash: source.contentHash }))
    expect(JSON.parse(wrapper.content).text).toBe(rawInput)
    expect(prepared.messages).toHaveLength(2); expect(prepared.messages[1].content).toMatch(/^【共同局势授权上下文】/)
    expect(prepared.messages[1].content).not.toMatch(/【真人输入】/)
    expect(JSON.stringify(prepared.messages)).not.toContain('PRIVATE-')
    const state = await readProductRuntimeState(f.sessionId), call = state.ttrpg!.openRun!.coordination.calls[0]
    expect(call).toMatchObject({ requestKey: authorized.requestKey, status: 'prepared', dispatchRef: null, reservedOutputTokens: 4000 })
    await verifyTtrpgOpenModelCallEvidenceV1({ ...read, call, mode: 'dispatch' })
    const beforeEvents = await db.agentRunEvents.count(), again = await prepareTtrpgOpenPublicSituationInputV1(read)
    expect(again.requestKey).toBe(prepared.requestKey); expect(again.evidence).toEqual(prepared.evidence)
    expect(await db.agentRuns.count()).toBe(1); expect(await db.agentRunEvents.count()).toBe(beforeEvents)
  })
  it('repairs a cut after full model.requested evidence but before reservation by reusing original bytes and the same once-only identity', async () => {
    const { f, authorized, read } = await setup(), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    vi.spyOn(db.productRuntimeEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'ttrpg.open.call.reserved') throw new Error('reservation commit interrupted')
      return add(...args)
    })
    await expect(prepareTtrpgOpenPublicSituationInputV1(read)).rejects.toThrow(/reservation commit interrupted/)
    vi.restoreAllMocks()
    const original = await readInstanceAgentRunV1(f.scope, authorized.runId)
    expect(original.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls).toEqual([])
    const repaired = await prepareTtrpgOpenPublicSituationInputV1(read), after = await readInstanceAgentRunV1(f.scope, authorized.runId)
    expect(repaired.runId).toBe(authorized.runId); expect(repaired.requestKey).toBe(authorized.requestKey)
    expect(after.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(await db.agentRuns.count()).toBe(1)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls).toHaveLength(1)
  })
  it('rejects another requester and a real safety pause without new inputs, calls or replacement Runs', async () => {
    const { f, read } = await setup()
    await expect(prepareTtrpgOpenPublicSituationInputV1({ ...read, viewerKey: 'viewer.seat.companion.1' })).rejects.toThrow()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.sessionId, 'public.input.pause'), viewerKey: OPEN_HUMAN_VIEWER,
      changedBy: 'hero', status: 'paused', reason: '暂停本次准备' })
    await expect(prepareTtrpgOpenPublicSituationInputV1(read)).rejects.toThrow(/安全授权已变化/)
    expect(await db.agentRuns.count()).toBe(1)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls).toEqual([])
  })
  it('uses the original frozen Skill when the current registry changes before input preparation', async () => {
    const { read } = await setup(), lookup = skills.getAgentSkillV1
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
      if (id === 'prose.ttrpg-open-public-situation-propose') throw new Error('current public Skill must not replace frozen binding')
      return lookup(id)
    })
    const prepared = await prepareTtrpgOpenPublicSituationInputV1(read)
    expect(prepared.evidence.manifest.sources.map(source => source.key)).toEqual(['ttrpgOpenPublicSituationInput'])
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('refuses a deterministically impossible public draft before model binding or reservation instead of using a hidden clock', async () => {
    const { read } = await setup(pkg => { pkg.ttrpg!.campaign.clocks[0].visibility = 'gm-only' })
    await expect(prepareTtrpgOpenPublicSituationInputV1(read)).rejects.toThrow(/共同资料不足|未调用模型/)
    const run = await readInstanceAgentRunV1(read.scope, read.runId)
    expect(run.events.filter(row => row.type === 'model.requested')).toEqual([])
    expect((await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!.coordination.calls).toEqual([])
    expect(await db.agentRuns.count()).toBe(1)
  })
})
