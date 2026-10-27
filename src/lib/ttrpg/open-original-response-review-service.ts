/** Normal author controls for the existing retained-original and author-edit contracts. */
import type { WorkspaceScope, ProductProductionBlockerResolutionV1 } from '../types'
import { readProductProductionDetailsV1, readProductProductionProgressV1,
  type ProductProductionDetailsV1 } from '../product-production/service'
import { readProductProductionCapturedResponseForAuthorV1 } from '../product-production/local-response-capture'
import { executeProductProductionCommand } from '../product-production/commands'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/production-executor'
import { inspectProductProductionBuildRecoveryPolicyV1 } from '../product-production/recovery-policy'
import { normalizeTtrpgOpenSourceFactsForReviewV1, normalizeTtrpgOpenRuleSystemForReviewV1 } from './open-production-review'

export interface TtrpgOpenOriginalResponseOwnerV1 {
  scope: WorkspaceScope; productionId: number; buildId: number; controlEpoch: number; planHash: string
  taskKey: string; runId: number; attempt: number
}
export type TtrpgOpenOriginalResponseRefV1 = NonNullable<ProductProductionBlockerResolutionV1['originalResponseSource']>
export interface TtrpgOpenOriginalBookingSummaryV1 {
  captureRunId: number; captureReceiptHash: string; blocked: boolean; blockers: string[]
}
/** Presentation only. Every command and draft loader independently verifies the underlying proof. */
export function ttrpgOpenOriginalBookingSummaryV1(details: ProductProductionDetailsV1, owner: TtrpgOpenOriginalResponseOwnerV1): TtrpgOpenOriginalBookingSummaryV1 | null {
  try {
    const failure = JSON.parse(details.build?.failureJson ?? '{}'), value = failure.originalResponseBooking, provenance = failure.failureProvenance
    if (details.production.id !== owner.productionId || details.build?.id !== owner.buildId
      || details.build.controlEpoch !== owner.controlEpoch || details.build.planHash !== owner.planHash
      || failure.taskKey !== owner.taskKey || provenance?.runId !== owner.runId || provenance.attempt !== owner.attempt
      || value?.schema !== 'storyforge.product-production-original-response-booking' || value.version !== 1 || value.portable !== false
      || value.originalRunId !== owner.runId || value.originalAttempt !== owner.attempt
      || value.controlEpoch !== owner.controlEpoch || value.planHash !== owner.planHash || value.taskKey !== owner.taskKey
      || !Number.isSafeInteger(value.captureRunId) || value.captureRunId < 1 || !isSha256Hash(value.captureReceiptHash)
      || typeof value.blocked !== 'boolean' || !Array.isArray(value.blockers) || value.blockers.some((item: unknown) => typeof item !== 'string')) return null
    return { captureRunId: value.captureRunId, captureReceiptHash: value.captureReceiptHash, blocked: value.blocked, blockers: value.blockers }
  } catch { return null }
}
async function current(owner: TtrpgOpenOriginalResponseOwnerV1) {
  const details = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['ttrpg']), build = details.build
  const failure = JSON.parse(build?.failureJson ?? '{}'), provenance = failure.failureProvenance
  if (!build || build.id !== owner.buildId || build.status !== 'recovery-required' || details.production.status !== 'producing'
    || details.production.controlEpoch !== owner.controlEpoch || build.controlEpoch !== owner.controlEpoch || build.planHash !== owner.planHash
    || failure.taskKey !== owner.taskKey || provenance?.runId !== owner.runId || provenance.attempt !== owner.attempt
    || provenance.controlEpoch !== owner.controlEpoch || provenance.planHash !== owner.planHash
    || !inspectProductProductionBuildRecoveryPolicyV1({ productType: 'ttrpg', planJson: build.planJson, taskKey: owner.taskKey }).authorDraftAllowed) {
    throw new Error('原回答已不属于当前作品或失败尝试，请刷新制作状态。')
  }
  const row = details.briefHistory.find(item => item.revision === build.briefRevision)
  if (!row || row.briefHash !== build.briefHash) throw new Error('原授权方案版本不一致。')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (!brief.ttrpgOpen || await hashProductProductionValueV2(brief) !== build.briefHash) throw new Error('原跑团方案正文不一致。')
  return { details, build, brief: brief.ttrpgOpen }
}

export async function bookTtrpgOpenOriginalResponseV1(input: { owner: TtrpgOpenOriginalResponseOwnerV1; source: TtrpgOpenOriginalResponseRefV1
  expectedStateRevision: number; disposition: 'use-native-token-usage' | 'charge-reservation-upper-bound' }) {
  const { owner } = input, before = await current(owner)
  const receipt = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'book-original-response', commandId: `original-response.book.${crypto.randomUUID()}`,
      expectedStateRevision: input.expectedStateRevision, buildNumber: before.build.buildNumber,
      controlEpoch: owner.controlEpoch, planHash: owner.planHash, taskKey: owner.taskKey,
      originalRunId: owner.runId, originalAttempt: owner.attempt, captureRunId: input.source.captureRunId,
      captureReceiptHash: input.source.captureReceiptHash, disposition: input.disposition } })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '原用量核对失败'))
  const after = await current(owner), progress = await readProductProductionProgressV1({ scope: owner.scope, productionId: owner.productionId })
  if (after.details.production.stateRevision !== receipt.stateRevision || progress.buildId !== owner.buildId
    || progress.controlEpoch !== owner.controlEpoch || progress.planHash !== owner.planHash) {
    throw new Error('原用量已提交，但作品状态随后变化；请刷新，系统不会重新生成。')
  }
  return { details: after.details, progress, booking: ttrpgOpenOriginalBookingSummaryV1(after.details, owner)! }
}

/** Only fills the existing transient author JSON. No command, accounting, inference or adoption. */
export async function readTtrpgOpenOriginalResponseDraftV1(input: { owner: TtrpgOpenOriginalResponseOwnerV1
  source: TtrpgOpenOriginalResponseRefV1; existingDraft: string }) {
  const before = await current(input.owner), booking = ttrpgOpenOriginalBookingSummaryV1(before.details, input.owner)
  if (!booking || booking.blocked || booking.captureRunId !== input.source.captureRunId
    || booking.captureReceiptHash !== input.source.captureReceiptHash) throw new Error('请先核对这份完整原回答的用量；旧授权不足时不能继续。')
  const proof = await readProductProductionCapturedResponseForAuthorV1({ ...input.owner, ...input.source })
  let authorDraftJson = input.existingDraft
  if (authorDraftJson.trim()) parseProductionModelJsonObjectV1(authorDraftJson, input.owner.taskKey)
  else {
    const value = parseProductionModelJsonObjectV1(proof.text, input.owner.taskKey)
    const draft = input.owner.taskKey === 'ttrpg.open.source-facts' ? normalizeTtrpgOpenSourceFactsForReviewV1(value, before.brief)
      : input.owner.taskKey === 'ttrpg.open.rule-system' ? normalizeTtrpgOpenRuleSystemForReviewV1(value, before.brief) : value
    authorDraftJson = JSON.stringify(draft)
  }
  if (authorDraftJson.length > 120_000) throw new Error('完整修订稿超过长度上限；原回答仍保留，不会自动截断。')
  const after = await current(input.owner)
  if (before.details.production.stateRevision !== after.details.production.stateRevision) throw new Error('读取期间作者状态已变化，请重新核对。')
  return { authorDraftJson, originalResponseSource: input.source }
}
