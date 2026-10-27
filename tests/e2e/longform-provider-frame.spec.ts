import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const final = '陈禾决定关灯，核对账本，合上封面，把钥匙放回原处。'.repeat(20)
const raw = `${final}\n</think>\n# 第1章 收店\n${final}`

async function mixedFrame(page: Page) {
  const before = '陈禾决定先核对桌上的账册，把没确认的数字留在原处。'.repeat(20)
  const after = '门口的陈禾转身回到柜台，决定收好工具，合上另一份记录，关灯。'.repeat(20)
  const received = `${before}\n</think>\n${after}`
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', model: 'frame-test', baseUrl: 'https://prose-frame.invalid/v1', temperature: .7, maxTokens: 4000, contextWindow: 128000 })))
  let calls = 0
  await page.route('https://prose-frame.invalid/**', route => { calls++; return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: received }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` }) })
  await createLongform(page, '不同开篇回复核对')
  const target = await page.evaluate(async () => {
    const [{ db }, { resolveScopeLike, stampNewRecord }] = await Promise.all([import('/storyforge/src/lib/db/schema.ts'), import('/storyforge/src/lib/workspace/scope.ts')])
    const project = await db.projects.toCollection().first(), scope = await resolveScopeLike(project!.id!), base = { projectId: project!.id!, createdAt: Date.now(), updatedAt: Date.now() }
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: '收店', summary: '核对记录，在关灯处停笔', order: 0 }, { owner: 'work' }))
    await db.detailedOutlines.add(stampNewRecord(scope, 'detailedOutlines', { ...base, outlineNodeId, scenes: [{ sceneId: 'close', title: '关灯', summary: '核对记录，收好工具，关灯', characterIds: [], location: '', conflict: '', pace: 'medium', estimatedWords: 600, notes: '' }] }, { owner: 'work' }))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...base, outlineNodeId, title: '收店', content: '', wordCount: 0, status: 'outline', order: 0, notes: '' }, { owner: 'work' }))
    return { projectId: project!.id!, outlineNodeId, chapterId }
  })
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await page.locator('[data-workspace-ready=longform]').waitFor()
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(received)
  await expect(page.getByRole('alert').filter({ hasText: '独立分隔符' })).toBeVisible()
  return { target, after, received, calls: () => calls }
}

test('不同开篇也可由作者选取后段，刷新回读选择结果并保留完整原响应，仅一次模型调用', async ({ page }) => {
  const fixture = await mixedFrame(page)
  await page.getByRole('button', { name: '保留分隔后的正文供核对', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(fixture.after)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toContainText(fixture.after)
  await expect(page.locator('.tiptap-editor')).not.toContainText('</think>')
  expect(await page.evaluate(async id => { const { db } = await import('/storyforge/src/lib/db/schema.ts'); return (await db.agentRunArtifacts.where('projectId').equals(id).toArray()).some(row => row.content?.includes('</think>')) }, fixture.target.projectId)).toBe(true)
  expect(fixture.calls()).toBe(1)
})

test('疑似分隔只是作者提示，作者仍可保留全文及字面标签，不强制删除或额外生成', async ({ page }) => {
  const fixture = await mixedFrame(page)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toContainText('</think>')
  expect(await page.evaluate(async id => { const [{ db }, { htmlToPlainText }] = await Promise.all([import('/storyforge/src/lib/db/schema.ts'), import('/storyforge/src/lib/utils/html.ts')]); return htmlToPlainText((await db.chapters.get(id))!.content) }, fixture.target.chapterId)).toBe(fixture.received)
  expect(fixture.calls()).toBe(1)
})

test('重复回复原文保留并阻止直接采纳，作者选择后段后正式写入，刷新不重发', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', model: 'frame-test', baseUrl: 'https://prose-frame.invalid/v1', temperature: .7, maxTokens: 4000, contextWindow: 128000 })))
  let calls = 0
  await page.route('https://prose-frame.invalid/**', route => { calls++; return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: raw }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 1000, total_tokens: 1100 } })}\n\ndata: [DONE]\n\n` }) })
  await createLongform(page, '回复核对隔离实验')
  const target = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const [{ db }, { resolveScopeLike, stampNewRecord }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts')])
    const project = await db.projects.toCollection().first(), scope = await resolveScopeLike(project.id), base = { projectId: project.id, createdAt: Date.now(), updatedAt: Date.now() }
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: '收店', summary: '陈禾核账后关灯，停笔', order: 0 }, { owner: 'work' }))
    await db.detailedOutlines.add(stampNewRecord(scope, 'detailedOutlines', { ...base, outlineNodeId, scenes: [{ sceneId: 'close', title: '关灯', summary: '核对账本，合上封面，把钥匙归位，关灯', characterIds: [], location: '', conflict: '', pace: 'medium', estimatedWords: 600, notes: '不要增加奖励' }] }, { owner: 'work' }))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...base, outlineNodeId, title: '收店', content: '', wordCount: 0, status: 'outline', order: 0, notes: '' }, { owner: 'work' }))
    return { projectId: project.id, outlineNodeId, chapterId }
  })
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await page.locator('[data-workspace-ready=longform]').waitFor()
  await page.getByRole('textbox', { name: '自定义指令...', exact: true }).fill('写600字，只核对后关灯。')
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(raw)
  await expect(page.getByRole('alert').filter({ hasText: '推理分隔符' })).toBeVisible()
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText(/重复了正文/).last()).toBeVisible()
  expect(await page.evaluate(async id => { const [{ db }, { htmlToPlainText }] = await Promise.all([import('/storyforge/src/lib/db/schema.ts'), import('/storyforge/src/lib/utils/html.ts')]); return htmlToPlainText((await db.chapters.get(id))!.content) }, target.chapterId)).toBe('')
  await page.getByRole('button', { name: '保留分隔后的正文供核对', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(`# 第1章 收店\n${final}`)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toContainText(final)
  await expect(page.locator('.tiptap-editor')).not.toContainText('</think>')
  expect(calls).toBe(1)
  expect(await page.evaluate(async id => {
    const { db } = await import('/storyforge/src/lib/db/schema.ts')
    return (await db.agentRunArtifacts.where('projectId').equals(id).toArray()).some(row => row.content?.includes('</think>'))
  }, target.projectId)).toBe(true)
})
