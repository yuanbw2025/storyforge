/**
 * 词条化重构 Stage B4 · 人文环境嵌入
 *
 * 锁定:人文域能拿到实体类与拆分后的政治/经济/文化类，且每类只有一条。
 * 这是 B4「人文面板内嵌种族/势力/城池/器物词条区」的数据契约。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCodexStore } from '../../src/stores/codex'
import { seedCurrentProject } from '../helpers/current-workspace'

async function createProject(): Promise<number> {
  const now = Date.now()
  return seedCurrentProject({
    name: 'CodexB4', genres: [], description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

describe('Codex B4 · 人文环境嵌入', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('人文域含实体与政治/经济/文化拆分类，各唯一', async () => {
    const projectId = await createProject()
    const store = useCodexStore.getState()
    await store.loadAll(projectId)

    const humanity = store.getCategoriesByDomain('humanity', null)
    const keys = humanity.map(c => c.builtInKey).filter(Boolean)
    for (const k of [
      'race', 'faction', 'city', 'artifact',
      'humPolitics', 'humEconomy', 'humCulture',
    ]) {
      expect(keys.filter(x => x === k).length).toBe(1)  // 存在且唯一
    }
  })

  it('自然域与人文域分离:fixedDomain 过滤后互不串台', async () => {
    const projectId = await createProject()
    const store = useCodexStore.getState()
    await store.loadAll(projectId)

    const natural = store.getCategoriesByDomain('natural', null).map(c => c.builtInKey)
    const humanity = store.getCategoriesByDomain('humanity', null).map(c => c.builtInKey)
    expect(natural).toContain('mineral')
    expect(natural).not.toContain('race')      // 自然域不含人文类
    expect(humanity).toContain('race')
    expect(humanity).not.toContain('mineral')  // 人文域不含自然类
  })
})
