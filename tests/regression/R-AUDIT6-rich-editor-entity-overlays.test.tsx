import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RichEditorEntityOverlays from '../../src/components/editor/RichEditorEntityOverlays'
import type { EditorEntityReference } from '../../src/lib/editor/entity-reference'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const reference: EditorEntityReference = {
  id: 'character:7',
  kind: 'character',
  kindLabel: '角色',
  name: '沈砚',
  summary: '巡夜司校尉',
  details: [{ label: '所属势力', value: '巡夜司' }],
}
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(RichEditorEntityOverlays, props as never)))
  return host
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 / HEALTH-4 · 正文实体档案浮层', () => {
  it('展示补全候选并转发插入命令', async () => {
    const onInsert = vi.fn()
    const host = await mount({ menu: { x: 30, y: 40 }, candidates: [reference], activeIndex: 0, hovered: null, onInsert })
    expect(host.textContent).toContain('沈砚')
    expect(host.textContent).toContain('巡夜司校尉')
    await act(async () => host.querySelector('button')!.click())
    expect(onInsert).toHaveBeenCalledWith(reference)
  })

  it('无补全菜单时展示悬浮档案详情', async () => {
    const host = await mount({ menu: null, candidates: [], activeIndex: 0, hovered: { reference, x: 50, y: 60 }, onInsert: vi.fn() })
    expect(host.textContent).toContain('角色')
    expect(host.textContent).toContain('所属势力')
    expect(host.textContent).toContain('巡夜司')
  })

  it('补全菜单优先于悬浮档案，避免两个浮层重叠', async () => {
    const host = await mount({ menu: { x: 30, y: 40 }, candidates: [reference], activeIndex: 0, hovered: { reference, x: 50, y: 60 }, onInsert: vi.fn() })
    expect(host.querySelectorAll('.fixed')).toHaveLength(1)
  })
})
