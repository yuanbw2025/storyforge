import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityModelV1 } from '../helpers/open-entity-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenEntityInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { dispatchTtrpgOpenModelCallV1, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { createContextAccessPolicyForExecutionV1 } from '../../src/lib/context-gateway/skill-policy'
import { readTtrpgOpenTableV1, readTtrpgOpenTableContextTraceV1 } from '../../src/lib/ttrpg/open-table-service'

async function prepare(s: Awaited<ReturnType<typeof setupOpenEntityModelV1>>, commandId = 'entity.model.prepare') {
  return prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, commandId), scope: s.f.scope, viewerKey: s.viewerKey,
    selection: s.selection, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
}
describe('R-TTRPGOPEN12 exact model entity input and original window', { timeout: 90000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('freezes only the chosen original Oracle, scope, template and placement under a closed read-only Skill', async () => {
    const s = await setupOpenEntityModelV1(), before = await readProductRuntimeState(s.f.sessionId)
    const prepared = await prepare(s), run = await readInstanceAgentRunV1(s.f.scope, prepared.runId)
    expect(run.contract.permissions).toEqual({ contextSourceKeys: ['ttrpgOpenEntityInput'], writeTargets: [] })
    expect(run.contract.executionBindings![0]).toMatchObject({ skillId: 'prose.ttrpg-open-entity-propose', formalEntry: { entryId: 'ttrpg.open.entity-propose' } })
    expect(prepared.evidence.selector.selected).toHaveLength(4)
    expect(prepared.evidence.selector.selected.every(r => r.sourceKey === 'ttrpgOpenEntityInput' && r.depth === 'full')).toBe(true)
    const wire = JSON.stringify(prepared.messages)
    expect(wire).not.toContain('ENTITY-MODEL-'); expect(wire).not.toContain('seedCommitment'); expect(wire).not.toContain('明确咨询并审查可实例化对象')
    expect(wire).not.toContain('dynamic.item'); expect(wire).toContain('dynamic.npc')
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.entityOperations).toEqual(before.ttrpg!.openRun!.entityOperations)
    expect(after.ttrpg!.openRun!.coordination.epochs[0].inputRevision).toBe(before.ttrpg!.openRun!.coordination.epochs[0].inputRevision)
    expect(after.ttrpg!.openRun!.coordination.calls[0].entityProposal).toEqual(s.selection)
    expect(createContextAccessPolicyForExecutionV1(getAgentSkillV1('prose.ttrpg-open-entity-propose')).allowedSourceKeys).toEqual(['ttrpgOpenEntityInput'])
    const first = await dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.model.send'), viewerKey: s.viewerKey, requestKey: prepared.requestKey, runId: prepared.runId })
    expect(first.sendAuthorized).toBe(true)
    expect((await dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.model.send'), viewerKey: s.viewerKey, requestKey: prepared.requestKey, runId: prepared.runId })).sendAuthorized).toBe(false)
  })
  it('rejects a private template, forged scope, unknown placement and original-input substitution before creating a Run', async () => {
    const s = await setupOpenEntityModelV1(), selection = structuredClone(s.selection)
    for (const mutation of [
      { templateKeys: ['private.hero.template'] }, { placementRefs: ['hidden.location'] },
      { epochInputRevision: 'a'.repeat(64) }, { scope: { ...selection.scope, recipientActorKeys: ['hero'] } },
      { oracleSourceRef: { ...selection.oracleSourceRef, sequence: 1 } },
    ]) {
      s.selection = { ...selection, ...mutation }
      await expect(prepare(s)).rejects.toThrow(/范围|授权|窗口|咨询/)
      expect(await db.agentRuns.count()).toBe(0)
    }
  })
  it('reads a private proposal partition without copying other private or GM templates into messages', async () => {
    const s = await setupOpenEntityModelV1('private'), prepared = await prepare(s), wire = JSON.stringify(prepared.messages)
    expect(wire).toContain('ENTITY-MODEL-PRIVATE-TEMPLATE-CANARY')
    expect(wire).not.toContain('ENTITY-MODEL-GM-TEMPLATE-CANARY'); expect(wire).not.toContain('ENTITY-MODEL-NPC-SECRET-CANARY')
    expect(wire).not.toContain('ENTITY-MODEL-FRONT-SECRET-CANARY')
    expect(prepared.reservation.entityProposal!.scope.recipientActorKeys).toEqual(['hero'])
  })
  it('rejects pending competing requests and pause before any additional Run or send', async () => {
    const s = await setupOpenEntityModelV1(), prepared = await prepare(s), count = await db.agentRuns.count()
    await expect(prepare(s, 'entity.model.competing')).rejects.toThrow(/预算|回执/)
    expect(await db.agentRuns.count()).toBe(count)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'entity.model.pause'), viewerKey: s.viewerKey, changedBy: 'hero', status: 'paused', reason: '先暂停' })
    await expect(dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.model.send.paused'), viewerKey: s.viewerKey, requestKey: prepared.requestKey, runId: prepared.runId })).rejects.toThrow()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
  it('keeps the existing action desk readable without relabeling a private entity request or using the old context inspector', async () => {
    const s = await setupOpenEntityModelV1('private'), prepared = await prepare(s), before = await readProductRuntimeState(s.f.sessionId)
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey }, view = await readTtrpgOpenTableV1(input)
    expect(view.player!.candidates).toEqual([]);expect(view.player!.requests).toEqual([])
    expect(JSON.stringify(view)).not.toContain('ENTITY-MODEL-PRIVATE-TEMPLATE-CANARY')
    await expect(readTtrpgOpenTableContextTraceV1(input)).rejects.toThrow(/实体候选/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    expect(before.ttrpg!.openRun!.coordination.calls[0].requestKey).toBe(prepared.requestKey)
  })
})
