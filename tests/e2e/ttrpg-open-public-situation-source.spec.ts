import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })

test('native public source reads complete common JSON, survives reload, hides private metadata and never reserves or sends a call', async ({ page }) => {
  test.setTimeout(120000)
  const sends: string[] = []
  page.on('request', request => { if (/\/v1\/(?:chat\/completions|responses)/.test(request.url())) sends.push(request.url()) })
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const { CONTEXT_SOURCE_BY_KEY } = await importer('/storyforge/src/lib/registry/context-sources.ts')
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native common situation source', (p: any) => {
      const c = p.ttrpg.campaign; c.runtimePolicy.enabled = true
      c.fronts[0].goal = 'NATIVE-PRIVATE-FRONT'
      c.situationTemplates[0].driverGoal = 'NATIVE-PRIVATE-TEMPLATE'
      c.characterTemplates[0].playerProfile.secret = 'NATIVE-PRIVATE-PLAYER'
      c.clocks[0].onComplete = 'NATIVE-PRIVATE-CLOCK'
    })
    const scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' }
    const before = await readProductRuntimeState(f.sessionId), provider = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenPublicSituationInput').resources
    const session = await provider.openReadSession(scope), catalog = await session.provider.listMetadata({ scope, limit: 1000 })
    const bodies = await Promise.all(catalog.items.map((row: any) => session.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })))
    const search = await session.provider.searchMetadata({ scope, query: 'NATIVE-PRIVATE', limit: 1000 })
    await session.assertCurrent()
    return { scope, catalog, bodies, search, noStateWrite: JSON.stringify(before) === JSON.stringify(await readProductRuntimeState(f.sessionId)), runs: await db.agentRuns.count() }
  })
  expect(result.runs).toBe(0); expect(result.noStateWrite).toBe(true); expect(result.search.items).toEqual([])
  expect(JSON.stringify({ catalog: result.catalog, bodies: result.bodies })).not.toContain('NATIVE-PRIVATE')
  expect(result.catalog.items.filter((row: any) => row.priority === 'must-read').map((row: any) => row.resourceKey.split(':').at(-1)).sort()).toEqual([
    'public-situation-contract', 'public-situation-frame', 'public-situation-identities', 'public-situation-predicates', 'public-situation-rules',
  ])
  for (const body of result.bodies) expect(() => JSON.parse(body.content)).not.toThrow()
  await page.reload()
  const restored = await page.evaluate(async scope => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const { CONTEXT_SOURCE_BY_KEY } = await importer('/storyforge/src/lib/registry/context-sources.ts')
    const session = await CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenPublicSituationInput').resources.openReadSession(scope)
    const catalog = await session.provider.listMetadata({ scope, limit: 1000 })
    const bodies = await Promise.all(catalog.items.map((row: any) => session.provider.read({ scope, resourceKey: row.resourceKey, depth: 'full', maxTokens: 16000 })))
    await session.assertCurrent(); return { catalog, bodies }
  }, result.scope)
  expect(restored.catalog).toEqual(result.catalog); expect(restored.bodies).toEqual(result.bodies); expect(sends).toEqual([])
})

test('native common predicate allowlist rejects hidden-owner probes and a pinned provider loses access after real pause', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const context = await importer('/storyforge/src/lib/ttrpg/open-public-situation-context.ts')
    const predicates = await importer('/storyforge/src/lib/ttrpg/open-public-situation-predicates.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native common authority', (p: any) => { p.ttrpg.campaign.runtimePolicy.enabled = true })
    const read = await context.loadTtrpgOpenPublicSituationContextV1({ scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' })
    const errors: string[] = []
    for (const actorKey of ['keeper', 'invented.private.actor']) {
      try { predicates.assertTtrpgOpenPublicPredicateV1({ op: 'actor-at', actorKey, locationRef: 'harbor' }, read.predicateScope) }
      catch (error) { errors.push((error as Error).message) }
    }
    const scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' }
    const session = await context.createTtrpgOpenPublicSituationContextProviderV1().openReadSession(scope)
    await api.postTtrpgOpenTableMessageV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.public.discussion'), viewerKey: helper.OPEN_HUMAN_VIEWER,
      submissionKey: 'native.public.discussion', request: { kind: 'out-of-character', audience: 'party', text: '稍等一下' } })
    let advancedDenied = false
    try { await session.provider.listMetadata({ scope, limit: 1000 }) } catch { advancedDenied = true }
    const fresh = await context.createTtrpgOpenPublicSituationContextProviderV1().openReadSession(scope)
    await api.changeTtrpgSafetyStatus({ ...await helper.openEnvelopeV1(f.sessionId, 'native.public.pause'), viewerKey: helper.OPEN_HUMAN_VIEWER,
      changedBy: 'hero', status: 'paused', reason: '暂停测试' })
    let denied = false
    try { await fresh.provider.listMetadata({ scope, limit: 1000 }) } catch { denied = true }
    return { errors, denied, advancedDenied }
  })
  expect(result.errors).toHaveLength(2); expect(result.errors[0]).toEqual(result.errors[1]); expect(result.errors[0]).not.toContain('keeper')
  expect(result.denied && result.advancedDenied).toBe(true)
})
