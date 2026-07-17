import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorldviewOriginSidebar from '../../src/components/worldview/WorldviewOriginSidebar'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 / HEALTH-4 · 世界起源导航', () => {
  it('锁定三个子页签、活动态与后台生成提示', async () => {
    const onSelect = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(createElement(WorldviewOriginSidebar, {
      active: 'origin',
      streamingKeys: new Set(['power']),
      onSelect,
    })))
    expect(host.querySelectorAll('button')).toHaveLength(3)
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toContain('世界来源')
    expect(host.querySelector('[aria-label="力量体系生成中"]')).not.toBeNull()
    const divine = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('神明与信仰'))!
    await act(async () => divine.click())
    expect(onSelect).toHaveBeenCalledWith('divine')
  })
})
