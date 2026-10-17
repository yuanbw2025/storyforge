import { canonicalStringify } from '../agent/run/hash'
/** Shared full-JSON runtime resource transport. Owning loaders enforce instance and observer authority. */
import type { ContextResourceProviderV1, ContextResourceDescriptorV1, FrozenResourceScopeV1, ResourceListInputV1, ContextResourceKind } from '../registry/types'
import { hashCanonicalValue } from '../agent/run/hash'
export interface TtrpgOpenResourceRowV1 { descriptor: ContextResourceDescriptorV1; content: string; tokenCount: number; /** Authorized search corpus, never raw unfiltered state. */ searchText?: string }
export interface TtrpgOpenResourceCatalogV1 { fingerprint: string; resources: TtrpgOpenResourceRowV1[]; legacyResources?: TtrpgOpenResourceRowV1[]; /** Actual owner CAS for pinned reads; never reconstructed from imported JSON. */ assertCurrent?: () => Promise<void> }
export function createTtrpgOpenRuntimeResourceProviderV1(input: {
  sourceKey: string; providerVersion: string; normalizationVersion: string; kinds: ContextResourceKind[]
  catalog: (scope: FrozenResourceScopeV1) => Promise<TtrpgOpenResourceCatalogV1>
  /** Some private consumers also recheck live authority before returning pinned metadata or bytes. */
  assertAccess?: (scope: FrozenResourceScopeV1, pinnedFingerprint: string) => Promise<void>
}): ContextResourceProviderV1 {
  const catalog = input.catalog
  const page = async (request: ResourceListInputV1, query?: string) => {
    const data = await catalog(request.scope)
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1000) throw new Error('[ttrpg-open-provider] 目录页上限非法')
    const requestHash = await hashCanonicalValue({ sourceKey: input.sourceKey, query: query ?? null, kinds: request.kinds ?? null })
    let offset = 0
    if (request.cursor !== undefined) {
      const [hash, match, rawOffset] = request.cursor.split('/')
      if (hash !== data.fingerprint || match !== requestHash || !/^(0|[1-9]\d*)$/.test(rawOffset ?? '')) throw new Error('[ttrpg-open-provider] cursor 已 stale 或不属于此角色/查询')
      offset = Number(rawOffset)
    }
    const rows = data.resources.filter(row => (!request.kinds || request.kinds.includes(row.descriptor.kind))
      && (!query || `${row.descriptor.title} ${row.descriptor.shortSummary} ${row.searchText ?? ''}`.includes(query)))
    if (offset > rows.length) throw new Error('[ttrpg-open-provider] cursor 超过目录范围')
    const items = rows.slice(offset, offset + request.limit).map(row => structuredClone(row.descriptor))
    return { version: 1 as const, items, nextCursor: offset + items.length < rows.length ? `${data.fingerprint}/${requestHash}/${offset + items.length}` : null, scopeFingerprint: data.fingerprint }
  }
  return { version: 'context-resource-provider-v1', providerId: `storyforge.${input.sourceKey}`, providerVersion: input.providerVersion,
    normalizationVersion: input.normalizationVersion, kinds: input.kinds, listMetadata: request => page(request), searchMetadata: request => page(request, request.query),
    read: async request => {
      if (request.depth !== 'full') throw new Error('[ttrpg-open-provider] 角色契约与知识 JSON 必须完整读取')
      const data = await catalog(request.scope)
      const row = [...data.resources, ...(data.legacyResources ?? [])].find(row => row.descriptor.resourceKey === request.resourceKey)
      if (!row) throw new Error('[ttrpg-open-provider] 资源不属于当前角色授权视图')
      if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < row.tokenCount) throw new Error('[ttrpg-open-provider] 完整资源超过预算；禁止截断 JSON')
      return { version: 1, descriptor: structuredClone(row.descriptor), depth: 'full', content: row.content,
        contentHash: row.descriptor.contentHash, tokenCount: row.tokenCount, sourceRefs: structuredClone(row.descriptor.sourceRefs) }
    },
    readOriginal: async () => { throw new Error('[ttrpg-open-provider] 禁止角色读取原始 runtime head 或其他角色资料') },
    fingerprint: async scope => (await catalog(scope)).fingerprint,
    openReadSession: async scope => {
      const frozenScope = canonicalStringify(scope), data = await catalog(scope)
      const evidence = (value: TtrpgOpenResourceCatalogV1) => canonicalStringify({ fingerprint: value.fingerprint, resources: value.resources.map(row => row.descriptor) })
      const original = evidence(data)
      const provider = createTtrpgOpenRuntimeResourceProviderV1({ ...input, catalog: async actual => {
        if (canonicalStringify(actual) !== frozenScope) throw new Error('[ttrpg-open-provider] 只读会话不能更换作用域或角色')
        await data.assertCurrent?.()
        await input.assertAccess?.(actual, data.fingerprint)
        return data
      } })
      delete provider.openReadSession
      return { provider, assertCurrent: async () => {
        if (evidence(await catalog(scope)) !== original) throw new Error('[ttrpg-open-provider] 读取期间角色权限或情境状态已变化')
      } }
    } }
}
