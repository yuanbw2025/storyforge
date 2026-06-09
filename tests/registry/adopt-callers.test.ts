/**
 * Phase 1.2b · 现有写回调用方切换到 adopt()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useWorldviewStore } from '../../src/stores/worldview'
import { applyChunkResult } from '../../src/lib/import/chunk-writer'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'Adopt callers',
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
}

describe('Phase 1.2b · adopt 调用方迁移', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('saveWorldview 薄壳走 adopt,内存为空时不会重复创建单例', async () => {
    const projectId = await createProject()
    const store = useWorldviewStore.getState()

    await store.loadAll(projectId)
    await store.saveWorldview({ projectId, worldOrigin: '创世炉火' })
    useWorldviewStore.setState({ worldview: null })
    await store.saveWorldview({ projectId, powerHierarchy: '凡人 / 修士' })

    const rows = await db.worldviews.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].worldOrigin).toBe('创世炉火')
    expect(rows[0].powerHierarchy).toBe('凡人 / 修士')
  })

  it('chunk-writer 写入角色走 adopt,同名角色合并而不是新增重复行', async () => {
    const projectId = await createProject()

    await applyChunkResult(projectId, {
      characters: [{
        name: '燕飞',
        role: '主角',
        shortDescription: '旧王血脉',
        appearance: '',
        personality: '',
        background: '',
        motivation: '',
        abilities: '',
        relationships: '',
        arc: '',
      }],
    })
    await applyChunkResult(projectId, {
      characters: [{
        name: '燕飞',
        role: 'protagonist',
        shortDescription: '旧王血脉',
        appearance: '黑衣负剑',
        personality: '',
        background: '',
        motivation: '',
        abilities: '',
        relationships: '',
        arc: '',
      }],
    })

    const rows = await db.characters.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('燕飞')
    expect(rows[0].role).toBe('protagonist')
    expect(rows[0].appearance).toBe('黑衣负剑')
  })
})
