import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { Project } from '../../src/lib/types'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'

const mocks = vi.hoisted(() => ({
  work: { id: 11, projectId: 1, worldId: 7, title: '雾港', description: '', genres: ['other'], targetWordCount: 300000 } as any,
  update: vi.fn(async () => undefined),
}))
vi.mock('../../src/hooks/useActiveWork', () => ({ useActiveWork: () => mocks.work }))
vi.mock('../../src/stores/project', () => ({ useProjectStore: () => ({ updateActiveWork: mocks.update, updateWorkspace: vi.fn() }) }))
import ProjectInfoPanel from '../../src/components/project/ProjectInfoPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const project = { id: 1, activeWorldId: 7, activeWorkId: 11, createdAt: 1, updatedAt: 1 } as Project
async function render(selectedProject = project) {
  await act(async () => root.render(createElement(ProjectInfoPanel, { project: selectedProject, onUpdate: () => undefined })))
}
function readDescription() {
  return host.querySelector<HTMLTextAreaElement>('textarea')?.value ?? host.querySelector('[data-markdown-body]')?.textContent
}
async function type(label: string, value: string) {
  if (label === '作品简介' && !host.querySelector('[aria-label="作品简介"]')) {
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[data-markdown-read-view] button')].find(button => button.textContent === '编辑源码')!.click())
  }
  await act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  resetPendingEditCoordinatorForTestsV1()
  mocks.update.mockReset().mockResolvedValue(undefined)
  mocks.work = { id: 11, projectId: 1, worldId: 7, title: '雾港', description: '', genres: ['other'], targetWordCount: 300000 }
  // These draft scheduling cases mock readback as well as the writer. Actual
  // IndexedDB evidence and dishonest writer results are covered in R-050.
  vi.spyOn(db.works, 'get').mockImplementation(() => {
    const last = mocks.update.mock.calls[mocks.update.mock.calls.length - 1] as unknown as [number, object, { projectId: number; workId: number; worldId: number }]
    return Dexie.Promise.resolve(last ? { ...mocks.work, ...last[1], ...last[2], id: last[2].workId, updatedAt: Date.now() } : mocks.work)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.useRealTimers(); resetPendingEditCoordinatorForTestsV1()
  vi.restoreAllMocks()
})

describe('分步骤基本信息防丢保存', () => {
  it('离页屏障保存未点击保存的最新输入，干净表单不产生写入', async () => {
    await render()
    await act(async () => { await flushPendingEditsV1() })
    expect(mocks.update).not.toHaveBeenCalled()
    await type('作品简介', '午夜失去一分钟')
    await type('作品名称', '雾港修钟人')
    await act(async () => { await flushPendingEditsV1() })
    expect(mocks.update).toHaveBeenLastCalledWith(1, expect.objectContaining({ title: '雾港修钟人', description: '午夜失去一分钟' }), { projectId: 1, worldId: 7, workId: 11 })
    expect(host.querySelector('[role="status"]')?.textContent).toBe('已保存到本机')
  })
  it('自动保存失败保留输入并阻止切页，显式重试后解除阻止', async () => {
    await render(); await type('作品简介', '不能丢的草稿')
    mocks.update.mockRejectedValueOnce(new Error('磁盘空间不足'))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('磁盘空间不足')
    expect(readDescription()).toBe('不能丢的草稿')
    mocks.update.mockRejectedValueOnce(new Error('磁盘空间不足'))
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('磁盘空间不足') })
    await act(async () => { await flushPendingEditsV1() })
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.update).toHaveBeenCalledTimes(3)
  })
  it('保存期间继续输入不被旧回读覆盖，离页等待新输入落盘', async () => {
    await render(); await type('作品简介', '第一版')
    let finish!: () => void
    mocks.update.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    await type('作品简介', '第二版')
    mocks.work = { ...mocks.work, description: '第一版' }
    await render()
    expect(readDescription()).toBe('第二版')
    await act(async () => { finish(); await Promise.resolve() })
    expect(host.querySelector('[role="status"]')?.textContent).toContain('有修改')
    await act(async () => { await flushPendingEditsV1() })
    expect(mocks.update).toHaveBeenLastCalledWith(1, expect.objectContaining({ description: '第二版' }), { projectId: 1, worldId: 7, workId: 11 })
  })
  it('作品未加载时禁用编辑且不将空表单覆盖作品', async () => {
    mocks.work = null; await render()
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); await flushPendingEditsV1() })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('keeps a dirty form bound to its original Work when another work becomes active', async () => {
    await render(); await type('作品简介', '只属于雾港的未保存内容')
    mocks.work = { id: 22, worldId: 8, projectId: 2, title: '盐镇', description: '盐镇原简介', genres: ['fantasy'], targetWordCount: 600000 }
    await render({ ...project, id: 2, activeWorldId: 8, activeWorkId: 22 })
    await act(async () => { await flushPendingEditsV1() })
    expect(mocks.update).toHaveBeenLastCalledWith(1, expect.objectContaining({ description: '只属于雾港的未保存内容' }), { projectId: 1, worldId: 7, workId: 11 })
    expect(readDescription()).toBe('盐镇原简介')
  })

  it('does not roll a saved form back to an older Work echo while readback is delayed', async () => {
    // Both observations may share one millisecond; equality is not evidence
    // that the older liveQuery value superseded the committed readback.
    mocks.work.updatedAt = Date.now()
    await render(); await type('作品名称', '已保存的新作品名'); await type('作品简介', '已保存的新简介')
    await act(async () => { await flushPendingEditsV1() })
    expect(host.querySelector<HTMLInputElement>('[aria-label="作品名称"]')?.value).toBe('已保存的新作品名')
    expect(readDescription()).toBe('已保存的新简介')
  })

})
