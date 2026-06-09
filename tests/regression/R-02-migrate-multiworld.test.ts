/**
 * R-2: migrateToMultiWorld 事务作用域完整性
 *
 * 对应 MASTER-BLUEPRINT §4.0.2。
 *
 * 反例:
 *   migrateToMultiWorld 的事务声明没有包含 codexEntries,
 *   但事务体内会 stamp(db.codexEntries, ...),导致 Dexie 抛事务作用域错误。
 *
 * 期望:
 *   开启多世界不抛错,已有 codexEntries 全部盖章到主世界。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'

describe('R-02: migrateToMultiWorld 事务作用域完整性', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('开启多世界后,已有词条全部归属主世界', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'R-02 测试项目',
      genre: 'fantasy',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const categoryId = await db.codexCategories.add({
      projectId,
      domain: 'natural',
      parentId: null,
      name: '灵材',
      fieldSchema: '[]',
      order: 0,
      worldGroupId: null,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    await db.codexEntries.bulkAdd([
      {
        projectId,
        categoryId,
        name: '玄铁',
        summary: '',
        description: '',
        fields: '{}',
        refs: '{}',
        order: 0,
        worldGroupId: null,
        createdAt: now,
        updatedAt: now,
      } as any,
      {
        projectId,
        categoryId,
        name: '灵草',
        summary: '',
        description: '',
        fields: '{}',
        refs: '{}',
        order: 1,
        worldGroupId: null,
        createdAt: now,
        updatedAt: now,
      } as any,
    ])

    const { useWorldGroupStore } = await import('../../src/stores/world-group')

    await expect(useWorldGroupStore.getState().migrateToMultiWorld(projectId)).resolves.not.toThrow()

    const primary = await db.worldGroups
      .where('projectId').equals(projectId)
      .filter(group => group.type === 'primary')
      .first()
    expect(primary?.id).toBeTypeOf('number')

    const entries = await db.codexEntries.where('projectId').equals(projectId).toArray()
    expect(entries).toHaveLength(2)
    expect(entries.filter(entry => entry.worldGroupId == null)).toHaveLength(0)
    expect(entries.every(entry => entry.worldGroupId === primary!.id)).toBe(true)
  })
})
