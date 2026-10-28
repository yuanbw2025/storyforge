import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const output = JSON.stringify([{ title: '第1卷', summary: '测绳人先检查绳结，再核算木料与退路；在桥边发现新钉痕，由此追查偷工减料。系统只记录已验证的路径，不预知对手的行动。' }])
async function generate(page: Page, options: { delayCandidate?: boolean; output?: string; blocked?: boolean } = {}) {
  const { delayCandidate = false } = options
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', model: 'isolated-outline-recovery', baseUrl: 'https://outline-recovery.invalid/v1', maxTokens: 4000, contextWindow: 64000 }))
  })
  let calls = 0
  await page.route('https://outline-recovery.invalid/**', async route => {
    calls++
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: options.output ?? output }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 } })}\n\ndata: [DONE]\n\n` })
  })
  await createLongform(page, '单卷候选刷新恢复验收')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expect(page.getByLabel('卷标题', { exact: true })).toHaveValue('第1卷')
  if (delayCandidate) await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const add = db.agentEvents.add.bind(db.agentEvents)
    let delayed = false
    db.agentEvents.add = async (event: { kind: string }) => {
      if (!delayed && event.kind === 'candidate') { delayed = true; await db.constructor.waitFor(new Promise(resolve => setTimeout(resolve, 1200))) }
      return add(event)
    }
  })
  await page.getByRole('button', { name: 'AI 生成本卷卷纲', exact: true }).click()
  await page.getByRole('button', { name: '确认生成', exact: true }).click()
  if (delayCandidate) {
    await expect(page.getByRole('status').filter({ hasText: '正在建立可恢复候选' })).toBeVisible()
    await expect(page.getByRole('button', { name: '预览候选', exact: true })).toHaveCount(0)
  }
  if (options.blocked) await expect(page.getByTestId('outline-drag-scroll').getByText('模型输出无法确定性解析为大纲条目。', { exact: true })).toBeVisible()
  else await expect(page.getByRole('button', { name: '预览候选', exact: true })).toBeEnabled()
  return () => calls
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { nodes: await db.outlineNodes.toArray(), runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray() }
  })
}

test('a single-volume candidate survives development StrictMode reload and adopts through its original run without replay', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const calls = await generate(page)
  const before = await snapshot(page)
  expect(before.nodes[0].summary).toBe(''); expect(before.runs[0].status).toBe('awaiting_confirmation')
  await page.reload()
  await expect(page.getByRole('button', { name: '预览候选', exact: true })).toBeEnabled()
  expect((await snapshot(page)).nodes).toEqual(before.nodes); expect(calls()).toBe(1)
  await page.getByRole('button', { name: '预览候选', exact: true }).click()
  await page.getByRole('button', { name: '确认写入', exact: true }).click()
  await expect(page.getByLabel('卷情节摘要', { exact: true })).toHaveValue(JSON.parse(output)[0].summary)
  const after = await snapshot(page)
  expect(after.nodes[0].id).toBe(before.nodes[0].id); expect(after.runs[0].id).toBe(before.runs[0].id)
  expect(after.runs[0].status).toBe('completed')
  await page.reload()
  await expect(page.getByLabel('卷情节摘要', { exact: true })).toHaveValue(JSON.parse(output)[0].summary)
  expect(calls()).toBe(1); expect(errors).toEqual([])
})

test('a restored single-volume candidate can be rejected without changing the manuscript or repeating the model', async ({ page }) => {
  const calls = await generate(page); const before = await snapshot(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '预览候选', exact: true })).toBeEnabled()
  await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
  await expect(page.getByRole('button', { name: '预览候选', exact: true })).toHaveCount(0)
  await expect.poll(async () => (await snapshot(page)).runs[0].status).toBe('failed')
  expect((await snapshot(page)).events.filter((event: { type: string; payloadJson: string }) => event.type === 'run.failed').map((event: { payloadJson: string }) => JSON.parse(event.payloadJson))).toEqual([{ code: 'author_rejected', retryable: false }])
  expect((await snapshot(page)).nodes).toEqual(before.nodes)
  await page.reload(); await expect(page.getByLabel('卷情节摘要', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '预览候选', exact: true })).toHaveCount(0)
  expect(calls()).toBe(1)
})

test('a failed rejection preserves the candidate and allows the same close action after storage recovers', async ({ page }) => {
  const calls = await generate(page); const before = await snapshot(page)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async (event: { type: string }) => {
      if (event.type === 'confirmation.recorded') throw new DOMException('拒绝回执配额测试', 'QuotaExceededError')
      return add(event)
    }
    Object.assign(window, { restoreOutlineRejection: () => { db.agentRunEvents.add = add } })
  })
  await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
  await expect(page.getByTestId('outline-drag-scroll').getByText(/拒绝回执配额测试/)).toBeVisible()
  const failed = await snapshot(page)
  expect(failed.nodes).toEqual(before.nodes); expect(failed.runs[0].status).toBe('awaiting_confirmation')
  await page.evaluate(() => (window as unknown as { restoreOutlineRejection: () => void }).restoreOutlineRejection())
  await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).runs[0].status).toBe('failed')
  await expect(page.getByRole('button', { name: '预览候选', exact: true })).toHaveCount(0)
  expect((await snapshot(page)).nodes).toEqual(before.nodes); expect(calls()).toBe(1)
})

test('a completed model response exposes review only after its delayed durable candidate is acknowledged', async ({ page }) => {
  const calls = await generate(page, { delayCandidate: true })
  const saved = await snapshot(page)
  expect(saved.runs[0].status).toBe('awaiting_confirmation')
  expect(saved.nodes[0].summary).toBe(''); expect(calls()).toBe(1)
  await page.reload()
  await expect(page.getByRole('button', { name: '预览候选', exact: true })).toBeEnabled()
  expect(calls()).toBe(1)
})

test('malformed JSON is retained as a failed raw response without a review button, canonical write or model replay', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const raw = '```json\n[{"title":"第1卷","summary":"桥名"望津桥"错误。"}]\n```'
  const calls = await generate(page, { output: raw, blocked: true })
  await expect.poll(async () => (await snapshot(page)).runs[0].status).toBe('failed')
  const failed = await snapshot(page)
  expect(failed.nodes).toHaveLength(1); expect(failed.nodes[0].summary).toBe('')
  await expect(page.getByRole('button', { name: '预览候选', exact: true })).toHaveCount(0)
  expect(failed.events.filter((event: { type: string }) => event.type === 'run.failed').map((event: { payloadJson: string }) => JSON.parse(event.payloadJson))).toEqual([{ code: 'outline_output_unparseable', retryable: false }])
  const retained = await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.agentRunArtifacts.toArray()).map((artifact: { content: string }) => artifact.content)
  })
  expect(retained).toContain(raw)
  await page.reload()
  await expect(page.getByLabel('卷情节摘要', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '预览候选', exact: true })).toHaveCount(0)
  expect((await snapshot(page)).nodes).toEqual(failed.nodes)
  expect(calls()).toBe(1); expect(errors).toEqual([])
})
