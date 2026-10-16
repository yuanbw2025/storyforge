import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page, revision = false) {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', model: 'node-quality-test', baseUrl: 'https://node-quality.invalid/v1', temperature: .7, maxTokens: 4000, contextWindow: 128000 })))
  await createLongform(page, '节点同源审修')
  const target = await page.evaluate(async revision => {
    const imp = new Function('p', 'return import(p)')
    const [{ db }, { resolveScope, stampNewRecord }, { normalizeRichEditorHTMLV1 }, catalog, { useNodeFlowStore }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/lib/editor/rich-editor-schema.ts'), imp('/storyforge/src/lib/node-authoring/index.ts'), imp('/storyforge/src/stores/node-flow.ts')])
    const project = await db.projects.toCollection().first(); const scope = await resolveScope({ projectId: project.id })
    const base = { projectId: project.id, createdAt: Date.now(), updatedAt: Date.now() }
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: '签字', summary: '保留金额一百二十与签字，签字处停笔', order: 0 }, { owner: 'work' }))
    const sourceHtml = normalizeRichEditorHTMLV1('<p><strong>金额一百二十。</strong></p><p>陈禾签字，正文到此结束。</p>')
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...base, outlineNodeId, title: '签字', content: sourceHtml, wordCount: 25, order: 0, status: 'draft', notes: '' }, { owner: 'work' }))
    const node = (templateId: string, id: string, x: number, config: any) => {
      const template = catalog.AUTHORING_NODE_BY_ID.get(templateId)
      return { id, templateId, templateVersion: 1, title: template.label, x, y: id === 'max' ? 250 : 50, config: { ...catalog.defaultConfigForTemplate(template), ...config }, inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
    }
    await useNodeFlowStore.getState().createFlow(project.id, null, { name: '全文审修图', graph: { ...catalog.emptyAuthoringGraph(), nodes: [node('control.temperature', 'temp', 20, { value: 0 }), node('control.max-tokens', 'max', 20, { value: 3200 }), node('chapter.quality-review', 'review', 340, { chapterTitle: '签字' }), ...(revision ? [node('chapter.quality-revision', 'repair', 660, { chapterTitle: '签字' })] : [])], edges: [{ id: 'e-temp', sourceNodeId: 'temp', sourcePortId: 'value', targetNodeId: 'review', targetPortId: 'temperature' }, { id: 'e-max', sourceNodeId: 'max', sourcePortId: 'value', targetNodeId: 'review', targetPortId: 'max-tokens' }, ...(revision ? [{ id: 'e-report', sourceNodeId: 'review', sourcePortId: 'report', targetNodeId: 'repair', targetPortId: 'report' }, { id: 'e-repair-temp', sourceNodeId: 'temp', sourcePortId: 'value', targetNodeId: 'repair', targetPortId: 'temperature' }, { id: 'e-repair-max', sourceNodeId: 'max', sourcePortId: 'value', targetNodeId: 'repair', targetPortId: 'max-tokens' }] : [])] } })
    return { projectId: project.id, chapterId, outlineNodeId, sourceHtml }
  }, revision)
  await openLongformLeaf(page, '节点模式')
  await expect(page.getByLabel('节点图名称')).toHaveValue('全文审修图')
  await page.locator('[data-authoring-node-template="chapter.quality-review"]').click()
  return target
}

function mock(page: Page, calls: any[], fail = false) {
  return page.route('https://node-quality.invalid/**', async route => {
    const body = route.request().postDataJSON(); calls.push(body)
    if (fail) return route.fulfill({ status: 503, body: '服务暂时不可用' })
    const system = body.messages[0].content
    let data: any
    if (system.includes('你只能替换允许范围')) data = { edits: [{ spanId: 'p2.1', replacement: '陈禾签字。' }] }
    else if (system.includes('本轮只复核一次')) {
      const issues = JSON.parse(body.messages[1].content.match(/【冻结计划 [^\n]+】\n([^\n]+)/)[1])
      data = { review: { summary: '签字保留，任务说明已移除', strengths: [], issues: [] }, outcomes: [{ issueId: issues[0].id, status: 'improved', quote: '陈禾签字。', reason: '签字动作保留且未混入说明' }] }
    } else data = { summary: '结尾混入任务说明', strengths: ['金额保留'], issues: [{ dimension: 'voice', confidence: 'suggestion', quote: '正文到此结束。', start: null, end: null, reason: '任务语言混入正文', suggestion: '保留签字，移除说明' }] }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) })
  })
}

test('节点全文审校→共享选题修订→刷新→采纳，分步骤回读同一手稿与格式，实际参数一致', async ({ page }) => {
  const calls: any[] = []; await mock(page, calls)
  const target = await setup(page)
  await expect(page.getByRole('button', { name: '查看问题并修订本章', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect(page.getByLabel('候选输出')).toHaveValue(/结尾混入任务说明/)
  await expect(page.getByLabel('候选输出')).toHaveJSProperty('readOnly', true)
  await expect(page.getByRole('button', { name: '查看问题并修订本章', exact: true })).toBeEnabled()
  await page.reload(); await page.locator('[data-authoring-node-template="chapter.quality-review"]').click()
  await page.getByRole('button', { name: '查看问题并修订本章', exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('结尾混入任务说明')
  await page.getByRole('checkbox', { name: '处理第2段问题', exact: true }).check()
  const revisionRequest = '保留签字和金额，仅移除选中段的任务说明。'
  await page.getByRole('textbox', { name: '本轮修稿要求', exact: true }).fill(revisionRequest)
  await page.getByRole('button', { name: '生成修订并复核', exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('模型认为已有改善')
  expect(calls[1].messages[1].content).toContain(revisionRequest)
  expect(calls[2].messages[1].content).toContain(revisionRequest)
  expect(await page.evaluate(async id => { const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts'); return (await db.chapters.get(id)).content }, target.chapterId)).toBe(target.sourceHtml)
  await page.getByRole('button', { name: '确认采纳修订', exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('已采纳，记录只读')
  await page.getByRole('button', { name: '关闭质量审校', exact: true }).click()
  await page.getByRole('navigation', { name: '工作台创作方式' }).getByRole('button', { name: '分步骤模式', exact: true }).click()
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await expect(page.locator('.tiptap-editor')).toContainText('陈禾签字。')
  await expect(page.locator('.tiptap-editor')).not.toContainText('正文到此结束')
  await expect(page.locator('.tiptap-editor strong')).toHaveText('金额一百二十。')
  expect(calls).toHaveLength(3)
  expect(calls.every(row => row.temperature === 0 && row.max_tokens === 3200 && row.stream === false && row.response_format.type === 'json_object')).toBe(true)
})

test('节点评审503只有一次实际请求，刷新保留失败，不写正文或自动重发', async ({ page }) => {
  const calls: any[] = []; await mock(page, calls, true); const target = await setup(page)
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect(page.getByText('运行失败', { exact: false }).first()).toBeVisible()
  await page.reload(); await page.locator('[data-authoring-node-template="chapter.quality-review"]').click()
  expect(calls).toHaveLength(1)
  await expect(page.getByRole('button', { name: '查看问题并修订本章', exact: true })).toBeDisabled()
  expect(await page.evaluate(async id => { const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts'); return (await db.chapters.get(id)).content }, target.chapterId)).toBe(target.sourceHtml)
})


test('全文报告连入独立修订节点：作者勾选→一次修订复核→刷新→确认采纳，同一正文跨模式生效', async ({ page }) => {
  const calls: any[] = []; await mock(page, calls); const target = await setup(page, true)
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect(page.getByLabel('候选输出')).toHaveValue(/结尾混入任务说明/)
  await page.locator('[data-authoring-node-template="chapter.quality-revision"]').click()
  await expect(page.getByTestId('node-revision-selection')).toContainText('结尾混入任务说明')
  await page.getByRole('checkbox', { name: '处理第2段问题', exact: true }).check()
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  // A preview exists before recheck completes. Wait for the actual node candidate,
  // then require the verified view; mocked transport does not make durable hashing instantaneous.
  await expect(page.getByLabel('候选输出')).toHaveValue(/陈禾签字。/, { timeout: 30_000 })
  await expect(page.getByTestId('quality-revision-preview')).toContainText('模型认为已有改善')
  expect(calls).toHaveLength(3)
  await page.reload(); await page.locator('[data-authoring-node-template="chapter.quality-revision"]').click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('模型认为已有改善')
  await expect(page.getByLabel('候选输出')).toHaveJSProperty('readOnly', true)
  expect(await page.evaluate(async id => { const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts'); return (await db.chapters.get(id)).content }, target.chapterId)).toBe(target.sourceHtml)
  await page.getByRole('button', { name: '确认采纳', exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('已采纳，记录只读')
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await expect(page.locator('.tiptap-editor strong')).toHaveText('金额一百二十。')
  await expect(page.locator('.tiptap-editor')).toContainText('陈禾签字。')
  await expect(page.locator('.tiptap-editor')).not.toContainText('正文到此结束')
  expect(calls.every(row => row.temperature === 0 && row.max_tokens === 3200)).toBe(true)
})

test('独立修订节点拒绝同一正式候选：刷新只读回决定，不写原稿或重发模型', async ({ page }) => {
  const calls: any[] = []; await mock(page, calls); const target = await setup(page, true)
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect(page.getByLabel('候选输出')).toHaveValue(/结尾混入任务说明/)
  await page.locator('[data-authoring-node-template="chapter.quality-revision"]').click()
  await page.getByRole('checkbox', { name: '处理第2段问题', exact: true }).check()
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect(page.getByLabel('候选输出')).toHaveValue(/陈禾签字。/, { timeout: 30_000 })
  await expect(page.getByTestId('quality-revision-preview')).toContainText('模型认为已有改善')
  await page.getByRole('button', { name: '拒绝候选', exact: true }).click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('已放弃，原稿保留')
  await page.reload(); await page.locator('[data-authoring-node-template="chapter.quality-revision"]').click()
  await expect(page.getByTestId('quality-revision-preview')).toContainText('已放弃，原稿保留')
  expect(calls).toHaveLength(3)
  expect(await page.evaluate(async id => { const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts'); return (await db.chapters.get(id)).content }, target.chapterId)).toBe(target.sourceHtml)
})
