import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ttrpgOpenKnowledgeResourceTitleV2 } from '../../src/lib/ttrpg/open-context-provider'
import { selectContextResourcesV1, getContextSelectorPolicyV1 } from '../../src/lib/context-gateway/selector'
import type { ContextAccessPolicyV1, ContextResourceDescriptorV1 } from '../../src/lib/registry/types'
import type { TtrpgOpenKnowledgeDisplayV1 } from '../../src/lib/ttrpg/open-knowledge'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { setupIdentityKnowledgeRuntimeV1 } from '../helpers/open-identity-knowledge-runtime'

const scope = { projectId: 1, worldId: 2, workId: 3, productRuntimeSessionId: 4, runtimeActorKey: 'hero' }
const knowledge = (evidenceRef: string, reliability: TtrpgOpenKnowledgeDisplayV1['reliability'] = 'observed', description = '只有公开运输问题，不证明运输已经获准。'): TtrpgOpenKnowledgeDisplayV1 =>
  ({ evidenceRef, title: '运输咨询的合法入口', description, reliability })
async function select(entries: TtrpgOpenKnowledgeDisplayV1[]) {
  const descriptors: ContextResourceDescriptorV1[] = await Promise.all(entries.map(async (entry, index) => ({
    version: 1, resourceKey: `fact:ttrpg-open:test:hero:knowledge.v2.${index}`, sourceKey: 'ttrpgOpenKnowledge', kind: 'fact',
    title: await ttrpgOpenKnowledgeResourceTitleV2(entry), shortSummary: entry.title, authority: 'confirmed-evidence',
    contentRevision: 1, contentHash: await hashCanonicalValue(entry), policyRevision: 2, policyHash: 'a'.repeat(64), scope,
    relations: [], sourceRefs: [{ table: 'productRuntimeSessions', recordId: 4, field: 'runtimeHeadStateJson', revision: 1, contentHash: 'b'.repeat(64) }],
    tokenEstimate: { full: 100 }, availableDepths: ['full'], priority: 'must-read',
  })))
  const accessPolicy: ContextAccessPolicyV1 = { version: 'context-access-policy-v1', policyId: 'knowledge-identity-semantic-test',
    mandatorySourceKeys: ['ttrpgOpenKnowledge'], allowedSourceKeys: ['ttrpgOpenKnowledge'], allowedResourceKinds: ['fact'], allowedDepths: ['full'],
    selectorPolicyId: getContextSelectorPolicyV1('agent-world-origin').selectorPolicyId, maxReadCalls: 10, maxRetrievedTokens: 8000,
    allowOriginalRead: false, candidateAccess: 'explicit-resource-key-only' }
  const selected = await selectContextResourcesV1({ taskKind: 'agent-world-origin', accessPolicy, scope, descriptors,
    budgetTokens: 8000, mandatoryResourceKeys: descriptors.map(row => row.resourceKey), readsAllowed: true })
  return { descriptors, selected, conflicts: selected.sufficiency.obligations.filter(row => row.reasonCode === 'same-name-different-canon') }
}
describe('R-TTRPGOPEN7 knowledge identity through the unchanged shared conflict guard', () => {
  it('delivers distinct same-named original and copied-opening evidence without changing their bodies', async () => {
    const entries = [knowledge('w.clue.route'), knowledge('author.opening.evidence.1')], before = structuredClone(entries)
    const result = await select(entries)
    expect(result.selected.selected).toHaveLength(2); expect(result.conflicts).toEqual([]); expect(entries).toEqual(before)
    expect(result.descriptors[0].contentHash).not.toBe(result.descriptors[1].contentHash)
  })
  it('retains observed, hearsay and belief as different records rather than contradictory canon', async () => {
    const result = await select(['observed', 'hearsay', 'belief'].map(reliability => knowledge('w.clue.route', reliability as TtrpgOpenKnowledgeDisplayV1['reliability'])))
    expect(result.selected.selected).toHaveLength(3); expect(result.conflicts).toEqual([])
    expect(result.descriptors.map(row => row.title)).toEqual(expect.arrayContaining([expect.stringContaining('observed'), expect.stringContaining('hearsay'), expect.stringContaining('belief')]))
  })
  it('distinguishes exact evidence identities even when shared title normalization removes their punctuation', async () => {
    const result = await select([knowledge('clue.a-b'), knowledge('clue.a_b')])
    expect(result.conflicts).toEqual([]); expect(result.descriptors[0].title).not.toBe(result.descriptors[1].title)
  })
  it('still rejects different content for the same evidence, reliability and name', async () => {
    const result = await select([knowledge('w.clue.route'), knowledge('w.clue.route', 'observed', '运输已经获准。')])
    expect(result.conflicts).toEqual([expect.objectContaining({ required: true, status: 'conflicted', reasonCode: 'same-name-different-canon' })])
  })
})
describe('R-TTRPGOPEN7 real registered knowledge provider legacy reads', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('lists only versioned metadata, preserves exact old body/title/policy, and rechecks authority for old reads', async () => {
    const s = await setupIdentityKnowledgeRuntimeV1(false, true)
    const scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'hero' }
    const provider = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenKnowledge')!.resources!
    const before = JSON.stringify(await db.productRuntimeSessions.get(s.f.sessionId))
    const page = await provider.listMetadata({ scope, limit: 1000 }), rows = page.items.filter(row => /:knowledge\.v2\./.test(row.resourceKey))
    expect(rows.length).toBeGreaterThan(0); expect(page.items.some(row => /:knowledge\.(0|[1-9]\d*)$/.test(row.resourceKey))).toBe(false)
    for (const row of rows) {
      const current = await provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 10000 })
      const legacy = await provider.read({ scope, resourceKey: row.resourceKey.replace(':knowledge.v2.', ':knowledge.'), depth: 'full', maxTokens: 10000 })
      expect(current.content).toBe(legacy.content); expect(current.contentHash).toBe(legacy.contentHash)
      expect(legacy.descriptor.title).toBe(JSON.parse(legacy.content).title); expect(legacy.descriptor.policyRevision).toBe(1)
      expect(legacy.descriptor.policyHash).toBe(await hashCanonicalValue({ sourceKey: 'ttrpgOpenKnowledge', actorKey: 'hero', originalRead: false, fullIsAtomic: true }))
      expect(current.descriptor.policyRevision).toBe(2); expect(current.descriptor.policyHash).not.toBe(legacy.descriptor.policyHash)
    }
    expect(JSON.stringify(await db.productRuntimeSessions.get(s.f.sessionId))).toBe(before)
    const seat = await db.ttrpgSessionParticipants.where('sessionId').equals(s.f.sessionId).filter(row => row.actorKey === 'hero').first()
    // Explicit corrupt-storage evidence, never an alternative way to grant or revoke a real seat.
    await db.ttrpgSessionParticipants.update(seat!.id!, { consent: { ...seat!.consent, aiAdviceAllowed: false }, revision: seat!.revision + 1 })
    await expect(provider.read({ scope, resourceKey: rows[0].resourceKey.replace(':knowledge.v2.', ':knowledge.'), depth: 'full', maxTokens: 10000 })).rejects.toThrow()
  })
})
