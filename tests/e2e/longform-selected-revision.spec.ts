import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

async function setup(page: Page, includeSummary = false) {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://quality-revision.invalid/v1', model: 'quality-revision-test', maxTokens: 4000, temperature: 0, contextWindow: 128000 })))
  await createLongform(page, '作者选题修订')
  const target = await page.evaluate(async includeSummary => {
    const imp = new Function('path', 'return import(path)')
    const [{ db }, { resolveScope, stampNewRecord }, { normalizeRichEditorHTMLV1 }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/lib/editor/rich-editor-schema.ts')])
    const project = await db.projects.toCollection().first(); const scope = await resolveScope({ projectId: project.id })
    const root = { projectId: project.id, createdAt: Date.now(), updatedAt: Date.now() }
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...root, type: 'chapter', parentId: null, title: '签字', summary: '保留余额三点、金额一百二十，签字处停笔', order: 0 }, { owner: 'work' }))
    const sourceHtml = normalizeRichEditorHTMLV1('<p><strong>余额三点，金额一百二十。</strong></p><p>陈禾签下名字，正文到此结束。</p>' + (includeSummary ? '<p>这是多余的总结段。</p>' : ''))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...root, outlineNodeId, title: '签字', content: sourceHtml, wordCount: 32, order: 0, status: 'draft', notes: '' }, { owner: 'work' }))
    return { projectId: project.id, chapterId, outlineNodeId, sourceHtml }
  }, includeSummary)
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await page.locator('[data-workspace-ready=longform]').waitFor()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '审校', exact: true }).click()
  return target
}

function mock(page: Page, state: { calls: any[]; gate?: Promise<void>; removeWholeParagraph?: boolean }, recheckFails = false) {
  return page.route('https://quality-revision.invalid/**', async route => {
    const body = route.request().postDataJSON(); state.calls.push(body)
    const system = body.messages[0].content
    let report: any
    if (system.includes('你只能替换允许范围')) { await state.gate; report = { edits: [{ spanId: state.removeWholeParagraph ? 'p3.1' : 'p2.1', replacement: state.removeWholeParagraph ? '' : '陈禾签下名字。' }] } }
    else if (system.includes('本轮只复核一次')) {
      if (recheckFails) return route.fulfill({ status: 503, body: '复核暂时不可用' })
      const text = body.messages[1].content
      const match = text.match(/【冻结计划 [^\n]+】\n([^\n]+)/)!
      const issueId = JSON.parse(match[1])[0].id
      report = { review: { summary: '保留事实和签字，任务说明移除', strengths: ['自然停笔'], issues: [] }, outcomes: [{ issueId, status: 'improved', anchorId: 'p2', reason: '保留签字且不再插入任务说明' }] }
    } else report = { summary: '结尾有任务说明', strengths: ['保留金额与余额'], issues: [{ dimension: 'voice', confidence: 'suggestion', anchorId: state.removeWholeParagraph ? 'p3' : 'p2', reason: '写作任务语言混入正文', suggestion: '移除说明，保留签字事件' }] }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(report) }, finish_reason: 'stop' }] }) })
  })
}

async function reviewAndRevise(page: Page, requests: { review?: string; revision?: string } = {}) {
  if (requests.review) await page.getByRole('textbox', { name: '本轮评审补充要求', exact: true }).fill(requests.review)
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('结尾有任务说明')
  await page.getByRole('checkbox', { name: '处理第2段问题', exact: true }).check()
  if (requests.revision) await page.getByRole('textbox', { name: '本轮修稿要求', exact: true }).fill(requests.revision)
  await page.getByRole('button', { name: '生成修订并复核', exact: true }).click()
}

test('预演落盘前中断的修订刷新后可明确结束，写失败保留入口且不重发模型', async ({ page }) => {
  const state = { calls: [] as any[] }; await mock(page, state)
  await setup(page); await reviewAndRevise(page)
  await expect(page.getByRole('button', { name: '放弃修订', exact: true })).toBeEnabled()
  const target = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const [{ db }, { resolveScope }, { createAgentRunV1, readAgentRunV1, appendAgentRunEventV1 }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/lib/agent/run/event-store.ts')])
    const run = await db.agentRuns.orderBy('id').last(); const scope = await resolveScope({ projectId: run.projectId })
    const existing = await readAgentRunV1(scope, run.id)
    let interrupted = await createAgentRunV1({ scope, worldGroupId: existing.contract.scope.worldGroupId, contract: existing.contract })
    interrupted = await appendAgentRunEventV1({ scope, runId: interrupted.run.id, type: 'step.scheduled', payload: { stepId: 'prose-generation' }, expectedLastSequence: interrupted.projection.lastSequence })
    interrupted = await appendAgentRunEventV1({ scope, runId: interrupted.run.id, type: 'step.started', payload: { stepId: 'prose-generation', attempt: 1 }, expectedLastSequence: interrupted.projection.lastSequence })
    return { runId: interrupted.run.id, chapters: await db.chapters.toArray(), events: await db.agentRunEvents.where('runId').equals(interrupted.run.id).toArray() }
  })
  await page.reload(); await page.getByRole('button', { name: '质量审校', exact: true }).click()
  const recovery = page.getByTestId('quality-revision-incomplete-run')
  await expect(recovery).toContainText('尚无可采纳的预演')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async (...args: any[]) => {
      if (args[0].type === 'run.cancelled') throw new DOMException('隔离测试：未完成修订结束写入故障', 'QuotaExceededError')
      return add(...args)
    }
  })
  await recovery.getByRole('button', { name: '结束未完成运行', exact: true }).click()
  await expect(page.getByText(/未完成修订结束写入故障/)).toBeVisible()
  await expect(recovery).toBeVisible()
  const read = async () => page.evaluate(async runId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { status: (await db.agentRuns.get(runId)).status, chapters: await db.chapters.toArray(), events: await db.agentRunEvents.where('runId').equals(runId).toArray() }
  }, target.runId)
  expect(await read()).toEqual({ status: 'running', chapters: target.chapters, events: target.events })
  await page.reload(); await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await recovery.getByRole('button', { name: '结束未完成运行', exact: true }).click()
  await expect(recovery).toHaveCount(0)
  const ended = await read(); expect(ended.status).toBe('cancelled'); expect(ended.chapters).toEqual(target.chapters)
  for (const type of ['run.cancelled', 'memory.settlement.recorded']) expect(ended.events.filter((event: any) => event.type === type)).toHaveLength(1)
  expect(state.calls).toHaveLength(3)
})

test('放弃修订写失败保留预演，刷新重试沿原运行取消且不重发模型', async ({ page }) => {
  const state = { calls: [] as any[] }; await mock(page, state)
  await setup(page); await reviewAndRevise(page)
  const preview = page.getByTestId('quality-revision-preview')
  await expect(preview).toContainText('复核已返回')
  const before = await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const run = await db.agentRuns.orderBy('id').last()
    const chapters = await db.chapters.toArray()
    const events = await db.agentRunEvents.where('runId').equals(run.id).toArray()
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async (...args: any[]) => {
      if (args[0].type === 'run.cancelled') throw new DOMException('隔离测试：修订拒绝终态写入故障', 'QuotaExceededError')
      return add(...args)
    }
    return { runId: run.id, chapters, events }
  })
  await page.getByRole('button', { name: '放弃修订', exact: true }).click()
  await expect(page.getByText(/修订拒绝终态写入故障/)).toBeVisible()
  await expect(preview).toContainText('复核已返回')
  const read = async () => page.evaluate(async runId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { status: (await db.agentRuns.get(runId)).status, chapters: await db.chapters.toArray(), events: await db.agentRunEvents.where('runId').equals(runId).toArray() }
  }, before.runId)
  expect(await read()).toEqual({ status: 'awaiting_confirmation', chapters: before.chapters, events: before.events })
  await page.reload(); await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await expect(preview).toContainText('复核已返回')
  await page.getByRole('button', { name: '放弃修订', exact: true }).click()
  await expect(preview).toContainText('已放弃，原稿保留。')
  await expect(page.getByRole('button', { name: '确认采纳修订', exact: true })).toHaveCount(0)
  const final = await read()
  expect(final.status).toBe('cancelled'); expect(final.chapters).toEqual(before.chapters)
  for (const type of ['confirmation.recorded', 'run.cancelled', 'memory.settlement.recorded']) expect(final.events.filter((event: any) => event.type === type)).toHaveLength(1)
  expect(state.calls).toHaveLength(3)
})

test('作者勾选问题→范围修订→一次复核→刷新对照→正式采纳，原稿格式和预算真实生效', async ({ page }) => {
  const state = { calls: [] as any[] }; await mock(page, state)
  const target = await setup(page)
  const reviewRequest = '核对结尾任务说明，保留签字事件和当前金额。'
  const revisionRequest = '只移除选中段的任务说明，保留签字动作和第一段加粗。'
  await reviewAndRevise(page, { review: reviewRequest, revision: revisionRequest })
  const preview = page.getByTestId('quality-revision-preview')
  await expect(preview).toContainText('模型认为已有改善')
  await expect(page.locator('.tiptap-editor')).toContainText('正文到此结束')
  expect(state.calls).toHaveLength(3)
  expect(state.calls[0].messages[1].content).toContain(reviewRequest)
  state.calls.forEach(body => { expect(body.stream).toBe(false); expect(body.response_format).toEqual({ type: 'json_object' }) })
  expect(state.calls[1].messages[1].content).toContain('余额三点，金额一百二十。')
  expect(state.calls[1].messages[1].content).toContain('保留金额与余额')
  expect(state.calls[2].messages[1].content).toContain('保留金额与余额')
  expect(state.calls[1].messages[1].content).toContain(revisionRequest)
  expect(state.calls[2].messages[1].content).toContain(revisionRequest)
  await page.reload()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('模型认为已有改善')
  await page.getByText('这份报告使用的作者要求', { exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report').getByText(reviewRequest, { exact: true })).toBeVisible()
  await page.getByText('这次修订使用的作者要求', { exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview').getByText(revisionRequest, { exact: true })).toBeVisible()
  expect(state.calls).toHaveLength(3)
  await page.getByRole('button', { name: '确认采纳修订', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).not.toContainText('正文到此结束')
  await expect(page.locator('.tiptap-editor strong')).toHaveText('余额三点，金额一百二十。')
  const saved = await page.evaluate(async id => { const imp = new Function('path', 'return import(path)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts'); return (await db.chapters.get(id)).content }, target.chapterId)
  expect(saved).toBe('<p><strong>余额三点，金额一百二十。</strong></p><p>陈禾签下名字。</p>')
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toContainText('陈禾签下名字。')
  expect(state.calls).toHaveLength(3)
})

test('删除完整末段后复核、刷新和采纳可用，未选原文与加粗不变', async ({ page }) => {
  const state = { calls: [] as any[], removeWholeParagraph: true }
  await mock(page, state)
  const target = await setup(page, true)
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('结尾有任务说明')
  await page.getByRole('checkbox', { name: '处理第3段问题', exact: true }).check()
  await page.getByRole('button', { name: '生成修订并复核', exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('模型认为已有改善')
  await expect(page.locator('.tiptap-editor')).toContainText('这是多余的总结段。')
  await page.reload()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('模型认为已有改善')
  await page.getByRole('button', { name: '确认采纳修订', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).not.toContainText('这是多余的总结段。')
  await expect(page.locator('.tiptap-editor')).toContainText('陈禾签下名字，正文到此结束。')
  await expect(page.locator('.tiptap-editor strong')).toHaveText('余额三点，金额一百二十。')
  const saved = await page.evaluate(async id => { const { db } = await import('/storyforge/src/lib/db/schema.ts'); return (await db.chapters.get(id)).content }, target.chapterId)
  expect(saved).toContain('<p>陈禾签下名字，正文到此结束。</p>')
  await page.reload()
  await expect(page.locator('.tiptap-editor')).not.toContainText('这是多余的总结段。')
  expect(state.calls).toHaveLength(3)
})

test('同一作品两个页面同时发起修订，第二页明确拒绝且不发送第二轮请求', async ({ page, context }) => {
  let release!: () => void
  const state = { calls: [] as any[], gate: new Promise<void>(resolve => { release = resolve }) }
  await mock(page, state)
  const target = await setup(page)
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('结尾有任务说明')
  const second = await context.newPage(); await mock(second, state)
  await second.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await second.getByRole('button', { name: '质量审校', exact: true }).click()
  await second.getByRole('button', { name: '审校', exact: true }).click()
  await expect(second.getByTestId('whole-chapter-quality-report')).toContainText('结尾有任务说明')
  await page.getByRole('checkbox', { name: '处理第2段问题', exact: true }).check()
  await page.getByRole('button', { name: '生成修订并复核', exact: true }).click()
  await expect.poll(() => state.calls.length).toBe(2)
  await second.getByRole('checkbox', { name: '处理第2段问题', exact: true }).check()
  await second.getByRole('button', { name: '生成修订并复核', exact: true }).click()
  await expect(second.getByText('另一页面正在修订本章，请等待该次运行结束。')).toBeVisible()
  expect(state.calls).toHaveLength(2)
  release()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('模型认为已有改善')
  expect(state.calls).toHaveLength(3)
  await second.close()
})

test('复核503保留只读预演，原稿不改，刷新不重发且无采纳按钮', async ({ page }) => {
  const state = { calls: [] as any[] }; await mock(page, state, true)
  await setup(page); await reviewAndRevise(page)
  await expect(page.getByTestId('quality-revision-preview')).toContainText('复核未完成')
  await expect(page.getByRole('button', { name: '确认采纳修订', exact: true })).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toContainText('正文到此结束')
  expect(state.calls).toHaveLength(3)
  await page.reload(); await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('复核未完成')
  expect(state.calls).toHaveLength(3)
})
