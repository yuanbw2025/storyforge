/**
 * 词条化重构 Stage B0 · 内置分类 seed 锁定
 *
 * 锁定当前能力:
 * ① ensureBuiltIns 播种全部内置分类;② 幂等(重复调用不重复建);
 * ③ 内置分类的 fieldSchema 含 ref 字段(材料↔成品关联能力的基础)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { BUILTIN_CATEGORIES, parseFieldSchema, type BuiltInCodexKey } from '../../src/lib/types/codex'
import { seedCurrentProject } from '../helpers/current-workspace'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await seedCurrentProject({
    name: 'CodexB0', genres: [], description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

describe('Codex B0 · 内置分类 seed', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('ensureBuiltIns 播种全部内置分类', async () => {
    const projectId = await createProject()
    await useCodexStore.getState().ensureBuiltIns(projectId)
    const cats = await db.codexCategories.where('projectId').equals(projectId).toArray()
    const builtins = cats.filter(c => !!c.builtInKey)
    expect(builtins.length).toBe(BUILTIN_CATEGORIES.length)
    expect(builtins.some(row => row.builtInKey === 'humEra' || row.builtInKey === 'humEvent')).toBe(false)
    // 关键内置类都在
    const keys = builtins.map(c => c.builtInKey)
    for (const k of [
      'mineral', 'herb', 'beast', 'race', 'faction', 'city', 'artifact',
      'humPolitics', 'humEconomy', 'humCulture',
    ]) {
      expect(keys).toContain(k)
    }
  })

  it('幂等:重复 ensureBuiltIns 不重复建', async () => {
    const projectId = await createProject()
    await useCodexStore.getState().ensureBuiltIns(projectId)
    await useCodexStore.getState().ensureBuiltIns(projectId)
    const cnt = await db.codexCategories.where('projectId').equals(projectId)
      .filter(c => !!c.builtInKey).count()
    expect(cnt).toBe(BUILTIN_CATEGORIES.length)
  })

  it('并发锁:同时并发 ensureBuiltIns 不产生重复(根治 race)', async () => {
    const projectId = await createProject()
    const store = useCodexStore.getState()
    // 并发触发两次(模拟 StrictMode 双调用 / 多面板同时挂载)
    await Promise.all([store.ensureBuiltIns(projectId), store.ensureBuiltIns(projectId)])
    const builtins = (await db.codexCategories.where('projectId').equals(projectId).toArray())
      .filter(c => !!c.builtInKey)
    // 每个内置 key 只有一条,总数 == 内置分类数(不翻倍)
    expect(builtins.length).toBe(BUILTIN_CATEGORIES.length)
    const byKey = new Map<string, number>()
    for (const c of builtins) byKey.set(c.builtInKey!, (byKey.get(c.builtInKey!) ?? 0) + 1)
    for (const n of byKey.values()) expect(n).toBe(1)
  })

  it('补齐与并发播种不改写旧历史、混用分类、子树、词条引用或其他工作区', async () => {
    const projectId = await createProject()
    const foreignProjectId = await createProject()
    const store = useCodexStore.getState()
    const addCategory = (name: string, builtInKey?: BuiltInCodexKey, parentId: number | null = null, owner = projectId) =>
      store.addCategory({ projectId: owner, domain: 'humanity', parentId, name, builtInKey, fieldSchema: '[]', order: 0 })
    const era = await addCategory('作者沿用的时代分类', 'humEra')
    const mixed = await addCategory('地方器物与习俗', 'humEvent')
    const child = await addCategory('作者自己的子类', undefined, mixed)
    await addCategory('原政经文化', 'humSociety')
    await addCategory('另一工作区旧事件', 'humEvent', null, foreignProjectId)
    const addEntry = (categoryId: number, name: string) => store.addEntry({
      projectId, categoryId, name, summary: '原作者简介', description: '不按旧key猜删或重写', fields: '{}', refs: '{}', order: 0,
    })
    const entryId = await addEntry(child, '旧灯具')
    await addEntry(era, '作者旧纪年')
    const linkedId = await addEntry(mixed, '换班礼')
    await store.updateEntry(linkedId, { refs: JSON.stringify({ related: [entryId] }) })
    const categories = await db.codexCategories.toArray()
    const entries = await db.codexEntries.toArray()
    await Promise.all([store.ensureBuiltIns(projectId), store.ensureBuiltIns(projectId)])
    await store.ensureBuiltIns(projectId)
    expect(await db.codexCategories.bulkGet(categories.map(row => row.id!))).toEqual(categories)
    expect(await db.codexEntries.bulkGet(entries.map(row => row.id!))).toEqual(entries)
    const current = await db.codexCategories.where('projectId').equals(projectId).toArray()
    expect(current.filter(row => row.builtInKey === 'humEra').map(row => row.id)).toEqual([era])
    expect(current.filter(row => row.builtInKey === 'humEvent').map(row => row.id)).toEqual([mixed])
    expect(current.some(row => row.builtInKey === 'artifact')).toBe(true)
  })

  it('内置分类的 fieldSchema 含 ref 字段(材料↔成品基础)', async () => {
    const projectId = await createProject()
    await useCodexStore.getState().ensureBuiltIns(projectId)
    const mineral = (await db.codexCategories.where('projectId').equals(projectId).toArray())
      .find(c => c.builtInKey === 'mineral')!
    const schema = parseFieldSchema(mineral.fieldSchema)
    const refField = schema.find(f => f.type === 'ref')
    expect(refField).toBeTruthy()             // 矿物有"可炼器物"这种 ref 字段
    expect(refField?.refCategory).toBe('artifact')
  })
})
