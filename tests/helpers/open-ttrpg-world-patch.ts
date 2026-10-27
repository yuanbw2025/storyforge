/** Real immutable world/production/release chain with explicit simulated model transport, never a real-provider receipt. */
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from './open-ttrpg-production-browser'
import { publishProductProductionV1 } from '../../src/lib/product-production/service'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { configureOpenSeatsV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1, startTtrpgOpenEpochV1, consultTtrpgOracleV1,
  commitTtrpgOpenOracleFactV1, retireTtrpgOpenSessionFactV1, recordTtrpgOpenNarrativeMemoryV1 } from '../../src/lib/ttrpg/runtime-commands'
import { hashTtrpgOpenOracleFactCandidateV1, type TtrpgOpenOracleFactProposalV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

export async function seedTtrpgWorldPatchReviewV1() {
  const production = await seedOpenBrowserProductionV1({ humanGm: true, runtimeAIEnabled: true })
  await runOpenBrowserProductionV1(production); await runOpenBrowserProductionV1(production, true); await runOpenBrowserProductionV1(production, true)
  const published = await publishProductProductionV1(production)
  const session = await createProductRuntimeInstanceFromSource({ scope: production.scope, source: { kind: 'release', productReleaseId: published.receipt.productReleaseId }, title: '世界补丁审阅测试', seed: 'world.patch.seed' })
  const sessionId = session.id!, viewerKey = 'viewer.gm', host = { scope: production.scope, sessionId, viewerKey }
  await configureOpenSeatsV1(sessionId)
  let state = await readProductRuntimeState(sessionId)
  await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(sessionId, 'patch.zero'), viewerKey, acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
  await startTtrpgOpenRunV1({ ...await openEnvelopeV1(sessionId, 'patch.start'), viewerKey })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'patch.epoch'), viewerKey, triggerKind: 'continue-host', rawInput: '核对本次调查的事实' })
  await consultTtrpgOracleV1({ ...await openEnvelopeV1(sessionId, 'patch.oracle'), viewerKey, askedBy: 'gm', oracleKey: 'oracle.yes', question: '守灯人能提供帮助吗？', likelihoodTierKey: 'even' })
  state = await readProductRuntimeState(sessionId)
  const oracleSourceRef = state.ttrpg!.openRun!.oracleReceipts![0].sourceRef
  const facts: TtrpgOpenOracleFactProposalV1[] = [
    { kind: 'relation', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true, detail: '守灯人知道港口情况。', sourceFactRefs: ['fact.harbor'], audience: 'party', knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null },
    { kind: 'relation', subjectRef: 'keeper', predicateKey: 'promised', objectRef: 'harbor', canonicalValue: '公开协助', detail: '待审的协助承诺。', sourceFactRefs: ['fact.harbor'], audience: 'party', knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null },
    { kind: 'relation', subjectRef: 'keeper', predicateKey: 'promised', objectRef: 'hero', canonicalValue: '私下协助', detail: 'PRIVATE-PATCH-REQUIRES-CHOICE', sourceFactRefs: ['fact.harbor'], audience: 'private', knownByActorKeys: ['hero'], supersedes: null, supersedeReason: null },
    { kind: 'relation', subjectRef: 'keeper', predicateKey: 'promised', objectRef: 'keeper', canonicalValue: '主持知情', detail: 'GM-PATCH-REQUIRES-CHOICE', sourceFactRefs: ['fact.harbor'], audience: 'gm-only', knownByActorKeys: [], supersedes: null, supersedeReason: null },
    { kind: 'relation', subjectRef: 'keeper', predicateKey: 'promised', objectRef: 'companion.1', canonicalValue: '撤回', detail: 'RETIRED-PATCH-EXCLUDED', sourceFactRefs: ['fact.harbor'], audience: 'party', knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null },
  ]
  for (const [index, proposal] of facts.entries()) {
    const envelope = await openEnvelopeV1(sessionId, `patch.fact.${index}`)
    await commitTtrpgOpenOracleFactV1({ ...envelope, viewerKey, oracleSourceRef, proposal,
      candidateHash: await hashTtrpgOpenOracleFactCandidateV1({ proposal, oracleSourceRef, runtimeSourceHash: session.runtimeSourceHash, viewerKey, baseStateHash: envelope.baseStateHash }) })
  }
  const entries = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.factLedger!.entries
  await retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(sessionId, 'patch.retire'), viewerKey, factKey: entries[4].fact.factKey, reason: '保留原始记录，明确退休' })
  const e = await openEnvelopeV1(sessionId, 'patch.memory')
  await recordTtrpgOpenNarrativeMemoryV1({ ...e, viewerKey, draft: { revisionKey: 'patch.belief', observerKey: 'gm', reliability: 'belief', audience: 'gm-only', knownBy: [], summary: 'BELIEF-MEMORY-MUST-NOT-BECOME-FACT', fromEventSequence: 1, toEventSequence: e.baseSequence } })
  return { ...production, host, session, entries, published, other: { ...host, viewerKey: OPEN_HUMAN_VIEWER } }
}
