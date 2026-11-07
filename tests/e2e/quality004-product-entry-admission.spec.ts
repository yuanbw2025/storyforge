import { expect, test } from '@playwright/test'

/** Real browser origins and backup lifecycle; private context, no model transport.
 * Each product keeps its full four-owner lifecycle. Bootstrap is bounded at
 * 20s inside the existing 60s per-case ceiling; business assertions keep 5s.
 */
for (const targetKind of ['chat', 'avg', 'town', 'ttrpg'] as const) {
  test(`${targetKind} catalog boundaries preserve imported historical work across production reloads`, async ({ page, baseURL }) => {
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa004-isolated'))
    const localOrigin = new URL(baseURL!).origin
    let modelRequests = 0
    const staticBytes = new Map<string, { body: Buffer; headers: Record<string, string> }>()
    let staticCacheHits = 0
    let staticUpstreamFetches = 0
    await page.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (/\/chat\/completions|\/requests(?:\/|$)/.test(url.pathname)) {
        modelRequests += 1
        return route.abort()
      }
      if (url.hostname === 'sfqa004.example') {
        const staticPath = ['/storyforge/src/', '/storyforge/ui-preview/', '/storyforge/node_modules/',
          '/storyforge/@fs/', '/storyforge/@vite/', '/storyforge/@id/', '/storyforge/tests/helpers/']
          .some(prefix => url.pathname.startsWith(prefix))
          || ['/storyforge/@react-refresh', '/storyforge/package.json'].includes(url.pathname)
        const cacheable = request.method() === 'GET' && staticPath
          && ['script', 'stylesheet'].includes(request.resourceType())
        const key = JSON.stringify([url.href, request.resourceType(), request.headers()['accept'] ?? ''])
        const cached = cacheable ? staticBytes.get(key) : undefined
        if (cached) {
          staticCacheHits += 1
          return route.fulfill({ status: 200, ...cached })
        }
        const response = await route.fetch({ url: `${localOrigin}${url.pathname}${url.search}`,
          ...(cacheable ? { headers: { ...request.headers(), connection: 'close' } } : {}),
        })
        if (cacheable) staticUpstreamFetches += 1
        if (cacheable && response.status() === 200 && /javascript|ecmascript|text\/css/i.test(response.headers()['content-type'] ?? '')) {
          // Cache immutable source bytes, never exports, HTML or business data.
          // APIResponse.body() is decoded; omit encoding/transport/cookie headers.
          const omitted = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection',
            'keep-alive', 'set-cookie', 'proxy-connection', 'upgrade', 'trailer', 'te'])
          const bytes = { body: await response.body(), headers: Object.fromEntries(Object.entries(response.headers())
            .filter(([name]) => !omitted.has(name.toLowerCase()))) }
          staticBytes.set(key, bytes)
          return route.fulfill({ status: 200, ...bytes })
        }
        return route.fulfill({ response })
      }
      if (url.origin === localOrigin) return route.continue()
      return route.abort()
    })
    const nav = () => page.getByRole('navigation', { name: '产品导航', exact: true })
    await page.goto('./')
    await nav().waitFor({ state: 'visible', timeout: 20_000 })
    await expect(nav().getByRole('link', { name: '角色聊天', exact: true })).toBeVisible()
    await expect(nav().getByRole('link', { name: '社区', exact: true })).toHaveCount(0)
    const historical = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const drafts = await load('/storyforge/src/lib/character-interaction/draft-service.ts') as typeof import('../../src/lib/character-interaction/draft-service')
      const { exportProjectJSON } = await load('/storyforge/src/lib/export/json-export.ts') as typeof import('../../src/lib/export/json-export')
      const created = await drafts.createChatDraftV3('004 historical browser work')
      const avg = await load('/storyforge/src/lib/avg/draft-service.ts') as typeof import('../../src/lib/avg/draft-service')
      const town = await load('/storyforge/src/lib/ai-town/authoring-service.ts') as typeof import('../../src/lib/ai-town/authoring-service')
      const ttrpg = await load('/storyforge/src/lib/ttrpg/authoring-service.ts') as typeof import('../../src/lib/ttrpg/authoring-service')
      const companions = [
        ['avg', await avg.createAvgDraftV1('004 historical browser AVG')],
        ['town', await town.createAiTownDraft('004 historical browser town')],
        ['ttrpg', await ttrpg.createTtrpgDraft('004 historical browser campaign')],
      ] as const
      const others = []
      for (const [kind, owner] of companions) others.push({ kind, backup: JSON.stringify(await exportProjectJSON(owner.scope.projectId)) })
      return { backup: JSON.stringify(await exportProjectJSON(created.scope.projectId)), settingsJson: (await drafts.readChatDraftV1(created.scope)).settingsJson, others }
    })
    await page.evaluate(() => localStorage.setItem('storyforge:experimental-products', 'enabled'))
    await page.reload()
    await nav().waitFor({ state: 'visible', timeout: 20_000 })
    await expect(nav().getByRole('link', { name: '社区', exact: true })).toBeVisible()

    await page.goto('https://sfqa004.example/storyforge/')
    await nav().waitFor({ state: 'visible', timeout: 20_000 })
    const imported = await page.evaluate(async historical => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { importProjectJSON } = await load('/storyforge/src/lib/export/json-export.ts') as typeof import('../../src/lib/export/json-export')
      const { resolveWorkspaceOwnership } = await load('/storyforge/src/lib/workspace/ownership.ts') as typeof import('../../src/lib/workspace/ownership')
      const { readChatDraftV1 } = await load('/storyforge/src/lib/character-interaction/draft-service.ts') as typeof import('../../src/lib/character-interaction/draft-service')
      const scope = (await resolveWorkspaceOwnership(await importProjectJSON(JSON.parse(historical.backup)))).scope
      const others = []
      for (const item of historical.others) others.push({ kind: item.kind, scope: (await resolveWorkspaceOwnership(await importProjectJSON(JSON.parse(item.backup)))).scope })
      return { scope, settingsJson: (await readChatDraftV1(scope)).settingsJson, others }
    }, historical)
    expect(imported.settingsJson).toBe(historical.settingsJson)
    for (const optIn of [false, true]) {
      await page.evaluate(enabled => {
        if (enabled) localStorage.setItem('storyforge:experimental-products', 'enabled')
        else localStorage.removeItem('storyforge:experimental-products')
      }, optIn)
      await page.reload()
      await nav().waitFor({ state: 'visible', timeout: 20_000 })
      await expect(nav().getByRole('link')).toHaveText(['首页', '世界引擎', '长篇', '短篇', '剧本', '漫画', '漫剧素材'])
      const proof = await page.evaluate(async scope => {
        const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
        const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
        const drafts = await load('/storyforge/src/lib/character-interaction/draft-service.ts') as typeof import('../../src/lib/character-interaction/draft-service')
        const works = await load('/storyforge/src/lib/workspace/works.ts') as typeof import('../../src/lib/workspace/works')
        const { executeProductProductionCommand } = await load('/storyforge/src/lib/product-production/commands.ts') as typeof import('../../src/lib/product-production/commands')
        const catalog = await load('/storyforge/src/lib/product/product-catalog.ts') as typeof import('../../src/lib/product/product-catalog')
        const counts = async () => [await db.projects.count(), await db.worlds.count(), await db.works.count(), await db.productProductions.count()]
        const before = await counts(), errors: string[] = []
        for (const action of [
          () => drafts.createChatDraftV3('004 denied browser creation'),
          () => works.createWorldWork(scope.projectId, { title: '004 denied append', kind: 'character-interaction' }),
          () => executeProductProductionCommand({ scope, command: { type: 'create-intent', commandId: '004.denied.production',
            productionKey: '004.denied', productType: 'text-adventure', worldReleaseId: 1, userText: '004 hidden production' } }),
        ]) {
          try { await action(); errors.push('UNEXPECTED SUCCESS') }
          catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
        }
        return { channel: catalog.currentProductCatalogChannelV1(), before, after: await counts(), errors,
          settingsJson: (await drafts.readChatDraftV1(scope)).settingsJson }
      }, imported.scope)
      expect(proof.channel).toBe('production')
      expect(proof.after).toEqual(proof.before)
      expect(proof.errors).toHaveLength(3)
      expect(proof.errors.every(message => message.includes('product-catalog'))).toBe(true)
      expect(proof.settingsJson).toBe(historical.settingsJson)
      for (const item of [{ kind: 'chat', scope: imported.scope }, ...imported.others].filter(item => item.kind === targetKind)) {
        const title = { chat: '004 historical browser work', avg: '004 historical browser AVG',
          town: '004 historical browser town', ttrpg: '004 historical browser campaign' }[targetKind]
        const route = `https://sfqa004.example/storyforge/${item.kind}`
        const query = `?project=${item.scope.projectId}&work=${item.scope.workId}`
        await page.goto(`${route}/library${query}`)
        await nav().waitFor({ state: 'visible', timeout: 20_000 })
        await page.locator('main').getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
        const createLabel = item.kind === 'chat' ? '新建角色聊天' : item.kind === 'avg' ? '新建 AVG' : item.kind === 'town' ? '新建小镇' : '新建战役'
        await expect(page.getByRole('button', { name: createLabel, exact: true })).toBeDisabled()
        await expect(page.getByRole('link', { name: '游玩与存档', exact: true })).toBeVisible()
        await page.goto(`${route}/vision${query}`)
        await nav().waitFor({ state: 'visible', timeout: 20_000 })
        const authoring = page.locator('fieldset.avg-form')
        await authoring.getByRole('textbox').first().waitFor({ state: 'visible', timeout: 20_000 })
        await expect(authoring.getByRole('textbox').first()).toHaveValue(title)
        await expect(authoring).toHaveJSProperty('disabled', true)
        const controls = authoring.locator('input, textarea, select, button')
        const controlCount = await controls.count()
        expect(controlCount).toBeGreaterThan(0)
        for (let index = 0; index < controlCount; index += 1) await expect(controls.nth(index)).toBeDisabled()
        await expect(page.getByText('当前产品尚未开放创作；已保存作品、原始内容和发行版本仍可查看。', { exact: true })).toBeVisible()
        const settings = page.getByRole(item.kind === 'chat' ? 'link' : 'button', { name: '通用设置', exact: true })
        await expect(settings).toBeEnabled()
        await settings.click()
        await expect(page).toHaveURL(/\/home\/settings/)
        await page.getByRole('heading', { name: 'AI 模型配置', exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
      }
      await page.goto('https://sfqa004.example/storyforge/')
      await nav().waitFor({ state: 'visible', timeout: 20_000 })
    }
    expect(modelRequests).toBe(0)
    await test.info().attach('frozen-static-proxy', { contentType: 'application/json', body: JSON.stringify({
      targetKind, staticCacheHits, staticUpstreamFetches, cachedModules: staticBytes.size, modelRequests,
    }) })
  })
}
