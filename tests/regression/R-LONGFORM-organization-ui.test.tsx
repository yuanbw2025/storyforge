import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ChapterOrganizationModal from '../../src/components/editor/ChapterOrganizationModal'
import { parseChapterOrganizationOutput, type ChapterOrganizationRun } from '../../src/lib/agent/chapter-organization'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { coordinatePendingEditV1, flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => resetPendingEditCoordinatorForTestsV1())

it('空候选允许明确结束，故事线三个分区显示各自用途', async () => {
  const candidate = parseChapterOrganizationOutput({
    raw: '{}', projectId: 1, chapterId: 2, chapterTitle: '夜信', worldGroupId: null,
    chapterText: '灯灭了。', sourceTextHash: 'test-only', characters: [], existingRelations: [],
    foreshadows: [], budget: new AgentTeamBudgetTracker('balanced').snapshot(),
  })!
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const apply = vi.fn()
  try {
    await act(async () => root.render(createElement(ChapterOrganizationModal, {
      run: { candidate } as ChapterOrganizationRun,
      current: true, busy: false, error: '', onSelectionChange: vi.fn(), onApply: apply, onClose: vi.fn(), onRerun: vi.fn(),
    })))
    const headings = [...host.querySelectorAll('h4')].map(node => node.textContent)
    expect(headings).toEqual(expect.arrayContaining(['故事线推进', '故事线交汇', '新故事线候选']))
    const button = [...host.querySelectorAll('button')].find(node => node.textContent === '本次不写入')!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(apply).toHaveBeenCalledOnce()
    expect(Object.values(apply.mock.calls[0][0]).every(value => Array.isArray(value) && value.length === 0)).toBe(true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

async function mountSelectionModal(save: (selection: any) => Promise<ChapterOrganizationRun>, damagedSelection = false) {
  const candidate = parseChapterOrganizationOutput({
    raw: JSON.stringify({ inventoryEvents: [{ itemName: '钥匙', heldByName: '林舟', action: 'gain', quantity: 1, note: '拾起', sourceQuote: '林舟拾起钥匙。' }] }),
    projectId: 1, chapterId: 2, chapterTitle: '潮门', worldGroupId: null,
    chapterText: '林舟拾起钥匙。', sourceTextHash: 'isolated-test', characters: [], existingRelations: [], foreshadows: [], budget: new AgentTeamBudgetTracker('balanced').snapshot(),
  })!
  if (damagedSelection) candidate.authorSelection = {} as any
  const run = { candidate } as ChapterOrganizationRun
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), close = vi.fn(), apply = vi.fn(), rerun = vi.fn()
  await act(async () => root.render(createElement(ChapterOrganizationModal, { run, current: true, busy: false, error: '', onSelectionChange: save, onClose: close, onApply: apply, onRerun: rerun })))
  const button = (text: string) => [...host.querySelectorAll('button')].find(node => node.textContent?.includes(text))!
  return { host, root, close, apply, rerun, run, button, checkbox: host.querySelector<HTMLInputElement>('input[type="checkbox"]')!, cleanup: async () => { await act(async () => root.unmount()); host.remove() } }
}

it('等待选择写入确认期间暂停关闭、重新生成和采纳，保存屏障等待同一次请求', async () => {
  let acknowledge!: (run: ChapterOrganizationRun) => void
  const pending = new Promise<ChapterOrganizationRun>(resolve => { acknowledge = resolve })
  const save = vi.fn(() => pending), ui = await mountSelectionModal(save)
  try {
    await act(async () => ui.checkbox.click())
    expect(ui.checkbox.checked).toBe(false)
    expect(ui.host.querySelector<HTMLButtonElement>('[aria-label="关闭整理本章"]')!.disabled).toBe(true)
    expect(ui.button('重新整理').disabled).toBe(true)
    expect(ui.button('本次不写入').disabled).toBe(true)
    let completed = false
    const barrier = flushPendingEditsV1().then(() => { completed = true })
    await Promise.resolve(); expect(completed).toBe(false)
    await act(async () => { acknowledge(ui.run); await barrier })
    expect(completed).toBe(true)
    expect(ui.button('本次不写入').disabled).toBe(false)
    expect(save).toHaveBeenCalledOnce()
  } finally { await ui.cleanup() }
})

it('失败保留未保存的选择，明确重试成功后才能继续', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('选择磁盘写入失败')).mockResolvedValueOnce({} as ChapterOrganizationRun)
  const ui = await mountSelectionModal(save)
  try {
    await act(async () => ui.checkbox.click())
    expect(ui.host.textContent).toContain('选择磁盘写入失败')
    expect(ui.checkbox.checked).toBe(false)
    expect(ui.button('本次不写入').disabled).toBe(true)
    await expect(flushPendingEditsV1()).rejects.toThrow('选择磁盘写入失败')
    await act(async () => ui.button('重试保存选择').click())
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0])
    expect(ui.checkbox.checked).toBe(false)
    expect(ui.button('本次不写入').disabled).toBe(false)
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  } finally { await ui.cleanup() }
})

it('明确放弃只确认本次失败，不清掉另一条作者保存错误', async () => {
  const ui = await mountSelectionModal(() => coordinatePendingEditV1({ key: 'test-organization-selection', persist: async () => { throw new Error('本次选择保存失败') } }))
  try {
    await act(async () => ui.checkbox.click())
    await expect(coordinatePendingEditV1({ key: 'test-other-author-edit', persist: async () => { throw new Error('另一条保存失败') } })).rejects.toThrow()
    await act(async () => ui.button('放弃未保存选择并关闭').click())
    expect(ui.close).toHaveBeenCalledOnce()
    await ui.cleanup()
    await expect(flushPendingEditsV1()).rejects.toThrow('另一条保存失败')
  } finally { if (ui.host.isConnected) await ui.cleanup() }
})

it('损坏选择显示恢复入口，必须明确清空后才能重新勾选', async () => {
  const save = vi.fn().mockResolvedValue({} as ChapterOrganizationRun)
  const ui = await mountSelectionModal(save, true)
  try {
    expect(ui.host.textContent).toContain('保存的勾选格式异常')
    expect(ui.checkbox.checked).toBe(false)
    expect(ui.checkbox.disabled).toBe(true)
    expect(save).not.toHaveBeenCalled()
    await act(async () => ui.button('清空无效勾选并重新选择').click())
    expect(Object.values(save.mock.calls[0][0]).every(value => Array.isArray(value) && value.length === 0)).toBe(true)
    expect(ui.checkbox.disabled).toBe(false)
    await act(async () => ui.checkbox.click())
    expect(save.mock.calls[1][0].inventoryEvents).toEqual([0])
  } finally { await ui.cleanup() }
})
