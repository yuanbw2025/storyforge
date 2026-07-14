import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutlinePreviewPanel from '../../src/components/outline/OutlinePreviewPanel'
import OutlineStructureMenu from '../../src/components/outline/OutlineStructureMenu'
import { OutlineChapterRow } from '../../src/components/outline/OutlineChapterTree'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 大纲纯视图拆分', () => {
  it('预览面板完整显示条目并保留确认/取消回调', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const host = await mount(createElement(OutlinePreviewPanel, {
      label: '将创建 2 个卷',
      items: [
        { title: '第一卷', summary: '启程' },
        { title: '第二卷', summary: '' },
      ],
      onConfirm,
      onCancel,
    }))

    expect(host.textContent).toContain('将创建 2 个卷')
    expect(host.textContent).toContain('第一卷')
    expect(host.textContent).toContain('启程')
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('确认写入'))!.click())
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('取消'))!.click())
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('故事结构菜单选择后回传结构 key 并关闭菜单', async () => {
    const onSelect = vi.fn()
    const host = await mount(createElement(OutlineStructureMenu, { onSelect }))
    const openButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('添加故事结构'))!
    await act(async () => openButton.click())
    const structureButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('三幕式'))!
    await act(async () => structureButton.click())

    expect(onSelect).toHaveBeenCalledWith('three-act')
    expect(host.textContent).not.toContain('（3 块）')
  })

  it('章节摘要只在失焦且内容变化后保存', async () => {
    const onUpdate = vi.fn()
    const host = await mount(createElement(OutlineChapterRow, {
      ch: { id: 21, title: '旧标题', summary: '旧摘要' },
      idx: 0,
      onUpdate,
      onDelete: vi.fn(),
      activeChapterDrag: null,
      getActiveChapterDrag: () => null,
      onChapterDragStart: vi.fn(),
      onChapterDragEnd: vi.fn(),
    }))
    const textarea = host.querySelector('textarea')!

    await act(async () => textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(onUpdate).not.toHaveBeenCalled()

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      valueSetter.call(textarea, '新摘要')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onUpdate).not.toHaveBeenCalled()

    await act(async () => textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledWith(21, { summary: '新摘要' })
  })

  it('章节生成、插入和打开按钮继续回传原有操作', async () => {
    const onGenerate = vi.fn()
    const onInsertAfter = vi.fn()
    const onOpen = vi.fn()
    const host = await mount(createElement(OutlineChapterRow, {
      ch: { id: 34, title: '待处理章节', summary: '' },
      idx: 1,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onOpen,
      onInsertAfter,
      onGenerate,
      activeChapterDrag: null,
      getActiveChapterDrag: () => null,
      onChapterDragStart: vi.fn(),
      onChapterDragEnd: vi.fn(),
    }))

    await act(async () => host.querySelector<HTMLButtonElement>('button[title="AI 生成本章章纲"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="在此章下方插入一章"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="编辑章节"]')!.click())

    expect(onGenerate).toHaveBeenCalledOnce()
    expect(onInsertAfter).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith(34)
  })
})
