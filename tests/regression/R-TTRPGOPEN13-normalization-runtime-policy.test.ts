import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import { setupOracleRuntimeModelV1, setupOracleRuntimeDeskV1 } from '../helpers/open-oracle-runtime-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenOracleCandidateV2, generateTtrpgOpenOracleCandidateV1, executeTtrpgOpenFactNormalizationRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, reviewTtrpgOpenOracleCandidateV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { createTtrpgOpenNormalizationRuntimeReferencePolicyV1, assertTtrpgOpenNormalizationRuntimeReferenceJournalV1,
  assertTtrpgOpenNormalizationRuntimeReferenceOriginV1, parseTtrpgOpenNormalizationRuntimeReferencePolicyV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'
import { hashProductProductionValueV2 as hash } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { verifyProductRuntimeSessionSourceV1 } from '../../src/lib/product-production/preview-source'
import { readTtrpgOpenOracleModelDeskV1 } from '../../src/lib/ttrpg/open-oracle-model-desk'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { projectFrozenAgentSkillDefinitionV1 } from '../../src/lib/agent/execution-binding'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'

async function setup(audience: 'public' | 'party' | 'gm-only' = 'party', reject = false) {
  const s = await setupOracleRuntimeModelV1(audience)
  const generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI: async () => JSON.stringify({ interpretation: '已接受的原解释，不能重新解释或重写。', facts: [s.fact] }) })
  await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalize.policy.original.review'), ...s.resume(generated.prepared),
    candidateHash: generated.candidate.candidateHash, interpretationDecision: reject ? 'reject' : 'accept', interpretationReason: reject ? '不采用该解释' : null,
    choices: [{ proposalIndex: 0, decision: 'discard', reason: '原提案明确弃用，不得复活' }] })
  await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalize.policy.original.close'), viewerKey: s.owner.viewerKey,
    epochKey: generated.candidate.epochKey, reason: '已接受或拒绝原解释，结束原请求；归一需另行授权' })
  const state = await readProductRuntimeState(s.f.sessionId), review = state.ttrpg!.openRun!.oracleReviews![0]
  const input = { content: s.f.runtimePackage.ttrpg!, runtimeSourceHash: s.f.session.runtimeSourceHash, runtime: state.ttrpg!, reviewSourceRef: review.sourceRef,
    consumerRef: { sessionKey: state.ttrpg!.sessionKey, sequence: state.lastSequence + 1 } }
  return { ...s, generated, state, review, normalizationInput: input }
}
describe('R-TTRPGOPEN13 normalization instance source foundation without execution authority', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it.each(['public', 'party', 'gm-only'] as const)('retains the exact original %s consultation, accepted interpretation and immutable instance scope without any request or write', async audience => {
    const s = await setup(audience), count = await db.productRuntimeEvents.count(), runs = await db.agentRuns.count()
    const policy = await createTtrpgOpenNormalizationRuntimeReferencePolicyV1(s.normalizationInput)
    expect(policy.oraclePolicy).toEqual(s.policy); expect(policy.reviewSourceRef).toEqual(s.review.sourceRef); expect(policy.reviewHash).toBe(s.review.reviewHash)
    expect(policy.recipientActorKeys).toEqual(s.state.ttrpg!.authorization!.selectedActorKeys)
    expect(parseTtrpgOpenNormalizationRuntimeReferencePolicyV1(policy)).toEqual(policy)
    expect(assertTtrpgOpenNormalizationRuntimeReferenceJournalV1({ ...s.normalizationInput, policy })).toEqual(policy)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(s.state); expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.agentRuns.count()).toBe(runs)
    expect(s.review.choices[0]).toMatchObject({ decision: 'discard', reason: '原提案明确弃用，不得复活' })
  })
  it('allows only a narrower current party read projection while preserving original recipients, and denies a caller expanding them', async () => {
    const s = await setup(), input = structuredClone(s.normalizationInput)
    input.runtime.authorization!.selectedActorKeys = input.runtime.authorization!.selectedActorKeys.slice(0, 2)
    const narrowed = await createTtrpgOpenNormalizationRuntimeReferencePolicyV1(input)
    expect(narrowed.recipientActorKeys).toHaveLength(2); expect(narrowed.oraclePolicy.recipientActorKeys).toHaveLength(3)
    input.runtime.authorization!.selectedActorKeys.push('unshared.later.actor')
    await expect(createTtrpgOpenNormalizationRuntimeReferencePolicyV1(input)).rejects.toThrow(/接收者|新加入/)
    // Replaying a previously validated epoch uses its frozen roster, not today's new Session Zero.
    expect(assertTtrpgOpenNormalizationRuntimeReferenceOriginV1({ ...input, policy: narrowed,
      rulePackContentHash: input.content.rulePack.contentHash, recipientActorKeys: narrowed.recipientActorKeys })).toEqual(narrowed)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(s.state)
  })
  it('rejects a genuinely rejected interpretation and forged/nested/orphan/future sources instead of granting another purpose', async () => {
    const s = await setup('party', true)
    await expect(createTtrpgOpenNormalizationRuntimeReferencePolicyV1(s.normalizationInput)).rejects.toThrow(/已接受/)
    for (const change of ['nested', 'hash', 'orphan', 'future', 'different-session', 'invalid-ref'] as const) {
      const input = structuredClone(s.normalizationInput), review = input.runtime.openRun!.oracleReviews![0]
      review.interpretationDecision = 'accept'; review.interpretationReason = null
      const { reviewHash: _oldHash, ...body } = review; review.reviewHash = await hash(body)
      if (change === 'nested') review.normalizationOf = { sourceRef: review.sourceRef, reviewHash: review.reviewHash }
      if (change === 'hash') review.interpretation = '伪造已接受文本，沿用旧 hash'
      if (change === 'orphan') input.runtime.openRun!.coordination.calls = []
      if (change === 'future') input.consumerRef = review.sourceRef
      if (change === 'different-session') input.consumerRef.sessionKey = 'unrelated.session'
      if (change === 'invalid-ref') input.consumerRef.sequence = NaN
      await expect(createTtrpgOpenNormalizationRuntimeReferencePolicyV1(input)).rejects.toThrow()
    }
  })
  it('denies a rehashed changed original scope, another review hash and an old release-only Oracle interpretation', async () => {
    const s = await setup(), policy = await createTtrpgOpenNormalizationRuntimeReferencePolicyV1(s.normalizationInput)
    const forged = structuredClone(policy); forged.oraclePolicy.references.references = []
    const { snapshotHash: _hash, ...body } = forged.oraclePolicy.references; forged.oraclePolicy.references.snapshotHash = await hash(body)
    expect(() => assertTtrpgOpenNormalizationRuntimeReferenceJournalV1({ ...s.normalizationInput, policy: forged })).toThrow(/范围|解释/)
    expect(() => assertTtrpgOpenNormalizationRuntimeReferenceJournalV1({ ...s.normalizationInput, policy: { ...policy, reviewHash: '0'.repeat(64) } })).toThrow()
    expect(() => parseTtrpgOpenNormalizationRuntimeReferencePolicyV1({ ...policy, allowModelWrites: true })).toThrow()
    await db.delete(); await db.open()
    const old = await setupOracleRuntimeDeskV1('party'), rawInput = '原 V1 解释不取得实例范围'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(old.f.sessionId, 'normalize.policy.legacy.start'), viewerKey: old.owner.viewerKey, triggerKind: 'continue-host', rawInput })
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(old.f.sessionId, 'normalize.policy.legacy.prepare'), ...old.owner,
      rawInput, oracleSourceRef: old.input.oracle.sourceRef, maximumOutputTokens: 1000, maximumCostUsd: 0.1, runAI: async () => JSON.stringify({ interpretation: '已接受的旧冻结对象解释。', facts: [] }) })
    await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(old.f.sessionId, 'normalize.policy.legacy.review'), ...old.owner,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [] })
    const legacy = await readProductRuntimeState(old.f.sessionId)
    await expect(createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ content: old.f.runtimePackage.ttrpg!, runtimeSourceHash: old.f.session.runtimeSourceHash,
      runtime: legacy.ttrpg!, reviewSourceRef: legacy.ttrpg!.openRun!.oracleReviews![0].sourceRef,
      consumerRef: { sessionKey: legacy.ttrpg!.sessionKey, sequence: legacy.lastSequence + 1 } })).rejects.toThrow(/实例来源|已接受/)
  })
  it('keeps auditable accepted history across a real child/parent deletion and complete import without resuming the original Run', async () => {
    const s = await setup(), expected = await createTtrpgOpenNormalizationRuntimeReferencePolicyV1(s.normalizationInput)
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: s.state.lastSequence, title: '归一来源切点' })
    const earlier = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: s.review.sourceRef.sequence - 1, title: '尚未接受解释的切点' })
    const unauthorised = await readProductRuntimeState(child.id!)
    await expect(createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ ...s.normalizationInput, runtime: unauthorised.ttrpg!,
      consumerRef: { sessionKey: unauthorised.ttrpg!.sessionKey, sequence: unauthorised.lastSequence + 1 } })).rejects.toThrow()
    for (const row of [child, earlier]) {
      const state = await readProductRuntimeState(row.id!)
      await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(row.id!, 'normalize.policy.child.zero'), viewerKey: s.owner.viewerKey,
        acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: s.state.ttrpg!.authorization!.selectedActorKeys })
    }
    const earlierState = await readProductRuntimeState(earlier.id!)
    await expect(createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ ...s.normalizationInput, runtime: earlierState.ttrpg!,
      consumerRef: { sessionKey: earlierState.ttrpg!.sessionKey, sequence: earlierState.lastSequence + 1 } })).rejects.toThrow()
    await deleteProductRuntimeSession(s.f.sessionId)
    const childState = await readProductRuntimeState(child.id!)
    expect(await createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ ...s.normalizationInput, runtime: childState.ttrpg!,
      consumerRef: { sessionKey: childState.ttrpg!.sessionKey, sequence: childState.lastSequence + 1 } })).toEqual(expected)
    const raw = await readAgentRunArtifactExactV1({ projectId: s.f.scope.projectId, artifactKind: 'raw-response', contentHash: s.generated.candidate.rawResponseHash })
    expect(raw).toContain('已接受的原解释')
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const sessions = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
    let session = sessions[0]
    for (const row of sessions) if ((await readProductRuntimeState(row.id!)).ttrpg!.sessionKey === childState.ttrpg!.sessionKey) session = row
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const source = await verifyProductRuntimeSessionSourceV1({ scope, session, ttrpgProtocol: 2 }), imported = await readProductRuntimeState(session.id!)
    expect(await createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ content: source.runtimePackage.ttrpg!, runtimeSourceHash: session.runtimeSourceHash, runtime: imported.ttrpg!,
      reviewSourceRef: s.review.sourceRef, consumerRef: { sessionKey: imported.ttrpg!.sessionKey, sequence: imported.lastSequence + 1 } })).toEqual(expected)
    expect(await readAgentRunArtifactExactV1({ projectId, artifactKind: 'raw-response', contentHash: s.generated.candidate.rawResponseHash })).toBe(raw)
    const page = await readTtrpgOpenOracleModelDeskV1({ scope, sessionId: session.id!, viewerKey: s.owner.viewerKey })
    expect(page!.request?.local ?? false).toBe(false); expect(page!.request?.canResume ?? false).toBe(false)
  })
  it.each([
    { name: 'pre-instance explanation', file: 'ttrpg-open-pre-instance-normalization-prepared-v2.json.gz', head: '4d30382c97f293ec6c4817ab3a859302a674a4a6' },
    { name: 'existing instance explanation', file: 'ttrpg-open-instance-legacy-normalization-prepared-v2.json.gz', head: '21430dd7733be939469b3eda4a4373705435dd6e' },
  ])('executes the actually captured $name normalization v2 exactly once with unchanged original contract, sources and request bytes', async ({ file, head }) => {
    const legacy = JSON.parse(gunzipSync(readFileSync('tests/fixtures/' + file)).toString())
    expect(legacy.sourceCommit).toBe(head)
    expect(getAgentSkillV1('prose.ttrpg-open-fact-normalize').promptVersion).toBe('ttrpg-open-fact-normalize-v3')
    await db.transaction('rw', db.tables, async () => { for (const [name, rows] of Object.entries(legacy.tables)) if ((rows as unknown[]).length) await db.table(name).bulkAdd(rows as any[]) })
    const original = await readInstanceAgentRunV1(legacy.scope, legacy.runId), state = await readProductRuntimeState(legacy.sessionId)
    expect(original.contract).toEqual(legacy.contract)
    expect(projectFrozenAgentSkillDefinitionV1(original.contract.executionBindings![0]).promptVersion).toBe('ttrpg-open-fact-normalize-v2')
    const call = state.ttrpg!.openRun!.coordination.calls.find(row => row.requestKey === legacy.requestKey)!, request = await readAgentRunArtifactExactV1({
      projectId: legacy.scope.projectId, artifactKind: 'rendered-request', contentHash: call.requestHash })
    expect(JSON.parse(request).messages).toEqual(legacy.messages)
    let sends = 0
    const result = await executeTtrpgOpenFactNormalizationRequestV1({ scope: legacy.scope, sessionId: legacy.sessionId, viewerKey: legacy.viewerKey,
      runId: legacy.runId, requestKey: legacy.requestKey, runAI: async () => { sends++; return JSON.stringify({ facts: [] }) } })
    expect(result.status).toBe('candidate'); expect(sends).toBe(1)
    if (result.status === 'candidate') { expect(result.candidate.interpretation).toBe(legacy.review.interpretation); expect(result.candidate.normalizationOf!.reviewHash).toBe(legacy.review.reviewHash) }
    expect((await readInstanceAgentRunV1(legacy.scope, legacy.runId)).contract).toEqual(original.contract)
    expect(await readAgentRunArtifactExactV1({ projectId: legacy.scope.projectId, artifactKind: 'rendered-request', contentHash: call.requestHash })).toBe(request)
    expect((await readProductRuntimeState(legacy.sessionId)).ttrpg!.openRun!.coordination.calls.at(-1)!.supportSlot!.runtimeReferencePolicy).toBeUndefined()
    expect(await db.agentRuns.count()).toBe(2)
  })
})
