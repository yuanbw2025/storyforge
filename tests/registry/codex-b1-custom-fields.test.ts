/**
 * 词条化重构 Stage B1 · 自定义专属字段
 *
 * 锁定"用户可自定义词条专属字段"的数据路径(管理字段 UI 背后的逻辑):
 * 改分类的 fieldSchema(增字段/select选项/ref关联)经 updateCategory 持久化,
 * 且零 DB 迁移(改的是 fieldSchema JSON)。内置类也能改。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { parseFieldSchema, stringifyFieldSchema, type CodexFieldDef } from '../../src/lib/types/codex'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'CodexB1', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

describe('Codex B1 · 自定义专属字段', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('自定义分类:可加专属字段并持久化(含 select / ref)', async () => {
    const projectId = await createProject()
    const store = useCodexStore.getState()
    await store.loadAll(projectId)
    const catId = await store.addCategory({
      projectId, domain: 'natural', parentId: null, name: '阵法',
      icon: '🔯', fieldSchema: '[]', hidden: false, order: 99, worldGroupId: null,
    } as any)
    const newFields: CodexFieldDef[] = [
      { key: 'tier', label: '品级', type: 'select', options: ['一品', '二品', '三品'] },
      { key: 'mat', label: '所需材料', type: 'ref', refCategory: 'mineral' },
    ]
    await store.updateCategory(catId, { fieldSchema: stringifyFieldSchema(newFields) })

    const cat = await db.codexCategories.get(catId)
    const schema = parseFieldSchema(cat!.fieldSchema)
    expect(schema.map(f => f.label)).toEqual(['品级', '所需材料'])
    expect(schema.find(f => f.key === 'tier')?.options).toEqual(['一品', '二品', '三品'])
    expect(schema.find(f => f.key === 'mat')?.refCategory).toBe('mineral')
  })

  it('内置分类的字段也可改(增一个自定义字段)', async () => {
    const projectId = await createProject()
    const store = useCodexStore.getState()
    await store.ensureBuiltIns(projectId)
    const mineral = (await db.codexCategories.where('projectId').equals(projectId).toArray())
      .find(c => c.builtInKey === 'mineral')!
    const schema = parseFieldSchema(mineral.fieldSchema)
    const before = schema.length
    schema.push({ key: 'myown', label: '我的字段', type: 'text' })
    await store.updateCategory(mineral.id!, { fieldSchema: stringifyFieldSchema(schema) })

    const after = parseFieldSchema((await db.codexCategories.get(mineral.id!))!.fieldSchema)
    expect(after.length).toBe(before + 1)
    expect(after.some(f => f.label === '我的字段')).toBe(true)
    // 仍是内置类(builtInKey 不变)
    expect((await db.codexCategories.get(mineral.id!))!.builtInKey).toBe('mineral')
  })
})
