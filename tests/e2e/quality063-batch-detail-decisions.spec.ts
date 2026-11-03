import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const output = JSON.stringify({ openingHook: '断桥前的绳结再次松动。', endingCliffhanger: '旧桥钉上出现陌生的印记。', sceneLocation: '断桥', emotionArc: 'rising', appearingCharacterIds: [], foreshadowIds: [], scenes: [
  { title: '试绳探路', summary: '守桥人先用石块测试绳结，确认承重后救下旅客，却因此错过渡船。', location: '断桥', conflict: '救人和赶船不可兼得。', pace: 'medium', characterIds: [], estimatedWords: 1200, notes: '' },
] })

async function setup(page: Page, chapterCount = 2) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', model: 'isolated-batch-detail', baseUrl: 'https://batch-detail.invalid/v1', maxTokens: 6000, contextWindow: 64000 }))
  })
  let calls = 0
  await page.route('https://batch-detail.invalid/**', async route => {
    calls++
    await route.fulfill({ json: { choices: [{ message: { content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 } } })
  })
  await createLongform(page, 'SFQA063 批量细纲决定')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  for (let index = 0; index < chapterCount; index++) {
    await page.getByRole('button', { name: '添加章节', exact: true }).click()
    await page.getByLabel('章节摘要', { exact: true }).nth(index).fill(`第${index + 1}章：先试绳再救人，代价是错过渡船。`)
    await page.getByLabel('章节摘要', { exact: true }).nth(index).blur()
  }
  await openLongformLeaf(page, '细纲')
  await page.getByRole('button', { name: '第1章', exact: true }).click()
  await expect(page.getByRole('heading', { name: '📝 第1章', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '批量生成细纲', exact: true }).click()
  try {
    await expect.poll(async () => (await snapshot(page)).events.filter(event => event.type === 'candidate.persisted').length).toBe(1)
  } catch (error) {
    await test.info().attach('batch-detail-state', { body: JSON.stringify({ calls, errors, state: await snapshot(page) }), contentType: 'application/json' })
    throw error
  }
  return () => calls
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return { details: await db.detailedOutlines.toArray(), runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray() }
  })
}

test('SFQA063 live batch exposes decisions and adopts only the chosen chapter before continuing', async ({ page }) => {
  const calls = await setup(page)
  expect((await snapshot(page)).details).toHaveLength(0)
  const adopt = page.getByRole('button', { name: '采纳', exact: true })
  await expect(adopt).toBeEnabled()
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('请先采纳或放弃当前批量细纲候选，再重新生成。', { exact: true })).toBeVisible()
  expect(calls()).toBe(1)
  await adopt.click()
  await expect.poll(async () => (await snapshot(page)).details.length).toBe(1)
  await expect.poll(calls).toBe(2)
  await expect(adopt).toBeEnabled()
  expect((await snapshot(page)).details).toHaveLength(1)
  await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).events.filter(event => event.type === 'confirmation.recorded').length).toBe(2)
  expect((await snapshot(page)).details).toHaveLength(1)
  expect(calls()).toBe(2)
})

for (const decision of ['adopt', 'reject'] as const) test(`SFQA063 stopped/reloaded batch retains the same candidate for explicit ${decision} without replay`, async ({ page }) => {
  const calls = await setup(page, 1)
  const before = await snapshot(page)
  await page.getByTitle('停止', { exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).runs[0].status).toBe('paused')
  expect((await snapshot(page)).events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(0)
  expect((await snapshot(page)).details).toHaveLength(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeEnabled()
  expect(calls()).toBe(1)
  expect((await snapshot(page)).runs[0].id).toBe(before.runs[0].id)
  if (decision === 'adopt') {
    await page.getByRole('button', { name: '采纳', exact: true }).click()
    await expect.poll(async () => (await snapshot(page)).details.length).toBe(1)
    await expect.poll(async () => (await snapshot(page)).runs[0].status).toBe('completed')
  } else {
    await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
    await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
    expect((await snapshot(page)).details).toHaveLength(0)
  }
  await expect.poll(async () => (await snapshot(page)).events.filter(event => event.type === 'confirmation.recorded').length).toBe(1)
  expect(calls()).toBe(1)
})

test('SFQA063 leaving the panel pauses the batch without deciding or losing its candidate', async ({ page }) => {
  const calls = await setup(page)
  const before = await snapshot(page)
  await openLongformLeaf(page, '大纲')
  await expect.poll(async () => (await snapshot(page)).runs[0].status).toBe('paused')
  expect((await snapshot(page)).events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(0)
  await openLongformLeaf(page, '细纲')
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeEnabled()
  expect((await snapshot(page)).runs[0].id).toBe(before.runs[0].id)
  expect((await snapshot(page)).details).toHaveLength(0)
  await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).events.filter(event => event.type === 'confirmation.recorded').length).toBe(1)
  expect(calls()).toBe(1)
})

test('SFQA063 a restored candidate checks the real source summary before adoption', async ({ page }) => {
  const calls = await setup(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeEnabled()
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const first = (await db.outlineNodes.toArray()).filter(row => row.type === 'chapter').sort((a, b) => a.order - b.order)[0]
    await db.outlineNodes.update(first.id!, { summary: '另一页面已经确认的新章纲摘要。' })
  })
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText('章节大纲已变化，批量细纲候选已过期。', { exact: true })).toBeVisible()
  const after = await snapshot(page)
  expect(after.details).toHaveLength(0)
  expect(after.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(0)
  expect(after.events.filter(event => event.type === 'candidate.staled')).toHaveLength(1)
  expect(calls()).toBe(1)
})
