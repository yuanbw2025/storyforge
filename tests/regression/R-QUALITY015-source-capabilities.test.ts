import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import {
  createContextGatewayToolSessionV1, issueContextSourceRefCapabilitiesV1,
  resolveContextSourceRefCapabilityV1, MAX_SOURCE_CAPABILITIES_PER_RESOURCE,
  type ContextGatewayToolSessionV1,
} from '../../src/lib/context-gateway/tool-session'
import { executeAgentTool } from '../../src/lib/agent/tool-registry'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import type { ContextAccessPolicyV1, ContextResourceDescriptorV1 } from '../../src/lib/registry/types'
import type { Character } from '../../src/lib/types/character'

const TEXT = 'Both wear a blue coat.'
const NOW = 1_787_600_000_000

function policy(overrides: Partial<ContextAccessPolicyV1> = {}): ContextAccessPolicyV1 {
  return {
    version: 'context-access-policy-v1', policyId: 'quality015-source-capabilities-v1',
    mandatorySourceKeys: [], allowedSourceKeys: ['ragSelection'], allowedResourceKinds: ['character'],
    allowedDepths: ['full', 'original'], selectorPolicyId: 'quality015-selector-v1',
    maxReadCalls: 32, maxRetrievedTokens: 100_000, allowOriginalRead: true, candidateAccess: 'forbidden',
    ...overrides,
  }
}

async function fixture() {
  const { scope } = await seedCurrentWorkspace('015 synthetic source capability', { genres: ['other'] })
  const ids: number[] = []
  for (const name of ['synthetic character A', 'synthetic character B']) {
    const character: Character = {
      projectId: scope.projectId,
      name, homeWorldGroupId: null, isCrossWorld: false, roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      appearance: TEXT, background: TEXT, shortDescription: name, personality: '', motivation: '',
      abilities: '', relationships: '', arc: '', createdAt: NOW, updatedAt: NOW,
    }
    ids.push(await db.characters.add(stampNewRecord(scope, 'characters', character, { owner: 'world' })))
  }
  const frozenScope = { ...scope, worldGroupId: null }
  const descriptors: ContextResourceDescriptorV1[] = []
  let cursor: string | undefined
  do {
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: frozenScope, limit: 100, cursor })
    descriptors.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  const field = (id: number, name: string) => {
    const found = descriptors.find(item => item.resourceKey.endsWith(`:field:${name}`)
      && item.sourceRefs.some(ref => ref.table === 'characters' && ref.recordId === id))
    if (!found) throw new Error(`Missing current registered character field ${name}`)
    return found
  }
  const fields = [field(ids[0], 'appearance'), field(ids[1], 'appearance'), field(ids[0], 'background')]
  const session = await createContextGatewayToolSessionV1({ scope: frozenScope, policy: policy() })
  const context = (target = session) => ({ projectId: scope.projectId, scope, worldGroupId: null, contextGatewaySession: target })
  const read = (resourceKey: string, target = session) => executeAgentTool('read_context_resource', context(target), {
    resourceKey, depth: 'full', maxTokens: 1000,
  })
  return { scope, ids, fields, frozenScope, session, context, read }
}

function mapBytes(session: ContextGatewayToolSessionV1) {
  return canonicalStringify([...session.capabilities.entries()])
}

function withReferences(descriptor: ContextResourceDescriptorV1, count: number) {
  const copy = structuredClone(descriptor)
  copy.sourceRefs = Array.from({ length: count }, (_, i) => ({ ...copy.sourceRefs[0], recordId: i + 10_000 }))
  return copy
}

describe('SFQA-015 · source capabilities preserve immutable source identity', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('015 tests must not use a real network/provider') }))
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

  it('keeps the original AUD-CTX-CAP-01 source after equal-content records and fields are read', async () => {
    const f = await fixture()
    expect(new Set(f.fields.map(item => item.resourceKey)).size).toBe(3)
    expect(new Set(f.fields.map(item => item.contentHash)).size).toBe(1)
    // Canon's field policy is allowed to differ between appearance/background;
    // the two different records' appearance fields share both hashes.
    expect(f.fields[0].policyHash).toBe(f.fields[1].policyHash)
    const tokens: string[] = []
    for (const descriptor of f.fields) {
      const read = await f.read(descriptor.resourceKey)
      expect(read.ok, read.error).toBe(true)
      const token = JSON.parse(read.content).sourceRefCapabilities[0] as string
      tokens.push(token)
      expect(resolveContextSourceRefCapabilityV1(f.session, token).resourceKey).toBe(descriptor.resourceKey)
    }
    expect(new Set(tokens).size).toBe(3)
    for (const [index, token] of tokens.entries()) {
      const resolved = resolveContextSourceRefCapabilityV1(f.session, token)
      expect(resolved.sourceRef).toEqual(f.fields[index].sourceRefs[0])
      const original = await executeAgentTool('read_original_evidence', f.context(), { sourceRef: token, maxTokens: 1000 })
      expect(original.ok, original.error).toBe(true)
      expect(JSON.parse(original.content)).toMatchObject({ resourceKey: f.fields[index].resourceKey, content: TEXT })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reissues the exact descriptor synchronously without replacing existing immutable entries', async () => {
    const f = await fixture()
    const tokens = issueContextSourceRefCapabilitiesV1(f.session, f.fields[0])
    const first = resolveContextSourceRefCapabilityV1(f.session, tokens[0])
    const before = mapBytes(f.session)
    expect(tokens[0]).toMatch(/^ctxref_v1_[a-f0-9]{64}$/)
    expect(tokens[0]).not.toContain(f.fields[0].resourceKey)
    expect(issueContextSourceRefCapabilitiesV1(f.session, structuredClone(f.fields[0]))).toEqual(tokens)
    expect(resolveContextSourceRefCapabilityV1(f.session, tokens[0])).toBe(first)
    expect(mapBytes(f.session)).toBe(before)
  })

  it('snapshots nested descriptor/source-ref evidence against caller and resolver alias mutation', async () => {
    const f = await fixture()
    const descriptor = structuredClone(f.fields[0])
    descriptor.sourceRefs[0].anchor = { start: 0, end: 4, quoteHash: 'a'.repeat(64) }
    const [token] = issueContextSourceRefCapabilitiesV1(f.session, descriptor)
    const original = canonicalStringify(resolveContextSourceRefCapabilityV1(f.session, token))
    descriptor.resourceKey = f.fields[1].resourceKey
    descriptor.sourceRefs[0].recordId = f.ids[1]
    descriptor.sourceRefs[0].anchor.start = 1
    descriptor.scope.worldId = descriptor.scope.worldId! + 1
    const held = resolveContextSourceRefCapabilityV1(f.session, token)
    expect(canonicalStringify(held)).toBe(original)
    expect(Object.isFrozen(held)).toBe(true)
    expect(Object.isFrozen(held.descriptor)).toBe(true)
    expect(Object.isFrozen(held.descriptor.scope)).toBe(true)
    expect(Object.isFrozen(held.descriptor.sourceRefs)).toBe(true)
    expect(Object.isFrozen(held.sourceRef.anchor)).toBe(true)
    try { held.sourceRef.recordId = f.ids[1] } catch { /* Strict-mode freeze may throw. */ }
    expect(canonicalStringify(resolveContextSourceRefCapabilityV1(f.session, token))).toBe(original)
  })

  it.each(['revision', 'anchor', 'descriptor-revision'] as const)('binds %s even when content/policy hashes are unchanged', async variant => {
    const f = await fixture()
    const descriptor = structuredClone(f.fields[0])
    const [first] = issueContextSourceRefCapabilitiesV1(f.session, descriptor)
    const old = canonicalStringify(resolveContextSourceRefCapabilityV1(f.session, first))
    if (variant === 'revision') descriptor.sourceRefs[0].revision = NOW + 1
    if (variant === 'anchor') descriptor.sourceRefs[0].anchor = { start: 0, end: 4, quoteHash: 'b'.repeat(64) }
    if (variant === 'descriptor-revision') descriptor.contentRevision = NOW + 1
    const [second] = issueContextSourceRefCapabilitiesV1(f.session, descriptor)
    expect(second).not.toBe(first)
    expect(canonicalStringify(resolveContextSourceRefCapabilityV1(f.session, first))).toBe(old)
  })

  it.each(['scope', 'scope-fingerprint', 'session-policy', 'provider-version', 'normalization-version'] as const)(
    'binds host-issued %s identity without making tokens portable authority', async variant => {
      const f = await fixture()
      const [first] = issueContextSourceRefCapabilitiesV1(f.session, f.fields[0])
      const changed: ContextGatewayToolSessionV1 = { ...f.session, capabilities: new Map(),
        ...(variant === 'scope' ? { scope: { ...f.session.scope, worldId: f.scope.worldId + 1 } } : {}),
        ...(variant === 'scope-fingerprint' ? { scopeFingerprint: 'c'.repeat(64) } : {}),
        ...(variant === 'session-policy' ? { policyHash: 'd'.repeat(64) } : {}),
        providers: f.session.providers.map(binding => ({ ...binding, provider: { ...binding.provider,
          ...(variant === 'provider-version' ? { providerVersion: `${binding.provider.providerVersion}-next` } : {}),
          ...(variant === 'normalization-version' ? { normalizationVersion: `${binding.provider.normalizationVersion}-next` } : {}),
        } })),
      }
      expect(() => resolveContextSourceRefCapabilityV1(changed, first)).toThrow('当前 Gateway session')
      const [second] = issueContextSourceRefCapabilitiesV1(changed, f.fields[0])
      expect(second).not.toBe(first)
      expect(resolveContextSourceRefCapabilityV1(f.session, first).resourceKey).toBe(f.fields[0].resourceKey)
    },
  )

  it('rejects an incompatible existing token before adding any earlier member of the batch', async () => {
    const f = await fixture()
    const descriptor = withReferences(f.fields[0], 2)
    const probe: ContextGatewayToolSessionV1 = { ...f.session, capabilities: new Map() }
    const tokens = issueContextSourceRefCapabilitiesV1(probe, descriptor)
    f.session.capabilities.set(tokens[1], { ...resolveContextSourceRefCapabilityV1(probe, tokens[1]), resourceKey: 'incompatible-existing-resource' })
    const before = mapBytes(f.session)
    expect(() => issueContextSourceRefCapabilitiesV1(f.session, descriptor)).toThrow()
    expect(mapBytes(f.session)).toBe(before)
    expect(f.session.capabilities.has(tokens[0])).toBe(false)
  })

  it('keeps the per-resource and per-session ceilings atomic while permitting exact replay', async () => {
    const f = await fixture()
    const session = await createContextGatewayToolSessionV1({ scope: f.frozenScope, policy: policy({ maxReadCalls: 1 }) })
    const full = withReferences(f.fields[0], MAX_SOURCE_CAPABILITIES_PER_RESOURCE)
    const tokens = issueContextSourceRefCapabilitiesV1(session, full)
    expect(tokens).toHaveLength(MAX_SOURCE_CAPABILITIES_PER_RESOURCE)
    expect(new Set(tokens).size).toBe(tokens.length)
    const before = mapBytes(session)
    expect(() => issueContextSourceRefCapabilitiesV1(session, f.fields[1])).toThrow('上限')
    expect(mapBytes(session)).toBe(before)
    expect(() => issueContextSourceRefCapabilitiesV1(session, withReferences(full, MAX_SOURCE_CAPABILITIES_PER_RESOURCE + 1))).toThrow('上限')
    expect(mapBytes(session)).toBe(before)
    expect(issueContextSourceRefCapabilitiesV1(session, full)).toEqual(tokens)
    expect(session.usage).toEqual({ readCalls: 0, retrievedTokens: 0 })
  })

  it.each(['repeat', 'other-resource'] as const)('failed %s read only withdraws newly issued tokens', async scenario => {
    const f = await fixture()
    let exhaustAfterRead = false
    const session: ContextGatewayToolSessionV1 = { ...f.session, providers: f.session.providers.map(binding => ({ ...binding,
      provider: { ...binding.provider, read: async input => {
        const result = await binding.provider.read(input)
        // A deterministic late budget exhaustion models a result failure after
        // the initial request guard. The underlying registered read stays real.
        if (exhaustAfterRead) f.session.usage.retrievedTokens = f.session.policy.maxRetrievedTokens - 1
        return result
      } },
    })) }
    const first = await f.read(f.fields[0].resourceKey, session)
    expect(first.ok, first.error).toBe(true)
    const token = JSON.parse(first.content).sourceRefCapabilities[0] as string
    const before = mapBytes(session)
    exhaustAfterRead = true
    const failed = await f.read(f.fields[scenario === 'repeat' ? 0 : 1].resourceKey, session)
    expect(failed.ok).toBe(false)
    expect(failed.error).toContain('总额度')
    expect(mapBytes(session)).toBe(before)
    expect(resolveContextSourceRefCapabilityV1(session, token).resourceKey).toBe(f.fields[0].resourceKey)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps cross-session, original permission, stale-source and call/token limits enforced', async () => {
    const f = await fixture()
    const read = await f.read(f.fields[0].resourceKey)
    expect(read.ok, read.error).toBe(true)
    const token = JSON.parse(read.content).sourceRefCapabilities[0] as string
    const other = await createContextGatewayToolSessionV1({ scope: f.frozenScope, policy: policy() })
    const cross = await executeAgentTool('read_original_evidence', f.context(other), { sourceRef: token, maxTokens: 1000 })
    expect(cross.ok).toBe(false)
    expect(cross.error).toContain('当前 Gateway session')
    const denied = await createContextGatewayToolSessionV1({ scope: f.frozenScope, policy: policy({ allowOriginalRead: false, allowedDepths: ['full'] }) })
    const deniedRead = await f.read(f.fields[0].resourceKey, denied)
    expect(deniedRead.ok, deniedRead.error).toBe(true)
    const deniedToken = JSON.parse(deniedRead.content).sourceRefCapabilities[0]
    expect((await executeAgentTool('read_original_evidence', f.context(denied), { sourceRef: deniedToken, maxTokens: 1000 })).ok).toBe(false)
    const before = canonicalStringify(resolveContextSourceRefCapabilityV1(f.session, token))
    await db.characters.update(f.ids[0], { appearance: 'The original changed.', updatedAt: NOW + 1 })
    const stale = await executeAgentTool('read_original_evidence', f.context(), { sourceRef: token, maxTokens: 1000 })
    expect(stale.ok).toBe(false)
    expect(stale.error).toContain('当前版本')
    expect(canonicalStringify(resolveContextSourceRefCapabilityV1(f.session, token))).toBe(before)
    const limited = await createContextGatewayToolSessionV1({ scope: f.frozenScope, policy: policy({ maxReadCalls: 1, maxRetrievedTokens: 100 }) })
    expect((await executeAgentTool('read_context_resource', f.context(limited), { resourceKey: f.fields[1].resourceKey, depth: 'full', maxTokens: 101 })).ok).toBe(false)
    expect(limited.capabilities.size).toBe(0)
    expect(limited.usage).toEqual({ readCalls: 1, retrievedTokens: 0 })
    expect((await f.read(f.fields[1].resourceKey, limited)).ok).toBe(false)
  })
})
