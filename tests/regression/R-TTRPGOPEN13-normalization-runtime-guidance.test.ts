import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupNormalizationRuntimeModelV1 } from '../helpers/open-normalization-runtime-model'
import { setupOracleRuntimeModelV1 } from '../helpers/open-oracle-runtime-model'
import { openContextPolicyFixtureV1 } from '../helpers/open-ttrpg-context'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { generateTtrpgOpenFactNormalizationCandidateV2, generateTtrpgOpenOracleCandidateV2 } from '../../src/lib/ttrpg/open-intent-harness'
import { reviewTtrpgOpenOracleCandidateV1, closeTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { createTtrpgOpenNormalizationRuntimeReferencePolicyV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

describe('R-TTRPGOPEN13 normalization full-source audience before metadata and formal dispatch', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it.each(['public', 'party', 'gm-only'] as const)('uses the exact %s normalization audience for registered author guidance and actual model text', async audience => {
    const s = await setupNormalizationRuntimeModelV1(audience, pkg => {
      const policy = openContextPolicyFixtureV1(), base = policy.triggers[0].trigger
      policy.triggers = [
        { key: 'public', audience: 'public' as const, knownByActorKeys: [], text: 'PUBLIC-NORMALIZATION-GUIDANCE' },
        { key: 'party', audience: 'party' as const, knownByActorKeys: [], text: 'PARTY-NORMALIZATION-GUIDANCE' },
        { key: 'gm', audience: 'gm-only' as const, knownByActorKeys: [], text: 'GM-NORMALIZATION-GUIDANCE' },
        { key: 'gm.private', audience: 'private' as const, knownByActorKeys: ['gm'], text: 'GM-PRIVATE-NORMALIZATION-GUIDANCE' },
        { key: 'hero.private', audience: 'private' as const, knownByActorKeys: ['hero'], text: 'HERO-PRIVATE-NORMALIZATION-GUIDANCE' },
      ].map(row => ({ consumers: ['gm-assistant'], trigger: { ...base, triggerKey: row.key, audience: row.audience, knownByActorKeys: row.knownByActorKeys,
        logic: 'always', textPatterns: [], predicate: null, group: null, sourceRefs: [], injectText: row.text,
        timing: { stickyWorldTurns: 0, cooldownWorldTurns: 0, delayWorldTurns: 0 } } }))
      pkg.ttrpg!.campaign.contextPolicy = policy
    })
    const before = await readProductRuntimeState(s.f.sessionId), scope = { ...s.f.scope, productRuntimeSessionId: s.f.sessionId, runtimeActorKey: 'gm' }
    const provider = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenGmContext')!.resources!, read = await provider.openReadSession!(scope), catalog = await read.provider.listMetadata({ scope, limit: 1000 })
    const bodies = await Promise.all(catalog.items.map(row => read.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })))
    await read.assertCurrent()
    const check = (text: string) => {
      expect(text).toContain('PUBLIC-NORMALIZATION-GUIDANCE')
      expect(text.includes('PARTY-NORMALIZATION-GUIDANCE')).toBe(audience !== 'public')
      expect(text.includes('GM-NORMALIZATION-GUIDANCE')).toBe(audience === 'gm-only')
      expect(text.includes('GM-PRIVATE-NORMALIZATION-GUIDANCE')).toBe(audience === 'gm-only')
      expect(text).not.toContain('HERO-PRIVATE-NORMALIZATION-GUIDANCE')
    }
    check(JSON.stringify(bodies)); expect(catalog.items.every(row => row.policyRevision === 2)).toBe(true)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    const result = await generateTtrpgOpenFactNormalizationCandidateV2({ ...s.normalizationInput, runAI: async messages => { check(JSON.stringify(messages)); return s.output } })
    expect(result.candidate.artifact.status).toBe('usable-with-warnings')
    expect(result.prepared.evidence.contextSelection!.matchedTriggerKeys).toEqual(audience === 'public' ? ['public'] : audience === 'party' ? ['party', 'public'] : ['gm', 'gm.private', 'party', 'public'])
  })
  it('denies a narrower discarded private proposal before any new window or Run, preserving the entire original decision rather than dropping it from the source', async () => {
    const s = await setupOracleRuntimeModelV1('party'), hidden = { ...s.fact, audience: 'private' as const, knownByActorKeys: ['hero'], detail: 'ORIGINAL-DISCARDED-PRIVATE-DETAIL' }
    const original = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI: async () => JSON.stringify({ interpretation: '原全队解释，私域提案另行弃用。', facts: [hidden] }) })
    expect(original.candidate.artifact.status).toBe('usable-with-warnings')
    await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.private.original.review'), ...s.resume(original.prepared),
      candidateHash: original.candidate.candidateHash, interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'discard', reason: '私域提案不采用' }] })
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.private.original.close'), viewerKey: s.owner.viewerKey, epochKey: original.candidate.epochKey, reason: '保留原审阅' })
    const state = await readProductRuntimeState(s.f.sessionId), review = state.ttrpg!.openRun!.oracleReviews![0], runs = await db.agentRuns.count()
    await expect(createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ content: s.f.runtimePackage.ttrpg!, runtime: state.ttrpg!, runtimeSourceHash: s.f.session.runtimeSourceHash,
      reviewSourceRef: review.sourceRef, consumerRef: { sessionKey: state.ttrpg!.sessionKey, sequence: state.lastSequence + 1 } })).rejects.toThrow(/私域内容/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(state); expect(await db.agentRuns.count()).toBe(runs)
  })
})
