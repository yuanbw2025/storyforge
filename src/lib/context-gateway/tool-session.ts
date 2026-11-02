import { sha256 } from '@noble/hashes/sha2.js'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
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
import type { WorldQueryAccessV1 } from '../types/world-query'

export const MAX_SOURCE_CAPABILITIES_PER_RESOURCE = 64

export interface ContextGatewayProviderBindingV1 {
  source: ContextSource
  provider: ContextResourceProviderV1
}

interface SourceRefCapabilityV1 {
  readonly resourceKey: string
  readonly descriptor: ContextResourceDescriptorV1
  readonly sourceRef: ContextSourceRefV1
  readonly bindingCanonical: string
  readonly sourceRefIndex: number
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
  /** Adapter narrowing of a record plus its field/aggregate descendants. */
  readonly resourceKeyDenyList: ReadonlySet<string>
  readonly usage: { readCalls: number; retrievedTokens: number }
  readonly capabilities: Map<string, SourceRefCapabilityV1>
  readonly readSessionGuards?: readonly (() => Promise<void>)[]
  /** Host-issued, unforgeable v4 perspective. Never supplied by model args. */
  readonly worldQueryAccess?: WorldQueryAccessV1
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
  freezeProviderReads?: boolean
  worldQueryAccess?: WorldQueryAccessV1
  excludedRecordResourceKeys?: readonly string[]
}): Promise<ContextGatewayToolSessionV1> {
  const policy = normalizeContextAccessPolicyV1(input.policy, CONTEXT_SOURCES)
  Object.freeze(policy.mandatorySourceKeys)
  Object.freeze(policy.allowedSourceKeys)
  Object.freeze(policy.allowedResourceKinds)
  Object.freeze(policy.allowedDepths)
  if (policy.perKindMinimumTokens) Object.freeze(policy.perKindMinimumTokens)
  Object.freeze(policy)
  const allowed = new Set(policy.allowedSourceKeys)
  const registered = CONTEXT_SOURCES
    .filter((source): source is ContextSource & { resources: ContextResourceProviderV1 } => (
      allowed.has(source.key) && source.resources != null
    ))
    .map(source => ({ source, provider: source.resources }))
    .sort((left, right) => left.source.key.localeCompare(right.source.key))
  if (input.worldQueryAccess && !registered.some(binding => binding.source.key === 'worldRelease')) fail('provider', '叙事读取未登记 worldRelease 来源')
  let providers = await Promise.all(registered.map(async binding => input.worldQueryAccess && binding.source.key === 'worldRelease'
    ? { source: binding.source, provider: await binding.provider.worldQuery!.bind(input.worldQueryAccess, {
      allowedResourceKeys: input.allowedResourceKeys ?? null, allowedKinds: policy.allowedResourceKinds, maxTokens: policy.maxRetrievedTokens,
    }) } : binding))
  if (!providers.length) fail('provider', 'Policy 没有可用的 CONTEXT_SOURCES Provider')
  if (providers.some(binding => binding.source.requiresResourceKeyAllowList) && input.allowedResourceKeys == null) {
    fail('resource-allow-list', '角色运行来源必须提供内核计算的明确资源 allow-list')
  }
  const readSessionGuards: Array<() => Promise<void>> = []
  if (input.freezeProviderReads) providers = await Promise.all(providers.map(async binding => {
    const snapshot = await binding.provider.openReadSession?.(input.scope)
    if (!snapshot) return binding
    const provider = snapshot.provider
    if (provider.version !== binding.provider.version || provider.providerId !== binding.provider.providerId || provider.providerVersion !== binding.provider.providerVersion
      || provider.normalizationVersion !== binding.provider.normalizationVersion
      || provider.kinds.join(',') !== binding.provider.kinds.join(',')) fail('provider', '只读会话不能替换登记来源或扩大种类权限')
    readSessionGuards.push(() => snapshot.assertCurrent())
    return { ...binding, provider }
  }))
  const fingerprints = await Promise.all(providers.map(binding => binding.provider.fingerprint(input.scope)))
  if (new Set(fingerprints).size !== 1) fail('scope', 'Provider 对冻结 scope 的 fingerprint 不一致')
  const allowedResourceKeys = input.allowedResourceKeys == null
    ? null
    : new Set(input.allowedResourceKeys)
  if (allowedResourceKeys && (allowedResourceKeys.size !== input.allowedResourceKeys!.length
    || [...allowedResourceKeys].some(key => !key.trim()))) {
    fail('resource-allow-list', '资源 allow-list 含重复或空 key')
  }
  const excluded = new Set(input.excludedRecordResourceKeys ?? [])
  if (excluded.size !== (input.excludedRecordResourceKeys ?? []).length || [...excluded].some(key => !key.trim())) fail('resource-deny-list', '资源排除清单含重复或空 key')
  return {
    version: 'context-gateway-tool-session-v1',
    scope: Object.freeze({ ...input.scope }),
    scopeFingerprint: fingerprints[0],
    policy,
    policyHash: await hashCanonicalValue(policy),
    providers: Object.freeze(providers),
    resourceKeyAllowList: allowedResourceKeys,
    resourceKeyDenyList: excluded,
    usage: { readCalls: 0, retrievedTokens: 0 },
    capabilities: new Map(),
    readSessionGuards: Object.freeze(readSessionGuards),
    ...(input.worldQueryAccess ? { worldQueryAccess: input.worldQueryAccess } : {}),
  }
}

export function isContextGatewayResourceAllowedV1(
  session: ContextGatewayToolSessionV1,
  resourceKey: string,
): boolean {
  return ![...session.resourceKeyDenyList].some(key => resourceKey === key || resourceKey.startsWith(`${key}:`))
    && (session.resourceKeyAllowList == null || session.resourceKeyAllowList.has(resourceKey))
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

/** Applied only to a detached JSON snapshot, never to a provider-owned object. */
function freezeCapabilityEvidence<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeCapabilityEvidence(child)
    Object.freeze(value)
  }
  return value
}

export function issueContextSourceRefCapabilitiesV1(
  session: ContextGatewayToolSessionV1,
  descriptor: ContextResourceDescriptorV1,
): string[] {
  if (descriptor.sourceRefs.length > MAX_SOURCE_CAPABILITIES_PER_RESOURCE) {
    fail('source-ref', `单个资源 SourceRef 超过 ${MAX_SOURCE_CAPABILITIES_PER_RESOURCE} 条上限`)
  }
  const binding = session.providers.find(candidate => candidate.source.key === descriptor.sourceKey)
  if (!binding) fail('source-ref', 'SourceRef capability 的 Provider 不在当前 session')
  // Preserve the provider's JSON field order (including original-evidence
  // anchors); canonicalization is for hashing/comparison, not evidence rewriting.
  const snapshot: ContextResourceDescriptorV1 = freezeCapabilityEvidence(JSON.parse(JSON.stringify(descriptor)))
  const bindingCanonical = canonicalStringify({
    version: 'context-source-ref-capability-v1',
    scope: session.scope,
    scopeFingerprint: session.scopeFingerprint,
    policyHash: session.policyHash,
    provider: {
      sourceKey: binding.source.key,
      version: binding.provider.version,
      providerId: binding.provider.providerId,
      providerVersion: binding.provider.providerVersion,
      normalizationVersion: binding.provider.normalizationVersion,
    },
    descriptor: snapshot,
  })
  // Opaque and deterministic for exact replay. Presence in this session map,
  // rather than knowledge of a token's bytes, remains the source of authority.
  const planned = new Map<string, SourceRefCapabilityV1>()
  const tokens = snapshot.sourceRefs.map((sourceRef, index) => {
    const digest = sha256(new TextEncoder().encode(canonicalStringify({ bindingCanonical, index })))
    const token = `ctxref_v1_${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`
    const capability = Object.freeze({ resourceKey: snapshot.resourceKey, descriptor: snapshot, sourceRef,
      bindingCanonical, sourceRefIndex: index })
    const previous = planned.get(token) ?? session.capabilities.get(token)
    if (previous && canonicalStringify(previous) !== canonicalStringify(capability)) {
      fail('source-ref', 'SourceRef capability token 与既有来源证据冲突')
    }
    planned.set(token, capability)
    return token
  })
  const newTokenCount = [...planned.keys()].filter(token => !session.capabilities.has(token)).length
  if (session.capabilities.size + newTokenCount
    > session.policy.maxReadCalls * MAX_SOURCE_CAPABILITIES_PER_RESOURCE) {
    fail('source-ref', '当前 Gateway session 的 SourceRef capability 已达到上限')
  }
  // All collisions and the complete batch budget are checked before mutation;
  // an exact reissue preserves the original immutable evidence object.
  for (const [token, capability] of planned) {
    if (!session.capabilities.has(token)) session.capabilities.set(token, capability)
  }
  return tokens
}

export function resolveContextSourceRefCapabilityV1(
  session: ContextGatewayToolSessionV1,
  token: string,
): SourceRefCapabilityV1 {
  const capability = session.capabilities.get(token)
  if (!capability) fail('source-ref', 'SourceRef capability 未由当前 Gateway session 签发或已经失效')
  return capability
}
