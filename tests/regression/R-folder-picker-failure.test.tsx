import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickFolder } from '../../src/lib/storage/folder-backup'
import ProjectStorageFolderField from '../../src/components/shared/ProjectStorageFolderField'
import ProjectStorageWorkspacePanel from '../../src/components/settings/ProjectStorageWorkspacePanel'
import type { Project } from '../../src/lib/types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const stored = vi.hoisted(() => ({
  load: vi.fn(),
  bind: vi.fn(),
}))
vi.mock('../../src/lib/storage/folder-handle-store', () => ({
  loadProjectFolderHandle: stored.load,
  clearProjectFolderHandle: vi.fn(),
}))
vi.mock('../../src/lib/storage/project-storage-workspace', () => ({
  bindProjectStorageWorkspace: stored.bind,
}))

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function mount(element: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}
async function click(host: HTMLElement, label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === label)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
  expect(button.disabled).toBe(false)
}
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount())
    host.remove()
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  stored.load.mockReset()
  stored.bind.mockReset()
})

describe('目录选择失败与作者取消的边界（#300）', () => {
  it.each(['NotAllowedError', 'SecurityError', 'NotReadableError'])('%s 必须传给界面，不能伪装成取消', async name => {
    const failure = new DOMException('合成目录选择失败', name)
    vi.stubGlobal('showDirectoryPicker', vi.fn().mockRejectedValue(failure))
    await expect(pickFolder()).rejects.toBe(failure)
  })

  it('取消返回 null；成功仍传递原句柄和冻结的选择参数', async () => {
    const handle = { name: '已授权目录', kind: 'directory' } as FileSystemDirectoryHandle
    const picker = vi.fn().mockRejectedValueOnce(new DOMException('取消', 'AbortError')).mockResolvedValueOnce(handle)
    vi.stubGlobal('showDirectoryPicker', picker)
    await expect(pickFolder()).resolves.toBeNull()
    await expect(pickFolder({ id: 'storyforge-project-location', startIn: handle })).resolves.toBe(handle)
    expect(picker.mock.calls[1]).toEqual([{ mode: 'readwrite', id: 'storyforge-project-location', startIn: handle }])
  })

  it('设置页显示失败、保留原位置且不绑定，随后作者可以再点击成功选择', async () => {
    const original = { name: '原目录', kind: 'directory' } as FileSystemDirectoryHandle
    const selected = { name: '新目录', kind: 'directory' } as FileSystemDirectoryHandle
    stored.load.mockResolvedValue(original)
    const picker = vi.fn().mockRejectedValueOnce(new DOMException('合成权限拒绝', 'NotAllowedError')).mockResolvedValueOnce(selected)
    vi.stubGlobal('showDirectoryPicker', picker)
    const host = await mount(createElement(ProjectStorageWorkspacePanel, { project: { id: 7 } as Project }))
    await click(host, '更换位置')
    expect(host.textContent).toContain('保存位置失败：合成权限拒绝')
    expect(host.textContent).toContain('原目录')
    expect(stored.bind).not.toHaveBeenCalled()
    expect(picker).toHaveBeenCalledTimes(1)
    await click(host, '更换位置')
    expect(stored.bind).toHaveBeenCalledWith({ id: 7 }, selected)
    expect(host.textContent).toContain('新位置尚未写入')
    expect(host.textContent).not.toContain('保存位置失败')
  })

  it('新建入口取消不换位置、不报错；非取消失败显示提示且可再选', async () => {
    const original = { name: '原目录', kind: 'directory' } as FileSystemDirectoryHandle
    const selected = { name: '新目录', kind: 'directory' } as FileSystemDirectoryHandle
    const picker = vi.fn().mockRejectedValueOnce(new DOMException('取消', 'AbortError'))
      .mockRejectedValueOnce(new DOMException('合成系统失败', 'NotReadableError')).mockResolvedValueOnce(selected)
    vi.stubGlobal('showDirectoryPicker', picker)
    const onChange = vi.fn()
    const host = await mount(createElement(ProjectStorageFolderField, { value: original, onChange }))
    await click(host, '更换文件夹')
    expect(host.textContent).not.toContain('选择文件夹失败')
    expect(onChange).not.toHaveBeenCalled()
    await click(host, '更换文件夹')
    expect(host.textContent).toContain('选择文件夹失败：合成系统失败')
    expect(host.textContent).toContain('已选择：原目录')
    expect(onChange).not.toHaveBeenCalled()
    await click(host, '更换文件夹')
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(selected)
    expect(host.textContent).not.toContain('选择文件夹失败')
  })

  it.each([null, '合成非 Error 拒绝'])('不规范的拒绝值 %s 也由两个绑定入口接住', async failure => {
    stored.load.mockResolvedValue(null)
    vi.stubGlobal('showDirectoryPicker', vi.fn().mockRejectedValue(failure))
    const onChange = vi.fn()
    const field = await mount(createElement(ProjectStorageFolderField, { value: null, onChange }))
    const settings = await mount(createElement(ProjectStorageWorkspacePanel, { project: { id: 7 } as Project }))
    await click(field, '选择项目文件夹')
    await click(settings, '选择项目文件夹')
    expect(field.textContent).toContain('选择文件夹失败：请重试或检查系统权限。')
    expect(settings.textContent).toContain('保存位置失败：请重试或检查系统权限。')
    expect(onChange).not.toHaveBeenCalled()
    expect(stored.bind).not.toHaveBeenCalled()
  })
})
