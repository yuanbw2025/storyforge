import { hashCanonicalValue } from '../agent/run/hash'
import { CONTEXT_SOURCES } from '../registry/context-sources'
import type {
  ContextAccessPolicyV1,
  ContextResourceDescriptorV1,
  ContextResourceProviderV1,
  ContextSource,
  ContextSourceRefV1,
  FrozenResourceScopeV1,
} from '../registry/types'
import { normalizeContextAccessPolicyV1 } from './contracts'

const MAX_SOURCE_CAPABILITIES_PER_RESOURCE = 64

export interface ContextGatewayProviderBindingV1 {
  source: ContextSource
  provider: ContextResourceProviderV1
}

interface SourceRefCapabilityV1 {
  resourceKey: string
  descriptor: ContextResourceDescriptorV1
  sourceRef: ContextSourceRefV1
}

export interface ContextGatewayToolSessionV1 {
  readonly version: 'context-gateway-tool-session-v1'
  readonly scope: FrozenResourceScopeV1
  readonly scopeFingerprint: string
  readonly policy: ContextAccessPolicyV1
  readonly policyHash: string
  readonly providers: readonly ContextGatewayProviderBindingV1[]
  /** Optional product-contract narrowing. It can only remove catalog resources;
   * source/kind/depth authority still comes from the hashed access policy. */
  readonly resourceKeyAllowList: ReadonlySet<string> | null
  readonly usage: { readCalls: number; retrievedTokens: number }
  readonly capabilities: Map<string, SourceRefCapabilityV1>
}

export class ContextGatewayToolSessionErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[context-gateway-session:${code}] ${message}`)
    this.name = 'ContextGatewayToolSessionErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new ContextGatewayToolSessionErrorV1(code, message)
}

export async function createContextGatewayToolSessionV1(input: {
  scope: FrozenResourceScopeV1
  policy: ContextAccessPolicyV1
  allowedResourceKeys?: readonly string[]
}): Promise<ContextGatewayToolSessionV1> {
  const policy = normalizeContextAccessPolicyV1(input.policy, CONTEXT_SOURCES)
  Object.freeze(policy.mandatorySourceKeys)
  Object.freeze(policy.allowedSourceKeys)
  Object.freeze(policy.allowedResourceKinds)
  Object.freeze(policy.allowedDepths)
  if (policy.perKindMinimumTokens) Object.freeze(policy.perKindMinimumTokens)
  Object.freeze(policy)
  const allowed = new Set(policy.allowedSourceKeys)
  const providers = CONTEXT_SOURCES
    .filter((source): source is ContextSource & { resources: ContextResourceProviderV1 } => (
      allowed.has(source.key) && source.resources != null
    ))
    .map(source => ({ source, provider: source.resources }))
    .sort((left, right) => left.source.key.localeCompare(right.source.key))
  if (!providers.length) fail('provider', 'Policy 没有可用的 CONTEXT_SOURCES Provider')
  const fingerprints = await Promise.all(providers.map(binding => binding.provider.fingerprint(input.scope)))
  if (new Set(fingerprints).size !== 1) fail('scope', 'Provider 对冻结 scope 的 fingerprint 不一致')
  const allowedResourceKeys = input.allowedResourceKeys == null
    ? null
    : new Set(input.allowedResourceKeys)
  if (allowedResourceKeys && (allowedResourceKeys.size !== input.allowedResourceKeys!.length
    || [...allowedResourceKeys].some(key => !key.trim()))) {
    fail('resource-allow-list', '资源 allow-list 含重复或空 key')
  }
  return {
    version: 'context-gateway-tool-session-v1',
    scope: Object.freeze({ ...input.scope }),
    scopeFingerprint: fingerprints[0],
    policy,
    policyHash: await hashCanonicalValue(policy),
    providers: Object.freeze(providers),
    resourceKeyAllowList: allowedResourceKeys,
    usage: { readCalls: 0, retrievedTokens: 0 },
    capabilities: new Map(),
  }
}

export function isContextGatewayResourceAllowedV1(
  session: ContextGatewayToolSessionV1,
  resourceKey: string,
): boolean {
  return session.resourceKeyAllowList == null || session.resourceKeyAllowList.has(resourceKey)
}

export function claimContextGatewayReadCallV1(session: ContextGatewayToolSessionV1): void {
  if (session.usage.readCalls >= session.policy.maxReadCalls) {
    fail('call-budget', `Context Gateway read call 已达到上限 ${session.policy.maxReadCalls}`)
  }
  session.usage.readCalls += 1
}

export function assertContextGatewayTokenRequestV1(
  session: ContextGatewayToolSessionV1,
  requestedTokens: number,
): void {
  if (!Number.isSafeInteger(requestedTokens) || requestedTokens < 1) {
    fail('token-budget', '请求 token 必须是正整数')
  }
  const remaining = session.policy.maxRetrievedTokens - session.usage.retrievedTokens
  if (requestedTokens > remaining) {
    fail('token-budget', `请求 ${requestedTokens} tokens 超过 Gateway 剩余额度 ${Math.max(0, remaining)}`)
  }
}

export function settleContextGatewayTokensV1(
  session: ContextGatewayToolSessionV1,
  tokens: number,
): void {
  if (!Number.isSafeInteger(tokens) || tokens < 0) fail('token-budget', '实际 token 计数非法')
  const next = session.usage.retrievedTokens + tokens
  if (next > session.policy.maxRetrievedTokens) {
    fail('token-budget', `工具结果使 Gateway 超过 ${session.policy.maxRetrievedTokens} token 总额度`)
  }
  session.usage.retrievedTokens = next
}

export function issueContextSourceRefCapabilitiesV1(
  session: ContextGatewayToolSessionV1,
  descriptor: ContextResourceDescriptorV1,
): string[] {
  if (descriptor.sourceRefs.length > MAX_SOURCE_CAPABILITIES_PER_RESOURCE) {
    fail('source-ref', `单个资源 SourceRef 超过 ${MAX_SOURCE_CAPABILITIES_PER_RESOURCE} 条上限`)
  }
  // Deterministic for replay/cache stability; authority still comes from presence in this session map.
  const tokens = descriptor.sourceRefs.map((_sourceRef, index) => (
    `ctxref_v1_${descriptor.contentHash}_${descriptor.policyHash}_${index}`
  ))
  const newTokenCount = tokens.filter(token => !session.capabilities.has(token)).length
  if (session.capabilities.size + newTokenCount
    > session.policy.maxReadCalls * MAX_SOURCE_CAPABILITIES_PER_RESOURCE) {
    fail('source-ref', '当前 Gateway session 的 SourceRef capability 已达到上限')
  }
  return descriptor.sourceRefs.map((sourceRef, index) => {
    const token = tokens[index]
    session.capabilities.set(token, { resourceKey: descriptor.resourceKey, descriptor, sourceRef })
    return token
  })
}

export function resolveContextSourceRefCapabilityV1(
  session: ContextGatewayToolSessionV1,
  token: string,
): SourceRefCapabilityV1 {
  const capability = session.capabilities.get(token)
  if (!capability) fail('source-ref', 'SourceRef capability 未由当前 Gateway session 签发或已经失效')
  return capability
}
