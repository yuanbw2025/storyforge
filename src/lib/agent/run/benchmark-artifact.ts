import type { AgentHarnessBenchmarkArtifactV1 } from '../../types/agent-run'
import { hashCanonicalValue } from './hash'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readEnum,
  readHash,
  readInteger,
  readNonNegativeNumber,
  readRecord,
  readString,
} from './schema-utils'

type BenchmarkArtifactBodyV1 = Omit<AgentHarnessBenchmarkArtifactV1, 'artifactHash'>

function artifactBody(artifact: AgentHarnessBenchmarkArtifactV1): BenchmarkArtifactBodyV1 {
  const { artifactHash: _artifactHash, ...body } = artifact
  return body
}

export function parseAgentHarnessBenchmarkArtifactV1(value: unknown): AgentHarnessBenchmarkArtifactV1 {
  const record = readRecord(value, 'artifact')
  const keys = [
    'version',
    'createdAt',
    'codeRevision',
    'schemaVersions',
    'execution',
    'fixture',
    'metrics',
    'traceHashes',
    'artifactHash',
  ] as const
  assertExactKeys(record, keys, keys, 'artifact')
  if (record.version !== 1) failSchema('unsupported_version', 'artifact.version', '仅支持版本 1')

  const schemaVersions = readRecord(record.schemaVersions, 'artifact.schemaVersions')
  const schemaKeys = ['contract', 'event', 'manifest', 'receipt'] as const
  assertExactKeys(schemaVersions, schemaKeys, schemaKeys, 'artifact.schemaVersions')
  for (const key of schemaKeys) {
    if (schemaVersions[key] !== 1) failSchema('unsupported_version', `artifact.schemaVersions.${key}`, '仅支持版本 1')
  }

  const execution = readRecord(record.execution, 'artifact.execution')
  const executionKeys = ['provider', 'model', 'promptVersion', 'toolSchemaVersion'] as const
  assertExactKeys(execution, executionKeys, executionKeys, 'artifact.execution')

  const fixture = readRecord(record.fixture, 'artifact.fixture')
  const fixtureKeys = ['id', 'split', 'contentHash'] as const
  assertExactKeys(fixture, fixtureKeys, fixtureKeys, 'artifact.fixture')

  const metrics = readRecord(record.metrics, 'artifact.metrics')
  const metricKeys = [
    'runs',
    'successfulSteps',
    'failedSteps',
    'modelCalls',
    'toolCalls',
    'inputTokens',
    'outputTokens',
    'latencyMs',
    'costUsd',
  ] as const
  assertExactKeys(metrics, metricKeys, metricKeys, 'artifact.metrics')
  const traceHashes = readArray(record.traceHashes, 'artifact.traceHashes')
    .map((item, index) => readHash(item, `artifact.traceHashes[${index}]`))
  if (traceHashes.length === 0) failSchema('invalid_value', 'artifact.traceHashes', '不得为空')
  assertUnique(traceHashes, 'artifact.traceHashes')

  return {
    version: 1,
    createdAt: readInteger(record.createdAt, 'artifact.createdAt', { min: 0 }),
    codeRevision: readString(record.codeRevision, 'artifact.codeRevision', { max: 120 }),
    schemaVersions: { contract: 1, event: 1, manifest: 1, receipt: 1 },
    execution: {
      provider: readString(execution.provider, 'artifact.execution.provider', { max: 120 }),
      model: readString(execution.model, 'artifact.execution.model', { max: 200 }),
      promptVersion: readString(execution.promptVersion, 'artifact.execution.promptVersion', { max: 160 }),
      toolSchemaVersion: readString(execution.toolSchemaVersion, 'artifact.execution.toolSchemaVersion', { max: 160 }),
    },
    fixture: {
      id: readString(fixture.id, 'artifact.fixture.id', { max: 160 }),
      split: readEnum(fixture.split, ['development', 'held-out'], 'artifact.fixture.split'),
      contentHash: readHash(fixture.contentHash, 'artifact.fixture.contentHash'),
    },
    metrics: {
      runs: readInteger(metrics.runs, 'artifact.metrics.runs', { min: 1 }),
      successfulSteps: readInteger(metrics.successfulSteps, 'artifact.metrics.successfulSteps', { min: 0 }),
      failedSteps: readInteger(metrics.failedSteps, 'artifact.metrics.failedSteps', { min: 0 }),
      modelCalls: readInteger(metrics.modelCalls, 'artifact.metrics.modelCalls', { min: 0 }),
      toolCalls: readInteger(metrics.toolCalls, 'artifact.metrics.toolCalls', { min: 0 }),
      inputTokens: readInteger(metrics.inputTokens, 'artifact.metrics.inputTokens', { min: 0 }),
      outputTokens: readInteger(metrics.outputTokens, 'artifact.metrics.outputTokens', { min: 0 }),
      latencyMs: readNonNegativeNumber(metrics.latencyMs, 'artifact.metrics.latencyMs'),
      costUsd: readNonNegativeNumber(metrics.costUsd, 'artifact.metrics.costUsd'),
    },
    traceHashes,
    artifactHash: readHash(record.artifactHash, 'artifact.artifactHash'),
  }
}

export async function createAgentHarnessBenchmarkArtifactV1(
  body: BenchmarkArtifactBodyV1,
): Promise<AgentHarnessBenchmarkArtifactV1> {
  const provisional = { ...body, artifactHash: '0'.repeat(64) }
  const parsed = parseAgentHarnessBenchmarkArtifactV1(provisional)
  return { ...parsed, artifactHash: await hashCanonicalValue(artifactBody(parsed)) }
}

export async function verifyAgentHarnessBenchmarkArtifactV1(value: unknown): Promise<boolean> {
  const artifact = parseAgentHarnessBenchmarkArtifactV1(value)
  return await hashCanonicalValue(artifactBody(artifact)) === artifact.artifactHash
}
