import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InventoryFact } from '../../src/components/state/StatePanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderFact(source: 'inventory' | 'state', onOpenInventory = vi.fn()) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => {
    root.render(createElement(InventoryFact, {
      value: '青锋剑 ×1',
      source,
      onOpenInventory,
    }))
  })
  return { host, onOpenInventory }
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('QUICKWIN-5 · 状态卡持有物来源', () => {
  it('主角流水投影明确标为来自物品栏，并可跳转', async () => {
    const { host, onOpenInventory } = await renderFact('inventory')

    expect(host.textContent).toContain('来自物品栏')
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="去物品栏"]')!
    await act(async () => button.click())
    expect(onOpenInventory).toHaveBeenCalledOnce()
  })

  it('没有主角流水或配角时明确标为来自状态字段', async () => {
    const { host } = await renderFact('state')
    expect(host.textContent).toContain('来自状态字段')
    expect(host.textContent).not.toContain('来自物品栏')
  })
})
