import { describe, expect, it } from 'vitest'
import { splitExtractionText } from '../../src/lib/ai/structured-extraction'
import {
  parseCodexEntries,
  parseLocations,
} from '../../src/lib/ai/adapters/structured-extract-adapter'
import {
  buildInventoryExtractPrompt,
  parseInventoryEvents,
} from '../../src/lib/ai/adapters/inventory-extract-adapter'
import { parseStateDiffs } from '../../src/lib/ai/adapters/state-extract-adapter'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('C group: structured extraction foundation', () => {
  it('splits long text without dropping the ending', () => {
    const text = `${'甲'.repeat(5400)}\n\n${'乙'.repeat(5400)}\n\n结尾标记`
    const chunks = splitExtractionText(text, 5200, 200)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.at(-1)).toContain('结尾标记')
  })

  it('codex parser keeps registered fields and normalizes tags/importance', () => {
    const parsed = parseCodexEntries(JSON.stringify([{
      name: '九曜玄铁',
      icon: '⛏️',
      summary: '星陨矿材',
      description: '只在极夜矿脉出现',
      fields: { rank: '神品', unknown: 'drop' },
      tags: ['矿材', '稀有'],
      importance: 9,
    }]), ['rank'])
    expect(parsed).toEqual([{
      name: '九曜玄铁',
      icon: '⛏️',
      summary: '星陨矿材',
      description: '只在极夜矿脉出现',
      fields: { rank: '神品' },
      tags: ['矿材', '稀有'],
      importance: 5,
    }])
  })

  it('location parser only accepts registered location tags', () => {
    expect(parseLocations(JSON.stringify([{
      name: '黑潮港',
      tags: ['港口', '不存在标签'],
      description: '终年黑雾',
      significance: '主角第一次出海',
    }]))[0].tags).toEqual(['港口'])
  })

  it('inventory prompt receives the full chunk and known canonical names', () => {
    const tail = '后半章关键物品变化'
    const text = `${'正文'.repeat(4000)}${tail}`
    const messages = buildInventoryExtractPrompt('测试章', text, ['疗伤丹'])
    const joined = messages.map(message => message.content).join('\n')
    expect(joined).toContain(tail)
    expect(joined).toContain('疗伤丹')
  })

  it('inventory parser rejects non-items with empty names or empty holders and normalizes quantities', () => {
    const parsed = parseInventoryEvents(JSON.stringify([
      { itemName: '疗伤丹', heldByName: '林风', action: 'consume', quantity: 1.6, note: '疗伤' },
      { itemName: '', heldByName: '林风', action: 'gain', quantity: 1, note: 'invalid' },
      { itemName: '剑', heldByName: '', action: 'gain', quantity: 1, note: 'no holder' },
    ]))
    expect(parsed).toEqual([
      { itemName: '疗伤丹', heldByName: '林风', action: 'consume', quantity: 2, note: '疗伤' },
    ])
  })

  it('state extraction only accepts known characters', () => {
    const raw = JSON.stringify([
      { entityName: '沈璃', category: 'character', field: '位置', oldValue: '城外', newValue: '黑潮港' },
      { entityName: '黑色文件夹', category: 'character', field: '状态', oldValue: null, newValue: '开启' },
      { entityName: '黑潮港', category: 'location', field: '状态', oldValue: null, newValue: '封锁' },
    ])
    const { diffs } = parseStateDiffs(raw, ['沈璃'])
    expect(diffs).toHaveLength(1)
    expect(diffs[0].entityName).toBe('沈璃')
  })

  it('registers all C-group read/write targets', () => {
    for (const target of ['codexEntries', 'importantLocations', 'itemLedger', 'stateCards', 'storyTimelineEvents']) {
      expect(FIELD_BY_TARGET.has(target), `missing FIELD_REGISTRY: ${target}`).toBe(true)
      expect(ADOPTION_BY_TARGET.has(target), `missing AdoptionSchema: ${target}`).toBe(true)
    }
    expect(CONTEXT_SOURCE_BY_KEY.has('manualText')).toBe(true)
    expect(CONTEXT_SOURCE_BY_KEY.has('chapterContent')).toBe(true)
  })
})
