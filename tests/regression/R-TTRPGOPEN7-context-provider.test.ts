import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { readyOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'
import { openContextPolicyFixtureV1 } from '../helpers/open-ttrpg-context'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import type { FrozenResourceScopeV1 } from '../../src/lib/registry/types'
import type { ProductRuntimePackageWithTtrpgV2 } from '../../src/lib/ttrpg/content-version'

function configure(pkg: ProductRuntimePackageWithTtrpgV2) {
  pkg.ttrpg!.campaign.runtimePolicy.enabled = true
  const policy = openContextPolicyFixtureV1(), base = policy.triggers[0].trigger
  policy.triggers = [
    { consumers: ['actor', 'party-narrator'], trigger: { ...base, triggerKey: 'public', sourceRefs: [], injectText: 'PUBLIC-GUIDANCE' } },
    { consumers: ['actor', 'party-narrator'], trigger: { ...base, triggerKey: 'private', sourceRefs: [], audience: 'private', knownByActorKeys: ['hero'], injectText: 'HERO-SECRET' } },
    { consumers: ['gm-assistant'], trigger: { ...base, triggerKey: 'gm-secret', sourceRefs: [], audience: 'gm-only', injectText: 'GM-SECRET' } },
  ]
  pkg.ttrpg!.campaign.contextPolicy = policy
}
const provider = (key: string) => CONTEXT_SOURCE_BY_KEY.get(key)!.resources!
async function readAll(key: string, scope: FrozenResourceScopeV1) {
  const p = provider(key), catalog = await p.listMetadata({ scope, limit: 1000 })
  const reads = await Promise.all(catalog.items.map(item => p.read({ scope, resourceKey: item.resourceKey, depth: 'full', maxTokens: 16000 })))
  return { catalog, reads, text: reads.map(row => row.content).join('\n') }
}
describe('R-TTRPGOPEN7 audience-filtered registered guidance sources', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('filters private and GM guidance before metadata; complete JSON reads never grant knowledge or mutate runtime', async () => {
    const f = await readyOpenTtrpgSessionV1('guidance audience', configure), before = await readProductRuntimeState(f.sessionId)
    const scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'hero' }
    const hero = await readAll('ttrpgOpenActorContext', scope)
    const companion = await readAll('ttrpgOpenActorContext', { ...scope, runtimeActorKey: 'companion.1' })
    const gm = await readAll('ttrpgOpenGmContext', { ...scope, runtimeActorKey: 'gm' })
    expect(hero.text).toContain('HERO-SECRET'); expect(hero.text).not.toContain('GM-SECRET')
    expect(companion.text).toContain('PUBLIC-GUIDANCE'); expect(companion.text).not.toContain('HERO-SECRET')
    expect(gm.text).toContain('GM-SECRET'); expect(gm.text).not.toContain('HERO-SECRET')
    expect(JSON.stringify(companion.catalog)).not.toMatch(/private|HERO-SECRET|gm-secret|GM-SECRET/)
    const secret = hero.catalog.items.find(item => !companion.catalog.items.some(other => item.resourceKey.split(':').at(-1) === other.resourceKey.split(':').at(-1)))!
    await expect(provider('ttrpgOpenActorContext').read({ scope: { ...scope, runtimeActorKey: 'companion.1' }, resourceKey: secret.resourceKey, depth: 'full', maxTokens: 16000 })).rejects.toThrow(/授权视图/)
    for (const row of hero.reads) {
      expect(await sha256Text(row.content)).toBe(row.contentHash)
      expect(() => JSON.parse(row.content)).not.toThrow()
      expect(row.sourceRefs.some(ref => ref.table === 'productBuilds' && ref.field === 'previewManifestJson')).toBe(true)
    }
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
  it('public KP receives only triggers shared by every actual narration recipient', async () => {
    const f = await setupChecksFixtureV1({ ai: true }, configure)
    await resumeTtrpgOpenChecksV1(f.command)
    const result = await readAll('ttrpgOpenPartyContext', { ...f.f.scope, productRuntimeSessionId: f.command.sessionId, runtimeActorKey: 'gm' })
    expect(result.text).toContain('PUBLIC-GUIDANCE')
    expect(result.text).not.toMatch(/HERO-SECRET|GM-SECRET/)
    expect(JSON.stringify(result.catalog)).not.toMatch(/private|gm-secret/)
  }, 30000)
  it('rejects wrong consumers, disabled AI, partial JSON and insufficient budget', async () => {
    const f = await readyOpenTtrpgSessionV1('guidance failures', configure), scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'hero' }
    const p = provider('ttrpgOpenActorContext'), catalog = await p.listMetadata({ scope, limit: 10 })
    await expect(p.read({ scope, resourceKey: catalog.items[0].resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/禁止截断/)
    await expect(p.listMetadata({ scope: { ...scope, runtimeActorKey: 'gm' }, limit: 10 })).rejects.toThrow(/准确的角色/)
    await expect(provider('ttrpgOpenPartyContext').listMetadata({ scope, limit: 10 })).rejects.toThrow(/准确的角色/)
    const disabled = await readyOpenTtrpgSessionV1('disabled guidance')
    await expect(p.listMetadata({ scope: { ...disabled.scope, productRuntimeSessionId: disabled.sessionId, runtimeActorKey: 'hero' }, limit: 10 })).rejects.toThrow(/未允许/)
  })
})
