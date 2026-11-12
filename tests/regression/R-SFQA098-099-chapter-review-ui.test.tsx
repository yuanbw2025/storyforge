import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const complete = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/agent/formal-ai-entry', () => ({ executeRegisteredAIEntryV1: complete }))

import ChapterReviewDialog from '../../src/components/outline/ChapterReviewDialog'
import { reviewChapterOutlines, rewriteChapterOutline } from '../../src/lib/outline/chapter-reviewer'
import { adoptOutlineReview, freezeOutlineReviewTarget } from '../../src/lib/outline/review-adoption'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { OutlineNode } from '../../src/lib/types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const original = '保留开头。\n带走旧信。\n保留结尾。'
const issue = { id: 'issue-1', issueType: 'logic' as const, severity: 'high' as const, description: '信应当留下', affectedChapters: [0], suggestion: '留下旧信' }
const chapters = [{ index: 0, title: '旧信', summary: original }]
const report = JSON.stringify({ summary: '核对旧信', issues: [issue] })
const rewrite = JSON.stringify({ originalSummary: original, revisedSummary: '模型漏句不作为最终正文', summary: '修改两处', changes: [
  { id: 'change-1', chapterIndex: 0, before: '带走旧信。', after: '留下旧信。\n交给林。', reason: '保留线索' },
  { id: 'change-2', chapterIndex: 0, before: '保留结尾。', after: '改变结尾。', reason: '另一处建议' },
] })

let root: Root
let host: HTMLDivElement
let fixture: Awaited<ReturnType<typeof seedCurrentWorkspace>>
let node: OutlineNode
const apply = vi.fn()

function button(label: string) {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  if (!result) throw new Error(`missing button ${label}`)
  return result
}
async function click(label: string) { await act(async () => { button(label).click() }) }
async function until(test: () => boolean) {
  for (let i = 0; i < 100 && !test(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(test()).toBe(true)
}

beforeEach(async () => {
  complete.mockReset(); apply.mockReset()
  await db.delete(); await db.open()
  fixture = await seedCurrentWorkspace('SFQA098099隔离数据')
  const parentId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
  const row = stampNewRecord(fixture.scope, 'outlineNodes', { parentId, type: 'chapter', title: '旧信', summary: original, order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode
  node = { ...row, id: await db.outlineNodes.add(row) }
  apply.mockImplementation(async (_index, summary, target) => { await adoptOutlineReview(target, fixture.project.id!, summary) })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(createElement(ChapterReviewDialog, {
    open: true, onClose: vi.fn(), chapters, onApplyRewrite: apply,
    onReview: () => reviewChapterOutlines(chapters),
    onRewrite: async selected => {
      const target = await freezeOutlineReviewTarget(node)
      return { ...await rewriteChapterOutline(chapters, selected), target }
    },
  })))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close() })

describe('SFQA-098/099 · actual review dialog and governed persistence', () => {
  it('does not turn model praise in an empty report into a product quality certification', async () => {
    const raw = '{"summary":"章纲逻辑与设定完全匹配，质量通过","issues":[]}'
    complete.mockResolvedValue(raw)
    await click('开始诊断')
    expect(host.querySelector('[data-testid=chapter-review-summary]')?.textContent?.trim()).toBe('本次诊断未定位到问题，请继续核对原稿。')
    expect(host.querySelector('pre')?.textContent).toBe(raw)
    expect(apply).not.toHaveBeenCalled()
  })

  it.each(['', 'invalid json', '{"summary":"完成","issues":null}'])('shows %j as failure; only explicit retry makes another call and retains the failed raw response', async raw => {
    complete.mockResolvedValueOnce(raw).mockResolvedValueOnce('{"summary":"本次未定位到问题","issues":[]}')
    await click('开始诊断')
    expect(host.querySelector('[role=alert]')?.textContent).toContain('诊断失败')
    expect(host.textContent).not.toContain('诊断完成 ✓')
    expect(host.textContent).not.toContain('匹配良好')
    expect(host.querySelector('pre')?.textContent).toBe(raw || '（空响应）')
    expect(complete).toHaveBeenCalledTimes(1)
    await click('开始诊断')
    expect(host.textContent).toContain('本次诊断未定位到问题')
    expect(host.textContent).not.toContain('匹配良好')
    expect(host.querySelector('pre')?.textContent).toBe(raw || '（空响应）')
    expect(complete).toHaveBeenCalledTimes(2)
    expect(apply).not.toHaveBeenCalled()
  })

  it.each(['HTTP 401', 'HTTP 402', '结果未知', '已取消'])('shows %s without success or implicit retry', async message => {
    complete.mockRejectedValue(new Error(message))
    await click('开始诊断')
    expect(host.querySelector('[role=alert]')?.textContent).toContain(message)
    expect(host.textContent).not.toContain('诊断完成 ✓')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('uses the exact same system baseline for selected preview and persisted canon', async () => {
    complete.mockResolvedValueOnce(report).mockResolvedValueOnce(rewrite)
    await click('开始诊断'); await click('AI 智能修复')
    await until(() => Boolean(host.querySelector('[role=checkbox]')))
    await act(async () => { (host.querySelectorAll('[role=checkbox]')[1] as HTMLElement).click() })
    const expected = '保留开头。\n留下旧信。\n交给林。\n保留结尾。'
    expect(host.querySelector('[data-testid=chapter-review-preview]')?.textContent).toBe(expected)
    await click('应用选中修改')
    await until(() => host.textContent?.includes('已应用到：') ?? false)
    expect((await db.outlineNodes.get(node.id!))?.summary).toBe(expected)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('retains candidate and selection when target CAS rejects newer author text', async () => {
    complete.mockResolvedValueOnce(report).mockResolvedValueOnce(rewrite)
    await click('开始诊断'); await click('AI 智能修复')
    await until(() => Boolean(host.querySelector('[role=checkbox]')))
    await act(async () => { (host.querySelectorAll('[role=checkbox]')[1] as HTMLElement).click() })
    await db.outlineNodes.update(node.id!, { summary: '作者的新稿，不能覆盖。' })
    await click('应用选中修改')
    await until(() => host.querySelector('[role=alert]')?.textContent?.includes('CAS') ?? false)
    expect((await db.outlineNodes.get(node.id!))?.summary).toBe('作者的新稿，不能覆盖。')
    expect(host.querySelectorAll('[role=checkbox]')[1]?.getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).not.toContain('已应用到：')
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('retains the previous candidate, selection and failed raw output after an invalid explicit rewrite', async () => {
    const invalid = rewrite.replace('保留开头。', '模型改写开头。')
    complete.mockResolvedValueOnce(report).mockResolvedValueOnce(rewrite).mockResolvedValueOnce(invalid)
    await click('开始诊断'); await click('AI 智能修复')
    await until(() => Boolean(host.querySelector('[role=checkbox]')))
    await act(async () => { (host.querySelectorAll('[role=checkbox]')[1] as HTMLElement).click() })
    const preview = host.querySelector('[data-testid=chapter-review-preview]')?.textContent
    await click('重改')
    await until(() => Boolean(host.querySelector('[role=alert]')))
    expect(host.querySelector('[role=alert]')?.textContent).toContain('原摘要')
    expect(host.querySelector('pre')?.textContent).toBe(invalid)
    expect(host.querySelector('[data-testid=chapter-review-preview]')?.textContent).toBe(preview)
    expect(host.querySelectorAll('[role=checkbox]')[1]?.getAttribute('aria-checked')).toBe('false')
    expect((await db.outlineNodes.get(node.id!))?.summary).toBe(original)
    expect(complete).toHaveBeenCalledTimes(3)
  })
})
