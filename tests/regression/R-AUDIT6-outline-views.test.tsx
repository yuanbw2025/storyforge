import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutlinePreviewPanel from '../../src/components/outline/OutlinePreviewPanel'
import OutlineStructureMenu from '../../src/components/outline/OutlineStructureMenu'
import { OutlineChapterRow } from '../../src/components/outline/OutlineChapterTree'
import OutlineVolumeSidebar from '../../src/components/outline/OutlineVolumeSidebar'
import type { OutlineNode } from '../../src/lib/types'

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

function outlineNode(
  id: number,
  type: OutlineNode['type'],
  parentId: number | null,
  title: string,
  patch: Partial<OutlineNode> = {},
): OutlineNode {
  return {
    id,
    projectId: 1,
    parentId,
    type,
    title,
    summary: '',
    order: id,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function sidebarProps(patch: Record<string, unknown> = {}) {
  return {
    volumes: [] as OutlineNode[],
    nodes: [] as OutlineNode[],
    selectedVolumeId: null,
    multiWorldEnabled: false,
    worldGroups: [],
    aiStreaming: false,
    batchRunning: false,
    batchProgress: null,
    batchResult: null,
    activeChapterDrag: null,
    getActiveChapterDrag: () => null,
    onClearActiveChapterDrag: vi.fn(),
    onSelectVolume: vi.fn(),
    onAddVolume: vi.fn(),
    onGenerateVolumes: vi.fn(),
    onGenerateAllChapters: vi.fn(),
    onCancelBatch: vi.fn(),
    onConfirmBatch: vi.fn(),
    onDismissBatch: vi.fn(),
    onReorderVolumes: vi.fn(),
    onMoveChapter: vi.fn().mockResolvedValue(undefined),
    ...patch,
  }
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

  it('卷侧栏统计直挂与故事块章节并保留多世界标记和选中回调', async () => {
    const volume = outlineNode(1, 'volume', null, '第一卷', { summary: '启程', worldGroupId: 7 })
    const secondVolume = outlineNode(2, 'volume', null, '第二卷')
    const storyBlock = outlineNode(10, 'storyBlock', 1, '第一幕')
    const onSelectVolume = vi.fn()
    const host = await mount(createElement(OutlineVolumeSidebar, sidebarProps({
      volumes: [volume, secondVolume],
      nodes: [volume, secondVolume, storyBlock, outlineNode(11, 'chapter', 1, '直挂章'), outlineNode(12, 'chapter', 10, '故事块章')],
      selectedVolumeId: 1,
      multiWorldEnabled: true,
      worldGroups: [{ id: 7, icon: 'W' }],
      onSelectVolume,
    })))

    expect(host.textContent).toContain('W')
    expect(host.textContent).toContain('2 章 · 启程...')
    expect(host.textContent).toContain('批量生成所有卷的章节')
    await act(async () => host.querySelector<HTMLElement>('[data-outline-volume-id="2"] button')!.click())
    expect(onSelectVolume).toHaveBeenCalledWith(2)
  })

  it('卷侧栏在生成忙碌时禁用命令并保留批量进度取消', async () => {
    const onCancelBatch = vi.fn()
    const volumes = [outlineNode(1, 'volume', null, '第一卷'), outlineNode(2, 'volume', null, '第二卷')]
    const host = await mount(createElement(OutlineVolumeSidebar, sidebarProps({
      volumes,
      nodes: volumes,
      aiStreaming: true,
      batchRunning: true,
      batchProgress: {
        currentVolumeIndex: 0,
        totalVolumes: 2,
        currentVolumeTitle: '第一卷',
        parsedChapters: [],
        completedVolumes: 1,
        stage: '正在生成第二卷',
      },
      onCancelBatch,
    })))

    const generationButtons = Array.from(host.querySelectorAll('button')).filter(button => button.textContent?.includes('批量生成'))
    expect(generationButtons).toHaveLength(2)
    expect(generationButtons.every(button => button.disabled)).toBe(true)
    expect(host.textContent).toContain('1/2 卷')
    expect(host.textContent).toContain('正在生成第二卷')
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === '取消')!.click())
    expect(onCancelBatch).toHaveBeenCalledOnce()
  })

  it('卷侧栏汇总批量结果并回传确认和关闭', async () => {
    const onConfirmBatch = vi.fn()
    const onDismissBatch = vi.fn()
    const host = await mount(createElement(OutlineVolumeSidebar, sidebarProps({
      batchResult: new Map([
        [1, [{ title: '第一章', summary: '' }, { title: '第二章', summary: '' }]],
        [2, [{ title: '第三章', summary: '' }]],
      ]),
      onConfirmBatch,
      onDismissBatch,
    })))

    expect(host.textContent).toContain('批量生成完成：3 章')
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('全部写入'))!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="关闭批量生成结果"]')!.click())
    expect(onConfirmBatch).toHaveBeenCalledOnce()
    expect(onDismissBatch).toHaveBeenCalledOnce()
  })

  it('卷侧栏空态仍可添加卷和启动卷纲生成', async () => {
    const onAddVolume = vi.fn()
    const onGenerateVolumes = vi.fn()
    const host = await mount(createElement(OutlineVolumeSidebar, sidebarProps({ onAddVolume, onGenerateVolumes })))

    expect(host.textContent).toContain('还没有卷')
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('添加卷'))!.click())
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('批量生成卷级大纲'))!.click())
    expect(onAddVolume).toHaveBeenCalledOnce()
    expect(onGenerateVolumes).toHaveBeenCalledOnce()
  })

  it('卷侧栏接收章节投放并移动到目标卷直挂章节末尾', async () => {
    const volume = outlineNode(2, 'volume', null, '第二卷')
    const directChapter = outlineNode(20, 'chapter', 2, '已有章节')
    const activeDrag = { chapterId: 11, sourceParentId: 1 }
    const onMoveChapter = vi.fn().mockResolvedValue(undefined)
    const onClearActiveChapterDrag = vi.fn()
    const host = await mount(createElement(OutlineVolumeSidebar, sidebarProps({
      volumes: [volume],
      nodes: [volume, directChapter],
      activeChapterDrag: activeDrag,
      getActiveChapterDrag: () => activeDrag,
      onMoveChapter,
      onClearActiveChapterDrag,
    })))
    const target = host.querySelector<HTMLElement>('[data-outline-volume-id="2"]')!
    const createDragEvent = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          types: [],
          getData: () => '',
          setData: vi.fn(),
          dropEffect: 'none',
          effectAllowed: 'all',
        },
      })
      return event
    }

    await act(async () => {
      target.dispatchEvent(createDragEvent('dragover'))
      target.dispatchEvent(createDragEvent('drop'))
      await Promise.resolve()
    })

    expect(onMoveChapter).toHaveBeenCalledWith(11, 2, 1)
    expect(onClearActiveChapterDrag).toHaveBeenCalledOnce()
  })
})
