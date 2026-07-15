import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportDocIntro, ImportReusableSessionBanner } from '../../src/components/system/import/ImportDocOverview'
import { ImportPipelineControls } from '../../src/components/system/import/ImportRuntimeView'
import useImportDocumentPreparation from '../../src/components/system/import/useImportDocumentPreparation'
import type { ImportSession } from '../../src/lib/types/import-session'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}

const session: ImportSession = {
  id: 12,
  projectId: 1,
  filename: '设定集.md',
  fileHash: 'hash',
  totalChars: 12345,
  totalChunks: 3,
  chunkSize: 50000,
  chunks: [],
  merged: { worldview: {}, characters: [], outline: [] },
  rollingContext: '',
  importTarget: 'project',
  status: 'done',
  createdAt: 1,
  updatedAt: 1,
}

function ImportPreparationHarness() {
  const preparation = useImportDocumentPreparation()
  return createElement('div', null,
    createElement('button', { onClick: () => preparation.handleRawTextChange('第一章\n镜海之门开启。') }, '载入粘贴文本'),
    createElement('button', { onClick: preparation.prepareConfirmation }, '准备解析'),
    createElement('span', { 'data-testid': 'state' }, preparation.showConfirm
      ? `${preparation.plans?.length}|${preparation.previewPlans?.length}|${preparation.sourceBlob().filename}`
      : 'closed'),
  )
}

describe('AUDIT-6 · 文档导入视图', () => {
  it('介绍区使用当前切块大小并展示文件限制', async () => {
    const host = await mount(createElement(ImportDocIntro, { chunkSize: 50000 }))
    expect(host.textContent).toContain('AI 分块文档解析')
    expect(host.textContent).toContain('每块约 50,000 字')
    expect(host.textContent).toContain('支持的文件格式与大小上限')
  })

  it('复用会话的四个操作只向父级转发', async () => {
    const onApplyProject = vi.fn()
    const onApplyReference = vi.fn()
    const onIgnore = vi.fn()
    const host = await mount(createElement(ImportReusableSessionBanner, {
      session,
      applying: false,
      originalTextAvailable: false,
      onApplyProject,
      onApplyReference,
      onIgnore,
    }))

    const buttons = host.querySelectorAll('button')
    expect(buttons).toHaveLength(4)
    await act(async () => buttons[0].click())
    await act(async () => buttons[1].click())
    await act(async () => buttons[2].click())
    await act(async () => buttons[3].click())
    expect(onApplyProject).toHaveBeenCalledOnce()
    expect(onApplyReference).toHaveBeenNthCalledWith(1, 'quick')
    expect(onApplyReference).toHaveBeenNthCalledWith(2, 'deep')
    expect(onIgnore).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('原文已不在内存')
  })

  it('流水线控制栏按 phase 显示暂停、恢复和取消命令', async () => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    const onCancel = vi.fn()
    const host = await mount(createElement(ImportPipelineControls, {
      phase: 'paused',
      canResume: true,
      onPause,
      onResume,
      onCancel,
    }))
    expect(host.textContent).toContain('恢复')
    expect(host.textContent).toContain('取消')
    expect(host.textContent).not.toContain('暂停')
    const resume = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('恢复'))!
    const cancel = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('取消'))!
    await act(async () => resume.click())
    await act(async () => cancel.click())
    expect(onResume).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('文档准备控制器为粘贴文本生成切块和 Blob 兜底', async () => {
    const host = await mount(createElement(ImportPreparationHarness))
    const load = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '载入粘贴文本')!
    const prepare = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '准备解析')!
    await act(async () => load.click())
    await act(async () => prepare.click())
    expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('1|1|粘贴内容.txt')
  })
})
