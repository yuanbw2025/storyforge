/** Deterministic session-owned review/export. No model call, new table, world write, or adoption is performed. */
import type { WorkspaceScope } from '../types'
import { readSessionEvents } from '../product/runtime-core'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import { portableWorldReferenceV1 } from '../world-engine/world-reference'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { ttrpgOpenSessionFactsV1, verifyTtrpgOpenFactLedgerV1 } from './open-fact-ledger'
import { verifyTtrpgOpenOracleJournalV1 } from './open-oracle-contract'
import { ttrpgOpenMemoryEventDigestV1 } from './open-memory-event-digest'
import { MAX_TTRPG_WORLD_PATCH_BYTES_V1, parseTtrpgWorldPatchSourceV1, ttrpgWorldPatchConflictsV1, ttrpgWorldPatchFactVisibleV1, verifyTtrpgWorldPatchCandidateV1,
  type TtrpgWorldPatchCandidateV1, type TtrpgWorldPatchEventV1, type TtrpgWorldPatchFactV1 } from './open-world-patch-contract'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'

export interface TtrpgWorldPatchDeskInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string; includePrivate?: boolean; includeGmOnly?: boolean }
async function loadReview(input: TtrpgWorldPatchDeskInputV1) {
  if (input.includePrivate !== undefined && typeof input.includePrivate !== 'boolean' || input.includeGmOnly !== undefined && typeof input.includeGmOnly !== 'boolean') throw new Error('私密内容须通过明确的勾选项选择。')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost) return null
  const { runtime, authorization, content, source } = loaded, run = runtime.openRun!, ancestors = runtime.branchLineage?.ancestors ?? []
  const gmReader = loaded.seat?.role === 'gm' && loaded.seat.controller !== 'ai'
  if (input.includeGmOnly && !gmReader) throw new Error('主持秘密只能由已认领的真人 GM 明确选择导出；房主或 AI 主持的确认者没有此权限。')
  if (authorization.seats.some(seat => !seat.consent.sessionLoggingAllowed)) throw new Error('本桌尚未全部同意保存会话记录，不能整理导出。')
  if (source.source.kind !== 'release') return { loaded, unavailable: '当前是制作预览。请先通过作者审查并发布，从该发布版本开局后再导出世界补丁。' } as const
  const manifest = await verifyProductReleaseManifestV1(loaded.immutable.raw!, { ttrpgProtocol: 2 })
  if (!('confirmedBrief' in manifest.sourceContracts) || manifest.lineage.schema !== 'storyforge.product-release-lineage') throw new Error('当前跑团发布包没有完整的世界来源合同。')
  const contracts = manifest.sourceContracts, lineage = manifest.lineage
  const provenance = content.campaign.designProvenance
  if (!provenance || !('sourcePlanHash' in provenance) || provenance.sourcePlanHash !== contracts.sourcePlan.planHash) throw new Error('战役来源与发布 SourcePlan 不一致。')
  const sourceStamp = parseTtrpgWorldPatchSourceV1({ worldReference: await portableWorldReferenceV1(contracts.sourcePlan.worldReference), packageHash: source.packageHash,
    releaseUid: lineage.releaseUid, releaseVersion: lineage.releaseVersion, releaseIdentityHash: manifest.releaseIdentityHash,
    sourcePlanHash: contracts.sourcePlan.planHash, sourceManifestHash: contracts.sourceManifest.manifestHash, confirmedBriefHash: contracts.confirmedBrief.confirmationHash,
    lineageHash: lineage.lineageHash, buildManifestHash: manifest.productionProvenance.buildManifestHash, productInstanceKey: lineage.productInstanceKey,
    frozenIndexHash: content.campaign.frozenWorldPredicateIndex.indexHash, rulePackContentHash: content.rulePack.contentHash, sourceBundleHash: content.campaign.sourceWorld.bundleHash })
  await verifyTtrpgOpenOracleJournalV1({ receipts: run.oracleReceipts ?? [], rulePack: content.rulePack.content, sessionKey: runtime.sessionKey, seed: loaded.session.seed, ancestors })
  await verifyTtrpgOpenFactLedgerV1({ ledger: run.factLedger, content, runtimeSourceHash: source.runtimeSourceHash, oracleReceipts: run.oracleReceipts ?? [], entityOperations: run.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts })
  const visible = (audience: string, knownBy: readonly string[]) => audience === 'public' || audience === 'party'
    || audience === 'private' && Boolean(input.includePrivate) && (gmReader || Boolean(loaded.seat?.actorKey && knownBy.includes(loaded.seat.actorKey)))
    || audience === 'gm-only' && Boolean(input.includeGmOnly) && gmReader
  const active = new Set(ttrpgOpenSessionFactsV1(run.factLedger).filter(f => !f.retired && ttrpgWorldPatchFactVisibleV1(f, {
    isHumanGm: gmReader, actorKey: loaded.seat?.actorKey ?? null, includePrivate: Boolean(input.includePrivate), includeGmOnly: Boolean(input.includeGmOnly),
  })).map(f => f.factKey))
  const entries = (run.factLedger?.entries ?? []).filter(e => active.has(e.fact.factKey))
  const events = await readSessionEvents(loaded.session), current = new Map(events.map(e => [e.sequence, e]))
  const originalEvent = async (ref: TtrpgOpenSourceRefV1): Promise<TtrpgWorldPatchEventV1> => {
    if (ref.sessionKey === runtime.sessionKey) {
      const event = current.get(ref.sequence)
      if (!event) throw new Error('补丁原事件缺失。')
      return { sourceRef: { ...ref }, type: event.type, payloadHash: (await ttrpgOpenMemoryEventDigestV1(event, runtime.sessionKey)).portablePayloadHash! }
    }
    const ancestor = ancestors.find(a => a.sessionKey === ref.sessionKey), event = ancestor?.events[ref.sequence - 1]
    if (!event || event.sourceRef.sequence !== ref.sequence || ancestor?.runtimeSourceHash !== source.runtimeSourceHash) throw new Error('补丁祖先来源缺失或不属于当前冻结产品。')
    // Fact/Oracle commands have no remappable payload envelope. Legacy ancestor digests remain exact.
    return { sourceRef: { ...ref }, type: event.type, payloadHash: event.portablePayloadHash ?? event.payloadHash }
  }
  const facts: TtrpgWorldPatchFactV1[] = []
  for (const entry of entries) {
    if (entry.sourceRef.sessionKey === runtime.sessionKey) {
      const payload = JSON.parse(current.get(entry.sourceRef.sequence)?.payloadJson ?? 'null')
      if (!payload || ![payload.entry, ...(Array.isArray(payload.entries) ? payload.entries : [])].some(e => e && stable(e) === stable(entry))) throw new Error('补丁事实与原确认事件内容不一致。')
    } else {
      const original = ancestors.find(a => a.sessionKey === entry.sourceRef.sessionKey)?.snapshot.openRun?.factLedger?.entries.find(e => e.fact.factKey === entry.fact.factKey)
      if (!original || stable(original) !== stable(entry)) throw new Error('补丁事实与原祖先确认内容不一致。')
    }
    facts.push({ entry: structuredClone(entry), entryHash: await hash(entry), confirmationEvent: await originalEvent(entry.sourceRef), oracleEvent: await originalEvent(entry.oracleSourceRef) })
  }
  const frozenComparisons = content.campaign.frozenWorldPredicateIndex.entries.filter(f => visible(f.audience, f.knownByActorKeys)).map(f => structuredClone(f))
  const eventDigests = await Promise.all(events.map(e => ttrpgOpenMemoryEventDigestV1(e, runtime.sessionKey)))
  const cutpoint = { sessionKey: runtime.sessionKey, throughSequence: loaded.state.lastSequence, stateHash: loaded.stateHash,
    eventPrefixHash: await hash(eventDigests.map(({ sourceRef, type, portablePayloadHash }) => ({ sourceRef, type, portablePayloadHash }))),
    ancestors: ancestors.map(a => ({ sessionKey: a.sessionKey, throughSequence: a.throughSequence, evidenceHash: a.evidenceHash })) }
  const body = { source: sourceStamp, cutpoint, includePrivate: Boolean(input.includePrivate), includeGmOnly: Boolean(input.includeGmOnly), facts, frozenComparisons }
  const reviewBasisHash = await hash({ ...body, viewerKey: input.viewerKey })
  await loaded.assertCurrent()
  return { loaded, unavailable: null, body, reviewBasisHash, canIncludeGmOnly: gmReader,
    conflicts: ttrpgWorldPatchConflictsV1(facts, frozenComparisons) } as const
}
export async function readTtrpgWorldPatchDeskV1(input: TtrpgWorldPatchDeskInputV1) {
  const review = await loadReview(input)
  if (!review) return null
  if (review.unavailable !== null) { await review.loaded.assertCurrent(); return { unavailable: review.unavailable, canExport: false as const } }
  return { unavailable: null, canExport: true as const, reviewBasisHash: review.reviewBasisHash, source: review.body.source, cutpoint: review.body.cutpoint,
    includePrivate: review.body.includePrivate, includeGmOnly: review.body.includeGmOnly, canIncludeGmOnly: review.canIncludeGmOnly,
    facts: review.body.facts.map(f => ({ fact: f.entry.fact, sourceRef: f.entry.sourceRef, oracleSourceRef: f.entry.oracleSourceRef, entryHash: f.entryHash })), conflicts: review.conflicts }
}
export async function buildTtrpgWorldPatchCandidateV1(input: TtrpgWorldPatchDeskInputV1 & { reviewBasisHash: string; selectedFactKeys: string[]; exportedAt?: number }): Promise<TtrpgWorldPatchCandidateV1> {
  const review = await loadReview(input)
  if (!review || review.unavailable !== null) throw new Error(review?.unavailable ?? '只有当前真人主持可以整理本局补丁。')
  if (review.reviewBasisHash !== input.reviewBasisHash) throw new Error('审阅期间团局进度、来源、身份或可见范围已变化，请重新读取并选择。')
  if (!Array.isArray(input.selectedFactKeys) || !input.selectedFactKeys.length || new Set(input.selectedFactKeys).size !== input.selectedFactKeys.length) throw new Error('请明确选择至少一条、互不重复的已确认事实。')
  const selected = new Set(input.selectedFactKeys), allowed = new Set(review.body.facts.map(f => f.entry.fact.factKey))
  if ([...selected].some(key => !allowed.has(key))) throw new Error('所选事实已退休、不属于本桌或未获得相应读取权限。')
  const facts = review.body.facts.filter(f => selected.has(f.entry.fact.factKey))
  const body: Omit<TtrpgWorldPatchCandidateV1, 'reviewHash'> = { schema: 'storyforge.ttrpg-world-patch-review', version: 1, purpose: 'author-review-only',
    ...review.body, facts, decisions: review.body.facts.map(f => ({ factKey: f.entry.fact.factKey, decision: selected.has(f.entry.fact.factKey) ? 'selected-for-review' : 'pending' })),
    conflicts: ttrpgWorldPatchConflictsV1(facts, review.body.frozenComparisons), exportedAt: input.exportedAt ?? Date.now() }
  const result = await verifyTtrpgWorldPatchCandidateV1({ ...body, reviewHash: await hash(body) }, review.body.source)
  await review.loaded.assertCurrent()
  return result
}
export async function exportTtrpgWorldPatchCandidateV1(input: Parameters<typeof buildTtrpgWorldPatchCandidateV1>[0]) {
  const candidate = await buildTtrpgWorldPatchCandidateV1(input)
  const content = JSON.stringify(candidate, null, 2)
  if (new TextEncoder().encode(content).byteLength > MAX_TTRPG_WORLD_PATCH_BYTES_V1) throw new Error('补丁超过 32 MB，请减少本次选择后分份导出；原事实与待审记录保持原样。')
  return { candidate, filename: `StoryForge-跑团世界补丁-待作者审阅-${candidate.reviewHash.slice(0, 12)}.json`, content }
}
