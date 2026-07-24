/**
 * R-INV1 · 抽取硬规则。
 * 守卫 parseInventoryEvents：heldByName 空/缺失 → 过滤；
 * itemName 空 → 过滤；正常条目通过。
 */
import { describe, it, expect } from 'vitest'
import { parseInventoryEvents } from '../../src/lib/ai/adapters/inventory-extract-adapter'

describe('INV-1 · parseInventoryEvents 硬规则', () => {
  it('heldByName 缺失 → 被过滤', () => {
    const raw = JSON.stringify([
      { itemName: '剑', action: 'gain', quantity: 1, note: '' },
    ])
    expect(parseInventoryEvents(raw)).toHaveLength(0)
  })

  it('heldByName 为空串 → 被过滤', () => {
    const raw = JSON.stringify([
      { itemName: '剑', heldByName: '', action: 'gain', quantity: 1, note: '' },
      { itemName: '剑', heldByName: '   ', action: 'gain', quantity: 1, note: '' },
    ])
    expect(parseInventoryEvents(raw)).toHaveLength(0)
  })

  it('heldByName 正常 → 通过', () => {
    const raw = JSON.stringify([
      { itemName: '剑', heldByName: '林风', action: 'gain', quantity: 1, note: '' },
    ])
    const events = parseInventoryEvents(raw)
    expect(events).toHaveLength(1)
    expect(events[0].itemName).toBe('剑')
    expect(events[0].heldByName).toBe('林风')
  })

  it('itemName 为空但 heldByName 正常 → 被过滤', () => {
    const raw = JSON.stringify([
      { itemName: '', heldByName: '林风', action: 'gain', quantity: 1 },
    ])
    expect(parseInventoryEvents(raw)).toHaveLength(0)
  })

  it('混合：正常 + 缺失 heldByName + 空 itemName → 仅保留正常', () => {
    const raw = JSON.stringify([
      { itemName: '剑', heldByName: '林风', action: 'gain', quantity: 1 },
      { itemName: '令牌', action: 'gain', quantity: 1 },
      { itemName: '', heldByName: '林风', action: 'gain', quantity: 1 },
      { itemName: '丹药', heldByName: '张铁', action: 'consume', quantity: 2 },
    ])
    const events = parseInventoryEvents(raw)
    expect(events).toHaveLength(2)
    expect(events.map(e => e.itemName)).toEqual(['剑', '丹药'])
  })
})
