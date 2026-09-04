import { estimateTokens } from '../ai/context-budget'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import {
  assertContextReadPermissionV1,
  assertContextResourceDescriptorV1,
  assertResourcePageV1,
  filterContextResourcePageV1,
} from '../context-gateway/contracts'
import {
  assertContextGatewayTokenRequestV1,
  claimContextGatewayReadCallV1,
  isContextGatewayResourceAllowedV1,
  issueContextSourceRefCapabilitiesV1,
  resolveContextSourceRefCapabilityV1,
  settleContextGatewayTokensV1,
  type ContextGatewayProviderBindingV1,
  type ContextGatewayToolSessionV1,
} from '../context-gateway/tool-session'
import { hashCanonicalValue } from './run/hash'
import type {
  ContextResourceDepthV1,
  ContextResourceDescriptorV1,
  ContextResourceKind,
  ContextSourceRefV1,
  ContextTimeRangeV1,
  ResourcePageV1,
} from '../registry/types'
import { CONTEXT_RESOURCE_KINDS_V1 } from '../registry/types'
import { CONTEXT_SOURCES } from '../registry/context-sources'
import type {
  AgentToolDefinition,
  AgentToolExecutionContext,
  AgentToolResult,
} from './types'

const MAX_PAGE_SIZE = 20
const MAX_RESOURCE_READ_TOKENS = 50_000
const GATEWAY_SOURCE_KEYS: readonly string[] = CONTEXT_SOURCES
  .filter(source => source.resources != null)
  .map(source => source.key)
  .sort()
const RESOURCE_DEPTHS = ['index', 'summary', 'focused', 'full'] as const
const TOOL_RESULT_BUDGETS: Readonly<Record<string, number>> = {
  list_context_catalog: 12_000,
  search_context: 12_000,
  read_context_resource: MAX_RESOURCE_READ_TOKENS,
  read_original_evidence: MAX_RESOURCE_READ_TOKENS,
}

interface GatewayCursorV1 {
  version: 1
  operation: 'list' | 'search'
  providerIndex: number
  providerCursor?: string
  requestHash: string
  scopeFingerprint: string
}

function failure(
  toolName: string,
  session: ContextGatewayToolSessionV1 | undefined,
  error: unknown,
): AgentToolResult {
  return {
    ok: false,
    content: '',
    error: error instanceof Error ? error.message : 'Context Gateway 工具执行失败',
    meta: {
      toolName,
      sourceKeys: GATEWAY_SOURCE_KEYS,
      included: [],
      omitted: [],
      trimmed: [],
      sourceEvidence: [],
      totalInputTokens: 0,
      inputBudget: Math.min(
        session?.policy.maxRetrievedTokens ?? 0,
        TOOL_RESULT_BUDGETS[toolName] ?? 0,
      ),
      overBudgetBeforeTrim: false,
      overBudgetAfterTrim: false,
    },
  }
}

function exactArgs(raw: Record<string, unknown>, allowed: readonly string[]): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工具参数必须是对象')
  const unknown = Object.keys(raw).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`不允许的参数：${unknown.join(', ')}`)
}

function assertExecutionContext(
  context: AgentToolExecutionContext,
  session: ContextGatewayToolSessionV1,
): void {
  if (context.projectId !== session.scope.projectId) throw new Error('执行上下文 projectId 与冻结 Gateway scope 不一致')
  if (context.scope && (context.scope.projectId !== session.scope.projectId
    || context.scope.worldId !== session.scope.worldId
    || context.scope.workId !== session.scope.workId)) {
    throw new Error('执行上下文 World/Work 与冻结 Gateway scope 不一致')
  }
  if (context.worldGroupId !== undefined
    && (context.worldGroupId ?? null) !== (session.scope.worldGroupId ?? null)) {
    throw new Error('执行上下文 worldGroupId 与冻结 Gateway scope 不一致')
  }
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return Number(value)
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} 必须是 1-${maxLength} 个字符的字符串`)
  }
  return value.trim()
}

function resourceKinds(value: unknown, session: ContextGatewayToolSessionV1): ContextResourceKind[] {
  if (value == null) return [...session.policy.allowedResourceKinds]
  if (!Array.isArray(value) || !value.length || value.length > CONTEXT_RESOURCE_KINDS_V1.length) {
    throw new Error('kinds 必须是非空资源类型数组')
  }
  const kinds = [...new Set(value)]
  for (const kind of kinds) {
    if (typeof kind !== 'string' || !CONTEXT_RESOURCE_KINDS_V1.includes(kind as ContextResourceKind)) {
      throw new Error(`kinds 包含未知类型：${String(kind)}`)
    }
    if (!session.policy.allowedResourceKinds.includes(kind as ContextResourceKind)) {
      throw new Error(`ContextAccessPolicy 未授权资源类型：${kind}`)
    }
  }
  return (kinds as ContextResourceKind[]).sort()
}

function resourceKeys(value: unknown, label: string): string[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value) || !value.length || value.length > 20
    || value.some(key => typeof key !== 'string' || !key.trim() || key.length > 300)) {
    throw new Error(`${label} 必须包含 1-20 个有效 resource key`)
  }
  return [...new Set(value.map(key => String(key).trim()))].sort()
}

function timeRange(value: unknown): ContextTimeRangeV1 | undefined {
  if (value == null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('timeRange 必须是对象')
  const raw = value as Record<string, unknown>
  const allowed = ['start', 'end', 'throughChapterId']
  const unknown = Object.keys(raw).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`timeRange 不允许字段：${unknown.join(', ')}`)
  const start = optionalString(raw.start, 'timeRange.start', 120)
  const end = optionalString(raw.end, 'timeRange.end', 120)
  const throughChapterId = raw.throughChapterId == null
    ? undefined
    : integer(raw.throughChapterId, 'timeRange.throughChapterId', 1, Number.MAX_SAFE_INTEGER)
  if (start == null && end == null && throughChapterId == null) throw new Error('timeRange 至少需要一个边界')
  return { ...(start ? { start } : {}), ...(end ? { end } : {}), ...(throughChapterId ? { throughChapterId } : {}) }
}

function encodeCursor(cursor: GatewayCursorV1): string {
  return btoa(JSON.stringify(cursor))
}

function decodeCursor(value: string | undefined): GatewayCursorV1 | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(atob(value)) as GatewayCursorV1
    if (parsed.version !== 1
      || (parsed.operation !== 'list' && parsed.operation !== 'search')
      || !Number.isSafeInteger(parsed.providerIndex) || parsed.providerIndex < 0
      || typeof parsed.requestHash !== 'string'
      || typeof parsed.scopeFingerprint !== 'string'
      || (parsed.providerCursor != null && typeof parsed.providerCursor !== 'string')) {
      throw new Error('cursor 字段非法')
    }
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message === 'cursor 字段非法') throw error
    throw new Error('cursor 不是合法的 Context Gateway cursor')
  }
}

function publicDescriptor(
  descriptor: ContextResourceDescriptorV1,
  session: ContextGatewayToolSessionV1,
) {
  const availableDepths = descriptor.availableDepths.filter(depth => (
    session.policy.allowedDepths.includes(depth)
      && (depth !== 'original' || session.policy.allowOriginalRead)
  ))
  return {
    version: descriptor.version,
    resourceKey: descriptor.resourceKey,
    sourceKey: descriptor.sourceKey,
    kind: descriptor.kind,
    title: descriptor.title,
    shortSummary: descriptor.shortSummary,
    authority: descriptor.authority,
    contentRevision: descriptor.contentRevision,
    contentHash: descriptor.contentHash,
    policyRevision: descriptor.policyRevision,
    policyHash: descriptor.policyHash,
    scope: descriptor.scope,
    relations: descriptor.relations,
    ...(descriptor.timeRange ? { timeRange: descriptor.timeRange } : {}),
    tokenEstimate: descriptor.tokenEstimate,
    availableDepths,
    priority: descriptor.priority,
    sourceRefCount: descriptor.sourceRefs.length,
  }
}

function gatewayMeta(input: {
  session: ContextGatewayToolSessionV1
  operation: NonNullable<AgentToolResult['meta']['gateway']>['operation']
  bindings: readonly ContextGatewayProviderBindingV1[]
  descriptors: readonly ContextResourceDescriptorV1[]
  contentHashes?: readonly string[]
  capabilities?: readonly string[]
  sourceRefEvidence?: NonNullable<AgentToolResult['meta']['gateway']>['sourceRefEvidence']
  nextCursor?: string | null
}) {
  return {
    version: 1 as const,
    operation: input.operation,
    scopeFingerprint: input.session.scopeFingerprint,
    policyId: input.session.policy.policyId,
    policyHash: input.session.policyHash,
    providerIds: [...new Set(input.bindings.map(binding => binding.provider.providerId))].sort(),
    resourceKeys: input.descriptors.map(descriptor => descriptor.resourceKey),
    contentHashes: [...(input.contentHashes ?? input.descriptors.map(descriptor => descriptor.contentHash))],
    sourceRefCapabilities: [...(input.capabilities ?? [])],
    sourceRefEvidence: [...(input.sourceRefEvidence ?? [])],
    nextCursor: input.nextCursor ?? null,
    readCallsUsed: input.session.usage.readCalls,
    retrievedTokensUsed: input.session.usage.retrievedTokens,
  }
}

function success(input: {
  toolName: string
  session: ContextGatewayToolSessionV1
  operation: NonNullable<AgentToolResult['meta']['gateway']>['operation']
  bindings: readonly ContextGatewayProviderBindingV1[]
  descriptors: readonly ContextResourceDescriptorV1[]
  content: string
  contentHashes?: readonly string[]
  capabilities?: readonly string[]
  sourceRefEvidence?: NonNullable<AgentToolResult['meta']['gateway']>['sourceRefEvidence']
  nextCursor?: string | null
}): AgentToolResult {
  const tokens = estimateTokens(input.content)
  const toolBudget = TOOL_RESULT_BUDGETS[input.toolName] ?? 0
  if (tokens > toolBudget) throw new Error(`${input.toolName} 结果超过 ${toolBudget} token 单次上限`)
  settleContextGatewayTokensV1(input.session, tokens)
  return {
    ok: true,
    content: input.content,
    meta: {
      toolName: input.toolName,
      sourceKeys: [...new Set(input.bindings.map(binding => binding.source.key))],
      included: input.descriptors.map(descriptor => descriptor.resourceKey),
      omitted: [],
      trimmed: [],
      sourceEvidence: [],
      totalInputTokens: tokens,
      inputBudget: Math.min(input.session.policy.maxRetrievedTokens, toolBudget),
      overBudgetBeforeTrim: false,
      overBudgetAfterTrim: false,
      gateway: gatewayMeta({
        ...input,
        contentHashes: input.contentHashes,
        capabilities: input.capabilities,
        sourceRefEvidence: input.sourceRefEvidence,
      }),
    },
  }
}

async function catalogPage(input: {
  session: ContextGatewayToolSessionV1
  operation: 'list' | 'search'
  kinds: ContextResourceKind[]
  limit: number
  cursor?: string
  query?: string
  entityKeys?: string[]
  storyArcKeys?: string[]
  timeRange?: ContextTimeRangeV1
}): Promise<{ page: ResourcePageV1; bindings: ContextGatewayProviderBindingV1[] }> {
  const requestHash = await hashCanonicalValue({
    version: 1,
    operation: input.operation,
    scopeFingerprint: input.session.scopeFingerprint,
    policyHash: input.session.policyHash,
    kinds: input.kinds,
    query: input.query ?? null,
    entityKeys: input.entityKeys ?? [],
    storyArcKeys: input.storyArcKeys ?? [],
    timeRange: input.timeRange ?? null,
  })
  const cursor = decodeCursor(input.cursor)
  if (cursor && (cursor.operation !== input.operation
    || cursor.requestHash !== requestHash
    || cursor.scopeFingerprint !== input.session.scopeFingerprint)) {
    throw new Error('cursor 不属于当前 operation/scope/policy/filter')
  }
  const items: ContextResourceDescriptorV1[] = []
  const usedBindings: ContextGatewayProviderBindingV1[] = []
  let providerIndex = cursor?.providerIndex ?? 0
  let providerCursor = cursor?.providerCursor
  let nextCursor: string | null = null
  while (providerIndex < input.session.providers.length && items.length < input.limit) {
    const binding = input.session.providers[providerIndex]
    const kinds = input.kinds.filter(kind => binding.provider.kinds.includes(kind))
    if (!kinds.length) {
      providerIndex += 1
      providerCursor = undefined
      continue
    }
    const remaining = input.limit - items.length
    const rawPage = input.operation === 'search'
      ? await binding.provider.searchMetadata({
        scope: input.session.scope,
        kinds,
        limit: remaining,
        cursor: providerCursor,
        query: input.query!,
        entityKeys: input.entityKeys,
        storyArcKeys: input.storyArcKeys,
        timeRange: input.timeRange,
      })
      : await binding.provider.listMetadata({
        scope: input.session.scope,
        kinds,
        limit: remaining,
        cursor: providerCursor,
      })
    const validated = assertResourcePageV1({
      page: rawPage,
      source: binding.source,
      expectedScopeFingerprint: input.session.scopeFingerprint,
      maxItems: remaining,
    })
    const filtered = filterContextResourcePageV1({ page: validated, policy: input.session.policy })
    items.push(...filtered.items.filter(item => isContextGatewayResourceAllowedV1(input.session, item.resourceKey)))
    usedBindings.push(binding)
    if (rawPage.nextCursor) {
      providerCursor = rawPage.nextCursor
      if (items.length >= input.limit) {
        nextCursor = encodeCursor({
          version: 1,
          operation: input.operation,
          providerIndex,
          providerCursor,
          requestHash,
          scopeFingerprint: input.session.scopeFingerprint,
        })
        break
      }
    } else {
      providerIndex += 1
      providerCursor = undefined
    }
  }
  if (!nextCursor && providerIndex < input.session.providers.length) {
    nextCursor = encodeCursor({
      version: 1,
      operation: input.operation,
      providerIndex,
      ...(providerCursor ? { providerCursor } : {}),
      requestHash,
      scopeFingerprint: input.session.scopeFingerprint,
    })
  }
  return {
    page: { version: 1, items, nextCursor, scopeFingerprint: input.session.scopeFingerprint },
    bindings: usedBindings,
  }
}

async function locateResource(input: {
  session: ContextGatewayToolSessionV1
  resourceKey: string
  maxTokens: number
}): Promise<{ binding: ContextGatewayProviderBindingV1; descriptor: ContextResourceDescriptorV1 }> {
  if (!isContextGatewayResourceAllowedV1(input.session, input.resourceKey)) {
    throw new Error('资源不在当前产品 SourcePlan 的允许集合中')
  }
  let lastError: unknown
  for (const binding of input.session.providers) {
    try {
      const located = await binding.provider.read({
        scope: input.session.scope,
        resourceKey: input.resourceKey,
        depth: 'index',
        maxTokens: Math.min(input.maxTokens, 500),
      })
      assertContextResourceDescriptorV1({ descriptor: located.descriptor, source: binding.source })
      if (located.descriptor.resourceKey !== input.resourceKey) throw new Error('Provider 返回了其它 resource key')
      return { binding, descriptor: located.descriptor }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('资源不存在或不属于当前 Gateway scope')
}

async function executeCatalog(
  context: AgentToolExecutionContext,
  raw: Record<string, unknown>,
): Promise<AgentToolResult> {
  const session = context.contextGatewaySession
  try {
    exactArgs(raw, ['kinds', 'limit', 'cursor'])
    if (!session) throw new Error('Host 未提供冻结的 Context Gateway session')
    assertExecutionContext(context, session)
    claimContextGatewayReadCallV1(session)
    const kinds = resourceKinds(raw.kinds, session)
    const limit = raw.limit == null ? 10 : integer(raw.limit, 'limit', 1, MAX_PAGE_SIZE)
    const cursor = optionalString(raw.cursor, 'cursor', 8000)
    const result = await catalogPage({ session, operation: 'list', kinds, limit, cursor })
    const pageKindCounts = Object.fromEntries(CONTEXT_RESOURCE_KINDS_V1
      .map(kind => [kind, result.page.items.filter(item => item.kind === kind).length] as const)
      .filter(([, count]) => count > 0))
    const content = JSON.stringify({
      version: 1,
      scopeFingerprint: result.page.scopeFingerprint,
      pageKindCounts,
      items: result.page.items.map(descriptor => publicDescriptor(descriptor, session)),
      nextCursor: result.page.nextCursor,
    })
    return success({
      toolName: 'list_context_catalog', session, operation: 'list', bindings: result.bindings,
      descriptors: result.page.items, content, nextCursor: result.page.nextCursor,
    })
  } catch (error) {
    return failure('list_context_catalog', session, error)
  }
}

async function executeSearch(
  context: AgentToolExecutionContext,
  raw: Record<string, unknown>,
): Promise<AgentToolResult> {
  const session = context.contextGatewaySession
  try {
    exactArgs(raw, ['query', 'kinds', 'entityKeys', 'storyArcKeys', 'timeRange', 'limit', 'cursor'])
    if (!session) throw new Error('Host 未提供冻结的 Context Gateway session')
    assertExecutionContext(context, session)
    claimContextGatewayReadCallV1(session)
    const query = optionalString(raw.query, 'query', 200)
    if (!query || query.length < 2) throw new Error('query 长度必须为 2-200')
    const kinds = resourceKinds(raw.kinds, session)
    const entityKeys = resourceKeys(raw.entityKeys, 'entityKeys')
    const storyArcKeys = resourceKeys(raw.storyArcKeys, 'storyArcKeys')
    const range = timeRange(raw.timeRange)
    const limit = raw.limit == null ? 10 : integer(raw.limit, 'limit', 1, MAX_PAGE_SIZE)
    const cursor = optionalString(raw.cursor, 'cursor', 8000)
    const result = await catalogPage({
      session, operation: 'search', kinds, limit, cursor, query, entityKeys, storyArcKeys, timeRange: range,
    })
    const content = JSON.stringify({
      version: 1,
      scopeFingerprint: result.page.scopeFingerprint,
      query,
      items: result.page.items.map(descriptor => publicDescriptor(descriptor, session)),
      nextCursor: result.page.nextCursor,
    })
    return success({
      toolName: 'search_context', session, operation: 'search', bindings: result.bindings,
      descriptors: result.page.items, content, nextCursor: result.page.nextCursor,
    })
  } catch (error) {
    return failure('search_context', session, error)
  }
}

async function executeReadResource(
  context: AgentToolExecutionContext,
  raw: Record<string, unknown>,
): Promise<AgentToolResult> {
  const session = context.contextGatewaySession
  let issued: string[] = []
  try {
    exactArgs(raw, ['resourceKey', 'depth', 'maxTokens'])
    if (!session) throw new Error('Host 未提供冻结的 Context Gateway session')
    assertExecutionContext(context, session)
    claimContextGatewayReadCallV1(session)
    const resourceKey = optionalString(raw.resourceKey, 'resourceKey', 300)
    if (!resourceKey) throw new Error('缺少 resourceKey')
    if (!RESOURCE_DEPTHS.includes(raw.depth as typeof RESOURCE_DEPTHS[number])) throw new Error('depth 未登记')
    const depth = raw.depth as Exclude<ContextResourceDepthV1, 'original'>
    const maxTokens = integer(raw.maxTokens, 'maxTokens', 1, MAX_RESOURCE_READ_TOKENS)
    assertContextGatewayTokenRequestV1(session, maxTokens)
    const located = await locateResource({ session, resourceKey, maxTokens })
    assertContextReadPermissionV1({ descriptor: located.descriptor, depth, policy: session.policy, explicitResourceKey: resourceKey })
    const read = await located.binding.provider.read({ scope: session.scope, resourceKey, depth, maxTokens })
    assertContextResourceDescriptorV1({ descriptor: read.descriptor, source: located.binding.source })
    if (read.descriptor.contentHash !== located.descriptor.contentHash
      || read.descriptor.policyHash !== located.descriptor.policyHash
      || read.contentHash !== await sha256Text(read.content)
      || read.tokenCount !== estimateTokens(read.content)) {
      throw new Error('Provider resource read 完整性校验失败')
    }
    issued = issueContextSourceRefCapabilitiesV1(session, read.descriptor)
    const sourceRefEvidence = issued.map(capability => {
      const evidence = resolveContextSourceRefCapabilityV1(session, capability)
      return {
        capability,
        resourceKey: evidence.resourceKey,
        descriptorContentHash: evidence.descriptor.contentHash,
        descriptorPolicyHash: evidence.descriptor.policyHash,
        sourceRef: evidence.sourceRef,
      }
    })
    const content = JSON.stringify({
      version: 1,
      descriptor: publicDescriptor(read.descriptor, session),
      depth: read.depth,
      content: read.content,
      contentHash: read.contentHash,
      tokenCount: read.tokenCount,
      sourceRefCapabilities: issued,
    })
    return success({
      toolName: 'read_context_resource', session, operation: 'read', bindings: [located.binding],
      descriptors: [read.descriptor], content, contentHashes: [read.contentHash], capabilities: issued,
      sourceRefEvidence,
    })
  } catch (error) {
    for (const token of issued) session?.capabilities.delete(token)
    return failure('read_context_resource', session, error)
  }
}

function sameSourceRef(left: ContextSourceRefV1, right: ContextSourceRefV1): boolean {
  return left.table === right.table
    && left.recordId === right.recordId
    && left.field === right.field
    && left.revision === right.revision
    && left.contentHash === right.contentHash
    && JSON.stringify(left.anchor ?? null) === JSON.stringify(right.anchor ?? null)
}

async function executeReadOriginal(
  context: AgentToolExecutionContext,
  raw: Record<string, unknown>,
): Promise<AgentToolResult> {
  const session = context.contextGatewaySession
  try {
    exactArgs(raw, ['sourceRef', 'maxTokens'])
    if (!session) throw new Error('Host 未提供冻结的 Context Gateway session')
    assertExecutionContext(context, session)
    claimContextGatewayReadCallV1(session)
    const sourceRefToken = optionalString(raw.sourceRef, 'sourceRef', 200)
    if (!sourceRefToken) throw new Error('缺少 sourceRef capability')
    const maxTokens = integer(raw.maxTokens, 'maxTokens', 1, MAX_RESOURCE_READ_TOKENS)
    assertContextGatewayTokenRequestV1(session, maxTokens)
    const capability = resolveContextSourceRefCapabilityV1(session, sourceRefToken)
    assertContextReadPermissionV1({
      descriptor: capability.descriptor,
      depth: 'original',
      policy: session.policy,
      explicitResourceKey: capability.resourceKey,
    })
    const binding = session.providers.find(candidate => candidate.source.key === capability.descriptor.sourceKey)
    if (!binding) throw new Error('SourceRef capability 的 Provider 不在当前 session')
    const original = await binding.provider.readOriginal({
      scope: session.scope,
      resourceKey: capability.resourceKey,
      sourceRef: capability.sourceRef,
      maxTokens,
    })
    assertContextResourceDescriptorV1({ descriptor: original.descriptor, source: binding.source })
    if (!sameSourceRef(original.sourceRef, capability.sourceRef)
      || original.contentHash !== await sha256Text(original.content)
      || original.tokenCount !== estimateTokens(original.content)) {
      throw new Error('Provider original evidence 完整性校验失败')
    }
    const content = JSON.stringify({
      version: 1,
      resourceKey: capability.resourceKey,
      content: original.content,
      contentHash: original.contentHash,
      tokenCount: original.tokenCount,
      source: { revision: original.sourceRef.revision, contentHash: original.sourceRef.contentHash },
    })
    return success({
      toolName: 'read_original_evidence', session, operation: 'original', bindings: [binding],
      descriptors: [original.descriptor], content, contentHashes: [original.contentHash],
    })
  } catch (error) {
    return failure('read_original_evidence', session, error)
  }
}

export const CONTEXT_GATEWAY_READ_TOOLS_V1: readonly AgentToolDefinition[] = [
  {
    name: 'list_context_catalog',
    description: '分页列出当前冻结作用域内获授权的 Canon 资源短元数据与本页分类计数，不返回正文。',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        kinds: { type: 'array', items: { type: 'string', enum: CONTEXT_RESOURCE_KINDS_V1 }, description: '可选资源类型过滤' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, description: '本页条数，默认 10' },
        cursor: { type: 'string', maxLength: 8000, description: '上一页返回的 opaque cursor' },
      },
      additionalProperties: false,
    },
    sourceKeys: GATEWAY_SOURCE_KEYS,
    inputBudgetTokens: 12_000,
    execute: executeCatalog,
  },
  {
    name: 'search_context',
    description: '按关键词、资源类型、实体/故事线关系和时间边界稳定分页搜索当前 Canon 目录。',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 200, description: 'metadata 搜索关键词' },
        kinds: { type: 'array', items: { type: 'string', enum: CONTEXT_RESOURCE_KINDS_V1 }, description: '可选资源类型过滤' },
        entityKeys: { type: 'array', items: { type: 'string' }, description: '资源自身或一跳关系命中的 entity resource keys' },
        storyArcKeys: { type: 'array', items: { type: 'string' }, description: '资源自身或一跳关系命中的 story arc resource keys' },
        timeRange: {
          type: 'object',
          properties: {
            start: { type: 'string', maxLength: 120 },
            end: { type: 'string', maxLength: 120 },
            throughChapterId: { type: 'integer', minimum: 1 },
          },
          additionalProperties: false,
        },
        limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, description: '本页条数，默认 10' },
        cursor: { type: 'string', maxLength: 8000, description: '上一页返回的 opaque cursor' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    sourceKeys: GATEWAY_SOURCE_KEYS,
    inputBudgetTokens: 12_000,
    execute: executeSearch,
  },
  {
    name: 'read_context_resource',
    description: '按获授权 depth 读取一个明确 resource key，并签发可回查原文的 opaque SourceRef capability。',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        resourceKey: { type: 'string', minLength: 3, maxLength: 300 },
        depth: { type: 'string', enum: RESOURCE_DEPTHS },
        maxTokens: { type: 'integer', minimum: 1, maximum: MAX_RESOURCE_READ_TOKENS },
      },
      required: ['resourceKey', 'depth', 'maxTokens'],
      additionalProperties: false,
    },
    sourceKeys: GATEWAY_SOURCE_KEYS,
    inputBudgetTokens: MAX_RESOURCE_READ_TOKENS,
    execute: executeReadResource,
  },
  {
    name: 'read_original_evidence',
    description: '使用当前 Gateway session 先前签发的 opaque SourceRef capability 回查当前版本 Canon 原文。',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        sourceRef: { type: 'string', minLength: 20, maxLength: 200, description: 'read_context_resource 返回的 opaque capability' },
        maxTokens: { type: 'integer', minimum: 1, maximum: MAX_RESOURCE_READ_TOKENS },
      },
      required: ['sourceRef', 'maxTokens'],
      additionalProperties: false,
    },
    sourceKeys: GATEWAY_SOURCE_KEYS,
    inputBudgetTokens: MAX_RESOURCE_READ_TOKENS,
    execute: executeReadOriginal,
  },
]
