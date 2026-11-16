import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'openai', baseUrl: 'https://batch-detail-test.invalid/v1', model: 'batch-detail-test', temperature: 0.2, maxTokens: 4000 }))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  let calls = 0
  await page.route(/^https?:\/\//, async route => {
    const host = new URL(route.request().url()).hostname
    if (['127.0.0.1', 'localhost'].includes(host)) return route.continue()
    if (host !== 'batch-detail-test.invalid') return route.abort()
    calls++
    const output = JSON.stringify({ openingHook: '桥头承接', endingCliffhanger: '渡船离岸', sceneLocation: '桥头', emotionArc: 'rising', appearingCharacterIds: [], foreshadowIds: [], scenes: [{ title: `合成候选${calls}`, summary: '先试绳再救人。', location: '桥头', conflict: '救人与赶船', pace: 'medium', characterIds: [], estimatedWords: 800 }] })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } }) })
  })
  await createLongform(page, '批量细纲确认隔离验收')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByLabel('章节摘要', { exact: true }).fill('先试绳再救人。')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expect(page.getByLabel('章节摘要', { exact: true })).toHaveCount(2)
  await page.getByLabel('章节摘要', { exact: true }).last().fill('渡船即将离岸。')
  await page.getByTitle('编辑本章细纲', { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: '📝 第1章', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '批量生成细纲', exact: true }).click()
  await expect(page.getByText('等待确认「第1章」的细纲候选...', { exact: true })).toBeVisible()
  return { calls: () => calls }
}

async function savedScenes(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.detailedOutlines.toArray()).flatMap((row: { scenes: { title: string }[] }) => row.scenes.map(scene => scene.title))
  })
}

test('batch waits for adoption, shows each current candidate and never confirms from a different chapter', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const run = await setup(page)
  expect(run.calls()).toBe(1)
  expect(await savedScenes(page)).toEqual([])
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '第2章', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  expect(await savedScenes(page)).toEqual([])
  await page.getByRole('button', { name: '第1章', exact: true }).click()
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText('等待确认「第2章」的细纲候选...', { exact: true })).toBeVisible()
  await expect.poll(() => savedScenes(page)).toEqual(['合成候选1'])
  expect(run.calls()).toBe(2)
  await expect(page.getByRole('heading', { name: '📝 第2章', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect.poll(() => savedScenes(page)).toEqual(['合成候选1', '合成候选2'])
  await expect.poll(() => page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.agentRuns.toArray()).some((run: { status: string }) => run.status === 'completed')
  })).toBe(true)
  await page.reload()
  expect(await savedScenes(page)).toEqual(['合成候选1', '合成候选2'])
  expect(run.calls()).toBe(2)
  expect(errors).toEqual([])
})

test('reload restores adoption without another model call and retains the remaining chapter for an explicit batch restart', async ({ page }) => {
  const run = await setup(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeVisible()
  expect(await savedScenes(page)).toEqual([])
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect.poll(() => savedScenes(page)).toEqual(['合成候选1'])
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  expect(run.calls()).toBe(1)
  await page.reload()
  await expect(page.getByRole('button', { name: '批量生成细纲', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '批量生成细纲', exact: true }).click()
  await expect(page.getByText('等待确认「第2章」的细纲候选...', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect.poll(() => savedScenes(page)).toEqual(['合成候选1', '合成候选2'])
  expect(run.calls()).toBe(2)
})

test('reload restores the pending batch decision and rejection preserves the unwritten chapter', async ({ page }) => {
  const run = await setup(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: '📝 第1章', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeVisible()
  expect(run.calls()).toBe(1)
  expect(await savedScenes(page)).toEqual([])
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: '📝 第1章', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  expect(await savedScenes(page)).toEqual([])
  expect(run.calls()).toBe(1)
})
