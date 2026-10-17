import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'
import { TTRPG_OPEN_AUTHORITY_PROVIDER_V1, TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1 } from '../../src/lib/ttrpg/open-context-provider'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { assertContextResourceDescriptorV1 } from '../../src/lib/context-gateway/contracts'
import type { ContextAccessPolicyV1, FrozenResourceScopeV1 } from '../../src/lib/registry/types'
const policy: ContextAccessPolicyV1 = { version: 'context-access-policy-v1', policyId: 'open-actor-test',
  mandatorySourceKeys: ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge'], allowedSourceKeys: ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge'],
  allowedResourceKinds: ['fact'], allowedDepths: ['full'], selectorPolicyId: 'deterministic-v1', maxReadCalls: 10,
  maxRetrievedTokens: 10_000, allowOriginalRead: false, candidateAccess: 'forbidden' }
describe('R-TTRPGOPEN1 scoped progressive context providers', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function setup() {
    const fixture = await readyOpenTtrpgSessionV1('provider role isolation', pkg => {
      pkg.ttrpg!.campaign.characterTemplates.find(actor => actor.characterKey === 'hero')!.playerProfile!.secret = 'HERO-PRIVATE-MARKER'
      pkg.ttrpg!.campaign.characterTemplates.find(actor => actor.characterKey === 'companion.1')!.playerProfile!.secret = 'COMPANION-PRIVATE-MARKER'
    })
    const scope: FrozenResourceScopeV1 = { projectId: fixture.scope.projectId, worldId: fixture.scope.worldId!, workId: fixture.scope.workId!,
      productRuntimeSessionId: fixture.sessionId, runtimeActorKey: 'companion.1' }
    return { fixture, scope }
  }
  it('requires the kernel allow-list before opening role providers', async () => {
    const { scope } = await setup()
    await expect(createContextGatewayToolSessionV1({ scope, policy })).rejects.toThrow(/allow-list/)
    const authority = await TTRPG_OPEN_AUTHORITY_PROVIDER_V1.listMetadata({ scope, limit: 10 })
    const knowledge = await TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1.listMetadata({ scope, limit: 10 })
    expect(authority.scopeFingerprint).toBe(knowledge.scopeFingerprint)
    const allowedResourceKeys = [...authority.items, ...knowledge.items].map(item => item.resourceKey)
    expect((await createContextGatewayToolSessionV1({ scope, policy, allowedResourceKeys })).resourceKeyAllowList!.size).toBe(allowedResourceKeys.length)
  })
  it('returns complete actor JSON, enforces budget and blocks other actor and original head reads', async () => {
    const { scope } = await setup()
    const page = await TTRPG_OPEN_AUTHORITY_PROVIDER_V1.listMetadata({ scope, limit: 10 })
    const descriptor = page.items[0]
    assertContextResourceDescriptorV1({ descriptor, source: CONTEXT_SOURCES.find(source => source.key === 'ttrpgOpenAuthority')! })
    descriptor.title = 'caller mutation'
    expect((await TTRPG_OPEN_AUTHORITY_PROVIDER_V1.listMetadata({ scope, limit: 10 })).items[0].title).not.toBe('caller mutation')
    const result = await TTRPG_OPEN_AUTHORITY_PROVIDER_V1.read({ scope, resourceKey: descriptor.resourceKey, depth: 'full', maxTokens: 10_000 })
    expect(JSON.parse(result.content).self.playerProfile.secret).toBe('COMPANION-PRIVATE-MARKER')
    expect(result.content).not.toContain('HERO-PRIVATE-MARKER')
    await expect(TTRPG_OPEN_AUTHORITY_PROVIDER_V1.read({ scope, resourceKey: descriptor.resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/预算/)
    await expect(TTRPG_OPEN_AUTHORITY_PROVIDER_V1.read({ scope, resourceKey: descriptor.resourceKey.replace(':companion.1:', ':hero:'), depth: 'full', maxTokens: 10_000 })).rejects.toThrow(/当前角色/)
    await expect(TTRPG_OPEN_AUTHORITY_PROVIDER_V1.readOriginal({ scope, resourceKey: descriptor.resourceKey, sourceRef: descriptor.sourceRefs[0], maxTokens: 10_000 })).rejects.toThrow(/原始/)
  })
  it('paginates observed knowledge separately from the mandatory knowledge contract and rejects another POV cursor', async () => {
    const { scope } = await setup()
    const first = await TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1.listMetadata({ scope, limit: 1 })
    expect(first.items[0].resourceKey).toContain('knowledge-contract')
    expect(first.nextCursor).not.toBeNull()
    const next = await TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1.listMetadata({ scope, limit: 1, cursor: first.nextCursor! })
    expect(next.items).toHaveLength(1)
    await expect(TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1.searchMetadata({ scope, limit: 1, cursor: first.nextCursor!, query: '港口' })).rejects.toThrow(/cursor/)
    await expect(TTRPG_OPEN_KNOWLEDGE_PROVIDER_V1.listMetadata({ scope: { ...scope, runtimeActorKey: 'hero' }, limit: 1, cursor: first.nextCursor! })).rejects.toThrow(/cursor/)
    await expect(TTRPG_OPEN_AUTHORITY_PROVIDER_V1.listMetadata({ scope: { ...scope, runtimeActorKey: undefined }, limit: 10 })).rejects.toThrow(/POV/)
  })
  it('exposes only granted rules and actor-visible generic checks through individual resources', async () => {
    const fixture = await readyOpenTtrpgSessionV1('rule catalog visibility', pkg => {
      const check = pkg.ttrpg!.rulePack.content.genericChecks[0]
      check.title = 'GM-SECRET-RULE'; check.audience = 'gm'
    })
    const scope: FrozenResourceScopeV1 = { projectId: fixture.scope.projectId, worldId: fixture.scope.worldId, workId: fixture.scope.workId,
      productRuntimeSessionId: fixture.sessionId, runtimeActorKey: 'hero' }
    const page = await TTRPG_OPEN_AUTHORITY_PROVIDER_V1.listMetadata({ scope, limit: 1000 })
    expect(page.items.some(item => item.resourceKey.endsWith(':rules-core') && item.priority === 'must-read')).toBe(true)
    expect(page.items.some(item => item.resourceKey.includes(':action.'))).toBe(true)
    const bodies = []
    for (const descriptor of page.items) bodies.push((await TTRPG_OPEN_AUTHORITY_PROVIDER_V1.read({ scope, resourceKey: descriptor.resourceKey, depth: 'full', maxTokens: 10_000 })).content)
    expect(bodies.join('\n')).not.toContain('GM-SECRET-RULE')
    expect(bodies.join('\n')).not.toContain('effectPlanByDegree')
    expect(page.items.some(item => item.resourceKey.endsWith(`:check.${fixture.runtimePackage.ttrpg!.rulePack.content.genericChecks[0].checkKey}`))).toBe(false)
  })
})
