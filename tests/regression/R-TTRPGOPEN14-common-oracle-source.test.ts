import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleSourceV1 as setup } from '../helpers/open-common-oracle-source'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { closeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { loadTtrpgOpenCommonOracleContextV1, createTtrpgOpenCommonOracleContextProviderV1, TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1 } from '../../src/lib/ttrpg/open-common-oracle-context'
import { loadTtrpgOpenCommonProjectionV1 } from '../../src/lib/ttrpg/open-player-context'
import * as core from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenSessionZeroV1, consultTtrpgOracleV1, changeTtrpgSafetyStatus, postTtrpgOpenTableMessageV1, startTtrpgOpenEpochV1, reviewTtrpgOpenOracleCandidateV1, retireTtrpgOpenSessionFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenOracleCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import type { TtrpgOpenOracleFactProposalV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import { CONTEXT_SOURCE_BY_KEY, CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { AGENT_SKILLS, resolveAgentSkillContextSourceKeysV1 } from '../../src/lib/agent/skill-registry'
import { getAgentToolSchemaSnapshotV1 } from '../../src/lib/agent/tool-registry'
import { AGENT_TOOL_SCHEMA_HASH_V1, AGENT_TOOL_SCHEMA_VERSION_V1 } from '../../src/lib/agent/execution-binding'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'

const sourceKey = TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1, provider = createTtrpgOpenCommonOracleContextProviderV1()
describe('R-TTRPGOPEN14 common Oracle source without model or fact authority', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('adds exactly one versioned source while all existing Skills retain their original source permissions', async () => {
    const snapshot = getAgentToolSchemaSnapshotV1()
    // Main added only its author-confirmed Work intent source. Removing that
    // new enum member must retain the complete prior TTRPG v19 declaration.
    const ttrpgV19 = JSON.parse(JSON.stringify(snapshot), (_key, value) => Array.isArray(value) ? value.filter(item => item !== 'workAuthoringIntent') : value)
    expect(await hashCanonicalValue(ttrpgV19)).toBe('4efc0b11ea06cac242c56c3648ff2d4627ed238f51e029044a18e53717a09545')
    const predecessor = JSON.parse(JSON.stringify(ttrpgV19), (_key, value) => Array.isArray(value) ? value.filter(item => item !== 'ttrpgOpenLearnedIdentities' && item !== 'ttrpgOpenCommonIdentities' && item !== sourceKey) : value)
    expect(await hashCanonicalValue(predecessor)).toBe('395aea3eac0451609700481e3f0297ffbbf22fdca92afef0813d88d1d28d62ed')
    expect(await hashCanonicalValue(snapshot)).toBe(AGENT_TOOL_SCHEMA_HASH_V1); expect(AGENT_TOOL_SCHEMA_VERSION_V1).toBe('agent-read-tools-v20')
    expect(CONTEXT_SOURCE_BY_KEY.size).toBe(CONTEXT_SOURCES.length)
    expect(CONTEXT_SOURCE_BY_KEY.get(sourceKey)!.resources!.providerId).toBe(`storyforge.${sourceKey}`)
    for (const skill of AGENT_SKILLS.filter(skill => skill.id !== 'prose.ttrpg-open-common-oracle-interpret')) expect(resolveAgentSkillContextSourceKeysV1(skill, { includeOptional: true, includeGatewayProviders: true }), skill.id).not.toContain(sourceKey)
  })
  it('uses an actual AI-host Oracle and F13 identity intersection with no model preparation or domain mutation', async () => {
    const s = await setup(), before = await core.readProductRuntimeState(s.f.sessionId), count = await db.productRuntimeEvents.count()
    const page = await loadTtrpgOpenCommonOracleContextV1(s.contextInput)
    expect(page.directory).toHaveLength(1); expect(page.recipientActorKeys).toEqual(['companion.1', 'companion.2', 'hero'])
    const packet = page.resources[1].value as any
    expect(packet.sourceRef).toEqual(s.input.oracleSourceRef); expect(packet.outcome).toEqual(before.ttrpg!.openRun!.oracleReceipts![0].resolution.outcome)
    expect(packet.permittedEntityRefs.find((row: any) => row.entityRef === s.npc)).toMatchObject({ name: '新守灯人', playerControlled: false, runtimeOrigin: { sourceRef: before.ttrpg!.openRun!.entityOperations![0].resolution!.sourceRef } })
    expect(packet.permittedEntityRefs.some((row: any) => row.entityRef === s.privatePlace)).toBe(false)
    expect(packet.permittedFrozenFacts.find((row: any) => row.factKey === 'fact.keeper.release')).toMatchObject({ authority: 'initial-state', asOf: 'release', canonicalValue: 'harbor' })
    const gear = Object.values(before.ttrpg!.product.inventory.items).find(row => row.ownerRef === s.npc)!
    expect(gear).toBeDefined(); expect(JSON.stringify(page)).not.toContain(gear.itemInstanceId)
    const text = JSON.stringify(page)
    for (const value of ['COMMON-ORACLE-GM-', 'COMMON-ORACLE-PRIVATE-', 'COMMON-ORACLE-FULL-', 'fact.private.common.oracle', s.privatePlace, '曾经离开港口', '害怕洪水', 'rollReceipt', 'frozenContent', 'gmProfile', 'characterSheet', 'initialInventoryRefs', 'inventory":', 'locationKey":']) expect(text).not.toContain(value)
    expect(await core.readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.agentRuns.count()).toBe(0)
    expect(await loadTtrpgOpenCommonProjectionV1(s.owner)).not.toHaveProperty('oracleHistory')
  })
  it('keeps public Oracle bodies within public inputs even when party objects and release observations are jointly readable', async () => {
    const s = await setup('public'), context = await loadTtrpgOpenCommonOracleContextV1(s.contextInput), packet = context.resources[1].value as any
    expect(packet.audience).toBe('public'); expect(packet.runtimeIdentityScope).toBeNull()
    expect(packet.permittedEntityRefs.some((row: any) => row.entityRef === s.npc)).toBe(false)
    expect(packet.permittedEntityRefs.every((row: any) => row.audience === 'public')).toBe(true)
    expect(packet.permittedFrozenFacts.every((row: any) => row.audience === 'public')).toBe(true)
    expect(packet.permittedSessionFacts.every((row: any) => row.audience === 'public')).toBe(true)
  })
  it('reads actual confirmed common facts, excludes a real private proposal and retirement, and preserves the original source', async () => {
    const f = await readyOpenTtrpgSessionV1('Confirmed common Oracle facts', pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true })
    const rawInput = '核对守灯人的共同解释与逐项事实。', owner = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'common.fact.start'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput })
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(f.sessionId, 'common.fact.oracle'), viewerKey: OPEN_HUMAN_VIEWER, askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '守灯人愿意提供哪些帮助？', likelihoodTierKey: 'even' })
    const state = await core.readProductRuntimeState(f.sessionId), oracleSourceRef = state.ttrpg!.openRun!.oracleReceipts![0].sourceRef
    const base: TtrpgOpenOracleFactProposalV1 = { kind: 'relation', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true, detail: 'CURRENT-CONFIRMED-COMMON-FACT', sourceFactRefs: ['fact.harbor'], audience: 'party', knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null }
    const facts = [base, { ...base, predicateKey: 'promised' as const, objectRef: 'hero', canonicalValue: '私下协助', detail: 'PRIVATE-CONFIRMED-ORACLE-FACT', audience: 'private' as const, knownByActorKeys: ['hero'] },
      { ...base, predicateKey: 'promised' as const, objectRef: 'companion.1', canonicalValue: '旧承诺', detail: 'RETIRED-CONFIRMED-ORACLE-FACT' }]
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...owner, ...await openEnvelopeV1(f.sessionId, 'common.fact.legacy.generate'), rawInput, oracleSourceRef, maximumOutputTokens: 1000, maximumCostUsd: 0.2,
      runAI: async () => JSON.stringify({ interpretation: '共同解释已另行逐条审阅。', facts }) })
    await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(f.sessionId, 'common.fact.legacy.review'), ...owner, ...generated.prepared,
      candidateHash: generated.candidate.candidateHash, interpretationDecision: 'accept', interpretationReason: null,
      choices: facts.map((_fact, proposalIndex) => ({ proposalIndex, decision: 'adopt', reason: null })) })
    const entries = (await core.readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.factLedger!.entries
    await retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(f.sessionId, 'common.fact.retire'), viewerKey: OPEN_HUMAN_VIEWER, factKey: entries[2].fact.factKey, reason: '明确保留旧记录并退休。' })
    const before = await core.readProductRuntimeState(f.sessionId), page = await loadTtrpgOpenCommonOracleContextV1({ ...owner, actorKey: 'gm' })
    const packet = page.resources[1].value as any
    expect(packet.permittedSessionFacts).toEqual([expect.objectContaining({ factKey: entries[0].fact.factKey, detail: base.detail, sourceRef: entries[0].sourceRef })])
    for (const excluded of ['PRIVATE-CONFIRMED-ORACLE-FACT', 'RETIRED-CONFIRMED-ORACLE-FACT', '共同解释已另行逐条审阅。']) expect(JSON.stringify(page.resources)).not.toContain(excluded)
    expect(await core.readProductRuntimeState(f.sessionId)).toEqual(before); expect(before.ttrpg!.openRun!.oracleReceipts).toEqual(state.ttrpg!.openRun!.oracleReceipts)
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('uses one catalog for metadata/search/full bytes and invalidates every pinned read after an actual head transition', async () => {
    const s = await setup(), pinned = await provider.openReadSession!(s.scope), page = await pinned.provider.listMetadata({ scope: s.scope, limit: 1000 })
    expect(page.items.filter(row => row.priority === 'must-read')).toHaveLength(1)
    const row = page.items.find(row => row.kind === 'reference')!, body = await pinned.provider.read({ scope: s.scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })
    expect(await sha256Text(body.content)).toBe(row.contentHash); expect(body.sourceRefs).toHaveLength(2)
    expect((await pinned.provider.searchMetadata({ scope: s.scope, query: 'COMMON-ORACLE-GM-PROFILE-CANARY', limit: 1000 })).items).toEqual([])
    await expect(pinned.provider.read({ scope: s.scope, resourceKey: row.resourceKey, depth: 'summary', maxTokens: 16000 })).rejects.toThrow(/完整/)
    await expect(pinned.provider.read({ scope: s.scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/预算/)
    await expect(pinned.provider.readOriginal({ scope: s.scope, resourceKey: row.resourceKey, maxTokens: 16000 })).rejects.toThrow()
    await postTtrpgOpenTableMessageV1({ ...await openEnvelopeV1(s.f.sessionId, 'common.oracle.changed'), viewerKey: OPEN_HUMAN_VIEWER, submissionKey: 'common.oracle.changed', request: { kind: 'out-of-character', text: '读取后进度已变化', audience: 'party' } })
    await expect(pinned.provider.listMetadata({ scope: s.scope, limit: 1000 })).rejects.toThrow(/已变化/)
    await expect(pinned.provider.read({ scope: s.scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })).rejects.toThrow(/已变化/)
    await expect(pinned.assertCurrent()).rejects.toThrow(/已变化/)
  })
  it('rechecks actual new branch recipients, keeps public history, and survives parent deletion plus full backup', async () => {
    const s = await setup('party', true)
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'common.oracle.public'), viewerKey: OPEN_HUMAN_VIEWER, askedBy: 'player:hero', oracleKey: 'oracle.shared.public', question: '公开结果在新席位加入后仍可知。' })
    await closeTtrpgOpenEntityDeskV1({ ...s.owner, submissionKey: 'common.oracle.close' })
    const before = await loadTtrpgOpenCommonOracleContextV1(s.contextInput)
    expect(before.directory).toHaveLength(2)
    const child = await core.branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: before.readEvidence.sequence, title: '共同 Oracle 新席位' })
    const state = await core.readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'common.oracle.child.zero'), viewerKey: OPEN_HUMAN_VIEWER, acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'late'] })
    const input = { ...s.contextInput, sessionId: child.id! }, joined = await loadTtrpgOpenCommonOracleContextV1(input)
    expect(joined.directory.map(row => row.audience)).toEqual(['public']); expect(JSON.stringify(joined.resources)).not.toContain(s.npc)
    await core.deleteProductRuntimeSession(s.f.sessionId)
    expect((await loadTtrpgOpenCommonOracleContextV1(input)).resources).toEqual(joined.resources)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => JSON.parse(row.initialStateJson).ttrpg.sessionKey === joined.readEvidence.sessionKey)!
    const scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } })
    const imported = await loadTtrpgOpenCommonOracleContextV1({ scope, sessionId: copy.id!, actorKey: 'gm' })
    expect(imported.resources).toEqual(joined.resources); expect(await db.agentRuns.count()).toBe(0)
  })
  it('revokes current and pinned access after safety pause and rejects another scope or role with no private diagnostics', async () => {
    const s = await setup(), pinned = await provider.openReadSession!(s.scope)
    await expect(provider.fingerprint({ ...s.scope, runtimeActorKey: 'hero' })).rejects.toThrow(/共同视图/)
    await expect(provider.fingerprint({ ...s.scope, projectId: 'foreign-project' })).rejects.toThrow('当前共同事实资料不可读取')
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'common.oracle.pause'), viewerKey: OPEN_HUMAN_VIEWER, changedBy: 'hero', status: 'paused', reason: '暂停本次读取' })
    await expect(pinned.provider.listMetadata({ scope: s.scope, limit: 1000 })).rejects.toThrow('当前共同事实资料不可读取')
    await expect(pinned.assertCurrent()).rejects.toThrow('当前共同事实资料不可读取')
  })
  it('requires current actual seats and source stamps, and never returns a stale intersection', async () => {
    const s = await setup(), current = await core.readProductRuntimeStateVersion(s.f.sessionId)
    vi.spyOn(core, 'readProductRuntimeStateVersion').mockResolvedValue({ ...current, sequence: current.sequence + 1 })
    await expect(loadTtrpgOpenCommonOracleContextV1(s.contextInput)).rejects.toThrow(/已变化/)
    vi.restoreAllMocks()
    const seat = (await readTtrpgSessionParticipantsV2(s.f.sessionId)).find(row => row.actorKey === 'companion.1')!
    await db.ttrpgSessionParticipants.update(seat.id!, { revision: seat.revision + 1 })
    await expect(loadTtrpgOpenCommonOracleContextV1(s.contextInput)).rejects.toThrow('当前共同事实资料不可读取')
    const human = await readyOpenTtrpgSessionV1('GM private is a different source', pkg => { pkg.ttrpg!.campaign.gmMode = 'human'; pkg.ttrpg!.campaign.runtimePolicy.enabled = true })
    await expect(loadTtrpgOpenCommonOracleContextV1({ scope: human.scope, sessionId: human.sessionId, actorKey: 'gm' })).rejects.toThrow('当前共同事实资料不可读取')
  })
})
