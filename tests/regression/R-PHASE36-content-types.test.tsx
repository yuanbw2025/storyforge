import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ContentTypeBadge from '../../src/components/layout/ContentTypeBadge'
import Sidebar from '../../src/components/layout/Sidebar'
import {
  MODULE_CONTENT_TYPES,
  NAV_TREE,
  getModuleContentType,
  type TreeNode,
} from '../../src/components/layout/sidebar-tree'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(element: ReturnType<typeof createElement>) {
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

function collectLeaves(nodes: TreeNode[]): Array<Extract<TreeNode, { kind: 'leaf' }>> {
  return nodes.flatMap(node => node.kind === 'leaf' ? [node] : collectLeaves(node.children))
}

describe('Phase 36 · 页面上游/下游内容标记', () => {
  it('所有导航叶子和 legacy 模块都从完整映射取得内容类型', () => {
    const leaves = NAV_TREE.flatMap(section => [
      ...(section.rootLeaf ? [section.rootLeaf] : []),
      ...collectLeaves(section.children ?? []),
    ])

    for (const leaf of leaves) {
      expect(leaf.contentType).toBe(MODULE_CONTENT_TYPES[leaf.id])
    }
    expect(getModuleContentType('story-core')).toBe('upstream')
    expect(getModuleContentType('editor')).toBe('writing')
    expect(getModuleContentType('backup')).toBe('system')
  })

  it('完整徽标展示类型和说明，紧凑徽标不改变导航按钮的可访问名称', async () => {
    const full = await mount(createElement(ContentTypeBadge, {
      contentType: 'downstream',
      showDescription: true,
    }))
    expect(full.textContent).toContain('产物')
    expect(full.textContent).toContain('从已写正文提取或整理')
    expect(full.querySelector('[data-content-type="downstream"]')).not.toBeNull()

    const compact = await mount(createElement(ContentTypeBadge, {
      contentType: 'tool',
      compact: true,
    }))
    const compactBadge = compact.querySelector('[data-content-type="tool"]')
    expect(compactBadge?.getAttribute('aria-hidden')).toBe('true')
    expect(compactBadge?.getAttribute('title')).toContain('AI 工具')
  })

  it('侧栏在展开时给每个页面显示类型标记，并保持导航回调', async () => {
    const onSelect = vi.fn()
    const host = await mount(createElement(Sidebar, {
      active: 'inventory',
      onSelect,
      onBack: vi.fn(),
      projectName: '测试项目',
      collapsed: false,
      onToggleCollapse: vi.fn(),
    }))

    const inventoryButton = Array.from(host.querySelectorAll('button')).find(button =>
      button.textContent?.includes('物品栏'),
    )!
    expect(inventoryButton.textContent).toContain('产物')
    await act(async () => inventoryButton.click())
    expect(onSelect).toHaveBeenCalledWith('inventory')
  })
})
