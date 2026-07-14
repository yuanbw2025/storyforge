import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutlineVolumeDetail from '../../src/components/outline/OutlineVolumeDetail'
import { DialogProvider } from '../../src/components/shared/Dialog'
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

function detailProps(patch: Record<string, unknown> = {}) {
  return {
    volume: null,
    nodes: [] as OutlineNode[],
    multiWorldEnabled: false,
    worldGroups: [],
    aiStreaming: false,
    activeChapterDrag: null,
    getActiveChapterDrag: () => null,
    onChapterDragStart: vi.fn(),
    onChapterDragEnd: vi.fn(),
    onUpdateNode: vi.fn(),
    onDeleteNode: vi.fn(),
    onGenerateVolume: vi.fn(),
    onGenerateAllChapters: vi.fn(),
    onAddChapter: vi.fn(),
    onDeleteVolume: vi.fn(),
    onAddStructure: vi.fn(),
    onInsertChapterAfter: vi.fn(),
    onGenerateChapter: vi.fn(),
    onOpenChapter: vi.fn(),
    onReorderNodes: vi.fn(),
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

describe('AUDIT-6 · 卷详情视图拆分', () => {
  it('未选卷时显示明确空态', async () => {
    const host = await mount(createElement(OutlineVolumeDetail, detailProps()))
    expect(host.textContent).toContain('选择左侧的卷开始编辑')
  })

  it('保留标题、摘要、所属世界编辑和顶部命令', async () => {
    const volume = outlineNode(1, 'volume', null, '旧卷名', { worldGroupId: 7 })
    const onUpdateNode = vi.fn()
    const onGenerateVolume = vi.fn()
    const onGenerateAllChapters = vi.fn()
    const onAddChapter = vi.fn()
    const onDeleteVolume = vi.fn()
    const host = await mount(createElement(OutlineVolumeDetail, detailProps({
      volume,
      nodes: [volume],
      multiWorldEnabled: true,
      worldGroups: [{ id: 7, name: '主世界', icon: 'M' }, { id: 8, name: '副世界', icon: 'S' }],
      onUpdateNode,
      onGenerateVolume,
      onGenerateAllChapters,
      onAddChapter,
      onDeleteVolume,
    })))

    const titleInput = host.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(titleInput, '新卷名')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const summary = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(summary, '新卷摘要')
      summary.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const select = host.querySelector<HTMLSelectElement>('select')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, '8')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onUpdateNode).toHaveBeenCalledWith(1, { title: '新卷名' })
    expect(onUpdateNode).toHaveBeenCalledWith(1, { summary: '新卷摘要' })
    expect(onUpdateNode).toHaveBeenCalledWith(1, { worldGroupId: 8 })
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('AI 生成本卷卷纲'))!.click())
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('生成本卷所有章节'))!.click())
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('添加章节'))!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="删除当前卷"]')!.click())
    expect(onGenerateVolume).toHaveBeenCalledWith(1)
    expect(onGenerateAllChapters).toHaveBeenCalledOnce()
    expect(onAddChapter).toHaveBeenCalledWith()
    expect(onDeleteVolume).toHaveBeenCalledOnce()
  })

  it('已有卷纲时隐藏单卷生成并保留章节空态和故事结构入口', async () => {
    const volume = outlineNode(1, 'volume', null, '第一卷', { summary: '已有卷纲' })
    const onAddStructure = vi.fn()
    const host = await mount(createElement(OutlineVolumeDetail, detailProps({ volume, nodes: [volume], onAddStructure })))

    expect(host.textContent).not.toContain('AI 生成本卷卷纲')
    expect(host.textContent).toContain('章节列表（0 章）')
    expect(host.textContent).toContain('还没有章节')
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('添加故事结构'))!.click())
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('三幕式'))!.click())
    expect(onAddStructure).toHaveBeenCalledWith('three-act')
  })

  it('故事块模式汇总所有章节并保留添加自定义故事块命令', async () => {
    const volume = outlineNode(1, 'volume', null, '第一卷', { summary: '卷纲' })
    const block = outlineNode(10, 'storyBlock', 1, '第一幕')
    const onAddStructure = vi.fn()
    const host = await mount(createElement(DialogProvider, null,
      createElement(OutlineVolumeDetail, detailProps({
        volume,
        nodes: [volume, block, outlineNode(11, 'chapter', 1, '直挂章'), outlineNode(12, 'chapter', 10, '块内章')],
        onAddStructure,
      })),
    ))

    expect(host.textContent).toContain('故事结构（2 章）')
    expect(Array.from(host.querySelectorAll('input')).some(input => input.value === '第一幕')).toBe(true)
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('+ 添加故事块'))!.click())
    expect(onAddStructure).toHaveBeenCalledWith('custom')
  })
})
