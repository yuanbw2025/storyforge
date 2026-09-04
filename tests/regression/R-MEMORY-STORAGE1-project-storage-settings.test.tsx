import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../../src/components/settings/SettingsPage'
import type { Project } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const storageMocks = vi.hoisted(() => ({
  selected: { name: 'D盘小说项目', kind: 'directory' } as FileSystemDirectoryHandle,
  load: vi.fn(async () => null as FileSystemDirectoryHandle | null),
  clear: vi.fn(async () => undefined),
  bind: vi.fn(async () => undefined),
  pick: vi.fn(),
}))

storageMocks.pick.mockImplementation(async () => storageMocks.selected)

vi.mock('../../src/components/settings/AIConfigPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'ai-config-placeholder' }),
}))
vi.mock('../../src/components/settings/CreativeReliabilityCommunityPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'community-placeholder' }),
}))
vi.mock('../../src/components/settings/HarnessEvalPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'harness-placeholder' }),
}))
vi.mock('../../src/lib/storage/folder-backup', () => ({
  isFSASupported: () => true,
  pickFolder: storageMocks.pick,
  ensureFolderPermission: vi.fn(async () => true),
  folderPermissionGranted: vi.fn(async () => true),
}))
vi.mock('../../src/lib/storage/folder-handle-store', () => ({
  loadProjectFolderHandle: storageMocks.load,
  clearProjectFolderHandle: storageMocks.clear,
}))
vi.mock('../../src/lib/storage/project-storage-workspace', () => ({
  bindProjectStorageWorkspace: storageMocks.bind,
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

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
  throw new Error('Timed out waiting for project storage settings')
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  storageMocks.load.mockReset().mockResolvedValue(null)
  storageMocks.clear.mockClear()
  storageMocks.bind.mockClear()
  storageMocks.pick.mockReset().mockResolvedValue(storageMocks.selected)
})

describe('MEMORY-STORAGE-1 · 项目存储工作区设置', () => {
  const project = {
    id: 7,
    name: '项目存储设置验收',
    workspaceUid: 'WS-00000000-0000-4000-8000-000000000007',
    workspacePurpose: 'independent-work',
    activeWorldId: 11,
    activeWorkId: 12,
    createdAt: 1,
    updatedAt: 1,
  } as Project

  it('设置页为当前项目选择任意文件夹，绑定本身零写盘，并提供人工核对入口', async () => {
    const openDataManagement = vi.fn()
    const host = await mount(createElement(SettingsPage, { project, onOpenDataManagement: openDataManagement }))
    await waitFor(() => host.textContent?.includes('尚未设置项目文件夹') === true)

    const choose = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('选择项目文件夹'))!
    await act(async () => choose.click())

    expect(storageMocks.bind).toHaveBeenCalledWith(project, storageMocks.selected)
    expect(host.textContent).toContain('D盘小说项目')
    expect(host.textContent).toContain('尚未写入任何文件')
    const sync = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('核对与同步'))!
    await act(async () => sync.click())
    expect(openDataManagement).toHaveBeenCalledOnce()
  })

  it('全局设置没有当前项目时不伪造硬盘位置', async () => {
    const host = await mount(createElement(SettingsPage))
    expect(host.textContent).toContain('请先进入一个项目')
    expect(storageMocks.bind).not.toHaveBeenCalled()
  })
})
