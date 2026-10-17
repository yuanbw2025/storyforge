import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { setupOpenEntityModelV1 } from '../helpers/open-entity-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { loadTtrpgOpenEntityContextV1 } from '../../src/lib/ttrpg/open-entity-context'
import { prepareTtrpgOpenEntityInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenEntityRequestV1, recoverTtrpgOpenRuntimeCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import type { TtrpgOpenEntityModelSelectionV1 } from '../../src/lib/ttrpg/open-entity-model-contract'
import { readProductRuntimeState, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'

describe('R-TTRPGOPEN12 entity request privacy scopes and independent explicit attempts', { timeout: 90000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('keeps a public request limited to its selected public resources even when the host has private alternatives', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => {
      const c = pkg.ttrpg!.campaign; c.runtimePolicy.enabled = true; pkg.ttrpg!.rulePack.content.oracles[0].audience = 'public'
      c.dynamicEntityTemplates[0].audience = 'public'; c.dynamicEntityTemplates[0].description = 'PUBLIC-ENTITY-TEMPLATE'
      c.dynamicEntityTemplates[1].audience = 'private'; c.dynamicEntityTemplates[1].knownByActorKeys = ['hero']; c.dynamicEntityTemplates[1].description = 'PRIVATE-ENTITY-CANARY'
    })
    const context = await loadTtrpgOpenEntityContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'gm' })
    const partition = context.directory.find(d => d.scope.audience === 'public')!
    const selection: TtrpgOpenEntityModelSelectionV1 = { schema: 'storyforge.ttrpg-open-entity-model-selection', version: 1,
      oracleSourceRef: partition.sourceRef, scope: partition.scope, epochInputRevision: context.epochInputRevision,
      templateKeys: ['dynamic.npc'], placementRefs: ['harbor'] }
    const prepared = await prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.scope.public'), scope: s.f.scope,
      viewerKey: s.input.viewerKey, selection, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
    expect(JSON.stringify(prepared.messages)).toContain('PUBLIC-ENTITY-TEMPLATE')
    expect(JSON.stringify(prepared.messages)).not.toContain('PRIVATE-ENTITY-CANARY')
    expect(JSON.stringify(prepared.messages)).not.toContain('inventory-owner')
    expect(prepared.reservation.entityProposal!.scope).toEqual({ ...partition.scope, audience: 'public', recipientActorKeys: [] })
  })
  it('keeps a GM-only original result and candidate in its exact partition without loading an NPC private profile', async () => {
    const s = await setupOpenEntityModelV1('gm-only')
    const prepared = await prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.scope.gm'), scope: s.f.scope,
      viewerKey: s.viewerKey, selection: s.selection, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
    const wire = JSON.stringify(prepared.messages)
    expect(wire).toContain('ENTITY-MODEL-GM-TEMPLATE-CANARY'); expect(wire).not.toContain('ENTITY-MODEL-NPC-SECRET-CANARY')
    const read = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey, runId: prepared.runId, requestKey: prepared.requestKey }
    const result = await executeTtrpgOpenEntityRequestV1({ ...read, runAI: async () => JSON.stringify({ proposals: [s.proposal] }) })
    expect(result.status === 'candidate' && result.candidate.selection.scope.audience).toBe('gm-only')
    expect(result.status === 'candidate' && result.candidate.artifact.status).toBe('usable-with-warnings')
    await expect(recoverTtrpgOpenRuntimeCandidateV1({ ...read, viewerKey: 'viewer.seat.hero' })).rejects.toThrow()
  })
  it('allows a separately explicit bounded attempt after unusable output without auto-retry or resetting Oracle quota', async () => {
    const s = await setupOpenEntityModelV1(); let sends = 0
    const prepare = async (commandId: string) => prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, commandId),
      scope: s.f.scope, viewerKey: s.viewerKey, selection: s.selection, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.05 })
    const first = await prepare('entity.scope.first'), read = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey, runId: first.runId, requestKey: first.requestKey }
    const a = await executeTtrpgOpenEntityRequestV1({ ...read, runAI: async () => { sends++; return '{"bad":true}' } })
    expect(a.status === 'candidate' && a.candidate.artifact.status).toBe('blocked'); expect(sends).toBe(1)
    const second = await prepare('entity.scope.explicit.second')
    expect(second.runId).not.toBe(first.runId); expect(second.requestKey).not.toBe(first.requestKey)
    const b = await executeTtrpgOpenEntityRequestV1({ ...read, runId: second.runId, requestKey: second.requestKey, runAI: async () => { sends++; return JSON.stringify({ proposals: [s.proposal] }) } })
    expect(b.status === 'candidate' && b.candidate.artifact.status).toBe('usable-with-warnings'); expect(sends).toBe(2)
    const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
    expect(run.coordination.calls).toHaveLength(2); expect(run.oracleReceipts).toHaveLength(1); expect(run.entityOperations ?? []).toEqual([])
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: state.lastSequence, title: '实体候选不继承授权' })
    const childRun = (await readProductRuntimeState(child.id!)).ttrpg!.openRun!
    expect(childRun.coordination.calls).toEqual([]); expect(childRun.coordination.epochs).toEqual([])
    expect(childRun.entityOperations ?? []).toEqual([])
    await expect(recoverTtrpgOpenRuntimeCandidateV1({ ...read, sessionId: child.id! })).rejects.toThrow()
  })
})
