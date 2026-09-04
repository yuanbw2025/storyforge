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
import { BUILTIN_CATEGORIES, parseFieldSchema } from '../../src/lib/types/codex'
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
