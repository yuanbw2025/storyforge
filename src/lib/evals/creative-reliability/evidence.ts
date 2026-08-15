import { hashCanonicalValue } from '../../agent/run/hash'
import type { CreativeReliabilityFixtureV1 } from './fixtures'
import {
  CREATIVE_RELIABILITY_EVAL_VARIANTS_V1,
  type CreativeReliabilityCommunityGateV1,
  type CreativeReliabilityEvalAggregateV1,
  type CreativeReliabilityEvalCaseV1,
  type CreativeReliabilityEvalCallV1,
  type CreativeReliabilityEvalFixtureBindingV1,
  type CreativeReliabilityEvalRecordV1,
  type CreativeReliabilityEvalVariantV1,
  type CreativeReliabilityHumanReviewV1,
  type CreativeReliabilityMachineGateV1,
  type CreativeReliabilityVariantAggregateV1,
} from './types'

export const CREATIVE_RELIABILITY_MACHINE_THRESHOLDS_V1 = {
  minimumCases: 6,
  minimumEditableArtifactRate: 0.8,
  maximumZeroOutputRate: 0.1,
  maximumAverageArtifactCalls: 1.5,
  maximumArtifactCalls: 2,
  maximumTokenPerAdoptableMultiplier: 1.5,
  minimumSafetyPassRate: 1,
  minimumPartialSettingProgressRate: 0.8,
  maximumSemanticRegression: 0.05,
} as const

export const CREATIVE_RELIABILITY_COMMUNITY_THRESHOLDS_V1 = {
  minimumWillingToEditRate: 0.8,
  minimumWillingToEditImprovement: 0.1,
} as const

export const CREATIVE_RELIABILITY_HELDOUT_CLAIM_KEY_V1 =
  'storyforge:crel:sealed-heldout-claim-v1'

function p95(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).sort().join(',') === [...keys].sort().join(',')
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertFinite(value: number, label: string, minimum = 0): void {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${label} 无效`)
}

function sumUsage(calls: readonly CreativeReliabilityEvalCallV1[]) {
  const metered = calls.map(call => call.usage).filter((usage): usage is NonNullable<typeof usage> => usage != null)
  const costs = metered.map(usage => usage.costUsd)
  return {
    inputTokens: metered.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: metered.reduce((sum, usage) => sum + usage.outputTokens, 0),
    latencyMs: metered.reduce((sum, usage) => sum + usage.latencyMs, 0),
    costUsd: costs.length === calls.length && costs.every((cost): cost is number => cost != null)
      ? costs.reduce((sum, cost) => sum + cost, 0)
      : null,
    usageSource: metered.length === calls.length
      && metered.every(usage => usage.usageSource === 'provider')
      ? 'provider' as const
      : 'estimated' as const,
  }
}

function validateCall(
  call: CreativeReliabilityEvalCallV1,
  expected: {
    callIndex: number
    stage: CreativeReliabilityEvalCallV1['stage']
    identity: CreativeReliabilityEvalRecordV1['generator']
  },
): void {
  if (!Number.isInteger(call.callIndex) || call.callIndex !== expected.callIndex) {
    throw new Error('逐调用账本序号不连续')
  }
  if (call.stage !== expected.stage) throw new Error('逐调用账本 stage 不匹配')
  if (call.provider !== expected.identity.provider || call.model !== expected.identity.model) {
    throw new Error('逐调用账本模型身份与冻结配置不匹配')
  }
  if (!call.promptVersion.trim() || !isHash(call.inputHash)) throw new Error('逐调用账本输入证据无效')
  if (call.outputHash != null && !isHash(call.outputHash)) throw new Error('逐调用账本 outputHash 无效')
  if (call.status === 'succeeded' && (!call.outputHash || !call.usage)) {
    throw new Error('成功调用缺少输出或 usage')
  }
  if (call.usage) {
    assertFinite(call.usage.inputTokens, 'call inputTokens')
    assertFinite(call.usage.outputTokens, 'call outputTokens')
    assertFinite(call.usage.latencyMs, 'call latencyMs')
    if (call.usage.costUsd != null) assertFinite(call.usage.costUsd, 'call costUsd')
  }
}

function reviewForVariant(
  review: CreativeReliabilityHumanReviewV1,
  variant: CreativeReliabilityEvalVariantV1,
) {
  const index = review.blindOrder.indexOf(variant)
  if (index < 0) throw new Error('盲评顺序缺少变体')
  const expectedLabel = index === 0 ? 'A' : 'B'
  const verdict = review.verdicts.find(item => item.label === expectedLabel)
  if (!verdict) throw new Error('盲评结论与展示顺序不匹配')
  return verdict
}

function validateReview(review: CreativeReliabilityHumanReviewV1): void {
  if (!isHash(review.reviewerIdHash)) throw new Error('盲评 reviewerIdHash 无效')
  if (!Number.isInteger(review.completedAt) || review.completedAt < 0) throw new Error('盲评时间无效')
  if (
    review.blindOrder.length !== 2
    || new Set(review.blindOrder).size !== 2
    || review.blindOrder.some(item => !CREATIVE_RELIABILITY_EVAL_VARIANTS_V1.includes(item))
  ) throw new Error('盲评顺序无效')
  if (
    review.verdicts.length !== 2
    || new Set(review.verdicts.map(item => item.label)).size !== 2
    || review.verdicts.some(item => item.label !== 'A' && item.label !== 'B')
  ) throw new Error('盲评结论必须完整覆盖 A/B')
  for (const verdict of review.verdicts) {
    assertFinite(verdict.estimatedEditMinutes, '盲评预计修改时间')
    if (verdict.retainedRatio < 0 || verdict.retainedRatio > 1) throw new Error('盲评保留比例无效')
  }
  if (!['A', 'B', 'tie'].includes(review.preferred)) throw new Error('盲评偏好无效')
}

async function validateCase(
  item: CreativeReliabilityEvalCaseV1,
  fixture: CreativeReliabilityFixtureV1,
  generator: CreativeReliabilityEvalRecordV1['generator'],
  verifier: CreativeReliabilityEvalRecordV1['verifier'],
): Promise<void> {
  if (item.fixtureId !== fixture.id) throw new Error('评测 case 与 fixture 不匹配')
  if (
    item.executionOrder.length !== 2
    || new Set(item.executionOrder).size !== 2
    || item.executionOrder.some(variant => !CREATIVE_RELIABILITY_EVAL_VARIANTS_V1.includes(variant))
  ) throw new Error('评测 executionOrder 无效')
  for (const variant of CREATIVE_RELIABILITY_EVAL_VARIANTS_V1) {
    const generation = item.generations[variant]
    if (!generation || generation.variant !== variant) throw new Error('评测 generation 变体不匹配')
    if (generation.presentedText.trim()) {
      if (generation.outputHash !== await hashCanonicalValue(generation.presentedText)) {
        throw new Error('评测 generation outputHash 不匹配')
      }
    } else if (generation.outputHash !== null) throw new Error('零产出不得伪造 outputHash')
    if (generation.editableArtifact !== Boolean(generation.presentedText.trim())) {
      throw new Error('editableArtifact 与呈现给作者的文本不一致')
    }
    const adoptableStatus = generation.status === 'ready'
      || generation.status === 'usable-with-warnings'
      || generation.status === 'legacy-ready'
    if (generation.adoptable !== (generation.editableArtifact && adoptableStatus)) {
      throw new Error('adoptable 与产物状态不一致')
    }
    if (!Number.isInteger(generation.artifactModelCalls) || generation.artifactModelCalls < 1) {
      throw new Error('artifactModelCalls 无效')
    }
    if (variant === 'legacy-direct' && generation.artifactModelCalls !== 1) {
      throw new Error('旧直连基线必须只有一次产物调用')
    }
    if (variant === 'creative-reliability' && generation.artifactModelCalls > 2) {
      throw new Error('CREL 产物出现隐藏第三次调用')
    }
    if (generation.calls.length !== generation.artifactModelCalls) {
      throw new Error('artifactModelCalls 与逐调用账本不一致')
    }
    generation.calls.forEach((call, index) => validateCall(call, {
      callIndex: index + 1,
      stage: 'generation',
      identity: generator,
    }))
    if (generation.calls[0]?.purpose !== 'generate') throw new Error('产物首调用必须是 generate')
    if (generation.calls.slice(1).some(call => call.purpose !== 'repair')) {
      throw new Error('产物后续调用只能是 repair')
    }
    const generationUsage = sumUsage(generation.calls)
    if (JSON.stringify(generationUsage) !== JSON.stringify(generation.usage)) {
      throw new Error('generation 汇总 usage 与逐调用账本不一致')
    }
    if (new Set(generation.issueCodes).size !== generation.issueCodes.length) {
      throw new Error('generation issueCodes 重复')
    }
    assertFinite(generation.usage.inputTokens, 'generation inputTokens')
    assertFinite(generation.usage.outputTokens, 'generation outputTokens')
    assertFinite(generation.usage.latencyMs, 'generation latencyMs')
    if (generation.usage.costUsd != null) assertFinite(generation.usage.costUsd, 'generation costUsd')

    const verification = item.verifications[variant]
    if (!verification) throw new Error('评测缺少 verifier 结果')
    if (verification.calls.length !== 1) throw new Error('verifier 必须且只能调用一次')
    validateCall(verification.calls[0], {
      callIndex: 1,
      stage: 'verification',
      identity: verifier,
    })
    if (verification.calls[0].purpose !== 'verify') throw new Error('verifier 调用 purpose 无效')
    if (verification.status === 'succeeded') {
      for (const score of [
        verification.semanticScore,
        verification.causalCoherence,
        verification.specificity,
      ]) {
        if (score == null || score < 0 || score > 1) throw new Error('verifier score 无效')
      }
      if (
        verification.safetyPassed == null
        || verification.narrativeProgressed == null
        || verification.infodumpOnly == null
        || !verification.usage
        || !isHash(verification.assessmentHash)
      ) throw new Error('成功 verifier 缺少完整证据')
      const {
        usage: _usage,
        calls: _calls,
        assessmentHash,
        ...assessmentBody
      } = verification
      if (assessmentHash !== await hashCanonicalValue(assessmentBody)) {
        throw new Error('verifier assessmentHash 不匹配')
      }
      const expectedFactIds = new Set(fixture.requiredFacts.map(fact => fact.id))
      const returned = [
        ...verification.matchedRequiredFactIds,
        ...verification.missingRequiredFactIds,
      ]
      if (
        returned.length !== expectedFactIds.size
        || new Set(returned).size !== expectedFactIds.size
        || returned.some(id => !expectedFactIds.has(id))
      ) throw new Error('verifier required fact 归类不完整')
    } else if (
      verification.semanticScore != null
      || verification.causalCoherence != null
      || verification.specificity != null
      || verification.safetyPassed != null
      || verification.narrativeProgressed != null
      || verification.infodumpOnly != null
      || verification.assessmentHash != null
    ) throw new Error('失败 verifier 不得伪造评分')
    if (verification.usage) {
      assertFinite(verification.usage.inputTokens, 'verifier inputTokens')
      assertFinite(verification.usage.outputTokens, 'verifier outputTokens')
      assertFinite(verification.usage.latencyMs, 'verifier latencyMs')
      if (verification.usage.costUsd != null) assertFinite(verification.usage.costUsd, 'verifier costUsd')
    }
    const verifierUsage = verification.calls[0].usage
    if (JSON.stringify(verifierUsage) !== JSON.stringify(verification.usage)) {
      throw new Error('verifier 汇总 usage 与逐调用账本不一致')
    }
  }
  if (item.humanReview) validateReview(item.humanReview)
  if (generator.provider === verifier.provider && generator.model === verifier.model) {
    throw new Error('generator 与 verifier 必须是不同模型身份')
  }
}

async function fixtureBindings(fixtures: readonly CreativeReliabilityFixtureV1[]) {
  return await Promise.all(fixtures.map(async fixture => ({
    id: fixture.id,
    split: fixture.split,
    cohort: fixture.cohort,
    genre: fixture.genre,
    contentHash: await hashCanonicalValue(fixture),
  } satisfies CreativeReliabilityEvalFixtureBindingV1)))
}

function aggregateVariant(
  cases: readonly CreativeReliabilityEvalCaseV1[],
  variant: CreativeReliabilityEvalVariantV1,
): CreativeReliabilityVariantAggregateV1 {
  const generations = cases.map(item => item.generations[variant])
  const verifications = cases.map(item => item.verifications[variant])
  const succeeded = verifications.filter(item => item.status === 'succeeded')
  const adoptableCount = generations.filter(item => item.adoptable).length
  const totalTokens = generations.reduce(
    (sum, item) => sum + item.usage.inputTokens + item.usage.outputTokens,
    0,
  )
  const knownCosts = generations.map(item => item.usage.costUsd)
  const allCostsKnown = knownCosts.every((cost): cost is number => cost != null)
  const knownCostUsd = allCostsKnown ? knownCosts.reduce((sum, cost) => sum + cost, 0) : null
  const human = cases.flatMap(item => item.humanReview
    ? [reviewForVariant(item.humanReview, variant)]
    : [])
  const scores = (read: (item: typeof succeeded[number]) => number | null) => (
    succeeded.length ? average(succeeded.map(item => read(item) ?? 0)) : 0
  )
  return {
    caseCount: cases.length,
    editableArtifactRate: generations.filter(item => item.editableArtifact).length / cases.length,
    zeroOutputRate: generations.filter(item => !item.editableArtifact).length / cases.length,
    adoptableRate: adoptableCount / cases.length,
    averageArtifactModelCalls: average(generations.map(item => item.artifactModelCalls)),
    maxArtifactModelCalls: Math.max(...generations.map(item => item.artifactModelCalls)),
    inputTokens: generations.reduce((sum, item) => sum + item.usage.inputTokens, 0),
    outputTokens: generations.reduce((sum, item) => sum + item.usage.outputTokens, 0),
    tokensPerAdoptableArtifact: adoptableCount ? totalTokens / adoptableCount : null,
    totalLatencyMs: generations.reduce((sum, item) => sum + item.usage.latencyMs, 0),
    p95LatencyMs: p95(generations.map(item => item.usage.latencyMs)),
    knownCostUsd,
    costPerAdoptableArtifactUsd: knownCostUsd != null && adoptableCount
      ? knownCostUsd / adoptableCount
      : null,
    verifierCompletionRate: succeeded.length / cases.length,
    semanticScore: scores(item => item.semanticScore),
    causalCoherence: scores(item => item.causalCoherence),
    specificity: scores(item => item.specificity),
    safetyPassRate: succeeded.length
      ? succeeded.filter(item => item.safetyPassed).length / succeeded.length
      : 0,
    narrativeProgressRate: succeeded.length
      ? succeeded.filter(item => item.narrativeProgressed).length / succeeded.length
      : 0,
    infodumpOnlyRate: succeeded.length
      ? succeeded.filter(item => item.infodumpOnly).length / succeeded.length
      : 0,
    humanReviewCount: human.length,
    willingToEditRate: human.length
      ? human.filter(item => item.willingToEdit).length / human.length
      : null,
    averageEstimatedEditMinutes: human.length
      ? average(human.map(item => item.estimatedEditMinutes))
      : null,
    averageRetainedRatio: human.length
      ? average(human.map(item => item.retainedRatio))
      : null,
  }
}

export function aggregateCreativeReliabilityEvalV1(
  cases: readonly CreativeReliabilityEvalCaseV1[],
): CreativeReliabilityEvalAggregateV1 {
  const legacyDirect = aggregateVariant(cases, 'legacy-direct')
  const creativeReliability = aggregateVariant(cases, 'creative-reliability')
  return {
    legacyDirect,
    creativeReliability,
    comparison: {
      tokenPerAdoptableMultiplier: legacyDirect.tokensPerAdoptableArtifact
        && creativeReliability.tokensPerAdoptableArtifact != null
        ? creativeReliability.tokensPerAdoptableArtifact / legacyDirect.tokensPerAdoptableArtifact
        : null,
      costPerAdoptableMultiplier: legacyDirect.costPerAdoptableArtifactUsd
        && creativeReliability.costPerAdoptableArtifactUsd != null
        ? creativeReliability.costPerAdoptableArtifactUsd / legacyDirect.costPerAdoptableArtifactUsd
        : null,
      p95LatencyMultiplier: legacyDirect.p95LatencyMs > 0
        ? creativeReliability.p95LatencyMs / legacyDirect.p95LatencyMs
        : null,
      semanticRegression: Math.max(0, legacyDirect.semanticScore - creativeReliability.semanticScore),
      willingToEditDelta: legacyDirect.willingToEditRate != null
        && creativeReliability.willingToEditRate != null
        ? creativeReliability.willingToEditRate - legacyDirect.willingToEditRate
        : null,
    },
  }
}

function evaluateMachineGate(
  cases: readonly CreativeReliabilityEvalCaseV1[],
  bindings: readonly CreativeReliabilityEvalFixtureBindingV1[],
  aggregate: CreativeReliabilityEvalAggregateV1,
): CreativeReliabilityMachineGateV1 {
  const failures: CreativeReliabilityMachineGateV1['failures'] = []
  const current = aggregate.creativeReliability
  const thresholds = { ...CREATIVE_RELIABILITY_MACHINE_THRESHOLDS_V1 }
  if (current.caseCount < thresholds.minimumCases) failures.push('minimum-cases')
  if (current.editableArtifactRate < thresholds.minimumEditableArtifactRate) failures.push('editable-artifact-rate')
  if (current.zeroOutputRate > thresholds.maximumZeroOutputRate) failures.push('zero-output-rate')
  if (current.averageArtifactModelCalls > thresholds.maximumAverageArtifactCalls) failures.push('average-artifact-calls')
  if (current.maxArtifactModelCalls > thresholds.maximumArtifactCalls) failures.push('max-artifact-calls')
  if (
    aggregate.comparison.tokenPerAdoptableMultiplier != null
    && aggregate.comparison.tokenPerAdoptableMultiplier > thresholds.maximumTokenPerAdoptableMultiplier
  ) failures.push('token-per-adoptable-artifact')
  if (current.safetyPassRate < thresholds.minimumSafetyPassRate) failures.push('safety-regression')
  const partialIds = new Set(bindings
    .filter(item => item.cohort !== 'developed')
    .map(item => item.id))
  const partialVerifications = cases
    .filter(item => partialIds.has(item.fixtureId))
    .map(item => item.verifications['creative-reliability'])
    .filter(item => item.status === 'succeeded')
  const partialProgress = partialVerifications.length
    ? partialVerifications.filter(item => item.narrativeProgressed && !item.infodumpOnly).length
      / partialVerifications.length
    : 0
  if (partialProgress < thresholds.minimumPartialSettingProgressRate) failures.push('partial-setting-progress')
  if (aggregate.comparison.semanticRegression > thresholds.maximumSemanticRegression) {
    failures.push('semantic-quality-regression')
  }
  if (cases.some(item => Object.values(item.generations).some(
    generation => generation.calls.some(call => call.usage?.usageSource !== 'provider'),
  ))) failures.push('generation-usage-incomplete')
  if (current.verifierCompletionRate < 1 || cases.some(item => Object.values(item.verifications).some(
    verification => verification.status !== 'succeeded'
      || verification.calls.some(call => call.usage?.usageSource !== 'provider'),
  ))) failures.push('verifier-evidence-incomplete')
  return { passed: failures.length === 0, failures, thresholds }
}

function evaluateCommunityGate(
  machineGate: CreativeReliabilityMachineGateV1,
  aggregate: CreativeReliabilityEvalAggregateV1,
): CreativeReliabilityCommunityGateV1 {
  const minimumHumanReviews = aggregate.creativeReliability.caseCount
  const thresholds = {
    minimumHumanReviews,
    ...CREATIVE_RELIABILITY_COMMUNITY_THRESHOLDS_V1,
  }
  const failures: CreativeReliabilityCommunityGateV1['failures'] = []
  if (!machineGate.passed) failures.push('machine-gate')
  if (
    aggregate.creativeReliability.humanReviewCount < minimumHumanReviews
    || aggregate.legacyDirect.humanReviewCount < minimumHumanReviews
  ) failures.push('human-review-incomplete')
  if (
    aggregate.creativeReliability.willingToEditRate == null
    || aggregate.creativeReliability.willingToEditRate < thresholds.minimumWillingToEditRate
  ) failures.push('willing-to-edit-rate')
  if (
    aggregate.comparison.willingToEditDelta == null
    || aggregate.comparison.willingToEditDelta < thresholds.minimumWillingToEditImprovement
  ) failures.push('willing-to-edit-improvement')
  return { passed: failures.length === 0, failures, thresholds }
}

async function sealRecord(
  body: Omit<CreativeReliabilityEvalRecordV1, 'recordHash'>,
): Promise<CreativeReliabilityEvalRecordV1> {
  return { ...body, recordHash: await hashCanonicalValue(body) }
}

export async function createCreativeReliabilityEvalRecordV1(input: {
  suiteVersion: string
  runId: string
  createdAt: number
  codeRevision: string
  fixtures: readonly CreativeReliabilityFixtureV1[]
  generator: CreativeReliabilityEvalRecordV1['generator']
  verifier: CreativeReliabilityEvalRecordV1['verifier']
  parameters: CreativeReliabilityEvalRecordV1['parameters']
  cases: CreativeReliabilityEvalCaseV1[]
}): Promise<CreativeReliabilityEvalRecordV1> {
  if (!input.fixtures.length) throw new Error('CREL 评测集不能为空')
  const split = input.fixtures[0].split
  if (input.fixtures.some(item => item.split !== split)) throw new Error('CREL 单次记录不得混合 split')
  if (input.cases.length !== input.fixtures.length) throw new Error('CREL case 数量与 fixture 不一致')
  if (new Set(input.fixtures.map(item => item.id)).size !== input.fixtures.length) throw new Error('CREL fixture ID 重复')
  for (let index = 0; index < input.fixtures.length; index++) {
    await validateCase(input.cases[index], input.fixtures[index], input.generator, input.verifier)
  }
  const bindings = await fixtureBindings(input.fixtures)
  const aggregate = aggregateCreativeReliabilityEvalV1(input.cases)
  const machineGate = evaluateMachineGate(input.cases, bindings, aggregate)
  const communityGate = evaluateCommunityGate(machineGate, aggregate)
  return await sealRecord({
    version: 1,
    suiteVersion: input.suiteVersion,
    runId: input.runId,
    createdAt: input.createdAt,
    codeRevision: input.codeRevision,
    split,
    generator: input.generator,
    verifier: input.verifier,
    parameters: input.parameters,
    fixtureBindings: bindings,
    fixtureSetHash: await hashCanonicalValue(bindings),
    cases: structuredClone(input.cases),
    aggregate,
    machineGate,
    communityGate,
  })
}

export async function applyCreativeReliabilityHumanReviewsV1(
  record: CreativeReliabilityEvalRecordV1,
  fixtures: readonly CreativeReliabilityFixtureV1[],
  reviews: Readonly<Record<string, CreativeReliabilityHumanReviewV1>>,
): Promise<CreativeReliabilityEvalRecordV1> {
  if (!await verifyCreativeReliabilityEvalRecordV1(record, fixtures)) {
    throw new Error('CREL 原记录验签失败')
  }
  const cases = record.cases.map(item => ({
    ...item,
    humanReview: reviews[item.fixtureId] ?? item.humanReview,
  }))
  return await createCreativeReliabilityEvalRecordV1({
    suiteVersion: record.suiteVersion,
    runId: record.runId,
    createdAt: record.createdAt,
    codeRevision: record.codeRevision,
    fixtures,
    generator: record.generator,
    verifier: record.verifier,
    parameters: record.parameters,
    cases,
  })
}

export async function verifyCreativeReliabilityEvalRecordV1(
  record: CreativeReliabilityEvalRecordV1,
  fixtures: readonly CreativeReliabilityFixtureV1[],
): Promise<boolean> {
  try {
    if (!exactKeys(record, [
      'version', 'suiteVersion', 'runId', 'createdAt', 'codeRevision', 'split', 'generator', 'verifier',
      'parameters', 'fixtureBindings', 'fixtureSetHash', 'cases', 'aggregate', 'machineGate',
      'communityGate', 'recordHash',
    ])) return false
    if (record.version !== 1 || !isHash(record.fixtureSetHash) || !isHash(record.recordHash)) return false
    const expected = await createCreativeReliabilityEvalRecordV1({
      suiteVersion: record.suiteVersion,
      runId: record.runId,
      createdAt: record.createdAt,
      codeRevision: record.codeRevision,
      fixtures,
      generator: record.generator,
      verifier: record.verifier,
      parameters: record.parameters,
      cases: record.cases,
    })
    return JSON.stringify(expected) === JSON.stringify(record)
  } catch {
    return false
  }
}

export async function exportCreativeReliabilityEvalRecordV1(
  record: CreativeReliabilityEvalRecordV1,
  fixtures: readonly CreativeReliabilityFixtureV1[],
): Promise<string> {
  if (!await verifyCreativeReliabilityEvalRecordV1(record, fixtures)) {
    throw new Error('CREL 记录验签失败，拒绝导出')
  }
  return JSON.stringify(record, null, 2)
}

export async function importCreativeReliabilityEvalRecordV1(
  raw: string,
  fixtures: readonly CreativeReliabilityFixtureV1[],
): Promise<CreativeReliabilityEvalRecordV1> {
  const parsed = JSON.parse(raw) as CreativeReliabilityEvalRecordV1
  if (!await verifyCreativeReliabilityEvalRecordV1(parsed, fixtures)) {
    throw new Error('CREL 导入记录验签失败')
  }
  return parsed
}

export function claimCreativeReliabilityHeldoutRunV1(input: {
  runId: string
  fixtureSetHash: string
}): void {
  if (!isHash(input.fixtureSetHash)) throw new Error('heldout fixtureSetHash 无效')
  const raw = localStorage.getItem(CREATIVE_RELIABILITY_HELDOUT_CLAIM_KEY_V1)
  if (raw) {
    const existing = JSON.parse(raw) as { runId?: string; fixtureSetHash?: string }
    if (existing.runId === input.runId && existing.fixtureSetHash === input.fixtureSetHash) return
    throw new Error('sealed heldout 已经被运行过；不得清除失败样例后重新调参或重跑')
  }
  localStorage.setItem(CREATIVE_RELIABILITY_HELDOUT_CLAIM_KEY_V1, JSON.stringify({
    version: 1,
    runId: input.runId,
    fixtureSetHash: input.fixtureSetHash,
    claimedAt: Date.now(),
  }))
}
