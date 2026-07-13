import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutlinePreviewPanel from '../../src/components/outline/OutlinePreviewPanel'
import OutlineStructureMenu from '../../src/components/outline/OutlineStructureMenu'

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
})
