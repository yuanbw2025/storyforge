/**
 * Codex C6（全貌+词条 基座）· 分类全貌 overview + 词条重要度星级
 *
 * 锁定:① 分类 overview(全貌)能持久化(零 DB 迁移,非索引字段);
 *       ② 词条 importance(1-5 星)能持久化;
 *       ③ AI 词条上下文按 importance 降序排(高星优先)并标星。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { buildCodexContext } from '../../src/lib/ai/codex-context'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'C6', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

async function cityCategory(pid: number) {
  return (await db.codexCategories.where('projectId').equals(pid).toArray())
    .find(c => c.builtInKey === 'city')!
}

describe('Codex C6 · 分类全貌 + 词条星级', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('importance(星级)能持久化', async () => {
    const pid = await createProject()
    const store = useCodexStore.getState()
    await store.loadAll(pid)
    const cat = await cityCategory(pid)
    const id = await store.addEntry({
      projectId: pid, categoryId: cat.id!, name: '落日城', summary: '', description: '',
      fields: '{}', order: 0, worldGroupId: null,
    } as any)
    await store.updateEntry(id, { importance: 4 })
    const e = await db.codexEntries.get(id)
    expect(e!.importance).toBe(4)
  })

  it('AI 上下文:高星词条优先排序并标星', async () => {
    const pid = await createProject()
    const store = useCodexStore.getState()
    await store.loadAll(pid)
    const cat = await cityCategory(pid)
    await store.addEntry({ projectId: pid, categoryId: cat.id!, name: '小村', summary: '', description: '', fields: '{}', importance: 1, order: 0, worldGroupId: null } as any)
    await store.addEntry({ projectId: pid, categoryId: cat.id!, name: '王都', summary: '', description: '', fields: '{}', importance: 5, order: 1, worldGroupId: null } as any)

    const ctx = await buildCodexContext(pid, null)
    expect(ctx).toContain('★★★★★ 王都')
    expect(ctx.indexOf('王都')).toBeLessThan(ctx.indexOf('小村'))
  })
})
