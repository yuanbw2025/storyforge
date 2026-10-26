import { afterEach, describe, expect, it } from 'vitest'
import { useStateCardStore } from '../../src/stores/state-card'
import type { StateCard } from '../../src/lib/types'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const invalidMembers = [null, 7, false, '旧字段', { key: '位置' }, { key: '位置', value: null }, { key: '位置', value: ['山门', '旅店'] }, { key: null, value: '山门' }, { value: '山门' }]

function card(fields: unknown[], id = 1): StateCard {
  return { id, projectId: 1, category: 'character', entityName: '店主', fields: JSON.stringify(fields), createdAt: 1, updatedAt: 1 }
}

afterEach(() => useStateCardStore.setState({ cards: [], loading: false }))

describe('issue213 · 状态卡读取保留原记录', () => {
  it.each(invalidMembers)('按需召回跳过异常成员 %j，仍读取有效字段', invalid => {
    const original = card([invalid, { key: '位置', value: '山门旅店' }])
    const before = structuredClone(original)
    useStateCardStore.setState({ cards: [original] })
    const result = useStateCardStore.getState().buildSelectiveStateContext('山门旅店')
    expect(result.matchedIds).toEqual([1])
    expect(result.text).toContain('位置：山门旅店')
    expect(result.text).toContain('字段格式异常')
    expect(useStateCardStore.getState().cards).toEqual([before])
  })

  it.each(['无关正文', '店主出现', ''])('全量回退或实体匹配可读，保留格式异常提示：%s', reference => {
    const original = card([null, { key: '位置', value: '山门旅店' }])
    useStateCardStore.setState({ cards: [original] })
    const result = useStateCardStore.getState().buildSelectiveStateContext(reference)
    expect(result.text).toContain('位置：山门旅店')
    expect(result.text).toContain('字段格式异常')
    expect(result.allIds).toEqual([1])
    expect(useStateCardStore.getState().cards[0]).toBe(original)
  })

  it('手动勾选不会因异常字段失败，正常记录与空字符串仍按原格式读取', () => {
    const good = card([{ key: '备注', value: '' }, { key: '装备', value: '旧剑' }], 2)
    useStateCardStore.setState({ cards: [card([null]), good] })
    const store = useStateCardStore.getState()
    expect(store.buildSelectiveStateContext('无关正文', [1, 2]).text).toContain('备注： | 装备：旧剑')
    useStateCardStore.setState({ cards: [good] })
    expect(store.buildStateContext()).toBe('【当前状态表】\n\n[角色]\n- 店主 | 备注： | 装备：旧剑')
  })

  it('登记的上下文源读取同一只读投影，数据库内容及 Work 作用域保持不变', async () => {
    const { scope } = await seedCurrentWorkspace('状态卡格式回归')
    const row = stampNewRecord(scope, 'stateCards', { ...card([null, { key: '位置', value: '山门旅店' }]), id: undefined, projectId: scope.projectId }, { owner: 'work' }) as never
    const id = await db.stateCards.add(row)
    const before = await db.stateCards.get(id)
    const other = await seedCurrentWorkspace('相邻作品')
    await db.stateCards.add(stampNewRecord(other.scope, 'stateCards', { ...card([{ key: '秘密', value: '另一作品的状态' }]), id: undefined, projectId: other.scope.projectId }, { owner: 'work' }) as never)
    const source = CONTEXT_SOURCES.find(item => item.key === 'stateCards')!
    const output = await source.read({ projectId: scope.projectId, scope })
    expect(output).toContain('位置:山门旅店')
    expect(output).toContain('字段格式异常')
    expect(output).not.toContain('另一作品的状态')
    expect(await db.stateCards.get(id)).toEqual(before)
    await finalizeCurrentFixtureV1(scope.projectId)
    const exported = await deriveExportProjectJSON(scope.projectId)
    expect(exported.stateCards?.[0].fields).toBe(before!.fields)
  })
})
