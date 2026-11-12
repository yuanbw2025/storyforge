import { expect, test } from '@playwright/test'

for (const outcome of ['success', 'failure'] as const) test(`116 real player keeps a late ${outcome} on A after B navigation and reload`, async ({ browser, baseURL }, info) => {
  if (!baseURL) throw new Error('Isolated loopback app required')
  const origin = new URL(baseURL).origin
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Author storage is forbidden')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  let releaseResponse!: () => void
  const delayed = new Promise<void>(resolve => { releaseResponse = resolve })
  let modelPosts = 0, raw = ''
  const forbidden: string[] = [], errors: string[] = []
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && url.pathname === '/sfqa116/v1/chat/completions' && request.method() === 'POST') {
      modelPosts++
      if (modelPosts !== 1) { await route.abort(); return }
      await delayed
      if (outcome === 'failure') {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: '原存档 A 的请求失败' } }) })
        return
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        choices: [{ message: { content: raw }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 },
      }) })
    } else if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort() }
  })
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality116-isolated'))
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('./')
    const seeded = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      if (await db.projects.count()) throw new Error('Expected a new isolated browser database')
      const { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } = await load<typeof import('../helpers/current-product-world')>('/storyforge/tests/helpers/current-product-world.ts')
      const { createTextAdventureFoundationRuntimePackageV2 } = await load<typeof import('../helpers/text-adventure-v2-foundation')>('/storyforge/tests/helpers/text-adventure-v2-foundation.ts')
      const { seedCurrentProductBuild } = await load<typeof import('../helpers/current-product-build')>('/storyforge/tests/helpers/current-product-build.ts')
      const { readProductRuntimeState } = await load<typeof import('../../src/lib/adventure/runtime-api')>('/storyforge/src/lib/adventure/runtime-api.ts')
      const { availableAdventureActions } = await load<typeof import('../../src/lib/adventure/runtime')>('/storyforge/src/lib/adventure/runtime.ts')
      const world = await seedCurrentProductWorld('116 原生隔离世界')
      if (world.release.id == null) throw new Error('Missing frozen release')
      const release = { ...world.release, id: world.release.id }
      const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({ scope: world.scope, worldReleaseId: release.id, productType: 'text-adventure' })
      const runtimePackage = createTextAdventureFoundationRuntimePackageV2({ worldRelease: release, sourceCatalog })
      const a = await seedCurrentProductBuild({ scope: world.scope, worldRelease: release, runtimePackage, title: '116 原存档 A' })
      const b = await seedCurrentProductBuild({ scope: world.scope, worldRelease: release, runtimePackage, title: '116 新存档 B' })
      const state = await readProductRuntimeState(a.session.id!)
      const action = availableAdventureActions(runtimePackage.adventure!, state.adventure!).find(item => item.available)?.action
      if (!action) throw new Error('No legal deterministic action')
      return { scope: world.scope, a: a.session.id!, b: b.session.id!, actionKey: action.key,
        raw: JSON.stringify({ kind: 'adventure-intent', actionKey: action.key, rationale: '仅属于原存档 A 的候选 e\u0301', requiresConfirmation: true }),
        originalWorlds: JSON.stringify(await db.worldReleases.toArray()),
        aEvents: JSON.stringify(await db.productRuntimeEvents.where('sessionId').equals(a.session.id!).toArray()),
        bEvents: JSON.stringify(await db.productRuntimeEvents.where('sessionId').equals(b.session.id!).toArray()) }
    })
    raw = seeded.raw
    await page.goto(`./adventure/play?project=${seeded.scope.projectId}&work=${seeded.scope.workId}&session=${seeded.a}`)
    await page.evaluate(async origin => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
      useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'synthetic-116', apiKey: 'synthetic-no-network',
        baseUrl: origin + '/sfqa116/v1', temperature: 0, maxTokens: 1024, contextWindow: 128_000 })
    }, origin)
    const player = page.getByTestId('adventure-game-player')
    await expect(player).toBeVisible()
    await expect(player).toContainText('自由表达已连接主 Agent')
    await player.getByRole('textbox', { name: '输入冒险指令' }).fill('请主 Agent 理解我此刻的探索想法')
    await player.locator('.adventure-command-center').getByRole('button', { name: '执行', exact: true }).click()
    await expect.poll(() => modelPosts).toBe(1)
    await player.getByRole('button', { name: '退出游戏' }).click()
    await page.locator('.adventure-saved-journeys summary').click()
    await page.locator('.adventure-saved-journeys').getByRole('button', { name: /116 新存档 B/ }).click()
    await expect(player).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`session=${seeded.b}(?:&|$)`))
    releaseResponse()
    if (outcome === 'failure') {
      await expect.poll(() => page.evaluate(async sessionId => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
        return (await db.agentRuns.where('productRuntimeSessionId').equals(sessionId).first())?.status
      }, seeded.a)).toBe('failed')
      await expect(player.getByRole('alert')).toHaveCount(0)
      await expect(player.locator('.adventure-console-intent')).toHaveCount(0)
      await page.reload()
      await expect(player).toBeVisible()
      await expect(player.getByRole('alert')).toHaveCount(0)
      await expect(player.locator('.adventure-console-intent')).toHaveCount(0)
      const after = await page.evaluate(async seed => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
        const events = async (id: number) => JSON.stringify(await db.productRuntimeEvents.where('sessionId').equals(id).toArray())
        return { a: await events(seed.a), b: await events(seed.b),
          bRuns: await db.agentRuns.where('productRuntimeSessionId').equals(seed.b).count(),
          aRun: (await db.agentRuns.where('productRuntimeSessionId').equals(seed.a).first())?.status }
      }, seeded)
      expect(after).toEqual({ a: seeded.aEvents, b: seeded.bEvents, bRuns: 0, aRun: 'failed' })
      expect(modelPosts).toBe(1)
      expect(forbidden).toEqual([])
      expect(errors).toEqual([])
      return
    }
    await expect.poll(() => page.evaluate(async sessionId => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const run = await db.agentRuns.where('productRuntimeSessionId').equals(sessionId).first()
      if (!run?.id) return false
      return (await db.agentRunCheckpoints.where('runId').equals(run.id).toArray())
        .some(checkpoint => checkpoint.resumePayloadJson?.includes('adventure-intent-candidate'))
    }, seeded.a)).toBe(true)
    await expect(player.locator('.adventure-console-intent')).toHaveCount(0)
    await expect(player).not.toContainText('仅属于原存档 A 的候选')
    await page.reload()
    await expect(player).toBeVisible()
    await expect(player.locator('.adventure-console-intent')).toHaveCount(0)
    await player.getByRole('button', { name: '退出游戏' }).click()
    await page.locator('.adventure-saved-journeys summary').click()
    await page.locator('.adventure-saved-journeys').getByRole('button', { name: /116 原存档 A/ }).click()
    await player.locator('.adventure-console-recovery summary').click()
    await player.getByRole('button', { name: /恢复行动 #/ }).click()
    await expect.poll(() => page.evaluate(async sessionId => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      return (await db.agentRuns.where('productRuntimeSessionId').equals(sessionId).first())?.status
    }, seeded.a)).toBe('completed')
    const restored = await page.evaluate(async seed => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { readProductRuntimeState } = await load<typeof import('../../src/lib/adventure/runtime-api')>('/storyforge/src/lib/adventure/runtime-api.ts')
      const run = await db.agentRuns.where('productRuntimeSessionId').equals(seed.a).first()
      const raw = await db.agentRunArtifacts.filter(row => row.projectId === seed.scope.projectId && row.artifactKind === 'raw-response').toArray()
      return { state: await readProductRuntimeState(seed.a), runStatus: run?.status,
        raw: raw.map(row => JSON.parse(row.content!).raw as string),
        bEvents: JSON.stringify(await db.productRuntimeEvents.where('sessionId').equals(seed.b).toArray()),
        worlds: JSON.stringify(await db.worldReleases.toArray()) }
    }, seeded)
    expect(restored.state.adventure?.actionHistory.some(action => action.actionKey === seeded.actionKey)).toBe(true)
    expect(restored.runStatus).toBe('completed')
    expect(restored.raw).toEqual([seeded.raw])
    expect(restored.bEvents).toBe(seeded.bEvents)
    expect(restored.worlds).toBe(seeded.originalWorlds)
    expect(modelPosts).toBe(1)
    expect(forbidden).toEqual([])
    expect(errors).toEqual([])
    await info.attach('session-bound-recovery', { contentType: 'application/json', body: JSON.stringify({ seeded, restored, modelPosts }) })
  } finally { releaseResponse(); await context.close() }
})
