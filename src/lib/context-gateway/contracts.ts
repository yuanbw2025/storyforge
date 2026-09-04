import { estimateTokens } from '../ai/context-budget'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { CONTEXT_RESOURCE_KINDS_V1 } from '../registry/types'
import type {
  AgentRunArtifactV1,
  ContextAccessPolicyV1,
  ContextGatewayContractSnapshotV1,
  ContextGatewayVersionV1,
  ContextPacketV1,
  ContextResourceDepthV1,
  ContextResourceDescriptorV1,
  ContextResourceKind,
  ContextSource,
  ContextSourceRefV1,
  ContextSufficiencyObligationV1,
  ContextSufficiencyReportV1,
  DomainOwnershipSpec,
  ResourcePageV1,
  RetrievalTraceV1,
} from '../registry/types'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'

const HASH = /^[a-f0-9]{64}$/
const RESOURCE_KEY = /^[a-z][a-z0-9-]*:[^\s:]+(?::[^\s:]+)*$/
const KINDS: readonly ContextResourceKind[] = CONTEXT_RESOURCE_KINDS_V1
const DEPTHS: readonly ContextResourceDepthV1[] = ['index', 'summary', 'focused', 'full', 'original']

export class ContextGatewayContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ContextGatewayContractError'
  }
}

function fail(code: string, message: string): never {
  throw new ContextGatewayContractError(code, message)
}

function requireHash(value: string, field: string): void {
  if (!HASH.test(value)) fail('invalid-hash', `${field} 必须是 SHA-256 hash`)
}

function uniqueSorted<T extends string>(values: readonly T[], field: string): T[] {
  if (values.some(value => typeof value !== 'string' || !value)) fail('invalid-string', `${field} 含空值`)
  return [...new Set(values)].sort() as T[]
}

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key))
  if (extra.length) fail('unknown-field', `${label} 含未知字段: ${extra.join(',')}`)
}

function assertScope(scope: ContextResourceDescriptorV1['scope']): void {
  if (!Number.isSafeInteger(scope.projectId) || scope.projectId < 1) fail('invalid-scope', 'projectId 非法')
  for (const field of ['worldId', 'workId', 'chapterId'] as const) {
    const value = scope[field]
    if (value != null && (!Number.isSafeInteger(value) || value < 1)) fail('invalid-scope', `${field} 非法`)
  }
  if (scope.worldGroupId != null && (!Number.isSafeInteger(scope.worldGroupId) || scope.worldGroupId < 1)) {
    fail('invalid-scope', 'worldGroupId 非法')
  }
  if (scope.worldReleaseId != null
    && (!Number.isSafeInteger(scope.worldReleaseId) || scope.worldReleaseId < 1)) {
    fail('invalid-scope', 'worldReleaseId 非法')
  }
  if (scope.worldReleaseHash != null) requireHash(scope.worldReleaseHash, 'scope.worldReleaseHash')
}

export function contextSourceRefOwnerV1(ref: ContextSourceRefV1): DomainOwnershipSpec {
  const spec = REGISTRY_BY_NAME.get(ref.table)
  if (!spec) fail('unregistered-table', `SourceRef 引用了未登记 PROJECT_TABLES 的表 ${ref.table}`)
  if (!spec.domainOwner) fail('missing-owner', `表 ${ref.table} 缺少 PROJECT_TABLES.domainOwner`)
  return spec.domainOwner
}

export function assertContextSourceRefV1(ref: ContextSourceRefV1): void {
  contextSourceRefOwnerV1(ref)
  if ((typeof ref.recordId !== 'number' && typeof ref.recordId !== 'string') || ref.recordId === '') {
    fail('invalid-record-id', `SourceRef ${ref.table} recordId 非法`)
  }
  if (!ref.field || (typeof ref.revision !== 'number' && typeof ref.revision !== 'string')) {
    fail('invalid-source-ref', `SourceRef ${ref.table} 缺少 field/revision`)
  }
  requireHash(ref.contentHash, `${ref.table}.${ref.field}.contentHash`)
  if (ref.anchor) {
    if (!Number.isSafeInteger(ref.anchor.start) || !Number.isSafeInteger(ref.anchor.end)
      || ref.anchor.start < 0 || ref.anchor.end < ref.anchor.start) {
      fail('invalid-anchor', `SourceRef ${ref.table}.${ref.field} anchor 非法`)
    }
    requireHash(ref.anchor.quoteHash, `${ref.table}.${ref.field}.anchor.quoteHash`)
  }
}

function assertOwnerScope(owner: DomainOwnershipSpec, descriptor: ContextResourceDescriptorV1): void {
  const allowed = owner.allowed
  if (allowed.includes('workspace')) return
  const matched = allowed.some(kind => (
    (kind === 'world' && descriptor.scope.worldId != null)
    || (kind === 'work' && descriptor.scope.workId != null)
    || kind === 'instance'
  ))
  if (!matched) fail('owner-scope-mismatch', `${descriptor.resourceKey} scope 不满足 PROJECT_TABLES owner`)
}

export function assertContextResourceDescriptorV1(input: {
  descriptor: ContextResourceDescriptorV1
  source: ContextSource
}): void {
  const { descriptor, source } = input
  if (descriptor.version !== 1) fail('unsupported-descriptor', '只支持 ContextResourceDescriptorV1')
  if (!RESOURCE_KEY.test(descriptor.resourceKey)) fail('invalid-resource-key', `resourceKey 非法: ${descriptor.resourceKey}`)
  if (descriptor.sourceKey !== source.key) fail('source-mismatch', `${descriptor.resourceKey} sourceKey 与 Provider 挂载点不一致`)
  if (!source.resources) fail('missing-provider', `CONTEXT_SOURCES.${source.key} 未挂 resource provider`)
  if (!KINDS.includes(descriptor.kind) || !source.resources.kinds.includes(descriptor.kind)) {
    fail('unregistered-kind', `${descriptor.kind} 未由 ${source.key} Provider 声明`)
  }
  if (!descriptor.title.trim() || descriptor.shortSummary.length > 800) {
    fail('invalid-metadata', `${descriptor.resourceKey} metadata 非法`)
  }
  if ((typeof descriptor.contentRevision !== 'number' && typeof descriptor.contentRevision !== 'string')
    || descriptor.contentRevision === ''
    || !Number.isSafeInteger(descriptor.policyRevision) || descriptor.policyRevision < 0) {
    fail('invalid-revision', `${descriptor.resourceKey} content/policy revision 非法`)
  }
  requireHash(descriptor.contentHash, `${descriptor.resourceKey}.contentHash`)
  requireHash(descriptor.policyHash, `${descriptor.resourceKey}.policyHash`)
  if ('content' in descriptor || 'body' in descriptor || 'original' in descriptor) {
    fail('metadata-body-leak', `${descriptor.resourceKey} 的 metadata 夹带正文`)
  }
  assertScope(descriptor.scope)
  if (descriptor.worldSemantic) {
    if (!descriptor.worldSemantic.area.trim() || !descriptor.worldSemantic.resourceKind.trim()
      || !descriptor.worldSemantic.resourceCoordinate.trim()) {
      fail('invalid-world-semantic', `${descriptor.resourceKey} 世界语义身份非法`)
    }
  }
  if (descriptor.sourceRefs.length === 0) fail('missing-source-ref', `${descriptor.resourceKey} 没有 Canon/source ref`)
  for (const ref of descriptor.sourceRefs) {
    assertContextSourceRefV1(ref)
    assertOwnerScope(contextSourceRefOwnerV1(ref), descriptor)
  }
  if (descriptor.availableDepths.length === 0) fail('missing-depth', `${descriptor.resourceKey} 没有可读 depth`)
  for (const depth of descriptor.availableDepths) {
    if (!DEPTHS.includes(depth)) fail('unregistered-depth', `未登记 depth: ${String(depth)}`)
    const estimate = descriptor.tokenEstimate[depth]
    if (estimate != null && (!Number.isSafeInteger(estimate) || estimate < 0)) {
      fail('invalid-token-estimate', `${descriptor.resourceKey}.${depth} token estimate 非法`)
    }
  }
  if (descriptor.retrievalWeight != null
    && (!Number.isFinite(descriptor.retrievalWeight) || descriptor.retrievalWeight < 0.1 || descriptor.retrievalWeight > 5)) {
    fail('invalid-retrieval-weight', `${descriptor.resourceKey} retrievalWeight 必须在 0.1..5`)
  }
  if (descriptor.tokenCap != null
    && (!Number.isSafeInteger(descriptor.tokenCap) || descriptor.tokenCap < 100 || descriptor.tokenCap > 50_000)) {
    fail('invalid-token-cap', `${descriptor.resourceKey} tokenCap 必须在 100..50000`)
  }
  for (const relation of descriptor.relations) {
    if (!RESOURCE_KEY.test(relation.targetResourceKey)) fail('invalid-relation', `${descriptor.resourceKey} 含非法关系目标`)
  }
}

export function assertResourcePageV1(input: {
  page: ResourcePageV1
  source: ContextSource
  expectedScopeFingerprint: string
  maxItems: number
}): ResourcePageV1 {
  const { page, source } = input
  if (page.version !== 1) fail('unsupported-page', '只支持 ResourcePageV1')
  if (page.scopeFingerprint !== input.expectedScopeFingerprint) fail('scope-mismatch', 'Provider 返回了其它 scope 的目录页')
  if (page.items.length > input.maxItems) fail('page-overflow', 'Provider 返回项目数超过请求 limit')
  const keys = new Set<string>()
  for (const descriptor of page.items) {
    assertContextResourceDescriptorV1({ descriptor, source })
    if (keys.has(descriptor.resourceKey)) fail('duplicate-resource', `目录页重复 ${descriptor.resourceKey}`)
    keys.add(descriptor.resourceKey)
  }
  return page
}

function providerSnapshot(sources: readonly ContextSource[]) {
  const providers = sources
    .filter((source): source is ContextSource & { resources: NonNullable<ContextSource['resources']> } => !!source.resources)
    .map(source => ({
      sourceKey: source.key,
      providerId: source.resources.providerId,
      providerVersion: source.resources.providerVersion,
      normalizationVersion: source.resources.normalizationVersion,
      kinds: uniqueSorted(source.resources.kinds, `${source.key}.resources.kinds`),
    }))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
  const providerIds = new Set<string>()
  for (const provider of providers) {
    if (!provider.providerId || !provider.providerVersion || !provider.normalizationVersion) {
      fail('invalid-provider', `${provider.sourceKey} Provider 缺少 id/version/normalization`)
    }
    if (providerIds.has(provider.providerId)) fail('duplicate-provider', `Provider id 重复: ${provider.providerId}`)
    providerIds.add(provider.providerId)
    for (const kind of provider.kinds) {
      if (!KINDS.includes(kind)) fail('unregistered-kind', `Provider ${provider.providerId} 声明未知 kind ${kind}`)
    }
  }
  return providers
}

export function normalizeContextAccessPolicyV1(
  policy: ContextAccessPolicyV1,
  sources: readonly ContextSource[],
): ContextAccessPolicyV1 {
  assertExactKeys(policy, [
    'version', 'policyId', 'mandatorySourceKeys', 'allowedSourceKeys', 'allowedResourceKinds',
    'allowedDepths', 'selectorPolicyId', 'maxReadCalls', 'maxRetrievedTokens',
    'perKindMinimumTokens', 'allowOriginalRead', 'candidateAccess',
  ], 'ContextAccessPolicyV1')
  if (policy.version !== 'context-access-policy-v1') fail('unsupported-policy', '只支持 ContextAccessPolicyV1')
  if (policy.allowOriginalRead !== true && policy.allowOriginalRead !== false) {
    fail('invalid-policy', 'allowOriginalRead 必须是 boolean')
  }
  if (policy.candidateAccess !== 'forbidden' && policy.candidateAccess !== 'explicit-resource-key-only') {
    fail('invalid-policy', 'candidateAccess 非法')
  }
  const sourceByKey = new Map(sources.map(source => [source.key, source]))
  const allowedSourceKeys = uniqueSorted(policy.allowedSourceKeys, 'allowedSourceKeys')
  const mandatorySourceKeys = uniqueSorted(policy.mandatorySourceKeys, 'mandatorySourceKeys')
  for (const sourceKey of allowedSourceKeys) {
    const source = sourceByKey.get(sourceKey)
    if (!source) fail('unregistered-source', `Policy 引用了未登记 CONTEXT_SOURCES: ${sourceKey}`)
    if (!source.resources) fail('missing-provider', `Policy source ${sourceKey} 未挂 Provider`)
  }
  if (mandatorySourceKeys.some(sourceKey => !allowedSourceKeys.includes(sourceKey))) {
    fail('mandatory-outside-policy', 'mandatory source 必须属于 allowed source')
  }
  const allowedKinds = uniqueSorted(policy.allowedResourceKinds, 'allowedResourceKinds')
  const providerKinds = new Set(allowedSourceKeys.flatMap(key => sourceByKey.get(key)!.resources!.kinds))
  for (const kind of allowedKinds) {
    if (!KINDS.includes(kind) || !providerKinds.has(kind)) fail('unregistered-kind', `Policy kind 未由允许的 Provider 提供: ${kind}`)
  }
  const allowedDepths = uniqueSorted(policy.allowedDepths, 'allowedDepths')
  for (const depth of allowedDepths) if (!DEPTHS.includes(depth)) fail('unregistered-depth', `Policy depth 非法: ${depth}`)
  if (allowedDepths.includes('original') && !policy.allowOriginalRead) fail('original-forbidden', '禁止 original read 时不得声明 original depth')
  if (!policy.policyId.trim() || !policy.selectorPolicyId.trim()) fail('invalid-policy', 'Policy id/selector version 不得为空')
  if (!Number.isSafeInteger(policy.maxReadCalls) || policy.maxReadCalls < 0
    || !Number.isSafeInteger(policy.maxRetrievedTokens) || policy.maxRetrievedTokens < 0) {
    fail('invalid-budget', 'Gateway read/token budget 非法')
  }
  if (policy.perKindMinimumTokens) {
    for (const [kind, tokens] of Object.entries(policy.perKindMinimumTokens)) {
      if (!KINDS.includes(kind as ContextResourceKind)
        || !Number.isSafeInteger(tokens) || tokens! < 0 || tokens! > policy.maxRetrievedTokens) {
        fail('invalid-budget', `perKindMinimumTokens.${kind} 非法`)
      }
    }
  }
  return {
    ...policy,
    mandatorySourceKeys,
    allowedSourceKeys,
    allowedResourceKinds: allowedKinds,
    allowedDepths,
    ...(policy.perKindMinimumTokens == null ? {} : {
      perKindMinimumTokens: Object.fromEntries(Object.entries(policy.perKindMinimumTokens)
        .sort(([left], [right]) => left.localeCompare(right))),
    }),
  }
}

export function isContextResourceDiscoverableV1(input: {
  descriptor: ContextResourceDescriptorV1
  policy: ContextAccessPolicyV1
  explicitResourceKey?: string
}): boolean {
  const { descriptor, policy } = input
  if (!policy.allowedSourceKeys.includes(descriptor.sourceKey)
    || !policy.allowedResourceKinds.includes(descriptor.kind)) return false
  if (descriptor.authority !== 'candidate') return true
  return policy.candidateAccess === 'explicit-resource-key-only'
    && input.explicitResourceKey === descriptor.resourceKey
}

export function filterContextResourcePageV1(input: {
  page: ResourcePageV1
  policy: ContextAccessPolicyV1
  explicitResourceKey?: string
}): ResourcePageV1 {
  return {
    ...input.page,
    items: input.page.items.filter(descriptor => isContextResourceDiscoverableV1({
      descriptor,
      policy: input.policy,
      explicitResourceKey: input.explicitResourceKey,
    })),
  }
}

export function assertContextReadPermissionV1(input: {
  descriptor: ContextResourceDescriptorV1
  depth: ContextResourceDepthV1
  policy: ContextAccessPolicyV1
  explicitResourceKey?: string
}): void {
  if (!isContextResourceDiscoverableV1(input)) fail('resource-forbidden', `${input.descriptor.resourceKey} 不可发现或读取`)
  if (!input.policy.allowedDepths.includes(input.depth) || !input.descriptor.availableDepths.includes(input.depth)) {
    fail('depth-forbidden', `${input.descriptor.resourceKey} 不允许 depth ${input.depth}`)
  }
  if (input.depth === 'original' && !input.policy.allowOriginalRead) fail('original-forbidden', 'Policy 禁止 original read')
}

export async function createContextSufficiencyReportV1(input: {
  obligations: readonly ContextSufficiencyObligationV1[]
  assumptions?: readonly string[]
  readsAllowed: boolean
}): Promise<ContextSufficiencyReportV1> {
  const obligations = [...input.obligations]
    .map(obligation => {
      assertExactKeys(obligation, ['id', 'kind', 'required', 'status', 'evidenceResourceKeys', 'reasonCode'], 'ContextSufficiencyObligationV1')
      if (!obligation.id.trim() || !obligation.reasonCode.trim()) fail('invalid-obligation', 'Sufficiency obligation 缺少 id/reasonCode')
      if (!['mandatory-source', 'resource-kind', 'entity', 'time-boundary', 'conflict-check'].includes(obligation.kind)
        || !['satisfied', 'missing', 'conflicted', 'not-applicable'].includes(obligation.status)
        || (obligation.required !== true && obligation.required !== false)) {
        fail('invalid-obligation', `${obligation.id} 的 kind/status/required 非法`)
      }
      const evidenceResourceKeys = uniqueSorted(obligation.evidenceResourceKeys, `${obligation.id}.evidenceResourceKeys`)
      if (obligation.status === 'satisfied' && evidenceResourceKeys.length === 0) {
        fail('invalid-obligation', `${obligation.id} satisfied 时必须提供 evidenceResourceKeys`)
      }
      if (obligation.status === 'not-applicable' && evidenceResourceKeys.length !== 0) {
        fail('invalid-obligation', `${obligation.id} not-applicable 时不得提供 evidenceResourceKeys`)
      }
      return { ...obligation, evidenceResourceKeys }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  if (new Set(obligations.map(item => item.id)).size !== obligations.length) fail('duplicate-obligation', 'Sufficiency obligation id 重复')
  const hardFailure = obligations.some(item => item.required && (item.status === 'missing' || item.status === 'conflicted'))
  const softMissing = obligations.some(item => !item.required && (item.status === 'missing' || item.status === 'conflicted'))
  const additionalRead = hardFailure
    ? 'forbidden' as const
    : softMissing
      ? input.readsAllowed ? 'needed' as const : 'forbidden' as const
      : 'not-needed' as const
  const body = {
    version: 'context-sufficiency-v1' as const,
    obligations,
    assumptions: uniqueSorted(input.assumptions ?? [], 'assumptions'),
    additionalRead,
  }
  return { ...body, reportHash: await hashCanonicalValue(body) }
}

export async function createRetrievalTraceV1(
  input: Omit<RetrievalTraceV1, 'version' | 'totalTokens' | 'traceHash'>,
): Promise<RetrievalTraceV1> {
  const totalTokens = [...input.mandatory, ...input.autoSelected, ...input.agentReads]
    .reduce((sum, item) => sum + item.tokenCount, 0)
  const body = { version: 1 as const, ...input, totalTokens }
  return { ...body, traceHash: await hashCanonicalValue(body) }
}

export async function createContextPacketV1(input: {
  scopeFingerprint: string
  gatewayVersionHash: string
  policyHash: string
  sufficiencyReportHash: string
  retrievalTraceHash: string
  content: string
  sourceRefs: readonly ContextSourceRefV1[]
}): Promise<ContextPacketV1> {
  for (const field of ['gatewayVersionHash', 'policyHash', 'sufficiencyReportHash', 'retrievalTraceHash'] as const) {
    requireHash(input[field], field)
  }
  for (const ref of input.sourceRefs) assertContextSourceRefV1(ref)
  const contentHash = await sha256Text(input.content)
  const body = {
    version: 'context-packet-v1' as const,
    ...input,
    sourceRefs: [...input.sourceRefs].sort((left, right) => (
      left.table.localeCompare(right.table)
        || String(left.recordId).localeCompare(String(right.recordId))
        || left.field.localeCompare(right.field)
    )),
    contentHash,
    tokenCount: estimateTokens(input.content),
  }
  return { ...body, packetHash: await hashCanonicalValue(body) }
}

export async function createAgentRunArtifactWireV1(
  input: Omit<AgentRunArtifactV1, 'version' | 'contentHash' | 'byteSize'>,
): Promise<AgentRunArtifactV1> {
  if (typeof input.content === 'string') {
    assertExactRunArtifactBodySafeV1({ artifactKind: input.artifactKind, body: input.content })
  } else if (input.encoding !== 'gzip-utf-8') {
    fail('invalid-artifact-encoding', 'Uint8Array artifact 必须声明 gzip-utf-8')
  }
  const bytes = typeof input.content === 'string' ? new TextEncoder().encode(input.content) : input.content
  const contentHash = typeof input.content === 'string'
    ? await sha256Text(input.content)
    : [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(input.content).buffer))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { version: 'agent-run-artifact-v1', ...input, contentHash, byteSize: bytes.byteLength }
}

export async function createContextGatewayContractSnapshotV1(input: {
  policy: ContextAccessPolicyV1
  sources: readonly ContextSource[]
  gatewayVersion: string
  selectorVersion: string
  sufficiencyObligationsVersion: string
  toolSchemaHash: string
  normalizationVersion: string
}): Promise<ContextGatewayContractSnapshotV1> {
  requireHash(input.toolSchemaHash, 'toolSchemaHash')
  const policy = normalizeContextAccessPolicyV1(input.policy, input.sources)
  const policyHash = await hashCanonicalValue(policy)
  const providers = providerSnapshot(input.sources)
  const providerSetHash = await hashCanonicalValue(providers)
  const gatewayBody = {
    version: 'context-gateway-version-v1' as const,
    gatewayVersion: input.gatewayVersion,
    selectorVersion: input.selectorVersion,
    descriptorContractVersion: 'context-resource-descriptor-v1' as const,
    providerSetHash,
    sufficiencyObligationsVersion: input.sufficiencyObligationsVersion,
    toolSchemaHash: input.toolSchemaHash,
    normalizationVersion: input.normalizationVersion,
  }
  const gateway: ContextGatewayVersionV1 = {
    ...gatewayBody,
    versionHash: await hashCanonicalValue(gatewayBody),
  }
  const snapshotBody = { version: 1 as const, policy, policyHash, providers, gateway }
  return { ...snapshotBody, snapshotHash: await hashCanonicalValue(snapshotBody) }
}

/** Strict read-only parser for frozen V1 Run snapshots; it never upgrades them to current code. */
export async function parseContextGatewayContractSnapshotV1(
  value: unknown,
): Promise<ContextGatewayContractSnapshotV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-snapshot', 'Gateway snapshot 必须是对象')
  const snapshot = value as ContextGatewayContractSnapshotV1
  if (snapshot.version !== 1 || snapshot.gateway?.version !== 'context-gateway-version-v1') {
    fail('unsupported-snapshot', '只支持冻结的 Context Gateway V1 snapshot')
  }
  assertExactKeys(snapshot, ['version', 'policy', 'policyHash', 'providers', 'gateway', 'snapshotHash'], 'Gateway snapshot')
  if (!snapshot.policy || !Array.isArray(snapshot.providers) || !snapshot.gateway) fail('invalid-snapshot', 'Gateway snapshot 字段缺失')
  assertExactKeys(snapshot.policy, [
    'version', 'policyId', 'mandatorySourceKeys', 'allowedSourceKeys', 'allowedResourceKinds',
    'allowedDepths', 'selectorPolicyId', 'maxReadCalls', 'maxRetrievedTokens',
    'perKindMinimumTokens', 'allowOriginalRead', 'candidateAccess',
  ], 'Gateway policy')
  if (snapshot.policy.version !== 'context-access-policy-v1'
    || !['forbidden', 'explicit-resource-key-only'].includes(snapshot.policy.candidateAccess)
    || !Array.isArray(snapshot.policy.allowedSourceKeys)
    || !Array.isArray(snapshot.policy.mandatorySourceKeys)
    || !Array.isArray(snapshot.policy.allowedResourceKinds)
    || snapshot.policy.allowedResourceKinds.some(kind => !KINDS.includes(kind))
    || !Array.isArray(snapshot.policy.allowedDepths)
    || snapshot.policy.allowedDepths.some(depth => !DEPTHS.includes(depth))) {
    fail('invalid-policy', '冻结 Gateway policy 不符合 V1 闭集')
  }
  if (snapshot.policy.mandatorySourceKeys.some(key => !snapshot.policy.allowedSourceKeys.includes(key))) {
    fail('invalid-policy', '冻结 Gateway mandatory source 越权')
  }
  const providerSourceKeys = new Set<string>()
  const providerIds = new Set<string>()
  for (const provider of snapshot.providers) {
    assertExactKeys(provider, ['sourceKey', 'providerId', 'providerVersion', 'normalizationVersion', 'kinds'], 'Gateway provider snapshot')
    if (!provider.sourceKey || !provider.providerId || !provider.providerVersion || !provider.normalizationVersion
      || !Array.isArray(provider.kinds) || provider.kinds.some(kind => !KINDS.includes(kind))
      || providerSourceKeys.has(provider.sourceKey) || providerIds.has(provider.providerId)) {
      fail('invalid-provider', '冻结 Gateway provider set 不符合 V1 合同')
    }
    providerSourceKeys.add(provider.sourceKey)
    providerIds.add(provider.providerId)
  }
  if (snapshot.policy.allowedSourceKeys.some(key => !providerSourceKeys.has(key))) {
    fail('invalid-policy', '冻结 Gateway policy 引用了未冻结 Provider')
  }
  assertExactKeys(snapshot.gateway, [
    'version', 'gatewayVersion', 'selectorVersion', 'descriptorContractVersion',
    'providerSetHash', 'sufficiencyObligationsVersion', 'toolSchemaHash',
    'normalizationVersion', 'versionHash',
  ], 'Gateway version')
  const policyHash = await hashCanonicalValue(snapshot.policy)
  if (policyHash !== snapshot.policyHash) fail('policy-hash-mismatch', 'Gateway policy hash 不匹配')
  const providers = [...snapshot.providers].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
  const providerSetHash = await hashCanonicalValue(providers)
  if (providerSetHash !== snapshot.gateway.providerSetHash) fail('provider-hash-mismatch', 'Gateway provider set hash 不匹配')
  const { versionHash, ...gatewayBody } = snapshot.gateway
  if (await hashCanonicalValue(gatewayBody) !== versionHash) fail('version-hash-mismatch', 'Gateway version hash 不匹配')
  const { snapshotHash, ...snapshotBody } = snapshot
  if (await hashCanonicalValue(snapshotBody) !== snapshotHash) fail('snapshot-hash-mismatch', 'Gateway snapshot hash 不匹配')
  return snapshot
}

export const CONTEXT_GATEWAY_RESOURCE_KINDS_V1 = KINDS
export const CONTEXT_GATEWAY_DEPTHS_V1 = DEPTHS
