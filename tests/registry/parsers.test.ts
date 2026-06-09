/**
 * Phase 3.2 · AI 输出解析器测试
 *
 * parser 是 "AI 输出 → 结构化数据" 的关键环节,解析错 = 丢数据/坏数据进库。
 * 覆盖各容错分支:markdown 围栏、JSON 截取、字段校验、降级处理。
 */
import { describe, it, expect } from 'vitest'
import { parseStateDiffs } from '../../src/lib/ai/adapters/state-extract-adapter'
import { parseInventoryEvents } from '../../src/lib/ai/adapters/inventory-extract-adapter'
import { parseStoryEvents } from '../../src/lib/ai/adapters/story-timeline-adapter'
import { parseRelationOutput } from '../../src/lib/ai/relation-extractor'

describe('Phase 3.2 · parseStateDiffs', () => {
  it('解析纯 JSON 数组', () => {
    const raw = JSON.stringify([
      { entityName: '李明', category: 'character', field: '位置', oldValue: '洛阳', newValue: '长安' },
    ])
    const { diffs, error } = parseStateDiffs(raw)
    expect(error).toBeNull()
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ entityName: '李明', field: '位置', newValue: '长安' })
  })

  it('剥离 markdown ```json 围栏', () => {
    const raw = '```json\n[{"entityName":"王五","category":"item","field":"数量","oldValue":null,"newValue":"3"}]\n```'
    const { diffs, error } = parseStateDiffs(raw)
    expect(error).toBeNull()
    expect(diffs[0].entityName).toBe('王五')
  })

  it('从夹带文字中截取 JSON 数组', () => {
    const raw = '好的,这是分析结果:\n[{"entityName":"赵六","category":"location","field":"状态","oldValue":null,"newValue":"被毁"}]\n以上。'
    const { diffs } = parseStateDiffs(raw)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].newValue).toBe('被毁')
  })

  it('无 JSON 数组时返回错误而非崩溃', () => {
    const { diffs, error } = parseStateDiffs('抱歉,本章没有状态变更。')
    expect(diffs).toHaveLength(0)
    expect(error).toBeTruthy()
  })

  it('过滤缺必填字段的条目', () => {
    const raw = JSON.stringify([
      { entityName: '甲', category: 'character', field: '状态', newValue: '受伤' },
      { category: 'character', field: '状态', newValue: '缺名字' }, // 应被过滤
    ])
    const { diffs } = parseStateDiffs(raw)
    expect(diffs).toHaveLength(1)
    expect(diffs[0].entityName).toBe('甲')
  })

  it('非法 category 被过滤', () => {
    const raw = JSON.stringify([
      { entityName: '甲', category: 'INVALID', field: 'x', newValue: 'y' },
    ])
    const { diffs } = parseStateDiffs(raw)
    expect(diffs).toHaveLength(0)
  })

  it('坏 JSON 返回错误不抛异常', () => {
    const { error } = parseStateDiffs('[{bad json')
    expect(error).toBeTruthy()
  })
})

describe('Phase 3.2 · parseInventoryEvents', () => {
  it('解析物品流水 + 归一 action/quantity', () => {
    const raw = JSON.stringify([
      { itemName: '令牌', action: 'gain', quantity: 2, note: '掌门所赐' },
      { itemName: '丹药', action: 'consume', quantity: '3', note: '' },
    ])
    const events = parseInventoryEvents(raw)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ itemName: '令牌', action: 'gain', quantity: 2 })
    expect(events[1]).toMatchObject({ itemName: '丹药', action: 'consume', quantity: 3 })
  })

  it('未知 action 默认 gain;quantity 缺省/非法归一为 1', () => {
    const raw = JSON.stringify([{ itemName: '剑', action: 'weird', note: '' }])
    const events = parseInventoryEvents(raw)
    expect(events[0].action).toBe('gain')
    expect(events[0].quantity).toBe(1)
  })

  it('空 itemName 被过滤', () => {
    const raw = JSON.stringify([{ itemName: '', action: 'gain', quantity: 1 }])
    expect(parseInventoryEvents(raw)).toHaveLength(0)
  })

  it('坏 JSON 返回空数组', () => {
    expect(parseInventoryEvents('not json')).toEqual([])
  })
})

describe('Phase 3.2 · parseStoryEvents', () => {
  it('解析故事年表事件', () => {
    const raw = JSON.stringify([
      { title: '初入宗门', storyTime: '第一年春', importance: 2, description: '主角拜师' },
    ])
    const events = parseStoryEvents(raw)
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].title).toBe('初入宗门')
  })

  it('坏输入返回空数组不崩溃', () => {
    expect(parseStoryEvents('无')).toEqual([])
  })
})

describe('Phase 3.2 · parseRelationOutput', () => {
  it('解析角色关系(char1/char2/type)', () => {
    const raw = JSON.stringify([
      { char1: '萧炎', char2: '药老', type: 'master', description: '亦师亦友' },
    ])
    const rels = parseRelationOutput(raw)
    expect(rels.length).toBeGreaterThanOrEqual(1)
    expect(rels[0]).toMatchObject({ char1: '萧炎', char2: '药老', type: 'master' })
  })

  it('非法 type 被过滤', () => {
    const raw = JSON.stringify([{ char1: 'A', char2: 'B', type: 'INVALID' }])
    expect(parseRelationOutput(raw)).toHaveLength(0)
  })

  it('坏输入返回空数组不崩溃', () => {
    expect(parseRelationOutput('解析失败')).toEqual([])
  })
})
