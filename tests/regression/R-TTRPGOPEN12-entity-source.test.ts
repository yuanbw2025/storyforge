import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1, seedOpenTtrpgSessionV1, configureOpenSeatsV1 } from '../helpers/open-ttrpg-session'
import { loadTtrpgOpenEntityContextV1, createTtrpgOpenEntityContextProviderV1, TTRPG_OPEN_ENTITY_SOURCE_V1 } from '../../src/lib/ttrpg/open-entity-context'
import { getAgentToolSchemaSnapshotV1 } from '../../src/lib/agent/tool-registry'
import { AGENT_TOOL_SCHEMA_HASH_V1, AGENT_TOOL_SCHEMA_VERSION_V1 } from '../../src/lib/agent/execution-binding'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { CONTEXT_SOURCES, CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { getAgentSkillV1, AGENT_SKILLS, resolveAgentSkillContextSourceKeysV1 } from '../../src/lib/agent/skill-registry'
import { createContextAccessPolicyForExecutionV1 } from '../../src/lib/context-gateway/skill-policy'
import { executeTtrpgOpenOracleRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { changeTtrpgSafetyStatus, postTtrpgOpenTableMessageV1, completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1,
  startTtrpgOpenEpochV1, consultTtrpgOracleV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'

const sourceKey = TTRPG_OPEN_ENTITY_SOURCE_V1, provider = createTtrpgOpenEntityContextProviderV1()
async function setup() {
  const s = await setupOpenEntityPlanningV1(pkg => {
    const c = pkg.ttrpg!.campaign; c.runtimePolicy.enabled = true
    c.characterTemplates.find(c => c.characterKey === 'keeper')!.gmProfile!.secret = 'ENTITY-SOURCE-UNREAD-GM-PROFILE'
    c.fronts[0].goal = 'ENTITY-SOURCE-UNREAD-FRONT'
    c.dynamicEntityTemplates.push({ ...c.dynamicEntityTemplates[0], templateKey: 'private.hero.template', audience: 'private', knownByActorKeys: ['hero'], description: 'ENTITY-SOURCE-OWN-PRIVATE-TEMPLATE' },
      { ...c.dynamicEntityTemplates[0], templateKey: 'gm.template', audience: 'gm-only', description: 'ENTITY-SOURCE-GM-TEMPLATE' },
      { ...c.dynamicEntityTemplates[0], templateKey: 'private.other.template', audience: 'private', knownByActorKeys: ['companion.1'], description: 'ENTITY-SOURCE-OTHER-PRIVATE-TEMPLATE' })
  })
  return { ...s, context: { scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'gm' },
    scope: { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'gm' } }
}
describe('R-TTRPGOPEN12 read-only entity source, original consultation and recipient partitions', { timeout: 90000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('adds exactly one source to tools while existing Skills and formal purposes gain no new source permission', async () => {
    const snapshot = getAgentToolSchemaSnapshotV1()
    const old = JSON.parse(JSON.stringify(snapshot), (_key, value) => Array.isArray(value) ? value.filter(item => item !== 'ttrpgOpenLearnedIdentities' && item !== 'ttrpgOpenCommonIdentities' && item !== sourceKey && item !== 'ttrpgOpenCommonOracleInput') : value)
    expect(await hashCanonicalValue(old)).toBe('8cf80c48035160cdfdd3fccce3f24e005041a89efaf26f40f30cf8aa8b58417e')
    expect(await hashCanonicalValue(snapshot)).toBe(AGENT_TOOL_SCHEMA_HASH_V1); expect(AGENT_TOOL_SCHEMA_VERSION_V1).toBe('agent-read-tools-v19')
    expect(CONTEXT_SOURCE_BY_KEY.size).toBe(CONTEXT_SOURCES.length)
    expect(CONTEXT_SOURCE_BY_KEY.get(sourceKey)!.resources!.providerId).toBe(`storyforge.${sourceKey}`)
    for (const skill of ['prose.ttrpg-open-intent', 'prose.ttrpg-open-oracle-interpret', 'prose.ttrpg-open-public-situation-propose', 'prose.ttrpg-open-kp']) {
      expect(createContextAccessPolicyForExecutionV1(getAgentSkillV1(skill)).allowedSourceKeys).not.toContain(sourceKey)
    }
    for (const skill of AGENT_SKILLS.filter(skill => skill.id !== 'prose.ttrpg-open-entity-propose')) {
      expect(resolveAgentSkillContextSourceKeysV1(skill, { includeOptional: true, includeGatewayProviders: true }), skill.id).not.toContain(sourceKey)
    }
  })
  it('separates party and private template bodies, omits unrelated secrets and performs no mutation or model preparation', async () => {
    const s = await setup(), before = await db.productRuntimeEvents.count(), context = await loadTtrpgOpenEntityContextV1(s.context)
    const party = context.directory.find(d => d.scope.audience === 'party')!, privateOwn = context.directory.find(d => d.scope.audience === 'private')!
    expect(party.templates.some(t => t.templateKey === 'private.hero.template')).toBe(false)
    expect(privateOwn.scope.recipientActorKeys).toEqual(['hero']); expect(privateOwn.templates.some(t => t.templateKey === 'private.hero.template')).toBe(true)
    const partyBodies = context.resources.filter(r => [party.oracleSuffix, ...party.templates.map(t => t.suffix), ...party.placements.map(p => p.suffix)].includes(r.suffix))
    expect(JSON.stringify(partyBodies)).not.toContain('ENTITY-SOURCE-OWN-PRIVATE-TEMPLATE')
    expect(JSON.stringify(context)).not.toContain('ENTITY-SOURCE-UNREAD-'); expect(JSON.stringify(context)).not.toContain('ENTITY-SOURCE-GM-TEMPLATE')
    expect(JSON.stringify(context)).not.toContain('ENTITY-SOURCE-OTHER-PRIVATE-TEMPLATE')
    expect(context.directory.every(d => JSON.stringify(d.sourceRef) === JSON.stringify(s.input.oracleSourceRef))).toBe(true)
    expect(context.directory.some(d => d.scope.audience === 'public' || d.scope.audience === 'gm-only')).toBe(false)
    expect(await db.productRuntimeEvents.count()).toBe(before); expect(await db.agentRuns.count()).toBe(0)
  })
  it('requires original full resources and an exact role, and invalidates pinned metadata and bytes after a real state transition', async () => {
    const s = await setup(), pinned = await provider.openReadSession!(s.scope), page = await pinned.provider.listMetadata({ scope: s.scope, limit: 1000 })
    expect(page.items.filter(i => i.priority === 'must-read')).toHaveLength(1)
    const row = page.items.find(i => i.resourceKey.includes('entity-template.'))!
    const body = await pinned.provider.read({ scope: s.scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })
    expect(body.contentHash).toBe(row.contentHash); expect(body.sourceRefs).toHaveLength(2)
    expect(JSON.stringify(page)).not.toContain('ENTITY-SOURCE-OWN-PRIVATE-TEMPLATE')
    expect((await pinned.provider.searchMetadata({ scope: s.scope, query: 'ENTITY-SOURCE-GM-TEMPLATE', limit: 1000 })).items).toEqual([])
    await expect(pinned.provider.read({ scope: s.scope, resourceKey: row.resourceKey, depth: 'summary', maxTokens: 16000 })).rejects.toThrow(/完整/)
    await expect(pinned.provider.read({ scope: s.scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/预算/)
    await expect(pinned.provider.readOriginal({ scope: s.scope, resourceKey: row.resourceKey, maxTokens: 16000 })).rejects.toThrow()
    await expect(provider.fingerprint({ ...s.scope, runtimeActorKey: 'hero' })).rejects.toThrow(/主持视图/)
    await postTtrpgOpenTableMessageV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.source.changed'), viewerKey: OPEN_HUMAN_VIEWER,
      submissionKey: 'entity.source.note', request: { kind: 'out-of-character', text: '原资料已经变化', audience: 'party' } })
    await expect(pinned.provider.listMetadata({ scope: s.scope, limit: 1000 })).rejects.toThrow(/已变化/)
    await expect(pinned.provider.read({ scope: s.scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })).rejects.toThrow(/已变化/)
  })
  it('revokes source access after pause and rejects a foreign scope without exposing original proof diagnostics', async () => {
    const s = await setup(), pinned = await provider.openReadSession!(s.scope)
    await expect(provider.fingerprint({ ...s.scope, projectId: 'foreign-project' })).rejects.toThrow('当前实体提案资料不可读取')
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'entity.source.pause'), viewerKey: OPEN_HUMAN_VIEWER, changedBy: 'hero', status: 'paused', reason: '暂停读取' })
    await expect(pinned.provider.listMetadata({ scope: s.scope, limit: 1000 })).rejects.toThrow('当前实体提案资料不可读取')
    await expect(pinned.assertCurrent()).rejects.toThrow('当前实体提案资料不可读取')
  })
  it('keeps a human GM-only consultation inside GM-only partitions even for otherwise public templates', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => {
      pkg.ttrpg!.campaign.gmMode = 'human'; pkg.ttrpg!.campaign.runtimePolicy.enabled = true
      pkg.ttrpg!.rulePack.content.oracles[0].audience = 'gm-only'; pkg.ttrpg!.campaign.dynamicEntityTemplates[0].audience = 'public'
    }, 'viewer.gm')
    const c = await loadTtrpgOpenEntityContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'gm' })
    expect(c.directory).toHaveLength(1); expect(c.directory[0].scope.audience).toBe('gm-only')
    expect(c.directory[0].placements.every(p => !s.input.state.ttrpg!.authorization!.selectedActorKeys.includes(p.entityKey))).toBe(true)
  })
  it('keeps a public packet free of private templates and placements even when another scope is also available', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => {
      pkg.ttrpg!.campaign.runtimePolicy.enabled = true; pkg.ttrpg!.rulePack.content.oracles[0].audience = 'public'
      pkg.ttrpg!.campaign.dynamicEntityTemplates[0].audience = 'public'
      pkg.ttrpg!.campaign.dynamicEntityTemplates[1].audience = 'private'; pkg.ttrpg!.campaign.dynamicEntityTemplates[1].knownByActorKeys = ['hero']
      pkg.ttrpg!.campaign.dynamicEntityTemplates[1].description = 'ENTITY-SOURCE-PRIVATE-PLACE-TEMPLATE'
    })
    const c = await loadTtrpgOpenEntityContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'gm' }), partition = c.directory.find(d => d.scope.audience === 'public')!
    expect(partition.templates.map(t => t.templateKey)).toEqual(['dynamic.npc'])
    const suffixes = [partition.oracleSuffix, ...partition.templates.map(t => t.suffix), ...partition.placements.map(p => p.suffix)]
    expect(JSON.stringify(c.resources.filter(r => suffixes.includes(r.suffix)))).not.toContain('ENTITY-SOURCE-PRIVATE-PLACE-TEMPLATE')
    expect(partition.placements.some(p => p.entityKey === 'hero')).toBe(false)
  })
  it('allows a GM-only source when an unrelated player declines narrative logging, without reading that player into the packet', async () => {
    const f = await seedOpenTtrpgSessionV1('Scoped entity logging consent', pkg => {
      const c = pkg.ttrpg!.campaign; c.gmMode = 'human'; c.runtimePolicy.enabled = true
      c.characterTemplates.find(c => c.characterKey === 'companion.1')!.controller = 'hybrid'
      pkg.ttrpg!.rulePack.content.oracles[0].audience = 'gm-only'; pkg.ttrpg!.rulePack.content.oracles[0].interpretation.maxNewEntities = 3
      c.dynamicEntityTemplates = [{ templateKey: 'gm.private.npc', kind: 'actor', characterTemplateKey: 'keeper', itemDefinitionKey: null,
        description: '主持内部人物候选', parameters: [], maximumNameLength: 20, maximumInstances: 2, audience: 'gm-only', knownByActorKeys: [],
        sourceRefs: [c.entityBindings.find(b => b.bindingKey === 'harbor')!.sourceResourceRef!] }]
    })
    await configureOpenSeatsV1(f.sessionId)
    const actor = (await readTtrpgSessionParticipantsV2(f.sessionId)).find(s => s.actorKey === 'companion.1')!
    await configureTtrpgSessionParticipantV2({ sessionId: f.sessionId, seatKey: actor.seatKey, expectedRevision: actor.revision,
      commandId: 'entity.source.decline.logging', requestedByViewerKey: actor.viewerKey, consent: { sessionLoggingAllowed: false } })
    const state = await readProductRuntimeState(f.sessionId)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(f.sessionId, 'entity.source.zero'), acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], viewerKey: OPEN_HUMAN_VIEWER })
    await startTtrpgOpenRunV1({ ...await openEnvelopeV1(f.sessionId, 'entity.source.open'), viewerKey: OPEN_HUMAN_VIEWER })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'entity.source.gm.epoch'), viewerKey: 'viewer.gm', triggerKind: 'continue-host', rawInput: '只咨询主持内部人物' })
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(f.sessionId, 'entity.source.gm.oracle'), viewerKey: 'viewer.gm', askedBy: 'gm', oracleKey: f.runtimePackage.ttrpg!.rulePack.content.oracles[0].oracleKey, question: '主持内部可以引入新人物吗？' })
    const c = await loadTtrpgOpenEntityContextV1({ scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' })
    expect(c.directory).toHaveLength(1); expect(c.directory[0].scope.audience).toBe('gm-only')
    expect(c.directory[0].placements.some(p => p.entityKey === actor.actorKey)).toBe(false)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('continues the actual captured v16 Oracle request with unchanged contract, original source grants and exactly one send', async () => {
    const legacy = JSON.parse(gunzipSync(readFileSync('tests/fixtures/ttrpg-open-pre-entity-source-prepared-v1.json.gz')).toString())
    expect(legacy.sourceCommit).toBe('7d06cfe7811034babff087418a9fb7d7f90e8cc8'); expect(legacy.toolSchemaVersion).toBe('agent-read-tools-v16')
    expect(await hashCanonicalValue(legacy.toolSchemaSnapshot)).toBe(legacy.toolSchemaHash)
    await db.transaction('rw', db.tables, async () => { for (const [name, rows] of Object.entries(legacy.tables)) if ((rows as unknown[]).length) await db.table(name).bulkAdd(rows as any[]) })
    const before = await readInstanceAgentRunV1(legacy.scope, legacy.runId); let sends = 0
    const result = await executeTtrpgOpenOracleRequestV1({ scope: legacy.scope, sessionId: legacy.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
      runId: legacy.runId, requestKey: legacy.requestKey, runAI: async () => { sends++; return JSON.stringify({ interpretation: '原咨询仍保持原意，具体对象仍须另行提案并确认。', facts: [] }) } })
    expect(result.status).toBe('candidate'); expect(sends).toBe(1)
    const after = await readInstanceAgentRunV1(legacy.scope, legacy.runId)
    expect(after.contract).toEqual(before.contract); expect(after.contract.permissions.contextSourceKeys).not.toContain(sourceKey)
    expect(after.contract.executionBindings![0]).toMatchObject({ toolSchemaVersion: legacy.toolSchemaVersion, toolSchemaHash: legacy.toolSchemaHash })
    expect(await db.agentRuns.count()).toBe(1)
  })
})
