import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DataManagementPanel from '../../src/components/data/DataManagementPanel'
import { db } from '../../src/lib/db/schema'
import type { Project } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../src/components/data/CloudBackupCard', () => ({
  default: () => createElement('div', { 'data-testid': 'cloud-backup-placeholder' }),
}))

vi.mock('../../src/lib/storage/folder-handle-store', () => ({
  LAST_FOLDER_KEY: 'last',
  projFolderKey: (projectId: number) => `proj-${projectId}`,
  loadFolderHandle: vi.fn(async () => null),
  saveFolderHandle: vi.fn(async () => undefined),
  clearFolderHandle: vi.fn(async () => undefined),
}))

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  await db.delete()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
  throw new Error('Timed out waiting for diagnostics download')
}

describe('HEALTH-4 · 数据管理诊断下载用户路径', () => {
  it('点击后生成隐私诊断 JSON 并给出成功反馈', async () => {
    await db.open()
    const projectId = await db.projects.add({
      name: '不可泄漏书名-SENTINEL',
      apiKey: 'sk-SENTINEL',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never)
    const project = await db.projects.get(projectId) as Project

    let downloadedBlob: Blob | null = null
    const createObjectURL = vi.fn((blob: Blob) => {
      downloadedBlob = blob
      return 'blob:storyforge-diagnostics'
    })
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(createElement(DataManagementPanel, { project })))

    const button = Array.from(host.querySelectorAll('button'))
      .find(candidate => candidate.textContent?.includes('下载诊断信息'))
    expect(button).toBeDefined()
    await act(async () => button!.click())
    await waitFor(() => host.textContent?.includes('诊断信息已下载') === true)

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(downloadedBlob).not.toBeNull()
    expect(downloadedBlob!.type).toBe('application/json;charset=utf-8')
    const reportText = await downloadedBlob!.text()
    expect(reportText).toContain('"format": "storyforge-local-diagnostics"')
    expect(reportText).toContain('"includesRecordContents": false')
    expect(reportText).not.toContain('不可泄漏书名-SENTINEL')
    expect(reportText).not.toContain('sk-SENTINEL')
    expect(host.textContent).toContain('不含作品内容与 API Key')
  })
})
