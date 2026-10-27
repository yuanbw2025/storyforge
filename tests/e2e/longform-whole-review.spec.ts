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

test('bounded Agnes review records the exact thinking toggle for all three modes and reloads with no request', async ({ page }) => {
  const requests: any[] = []
  const target = await setup(page)
  await page.evaluate(async () => {
    const { useAIConfigStore } = await (new Function('return import("/storyforge/src/stores/ai-config.ts")'))()
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, provider: 'agnes', model: 'agnes-2.5-flash', apiKey: 'isolated-test-token' } })
  })
  await page.route('https://whole-review.invalid/**', route => {
    const body = route.request().postDataJSON(); requests.push(body)
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(body.response_format).toEqual({ type: 'json_object' })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '本轮只给可定位建议，保留原稿。', strengths: ['保留安静清点'], issues: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  for (const [mode, label] of [['quality', '审校'], ['style', '表达与重复'], ['readability', '追读力']]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('button', { name: '开始检测', exact: true }).click()
    await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('本轮只给可定位建议')
    const settings = await page.evaluate(async ({ target, mode }) => {
      const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const [{ resolveScope }, { readLatestWholeChapterQualityReviewV1 }] = await Promise.all([imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/lib/agent/run/quality-review-durable.ts')])
      return (await readLatestWholeChapterQualityReviewV1({ scope: await resolveScope({ projectId: target.projectId }), chapterId: target.chapterId, mode }))?.report.reviewer.settings
    }, { target, mode })
    expect(settings.parameters.chat_template_kwargs).toEqual(requests.at(-1).chat_template_kwargs)
  }
  expect(requests).toHaveLength(3)
  await page.reload(); await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '追读力', exact: true }).click()
  await expect(page.getByTestId('whole-chapter-quality-report')).toContainText('本轮只给可定位建议')
  expect(requests).toHaveLength(3)
  expect(await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.chapters.get(id)).content
  }, target.chapterId)).toContain(quote)
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

test('一致性专审读取本章计划，支持章内证据并在刷新后保留原稿与报告', async ({ page }) => {
  const requests: any[] = []
  await page.route('https://whole-review.invalid/**', route => {
    requests.push(route.request().postDataJSON())
    const findings = [{ category: '付款依据', severity: 'hard', anchorId: 'p2', quote: '模型改抄的附注不能替代原文',
      evidence: [{ sourceType: 'chapter', sourceId: 0, anchorId: 'p1-1' }],
      reason: '正文中可见的清点动作尚不能证明付款，需核对结算依据。' }]
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings }) }, finish_reason: 'stop' }] }) })
  })
  const target = await setup(page)
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByText(/全文与审计资料超出 Fast Guard 输入预算/)).toBeVisible()
  expect(requests).toHaveLength(0)
  await page.getByRole('button', { name: 'Deep Audit · 因果/动机/伏笔', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByText('正文中可见的清点动作尚不能证明付款，需核对结算依据。', { exact: true })).toBeVisible()
  await expect(page.getByText('附带引文与所选位置不一致，以下已显示原文，请核对意见。', { exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(requests[0].messages[1].content).toContain('清点工具，收款后签收，最后关灯')
  expect(requests[0].messages[1].content).toContain(original)
  expect(requests[0].messages[1].content).toContain('"anchorId":"p2"')
  expect(requests[0].max_tokens).toBe(16000)
  expect(requests[0].stream).toBe(false)
  expect(requests[0].response_format).toEqual({ type: 'json_object' })
  const reviewButton = page.getByRole('button', { name: '质量审校', exact: true })
  await expect(reviewButton).toContainText('1')
  await expect(reviewButton).toHaveAccessibleName('质量审校')
  await page.reload()
  await expect(reviewButton).toContainText('1')
  await expect(reviewButton).toHaveAccessibleName('质量审校')
  await reviewButton.click()
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await expect(page.getByText('正文中可见的清点动作尚不能证明付款，需核对结算依据。', { exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(await page.evaluate(async id => {
    const { db } = await import('/storyforge/src/lib/db/schema.ts')
    return (await db.chapters.get(id))!.content
  }, target.chapterId)).toContain(quote)
  await page.evaluate(async id => {
    const { db } = await import('/storyforge/src/lib/db/schema.ts')
    await db.outlineNodes.update(id, { summary: '作者改为明天结算，今晚只清点。', updatedAt: Date.now() })
  }, target.outlineNodeId)
  await page.reload()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await expect(page.getByText(/正文或作品资料已变化，以下报告已过期/)).toBeVisible()
  expect(requests).toHaveLength(1)
})

test('一致性无效引文显示失败而不是空报告，不自动重发或改稿', async ({ page }) => {
  let calls = 0
  await page.route('https://whole-review.invalid/**', route => {
    calls++
    const findings = [{ category: '虚构', severity: 'hard', quote: '这句不在正文里', evidence: [], reason: '不能丢弃后显示无问题' }]
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings }) }, finish_reason: 'stop' }] }) })
  })
  const target = await setup(page)
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await page.getByRole('button', { name: 'Deep Audit · 因果/动机/伏笔', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByText(/JSON 无法解析或引文、证据无效/)).toBeVisible()
  await expect(page.getByText(/本次未发现可定位的一致性问题/)).toHaveCount(0)
  expect(calls).toBe(1)
  await expect(page.locator('.tiptap-editor')).toContainText(quote)
  expect(await page.evaluate(async target => {
    const { readLatestConsistencyAgentRun } = await import('/storyforge/src/lib/agent/consistency-agent.ts')
    return readLatestConsistencyAgentRun({ projectId: target.projectId, chapterId: target.chapterId })
  }, target)).toBeNull()
})

test('一致性专审503单次停止，不在durable预算外重发', async ({ page }) => {
  let calls = 0
  await page.route('https://whole-review.invalid/**', route => { calls++; return route.fulfill({ status: 503, body: '专审暂时不可用' }) })
  await setup(page)
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await page.getByRole('button', { name: 'Deep Audit · 因果/动机/伏笔', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByText(/503|专审暂时不可用/)).toBeVisible()
  expect(calls).toBe(1)
  await expect(page.getByText(/本次未发现可定位的一致性问题/)).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toContainText(quote)
})

test('一致性专审被截断时即使收到有效空JSON也不认证无问题', async ({ page }) => {
  let calls = 0
  await page.route('https://whole-review.invalid/**', route => {
    calls++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' }, finish_reason: 'length' }] }) })
  })
  await setup(page)
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await page.getByRole('button', { name: 'Deep Audit · 因果/动机/伏笔', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect(page.getByText(/一致性响应未完整结束/)).toBeVisible()
  await expect(page.getByText(/本次未发现可定位的一致性问题/)).toHaveCount(0)
  expect(calls).toBe(1)
})

test('一致性JSON审计中关闭面板会停止等待，刷新不生成报告或自动重发', async ({ page }) => {
  let calls = 0
  await page.route('https://whole-review.invalid/**', async route => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' }, finish_reason: 'stop' }] }) }).catch(() => undefined)
  })
  const target = await setup(page)
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await page.getByRole('button', { name: 'Deep Audit · 因果/动机/伏笔', exact: true }).click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()
  await expect.poll(() => calls).toBe(1)
  await page.getByRole('button', { name: '关闭质量审校', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const { db } = await import('/storyforge/src/lib/db/schema.ts')
    return (await db.agentRuns.where('projectId').equals(id).toArray()).map(run => run.status)
  }, target.projectId)).toContain('paused')
  await page.reload()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await expect(page.getByText(/本次未发现可定位的一致性问题/)).toHaveCount(0)
  expect(calls).toBe(1)
  await expect(page.locator('.tiptap-editor')).toContainText(quote)
})
