/**
 * 词条化重构 Stage B0 · 内置分类 seed 锁定
 *
 * 锁住 35-a 已建好的地基(防回潮):
 * ① ensureBuiltIns 播种全部内置分类;② 幂等(重复调用不重复建);
 * ③ 内置分类的 fieldSchema 含 ref 字段(材料↔成品关联能力的基础)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { BUILTIN_CATEGORIES, parseFieldSchema } from '../../src/lib/types/codex'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'CodexB0', genre: '', description: '', targetWordCount: 0,
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
    // 关键内置类都在
    const keys = builtins.map(c => c.builtInKey)
    for (const k of ['mineral', 'herb', 'beast', 'race', 'faction', 'city', 'artifact']) {
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

  it('自愈去重:历史重复的内置分类被合并,词条不丢失', async () => {
    const projectId = await createProject()
    const ts = Date.now()
    // 手动造一份"每类两条"的重复(模拟旧 race 残留)
    for (let pass = 0; pass < 2; pass++) {
      for (const seed of BUILTIN_CATEGORIES) {
        await db.codexCategories.add({
          projectId, domain: seed.domain, parentId: null, name: seed.name,
          icon: seed.icon, builtInKey: seed.builtInKey, fieldSchema: '[]',
          hidden: false, order: 0, worldGroupId: null, createdAt: ts, updatedAt: ts,
        } as any)
      }
    }
    const dupCats = await db.codexCategories.where('projectId').equals(projectId)
      .filter(c => c.builtInKey === 'mineral').toArray()
    expect(dupCats.length).toBe(2)
    // 把一条词条挂在"将被删除"的那条重复分类下(id 较大者)
    const toBeDeleted = dupCats.sort((a, b) => (b.id! - a.id!))[0]
    const keptId = dupCats.sort((a, b) => (a.id! - b.id!))[0].id!
    await db.codexEntries.add({
      projectId, categoryId: toBeDeleted.id!, name: '玄铁精', summary: '',
      description: '', fields: '{}', order: 0, worldGroupId: null,
      createdAt: ts, updatedAt: ts,
    } as any)

    await useCodexStore.getState().ensureBuiltIns(projectId)

    // 每个内置 key 只剩一条
    const after = await db.codexCategories.where('projectId').equals(projectId)
      .filter(c => !!c.builtInKey).toArray()
    expect(after.length).toBe(BUILTIN_CATEGORIES.length)
    // 词条改挂到了保留项,没丢
    const entry = (await db.codexEntries.where('projectId').equals(projectId).toArray())
      .find(e => e.name === '玄铁精')!
    expect(entry).toBeTruthy()
    expect(entry.categoryId).toBe(keptId)
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
