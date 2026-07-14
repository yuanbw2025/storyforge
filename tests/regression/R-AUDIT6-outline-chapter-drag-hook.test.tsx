import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useOutlineChapterDrag } from '../../src/components/outline/useOutlineChapterDrag'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
let drag: ReturnType<typeof useOutlineChapterDrag>

async function mount() {
  function Harness() {
    drag = useOutlineChapterDrag()
    return createElement('div', null, drag.activeChapterDrag?.chapterId ?? 'none')
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(Harness)))
  return host
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 章节拖拽状态 hook', () => {
  it('同步维护可渲染状态和事件期间可立即读取的 ref', async () => {
    const host = await mount()
    const payload = { chapterId: 7, sourceParentId: 1 }

    await act(async () => drag.beginChapterDrag(payload))
    expect(host.textContent).toBe('7')
    expect(drag.getActiveChapterDrag()).toEqual(payload)

    await act(async () => drag.clearActiveChapterDrag())
    expect(host.textContent).toBe('none')
    expect(drag.getActiveChapterDrag()).toBeNull()
  })
})
