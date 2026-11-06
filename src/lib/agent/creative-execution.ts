import type { ChatResult } from '../ai/client'
import { modelDispatchWasCancelledV1, ModelDispatchGuardRejectedV1 } from '../ai/codex-transport'
import { estimateTokens } from '../ai/context-budget'
import { computeKnownCostUsd } from '../ai/usage-log'
import type { GenerationGateIssue } from '../generation/generation-node'
import type { ChatMessage } from '../types'
import {
  parseCreativeArtifactV1,
  resolveCreativeQualityPolicyV1,
  type CreativeArtifactFragmentV1,
  type CreativeArtifactIssueV1,
  type CreativeArtifactV1,
  type CreativeAssumptionV1,
  type CreativeCallEvidenceV1,
  type CreativeQualityModeV1,
} from './creative-reliability'
import { hashCanonicalValue } from './run/hash'
import type { AgentTeamBudgetTracker } from './team-budget'

export interface CreativeRawModelResultV1 {
  output: string
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  durationMs: number
}

export interface CreativeParseOutcomeV1<TOutput> {
  status: CreativeArtifactV1['status']
  output: TOutput
  editableText: string
  validFragments: CreativeArtifactFragmentV1[]
  rejectedFragments: CreativeArtifactFragmentV1[]
  issues: CreativeArtifactIssueV1[]
  assumptions: CreativeAssumptionV1[]
}

export interface CreativeExecutionResultV1<TOutput> {
  output: TOutput
  draft: string
  artifact: CreativeArtifactV1
}

const MAX_ARTIFACT_TEXT_CHARS = 120_000

export function createCreativeIssueV1(input: {
  code: string
  path: string
  message: string
  severity?: CreativeArtifactIssueV1['severity']
  disposition?: CreativeArtifactIssueV1['disposition']
  action?: CreativeArtifactIssueV1['suggestedAction']
  deterministic?: boolean
}): CreativeArtifactIssueV1 {
  return {
    version: 1,
    code: input.code,
    severity: input.severity ?? 'error',
    disposition: input.disposition ?? 'repairable',
    path: input.path,
    message: input.message,
    suggestedAction: input.action ?? 'repair-once',
    evidenceRefs: [],
    deterministic: input.deterministic ?? true,
  }
}

export async function buildCreativeCallEvidenceV1(input: {
  callIndex: 1 | 2
  purpose: CreativeCallEvidenceV1['purpose']
  messages: readonly ChatMessage[]
  modelIdentity: { provider: string; model: string }
  result?: CreativeRawModelResultV1
  failed?: boolean
}): Promise<CreativeCallEvidenceV1> {
  const estimatedInput = input.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  const estimatedOutput = input.result ? estimateTokens(input.result.output) : null
  const usage = input.result?.usage
  const inputTokens = usage?.inputTokens ?? (input.result ? estimatedInput : null)
  const outputTokens = usage?.outputTokens ?? estimatedOutput
  return {
    version: 1,
    callIndex: input.callIndex,
    purpose: input.purpose,
    status: input.failed ? 'failed' : 'succeeded',
    provider: input.modelIdentity.provider,
    model: input.modelIdentity.model,
    usageSource: usage ? 'provider' : input.result ? 'estimated' : 'unknown',
    inputTokens,
    outputTokens,
    totalTokens: usage?.totalTokens ?? (
      estimatedOutput === null ? null : estimatedInput + estimatedOutput
    ),
    latencyMs: input.result?.durationMs ?? null,
    estimatedCostUsd: inputTokens == null || outputTokens == null
      ? null
      : computeKnownCostUsd(input.modelIdentity.model, inputTokens, outputTokens),
    outputHash: input.result ? await hashCanonicalValue(input.result.output) : null,
  }
}

async function applyHardValidation<TOutput>(input: {
  outcome: CreativeParseOutcomeV1<TOutput>
  validate?: (output: TOutput) => Promise<GenerationGateIssue[]> | GenerationGateIssue[]
  firstAttempt: boolean
}): Promise<CreativeParseOutcomeV1<TOutput>> {
  if (!input.validate || (input.outcome.status !== 'ready' && input.outcome.status !== 'usable-with-warnings')) {
    return input.outcome
  }
  const hardIssues = await input.validate(input.outcome.output)
  if (!hardIssues.length) return input.outcome
  return {
    ...input.outcome,
    status: 'blocked',
    issues: [
      ...input.outcome.issues,
      ...hardIssues.map(issue => createCreativeIssueV1({
        code: issue.code,
        path: '$',
        message: issue.message,
        disposition: 'blocking',
        action: input.firstAttempt ? 'repair-once' : 'replan',
      })),
    ],
  }
}

/**
 * Shared bounded creative execution: one generation and, only for explicitly
 * repairable deterministic issues, one targeted repair. It never starts a
 * hidden third call and always preserves the first artifact if repair fails.
 */
export const CREATIVE_REPAIR_PRE_DISPATCH_CANCELLED_V1 = 'creative-repair-pre-dispatch-cancelled'

export function creativeRepairRefusalIssueV1(
  cause: unknown, status: CreativeArtifactV1['status'], cancelled = false,
): CreativeArtifactIssueV1 {
  return createCreativeIssueV1({
    code: cancelled ? CREATIVE_REPAIR_PRE_DISPATCH_CANCELLED_V1 : 'creative-repair-pre-dispatch-rejected',
    path: '$',
    message: cause instanceof Error ? `未发送定向修复；已保留首次产物。${cause.message}` : '未发送定向修复；已保留首次产物。',
    disposition: status === 'blocked' ? 'blocking' : 'repairable',
    action: 'edit',
  })
}

/** Rejected pre-dispatch work has no call, reservation or provider evidence. */
export async function checkCreativeRepairAdmissionV1(
  assertBeforeModelCall: () => Promise<void>,
  status: CreativeArtifactV1['status'],
): Promise<CreativeArtifactIssueV1 | null> {
  try { await assertBeforeModelCall(); return null }
  catch (cause) { return creativeRepairRefusalIssueV1(cause, status) }
}

export async function runCreativeExecutionV1<TOutput>(input: {
  initialMessages: ChatMessage[]
  runRaw: (messages: ChatMessage[], result?: ChatResult) => Promise<CreativeRawModelResultV1>
  parse: (raw: string) => CreativeParseOutcomeV1<TOutput>
  buildRepairMessages: (raw: string, issues: readonly CreativeArtifactIssueV1[]) => ChatMessage[]
  validate?: (output: TOutput) => Promise<GenerationGateIssue[]> | GenerationGateIssue[]
  budget: AgentTeamBudgetTracker
  callLabel: string
  maxOutputTokens: number
  qualityMode: CreativeQualityModeV1
  modelIdentity: { provider: string; model: string }
  canonEvidenceRefs?: string[]
  assertBeforeModelCall?: () => Promise<void>
}): Promise<CreativeExecutionResultV1<TOutput>> {
  const policy = resolveCreativeQualityPolicyV1(input.qualityMode)
  const dispatchResult = (): ChatResult | undefined => input.assertBeforeModelCall
    ? { beforeModelDispatch: input.assertBeforeModelCall } : undefined
  const runRaw = (messages: ChatMessage[], result?: ChatResult) => result
    ? input.runRaw(messages, result) : input.runRaw(messages)
  // Reserving budget is synchronous. There is no other await between admission
  // and runRaw. An early refusal avoids the reservation; a transport refusal releases it.
  if (input.assertBeforeModelCall) await input.assertBeforeModelCall()
  const firstReservation = input.budget.reserveCall({
    label: input.callLabel,
    messages: input.initialMessages,
    maxOutputTokens: input.maxOutputTokens,
  })
  let first: CreativeRawModelResultV1
  const firstDispatch = dispatchResult()
  try {
    first = await runRaw(input.initialMessages, firstDispatch)
    input.budget.settleCall(firstReservation, first.output)
  } catch (error) {
    if (error instanceof ModelDispatchGuardRejectedV1 || modelDispatchWasCancelledV1(firstDispatch)) input.budget.releaseUnsentCall(firstReservation)
    else input.budget.settleFailedCall(firstReservation)
    throw error
  }

  const calls: CreativeCallEvidenceV1[] = [await buildCreativeCallEvidenceV1({
    callIndex: 1,
    purpose: 'generate',
    messages: input.initialMessages,
    modelIdentity: input.modelIdentity,
    result: first,
  })]
  let outcome = await applyHardValidation({
    outcome: input.parse(first.output),
    validate: input.validate,
    firstAttempt: true,
  })
  let repair: CreativeArtifactV1['repair'] = null
  const repairable = outcome.issues.some(issue => issue.suggestedAction === 'repair-once')
  const shouldRepair = policy.allowAutomaticRepair && repairable
  const notSent = shouldRepair && input.assertBeforeModelCall
    ? await checkCreativeRepairAdmissionV1(input.assertBeforeModelCall, outcome.status) : null
  if (notSent) {
    outcome = { ...outcome, status: outcome.status === 'blocked' ? 'blocked' : 'manual-repair',
      issues: [...outcome.issues, notSent] }
  } else if (shouldRepair) {
    const targetIssues = outcome.issues.filter(issue => issue.suggestedAction === 'repair-once')
    const targetIssueCodes = [...new Set(targetIssues.map(issue => issue.code))]
    const messages = input.buildRepairMessages(first.output, targetIssues)
    const reservation = input.budget.reserveCall({
      label: `${input.callLabel}（定向修复）`,
      messages,
      maxOutputTokens: input.maxOutputTokens,
    })
    let repaired: CreativeRawModelResultV1 | null = null
    let repairRefused = false
    const repairDispatch = dispatchResult()
    try {
      repaired = await runRaw(messages, repairDispatch)
      input.budget.settleCall(reservation, repaired.output)
      calls.push(await buildCreativeCallEvidenceV1({
        callIndex: 2,
        purpose: 'repair',
        messages,
        modelIdentity: input.modelIdentity,
        result: repaired,
      }))
      outcome = await applyHardValidation({
        outcome: input.parse(repaired.output),
        validate: input.validate,
        firstAttempt: false,
      })
    } catch (error) {
      const cancelled = modelDispatchWasCancelledV1(repairDispatch)
      if (error instanceof ModelDispatchGuardRejectedV1 || cancelled) {
        input.budget.releaseUnsentCall(reservation)
        repairRefused = true
        outcome = { ...outcome, status: outcome.status === 'blocked' ? 'blocked' : 'manual-repair',
          issues: [...outcome.issues, creativeRepairRefusalIssueV1(error, outcome.status, cancelled)] }
      } else {
        input.budget.settleFailedCall(reservation)
        calls.push(await buildCreativeCallEvidenceV1({
          callIndex: 2,
          purpose: 'repair',
          messages,
          modelIdentity: input.modelIdentity,
          failed: true,
        }))
        outcome = {
          ...outcome,
          status: outcome.status === 'blocked' ? 'blocked' : 'manual-repair',
          issues: [...outcome.issues, createCreativeIssueV1({
            code: 'creative-repair-provider-failed',
            path: '$',
            message: '唯一一次定向修复调用失败；已停止自动调用并保留首次产物。',
            disposition: outcome.status === 'blocked' ? 'blocking' : 'repairable',
            action: 'edit',
            deterministic: false,
          })],
        }
      }
    }
    if (!repairRefused) repair = {
      version: 1,
      sourceTextHash: await hashCanonicalValue(first.output),
      targetIssueCodes,
      callIndex: 2,
      result: repaired == null
        ? 'failed'
        : outcome.status === 'ready'
          ? 'repaired'
          : outcome.status === 'usable-with-warnings'
            ? 'partial'
            : 'failed',
    }
  }

  const artifact = parseCreativeArtifactV1({
    version: 1,
    policyVersion: 'creative-reliability-v1',
    status: outcome.status,
    qualityMode: input.qualityMode,
    originalText: first.output.slice(0, MAX_ARTIFACT_TEXT_CHARS),
    editableText: outcome.editableText.slice(0, MAX_ARTIFACT_TEXT_CHARS),
    validFragments: outcome.validFragments,
    rejectedFragments: outcome.rejectedFragments,
    issues: outcome.issues,
    assumptions: outcome.assumptions,
    canonEvidenceRefs: input.canonEvidenceRefs ?? [],
    callEvidence: calls,
    repair,
  })
  return { output: outcome.output, draft: outcome.editableText, artifact }
}
