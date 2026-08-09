import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import type { Character } from '../../src/lib/types'

function makeChar(over: Partial<Character> = {}): Character {
  const now = Date.now()
  return {
    projectId: 1, name: '云无心', role: 'npc', roleWeight: 'npc',
    moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: '客栈老板', appearance: '满脸风霜', personality: '',
    background: '', motivation: '', abilities: '', relationships: '', arc: '',
    createdAt: now, updatedAt: now, ...over,
  }
}

describe('R-C1-character-supplement', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('adopt(recordId, merge-diffs) 只更新补全字段，保留既有、不动未选维度', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({ name: 'P', genre: 'wuxia', createdAt: now, updatedAt: now } as any) as number
    const id = await db.characters.add(makeChar({ projectId }) as any) as number

    // 模拟 AI 补全 personality / values / goals（A 新增的扩展维度字段）
    const patch = { personality: '外冷内热', values: '义字当先', goals: '重开分号' }
    const result = await adopt({ projectId, target: 'characters', recordId: id, mode: 'merge-diffs', data: patch })
    expect(result.written[0]?.id).toBe(id)

    const row = await db.characters.get(id)
    // 补全字段已落库（含 A 扩展的 values/goals → 证 FIELD_REGISTRY 已登记）
    expect(row!.personality).toBe('外冷内热')
    expect((row as any).values).toBe('义字当先')
    expect((row as any).goals).toBe('重开分号')
    // 既有字段保留，未选维度仍为空（不被覆盖）
    expect(row!.appearance).toBe('满脸风霜')
    expect(row!.shortDescription).toBe('客栈老板')
    expect(row!.background).toBe('')
  })

  it('adopt(recordId) 拒绝跨项目记录（不属于本项目不写）', async () => {
    const now = Date.now()
    const p1 = await db.projects.add({ name: 'P1', createdAt: now, updatedAt: now } as any) as number
    const p2 = await db.projects.add({ name: 'P2', createdAt: now, updatedAt: now } as any) as number
    const id = await db.characters.add(makeChar({ projectId: p1 }) as any) as number
    const result = await adopt({ projectId: p2, target: 'characters', recordId: id, mode: 'merge-diffs', data: { personality: '篡改' } })
    expect(result.written).toHaveLength(0)
    expect((await db.characters.get(id))!.personality).toBe('') // 未被改
  })
})
