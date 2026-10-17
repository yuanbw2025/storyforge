import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleSourceV1 } from '../helpers/open-common-oracle-source'
import { loadTtrpgOpenCommonOracleContextV1 } from '../../src/lib/ttrpg/open-common-oracle-context'
import { createTtrpgOpenCommonOracleRequestBasisV1, parseTtrpgOpenCommonOracleRequestBasisV1, hashTtrpgOpenCommonOracleRequestBasisV1, assertTtrpgOpenCommonOracleRequestSourceV1 } from '../../src/lib/ttrpg/open-common-oracle-request'
import { createTtrpgOpenOracleRuntimeReferencePolicyV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { consultTtrpgOracleV1, postTtrpgOpenTableMessageV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'

async function setup(audience: 'public' | 'party' = 'party') {
  const s = await setupCommonOracleSourceV1(audience), source = await loadTtrpgOpenCommonOracleContextV1(s.contextInput), state = await readProductRuntimeState(s.f.sessionId)
  const authorization = state.ttrpg!.authorization!, seat = authorization.seats.find(row => row.viewerKey === OPEN_HUMAN_VIEWER)!
  const runtimeReferencePolicy = source.directory[0].snapshotHash ? await createTtrpgOpenOracleRuntimeReferencePolicyV1({ content: s.f.runtimePackage.ttrpg!, operations: state.ttrpg!.openRun!.entityOperations!, runtimeSourceHash: s.f.session.runtimeSourceHash,
    oracle: state.ttrpg!.openRun!.oracleReceipts![0], recipientActorKeys: source.recipientActorKeys, consumerRef: { sessionKey: state.ttrpg!.sessionKey, sequence: state.lastSequence + 1 } }) : null
  const input = { source, oracleSourceRef: source.directory[0].oracleSourceRef, requester: { viewerKey: seat.viewerKey, seatKey: seat.seatKey, seatRevision: seat.revision }, runtimeReferencePolicy,
    decision: 'request-this-one-common-oracle-candidate' as const, modelIdentity: { provider: 'custom', model: 'fixture-common-oracle' },
    budget: { maximumInputTokens: 16000, maximumOutputTokens: 1000, maximumCostUsd: 0.2, maximumCalls: 1 as const, maximumAiActions: 0 as const, perFactHumanReviewRequired: true as const } }
  return { ...s, source, state, input, basis: await createTtrpgOpenCommonOracleRequestBasisV1(input) }
}
describe('R-TTRPGOPEN14 exact common Oracle request evidence, never a live grant', () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it.each(['public', 'party'] as const)('binds an actual %s full body, current recipients, original cut, model and one-call budget without starting anything', async audience => {
    const s = await setup(audience), count = await db.productRuntimeEvents.count(), before = await readProductRuntimeState(s.f.sessionId)
    expect(parseTtrpgOpenCommonOracleRequestBasisV1(s.basis)).toEqual(s.basis)
    expect(await assertTtrpgOpenCommonOracleRequestSourceV1(s.basis, s.source)).toEqual(s.basis)
    expect(s.basis).toMatchObject({ audience, oracleInputHash: s.source.directory[0].contentHash, readEvidence: { sequence: before.lastSequence }, requester: { viewerKey: OPEN_HUMAN_VIEWER }, budget: { maximumCalls: 1, maximumAiActions: 0, perFactHumanReviewRequired: true } })
    expect(s.basis.runtimeReferencePolicy?.references.snapshotHash ?? null).toBe(s.source.directory[0].snapshotHash)
    const first = await hashTtrpgOpenCommonOracleRequestBasisV1(s.basis)
    expect(await hashTtrpgOpenCommonOracleRequestBasisV1({ ...s.basis, budget: { ...s.basis.budget, maximumCostUsd: 0.1 } })).not.toBe(first)
    expect(await hashTtrpgOpenCommonOracleRequestBasisV1({ ...s.basis, modelIdentity: { ...s.basis.modelIdentity, model: 'another-model' } })).not.toBe(first)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.agentRuns.count()).toBe(0)
    expect(s.basis).not.toHaveProperty('runId'); expect(s.basis).not.toHaveProperty('scope')
  })
  it('rejects unselected sources, implicit consent, private scope, extra powers, unsorted recipients and invalid budgets', async () => {
    const s = await setup()
    await expect(createTtrpgOpenCommonOracleRequestBasisV1({ ...s.input, oracleSourceRef: { ...s.input.oracleSourceRef, sequence: 9999 } })).rejects.toThrow(/明确选择/)
    for (const change of [
      { purpose: 'public-situation-generation' }, { decision: 'adopt-this-one-candidate' }, { audience: 'gm-only' }, { automaticAdoption: true },
      { recipientActorKeys: [...s.basis.recipientActorKeys].reverse() }, { readEvidence: { ...s.basis.readEvidence, sequence: 1 } },
      { budget: { ...s.basis.budget, maximumCalls: 2 } }, { budget: { ...s.basis.budget, maximumAiActions: 1 } },
      { budget: { ...s.basis.budget, perFactHumanReviewRequired: false } }, { budget: { ...s.basis.budget, maximumCostUsd: -1 } },
      { budget: { ...s.basis.budget, maximumInputTokens: 16001 } }, { modelIdentity: { ...s.basis.modelIdentity, apiKey: 'must-not-be-stored' } },
    ]) expect(() => parseTtrpgOpenCommonOracleRequestBasisV1({ ...s.basis, ...change })).toThrow()
  })
  it('checks full actual source bytes and the entire source projection, rather than trusting a descriptor or self-declared scope hash', async () => {
    const s = await setup(), altered = structuredClone(s.source), body = altered.resources.find(row => row.suffix === altered.directory[0].suffix)!
    ;(body.value as any).outcome.question = '替换后的咨询，目录 hash 保持原样。'
    await expect(assertTtrpgOpenCommonOracleRequestSourceV1(s.basis, altered)).rejects.toThrow(/完整正文|范围/)
    const metadata = structuredClone(s.source); metadata.directory[0].contentHash = '0'.repeat(64)
    await expect(assertTtrpgOpenCommonOracleRequestSourceV1(s.basis, metadata)).rejects.toThrow(/完整正文|范围/)
    for (const change of [{ sessionKey: 'foreign.session' }, { runtimeSourceHash: '0'.repeat(64) }, { rulePackContentHash: '0'.repeat(64) }, { authorizationRevision: s.basis.authorizationRevision + 1 },
      { readEvidence: { ...s.basis.readEvidence, sequence: s.basis.readEvidence.sequence + 1 } }, { readEvidence: { ...s.basis.readEvidence, stateHash: '0'.repeat(64) } }]) {
      await expect(assertTtrpgOpenCommonOracleRequestSourceV1({ ...s.basis, ...change }, s.source)).rejects.toThrow()
    }
  })
  it('does not drop, replace or widen a real original F13 scope even after a nested proof is rehashed', async () => {
    const s = await setup(), changed = structuredClone(s.basis), policy = changed.runtimeReferencePolicy!
    await expect(assertTtrpgOpenCommonOracleRequestSourceV1({ ...s.basis, runtimeReferencePolicy: null }, s.source)).rejects.toThrow(/范围/)
    policy.references.snapshotHash = '0'.repeat(64)
    await expect(hashTtrpgOpenCommonOracleRequestBasisV1(changed)).rejects.toThrow(/运行实例引用快照已经损坏/)
    const rehashed = structuredClone(s.basis), snapshot = rehashed.runtimeReferencePolicy!.references
    snapshot.references[0].sourceRef.sequence--
    const { snapshotHash: _oldHash, ...value } = snapshot
    snapshot.snapshotHash = await hashProductProductionValueV2(value)
    await expect(hashTtrpgOpenCommonOracleRequestBasisV1(rehashed)).resolves.toMatch(/^[a-f0-9]{64}$/)
    await expect(assertTtrpgOpenCommonOracleRequestSourceV1(rehashed, s.source)).rejects.toThrow(/范围/)
    const recipients = structuredClone(s.basis); recipients.runtimeReferencePolicy!.recipientActorKeys = ['hero']
    expect(() => parseTtrpgOpenCommonOracleRequestBasisV1(recipients)).toThrow(/接收者/)
  })
  it('separates unchanged source evidence from live execution authority, and rejects an actual changed Oracle catalog', async () => {
    const s = await setup()
    await postTtrpgOpenTableMessageV1({ ...await openEnvelopeV1(s.f.sessionId, 'common.request.source.same'), viewerKey: OPEN_HUMAN_VIEWER, submissionKey: 'common.request.source.same', request: { kind: 'out-of-character', text: '不改变原咨询和已确认资料。', audience: 'party' } })
    const later = await loadTtrpgOpenCommonOracleContextV1(s.contextInput)
    expect(later.readEvidence.sequence).toBeGreaterThan(s.basis.readEvidence.sequence)
    expect(await assertTtrpgOpenCommonOracleRequestSourceV1(s.basis, later)).toEqual(s.basis)
    // Matching source evidence created no new window, request, Run or fact confirmation.
    expect(await db.agentRuns.count()).toBe(0)
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'common.request.source.changed'), viewerKey: OPEN_HUMAN_VIEWER, askedBy: 'player:hero', oracleKey: 'oracle.shared.public', question: '后来新增的原咨询。' })
    await expect(assertTtrpgOpenCommonOracleRequestSourceV1(s.basis, await loadTtrpgOpenCommonOracleContextV1(s.contextInput))).rejects.toThrow(/范围/)
  })
})
