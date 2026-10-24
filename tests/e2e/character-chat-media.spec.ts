import {test, expect} from '@playwright/test'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'

test('the author inspects exact Build images and missing Build bytes cannot borrow a Release asset', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  let calls = 0
  await page.route('**/chat/completions', async route => {calls++; await route.abort()})
  await page.route('**/local-codex/v1/requests', async route => {if (route.request().method() === 'POST') {calls++; await route.abort()} else await route.continue()})
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), f = await (await load('/storyforge/tests/helpers/chat-media-fixture.ts')).seedChatMediaBuildFixture()
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {scope: f.scope, productionId: f.productionId, buildId: f.buildId, releaseId: f.releaseId,
      before: JSON.stringify({build: await db.productBuilds.get(f.buildId), production: await db.productProductions.get(f.productionId),
        worlds: await db.worldReleases.toArray(), events: await db.productRuntimeEvents.toArray()})}
  })
  await page.goto(`./chat/media?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  const gallery = page.getByTestId('chat-build-media')
  await expect(gallery.getByRole('img')).toHaveCount(3)
  await expect(gallery.getByRole('img', {name: '叶岑工程头像与立绘'})).toBeVisible()
  await expect(gallery.getByText('叶岑 · 头像；叶岑 · 在场立绘', {exact: true})).toBeVisible()
  await gallery.getByText('素材信息', {exact: true}).first().click()
  await expect(gallery.getByText('许可：test-only', {exact: true}).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('chat-build-images-mobile.png'), fullPage: false})
  const beforeDeletion = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const snapshot = JSON.stringify({build: await db.productBuilds.get(f.buildId), production: await db.productProductions.get(f.productionId),
      worlds: await db.worldReleases.toArray(), events: await db.productRuntimeEvents.toArray()})
    await db.productBuildArtifacts.where('buildId').equals(f.buildId).filter((row: {artifactKey: string}) => row.artifactKey === 'guard.portrait').delete()
    return {snapshot, releaseImages: await db.productMediaAssets.where('productReleaseId').equals(f.releaseId).count()}
  }, f)
  expect(beforeDeletion.snapshot).toBe(f.before); expect(beforeDeletion.releaseImages).toBe(3)
  await page.getByRole('button', {name: '刷新生成版本', exact: true}).click()
  await expect(gallery.getByRole('img')).toHaveCount(2)
  await expect(gallery.getByRole('img', {name: '叶岑工程头像与立绘'})).toHaveCount(0)
  await expect(gallery.getByText('图片暂不可用，文字内容仍可查看。', {exact: true})).toBeVisible()
  await page.reload()
  await expect(gallery.getByRole('img')).toHaveCount(2)
  expect(calls).toBe(0)
})

for (const width of [390, 1440]) test(`frozen chat images survive save changes and restoration at ${width}px`, async ({page, browser}, info) => {
  await page.setViewportSize({width, height: 844})
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', model: 'test', baseUrl: 'https://chat-media.invalid/v1', apiKey: ''}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  let calls = 0
  await page.route('https://chat-media.invalid/**', async route => {
    calls++
    if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const output = prompt.includes('本次持久化行动候选')
      ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '图片工程夹具，不作剧情质量验收'}))}
      : {kind: 'speak', text: '我先看看门边的告示，有消息再告诉你。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), f = await (await load('/storyforge/tests/helpers/chat-media-fixture.ts')).seedChatMediaPlayerFixture()
    return {...f, worlds: JSON.stringify(await (await load('/storyforge/src/lib/db/schema.ts')).db.worldReleases.toArray())}
  })
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByRole('button', {name: '作品与存档'}).click()
  const card = page.getByRole('article', {name: '驿站工程核验 · 版本 2', exact: true})
  await card.getByLabel('开场行动角色').selectOption('guard')
  await card.getByRole('button', {name: '新建会话', exact: true}).click()
  const messages = page.getByRole('region', {name: '对话记录', exact: true})
  await expect(messages.getByText('我先看看门边的告示，有消息再告诉你。', {exact: true})).toBeVisible()
  await expect(messages.getByRole('img', {name: '叶岑工程头像与立绘'})).toBeVisible()
  await expect.poll(() => messages.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('blob:')
  expect(calls).toBe(3)
  await expect(page.getByRole('textbox', {name: '发送给角色的消息'})).toBeInViewport({ratio: 1})
  await expect(page.getByRole('button', {name: '发送并生成', exact: true})).toBeInViewport({ratio: 1})
  await page.getByText('查看画面', {exact: true}).click()
  const gallery = page.getByLabel('当前人物与场景', {exact: true})
  await expect(gallery.getByRole('img')).toHaveCount(3)
  await expect(gallery.getByText('叶岑', {exact: true})).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.screenshot({path: info.outputPath(`chat-images-${width}.png`), fullPage: false})
  await page.getByText('查看画面', {exact: true}).click()
  await page.getByText('在场角色', {exact: true}).click()
  await page.getByRole('button', {name: '让 叶岑 离场', exact: true}).click()
  await expect(page.getByRole('button', {name: '让 叶岑 回归', exact: true})).toBeVisible()
  await page.getByText('在场角色', {exact: true}).click()
  await page.getByText('查看画面', {exact: true}).click()
  await expect(gallery.getByText('叶岑', {exact: true})).toHaveCount(0)
  await expect(gallery.getByText('程素', {exact: true})).toBeVisible()
  await expect(messages.getByRole('img', {name: '叶岑工程头像与立绘'})).toBeVisible()
  await page.reload()
  await expect(messages.getByRole('img', {name: '叶岑工程头像与立绘'})).toBeVisible()
  expect(calls).toBe(3)
  const backup = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/src/lib/export/json-export.ts')).exportProjectJSON(id)
  }, f.scope.projectId)
  const isolated = await browser.newContext({viewport: {width, height: 844}}), restoredPage = await isolated.newPage()
  let restoredCalls = 0
  try {
    await restoredPage.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    await restoredPage.route('**/chat/completions', async route => {restoredCalls++; await route.abort()})
    await restoredPage.route('**/local-codex/v1/requests', async route => {if (route.request().method() === 'POST') {restoredCalls++; await route.abort()} else await route.continue()})
    await restoredPage.goto(new URL('/storyforge/chat/library', page.url()).href)
    const restored = await restoredPage.evaluate(async backup => {
      const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
      const projectId = await (await load('/storyforge/src/lib/export/json-export.ts')).importProjectJSON(backup)
      const release = (await db.productReleases.where('projectId').equals(projectId).toArray()).find((r: {version: number}) => r.version === 2)
      const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {productReleaseId: number}) => s.productReleaseId === release.id)
      return {projectId, workId: session.workId, sessionId: session.id}
    }, backup)
    await restoredPage.goto(new URL(`/storyforge/chat/play?project=${restored.projectId}&work=${restored.workId}&session=${restored.sessionId}`, page.url()).href)
    await expect(restoredPage.getByRole('region', {name: '对话记录', exact: true}).getByRole('img', {name: '叶岑工程头像与立绘'})).toBeVisible()
    expect(restoredCalls).toBe(0)
  } finally {await isolated.close()}
  await page.getByRole('button', {name: '作品与存档'}).click()
  await page.locator('#chat-session-list').getByRole('button', {name: /^驿站\s*可继续$/}).click()
  await expect(page.getByTestId('chat-media-details')).toHaveCount(0)
  await expect(messages.getByRole('img')).toHaveCount(0)
  expect(await messages.evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none')
  expect(calls).toBe(3)
  expect(await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return JSON.stringify(await (await load('/storyforge/src/lib/db/schema.ts')).db.worldReleases.toArray())
  })).toBe(f.worlds)
})
