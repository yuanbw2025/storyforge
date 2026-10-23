import type { ProductBuildRecordV1, WorkspaceScope } from '../types'
import { readAgentRunV1 } from '../agent/run/event-store'
import { isSha256Hash } from './hash'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

/**
 * Older orphan reconciliation omitted failureProvenance from the Build while
 * retaining the failed child Run and its append-only unknown-usage reservation.
 * Recover only that exact witness; a failure label alone grants no authority.
 * This reader never changes the ledger, Run events, or the interrupted result.
 */
export async function readVerifiedOrphanRecoveryProvenanceV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  taskKey: string
  failure: Record<string, unknown>
}): Promise<Record<string, unknown> | null> {
  const { build, failure, taskKey } = input
  if (failure.code !== 'provider-result-unknown' || failure.taskKey !== taskKey
    || !Number.isSafeInteger(failure.attempt) || Number(failure.attempt) < 1) return null
  let ledger: Record<string, unknown>
  try { ledger = record(JSON.parse(build.budgetLedgerJson)) } catch { return null }
  if (ledger.schema !== 'storyforge.product-production-budget-ledger'
    || ledger.version !== 2 || !Array.isArray(ledger.attempts)) return null
  const entry = record(record(ledger.tasks)[taskKey])
  if (entry.status !== 'failed' || entry.errorCode !== failure.code
    || entry.attempt !== failure.attempt || entry.usage !== null
    || entry.candidateHash !== null || entry.terminalReceiptHash !== null
    || !Number.isSafeInteger(entry.runId) || Number(entry.runId) < 1
    || !Number.isSafeInteger(ledger.rootRunId) || Number(ledger.rootRunId) < 1
    || !isSha256Hash(entry.idempotencyKey)) return null
  const attempts = ledger.attempts.map(record).filter(attempt => (
    attempt.taskKey === taskKey && attempt.controlEpoch === build.controlEpoch
  ))
  // Never choose one of several possible failed attempts by recency or order.
  if (attempts.length !== 1) return null
  const attempt = attempts[0]!
  if (attempt.runId !== entry.runId || attempt.attempt !== entry.attempt
    || attempt.idempotencyKey !== entry.idempotencyKey || attempt.outcome !== 'failed'
    || attempt.errorCode !== failure.code || attempt.usageKnown !== false
    || !attempt.usage || typeof attempt.usage !== 'object' || Array.isArray(attempt.usage)) return null

  const snapshot = await readAgentRunV1(input.scope, Number(entry.runId))
  const root = await readAgentRunV1(input.scope, Number(ledger.rootRunId))
  const boundary = snapshot.contract.scope.productProduction
  const rootBoundary = root.contract.scope.productProduction
  const step = snapshot.projection.steps[taskKey]
  if (snapshot.run.status !== 'failed' || snapshot.run.productBuildId !== build.id
    || snapshot.run.parentRunId !== root.run.id || snapshot.run.parentRelation !== `task:${taskKey}`
    || root.run.productBuildId !== build.id || rootBoundary?.taskKey !== '$root'
    || boundary?.taskKey !== taskKey || step?.status !== 'failed' || step.attempt !== failure.attempt
    || [boundary, rootBoundary].some(value => (
      value?.productBuildId !== build.id || value.buildNumber !== build.buildNumber
      || value.controlEpoch !== build.controlEpoch || value.planHash !== build.planHash
    ))) return null
  const requested = snapshot.events.find(event => event.type === 'model.requested'
    && event.payload.stepId === taskKey && event.payload.attempt === failure.attempt)
  const failed = snapshot.events.find(event => event.type === 'step.failed'
    && event.payload.stepId === taskKey && event.payload.attempt === failure.attempt
    && event.payload.code === failure.code && event.payload.retryable === false)
  if (!requested || !failed || failed.sequence <= requested.sequence
    || !snapshot.events.some(event => event.type === 'run.failed' && event.payload.code === failure.code)
    || snapshot.events.some(event => (event.type === 'model.responded' || event.type === 'candidate.persisted')
      && event.payload.stepId === taskKey && event.payload.attempt === failure.attempt)) return null
  return {
    runId: snapshot.run.id,
    rootRunId: root.run.id,
    controlEpoch: boundary.controlEpoch,
    planHash: boundary.planHash,
    attempt: step.attempt,
  }
}
