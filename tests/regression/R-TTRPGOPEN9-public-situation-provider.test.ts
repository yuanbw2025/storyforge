import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { createTtrpgOpenPublicSituationContextProviderV1, TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1 } from '../../src/lib/ttrpg/open-public-situation-context'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { getAgentToolSchemaSnapshotV1 } from '../../src/lib/agent/tool-registry'
import { AGENT_TOOL_SCHEMA_HASH_V1 } from '../../src/lib/agent/execution-binding'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { createContextAccessPolicyForExecutionV1 } from '../../src/lib/context-gateway/skill-policy'
import { changeTtrpgSafetyStatus, postTtrpgOpenTableMessageV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { executeTtrpgOpenSituationRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'

const sourceKey = TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1, provider = createTtrpgOpenPublicSituationContextProviderV1()
async function setup() {
  const f = await readyOpenTtrpgSessionV1('Public provider', p => {
    p.ttrpg!.campaign.runtimePolicy.enabled = true
    p.ttrpg!.campaign.fronts[0].goal = 'PRIVATE-PROVIDER-CANARY'
  })
  return { f, scope: { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' } }
}
describe('R-TTRPGOPEN9 independent common source and Skill foundation', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('adds only the new source to the tool declaration and freezes an independently closed read-only Skill', async () => {
    const snapshot = getAgentToolSchemaSnapshotV1()
    // Preserve the actual v15 → v16 source delta independently of later protocol additions.
    const withoutNewSource = JSON.parse(JSON.stringify(snapshot), (_key, value) => Array.isArray(value) ? value.filter(item => item !== sourceKey && item !== 'ttrpgOpenEntityInput' && item !== 'ttrpgOpenCommonOracleInput' && item !== 'ttrpgOpenLearnedIdentities' && item !== 'ttrpgOpenCommonIdentities') : value)
    expect(await hashCanonicalValue(withoutNewSource)).toBe('332627dddbd61caf7a873933d8a8428a99884d7260b9995da8698e674bb16cf1')
    expect(await hashCanonicalValue(snapshot)).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
    expect(CONTEXT_SOURCE_BY_KEY.get(sourceKey)!.resources!.providerId).toBe(`storyforge.${sourceKey}`)
    const skill = getAgentSkillV1('prose.ttrpg-open-public-situation-propose'), policy = createContextAccessPolicyForExecutionV1(skill)
    expect(skill.contextSourceKeys).toEqual([sourceKey]); expect(skill.optionalContextSourceKeys).toEqual([]); expect(skill.writeTargets).toEqual([])
    expect(policy.allowedSourceKeys).toEqual([sourceKey]); expect(policy.allowedDepths).toEqual(['full'])
    for (const id of ['prose.ttrpg-open-situation-propose', 'prose.ttrpg-open-intent', 'prose.ttrpg-open-kp', 'prose.ttrpg-open-brief']) {
      expect(createContextAccessPolicyForExecutionV1(getAgentSkillV1(id)).allowedSourceKeys).not.toContain(sourceKey)
    }
  })
  it('keeps metadata, search, complete bodies, content hashes and source refs within the same common-only catalog', async () => {
    const { scope } = await setup(), session = await provider.openReadSession!(scope)
    const page = await session.provider.listMetadata({ scope, limit: 1000 })
    expect(page.items.filter(row => row.priority === 'must-read')).toHaveLength(5)
    const bodies = await Promise.all(page.items.map(row => session.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })))
    expect(bodies.every(body => body.contentHash === body.descriptor.contentHash && body.sourceRefs.length === 2)).toBe(true)
    const search = await session.provider.searchMetadata({ scope, query: 'PRIVATE-PROVIDER-CANARY', limit: 1000 })
    expect(search.items).toEqual([])
    expect(JSON.stringify({ page, bodies })).not.toContain('PRIVATE-PROVIDER-CANARY')
    await expect(session.provider.read({ scope, resourceKey: page.items[0].resourceKey, depth: 'summary', maxTokens: 16000 })).rejects.toThrow(/完整/)
    await expect(session.provider.read({ scope, resourceKey: page.items[0].resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/预算/)
    await expect(session.provider.readOriginal({ scope, resourceKey: page.items[0].resourceKey, maxTokens: 16000 })).rejects.toThrow()
    await session.assertCurrent()
  })
  it('revokes a pinned catalog immediately after an actual safety pause and never exposes original private proof errors', async () => {
    const { f, scope } = await setup(), session = await provider.openReadSession!(scope)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.sessionId, 'public.pause'), viewerKey: OPEN_HUMAN_VIEWER, changedBy: 'hero', status: 'paused', reason: '暂停' })
    await expect(session.provider.listMetadata({ scope, limit: 1000 })).rejects.toThrow(/当前共同资料不可读取/)
    await expect(session.assertCurrent()).rejects.toThrow(/当前共同资料不可读取/)
    await expect(provider.fingerprint({ ...scope, runtimeActorKey: 'hero' })).rejects.toThrow(/共同视图/)
  })
  it('refuses pinned old metadata and bytes after an actual source transition, even while current party read consent remains valid', async () => {
    const { f, scope } = await setup(), session = await provider.openReadSession!(scope)
    const page = await session.provider.listMetadata({ scope, limit: 1000 })
    await postTtrpgOpenTableMessageV1({ ...await openEnvelopeV1(f.sessionId, 'public.source.changed'), viewerKey: OPEN_HUMAN_VIEWER,
      submissionKey: 'public.source.discussion', request: { kind: 'out-of-character', text: '稍等一下', audience: 'party' } })
    await expect(session.provider.listMetadata({ scope, limit: 1000 })).rejects.toThrow(/已变化/)
    await expect(session.provider.read({ scope, resourceKey: page.items[0].resourceKey, depth: 'full', maxTokens: 16000 })).rejects.toThrow(/已变化/)
    expect((await provider.listMetadata({ scope, limit: 1000 })).scopeFingerprint).not.toBe(page.scopeFingerprint)
  })
  it('continues an actual predecessor v15 private request without widening frozen sources, purpose, Skill or tool binding', async () => {
    const legacy = JSON.parse(gunzipSync(readFileSync('tests/fixtures/ttrpg-open-pre-public-source-prepared-v1.json.gz')).toString())
    expect(legacy.predecessorCommit).toBe('b6b859e04c7c2f68ab05ad4c66374dd0d8b04952')
    expect(legacy.toolVersion).toBe('agent-read-tools-v15')
    await db.transaction('rw', db.tables, async () => { for (const [name, rows] of Object.entries(legacy.tables)) if ((rows as unknown[]).length) await db.table(name).bulkAdd(rows as any[]) })
    const before = await readInstanceAgentRunV1(legacy.scope, legacy.runId)
    let sends = 0
    const result = await executeTtrpgOpenSituationRequestV1({ scope: legacy.scope, sessionId: legacy.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
      runId: legacy.runId, requestKey: legacy.requestKey, runAI: async () => { sends++; return JSON.stringify(legacy.output) } })
    expect(result.status).toBe('candidate'); expect(sends).toBe(1)
    const after = await readInstanceAgentRunV1(legacy.scope, legacy.runId)
    expect(after.contract).toEqual(before.contract)
    expect(after.contract.permissions.contextSourceKeys).not.toContain(sourceKey)
    expect(after.contract.executionBindings![0]).toMatchObject({ toolSchemaVersion: legacy.toolVersion, toolSchemaHash: legacy.toolHash })
    expect(JSON.stringify(after.contract.executionBindings)).not.toContain('ttrpg-open-public-situation-propose')
  })
})
