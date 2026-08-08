import { sha256Text } from '../../ai/chapter-memory/text-normalization'
import { CONTEXT_SOURCE_BY_KEY } from '../../registry/context-sources'
import type { AssembleContextResult } from '../../registry/types'
import type {
  ContextManifestBoundaryV1,
  ContextManifestSourceDeliveryV1,
  ContextManifestSourceStatus,
  ContextManifestSourceV1,
  ContextManifestV1,
} from '../../types/agent-run'
import { hashCanonicalValue } from './hash'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readEnum,
  readHash,
  readInteger,
  readRecord,
  readString,
} from './schema-utils'

const SOURCE_STATUSES: readonly ContextManifestSourceStatus[] = ['included', 'omitted', 'trimmed']
const SOURCE_DELIVERIES: readonly ContextManifestSourceDeliveryV1[] = ['full', 'truncated']

type ContextManifestBodyV1 = Omit<ContextManifestV1, 'manifestHash'>

function manifestBody(manifest: ContextManifestV1): ContextManifestBodyV1 {
  const { manifestHash: _manifestHash, ...body } = manifest
  return body
}

function parseBoundary(value: unknown, path: string): ContextManifestBoundaryV1 | undefined {
  if (value === undefined) return undefined
  const record = readRecord(value, path)
  const keys = ['chapterId', 'throughChapterId', 'outlineNodeId'] as const
  assertExactKeys(record, keys, [], path)
  const boundary: ContextManifestBoundaryV1 = {}
  if (record.chapterId !== undefined) boundary.chapterId = readInteger(record.chapterId, `${path}.chapterId`, { min: 1 })
  if (record.throughChapterId !== undefined) {
    boundary.throughChapterId = readInteger(record.throughChapterId, `${path}.throughChapterId`, { min: 1 })
  }
  if (record.outlineNodeId !== undefined) {
    boundary.outlineNodeId = readInteger(record.outlineNodeId, `${path}.outlineNodeId`, { min: 1 })
  }
  if (Object.keys(boundary).length === 0) failSchema('invalid_boundary', path, '边界对象不得为空')
  return boundary
}

function parseSource(value: unknown, path: string): ContextManifestSourceV1 {
  const record = readRecord(value, path)
  assertExactKeys(
    record,
    [
      'key',
      'status',
      'contentHash',
      'tokens',
      'delivery',
      'originalTokens',
      'boundary',
      'readerVersion',
    ],
    ['key', 'status', 'tokens'],
    path,
  )
  const key = readString(record.key, `${path}.key`, { max: 120 })
  if (!CONTEXT_SOURCE_BY_KEY.has(key)) failSchema('unknown_context_source', `${path}.key`, `未登记的上下文源 ${key}`)
  const status = readEnum(record.status, SOURCE_STATUSES, `${path}.status`)
  const contentHash = record.contentHash === undefined ? undefined : readHash(record.contentHash, `${path}.contentHash`)
  const tokens = readInteger(record.tokens, `${path}.tokens`, { min: 0 })
  const delivery = record.delivery === undefined
    ? undefined
    : readEnum(record.delivery, SOURCE_DELIVERIES, `${path}.delivery`)
  const originalTokens = record.originalTokens === undefined
    ? undefined
    : readInteger(record.originalTokens, `${path}.originalTokens`, { min: 0 })
  if (status === 'included' && !contentHash) {
    failSchema('missing_content_hash', `${path}.contentHash`, 'included 来源必须绑定实际输入内容哈希')
  }
  if (status !== 'included' && contentHash) {
    failSchema('invalid_content_hash', `${path}.contentHash`, `${status} 来源没有实际模型输入，不得声明内容哈希`)
  }
  if (status !== 'included' && tokens !== 0) {
    failSchema('invalid_tokens', `${path}.tokens`, `${status} 来源 token 必须为 0`)
  }
  if (status !== 'included' && delivery) {
    failSchema('invalid_delivery', `${path}.delivery`, `${status} 来源没有实际模型输入，不得声明 delivery`)
  }
  if (originalTokens !== undefined && originalTokens < tokens) {
    failSchema('invalid_original_tokens', `${path}.originalTokens`, '不得小于实际输入 token')
  }
  if (delivery === 'full' && originalTokens !== undefined && originalTokens !== tokens) {
    failSchema('invalid_delivery', `${path}.delivery`, 'full 来源的原始 token 必须等于实际输入 token')
  }
  if (delivery === 'truncated' && (originalTokens === undefined || originalTokens <= tokens)) {
    failSchema('invalid_delivery', `${path}.delivery`, 'truncated 来源必须证明原始 token 大于实际输入 token')
  }
  return {
    key,
    status,
    contentHash,
    tokens,
    delivery,
    originalTokens,
    boundary: parseBoundary(record.boundary, `${path}.boundary`),
    readerVersion: record.readerVersion === undefined
      ? undefined
      : readString(record.readerVersion, `${path}.readerVersion`, { max: 160 }),
  }
}

export function parseContextManifestV1(value: unknown): ContextManifestV1 {
  const record = readRecord(value, 'manifest')
  const keys = [
    'version',
    'runId',
    'stepId',
    'attempt',
    'scope',
    'inputBudget',
    'totalInputTokens',
    'sources',
    'manifestHash',
  ] as const
  assertExactKeys(record, keys, keys, 'manifest')
  if (record.version !== 1) failSchema('unsupported_version', 'manifest.version', '仅支持版本 1')
  const scope = readRecord(record.scope, 'manifest.scope')
  assertExactKeys(scope, ['projectId', 'worldGroupId'], ['projectId', 'worldGroupId'], 'manifest.scope')
  const worldGroupId = scope.worldGroupId === null
    ? null
    : readInteger(scope.worldGroupId, 'manifest.scope.worldGroupId', { min: 1 })
  const sources = readArray(record.sources, 'manifest.sources')
    .map((source, index) => parseSource(source, `manifest.sources[${index}]`))
  if (sources.length === 0) failSchema('invalid_sources', 'manifest.sources', '不得为空')
  assertUnique(sources.map(source => source.key), 'manifest.sources')
  const totalInputTokens = readInteger(record.totalInputTokens, 'manifest.totalInputTokens', { min: 0 })
  const sourceTokenTotal = sources.reduce((sum, source) => sum + source.tokens, 0)
  if (sourceTokenTotal !== totalInputTokens) {
    failSchema('token_mismatch', 'manifest.totalInputTokens', `来源合计为 ${sourceTokenTotal}`)
  }
  return {
    version: 1,
    runId: readInteger(record.runId, 'manifest.runId', { min: 1 }),
    stepId: readString(record.stepId, 'manifest.stepId', { max: 160 }),
    attempt: readInteger(record.attempt, 'manifest.attempt', { min: 1 }),
    scope: {
      projectId: readInteger(scope.projectId, 'manifest.scope.projectId', { min: 1 }),
      worldGroupId,
    },
    inputBudget: readInteger(record.inputBudget, 'manifest.inputBudget', { min: 1 }),
    totalInputTokens,
    sources,
    manifestHash: readHash(record.manifestHash, 'manifest.manifestHash'),
  }
}

export async function createContextManifestV1(
  body: ContextManifestBodyV1,
): Promise<ContextManifestV1> {
  const provisional = { ...body, manifestHash: '0'.repeat(64) }
  const parsed = parseContextManifestV1(provisional)
  return { ...parsed, manifestHash: await hashCanonicalValue(manifestBody(parsed)) }
}

export async function createContextManifestFromAssemblyV1(input: {
  runId: number
  stepId: string
  attempt: number
  projectId: number
  worldGroupId: number | null
  declaredSourceKeys: readonly string[]
  assembled: AssembleContextResult
  boundary?: ContextManifestBoundaryV1
  readerVersion?: string
}): Promise<ContextManifestV1> {
  assertUnique([...input.declaredSourceKeys], 'manifest.declaredSourceKeys')
  if (input.declaredSourceKeys.length === 0) {
    failSchema('invalid_sources', 'manifest.declaredSourceKeys', '不得为空')
  }
  const sources: ContextManifestSourceV1[] = []
  const sourceEvidence = new Map(
    (input.assembled.sourceEvidence ?? []).map(evidence => [evidence.key, evidence]),
  )
  for (const key of input.declaredSourceKeys) {
    if (!CONTEXT_SOURCE_BY_KEY.has(key)) {
      failSchema('unknown_context_source', 'manifest.declaredSourceKeys', `未登记的上下文源 ${key}`)
    }
    const includedIndex = input.assembled.included.indexOf(key)
    if (includedIndex >= 0) {
      const segment = input.assembled.segments[includedIndex]
      if (!segment) failSchema('assembly_mismatch', 'manifest.assembled', `来源 ${key} 缺少对应 segment`)
      sources.push({
        key,
        status: 'included',
        contentHash: await sha256Text(segment.content),
        tokens: segment.tokens,
        ...(sourceEvidence.get(key)?.status === 'included'
          ? {
              delivery: sourceEvidence.get(key)!.delivery as ContextManifestSourceDeliveryV1,
              originalTokens: sourceEvidence.get(key)!.originalTokens,
            }
          : {}),
        boundary: input.boundary,
        readerVersion: input.readerVersion,
      })
      continue
    }
    sources.push({
      key,
      status: input.assembled.trimmed.includes(key) ? 'trimmed' : 'omitted',
      tokens: 0,
      ...(sourceEvidence.has(key)
        ? { originalTokens: sourceEvidence.get(key)!.originalTokens }
        : {}),
      boundary: input.boundary,
      readerVersion: input.readerVersion,
    })
  }
  const undeclared = [
    ...input.assembled.included,
    ...input.assembled.trimmed,
    ...input.assembled.omitted,
  ].filter(key => !input.declaredSourceKeys.includes(key))
  if (undeclared.length > 0) {
    failSchema('scope_mismatch', 'manifest.assembled', `装配结果包含未授权来源 ${[...new Set(undeclared)].join('、')}`)
  }
  return createContextManifestV1({
    version: 1,
    runId: input.runId,
    stepId: input.stepId,
    attempt: input.attempt,
    scope: { projectId: input.projectId, worldGroupId: input.worldGroupId },
    inputBudget: input.assembled.inputBudget,
    totalInputTokens: input.assembled.totalInputTokens,
    sources,
  })
}

export async function verifyContextManifestIntegrityV1(value: unknown): Promise<boolean> {
  const manifest = parseContextManifestV1(value)
  return await hashCanonicalValue(manifestBody(manifest)) === manifest.manifestHash
}
