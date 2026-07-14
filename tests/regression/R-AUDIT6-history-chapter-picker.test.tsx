import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryChapterPicker from '../../src/components/history/HistoryChapterPicker'
import type { Chapter } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

function chapter(id: number, title: string): Chapter {
  return { id, projectId: 1, outlineNodeId: id, title, content: '', wordCount: 0, createdAt: 1, updatedAt: 1 }
}

async function mount(chapters: Chapter[], relatedChapterIds: number[] = []) {
  const onChange = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(HistoryChapterPicker, {
    chapters,
    relatedChapterIds,
    onChange,
  })))
  return { host, onChange }
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 历史关联章节选择器', () => {
  it('空章节列表保留明确空态', async () => {
    const { host } = await mount([])
    expect(host.textContent).toContain('暂无章节可关联')
  })

  it('点击未关联章节追加 ID，点击已关联章节移除 ID', async () => {
    const { host, onChange } = await mount([
      chapter(1, '第一章'),
      chapter(2, '第二章'),
    ], [1])
    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent === '第二章')!.click())
    await act(async () => buttons.find(button => button.textContent === '第一章')!.click())
    expect(onChange).toHaveBeenNthCalledWith(1, [1, 2])
    expect(onChange).toHaveBeenNthCalledWith(2, [])
  })
})
