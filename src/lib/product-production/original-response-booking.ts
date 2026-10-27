/** Verify retained original bytes before atomic bookkeeping. No transport, inference, adoption or epoch advance. */
import { db } from '../db/schema'
import type { WorkspaceScope, ProductProductionCommandV1, ProductProductionRecordV1, ProductBuildRecordV1,
  AgentRunRecord, AgentRunArtifactRecordV1, ProductBuildArtifactRecordV1 } from '../types'
import { readProductProductionDetailsV1 } from './service'
import { parseProductProductionBriefV3 } from './contracts'
import { parseProductProductionPlanV3 } from './plan'
import { hashProductProductionValueV2, canonicalProductProductionJsonV2 } from './hash'
import { readProductProductionCapturedResponseForAuthorV1 } from './local-response-capture'
import { readAgentRunV1 } from '../agent/run/event-store'
import { assertProductProductionBudgetLedgerV1, bookProductProductionOriginalUsageLedgerV1,
  inspectProductProductionOriginalBookingBudgetV1 } from './scheduler'

type Command = Extract<ProductProductionCommandV1, { type: 'book-original-response' }>
export interface PreparedOriginalResponseBookingV1 {
  production: ProductProductionRecordV1
  build: ProductBuildRecordV1 & { id: number }
  runs: AgentRunRecord[]
  artifacts: AgentRunArtifactRecordV1[]
  productArtifacts: ProductBuildArtifactRecordV1[]
  budgetLedgerJson: string
  booking: Record<string, unknown> & { blocked: boolean }
  alreadyBooked: boolean
}
function fail(message: string): never { throw Error(`[original-response-booking] ${message}`) }
const equal = (a: unknown, b: unknown) => a != null && b != null
  && canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

export async function prepareProductProductionOriginalResponseBookingV1(input: {
  scope: WorkspaceScope; productionId: number; command: Command; now: number
}): Promise<PreparedOriginalResponseBookingV1> {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['ttrpg'])
  const { production, build } = details, command = input.command
  if (!build?.id || build.status !== 'recovery-required' || production.status !== 'producing'
    || production.stateRevision !== command.expectedStateRevision || production.controlEpoch !== command.controlEpoch
    || build.buildNumber !== command.buildNumber || build.controlEpoch !== command.controlEpoch
    || build.planHash !== command.planHash) fail('当前作品、Build、版本或恢复阶段已变化')
  const row = details.briefHistory.find(item => item.revision === build.briefRevision)
  if (!row || row.briefHash !== build.briefHash) fail('原授权 Brief 版本不一致')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (!brief.ttrpgOpen || brief.intent.productType !== 'ttrpg' || await hashProductProductionValueV2(brief) !== build.briefHash) fail('原跑团授权内容不一致')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  if (await hashProductProductionValueV2(plan) !== build.planHash) fail('原冻结 Plan 不一致')
  const proof = await readProductProductionCapturedResponseForAuthorV1({ scope: input.scope, productionId: input.productionId,
    buildId: build.id, runId: command.originalRunId, taskKey: command.taskKey, attempt: command.originalAttempt,
    captureRunId: command.captureRunId, captureReceiptHash: command.captureReceiptHash })
  const original = await readAgentRunV1(input.scope, command.originalRunId)
  const captured = await readAgentRunV1(input.scope, command.captureRunId)
  const started = original.events.find(event => event.type === 'step.started' && event.payload.stepId === command.taskKey
    && event.payload.attempt === command.originalAttempt)
  const terminal = [...original.events].reverse().find(event => event.type === 'run.failed' || event.type === 'run.cancelled')
  const observedDurationMs = started && terminal && terminal.createdAt >= started.createdAt
    ? terminal.createdAt - started.createdAt : null
  if (command.disposition === 'use-native-token-usage' && observedDurationMs === null) fail('原任务观测时长无法核对，请明确按原预留上限暂记')
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const currentLedger = JSON.parse(build.budgetLedgerJson)
  const attempt = currentLedger.attempts.find((item: { runId: number; attempt: number; controlEpoch: number; taskKey: string }) =>
    item.runId === command.originalRunId && item.attempt === command.originalAttempt
      && item.controlEpoch === command.controlEpoch && item.taskKey === command.taskKey)
  if (!attempt) fail('原付费尝试缺少准确账本归属')
  const productArtifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id).toArray())
    .filter(artifact => artifact.producerRunId === command.originalRunId)
  if (!attempt.usageKnown && productArtifacts.length) fail('原任务已有产品工件，不能把未核对的产物存储记为零')
  const settled = bookProductProductionOriginalUsageLedgerV1({ budgetLedgerJson: build.budgetLedgerJson,
    taskKey: command.taskKey, runId: command.originalRunId, attempt: command.originalAttempt, controlEpoch: command.controlEpoch,
    disposition: command.disposition, nativeUsage: proof.usage ?? null, observedDurationMs: observedDurationMs ?? 0 })
  const budget = inspectProductProductionOriginalBookingBudgetV1({ budgetLedgerJson: settled.budgetLedgerJson,
    brief, plan, taskKey: command.taskKey, controlEpoch: command.controlEpoch })
  const failure = JSON.parse(build.failureJson), prior = failure.originalResponseBooking
  if (prior && (prior.schema !== 'storyforge.product-production-original-response-booking'
    || prior.version !== 1 || prior.portable !== false || prior.captureRunId !== command.captureRunId
    || prior.captureReceiptHash !== command.captureReceiptHash || prior.rawResponseHash !== proof.rawResponseHash
    || prior.effectiveDisposition !== settled.effectiveDisposition || !equal(prior.usage, settled.usage))) {
    fail('当前失败任务已经关联另一项保留证明；不能覆盖')
  }
  const booking = {
    schema: 'storyforge.product-production-original-response-booking', version: 1, portable: false,
    commandId: prior?.commandId ?? command.commandId, bookedAt: prior?.bookedAt ?? input.now,
    captureRunId: command.captureRunId, captureReceiptHash: command.captureReceiptHash,
    originalRunId: command.originalRunId, originalAttempt: command.originalAttempt, taskKey: command.taskKey,
    controlEpoch: command.controlEpoch, planHash: command.planHash, rawResponseHash: proof.rawResponseHash,
    effectiveDisposition: settled.effectiveDisposition, usage: settled.usage,
    previousReservation: prior?.previousReservation ?? { usage: attempt.usage, usageKnown: attempt.usageKnown,
      resolution: attempt.resolution ?? null }, observedPhysicalRequests: settled.observedPhysicalRequests,
    accountingBasis: prior?.accountingBasis ?? (settled.effectiveDisposition === 'provider-actual-charge'
      ? { tokens: 'verified-complete-original-receipt', duration: 'original-observed-step-span',
        productStorage: attempt.usageKnown ? 'previous-recorded-usage' : 'no-original-product-artifact', costUsd: 'not-reported' }
      : { tokens: 'author-reservation-upper-bound', duration: 'author-reservation-upper-bound',
        productStorage: 'author-reservation-upper-bound', costUsd: 'original-reservation-policy' }),
    ...budget, candidateCreated: false, adopted: false, newModelCalls: 0,
  }
  const artifactKeys = new Map<string, { kind: AgentRunArtifactRecordV1['artifactKind']; hash: string }>()
  for (const snapshot of [original, captured]) for (const event of snapshot.events) {
    if (event.type === 'evidence.artifact.recorded') artifactKeys.set(event.payload.artifactKind + ':' + event.payload.contentHash,
      { kind: event.payload.artifactKind, hash: event.payload.contentHash })
  }
  const artifacts: AgentRunArtifactRecordV1[] = []
  for (const { kind, hash } of artifactKeys.values()) {
    const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([input.scope.projectId, kind, hash]).first()
    if (!artifact || artifact.retentionState !== 'available' || artifact.content == null) fail('原回答或来源证据不可用')
    artifacts.push(artifact)
  }
  return { production, build: build as ProductBuildRecordV1 & { id: number },
    runs: [original.run, captured.run], artifacts, productArtifacts, budgetLedgerJson: settled.budgetLedgerJson,
    booking, alreadyBooked: !!prior && equal(prior, booking) && build.budgetLedgerJson === settled.budgetLedgerJson }
}

/** Rechecked inside the existing all-owner command transaction; no network/WebCrypto here. */
export async function assertProductProductionOriginalBookingCurrentV1(prepared: PreparedOriginalResponseBookingV1,
  production: ProductProductionRecordV1, build: ProductBuildRecordV1) {
  if (!equal(prepared.production, production) || !equal(prepared.build, build)) fail('核对期间作品或账本已变化')
  const productArtifacts = (await db.productBuildArtifacts.where('buildId').equals(prepared.build.id).toArray())
    .filter(artifact => artifact.producerRunId === prepared.booking.originalRunId)
  if (!equal(productArtifacts, prepared.productArtifacts)) fail('核对期间原任务的产品工件已变化')
  for (const before of prepared.runs) if (!equal(await db.agentRuns.get(before.id!), before)) fail('核对期间原 Run 或保留证明已变化')
  for (const before of prepared.artifacts) if (!equal(await db.agentRunArtifacts.get(before.id!), before)) fail('核对期间原文或来源证据已变化')
}
