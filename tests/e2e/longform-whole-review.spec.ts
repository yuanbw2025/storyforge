import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const original = '两人安静清点工具。'.repeat(650) + '\n\n未出现付款动作，却记为已收款。'
const quote = '未出现付款动作，却记为已收款。'
async function setup(page: Page, small = false) {
  await page.addInitScript(({ small }) => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://whole-review.invalid/v1', model: 'whole-review-test', maxTokens: small ? 500 : 4000, temperature: 0, contextWindow: small ? 1500 : 128000 })), { small })
  await createLongform(page, '全章评审实际路径')
  const target = await page.evaluate(async ({ original }) => {
    const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope, stampNewRecord }, { plainTextToHtml }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/lib/utils/html.ts')])
    const project = await db.projects.toCollection().first(); const scope = await resolveScope({ projectId: project.id })
    const root = { projectId: project.id, createdAt: Date.now(), updatedAt: Date.now() }
    const volume = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...root, type: 'volume', parentId: null, title: '小店', summary: '收店和结算', order: 0 }, { owner: 'work' }))
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...root, type: 'chapter', parentId: volume, title: '关灯', summary: '清点工具，收款后签收，最后关灯', order: 0 }, { owner: 'work' }))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...root, outlineNodeId, title: '关灯', content: plainTextToHtml(original), wordCount: original.length, order: 0, status: 'draft', notes: '' }, { owner: 'work' }))
    return { projectId: project.id, chapterId, outlineNodeId }
  }, { original })
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await page.locator('[data-workspace-ready=longform]').waitFor()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  return target
}

test('全文请求覆盖4000字后的结尾，三个模式保存报告，刷新和改稿后历史标识正确', async ({ page }) => {
  const requests: any[] = []
  await page.route('https://whole-review.invalid/**', route => {
    requests.push(route.request().postDataJSON())
    const json = { summary: '付款过程需要核对，安静章节可以保留。', strengths: ['保留必要缓冲'], issues: [{ dimension: 'causality', confidence: 'uncertain', anchorId: 'p2', reason: '没描写付款却记录已收款。', suggestion: '核对收款过程，保留金额和签字人。' }] }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) }, finish_reason: 'stop' }] }) })
  })
  const target = await setup(page)
  for (const mode of ['审校', '表达与重复', '追读力']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    const authorRequest = `本轮${mode}：检查结尾付款依据，保留安静清点。`
    await page.getByRole('textbox', { name: '本轮评审补充要求', exact: true }).fill(authorRequest)
    await page.getByRole('button', { name: '开始检测', exact: true }).click()
    const report = page.getByTestId('whole-chapter-quality-report')
    await expect(report).toContainText('付款过程需要核对')
    await expect(report).toContainText('第 2 段')
    await expect(report).toContainText(quote)
    expect(requests[requests.length - 1].stream).toBe(false)
    expect(requests[requests.length - 1].response_format).toEqual({ type: 'json_object' })
    expect(requests[requests.length - 1].messages[1].content).toContain(original)
    expect(requests[requests.length - 1].messages[1].content).toContain('【正文结束】')
    expect(requests[requests.length - 1].messages[1].content).toContain('"anchorId":"p2"')
    expect(requests[requests.length - 1].messages[1].content).toContain(authorRequest)
  }
  expect(requests).toHaveLength(3)
  await page.getByRole('button', { name: '审校', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '本轮评审补充要求', exact: true })).toHaveValue('本轮审校：检查结尾付款依据，保留安静清点。')
  await page.reload()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '审校', exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('当前正文报告')
  await page.evaluate(async id => {
    const imp = new Function('path', 'return import(path)')
    const [{ db }, { resolveScope }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts')])
    const scope = await resolveScope({ projectId: id })
    await db.works.update(scope.workId, { description: '作者改了场景意图，旧评审不能代表新任务。', updatedAt: Date.now() })
  }, target.projectId)
  expect(await page.evaluate(async target => {
    const imp = new Function('path', 'return import(path)')
    const [{ resolveScope }, { readLatestWholeChapterQualityReviewV1 }] = await Promise.all([imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/lib/agent/run/quality-review-durable.ts')])
    return (await readLatestWholeChapterQualityReviewV1({ scope: await resolveScope({ projectId: target.projectId }), chapterId: target.chapterId, mode: 'quality' }))?.current
  }, target)).toBe(false)
  await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('历史报告')
  await page.evaluate(async id => { const imp = new Function('path', 'return import(path)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts'); const row = await db.chapters.get(id); await db.chapters.update(id, { content: row.content + '<p>作者新增动作。</p>', updatedAt: Date.now() }) }, target.chapterId)
  await page.reload()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '审校', exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('历史报告')
  expect(requests).toHaveLength(3)
  await expect(page.locator('.tiptap-editor')).toContainText('作者新增动作')
})

test('假引文拒绝报告，保存原响应且不自动重发；原稿不改', async ({ page }) => {
  let calls = 0
  await page.route('https://whole-review.invalid/**', route => {
    calls++
    const json = { summary: '虚构意见', strengths: [], issues: [{ dimension: 'voice', confidence: 'suggestion', quote: '不存在的台词', start: null, end: null, reason: '猜测', suggestion: '不应采用' }] }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) }, finish_reason: 'stop' }] }) })
  })
  const target = await setup(page)
  await page.getByRole('button', { name: '审校', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByText(/引文不存在或重复/)).toBeVisible()
  await expect(page.getByTestId('whole-chapter-quality-report')).toHaveCount(0)
  expect(calls).toBe(1)
  await expect(page.locator('.tiptap-editor')).toContainText(quote)
  expect(await page.evaluate(async id => {
    const { db } = await import('/storyforge/src/lib/db/schema.ts')
    const runs = await db.agentRuns.where('projectId').equals(id).toArray()
    return runs.filter(run => JSON.parse(run.contractJson).workflowKind === 'read-only-audit').map(run => run.status)
  }, target.projectId)).toEqual(['failed'])
})

test('小窗口不能装入全章时零请求，不拿前段充当全文报告', async ({ page }) => {
  let calls = 0
  await page.route('https://whole-review.invalid/**', route => { calls++; return route.abort() })
  await setup(page, true)
  await page.getByRole('button', { name: '审校', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByText(/上下文窗口不足|评审响应未完成/)).toBeVisible()
  expect(calls).toBe(0)
  await expect(page.getByTestId('whole-chapter-quality-report')).toHaveCount(0)
})

test('提供商503只发送一次，失败不能生成有效报告', async ({ page }) => {
  let calls = 0
  await page.route('https://whole-review.invalid/**', route => { calls++; return route.fulfill({ status: 503, body: '暂时不可用' }) })
  const target = await setup(page)
  await page.getByRole('button', { name: '审校', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByText(/暂时不可用|503/)).toBeVisible()
  expect(calls).toBe(1)
  await expect(page.getByTestId('whole-chapter-quality-report')).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toContainText(quote)
  expect(await page.evaluate(async id => {
    const { db } = await import('/storyforge/src/lib/db/schema.ts')
    const runs = await db.agentRuns.where('projectId').equals(id).toArray()
    return runs.filter(run => JSON.parse(run.contractJson).workflowKind === 'read-only-audit').map(run => run.status)
  }, target.projectId)).toEqual(['failed'])
})

test('评审中关闭面板停止请求，刷新无有效报告也不自动重发', async ({ page }) => {
  let calls = 0
  await page.route('https://whole-review.invalid/**', async route => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '晚到结果', strengths: [], issues: [] }) }, finish_reason: 'stop' }] }) }).catch(() => undefined)
  })
  const target = await setup(page)
  await page.getByRole('button', { name: '审校', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect.poll(() => calls).toBe(1)
  await page.getByRole('button', { name: '关闭质量审校', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const { db } = await import('/storyforge/src/lib/db/schema.ts')
    const runs = await db.agentRuns.where('projectId').equals(id).toArray()
    return runs.filter(run => JSON.parse(run.contractJson).workflowKind === 'read-only-audit').map(run => run.status)
  }, target.projectId)).toEqual(['cancelled'])
  await page.reload()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '审校', exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report')).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toContainText(quote)
  expect(calls).toBe(1)
})
