import type { AgentHarnessBenchmarkArtifactV1 } from '../../types/agent-run'
import { createAgentHarnessBenchmarkArtifactV1, parseAgentHarnessBenchmarkArtifactV1, verifyAgentHarnessBenchmarkArtifactV1 } from '../../agent/run/benchmark-artifact'
import { canonicalStringify, hashCanonicalValue } from '../../agent/run/hash'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readBoolean,
  readEnum,
  readHash,
  readInteger,
  readNonNegativeNumber,
  readRecord,
  readString,
} from '../../agent/run/schema-utils'
import type {
  AgentHarnessWorkflowAggregateV1,
  AgentHarnessWorkflowCasePairV1,
  AgentHarnessWorkflowCaseResultV1,
  AgentHarnessWorkflowExecutionResultV1,
  AgentHarnessWorkflowExecutionV1,
  AgentHarnessWorkflowFixtureV1,
  AgentHarnessWorkflowGateFailureV1,
  AgentHarnessWorkflowGateV1,
  AgentHarnessWorkflowGeneratorV1,
  AgentHarnessWorkflowPairedRecordV1,
  AgentHarnessWorkflowSplitV1,
  AgentHarnessWorkflowThresholdsV1,
  AgentHarnessWorkflowVariantAggregateV1,
  AgentHarnessWorkflowVariantV1,
  AgentHarnessWorkflowVerifierResultV1,
} from './types'
import { AGENT_HARNESS_WORKFLOW_VARIANTS } from './types'

export const H26_WORKFLOW_PAIRED_RESULTS_STORAGE_KEY = 'storyforge:h26-workflow-paired-eval-v1'

export const H26_WORKFLOW_PAIRED_THRESHOLDS: AgentHarnessWorkflowThresholdsV1 = {
  minimumPairedCases: 6,
  maximumSemanticQualityRegression: 0.02,
  maximumEvidenceRegression: 0.02,
  minimumCompletionRate: 1,
  minimumReceiptCoverage: 1,
  maximumFutureLeakageRate: 0,
  maximumWrongWorldLeakageRate: 0,
  maximumP95LatencyRatio: 0.9,
  maximumTokenMultiplier: 1.15,
  maximumCostMultiplier: 1.15,
}

const VARIANTS = AGENT_HARNESS_WORKFLOW_VARIANTS
const GATE_FAILURES = [
  'minimum-paired-cases',
  'sequential-completion',
  'fan-out-completion',
  'sequential-receipt-coverage',
  'fan-out-receipt-coverage',
  'semantic-quality-noninferiority',
  'evidence-noninferiority',
  'fan-out-future-leakage',
  'fan-out-wrong-world-leakage',
  'p95-latency-benefit',
  'token-budget',
  'cost-evidence-missing',
  'cost-budget',
] as const satisfies readonly AgentHarnessWorkflowGateFailureV1[]

interface RawCase {
  execution: AgentHarnessWorkflowExecutionResultV1
  score: AgentHarnessWorkflowVerifierResultV1
}

function positiveNumber(value: unknown, path: string): number {
  const parsed = readNonNegativeNumber(value, path)
  if (parsed <= 0) failSchema('invalid_value', path, '必须大于 0')
  return parsed
}

function unitNumber(value: unknown, path: string): number {
  const parsed = readNonNegativeNumber(value, path)
  if (parsed > 1) failSchema('invalid_value', path, '必须在 0 到 1 之间')
  return parsed
}

function nullableNonNegativeNumber(value: unknown, path: string): number | null {
  return value === null ? null : readNonNegativeNumber(value, path)
}

function parseGenerator(value: unknown, path: string): AgentHarnessWorkflowGeneratorV1 {
  const record = readRecord(value, path)
  const keys = ['provider', 'model', 'promptVersion', 'toolSchemaVersion'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    provider: readString(record.provider, `${path}.provider`, { max: 120 }),
    model: readString(record.model, `${path}.model`, { max: 200 }),
    promptVersion: readString(record.promptVersion, `${path}.promptVersion`, { max: 160 }),
    toolSchemaVersion: readString(record.toolSchemaVersion, `${path}.toolSchemaVersion`, { max: 160 }),
  }
}

function parseExecution(value: unknown, path: string): AgentHarnessWorkflowExecutionV1 {
  const record = readRecord(value, path)
  const keys = ['generator', 'verifier'] as const
  assertExactKeys(record, keys, keys, path)
  const verifier = readRecord(record.verifier, `${path}.verifier`)
  const verifierKeys = ['provider', 'model', 'promptVersion'] as const
  assertExactKeys(verifier, verifierKeys, verifierKeys, `${path}.verifier`)
  return {
    generator: parseGenerator(record.generator, `${path}.generator`),
    verifier: {
      provider: readString(verifier.provider, `${path}.verifier.provider`, { max: 120 }),
      model: readString(verifier.model, `${path}.verifier.model`, { max: 200 }),
      promptVersion: readString(verifier.promptVersion, `${path}.verifier.promptVersion`, { max: 160 }),
    },
  }
}

function parseFixture(value: unknown, path: string): AgentHarnessWorkflowFixtureV1 {
  const record = readRecord(value, path)
  const keys = ['id', 'split', 'contentHash', 'inputHash', 'planHash'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    id: readString(record.id, `${path}.id`, { max: 160 }),
    split: readEnum(record.split, ['development', 'held-out'], `${path}.split`),
    contentHash: readHash(record.contentHash, `${path}.contentHash`),
    inputHash: readHash(record.inputHash, `${path}.inputHash`),
    planHash: readHash(record.planHash, `${path}.planHash`),
  }
}

function parseReceiptHashes(value: unknown, path: string): string[] {
  const hashes = readArray(value, path).map((item, index) => readHash(item, `${path}[${index}]`))
  assertUnique(hashes, path)
  return hashes
}

function parseCaseResult(value: unknown, path: string): AgentHarnessWorkflowCaseResultV1 {
  const record = readRecord(value, path)
  const keys = [
    'fixtureId',
    'variant',
    'outputHash',
    'traceHash',
    'receiptHashes',
    'expectedReceiptCount',
    'completed',
    'successfulSteps',
    'failedSteps',
    'modelCalls',
    'toolCalls',
    'inputTokens',
    'outputTokens',
    'latencyMs',
    'costUsd',
    'semanticScore',
    'evidenceCoverage',
    'futureLeakage',
    'wrongWorldLeakage',
  ] as const
  assertExactKeys(record, keys, keys, path)
  const receipts = parseReceiptHashes(record.receiptHashes, `${path}.receiptHashes`)
  const expectedReceiptCount = readInteger(record.expectedReceiptCount, `${path}.expectedReceiptCount`, { min: 1 })
  if (receipts.length > expectedReceiptCount) {
    failSchema('invalid_value', `${path}.receiptHashes`, '不得超过预期回执数')
  }
  const successfulSteps = readInteger(record.successfulSteps, `${path}.successfulSteps`)
  const failedSteps = readInteger(record.failedSteps, `${path}.failedSteps`)
  if (successfulSteps + failedSteps < 1) failSchema('invalid_value', path, '必须包含至少一个步骤')
  const completed = readBoolean(record.completed, `${path}.completed`)
  if (completed && failedSteps > 0) failSchema('invalid_value', path, '完成结果不得包含失败步骤')
  if (completed && successfulSteps !== expectedReceiptCount) {
    failSchema('invalid_value', path, '完成结果的成功步骤数必须等于预期回执数')
  }
  return {
    fixtureId: readString(record.fixtureId, `${path}.fixtureId`, { max: 160 }),
    variant: readEnum(record.variant, VARIANTS, `${path}.variant`),
    outputHash: readHash(record.outputHash, `${path}.outputHash`),
    traceHash: readHash(record.traceHash, `${path}.traceHash`),
    receiptHashes: receipts,
    expectedReceiptCount,
    completed,
    successfulSteps,
    failedSteps,
    modelCalls: readInteger(record.modelCalls, `${path}.modelCalls`, { min: 1 }),
    toolCalls: readInteger(record.toolCalls, `${path}.toolCalls`),
    inputTokens: readInteger(record.inputTokens, `${path}.inputTokens`, { min: 1 }),
    outputTokens: readInteger(record.outputTokens, `${path}.outputTokens`, { min: 1 }),
    latencyMs: positiveNumber(record.latencyMs, `${path}.latencyMs`),
    costUsd: readNonNegativeNumber(record.costUsd, `${path}.costUsd`),
    semanticScore: unitNumber(record.semanticScore, `${path}.semanticScore`),
    evidenceCoverage: unitNumber(record.evidenceCoverage, `${path}.evidenceCoverage`),
    futureLeakage: readBoolean(record.futureLeakage, `${path}.futureLeakage`),
    wrongWorldLeakage: readBoolean(record.wrongWorldLeakage, `${path}.wrongWorldLeakage`),
  }
}

function parseCasePair(value: unknown, path: string): AgentHarnessWorkflowCasePairV1 {
  const record = readRecord(value, path)
  const keys = ['fixtureId', 'executionOrder', 'sequential', 'fanOut'] as const
  assertExactKeys(record, keys, keys, path)
  const executionOrder = readArray(record.executionOrder, `${path}.executionOrder`)
    .map((item, index) => readEnum(item, VARIANTS, `${path}.executionOrder[${index}]`))
  if (executionOrder.length !== 2 || new Set(executionOrder).size !== 2) {
    failSchema('invalid_value', `${path}.executionOrder`, '必须且只能包含两个不同变体')
  }
  return {
    fixtureId: readString(record.fixtureId, `${path}.fixtureId`, { max: 160 }),
    executionOrder: executionOrder as [AgentHarnessWorkflowVariantV1, AgentHarnessWorkflowVariantV1],
    sequential: parseCaseResult(record.sequential, `${path}.sequential`),
    fanOut: parseCaseResult(record.fanOut, `${path}.fanOut`),
  }
}

function parseVariantAggregate(value: unknown, path: string): AgentHarnessWorkflowVariantAggregateV1 {
  const record = readRecord(value, path)
  const keys = [
    'caseCount',
    'completionRate',
    'receiptCoverage',
    'semanticScore',
    'evidenceCoverage',
    'futureLeakageRate',
    'wrongWorldLeakageRate',
    'successfulSteps',
    'failedSteps',
    'modelCalls',
    'toolCalls',
    'inputTokens',
    'outputTokens',
    'totalLatencyMs',
    'p95LatencyMs',
    'costUsd',
  ] as const
  assertExactKeys(record, keys, keys, path)
  return {
    caseCount: readInteger(record.caseCount, `${path}.caseCount`, { min: 1 }),
    completionRate: unitNumber(record.completionRate, `${path}.completionRate`),
    receiptCoverage: unitNumber(record.receiptCoverage, `${path}.receiptCoverage`),
    semanticScore: unitNumber(record.semanticScore, `${path}.semanticScore`),
    evidenceCoverage: unitNumber(record.evidenceCoverage, `${path}.evidenceCoverage`),
    futureLeakageRate: unitNumber(record.futureLeakageRate, `${path}.futureLeakageRate`),
    wrongWorldLeakageRate: unitNumber(record.wrongWorldLeakageRate, `${path}.wrongWorldLeakageRate`),
    successfulSteps: readInteger(record.successfulSteps, `${path}.successfulSteps`),
    failedSteps: readInteger(record.failedSteps, `${path}.failedSteps`),
    modelCalls: readInteger(record.modelCalls, `${path}.modelCalls`, { min: 1 }),
    toolCalls: readInteger(record.toolCalls, `${path}.toolCalls`),
    inputTokens: readInteger(record.inputTokens, `${path}.inputTokens`, { min: 1 }),
    outputTokens: readInteger(record.outputTokens, `${path}.outputTokens`, { min: 1 }),
    totalLatencyMs: positiveNumber(record.totalLatencyMs, `${path}.totalLatencyMs`),
    p95LatencyMs: positiveNumber(record.p95LatencyMs, `${path}.p95LatencyMs`),
    costUsd: readNonNegativeNumber(record.costUsd, `${path}.costUsd`),
  }
}

function parseAggregate(value: unknown, path: string): AgentHarnessWorkflowAggregateV1 {
  const record = readRecord(value, path)
  const keys = ['sequential', 'fanOut', 'comparison'] as const
  assertExactKeys(record, keys, keys, path)
  const comparison = readRecord(record.comparison, `${path}.comparison`)
  const comparisonKeys = [
    'semanticQualityRegression',
    'evidenceRegression',
    'p95LatencyRatio',
    'tokenMultiplier',
    'costMultiplier',
  ] as const
  assertExactKeys(comparison, comparisonKeys, comparisonKeys, `${path}.comparison`)
  return {
    sequential: parseVariantAggregate(record.sequential, `${path}.sequential`),
    fanOut: parseVariantAggregate(record.fanOut, `${path}.fanOut`),
    comparison: {
      semanticQualityRegression: readNonNegativeNumber(
        comparison.semanticQualityRegression,
        `${path}.comparison.semanticQualityRegression`,
      ),
      evidenceRegression: readNonNegativeNumber(comparison.evidenceRegression, `${path}.comparison.evidenceRegression`),
      p95LatencyRatio: readNonNegativeNumber(comparison.p95LatencyRatio, `${path}.comparison.p95LatencyRatio`),
      tokenMultiplier: readNonNegativeNumber(comparison.tokenMultiplier, `${path}.comparison.tokenMultiplier`),
      costMultiplier: nullableNonNegativeNumber(comparison.costMultiplier, `${path}.comparison.costMultiplier`),
    },
  }
}

function parseThresholds(value: unknown, path: string): AgentHarnessWorkflowThresholdsV1 {
  const record = readRecord(value, path)
  const keys = [
    'minimumPairedCases',
    'maximumSemanticQualityRegression',
    'maximumEvidenceRegression',
    'minimumCompletionRate',
    'minimumReceiptCoverage',
    'maximumFutureLeakageRate',
    'maximumWrongWorldLeakageRate',
    'maximumP95LatencyRatio',
    'maximumTokenMultiplier',
    'maximumCostMultiplier',
  ] as const
  assertExactKeys(record, keys, keys, path)
  const thresholds: AgentHarnessWorkflowThresholdsV1 = {
    minimumPairedCases: readInteger(record.minimumPairedCases, `${path}.minimumPairedCases`, { min: 1 }),
    maximumSemanticQualityRegression: unitNumber(record.maximumSemanticQualityRegression, `${path}.maximumSemanticQualityRegression`),
    maximumEvidenceRegression: unitNumber(record.maximumEvidenceRegression, `${path}.maximumEvidenceRegression`),
    minimumCompletionRate: unitNumber(record.minimumCompletionRate, `${path}.minimumCompletionRate`),
    minimumReceiptCoverage: unitNumber(record.minimumReceiptCoverage, `${path}.minimumReceiptCoverage`),
    maximumFutureLeakageRate: unitNumber(record.maximumFutureLeakageRate, `${path}.maximumFutureLeakageRate`),
    maximumWrongWorldLeakageRate: unitNumber(record.maximumWrongWorldLeakageRate, `${path}.maximumWrongWorldLeakageRate`),
    maximumP95LatencyRatio: readNonNegativeNumber(record.maximumP95LatencyRatio, `${path}.maximumP95LatencyRatio`),
    maximumTokenMultiplier: readNonNegativeNumber(record.maximumTokenMultiplier, `${path}.maximumTokenMultiplier`),
    maximumCostMultiplier: readNonNegativeNumber(record.maximumCostMultiplier, `${path}.maximumCostMultiplier`),
  }
  const baseline = H26_WORKFLOW_PAIRED_THRESHOLDS
  const weaker = thresholds.minimumPairedCases < baseline.minimumPairedCases
    || thresholds.maximumSemanticQualityRegression > baseline.maximumSemanticQualityRegression
    || thresholds.maximumEvidenceRegression > baseline.maximumEvidenceRegression
    || thresholds.minimumCompletionRate < baseline.minimumCompletionRate
    || thresholds.minimumReceiptCoverage < baseline.minimumReceiptCoverage
    || thresholds.maximumFutureLeakageRate > baseline.maximumFutureLeakageRate
    || thresholds.maximumWrongWorldLeakageRate > baseline.maximumWrongWorldLeakageRate
    || thresholds.maximumP95LatencyRatio > baseline.maximumP95LatencyRatio
    || thresholds.maximumTokenMultiplier > baseline.maximumTokenMultiplier
    || thresholds.maximumCostMultiplier > baseline.maximumCostMultiplier
  if (weaker) failSchema('invalid_value', path, '不得弱于 HARNESS-26 默认发布门')
  return thresholds
}

function parseGate(value: unknown, path: string): AgentHarnessWorkflowGateV1 {
  const record = readRecord(value, path)
  const keys = ['passed', 'failures'] as const
  assertExactKeys(record, keys, keys, path)
  const failures = readArray(record.failures, `${path}.failures`)
    .map((item, index) => readEnum(item, GATE_FAILURES, `${path}.failures[${index}]`))
  assertUnique(failures, `${path}.failures`)
  const passed = readBoolean(record.passed, `${path}.passed`)
  if (passed !== (failures.length === 0)) failSchema('invalid_value', path, 'passed 与 failures 不一致')
  return { passed, failures }
}

function parseArtifacts(value: unknown, path: string): AgentHarnessWorkflowPairedRecordV1['artifacts'] {
  const record = readRecord(value, path)
  const keys = ['sequential', 'fanOut'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    sequential: parseAgentHarnessBenchmarkArtifactV1(record.sequential),
    fanOut: parseAgentHarnessBenchmarkArtifactV1(record.fanOut),
  }
}

export function parseAgentHarnessWorkflowPairedRecordV1(value: unknown): AgentHarnessWorkflowPairedRecordV1 {
  const record = readRecord(value, 'pairedRecord')
  const keys = [
    'version',
    'createdAt',
    'codeRevision',
    'split',
    'execution',
    'fixtures',
    'fixtureSetHash',
    'cases',
    'artifacts',
    'aggregate',
    'thresholds',
    'gate',
    'recordHash',
  ] as const
  assertExactKeys(record, keys, keys, 'pairedRecord')
  if (record.version !== 1) failSchema('unsupported_version', 'pairedRecord.version', '仅支持版本 1')
  const fixtures = readArray(record.fixtures, 'pairedRecord.fixtures')
    .map((item, index) => parseFixture(item, `pairedRecord.fixtures[${index}]`))
  if (fixtures.length === 0) failSchema('invalid_value', 'pairedRecord.fixtures', '不得为空')
  assertUnique(fixtures.map(fixture => fixture.id), 'pairedRecord.fixtures.id')
  const cases = readArray(record.cases, 'pairedRecord.cases')
    .map((item, index) => parseCasePair(item, `pairedRecord.cases[${index}]`))
  if (cases.length === 0) failSchema('invalid_value', 'pairedRecord.cases', '不得为空')
  assertUnique(cases.map(item => item.fixtureId), 'pairedRecord.cases.fixtureId')
  return {
    version: 1,
    createdAt: readInteger(record.createdAt, 'pairedRecord.createdAt'),
    codeRevision: readString(record.codeRevision, 'pairedRecord.codeRevision', { max: 120 }),
    split: readEnum(record.split, ['development', 'held-out'], 'pairedRecord.split'),
    execution: parseExecution(record.execution, 'pairedRecord.execution'),
    fixtures,
    fixtureSetHash: readHash(record.fixtureSetHash, 'pairedRecord.fixtureSetHash'),
    cases,
    artifacts: parseArtifacts(record.artifacts, 'pairedRecord.artifacts'),
    aggregate: parseAggregate(record.aggregate, 'pairedRecord.aggregate'),
    thresholds: parseThresholds(record.thresholds, 'pairedRecord.thresholds'),
    gate: parseGate(record.gate, 'pairedRecord.gate'),
    recordHash: readHash(record.recordHash, 'pairedRecord.recordHash'),
  }
}

function executionEquals(left: AgentHarnessWorkflowGeneratorV1, right: AgentHarnessWorkflowGeneratorV1): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

function executionOrder(index: number): [AgentHarnessWorkflowVariantV1, AgentHarnessWorkflowVariantV1] {
  return index % 2 === 0 ? ['sequential', 'fan-out'] : ['fan-out', 'sequential']
}

function p95(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]
}

function aggregateVariant(results: readonly AgentHarnessWorkflowCaseResultV1[]): AgentHarnessWorkflowVariantAggregateV1 {
  const count = results.length
  const sum = (read: (result: AgentHarnessWorkflowCaseResultV1) => number): number => (
    results.reduce((total, result) => total + read(result), 0)
  )
  const expectedReceipts = sum(result => result.expectedReceiptCount)
  return {
    caseCount: count,
    completionRate: sum(result => Number(result.completed)) / count,
    receiptCoverage: expectedReceipts > 0 ? sum(result => result.receiptHashes.length) / expectedReceipts : 0,
    semanticScore: sum(result => result.semanticScore) / count,
    evidenceCoverage: sum(result => result.evidenceCoverage) / count,
    futureLeakageRate: sum(result => Number(result.futureLeakage)) / count,
    wrongWorldLeakageRate: sum(result => Number(result.wrongWorldLeakage)) / count,
    successfulSteps: sum(result => result.successfulSteps),
    failedSteps: sum(result => result.failedSteps),
    modelCalls: sum(result => result.modelCalls),
    toolCalls: sum(result => result.toolCalls),
    inputTokens: sum(result => result.inputTokens),
    outputTokens: sum(result => result.outputTokens),
    totalLatencyMs: sum(result => result.latencyMs),
    p95LatencyMs: p95(results.map(result => result.latencyMs)),
    costUsd: sum(result => result.costUsd),
  }
}

export function aggregateAgentHarnessWorkflowPairsV1(
  pairs: readonly AgentHarnessWorkflowCasePairV1[],
): AgentHarnessWorkflowAggregateV1 {
  if (pairs.length === 0) throw new Error('HARNESS-26 配对评测至少需要一个样例')
  const sequential = aggregateVariant(pairs.map(pair => pair.sequential))
  const fanOut = aggregateVariant(pairs.map(pair => pair.fanOut))
  const sequentialTokens = sequential.inputTokens + sequential.outputTokens
  const fanOutTokens = fanOut.inputTokens + fanOut.outputTokens
  return {
    sequential,
    fanOut,
    comparison: {
      semanticQualityRegression: Math.max(0, sequential.semanticScore - fanOut.semanticScore),
      evidenceRegression: Math.max(0, sequential.evidenceCoverage - fanOut.evidenceCoverage),
      p95LatencyRatio: fanOut.p95LatencyMs / sequential.p95LatencyMs,
      tokenMultiplier: fanOutTokens / sequentialTokens,
      costMultiplier: sequential.costUsd > 0 ? fanOut.costUsd / sequential.costUsd : null,
    },
  }
}

export function evaluateAgentHarnessWorkflowGateV1(input: {
  aggregate: AgentHarnessWorkflowAggregateV1
  thresholds?: AgentHarnessWorkflowThresholdsV1
}): AgentHarnessWorkflowGateV1 {
  const thresholds = parseThresholds(input.thresholds ?? H26_WORKFLOW_PAIRED_THRESHOLDS, 'thresholds')
  const { sequential, fanOut, comparison } = input.aggregate
  const failures: AgentHarnessWorkflowGateFailureV1[] = []
  if (sequential.caseCount < thresholds.minimumPairedCases || fanOut.caseCount < thresholds.minimumPairedCases) {
    failures.push('minimum-paired-cases')
  }
  if (sequential.completionRate < thresholds.minimumCompletionRate) failures.push('sequential-completion')
  if (fanOut.completionRate < thresholds.minimumCompletionRate) failures.push('fan-out-completion')
  if (sequential.receiptCoverage < thresholds.minimumReceiptCoverage) failures.push('sequential-receipt-coverage')
  if (fanOut.receiptCoverage < thresholds.minimumReceiptCoverage) failures.push('fan-out-receipt-coverage')
  if (comparison.semanticQualityRegression > thresholds.maximumSemanticQualityRegression) {
    failures.push('semantic-quality-noninferiority')
  }
  if (comparison.evidenceRegression > thresholds.maximumEvidenceRegression) failures.push('evidence-noninferiority')
  if (fanOut.futureLeakageRate > thresholds.maximumFutureLeakageRate) failures.push('fan-out-future-leakage')
  if (fanOut.wrongWorldLeakageRate > thresholds.maximumWrongWorldLeakageRate) {
    failures.push('fan-out-wrong-world-leakage')
  }
  if (comparison.p95LatencyRatio > thresholds.maximumP95LatencyRatio) failures.push('p95-latency-benefit')
  if (comparison.tokenMultiplier > thresholds.maximumTokenMultiplier) failures.push('token-budget')
  if (sequential.costUsd <= 0 || fanOut.costUsd <= 0 || comparison.costMultiplier === null) {
    failures.push('cost-evidence-missing')
  } else if (comparison.costMultiplier > thresholds.maximumCostMultiplier) {
    failures.push('cost-budget')
  }
  return { passed: failures.length === 0, failures }
}

function parseExecutionResult(
  value: unknown,
  fixture: AgentHarnessWorkflowFixtureV1,
  expectedExecution: AgentHarnessWorkflowGeneratorV1,
  path: string,
): AgentHarnessWorkflowExecutionResultV1 {
  const record = readRecord(value, path)
  const keys = [
    'output',
    'contentHash',
    'inputHash',
    'planHash',
    'execution',
    'traceHash',
    'receiptHashes',
    'expectedReceiptCount',
    'completed',
    'successfulSteps',
    'failedSteps',
    'modelCalls',
    'toolCalls',
    'inputTokens',
    'outputTokens',
    'latencyMs',
    'costUsd',
  ] as const
  assertExactKeys(record, keys, keys, path)
  const result: AgentHarnessWorkflowExecutionResultV1 = {
    output: readString(record.output, `${path}.output`),
    contentHash: readHash(record.contentHash, `${path}.contentHash`),
    inputHash: readHash(record.inputHash, `${path}.inputHash`),
    planHash: readHash(record.planHash, `${path}.planHash`),
    execution: parseGenerator(record.execution, `${path}.execution`),
    traceHash: readHash(record.traceHash, `${path}.traceHash`),
    receiptHashes: parseReceiptHashes(record.receiptHashes, `${path}.receiptHashes`),
    expectedReceiptCount: readInteger(record.expectedReceiptCount, `${path}.expectedReceiptCount`, { min: 1 }),
    completed: readBoolean(record.completed, `${path}.completed`),
    successfulSteps: readInteger(record.successfulSteps, `${path}.successfulSteps`),
    failedSteps: readInteger(record.failedSteps, `${path}.failedSteps`),
    modelCalls: readInteger(record.modelCalls, `${path}.modelCalls`, { min: 1 }),
    toolCalls: readInteger(record.toolCalls, `${path}.toolCalls`),
    inputTokens: readInteger(record.inputTokens, `${path}.inputTokens`, { min: 1 }),
    outputTokens: readInteger(record.outputTokens, `${path}.outputTokens`, { min: 1 }),
    latencyMs: positiveNumber(record.latencyMs, `${path}.latencyMs`),
    costUsd: readNonNegativeNumber(record.costUsd, `${path}.costUsd`),
  }
  if (
    result.contentHash !== fixture.contentHash
    || result.inputHash !== fixture.inputHash
    || result.planHash !== fixture.planHash
  ) failSchema('binding_mismatch', path, '执行结果与冻结 fixture/input/plan 不一致')
  if (!executionEquals(result.execution, expectedExecution)) {
    failSchema('binding_mismatch', `${path}.execution`, '执行结果与冻结生成器版本不一致')
  }
  if (result.receiptHashes.length > result.expectedReceiptCount) {
    failSchema('invalid_value', `${path}.receiptHashes`, '不得超过预期回执数')
  }
  if (result.successfulSteps + result.failedSteps < 1) failSchema('invalid_value', path, '必须包含至少一个步骤')
  if (result.completed && result.failedSteps > 0) failSchema('invalid_value', path, '完成结果不得包含失败步骤')
  if (result.completed && result.successfulSteps !== result.expectedReceiptCount) {
    failSchema('invalid_value', path, '完成结果的成功步骤数必须等于预期回执数')
  }
  return result
}

function parseVerifierResult(value: unknown, path: string): AgentHarnessWorkflowVerifierResultV1 {
  const record = readRecord(value, path)
  const keys = ['semanticScore', 'evidenceCoverage', 'futureLeakage', 'wrongWorldLeakage'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    semanticScore: unitNumber(record.semanticScore, `${path}.semanticScore`),
    evidenceCoverage: unitNumber(record.evidenceCoverage, `${path}.evidenceCoverage`),
    futureLeakage: readBoolean(record.futureLeakage, `${path}.futureLeakage`),
    wrongWorldLeakage: readBoolean(record.wrongWorldLeakage, `${path}.wrongWorldLeakage`),
  }
}

async function caseResult(
  fixture: AgentHarnessWorkflowFixtureV1,
  variant: AgentHarnessWorkflowVariantV1,
  raw: RawCase,
): Promise<AgentHarnessWorkflowCaseResultV1> {
  return parseCaseResult({
    fixtureId: fixture.id,
    variant,
    outputHash: await hashCanonicalValue(raw.execution.output),
    traceHash: raw.execution.traceHash,
    receiptHashes: raw.execution.receiptHashes,
    expectedReceiptCount: raw.execution.expectedReceiptCount,
    completed: raw.execution.completed,
    successfulSteps: raw.execution.successfulSteps,
    failedSteps: raw.execution.failedSteps,
    modelCalls: raw.execution.modelCalls,
    toolCalls: raw.execution.toolCalls,
    inputTokens: raw.execution.inputTokens,
    outputTokens: raw.execution.outputTokens,
    latencyMs: raw.execution.latencyMs,
    costUsd: raw.execution.costUsd,
    semanticScore: raw.score.semanticScore,
    evidenceCoverage: raw.score.evidenceCoverage,
    futureLeakage: raw.score.futureLeakage,
    wrongWorldLeakage: raw.score.wrongWorldLeakage,
  }, `case(${fixture.id},${variant})`)
}

function benchmarkMetrics(aggregate: AgentHarnessWorkflowVariantAggregateV1): AgentHarnessBenchmarkArtifactV1['metrics'] {
  return {
    runs: aggregate.caseCount,
    successfulSteps: aggregate.successfulSteps,
    failedSteps: aggregate.failedSteps,
    modelCalls: aggregate.modelCalls,
    toolCalls: aggregate.toolCalls,
    inputTokens: aggregate.inputTokens,
    outputTokens: aggregate.outputTokens,
    latencyMs: aggregate.totalLatencyMs,
    costUsd: aggregate.costUsd,
  }
}

function recordBody(record: AgentHarnessWorkflowPairedRecordV1): Omit<AgentHarnessWorkflowPairedRecordV1, 'recordHash'> {
  const { recordHash: _recordHash, ...body } = record
  return body
}

export async function runAgentHarnessWorkflowPairedEvalV1(input: {
  fixtures: AgentHarnessWorkflowFixtureV1[]
  split: AgentHarnessWorkflowSplitV1
  codeRevision: string
  execution: AgentHarnessWorkflowExecutionV1
  execute: (input: {
    fixture: AgentHarnessWorkflowFixtureV1
    variant: AgentHarnessWorkflowVariantV1
    generator: AgentHarnessWorkflowGeneratorV1
  }) => Promise<AgentHarnessWorkflowExecutionResultV1>
  verify: (input: {
    fixture: AgentHarnessWorkflowFixtureV1
    variant: AgentHarnessWorkflowVariantV1
    output: string
    outputHash: string
    verifier: AgentHarnessWorkflowExecutionV1['verifier']
  }) => Promise<AgentHarnessWorkflowVerifierResultV1>
  thresholds?: AgentHarnessWorkflowThresholdsV1
  now?: () => number
  persist?: boolean
  onProgress?: (completed: number, total: number) => void
}): Promise<AgentHarnessWorkflowPairedRecordV1> {
  const execution = parseExecution(input.execution, 'execution')
  if (
    execution.generator.provider === execution.verifier.provider
    && execution.generator.model === execution.verifier.model
  ) throw new Error('HARNESS-26 发布评测要求生成器与评审器使用不同 provider/model 身份')
  const fixtures = input.fixtures.map((fixture, index) => parseFixture(fixture, `fixtures[${index}]`))
  if (fixtures.length === 0) throw new Error('HARNESS-26 配对评测至少需要一个样例')
  assertUnique(fixtures.map(fixture => fixture.id), 'fixtures.id')
  if (fixtures.some(fixture => fixture.split !== input.split)) throw new Error('HARNESS-26 fixture split 不一致')
  const thresholds = parseThresholds(input.thresholds ?? H26_WORKFLOW_PAIRED_THRESHOLDS, 'thresholds')
  const codeRevision = readString(input.codeRevision, 'codeRevision', { max: 120 })
  const fixtureSetHash = await hashCanonicalValue(fixtures)
  const pairs: AgentHarnessWorkflowCasePairV1[] = []

  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index]
    const order = executionOrder(index)
    const executions = new Map<AgentHarnessWorkflowVariantV1, AgentHarnessWorkflowExecutionResultV1>()
    for (const variant of order) {
      const executed = parseExecutionResult(
        await input.execute({ fixture, variant, generator: execution.generator }),
        fixture,
        execution.generator,
        `execute(${fixture.id},${variant})`,
      )
      executions.set(variant, executed)
    }
    if (executions.get('sequential')!.expectedReceiptCount !== executions.get('fan-out')!.expectedReceiptCount) {
      throw new Error(`HARNESS-26 fixture ${fixture.id} 两个变体的预期回执数不一致`)
    }
    const raw = new Map<AgentHarnessWorkflowVariantV1, RawCase>()
    for (const variant of order) {
      const executed = executions.get(variant)!
      const outputHash = await hashCanonicalValue(executed.output)
      const score = parseVerifierResult(await input.verify({
        fixture,
        variant,
        output: executed.output,
        outputHash,
        verifier: execution.verifier,
      }), `verify(${fixture.id},${variant})`)
      raw.set(variant, { execution: executed, score })
    }
    pairs.push({
      fixtureId: fixture.id,
      executionOrder: order,
      sequential: await caseResult(fixture, 'sequential', raw.get('sequential')!),
      fanOut: await caseResult(fixture, 'fan-out', raw.get('fan-out')!),
    })
    input.onProgress?.(pairs.length, fixtures.length)
  }

  const aggregate = aggregateAgentHarnessWorkflowPairsV1(pairs)
  const createdAt = input.now?.() ?? Date.now()
  const artifact = async (variant: AgentHarnessWorkflowVariantV1): Promise<AgentHarnessBenchmarkArtifactV1> => {
    const variantAggregate = variant === 'sequential' ? aggregate.sequential : aggregate.fanOut
    return createAgentHarnessBenchmarkArtifactV1({
      version: 1,
      createdAt,
      codeRevision,
      schemaVersions: { contract: 1, event: 1, manifest: 1, receipt: 1 },
      execution: execution.generator,
      fixture: {
        id: `workflow-paired:${input.split}:${variant}`,
        split: input.split,
        contentHash: fixtureSetHash,
      },
      metrics: benchmarkMetrics(variantAggregate),
      traceHashes: pairs.map(pair => (
        variant === 'sequential' ? pair.sequential.traceHash : pair.fanOut.traceHash
      )),
    })
  }
  const provisional: AgentHarnessWorkflowPairedRecordV1 = {
    version: 1,
    createdAt,
    codeRevision,
    split: input.split,
    execution,
    fixtures,
    fixtureSetHash,
    cases: pairs,
    artifacts: {
      sequential: await artifact('sequential'),
      fanOut: await artifact('fan-out'),
    },
    aggregate,
    thresholds,
    gate: evaluateAgentHarnessWorkflowGateV1({ aggregate, thresholds }),
    recordHash: '0'.repeat(64),
  }
  const record = parseAgentHarnessWorkflowPairedRecordV1({
    ...provisional,
    recordHash: await hashCanonicalValue(recordBody(provisional)),
  })
  if (input.persist) localStorage.setItem(H26_WORKFLOW_PAIRED_RESULTS_STORAGE_KEY, JSON.stringify(record))
  return record
}

function expectedArtifact(
  record: AgentHarnessWorkflowPairedRecordV1,
  variant: AgentHarnessWorkflowVariantV1,
): Omit<AgentHarnessBenchmarkArtifactV1, 'artifactHash'> {
  const aggregate = variant === 'sequential' ? record.aggregate.sequential : record.aggregate.fanOut
  return {
    version: 1,
    createdAt: record.createdAt,
    codeRevision: record.codeRevision,
    schemaVersions: { contract: 1, event: 1, manifest: 1, receipt: 1 },
    execution: record.execution.generator,
    fixture: {
      id: `workflow-paired:${record.split}:${variant}`,
      split: record.split,
      contentHash: record.fixtureSetHash,
    },
    metrics: benchmarkMetrics(aggregate),
    traceHashes: record.cases.map(pair => (
      variant === 'sequential' ? pair.sequential.traceHash : pair.fanOut.traceHash
    )),
  }
}

export async function verifyAgentHarnessWorkflowPairedRecordV1(value: unknown): Promise<boolean> {
  const record = parseAgentHarnessWorkflowPairedRecordV1(value)
  if (record.fixtures.some(fixture => fixture.split !== record.split)) return false
  if (await hashCanonicalValue(record.fixtures) !== record.fixtureSetHash) return false
  if (record.fixtures.length !== record.cases.length) return false
  for (let index = 0; index < record.fixtures.length; index += 1) {
    const fixture = record.fixtures[index]
    const pair = record.cases[index]
    if (
      pair.fixtureId !== fixture.id
      || pair.sequential.fixtureId !== fixture.id
      || pair.fanOut.fixtureId !== fixture.id
      || pair.sequential.variant !== 'sequential'
      || pair.fanOut.variant !== 'fan-out'
      || pair.sequential.expectedReceiptCount !== pair.fanOut.expectedReceiptCount
      || canonicalStringify(pair.executionOrder) !== canonicalStringify(executionOrder(index))
    ) return false
  }
  const aggregate = aggregateAgentHarnessWorkflowPairsV1(record.cases)
  if (canonicalStringify(aggregate) !== canonicalStringify(record.aggregate)) return false
  const gate = evaluateAgentHarnessWorkflowGateV1({ aggregate, thresholds: record.thresholds })
  if (canonicalStringify(gate) !== canonicalStringify(record.gate)) return false
  for (const variant of VARIANTS) {
    const artifact = variant === 'sequential' ? record.artifacts.sequential : record.artifacts.fanOut
    if (!await verifyAgentHarnessBenchmarkArtifactV1(artifact)) return false
    const { artifactHash: _artifactHash, ...body } = artifact
    if (canonicalStringify(body) !== canonicalStringify(expectedArtifact(record, variant))) return false
  }
  return await hashCanonicalValue(recordBody(record)) === record.recordHash
}
