import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const output = JSON.stringify({ openingHook: '断桥前的绳结再次松动。', endingCliffhanger: '旧桥钉上出现陌生的印记。', sceneLocation: '断桥', emotionArc: 'rising', appearingCharacterIds: [], foreshadowIds: [], scenes: [
  { title: '试绳探路', summary: '守桥人先用石块测试绳结，确认承重后救下旅客，却因此错过渡船。', location: '断桥', conflict: '救人和赶船不可兼得。', pace: 'medium', characterIds: [], estimatedWords: 1200, notes: '' },
] })

async function setup(page: Page, chapterCount = 2) {
  const errors: string[] = []
  await page.context().route(/^https?:\/\//, route => {
    const host = new URL(route.request().url()).hostname
    return ['localhost', '127.0.0.1', '[::1]'].includes(host) ? route.continue() : route.abort()
  })
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
    return { details: await db.detailedOutlines.toArray(), runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), nodes: await db.outlineNodes.toArray() }
  })
}

for (const changeSource of [true, false]) {
  test(`SFQA063 recovered candidate ${changeSource ? 'rejects a source changed in another page' : 'adopts an unchanged source'} without replay`, async ({ page, context }, testInfo) => {
    const calls = await setup(page, 1)
    await page.reload()
    const adopt = page.getByRole('button', { name: '采纳', exact: true })
    await expect(adopt).toBeEnabled()
    const before = await snapshot(page)
    const chapter = before.nodes.find(row => row.type === 'chapter')!
    expect(before.details).toHaveLength(0)
    expect(calls()).toBe(1)

    const peer = await context.newPage()
    await peer.goto(page.url())
    await openLongformLeaf(peer, '大纲')
    const source = peer.getByLabel('章节摘要', { exact: true }).first()
    await expect(source).toHaveValue(chapter.summary || '')
    const nextSummary = '另一页面已保存的新章纲：先撤离旅客，再修复断桥，放弃追船。'
    if (changeSource) {
      await source.fill(nextSummary)
      await source.blur()
      await expect.poll(async () => (await snapshot(peer)).nodes.find(row => row.id === chapter.id)?.summary).toBe(nextSummary)
    }

    await expect(adopt).toBeEnabled()
    await adopt.click()
    await testInfo.attach('source-summary-after-click-ui', { body: await page.locator('body').innerText(), contentType: 'text/plain' })
    try {
      if (changeSource) {
        await expect(page.getByText(/\[context-gateway-execution:candidate-context-stale\]/)).toBeVisible()
      } else {
        await expect.poll(async () => (await snapshot(page)).details.length).toBe(1)
      }
      const after = await snapshot(page)
      await testInfo.attach('source-summary-decision-state', { body: JSON.stringify({ changeSource, calls: calls(), before, after }), contentType: 'application/json' })
      if (changeSource) {
        expect(after.details).toHaveLength(0)
        expect(after.events.filter(event => event.type === 'confirmation.recorded' || event.type === 'adoption.committed')).toHaveLength(0)
        expect(after.nodes.find(row => row.id === chapter.id)?.summary).toBe(nextSummary)
      } else {
        expect(after.details).toHaveLength(1)
        const detail = after.details[0]!
        expect(detail.outlineNodeId).toBe(chapter.id)
        expect(detail.lastUsedSummary).toBe(chapter.summary)
        expect(after.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
        expect(after.events.filter(event => event.type === 'candidate.staled')).toHaveLength(0)
      }
      expect(calls()).toBe(1)
    } catch (error) {
      await testInfo.attach('source-summary-failure-state', { body: JSON.stringify({ changeSource, calls: calls(), state: await snapshot(page) }), contentType: 'application/json' })
      throw error
    } finally {
      await peer.close()
    }
  })
}

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


test('SFQA063 an explicit live decision writes one chapter before the next candidate is offered', async ({ page }) => {
  const calls = await setup(page, 2)
  const chapters = (await snapshot(page)).nodes.filter(row => row.type === 'chapter').sort((a, b) => a.order - b.order)
  const adopt = page.getByRole('button', { name: '采纳', exact: true })
  await expect(adopt).toBeEnabled()
  expect((await snapshot(page)).details).toHaveLength(0)
  await adopt.click()
  await expect.poll(async () => (await snapshot(page)).details.length).toBe(1)
  expect((await snapshot(page)).details[0]!.outlineNodeId).toBe(chapters[0]!.id)
  await expect.poll(calls).toBe(2)
  await expect(adopt).toBeEnabled()
  await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).events.filter(event => event.type === 'confirmation.recorded').length).toBe(2)
  expect((await snapshot(page)).details).toHaveLength(1)
  expect(calls()).toBe(2)
})
