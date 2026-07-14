import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutlineGenerationResultPanel from '../../src/components/outline/OutlineGenerationResultPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(patch: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(OutlineGenerationResultPanel, {
    output: '',
    isStreaming: false,
    error: null,
    moduleKey: 'outline.volume',
    restructuring: false,
    previewVolumes: null,
    previewChapters: null,
    previewTargetId: null,
    onStop: vi.fn(),
    onAccept: vi.fn(),
    onRetry: vi.fn(),
    onConfirmVolumes: vi.fn(),
    onConfirmChapters: vi.fn(),
    onCancelPreview: vi.fn(),
    ...patch,
  })))
  return host
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 大纲生成结果视图', () => {
  it('结构整理中保留明确进度状态', async () => {
    const host = await mount({ restructuring: true })
    expect(host.textContent).toContain('正在用 AI 整理大纲结构')
  })

  it('卷预览区分新增与定点补全，并转发确认/取消', async () => {
    const onConfirmVolumes = vi.fn()
    const onCancelPreview = vi.fn()
    const newHost = await mount({
      previewVolumes: [{ title: '第一卷', summary: '启程' }, { title: '第二卷', summary: '风暴' }],
      onConfirmVolumes,
      onCancelPreview,
    })
    expect(newHost.textContent).toContain('将创建 2 个卷')
    await act(async () => Array.from(newHost.querySelectorAll('button')).find(button => button.textContent?.includes('确认写入'))!.click())
    await act(async () => Array.from(newHost.querySelectorAll('button')).find(button => button.textContent?.includes('取消'))!.click())
    expect(onConfirmVolumes).toHaveBeenCalledOnce()
    expect(onCancelPreview).toHaveBeenCalledOnce()

    const targetHost = await mount({
      previewVolumes: [{ title: '第一卷', summary: '补全' }],
      previewTargetId: 7,
    })
    expect(targetHost.textContent).toContain('将补全当前卷的卷纲')
  })

  it('章节预览保留目标卷名称和定点补全文案', async () => {
    const onConfirmChapters = vi.fn()
    const newHost = await mount({
      moduleKey: 'outline.chapter',
      previewChapters: [{ title: '第一章', summary: '雨夜入城' }],
      selectedVolumeTitle: '青石卷',
      onConfirmChapters,
    })
    expect(newHost.textContent).toContain('将在「青石卷」下创建 1 个章节')
    await act(async () => Array.from(newHost.querySelectorAll('button')).find(button => button.textContent?.includes('确认写入'))!.click())
    expect(onConfirmChapters).toHaveBeenCalledOnce()

    const targetHost = await mount({
      moduleKey: 'outline.chapter',
      previewChapters: [{ title: '第一章', summary: '补全' }],
      previewTargetId: 9,
    })
    expect(targetHost.textContent).toContain('将补全当前章节的章纲')
  })
})
