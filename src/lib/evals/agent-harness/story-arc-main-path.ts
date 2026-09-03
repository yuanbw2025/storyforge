import type { AIConfig, ChatMessage } from '../../types'
import { hashCanonicalValue } from '../../agent/run/hash'
import { computeCostUsd } from '../../ai/usage-log'
import {
  H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1,
  H86_STORY_ARC_FIXTURE_SET_VERSION_V1,
  type H86StoryArcFixtureV1,
} from './story-arc-main-path-fixtures'

export const H86_STORY_ARC_CHECKPOINT_VERSION_V1 = 1 as const
export const H86_STORY_ARC_STORAGE_KEY_V1 = 'storyforge:h86-story-arc-main-path-v1'
export const H86_BASELINE_PROMPT_VERSION_V1 = 'story-arc-baseline-direct-b6b57f4-parent-v1'
export const H86_AGENT_PROMPT_VERSION_V1 = 'outline.story-arcs-v4'
const H86_AGENT_PROMPT_VERSIONS_V1 = [
  'outline.story-arcs-current-v1',
  'outline.story-arcs-v2',
  'outline.story-arcs-v3',
  H86_AGENT_PROMPT_VERSION_V1,
] as const
export const H86_GENERATOR_PAIR_VERSION_V1 = 'story-arc-baseline-vs-agent-harness-v1'
export const H86_VERIFIER_PROMPT_VERSION_V1 = 'story-arc-independent-verifier-v1'

export const H86_STORY_ARC_VARIANTS_V1 = ['baseline-direct', 'agent-harness'] as const
export type H86StoryArcVariantV1 = typeof H86_STORY_ARC_VARIANTS_V1[number]

export interface H86ModelIdentityV1 {
  provider: AIConfig['provider']
  model: string
  promptVersion: string
}

export interface H86UsageV1 {
  inputTokens: number
  outputTokens: number
  durationMs: number
  costUsd: number
}

export interface H86CallEvidenceV1 {
  stage: 'generation' | 'verification'
  variant: H86StoryArcVariantV1
  provider: AIConfig['provider']
  model: string
  promptVersion: string
  inputHash: string
  outputHash: string | null
  usage: H86UsageV1 | null
  status: 'succeeded' | 'provider-failed' | 'protocol-failed'
  failureCode?: string
  failureMessage?: string
  traceHash: string
}

export interface H86DurableEvidenceV1 {
  runEvidenceHash: string
  candidateHash: string
  contextSources: string[]
  projectionState: string
  modelCalls: number
  candidatePersisted: boolean
}

export interface H86GenerationAttemptV1 {
  attempt: number
  status: 'succeeded' | 'provider-failed' | 'protocol-failed'
  output: string
  outputHash: string | null
  parserPassed: boolean
  calls: H86CallEvidenceV1[]
  durableEvidence?: H86DurableEvidenceV1
  failureCode?: string
  failureMessage?: string
}

export interface H86VerifierAssessmentV1 {
  semanticScore: number
  causalCoherence: number
  specificity: number
  matchedRequiredFactIds: string[]
  missingRequiredFactIds: string[]
  futureLeakage: boolean
  wrongWorldLeakage: boolean
}

export interface H86VerificationAttemptV1 {
  attempt: number
  status: 'succeeded' | 'provider-failed' | 'protocol-failed'
  assessment: H86VerifierAssessmentV1 | null
  calls: H86CallEvidenceV1[]
  failureCode?: string
  failureMessage?: string
}

export interface H86VariantStateV1 {
  generationAttempts: H86GenerationAttemptV1[]
  verificationAttempts: H86VerificationAttemptV1[]
}

export interface H86CaseStateV1 {
  fixtureId: string
  executionOrder: [H86StoryArcVariantV1, H86StoryArcVariantV1]
  variants: Record<H86StoryArcVariantV1, H86VariantStateV1>
}

export interface H86VariantAggregateV1 {
  caseCount: number
  completionRate: number
  parserPassRate: number
  verifierCompletionRate: number
  semanticScore: number
  causalCoherence: number
  specificity: number
  requiredFactCoverage: number
  futureLeakageRate: number
  wrongWorldLeakageRate: number
  durableEvidenceCoverage: number
  inputTokens: number
  outputTokens: number
  totalLatencyMs: number
  p95LatencyMs: number
  costUsd: number
  meteredCalls: number
  totalCalls: number
}

export interface H86AggregateV1 {
  baselineDirect: H86VariantAggregateV1
  agentHarness: H86VariantAggregateV1
  comparison: {
    semanticRegression: number
    factCoverageRegression: number
    p95LatencyRatio: number | null
    tokenMultiplier: number | null
    costMultiplier: number | null
  }
}

export type H86MachineGateFailureV1 =
  | 'minimum-paired-cases'
  | 'baseline-completion'
  | 'agent-harness-completion'
  | 'agent-harness-durable-evidence'
  | 'semantic-quality-noninferiority'
  | 'required-fact-noninferiority'
  | 'future-leakage'
  | 'wrong-world-leakage'
  | 'usage-evidence-missing'
  | 'p95-latency-budget'
  | 'token-budget'
  | 'cost-budget'

export interface H86MachineGateV1 {
  passed: boolean
  failures: H86MachineGateFailureV1[]
  humanReviewRequired: true
}

export interface H86CheckpointV1 {
  version: typeof H86_STORY_ARC_CHECKPOINT_VERSION_V1
  runId: string
  codeRevision: string
  fixtureSetVersion: typeof H86_STORY_ARC_FIXTURE_SET_VERSION_V1
  fixtureSetHash: string
  generator: H86ModelIdentityV1
  verifier: H86ModelIdentityV1
  status: 'running' | 'provider-blocked' | 'failed' | 'completed'
  cases: H86CaseStateV1[]
  aggregate: H86AggregateV1 | null
  machineGate: H86MachineGateV1 | null
  checkpointHash: string
}

export interface H86GenerationCallInputV1 {
  fixture: H86StoryArcFixtureV1
  variant: H86StoryArcVariantV1
  generator: H86ModelIdentityV1
  attempt: number
}

export interface H86VerificationCallInputV1 {
  fixture: H86StoryArcFixtureV1
  variant: H86StoryArcVariantV1
  output: string
  outputHash: string
  verifier: H86ModelIdentityV1
  attempt: number
}

export interface H86RunDependenciesV1 {
  generate: (input: H86GenerationCallInputV1) => Promise<H86GenerationAttemptV1>
  verify: (input: H86VerificationCallInputV1) => Promise<H86VerificationAttemptV1>
}

const EMPTY_HASH = '0'.repeat(64)

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value as Record<string, unknown>).sort()
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && actual.every(key => allowed.has(key))
}

function checkpointShapeIsExact(checkpoint: H86CheckpointV1): boolean {
  if (!exactKeys(checkpoint, [
    'version', 'runId', 'codeRevision', 'fixtureSetVersion', 'fixtureSetHash', 'generator', 'verifier',
    'status', 'cases', 'aggregate', 'machineGate', 'checkpointHash',
  ])) return false
  if (!exactKeys(checkpoint.generator, ['provider', 'model', 'promptVersion'])
    || !exactKeys(checkpoint.verifier, ['provider', 'model', 'promptVersion'])) return false
  const usage = (value: unknown): boolean => exactKeys(value, [
    'inputTokens', 'outputTokens', 'durationMs', 'costUsd',
  ])
  const call = (value: H86CallEvidenceV1): boolean => exactKeys(value, [
    'stage', 'variant', 'provider', 'model', 'promptVersion', 'inputHash', 'outputHash', 'usage', 'status', 'traceHash',
  ], ['failureCode', 'failureMessage']) && (value.usage == null || usage(value.usage))
  const durable = (value: H86DurableEvidenceV1): boolean => exactKeys(value, [
    'runEvidenceHash', 'candidateHash', 'contextSources', 'projectionState', 'modelCalls', 'candidatePersisted',
  ])
  const generation = (value: H86GenerationAttemptV1): boolean => exactKeys(value, [
    'attempt', 'status', 'output', 'outputHash', 'parserPassed', 'calls',
  ], ['durableEvidence', 'failureCode', 'failureMessage'])
    && Array.isArray(value.calls) && value.calls.every(call)
    && (value.durableEvidence == null || durable(value.durableEvidence))
  const assessment = (value: H86VerifierAssessmentV1): boolean => exactKeys(value, [
    'semanticScore', 'causalCoherence', 'specificity', 'matchedRequiredFactIds', 'missingRequiredFactIds',
    'futureLeakage', 'wrongWorldLeakage',
  ])
  const verification = (value: H86VerificationAttemptV1): boolean => exactKeys(value, [
    'attempt', 'status', 'assessment', 'calls',
  ], ['failureCode', 'failureMessage'])
    && Array.isArray(value.calls) && value.calls.every(call)
    && (value.assessment == null || assessment(value.assessment))
  for (const item of checkpoint.cases) {
    if (!exactKeys(item, ['fixtureId', 'executionOrder', 'variants'])
      || !exactKeys(item.variants, ['baseline-direct', 'agent-harness'])) return false
    for (const variant of H86_STORY_ARC_VARIANTS_V1) {
      const state = item.variants[variant]
      if (!exactKeys(state, ['generationAttempts', 'verificationAttempts'])
        || !Array.isArray(state.generationAttempts) || !state.generationAttempts.every(generation)
        || !Array.isArray(state.verificationAttempts) || !state.verificationAttempts.every(verification)) return false
    }
  }
  const variantAggregate = (value: H86VariantAggregateV1): boolean => exactKeys(value, [
    'caseCount', 'completionRate', 'parserPassRate', 'verifierCompletionRate', 'semanticScore', 'causalCoherence',
    'specificity', 'requiredFactCoverage', 'futureLeakageRate', 'wrongWorldLeakageRate', 'durableEvidenceCoverage',
    'inputTokens', 'outputTokens', 'totalLatencyMs', 'p95LatencyMs', 'costUsd', 'meteredCalls', 'totalCalls',
  ])
  if (checkpoint.aggregate != null && (
    !exactKeys(checkpoint.aggregate, ['baselineDirect', 'agentHarness', 'comparison'])
    || !variantAggregate(checkpoint.aggregate.baselineDirect)
    || !variantAggregate(checkpoint.aggregate.agentHarness)
    || !exactKeys(checkpoint.aggregate.comparison, [
      'semanticRegression', 'factCoverageRegression', 'p95LatencyRatio', 'tokenMultiplier', 'costMultiplier',
    ])
  )) return false
  if (checkpoint.machineGate != null && !exactKeys(checkpoint.machineGate, [
    'passed', 'failures', 'humanReviewRequired',
  ])) return false
  return true
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function sanitizeFailureMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return message.replace(/(?:sk|ak|key)-[A-Za-z0-9_-]{8,}/gi, '[credential]').slice(0, 500)
}

function checkpointBody(checkpoint: H86CheckpointV1): Omit<H86CheckpointV1, 'checkpointHash'> {
  const { checkpointHash: _checkpointHash, ...body } = checkpoint
  return body
}

async function sealCheckpoint(checkpoint: H86CheckpointV1): Promise<H86CheckpointV1> {
  return {
    ...checkpoint,
    checkpointHash: await hashCanonicalValue(checkpointBody(checkpoint)),
  }
}

function executionOrder(index: number): [H86StoryArcVariantV1, H86StoryArcVariantV1] {
  return index % 2 === 0
    ? ['baseline-direct', 'agent-harness']
    : ['agent-harness', 'baseline-direct']
}

function emptyCases(fixtures: readonly H86StoryArcFixtureV1[]): H86CaseStateV1[] {
  return fixtures.map((fixture, index) => ({
    fixtureId: fixture.id,
    executionOrder: executionOrder(index),
    variants: {
      'baseline-direct': { generationAttempts: [], verificationAttempts: [] },
      'agent-harness': { generationAttempts: [], verificationAttempts: [] },
    },
  }))
}

function latest<T>(items: readonly T[]): T | null {
  return items.length ? items[items.length - 1] : null
}

function p95(values: number[]): number {
  if (!values.length) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]
}

function usageForVariant(state: H86VariantStateV1): H86UsageV1[] {
  const generation = state.generationAttempts.flatMap(attempt => attempt.calls)
  const verification = state.verificationAttempts.flatMap(attempt => attempt.calls)
  return [...generation, ...verification]
    .map(call => call.usage)
    .filter((usage): usage is H86UsageV1 => usage != null)
}

function aggregateVariant(
  fixtures: readonly H86StoryArcFixtureV1[],
  cases: readonly H86CaseStateV1[],
  variant: H86StoryArcVariantV1,
): H86VariantAggregateV1 {
  const states = cases.map(item => item.variants[variant])
  const generations = states.map(state => latest(state.generationAttempts))
  const verifications = states.map(state => latest(state.verificationAttempts))
  const assessments = verifications
    .map(attempt => attempt?.status === 'succeeded' ? attempt.assessment : null)
    .filter((assessment): assessment is H86VerifierAssessmentV1 => assessment != null)
  const calls = states.flatMap(state => [
    ...state.generationAttempts.flatMap(attempt => attempt.calls),
    ...state.verificationAttempts.flatMap(attempt => attempt.calls),
  ])
  const usages = calls.map(call => call.usage).filter((usage): usage is H86UsageV1 => usage != null)
  const generationLatencies = states.map(state => (
    latest(state.generationAttempts)?.calls.reduce((sum, call) => sum + (call.usage?.durationMs ?? 0), 0) ?? 0
  ))
  const requiredTotal = fixtures.reduce((sum, fixture) => sum + fixture.requiredFacts.length, 0)
  const matchedTotal = assessments.reduce((sum, assessment) => sum + assessment.matchedRequiredFactIds.length, 0)
  const count = fixtures.length
  const average = (read: (assessment: H86VerifierAssessmentV1) => number): number => (
    assessments.length ? assessments.reduce((sum, assessment) => sum + read(assessment), 0) / assessments.length : 0
  )
  return {
    caseCount: count,
    completionRate: generations.filter(item => item?.status === 'succeeded').length / count,
    parserPassRate: generations.filter(item => item?.status === 'succeeded' && item.parserPassed).length / count,
    verifierCompletionRate: assessments.length / count,
    semanticScore: average(item => item.semanticScore),
    causalCoherence: average(item => item.causalCoherence),
    specificity: average(item => item.specificity),
    requiredFactCoverage: requiredTotal > 0 ? matchedTotal / requiredTotal : 0,
    futureLeakageRate: average(item => Number(item.futureLeakage)),
    wrongWorldLeakageRate: average(item => Number(item.wrongWorldLeakage)),
    durableEvidenceCoverage: variant === 'agent-harness'
      ? generations.filter(item => item?.status === 'succeeded' && item.durableEvidence?.candidatePersisted).length / count
      : 0,
    inputTokens: usages.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: usages.reduce((sum, usage) => sum + usage.outputTokens, 0),
    totalLatencyMs: usages.reduce((sum, usage) => sum + usage.durationMs, 0),
    p95LatencyMs: p95(generationLatencies),
    costUsd: usages.reduce((sum, usage) => sum + usage.costUsd, 0),
    meteredCalls: usages.length,
    totalCalls: calls.length,
  }
}

export function aggregateH86StoryArcCheckpointV1(
  checkpoint: Pick<H86CheckpointV1, 'cases'>,
  fixtures: readonly H86StoryArcFixtureV1[] = H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1,
): H86AggregateV1 {
  const baselineDirect = aggregateVariant(fixtures, checkpoint.cases, 'baseline-direct')
  const agentHarness = aggregateVariant(fixtures, checkpoint.cases, 'agent-harness')
  const baselineTokens = baselineDirect.inputTokens + baselineDirect.outputTokens
  const agentTokens = agentHarness.inputTokens + agentHarness.outputTokens
  return {
    baselineDirect,
    agentHarness,
    comparison: {
      semanticRegression: Math.max(0, baselineDirect.semanticScore - agentHarness.semanticScore),
      factCoverageRegression: Math.max(0, baselineDirect.requiredFactCoverage - agentHarness.requiredFactCoverage),
      p95LatencyRatio: baselineDirect.p95LatencyMs > 0 ? agentHarness.p95LatencyMs / baselineDirect.p95LatencyMs : null,
      tokenMultiplier: baselineTokens > 0 ? agentTokens / baselineTokens : null,
      costMultiplier: baselineDirect.costUsd > 0 ? agentHarness.costUsd / baselineDirect.costUsd : null,
    },
  }
}

export function evaluateH86MachineGateV1(aggregate: H86AggregateV1): H86MachineGateV1 {
  const failures: H86MachineGateFailureV1[] = []
  if (aggregate.baselineDirect.caseCount < 6 || aggregate.agentHarness.caseCount < 6) failures.push('minimum-paired-cases')
  if (aggregate.baselineDirect.completionRate < 1 || aggregate.baselineDirect.verifierCompletionRate < 1) failures.push('baseline-completion')
  if (aggregate.agentHarness.completionRate < 1 || aggregate.agentHarness.verifierCompletionRate < 1) failures.push('agent-harness-completion')
  if (aggregate.agentHarness.durableEvidenceCoverage < 1) failures.push('agent-harness-durable-evidence')
  if (aggregate.comparison.semanticRegression > 0.02) failures.push('semantic-quality-noninferiority')
  if (aggregate.comparison.factCoverageRegression > 0.02) failures.push('required-fact-noninferiority')
  if (aggregate.agentHarness.futureLeakageRate > 0) failures.push('future-leakage')
  if (aggregate.agentHarness.wrongWorldLeakageRate > 0) failures.push('wrong-world-leakage')
  if (
    aggregate.baselineDirect.meteredCalls !== aggregate.baselineDirect.totalCalls
    || aggregate.agentHarness.meteredCalls !== aggregate.agentHarness.totalCalls
  ) failures.push('usage-evidence-missing')
  if (aggregate.comparison.p95LatencyRatio == null || aggregate.comparison.p95LatencyRatio > 1.5) failures.push('p95-latency-budget')
  if (aggregate.comparison.tokenMultiplier == null || aggregate.comparison.tokenMultiplier > 1.5) failures.push('token-budget')
  if (aggregate.comparison.costMultiplier == null || aggregate.comparison.costMultiplier > 1.5) failures.push('cost-budget')
  return { passed: failures.length === 0, failures, humanReviewRequired: true }
}

function validateUsage(value: H86UsageV1): void {
  if (!Number.isInteger(value.inputTokens) || value.inputTokens < 0) throw new Error('H86 inputTokens 无效')
  if (!Number.isInteger(value.outputTokens) || value.outputTokens < 0) throw new Error('H86 outputTokens 无效')
  if (!(value.durationMs > 0) || !Number.isFinite(value.durationMs)) throw new Error('H86 durationMs 无效')
  if (value.costUsd < 0 || !Number.isFinite(value.costUsd)) throw new Error('H86 costUsd 无效')
}

async function validateCall(
  call: H86CallEvidenceV1,
  expected: {
    stage: H86CallEvidenceV1['stage']
    variant: H86StoryArcVariantV1
    identity: H86ModelIdentityV1
    promptVersion?: string
  },
): Promise<void> {
  if (call.stage !== expected.stage || call.variant !== expected.variant) throw new Error('H86 调用 stage/variant 不匹配')
  if (
    call.provider !== expected.identity.provider
    || call.model !== expected.identity.model
    || call.promptVersion !== (expected.promptVersion ?? expected.identity.promptVersion)
  ) throw new Error('H86 调用身份与冻结配置不匹配')
  if (!isHash(call.inputHash) || !isHash(call.traceHash)) throw new Error('H86 调用 hash 无效')
  if (call.outputHash != null && !isHash(call.outputHash)) throw new Error('H86 outputHash 无效')
  if (call.usage) validateUsage(call.usage)
  if (call.status === 'succeeded' && (!call.outputHash || !call.usage)) throw new Error('H86 成功调用缺少输出或用量')
}

async function validateGenerationAttempt(
  attempt: H86GenerationAttemptV1,
  variant: H86StoryArcVariantV1,
  generator: H86ModelIdentityV1,
): Promise<void> {
  if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) throw new Error('H86 generation attempt 无效')
  if (!attempt.calls.length) throw new Error('H86 generation attempt 缺少调用账本')
  const promptVersion = attempt.calls[0].promptVersion
  if (variant === 'baseline-direct' && promptVersion !== H86_BASELINE_PROMPT_VERSION_V1) {
    throw new Error('H86 基线直连 Prompt 版本无效')
  }
  if (variant === 'agent-harness'
    && !H86_AGENT_PROMPT_VERSIONS_V1.includes(promptVersion as typeof H86_AGENT_PROMPT_VERSIONS_V1[number])) {
    throw new Error('H86 Agent/Harness Prompt 版本无效')
  }
  for (const call of attempt.calls) await validateCall(call, {
    stage: 'generation',
    variant,
    identity: generator,
    promptVersion,
  })
  if (attempt.status === 'succeeded') {
    if (!attempt.output.trim() || !attempt.outputHash || !attempt.parserPassed) throw new Error('H86 成功生成缺少严格输出')
    if (await hashCanonicalValue(attempt.output) !== attempt.outputHash) throw new Error('H86 generation outputHash 不匹配')
    if (variant === 'agent-harness' && !attempt.durableEvidence?.candidatePersisted) {
      throw new Error('H86 Agent/Harness 成功生成缺少 durable 候选证据')
    }
  }
}

async function validateVerificationAttempt(
  attempt: H86VerificationAttemptV1,
  fixture: H86StoryArcFixtureV1,
  variant: H86StoryArcVariantV1,
  verifier: H86ModelIdentityV1,
): Promise<void> {
  if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) throw new Error('H86 verification attempt 无效')
  if (!attempt.calls.length) throw new Error('H86 verification attempt 缺少调用账本')
  for (const call of attempt.calls) await validateCall(call, { stage: 'verification', variant, identity: verifier })
  if (attempt.status !== 'succeeded' || !attempt.assessment) return
  const allowed = new Set(fixture.requiredFacts.map(item => item.id))
  const matched = attempt.assessment.matchedRequiredFactIds
  const missing = attempt.assessment.missingRequiredFactIds
  if (new Set([...matched, ...missing]).size !== allowed.size) throw new Error('H86 verifier fact id 不完整')
  if ([...matched, ...missing].some(id => !allowed.has(id))) throw new Error('H86 verifier 返回未知 fact id')
  if (matched.some(id => missing.includes(id))) throw new Error('H86 verifier fact id 重复归类')
  for (const score of [attempt.assessment.semanticScore, attempt.assessment.causalCoherence, attempt.assessment.specificity]) {
    if (score < 0 || score > 1 || !Number.isFinite(score)) throw new Error('H86 verifier score 无效')
  }
}

export async function verifyH86CheckpointV1(
  checkpoint: H86CheckpointV1,
  fixtures: readonly H86StoryArcFixtureV1[] = H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1,
): Promise<boolean> {
  try {
    if (!checkpointShapeIsExact(checkpoint)) return false
    if (checkpoint.version !== 1 || checkpoint.fixtureSetVersion !== H86_STORY_ARC_FIXTURE_SET_VERSION_V1) return false
    if (!isHash(checkpoint.fixtureSetHash) || !isHash(checkpoint.checkpointHash)) return false
    if (await hashCanonicalValue(fixtures) !== checkpoint.fixtureSetHash) return false
    if (await hashCanonicalValue(checkpointBody(checkpoint)) !== checkpoint.checkpointHash) return false
    if (checkpoint.generator.provider === checkpoint.verifier.provider && checkpoint.generator.model === checkpoint.verifier.model) return false
    if (checkpoint.cases.length !== fixtures.length) return false
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index]
      const item = checkpoint.cases[index]
      if (item.fixtureId !== fixture.id || JSON.stringify(item.executionOrder) !== JSON.stringify(executionOrder(index))) return false
      for (const variant of H86_STORY_ARC_VARIANTS_V1) {
        const state = item.variants[variant]
        for (const attempt of state.generationAttempts) await validateGenerationAttempt(attempt, variant, checkpoint.generator)
        for (const attempt of state.verificationAttempts) await validateVerificationAttempt(attempt, fixture, variant, checkpoint.verifier)
      }
    }
    if (checkpoint.status === 'completed') {
      if (!checkpoint.aggregate || !checkpoint.machineGate) return false
      const aggregate = aggregateH86StoryArcCheckpointV1(checkpoint, fixtures)
      if (JSON.stringify(aggregate) !== JSON.stringify(checkpoint.aggregate)) return false
      if (JSON.stringify(evaluateH86MachineGateV1(aggregate)) !== JSON.stringify(checkpoint.machineGate)) return false
    } else if (checkpoint.aggregate || checkpoint.machineGate) return false
    return true
  } catch {
    return false
  }
}

function hasSuccessfulGeneration(state: H86VariantStateV1): boolean {
  return latest(state.generationAttempts)?.status === 'succeeded'
}

function hasSuccessfulVerification(state: H86VariantStateV1): boolean {
  return latest(state.verificationAttempts)?.status === 'succeeded'
}

function stoppedStatus(status: H86GenerationAttemptV1['status'] | H86VerificationAttemptV1['status']): H86CheckpointV1['status'] {
  return status === 'provider-failed' ? 'provider-blocked' : 'failed'
}

function isRunnerFailure(attempt: H86GenerationAttemptV1 | H86VerificationAttemptV1): boolean {
  return attempt.status === 'protocol-failed' && attempt.failureCode === 'runner_error'
}

export async function runH86StoryArcMainPathEvalV1(input: {
  runId: string
  codeRevision: string
  generator: H86ModelIdentityV1
  verifier: H86ModelIdentityV1
  dependencies: H86RunDependenciesV1
  fixtures?: readonly H86StoryArcFixtureV1[]
  resumeFrom?: H86CheckpointV1
  retryFailed?: boolean
  onCheckpoint?: (checkpoint: H86CheckpointV1) => Promise<void> | void
}): Promise<H86CheckpointV1> {
  const fixtures = input.fixtures ?? H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1
  if (!fixtures.length) throw new Error('H86 至少需要一个 fixture')
  if (input.generator.provider === input.verifier.provider && input.generator.model === input.verifier.model) {
    throw new Error('H86 要求 generator 与 verifier 使用不同 provider/model 身份')
  }
  const fixtureSetHash = await hashCanonicalValue(fixtures)
  let checkpoint: H86CheckpointV1
  if (input.resumeFrom) {
    if (!await verifyH86CheckpointV1(input.resumeFrom, fixtures)) throw new Error('H86 resume checkpoint 验签失败')
    if (
      input.resumeFrom.fixtureSetHash !== fixtureSetHash
      || JSON.stringify(input.resumeFrom.generator) !== JSON.stringify(input.generator)
      || JSON.stringify(input.resumeFrom.verifier) !== JSON.stringify(input.verifier)
      || input.resumeFrom.runId !== input.runId
      || input.resumeFrom.codeRevision !== input.codeRevision
    ) throw new Error('H86 resume checkpoint 与当前冻结执行不一致')
    if (input.resumeFrom.status === 'completed') return input.resumeFrom
    if (
      (input.resumeFrom.status === 'failed' || input.resumeFrom.status === 'provider-blocked')
      && !input.retryFailed
    ) return input.resumeFrom
    checkpoint = await sealCheckpoint({
      ...input.resumeFrom,
      status: 'running',
      aggregate: null,
      machineGate: null,
    })
  } else {
    checkpoint = await sealCheckpoint({
      version: 1,
      runId: input.runId,
      codeRevision: input.codeRevision,
      fixtureSetVersion: H86_STORY_ARC_FIXTURE_SET_VERSION_V1,
      fixtureSetHash,
      generator: input.generator,
      verifier: input.verifier,
      status: 'running',
      cases: emptyCases(fixtures),
      aggregate: null,
      machineGate: null,
      checkpointHash: EMPTY_HASH,
    })
  }
  const save = async (): Promise<void> => {
    checkpoint = await sealCheckpoint(checkpoint)
    await input.onCheckpoint?.(checkpoint)
  }
  await save()

  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index]
    const caseState = checkpoint.cases[index]
    for (const variant of caseState.executionOrder) {
      const state = caseState.variants[variant]
      const generationLatest = latest(state.generationAttempts)
      if (!hasSuccessfulGeneration(state)) {
        if (generationLatest) {
          if (generationLatest.status === 'protocol-failed' && !isRunnerFailure(generationLatest)) continue
          if (!input.retryFailed) return checkpoint
        }
        const attemptNumber = state.generationAttempts.length + 1
        let attempt: H86GenerationAttemptV1
        try {
          attempt = await input.dependencies.generate({
            fixture,
            variant,
            generator: input.generator,
            attempt: attemptNumber,
          })
          await validateGenerationAttempt(attempt, variant, input.generator)
        } catch (error) {
          attempt = await createSyntheticFailureAttempt({
            fixture,
            variant,
            identity: input.generator,
            stage: 'generation',
            attempt: attemptNumber,
            error,
          }) as H86GenerationAttemptV1
        }
        state.generationAttempts.push(attempt)
        if (attempt.status === 'provider-failed' || isRunnerFailure(attempt)) checkpoint.status = stoppedStatus(attempt.status)
        await save()
        if (attempt.status === 'provider-failed' || isRunnerFailure(attempt)) return checkpoint
        if (attempt.status === 'protocol-failed') continue
      }

      const verificationLatest = latest(state.verificationAttempts)
      if (!hasSuccessfulVerification(state)) {
        if (verificationLatest) {
          if (verificationLatest.status === 'protocol-failed' && !isRunnerFailure(verificationLatest)) continue
          if (!input.retryFailed) return checkpoint
        }
        const generation = latest(state.generationAttempts)!
        const attemptNumber = state.verificationAttempts.length + 1
        let attempt: H86VerificationAttemptV1
        try {
          attempt = await input.dependencies.verify({
            fixture,
            variant,
            output: generation.output,
            outputHash: generation.outputHash!,
            verifier: input.verifier,
            attempt: attemptNumber,
          })
          await validateVerificationAttempt(attempt, fixture, variant, input.verifier)
        } catch (error) {
          attempt = await createSyntheticFailureAttempt({
            fixture,
            variant,
            identity: input.verifier,
            stage: 'verification',
            attempt: attemptNumber,
            error,
          }) as H86VerificationAttemptV1
        }
        state.verificationAttempts.push(attempt)
        if (attempt.status === 'provider-failed' || isRunnerFailure(attempt)) checkpoint.status = stoppedStatus(attempt.status)
        await save()
        if (attempt.status === 'provider-failed' || isRunnerFailure(attempt)) return checkpoint
      }
    }
  }

  const aggregate = aggregateH86StoryArcCheckpointV1(checkpoint, fixtures)
  checkpoint = {
    ...checkpoint,
    status: 'completed',
    aggregate,
    machineGate: evaluateH86MachineGateV1(aggregate),
  }
  await save()
  return checkpoint
}

async function createSyntheticFailureAttempt(input: {
  fixture: H86StoryArcFixtureV1
  variant: H86StoryArcVariantV1
  identity: H86ModelIdentityV1
  stage: H86CallEvidenceV1['stage']
  attempt: number
  error: unknown
}): Promise<H86GenerationAttemptV1 | H86VerificationAttemptV1> {
  const failureMessage = sanitizeFailureMessage(input.error)
  const inputHash = await hashCanonicalValue({ fixtureId: input.fixture.id, stage: input.stage, attempt: input.attempt })
  const promptVersion = input.stage === 'generation'
    ? input.variant === 'baseline-direct' ? H86_BASELINE_PROMPT_VERSION_V1 : H86_AGENT_PROMPT_VERSION_V1
    : input.identity.promptVersion
  const call: H86CallEvidenceV1 = {
    stage: input.stage,
    variant: input.variant,
    provider: input.identity.provider,
    model: input.identity.model,
    promptVersion,
    inputHash,
    outputHash: null,
    usage: null,
    status: 'protocol-failed',
    failureCode: 'runner_error',
    failureMessage,
    traceHash: await hashCanonicalValue({ inputHash, failureMessage }),
  }
  if (input.stage === 'generation') {
    return {
      attempt: input.attempt,
      status: 'protocol-failed',
      output: '',
      outputHash: null,
      parserPassed: false,
      calls: [call],
      failureCode: 'runner_error',
      failureMessage,
    }
  }
  return {
    attempt: input.attempt,
    status: 'protocol-failed',
    assessment: null,
    calls: [call],
    failureCode: 'runner_error',
    failureMessage,
  }
}

export function buildH86BaselineStoryArcMessagesV1(
  fixture: H86StoryArcFixtureV1,
  assembledContext: string,
): ChatMessage[] {
  const arcType = fixture.authorRequest.includes('sub') ? 'sub' : 'main'
  const typeLabel = arcType === 'main' ? '主线故事线' : '支线故事线'
  const system = `你是一个专业小说策划师。根据提供的世界观、故事核心和大纲信息，规划一条完整的${typeLabel}。

要求：
1. 故事线应包含 3-7 个阶段，每个阶段有清晰的起止
2. 每个阶段必须有：标题、描述（50-100字）、关键事件（1-3个）
3. 重要阶段应标注转折点
4. 阶段之间要有因果递进关系，形成完整的叙事弧线
5. ${arcType === 'main' ? '主线应贯穿全书，从开篇到结局' : '支线应与主线交织但有独立发展'}

输出严格 JSON 格式，不要加 markdown 代码块：
{"name":"故事线名称","description":"故事线整体描述（一句话）","stages":[{"title":"阶段标题","description":"阶段描述","keyEvents":["事件1","事件2"],"turningPoint":"转折点描述（可选，无则不填）"}]}`
  const existing = fixture.existingArc
    ? `\n\n【已有故事线】\n[${fixture.existingArc.type === 'main' ? '主线' : '支线'}] ${fixture.existingArc.name}：${fixture.existingArc.description}`
    : ''
  const user = [
    `【项目】${fixture.projectName}（${fixture.genre}）`,
    `【世界观】\n${assembledContext.slice(0, 500)}`,
    `【故事核心】\n主题：${fixture.theme}\n核心冲突：${fixture.centralConflict}\nLogline：${fixture.logline}\n主线：${fixture.mainPlot}`,
  ].join('\n\n') + existing + `\n\n【作者要求】\n${fixture.authorRequest}\n\n请规划一条${typeLabel}：`
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

export function parseH86BaselineStoryArcOutputV1(raw: string, fixture: H86StoryArcFixtureV1): string {
  const trimmed = raw.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence?.[1]?.trim() ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('baseline_output_missing_json')
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) throw new Error('baseline_output_name_invalid')
  if (typeof parsed.description !== 'string') throw new Error('baseline_output_description_invalid')
  if (!Array.isArray(parsed.stages) || parsed.stages.length < 3 || parsed.stages.length > 7) {
    throw new Error('baseline_output_stages_invalid')
  }
  const stages = parsed.stages.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`baseline_stage_${index}_invalid`)
    const stage = value as Record<string, unknown>
    if (typeof stage.title !== 'string' || typeof stage.description !== 'string') throw new Error(`baseline_stage_${index}_text_invalid`)
    if (!Array.isArray(stage.keyEvents) || stage.keyEvents.length < 1 || stage.keyEvents.length > 3
      || stage.keyEvents.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error(`baseline_stage_${index}_events_invalid`)
    }
    return {
      title: stage.title.trim(),
      description: stage.description.trim(),
      keyEvents: stage.keyEvents.map(item => String(item).trim()),
      ...(typeof stage.turningPoint === 'string' && stage.turningPoint.trim()
        ? { turningPoint: stage.turningPoint.trim() }
        : {}),
    }
  })
  return JSON.stringify([{
    name: parsed.name.trim(),
    type: fixture.authorRequest.includes('sub') ? 'sub' : 'main',
    description: parsed.description.trim(),
    stages,
  }], null, 2)
}

export function buildH86VerifierMessagesV1(input: {
  fixture: H86StoryArcFixtureV1
  variant: H86StoryArcVariantV1
  output: string
}): ChatMessage[] {
  const factRows = input.fixture.requiredFacts.map(item => `${item.id}: ${item.description}`).join('\n')
  const forbidden = input.fixture.forbiddenFacts.map(item => `- ${item}`).join('\n')
  return [{
    role: 'system',
    content: `你是与生成器身份独立的故事线评测员。只依据给出的公开设定与作者要求评分，不猜测隐藏答案。
逐项判断 required fact 是否被故事线实际落实，而不是只出现同义词。futureLeakage 指输出越过作者要求预设了
未提供的未来既定事实；wrongWorldLeakage 指输出违反世界硬规则或引入 forbidden fact。

只输出严格 JSON：
{"semanticScore":0.0,"causalCoherence":0.0,"specificity":0.0,"matchedRequiredFactIds":["f1"],"missingRequiredFactIds":["f2"],"futureLeakage":false,"wrongWorldLeakage":false}
三个分数必须在 0 到 1；matched 与 missing 必须无重叠并完整覆盖所有 required fact id。不要输出解释或额外字段。`,
  }, {
    role: 'user',
    content: `【项目】${input.fixture.projectName}（${input.fixture.genre}）
【世界】${input.fixture.worldOrigin}\n${input.fixture.worldRules}
【故事核心】${input.fixture.theme}\n${input.fixture.centralConflict}\n${input.fixture.logline}\n${input.fixture.mainPlot}
【作者要求】${input.fixture.authorRequest}
【Required facts】\n${factRows}
【Forbidden facts】\n${forbidden}
【待评故事线】\n${input.output}`,
  }]
}

export function parseH86VerifierAssessmentV1(
  raw: string,
  fixture: H86StoryArcFixtureV1,
): H86VerifierAssessmentV1 {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const keys = [
    'semanticScore',
    'causalCoherence',
    'specificity',
    'matchedRequiredFactIds',
    'missingRequiredFactIds',
    'futureLeakage',
    'wrongWorldLeakage',
  ]
  if (Object.keys(parsed).sort().join('|') !== [...keys].sort().join('|')) throw new Error('verifier_unknown_fields')
  const score = (key: string): number => {
    const value = parsed[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`verifier_${key}_invalid`)
    return value
  }
  const ids = (key: string): string[] => {
    const value = parsed[key]
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`verifier_${key}_invalid`)
    if (new Set(value).size !== value.length) throw new Error(`verifier_${key}_duplicate`)
    return value as string[]
  }
  const matchedRequiredFactIds = ids('matchedRequiredFactIds')
  const missingRequiredFactIds = ids('missingRequiredFactIds')
  const allowed = fixture.requiredFacts.map(item => item.id).sort()
  const reported = [...matchedRequiredFactIds, ...missingRequiredFactIds].sort()
  if (reported.join('|') !== allowed.join('|')) throw new Error('verifier_fact_partition_invalid')
  if (typeof parsed.futureLeakage !== 'boolean' || typeof parsed.wrongWorldLeakage !== 'boolean') {
    throw new Error('verifier_leakage_invalid')
  }
  return {
    semanticScore: score('semanticScore'),
    causalCoherence: score('causalCoherence'),
    specificity: score('specificity'),
    matchedRequiredFactIds,
    missingRequiredFactIds,
    futureLeakage: parsed.futureLeakage,
    wrongWorldLeakage: parsed.wrongWorldLeakage,
  }
}

export async function createH86CallEvidenceV1(input: {
  stage: H86CallEvidenceV1['stage']
  variant: H86StoryArcVariantV1
  identity: H86ModelIdentityV1
  messages: ChatMessage[]
  output: string | null
  usage: Omit<H86UsageV1, 'costUsd'> | null
  status: H86CallEvidenceV1['status']
  failureCode?: string
  failureMessage?: string
}): Promise<H86CallEvidenceV1> {
  const inputHash = await hashCanonicalValue(input.messages)
  const outputHash = input.output == null ? null : await hashCanonicalValue(input.output)
  const usage = input.usage == null ? null : {
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    durationMs: input.usage.durationMs,
    costUsd: computeCostUsd(input.identity.model, input.usage.inputTokens, input.usage.outputTokens),
  }
  const failureMessage = input.failureMessage ? sanitizeFailureMessage(input.failureMessage) : undefined
  return {
    stage: input.stage,
    variant: input.variant,
    provider: input.identity.provider,
    model: input.identity.model,
    promptVersion: input.identity.promptVersion,
    inputHash,
    outputHash,
    usage,
    status: input.status,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    ...(failureMessage ? { failureMessage } : {}),
    traceHash: await hashCanonicalValue({
      stage: input.stage,
      variant: input.variant,
      identity: input.identity,
      inputHash,
      outputHash,
      usage,
      status: input.status,
      failureCode: input.failureCode ?? null,
      failureMessage: failureMessage ?? null,
    }),
  }
}

export async function persistH86CheckpointV1(checkpoint: H86CheckpointV1): Promise<void> {
  if (!await verifyH86CheckpointV1(checkpoint)) throw new Error('拒绝持久化未通过验签的 H86 checkpoint')
  localStorage.setItem(H86_STORY_ARC_STORAGE_KEY_V1, JSON.stringify(checkpoint))
}

export async function loadH86CheckpointV1(): Promise<H86CheckpointV1 | null> {
  const raw = localStorage.getItem(H86_STORY_ARC_STORAGE_KEY_V1)
  if (!raw) return null
  const checkpoint = JSON.parse(raw) as H86CheckpointV1
  if (!await verifyH86CheckpointV1(checkpoint)) throw new Error('本机 H86 checkpoint 验签失败')
  return checkpoint
}

export function clearH86CheckpointV1(): void {
  localStorage.removeItem(H86_STORY_ARC_STORAGE_KEY_V1)
}

export async function exportH86CheckpointV1(checkpoint: H86CheckpointV1): Promise<string> {
  if (!await verifyH86CheckpointV1(checkpoint)) throw new Error('拒绝导出未通过验签的 H86 checkpoint')
  return JSON.stringify(checkpoint, null, 2)
}

export async function importH86CheckpointV1(raw: string): Promise<H86CheckpointV1> {
  const checkpoint = JSON.parse(raw) as H86CheckpointV1
  if (!await verifyH86CheckpointV1(checkpoint)) throw new Error('H86 checkpoint 验签失败')
  return checkpoint
}

export const __h86TestUtils = {
  executionOrder,
  finiteNonNegative,
  unit,
  usageForVariant,
}
