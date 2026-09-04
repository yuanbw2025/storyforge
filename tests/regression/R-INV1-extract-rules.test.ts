/**
 * R-INV1 · 抽取硬规则。
 * 守卫 parseInventoryEvents：当前闭集协议只接受字段齐全、类型正确的整批结果。
 */
import { describe, it, expect } from 'vitest'
import { parseInventoryEvents } from '../../src/lib/ai/adapters/inventory-extract-adapter'

describe('INV-1 · parseInventoryEvents 硬规则', () => {
  it('heldByName 缺失 → 整批拒绝', () => {
    const raw = JSON.stringify([
      { itemName: '剑', action: 'gain', quantity: 1, note: '' },
    ])
    expect(() => parseInventoryEvents(raw)).toThrow('字段不在允许闭集')
  })

  it('heldByName 为空串 → 整批拒绝', () => {
    const raw = JSON.stringify([
      { itemName: '剑', heldByName: '', action: 'gain', quantity: 1, note: '' },
      { itemName: '剑', heldByName: '   ', action: 'gain', quantity: 1, note: '' },
    ])
    expect(() => parseInventoryEvents(raw)).toThrow('字段类型或枚举无效')
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

  it('itemName 为空但 heldByName 正常 → 整批拒绝', () => {
    const raw = JSON.stringify([
      { itemName: '', heldByName: '林风', action: 'gain', quantity: 1, note: '' },
    ])
    expect(() => parseInventoryEvents(raw)).toThrow('字段类型或枚举无效')
  })

  it('混合：任意一条不完整都令整批失败', () => {
    const raw = JSON.stringify([
      { itemName: '剑', heldByName: '林风', action: 'gain', quantity: 1, note: '' },
      { itemName: '令牌', action: 'gain', quantity: 1, note: '' },
      { itemName: '', heldByName: '林风', action: 'gain', quantity: 1, note: '' },
      { itemName: '丹药', heldByName: '张铁', action: 'consume', quantity: 2, note: '' },
    ])
    expect(() => parseInventoryEvents(raw)).toThrow('字段不在允许闭集')
  })
})
