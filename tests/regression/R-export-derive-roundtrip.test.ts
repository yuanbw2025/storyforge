/**
 * R-export-derive-roundtrip · 当前派生引擎完整往返
 *
 * AUDIT-1 导入安全闸:
 * ① 派生导出 → 派生导入:全表行数一致 + 外键/树/世界组重映射正确。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { seedFullProject, EXPORTABLE_PROJECT_TABLES } from '../helpers/seed-full-project'
import { parseWorldPortals } from '../../src/lib/utils/world-portals'

async function tableCount(name: string, projectId: number): Promise<number> {
  return await (db as any)[name].where('projectId').equals(projectId).count()
}

/** 断言新项目每张项目级表行数与源一致 */
async function expectSameCounts(srcId: number, newId: number, tableNames = EXPORTABLE_PROJECT_TABLES) {
  for (const name of tableNames) {
    const a = await tableCount(name, srcId)
    const b = await tableCount(name, newId)
    expect(b, `表 ${name} 往返后行数应一致`).toBe(a)
  }
}

/** 断言新项目核心外键/树/世界组重映射正确 */
async function expectKeysRemapped(newId: number) {
  const groups = await db.worldGroups.where('projectId').equals(newId).sortBy('order')
  expect(groups).toHaveLength(2)
  const newWgA = groups[0].id!

  const outline = await db.outlineNodes.where('projectId').equals(newId).toArray()
  const vol = outline.find(n => n.type === 'volume')!
  const chapNode = outline.find(n => n.type === 'chapter')!
  expect(chapNode.parentId).toBe(vol.id)
  expect(chapNode.worldGroupId).toBe(newWgA)

  const chapter = await db.chapters.where('projectId').equals(newId).first()
  expect(chapter!.outlineNodeId).toBe(chapNode.id)
  expect(chapter!.content).toContain('废墟中睁眼')

  const cats = await db.codexCategories.where('projectId').equals(newId).toArray()
  const subCat = cats.find(c => c.name === '宗门')!
  expect(subCat.parentId).toBe(cats.find(c => c.name === '势力')!.id)
  const entry = await db.codexEntries.where('projectId').equals(newId).first()
  expect(entry!.categoryId).toBe(subCat.id)

  const worldNodes = await db.worldNodes.where('projectId').equals(newId).toArray()
  const root = worldNodes.find(n => n.name === '主世界')!
  const mirror = worldNodes.find(n => n.name === '镜界')!
  expect(mirror.parentId).toBe(root.id)
  const portals = parseWorldPortals(root.portalsJSON)
  expect(portals).toHaveLength(1)
  expect(portals[0].targetWorldId).toBe(mirror.id)
}

describe('R-export-derive-roundtrip · 当前派生往返', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('① 派生导出 → 派生导入:全表行数一致 + 外键重映射正确', async () => {
    const { projectId } = await seedFullProject()
    const exported = await exportProjectJSON(projectId)        // 现已转发到派生引擎
    const newId = await importProjectJSON(exported)
    expect(newId).not.toBe(projectId)
    await expectSameCounts(projectId, newId)
    await expectKeysRemapped(newId)
  })
})
