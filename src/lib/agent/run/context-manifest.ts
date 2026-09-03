import { sha256Text } from '../../ai/chapter-memory/text-normalization'
import { CONTEXT_SOURCE_BY_KEY } from '../../registry/context-sources'
import type { AssembleContextResult, ContextCompressionEvidenceV1 } from '../../registry/types'
import type {
  ContextManifestArtifactRefV3,
  ContextManifestBoundaryV1,
  ContextManifestSourceDeliveryV1,
  ContextManifestSourceStatus,
  ContextManifestSourceV1,
  ContextManifestV1,
  ContextManifestV2,
  ContextManifestV3,
  ContextManifestSourceV2,
} from '../../types/agent-run'
import type {
  ContextSourceRefV1,
  ContextSufficiencyObligationV1,
  ContextSufficiencyReportV1,
  RetrievalDecisionV1,
  RetrievalOmissionV1,
  RetrievalQueryTraceV1,
  RetrievalTraceV1,
} from '../../registry/types'
import { assertContextSourceRefV1 } from '../../context-gateway/contracts'
import type { WorkspaceScope } from '../../types'
import { db } from '../../db/schema'
import { isWorkspaceUid, isWorkCode } from '../../memory/identity'
import { hashCanonicalValue } from './hash'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readBoolean,
  readEnum,
  readHash,
  readInteger,
  readRecord,
  readString,
} from './schema-utils'

const SOURCE_STATUSES: readonly ContextManifestSourceStatus[] = ['included', 'omitted', 'trimmed']
const SOURCE_DELIVERIES: readonly ContextManifestSourceDeliveryV1[] = ['full', 'compressed', 'truncated']

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

function parseCompression(
  value: unknown,
  path: string,
): ContextCompressionEvidenceV1 {
  const record = readRecord(value, path)
  const keys = [
    'version',
    'promptVersion',
    'outcome',
    'fallback',
    'sourceHash',
    'artifactHash',
    'attempts',
    'targetTokens',
    'requiredAnchorCount',
    'coveredAnchorCount',
    'failureCode',
  ] as const
  assertExactKeys(record, keys, [
    'version',
    'promptVersion',
    'outcome',
    'fallback',
    'sourceHash',
    'attempts',
    'targetTokens',
    'requiredAnchorCount',
    'coveredAnchorCount',
  ], path)
  if (record.version !== 1 || record.promptVersion !== 'agent-context-compression-v1') {
    failSchema('unsupported_version', path, '仅支持 agent-context-compression-v1')
  }
  const outcome = readEnum(record.outcome, ['verified', 'fallback'], `${path}.outcome`)
  const fallback = readEnum(
    record.fallback,
    ['none', 'full-source', 'deterministic-truncation'],
    `${path}.fallback`,
  )
  const artifactHash = record.artifactHash === undefined
    ? undefined
    : readHash(record.artifactHash, `${path}.artifactHash`)
  const failureCode = record.failureCode === undefined
    ? undefined
    : readString(record.failureCode, `${path}.failureCode`, { max: 160 })
  const requiredAnchorCount = readInteger(record.requiredAnchorCount, `${path}.requiredAnchorCount`, { min: 1 })
  const coveredAnchorCount = readInteger(record.coveredAnchorCount, `${path}.coveredAnchorCount`, { min: 0 })
  if (coveredAnchorCount > requiredAnchorCount) {
    failSchema('invalid_compression_coverage', `${path}.coveredAnchorCount`, '不得超过 requiredAnchorCount')
  }
  if (outcome === 'verified' && (
    fallback !== 'none' || !artifactHash || failureCode || coveredAnchorCount !== requiredAnchorCount
  )) failSchema('invalid_compression', path, 'verified 压缩必须完整覆盖锚点且不得声明回退')
  if (outcome === 'fallback' && (
    fallback === 'none' || artifactHash || !failureCode
  )) failSchema('invalid_compression', path, 'fallback 压缩必须声明回退类型和失败码')
  return {
    version: 1,
    promptVersion: 'agent-context-compression-v1',
    outcome,
    fallback,
    sourceHash: readHash(record.sourceHash, `${path}.sourceHash`),
    artifactHash,
    attempts: readInteger(record.attempts, `${path}.attempts`, { min: 0 }),
    targetTokens: readInteger(record.targetTokens, `${path}.targetTokens`, { min: 1 }),
    requiredAnchorCount,
    coveredAnchorCount,
    failureCode,
  }
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
      'compression',
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
  const compression = record.compression === undefined
    ? undefined
    : parseCompression(record.compression, `${path}.compression`)
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
  if (delivery === 'compressed' && (
    originalTokens === undefined
    || originalTokens <= tokens
    || compression?.outcome !== 'verified'
  )) failSchema('invalid_delivery', `${path}.delivery`, 'compressed 来源必须绑定已验证压缩证据')
  if (compression?.outcome === 'verified' && status === 'included' && delivery !== 'compressed') {
    failSchema('invalid_compression', `${path}.compression`, '已验证压缩的实际 delivery 必须为 compressed')
  }
  if (
    compression?.outcome === 'fallback'
    && status === 'included'
    && ((compression.fallback === 'full-source' && delivery !== 'full')
      || (compression.fallback === 'deterministic-truncation' && delivery !== 'truncated'))
  ) failSchema('invalid_compression', `${path}.compression`, '压缩回退与实际 delivery 不一致')
  return {
    key,
    status,
    contentHash,
    tokens,
    delivery,
    originalTokens,
    compression,
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
              ...(sourceEvidence.get(key)!.compression
                ? { compression: sourceEvidence.get(key)!.compression }
                : {}),
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
        ? {
            originalTokens: sourceEvidence.get(key)!.originalTokens,
            ...(sourceEvidence.get(key)!.compression
              ? { compression: sourceEvidence.get(key)!.compression }
              : {}),
          }
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

function provenanceAuthorityV2(key: string): ContextManifestSourceV2['provenance']['authority'] {
  if (key === 'manualText' || key === 'ragSelection') return 'author-input'
  if (key === 'productRuntime' || key === 'ttrpgRuntime' || key === 'ttrpgPlayerRuntime' || key === 'priorOutlineCandidate') return 'runtime'
  if (/retrieval|search|summary|Passages|impact/i.test(key)) return 'derived'
  return 'accepted'
}

/**
 * Add stable Workspace/World/Work and mirror provenance without changing the
 * permanently readable V1 contract. The V1 hash remains embedded and verified.
 */
export async function createContextManifestV2FromV1(input: {
  manifest: ContextManifestV1
  scope: WorkspaceScope
}): Promise<ContextManifestV2> {
  if (!await verifyContextManifestIntegrityV1(input.manifest)) {
    throw new Error('ContextManifestV1 完整性校验失败，不能升级 V2。')
  }
  if (input.manifest.scope.projectId !== input.scope.projectId) {
    throw new Error('ContextManifestV1 与 WorkspaceScope 项目不一致。')
  }
  const [project, world, work, bindings] = await Promise.all([
    db.projects.get(input.scope.projectId),
    db.worlds.get(input.scope.worldId),
    db.works.get(input.scope.workId),
    db.workspaceDocuments.where('projectId').equals(input.scope.projectId).toArray(),
  ])
  if (!project || !isWorkspaceUid(project.workspaceUid)
    || !world || world.projectId !== input.scope.projectId
    || !work || work.worldId !== world.id || !isWorkCode(work.code)) {
    throw new Error('ContextManifestV2 缺少稳定 Workspace/World/Work 身份。')
  }
  const recovery = bindings.find(binding => binding.documentKind === 'recovery-capsule')
  const sources: ContextManifestSourceV2[] = input.manifest.sources.map(source => {
    const direct = source.boundary?.chapterId == null
      ? undefined
      : bindings.find(binding => binding.tableName === 'chapters' && binding.recordId === source.boundary?.chapterId)
    const semanticTable = source.key === 'storyCore'
      ? 'storyCores'
      : source.key === 'creativeRules' ? 'creativeRules' : null
    const semantic = semanticTable == null
      ? undefined
      : bindings.find(binding => binding.tableName === semanticTable && binding.workCode === work.code)
    const mirror = direct ?? semantic ?? recovery
    const freshnessStatus = !mirror
      ? 'unmirrored' as const
      : mirror.baselineCanonicalHash != null
        && mirror.baselineCanonicalHash === mirror.databaseCanonicalHash
        ? 'fresh' as const
        : 'dirty' as const
    return {
      ...source,
      provenance: {
        mirrorDocumentIds: mirror ? [mirror.documentId] : [],
        artifactIds: source.contentHash ? [`context-source:${source.key}:${source.contentHash}`] : [],
        baselineRevision: mirror?.lastSyncRevision ?? null,
        canonicalHash: source.contentHash ?? null,
        freshnessStatus,
        authority: provenanceAuthorityV2(source.key),
        editPolicy: mirror?.editPolicy ?? 'not-applicable',
        ...(/retrieval|summary/i.test(source.key) && source.contentHash
          ? { derivedUpstreamHash: source.contentHash }
          : {}),
      },
    }
  })
  const body = {
    version: 2 as const,
    runId: input.manifest.runId,
    stepId: input.manifest.stepId,
    attempt: input.manifest.attempt,
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: input.manifest.scope.worldGroupId,
      workspaceUid: project.workspaceUid,
      worldCode: world.code,
      workCode: work.code,
    },
    inputBudget: input.manifest.inputBudget,
    totalInputTokens: input.manifest.totalInputTokens,
    sources,
    v1ManifestHash: input.manifest.manifestHash,
  }
  return { ...body, manifestHash: await hashCanonicalValue(body) }
}

export async function verifyContextManifestIntegrityV2(value: unknown): Promise<boolean> {
  if (!value || typeof value !== 'object') return false
  const manifest = value as ContextManifestV2
  if (manifest.version !== 2 || !isWorkspaceUid(manifest.scope?.workspaceUid)
    || !isWorkCode(manifest.scope?.workCode) || !/^[a-f0-9]{64}$/.test(manifest.manifestHash)
    || !/^[a-f0-9]{64}$/.test(manifest.v1ManifestHash) || !Array.isArray(manifest.sources)) return false
  const { manifestHash, ...body } = manifest
  return await hashCanonicalValue(body) === manifestHash
}

const HASH = /^[a-f0-9]{64}$/
const ARTIFACT_ROLES_V3 = [
  'selector-result', 'context-packet', 'source-snapshot', 'tool-result', 'rendered-request', 'raw-response',
] as const

type ContextManifestBodyV3 = Omit<ContextManifestV3, 'manifestHash'>

function manifestBodyV3(manifest: ContextManifestV3): ContextManifestBodyV3 {
  const { manifestHash: _manifestHash, ...body } = manifest
  return body
}

function readRevisionV3(value: unknown, path: string): number | string {
  if (typeof value === 'number') return readInteger(value, path, { min: 0 })
  return readString(value, path, { max: 200 })
}

function parseSourceRefV3(value: unknown, path: string): ContextSourceRefV1 {
  const record = readRecord(value, path)
  assertExactKeys(record, ['table', 'recordId', 'field', 'revision', 'contentHash', 'anchor'], [
    'table', 'recordId', 'field', 'revision', 'contentHash',
  ], path)
  const recordId = typeof record.recordId === 'number'
    ? readInteger(record.recordId, `${path}.recordId`, { min: 1 })
    : readString(record.recordId, `${path}.recordId`, { max: 300 })
  let anchor: ContextSourceRefV1['anchor']
  if (record.anchor !== undefined) {
    const raw = readRecord(record.anchor, `${path}.anchor`)
    assertExactKeys(raw, ['start', 'end', 'quoteHash'], ['start', 'end', 'quoteHash'], `${path}.anchor`)
    anchor = {
      start: readInteger(raw.start, `${path}.anchor.start`, { min: 0 }),
      end: readInteger(raw.end, `${path}.anchor.end`, { min: 0 }),
      quoteHash: readHash(raw.quoteHash, `${path}.anchor.quoteHash`),
    }
  }
  const parsed: ContextSourceRefV1 = {
    table: readString(record.table, `${path}.table`, { max: 120 }),
    recordId,
    field: readString(record.field, `${path}.field`, { max: 200 }),
    revision: readRevisionV3(record.revision, `${path}.revision`),
    contentHash: readHash(record.contentHash, `${path}.contentHash`),
    ...(anchor ? { anchor } : {}),
  }
  assertContextSourceRefV1(parsed)
  return parsed
}

function parseRetrievalDecisionV3(value: unknown, path: string): RetrievalDecisionV1 {
  const record = readRecord(value, path)
  const keys = [
    'resourceKey', 'sourceKey', 'reason', 'depth', 'revision', 'contentHash',
    'policyRevision', 'policyHash', 'sourceRefs', 'tokenCount',
  ] as const
  assertExactKeys(record, keys, keys, path)
  const sourceRefs = readArray(record.sourceRefs, `${path}.sourceRefs`)
    .map((ref, index) => parseSourceRefV3(ref, `${path}.sourceRefs[${index}]`))
  if (!sourceRefs.length) failSchema('invalid_source_refs', `${path}.sourceRefs`, '不得为空')
  return {
    resourceKey: readString(record.resourceKey, `${path}.resourceKey`, { max: 500 }),
    sourceKey: readString(record.sourceKey, `${path}.sourceKey`, { max: 120 }),
    reason: readString(record.reason, `${path}.reason`, { max: 500 }),
    depth: readEnum(record.depth, ['index', 'summary', 'focused', 'full', 'original'], `${path}.depth`),
    revision: readRevisionV3(record.revision, `${path}.revision`),
    contentHash: readHash(record.contentHash, `${path}.contentHash`),
    policyRevision: readInteger(record.policyRevision, `${path}.policyRevision`, { min: 0 }),
    policyHash: readHash(record.policyHash, `${path}.policyHash`),
    sourceRefs,
    tokenCount: readInteger(record.tokenCount, `${path}.tokenCount`, { min: 0 }),
  }
}

function parseRetrievalOmissionV3(value: unknown, path: string): RetrievalOmissionV1 {
  const record = readRecord(value, path)
  const keys = ['resourceKey', 'sourceKey', 'reasonCode', 'tokenEstimate'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    resourceKey: readString(record.resourceKey, `${path}.resourceKey`, { max: 500 }),
    sourceKey: readString(record.sourceKey, `${path}.sourceKey`, { max: 120 }),
    reasonCode: readString(record.reasonCode, `${path}.reasonCode`, { max: 200 }),
    tokenEstimate: readInteger(record.tokenEstimate, `${path}.tokenEstimate`, { min: 0 }),
  }
}

function parseRetrievalQueryV3(value: unknown, path: string): RetrievalQueryTraceV1 {
  const record = readRecord(value, path)
  const keys = ['query', 'sourceKeys', 'resultResourceKeys', 'resultFingerprint'] as const
  assertExactKeys(record, keys, keys, path)
  const strings = (raw: unknown, field: string, max: number) => {
    const values = readArray(raw, field).map((item, index) => readString(item, `${field}[${index}]`, { max }))
    assertUnique(values, field)
    return values
  }
  return {
    query: readString(record.query, `${path}.query`, { max: 2_000 }),
    sourceKeys: strings(record.sourceKeys, `${path}.sourceKeys`, 120),
    resultResourceKeys: strings(record.resultResourceKeys, `${path}.resultResourceKeys`, 500),
    resultFingerprint: readHash(record.resultFingerprint, `${path}.resultFingerprint`),
  }
}

function parseRetrievalTraceV3(value: unknown, path: string): RetrievalTraceV1 {
  const record = readRecord(value, path)
  const keys = [
    'version', 'catalogVersion', 'selectorPolicyId', 'mandatory', 'autoSelected', 'agentReads',
    'omitted', 'queries', 'totalTokens', 'fallbackUsed', 'traceHash',
  ] as const
  assertExactKeys(record, keys, keys, path)
  if (record.version !== 1) failSchema('unsupported_version', `${path}.version`, '仅支持 RetrievalTraceV1')
  const decisions = (field: 'mandatory' | 'autoSelected' | 'agentReads') => readArray(record[field], `${path}.${field}`)
    .map((item, index) => parseRetrievalDecisionV3(item, `${path}.${field}[${index}]`))
  const mandatory = decisions('mandatory')
  const autoSelected = decisions('autoSelected')
  const agentReads = decisions('agentReads')
  const totalTokens = readInteger(record.totalTokens, `${path}.totalTokens`, { min: 0 })
  if ([...mandatory, ...autoSelected, ...agentReads].reduce((sum, item) => sum + item.tokenCount, 0) !== totalTokens) {
    failSchema('token_mismatch', `${path}.totalTokens`, '与 retrieval decisions 不一致')
  }
  return {
    version: 1,
    catalogVersion: readString(record.catalogVersion, `${path}.catalogVersion`, { max: 200 }),
    selectorPolicyId: readString(record.selectorPolicyId, `${path}.selectorPolicyId`, { max: 160 }),
    mandatory,
    autoSelected,
    agentReads,
    omitted: readArray(record.omitted, `${path}.omitted`)
      .map((item, index) => parseRetrievalOmissionV3(item, `${path}.omitted[${index}]`)),
    queries: readArray(record.queries, `${path}.queries`)
      .map((item, index) => parseRetrievalQueryV3(item, `${path}.queries[${index}]`)),
    totalTokens,
    fallbackUsed: readBoolean(record.fallbackUsed, `${path}.fallbackUsed`),
    traceHash: readHash(record.traceHash, `${path}.traceHash`),
  }
}

function parseSufficiencyObligationV3(value: unknown, path: string): ContextSufficiencyObligationV1 {
  const record = readRecord(value, path)
  const keys = ['id', 'kind', 'required', 'status', 'evidenceResourceKeys', 'reasonCode'] as const
  assertExactKeys(record, keys, keys, path)
  const evidenceResourceKeys = readArray(record.evidenceResourceKeys, `${path}.evidenceResourceKeys`)
    .map((item, index) => readString(item, `${path}.evidenceResourceKeys[${index}]`, { max: 500 }))
  assertUnique(evidenceResourceKeys, `${path}.evidenceResourceKeys`)
  return {
    id: readString(record.id, `${path}.id`, { max: 300 }),
    kind: readEnum(record.kind, [
      'mandatory-source', 'resource-kind', 'entity', 'time-boundary', 'conflict-check',
    ], `${path}.kind`),
    required: readBoolean(record.required, `${path}.required`),
    status: readEnum(record.status, ['satisfied', 'missing', 'conflicted', 'not-applicable'], `${path}.status`),
    evidenceResourceKeys,
    reasonCode: readString(record.reasonCode, `${path}.reasonCode`, { max: 300 }),
  }
}

function parseSufficiencyV3(value: unknown, path: string): ContextSufficiencyReportV1 {
  const record = readRecord(value, path)
  const keys = ['version', 'obligations', 'assumptions', 'additionalRead', 'reportHash'] as const
  assertExactKeys(record, keys, keys, path)
  if (record.version !== 'context-sufficiency-v1') {
    failSchema('unsupported_version', `${path}.version`, '仅支持 ContextSufficiencyReportV1')
  }
  const assumptions = readArray(record.assumptions, `${path}.assumptions`)
    .map((item, index) => readString(item, `${path}.assumptions[${index}]`, { max: 500 }))
  assertUnique(assumptions, `${path}.assumptions`)
  return {
    version: 'context-sufficiency-v1',
    obligations: readArray(record.obligations, `${path}.obligations`)
      .map((item, index) => parseSufficiencyObligationV3(item, `${path}.obligations[${index}]`)),
    assumptions,
    additionalRead: readEnum(record.additionalRead, ['forbidden', 'not-needed', 'needed'], `${path}.additionalRead`),
    reportHash: readHash(record.reportHash, `${path}.reportHash`),
  }
}

function parseArtifactRefV3(value: unknown, path: string): ContextManifestArtifactRefV3 {
  const record = readRecord(value, path)
  assertExactKeys(record, [
    'role', 'artifactKind', 'contentHash', 'byteLength', 'sourceKey', 'resourceKey', 'sourceContentHash', 'sourceRefsHash', 'toolName', 'callIndex',
  ], ['role', 'artifactKind', 'contentHash', 'byteLength'], path)
  const role = readEnum(record.role, ARTIFACT_ROLES_V3, `${path}.role`)
  const artifactKind = readEnum(record.artifactKind, ARTIFACT_ROLES_V3, `${path}.artifactKind`)
  if (role !== artifactKind) failSchema('artifact_role_mismatch', path, 'artifact role 必须与 exact artifact kind 一致')
  const sourceKey = record.sourceKey === undefined ? undefined : readString(record.sourceKey, `${path}.sourceKey`, { max: 120 })
  const resourceKey = record.resourceKey === undefined ? undefined : readString(record.resourceKey, `${path}.resourceKey`, { max: 500 })
  const sourceContentHash = record.sourceContentHash === undefined
    ? undefined
    : readHash(record.sourceContentHash, `${path}.sourceContentHash`)
  const sourceRefsHash = record.sourceRefsHash === undefined
    ? undefined
    : readHash(record.sourceRefsHash, `${path}.sourceRefsHash`)
  const toolName = record.toolName === undefined ? undefined : readString(record.toolName, `${path}.toolName`, { max: 160 })
  const callIndex = record.callIndex === undefined ? undefined : readInteger(record.callIndex, `${path}.callIndex`, { min: 0 })
  if (role === 'tool-result' && (toolName === undefined || callIndex === undefined)) {
    failSchema('artifact_role_metadata', path, 'tool-result 必须声明 toolName/callIndex')
  }
  if (role !== 'tool-result' && (toolName !== undefined || callIndex !== undefined)) {
    failSchema('artifact_role_metadata', path, `${role} 不得声明 toolName/callIndex`)
  }
  if (role === 'source-snapshot' && ((sourceKey === undefined && resourceKey === undefined)
    || sourceContentHash === undefined || sourceRefsHash === undefined)) {
    failSchema('artifact_role_metadata', path, 'source-snapshot 必须声明 sourceKey/resourceKey、sourceContentHash 与 sourceRefsHash')
  }
  if (role === 'tool-result' && (sourceContentHash !== undefined || sourceRefsHash !== undefined)) {
    failSchema('artifact_role_metadata', path, 'tool-result 不得声明 sourceContentHash/sourceRefsHash')
  }
  if (role !== 'source-snapshot' && role !== 'tool-result'
    && (sourceKey !== undefined || resourceKey !== undefined || sourceContentHash !== undefined || sourceRefsHash !== undefined)) {
    failSchema('artifact_role_metadata', path, `${role} 不得声明 sourceKey/resourceKey/sourceContentHash/sourceRefsHash`)
  }
  return {
    role,
    artifactKind,
    contentHash: readHash(record.contentHash, `${path}.contentHash`),
    byteLength: readInteger(record.byteLength, `${path}.byteLength`, { min: 0 }),
    sourceKey,
    resourceKey,
    sourceContentHash,
    sourceRefsHash,
    toolName,
    callIndex,
  }
}

function parseSourceV2(value: unknown, path: string): ContextManifestSourceV2 {
  const record = readRecord(value, path)
  const { provenance: _provenance, ...sourceRecord } = record
  const sourceV1 = parseSource(sourceRecord, path)
  const provenance = readRecord(record.provenance, `${path}.provenance`)
  assertExactKeys(provenance, [
    'mirrorDocumentIds', 'artifactIds', 'baselineRevision', 'canonicalHash', 'freshnessStatus',
    'authority', 'editPolicy', 'derivedUpstreamHash',
  ], [
    'mirrorDocumentIds', 'artifactIds', 'baselineRevision', 'canonicalHash', 'freshnessStatus',
    'authority', 'editPolicy',
  ], `${path}.provenance`)
  const strings = (raw: unknown, field: string): string[] => {
    const values = readArray(raw, field).map((item, index) => readString(item, `${field}[${index}]`, { max: 300 }))
    assertUnique(values, field)
    return values
  }
  return {
    ...sourceV1,
    provenance: {
      mirrorDocumentIds: strings(provenance.mirrorDocumentIds, `${path}.provenance.mirrorDocumentIds`),
      artifactIds: strings(provenance.artifactIds, `${path}.provenance.artifactIds`),
      baselineRevision: provenance.baselineRevision === null
        ? null
        : readInteger(provenance.baselineRevision, `${path}.provenance.baselineRevision`, { min: 0 }),
      canonicalHash: provenance.canonicalHash === null
        ? null
        : readHash(provenance.canonicalHash, `${path}.provenance.canonicalHash`),
      freshnessStatus: readEnum(provenance.freshnessStatus, ['fresh', 'dirty', 'unmirrored'], `${path}.provenance.freshnessStatus`),
      authority: readEnum(provenance.authority, ['accepted', 'author-input', 'derived', 'runtime'], `${path}.provenance.authority`),
      editPolicy: readEnum(provenance.editPolicy, [
        'author-editable', 'candidate-editable', 'machine-readonly', 'not-applicable',
      ], `${path}.provenance.editPolicy`),
      derivedUpstreamHash: provenance.derivedUpstreamHash === undefined
        ? undefined
        : readHash(provenance.derivedUpstreamHash, `${path}.provenance.derivedUpstreamHash`),
    },
  }
}

function sortArtifactRefsV3(refs: readonly ContextManifestArtifactRefV3[]): ContextManifestArtifactRefV3[] {
  return [...refs].sort((left, right) => (
    left.role.localeCompare(right.role)
      || (left.sourceKey ?? '').localeCompare(right.sourceKey ?? '')
      || (left.resourceKey ?? '').localeCompare(right.resourceKey ?? '')
      || (left.sourceContentHash ?? '').localeCompare(right.sourceContentHash ?? '')
      || (left.sourceRefsHash ?? '').localeCompare(right.sourceRefsHash ?? '')
      || (left.toolName ?? '').localeCompare(right.toolName ?? '')
      || (left.callIndex ?? -1) - (right.callIndex ?? -1)
      || left.contentHash.localeCompare(right.contentHash)
  ))
}

function assertFinalSufficiencyV3(report: ContextSufficiencyReportV1): void {
  if (report.version !== 'context-sufficiency-v1' || !HASH.test(report.reportHash)
    || !Array.isArray(report.obligations) || !Array.isArray(report.assumptions)
    || report.additionalRead === 'needed') {
    failSchema('invalid_sufficiency', 'manifest.gateway.sufficiency', 'final Manifest 需要已停止且可验签的充分性报告')
  }
  if (report.obligations.some(obligation => (
    obligation.required && (obligation.status === 'missing' || obligation.status === 'conflicted')
  ))) failSchema('insufficient_context', 'manifest.gateway.sufficiency', '硬证据义务未满足，不能形成 final Manifest')
  assertUnique(report.obligations.map(item => item.id), 'manifest.gateway.sufficiency.obligations')
  for (const obligation of report.obligations) {
    if (obligation.status === 'satisfied' && obligation.evidenceResourceKeys.length === 0) {
      failSchema('invalid_sufficiency', 'manifest.gateway.sufficiency', `${obligation.id} satisfied 却没有证据资源`)
    }
    if (obligation.status === 'not-applicable' && obligation.evidenceResourceKeys.length !== 0) {
      failSchema('invalid_sufficiency', 'manifest.gateway.sufficiency', `${obligation.id} not-applicable 不得引用资源`)
    }
  }
}

function assertRetrievalTraceEvidenceV3(trace: RetrievalTraceV1): void {
  const decisions = [...trace.mandatory, ...trace.autoSelected, ...trace.agentReads]
  const identities = new Set<string>()
  for (const decision of decisions) {
    if (!decision.resourceKey?.trim() || !decision.sourceKey?.trim()
      || !HASH.test(decision.contentHash)
      || !Number.isSafeInteger(decision.policyRevision) || decision.policyRevision! < 0
      || !HASH.test(decision.policyHash ?? '')) {
      failSchema('invalid_retrieval_decision', 'manifest.gateway.retrievalTrace', `${decision.resourceKey || '<unknown>'} 缺少资源内容/策略证据`)
    }
    const identity = `${decision.resourceKey}\u0000${decision.depth}`
    if (identities.has(identity)) failSchema('duplicate_retrieval_decision', 'manifest.gateway.retrievalTrace', `${identity} 重复`)
    identities.add(identity)
  }
  const selectedKeys = new Set(decisions.map(item => item.resourceKey))
  if (trace.omitted.some(item => selectedKeys.has(item.resourceKey))) {
    failSchema('retrieval_overlap', 'manifest.gateway.retrievalTrace', '同一资源不得同时 selected 和 omitted')
  }
}

function assertGatewayEvidenceLinksV3(
  report: ContextSufficiencyReportV1,
  trace: RetrievalTraceV1,
): void {
  const delivered = new Set([...trace.mandatory, ...trace.autoSelected, ...trace.agentReads]
    .map(item => item.resourceKey))
  for (const obligation of report.obligations.filter(item => item.status === 'satisfied')) {
    if (obligation.evidenceResourceKeys.some(key => !delivered.has(key))) {
      failSchema('sufficiency_trace_mismatch', 'manifest.gateway.sufficiency', `${obligation.id} 引用了 Trace 未交付的资源`)
    }
  }
}

function assertArtifactRolesV3(input: {
  artifacts: readonly ContextManifestArtifactRefV3[]
  sources: readonly ContextManifestSourceV2[]
  packetArtifactHash: string
  selectorArtifactHash: string
  requestArtifactHash: string
  responseArtifactHash: string
}): void {
  const count = (role: ContextManifestArtifactRefV3['role']) => input.artifacts.filter(item => item.role === role)
  for (const role of ['selector-result', 'context-packet', 'rendered-request', 'raw-response'] as const) {
    if (count(role).length !== 1) failSchema('artifact_role_count', 'manifest.artifacts', `${role} 必须且只能有一份`)
  }
  if (count('selector-result')[0].contentHash !== input.selectorArtifactHash
    || count('context-packet')[0].contentHash !== input.packetArtifactHash
    || count('rendered-request')[0].contentHash !== input.requestArtifactHash
    || count('raw-response')[0].contentHash !== input.responseArtifactHash) {
    failSchema('artifact_link_mismatch', 'manifest.artifacts', 'packet/request/response artifact link 不一致')
  }
  const identities = input.artifacts.map(item => [
    item.role, item.contentHash, item.sourceKey ?? '', item.resourceKey ?? '', item.sourceContentHash ?? '', item.sourceRefsHash ?? '', item.toolName ?? '', item.callIndex ?? -1,
  ].join('\u0000'))
  assertUnique(identities, 'manifest.artifacts')
  for (const source of input.sources.filter(item => item.delivery === 'compressed' || item.delivery === 'truncated')) {
    if (!count('source-snapshot').some(ref => ref.sourceKey === source.key && ref.sourceContentHash === source.compression?.sourceHash)) {
      failSchema('missing_source_snapshot', 'manifest.artifacts', `${source.key} 压缩/截断前原文没有 exact snapshot`)
    }
  }
}

export async function createContextManifestV3(input: {
  manifest: ContextManifestV2
  scopeFingerprint: string
  gatewayVersionHash: string
  policyHash: string
  selectorPolicyId: string
  selectorHash: string
  selectorArtifactHash: string
  inventoryHash: string
  catalogVersion: string
  contextPacketHash: string
  sufficiency: ContextSufficiencyReportV1
  retrievalTrace: RetrievalTraceV1
  artifacts: readonly ContextManifestArtifactRefV3[]
  promptHash: string
  candidateHash: string
  workingContextGeneration: number
  packetArtifactHash: string
  checkpointHash?: string | null
}): Promise<ContextManifestV3> {
  if (!await verifyContextManifestIntegrityV2(input.manifest)) {
    failSchema('invalid_v2_manifest', 'manifest.v2ManifestHash', 'ContextManifestV2 完整性校验失败')
  }
  for (const [field, hash] of Object.entries({
    scopeFingerprint: input.scopeFingerprint,
    gatewayVersionHash: input.gatewayVersionHash,
    policyHash: input.policyHash,
    selectorHash: input.selectorHash,
    selectorArtifactHash: input.selectorArtifactHash,
    inventoryHash: input.inventoryHash,
    contextPacketHash: input.contextPacketHash,
    promptHash: input.promptHash,
    candidateHash: input.candidateHash,
    packetArtifactHash: input.packetArtifactHash,
    checkpointHash: input.checkpointHash ?? undefined,
  })) {
    if (hash !== undefined && !HASH.test(hash)) failSchema('invalid_hash', `manifest.${field}`, '必须是 SHA-256 hash')
  }
  if (!input.selectorPolicyId.trim() || !input.catalogVersion.trim()) {
    failSchema('invalid_gateway_binding', 'manifest.gateway', 'selectorPolicyId/catalogVersion 不得为空')
  }
  const sufficiency = parseSufficiencyV3(input.sufficiency, 'manifest.gateway.sufficiency')
  const retrievalTrace = parseRetrievalTraceV3(input.retrievalTrace, 'manifest.gateway.retrievalTrace')
  if (retrievalTrace.selectorPolicyId !== input.selectorPolicyId) {
    failSchema('selector_trace_mismatch', 'manifest.gateway.retrievalTrace', 'trace selectorPolicyId 与 Manifest 不一致')
  }
  if (retrievalTrace.catalogVersion !== input.catalogVersion) {
    failSchema('catalog_trace_mismatch', 'manifest.gateway.retrievalTrace', 'trace catalogVersion 与 Manifest 不一致')
  }
  assertFinalSufficiencyV3(sufficiency)
  const { reportHash, ...sufficiencyBody } = sufficiency
  if (await hashCanonicalValue(sufficiencyBody) !== reportHash) {
    failSchema('sufficiency_hash_mismatch', 'manifest.gateway.sufficiency.reportHash', '充分性报告 hash 不匹配')
  }
  const { traceHash, ...traceBody } = retrievalTrace
  if (await hashCanonicalValue(traceBody) !== traceHash) {
    failSchema('trace_hash_mismatch', 'manifest.gateway.retrievalTrace.traceHash', 'Retrieval Trace hash 不匹配')
  }
  assertRetrievalTraceEvidenceV3(retrievalTrace)
  assertGatewayEvidenceLinksV3(sufficiency, retrievalTrace)
  const artifacts = sortArtifactRefsV3(input.artifacts.map((item, index) => parseArtifactRefV3(item, `manifest.artifacts[${index}]`)))
  assertArtifactRolesV3({
    artifacts,
    sources: input.manifest.sources,
    packetArtifactHash: input.packetArtifactHash,
    selectorArtifactHash: input.selectorArtifactHash,
    requestArtifactHash: input.promptHash,
    responseArtifactHash: artifacts.find(item => item.role === 'raw-response')?.contentHash ?? '',
  })
  if (!Number.isSafeInteger(input.workingContextGeneration) || input.workingContextGeneration < 1) {
    failSchema('invalid_generation', 'manifest.workingContext.generation', 'working context generation 非法')
  }
  const rawResponseArtifactHash = artifacts.find(item => item.role === 'raw-response')!.contentHash
  const body: ContextManifestBodyV3 = {
    version: 3,
    runId: input.manifest.runId,
    stepId: input.manifest.stepId,
    attempt: input.manifest.attempt,
    scope: input.manifest.scope,
    inputBudget: input.manifest.inputBudget,
    totalInputTokens: input.manifest.totalInputTokens,
    sources: input.manifest.sources,
    v1ManifestHash: input.manifest.v1ManifestHash,
    v2ManifestHash: input.manifest.manifestHash,
    gateway: {
      scopeFingerprint: input.scopeFingerprint,
      gatewayVersionHash: input.gatewayVersionHash,
      policyHash: input.policyHash,
      selectorPolicyId: input.selectorPolicyId,
      selectorHash: input.selectorHash,
      selectorArtifactHash: input.selectorArtifactHash,
      inventoryHash: input.inventoryHash,
      catalogVersion: input.catalogVersion,
      contextPacketHash: input.contextPacketHash,
      sufficiency,
      retrievalTrace,
    },
    artifacts,
    prompt: { promptHash: input.promptHash, renderedRequestArtifactHash: input.promptHash },
    candidate: { candidateHash: input.candidateHash, rawResponseArtifactHash },
    workingContext: {
      generation: input.workingContextGeneration,
      packetArtifactHash: input.packetArtifactHash,
      checkpointHash: input.checkpointHash ?? null,
    },
  }
  return { ...body, manifestHash: await hashCanonicalValue(body) }
}

export function parseContextManifestV3(value: unknown): ContextManifestV3 {
  const record = readRecord(value, 'manifest')
  assertExactKeys(record, [
    'version', 'runId', 'stepId', 'attempt', 'scope', 'inputBudget', 'totalInputTokens', 'sources',
    'v1ManifestHash', 'v2ManifestHash', 'gateway', 'artifacts', 'prompt', 'candidate', 'workingContext', 'manifestHash',
  ], [
    'version', 'runId', 'stepId', 'attempt', 'scope', 'inputBudget', 'totalInputTokens', 'sources',
    'v1ManifestHash', 'v2ManifestHash', 'gateway', 'artifacts', 'prompt', 'candidate', 'workingContext', 'manifestHash',
  ], 'manifest')
  if (record.version !== 3) failSchema('unsupported_version', 'manifest.version', '仅支持 ContextManifestV3')
  const scope = readRecord(record.scope, 'manifest.scope')
  assertExactKeys(scope, ['projectId', 'worldGroupId', 'workspaceUid', 'worldCode', 'workCode'], [
    'projectId', 'worldGroupId', 'workspaceUid', 'worldCode', 'workCode',
  ], 'manifest.scope')
  const gateway = readRecord(record.gateway, 'manifest.gateway')
  assertExactKeys(gateway, [
    'scopeFingerprint', 'gatewayVersionHash', 'policyHash', 'selectorPolicyId', 'selectorHash',
    'selectorArtifactHash', 'inventoryHash', 'catalogVersion', 'contextPacketHash', 'sufficiency', 'retrievalTrace',
  ], [
    'scopeFingerprint', 'gatewayVersionHash', 'policyHash', 'selectorPolicyId', 'selectorHash',
    'selectorArtifactHash', 'inventoryHash', 'catalogVersion', 'contextPacketHash', 'sufficiency', 'retrievalTrace',
  ], 'manifest.gateway')
  const prompt = readRecord(record.prompt, 'manifest.prompt')
  assertExactKeys(prompt, ['promptHash', 'renderedRequestArtifactHash'], ['promptHash', 'renderedRequestArtifactHash'], 'manifest.prompt')
  const candidate = readRecord(record.candidate, 'manifest.candidate')
  assertExactKeys(candidate, ['candidateHash', 'rawResponseArtifactHash'], ['candidateHash', 'rawResponseArtifactHash'], 'manifest.candidate')
  const working = readRecord(record.workingContext, 'manifest.workingContext')
  assertExactKeys(working, ['generation', 'packetArtifactHash', 'checkpointHash'], [
    'generation', 'packetArtifactHash', 'checkpointHash',
  ], 'manifest.workingContext')
  const sources = readArray(record.sources, 'manifest.sources').map((source, index) => parseSourceV2(source, `manifest.sources[${index}]`))
  if (!sources.length) failSchema('invalid_sources', 'manifest.sources', '不得为空')
  assertUnique(sources.map(source => source.key), 'manifest.sources')
  const artifacts = sortArtifactRefsV3(readArray(record.artifacts, 'manifest.artifacts')
    .map((artifact, index) => parseArtifactRefV3(artifact, `manifest.artifacts[${index}]`)))
  const parsed: ContextManifestV3 = {
    version: 3,
    runId: readInteger(record.runId, 'manifest.runId', { min: 1 }),
    stepId: readString(record.stepId, 'manifest.stepId', { max: 160 }),
    attempt: readInteger(record.attempt, 'manifest.attempt', { min: 1 }),
    scope: {
      projectId: readInteger(scope.projectId, 'manifest.scope.projectId', { min: 1 }),
      worldGroupId: scope.worldGroupId === null ? null : readInteger(scope.worldGroupId, 'manifest.scope.worldGroupId', { min: 1 }),
      workspaceUid: readString(scope.workspaceUid, 'manifest.scope.workspaceUid', { max: 160 }),
      worldCode: readString(scope.worldCode, 'manifest.scope.worldCode', { max: 160 }),
      workCode: readString(scope.workCode, 'manifest.scope.workCode', { max: 160 }),
    },
    inputBudget: readInteger(record.inputBudget, 'manifest.inputBudget', { min: 1 }),
    totalInputTokens: readInteger(record.totalInputTokens, 'manifest.totalInputTokens', { min: 0 }),
    sources,
    v1ManifestHash: readHash(record.v1ManifestHash, 'manifest.v1ManifestHash'),
    v2ManifestHash: readHash(record.v2ManifestHash, 'manifest.v2ManifestHash'),
    gateway: {
      scopeFingerprint: readHash(gateway.scopeFingerprint, 'manifest.gateway.scopeFingerprint'),
      gatewayVersionHash: readHash(gateway.gatewayVersionHash, 'manifest.gateway.gatewayVersionHash'),
      policyHash: readHash(gateway.policyHash, 'manifest.gateway.policyHash'),
      selectorPolicyId: readString(gateway.selectorPolicyId, 'manifest.gateway.selectorPolicyId', { max: 160 }),
      selectorHash: readHash(gateway.selectorHash, 'manifest.gateway.selectorHash'),
      selectorArtifactHash: readHash(gateway.selectorArtifactHash, 'manifest.gateway.selectorArtifactHash'),
      inventoryHash: readHash(gateway.inventoryHash, 'manifest.gateway.inventoryHash'),
      catalogVersion: readString(gateway.catalogVersion, 'manifest.gateway.catalogVersion', { max: 200 }),
      contextPacketHash: readHash(gateway.contextPacketHash, 'manifest.gateway.contextPacketHash'),
      sufficiency: parseSufficiencyV3(gateway.sufficiency, 'manifest.gateway.sufficiency'),
      retrievalTrace: parseRetrievalTraceV3(gateway.retrievalTrace, 'manifest.gateway.retrievalTrace'),
    },
    artifacts,
    prompt: {
      promptHash: readHash(prompt.promptHash, 'manifest.prompt.promptHash'),
      renderedRequestArtifactHash: readHash(prompt.renderedRequestArtifactHash, 'manifest.prompt.renderedRequestArtifactHash'),
    },
    candidate: {
      candidateHash: readHash(candidate.candidateHash, 'manifest.candidate.candidateHash'),
      rawResponseArtifactHash: readHash(candidate.rawResponseArtifactHash, 'manifest.candidate.rawResponseArtifactHash'),
    },
    workingContext: {
      generation: readInteger(working.generation, 'manifest.workingContext.generation', { min: 1 }),
      packetArtifactHash: readHash(working.packetArtifactHash, 'manifest.workingContext.packetArtifactHash'),
      checkpointHash: working.checkpointHash === null ? null : readHash(working.checkpointHash, 'manifest.workingContext.checkpointHash'),
    },
    manifestHash: readHash(record.manifestHash, 'manifest.manifestHash'),
  }
  if (!isWorkspaceUid(parsed.scope.workspaceUid) || !isWorkCode(parsed.scope.workCode)) {
    failSchema('invalid_scope_identity', 'manifest.scope', 'Workspace/Work 稳定身份非法')
  }
  if (parsed.sources.reduce((sum, source) => sum + source.tokens, 0) !== parsed.totalInputTokens) {
    failSchema('token_mismatch', 'manifest.totalInputTokens', 'V3 source token 合计不匹配')
  }
  if (parsed.prompt.promptHash !== parsed.prompt.renderedRequestArtifactHash) {
    failSchema('prompt_artifact_mismatch', 'manifest.prompt', 'promptHash 必须精确指向 rendered-request artifact')
  }
  if (parsed.gateway.retrievalTrace.selectorPolicyId !== parsed.gateway.selectorPolicyId) {
    failSchema('selector_trace_mismatch', 'manifest.gateway.retrievalTrace', 'selectorPolicyId 不一致')
  }
  assertFinalSufficiencyV3(parsed.gateway.sufficiency)
  assertRetrievalTraceEvidenceV3(parsed.gateway.retrievalTrace)
  assertGatewayEvidenceLinksV3(parsed.gateway.sufficiency, parsed.gateway.retrievalTrace)
  assertArtifactRolesV3({
    artifacts: parsed.artifacts,
    sources: parsed.sources,
    packetArtifactHash: parsed.workingContext.packetArtifactHash,
    selectorArtifactHash: parsed.gateway.selectorArtifactHash,
    requestArtifactHash: parsed.prompt.renderedRequestArtifactHash,
    responseArtifactHash: parsed.candidate.rawResponseArtifactHash,
  })
  return parsed
}

export async function verifyContextManifestIntegrityV3(value: unknown): Promise<boolean> {
  try {
    const manifest = parseContextManifestV3(value)
    const reconstructedV2: ContextManifestV2 = {
      version: 2,
      runId: manifest.runId,
      stepId: manifest.stepId,
      attempt: manifest.attempt,
      scope: manifest.scope,
      inputBudget: manifest.inputBudget,
      totalInputTokens: manifest.totalInputTokens,
      sources: manifest.sources,
      v1ManifestHash: manifest.v1ManifestHash,
      manifestHash: manifest.v2ManifestHash,
    }
    if (!await verifyContextManifestIntegrityV2(reconstructedV2)) return false
    const reconstructedV1: ContextManifestV1 = {
      version: 1,
      runId: manifest.runId,
      stepId: manifest.stepId,
      attempt: manifest.attempt,
      scope: { projectId: manifest.scope.projectId, worldGroupId: manifest.scope.worldGroupId },
      inputBudget: manifest.inputBudget,
      totalInputTokens: manifest.totalInputTokens,
      sources: manifest.sources.map(({ provenance: _provenance, ...source }) => source),
      manifestHash: manifest.v1ManifestHash,
    }
    if (!await verifyContextManifestIntegrityV1(reconstructedV1)) return false
    const sufficiency = manifest.gateway.sufficiency
    const { reportHash, ...sufficiencyBody } = sufficiency
    if (await hashCanonicalValue(sufficiencyBody) !== reportHash) return false
    const trace = manifest.gateway.retrievalTrace
    const { traceHash, ...traceBody } = trace
    if (await hashCanonicalValue(traceBody) !== traceHash
      || trace.selectorPolicyId !== manifest.gateway.selectorPolicyId) return false
    return await hashCanonicalValue(manifestBodyV3(manifest)) === manifest.manifestHash
  } catch {
    return false
  }
}
