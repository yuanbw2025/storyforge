/**
 * R-export-derive-roundtrip · 当前派生引擎完整往返
 *
 * AUDIT-1 导入安全闸:
 * ① 派生导出 → 派生导入:原表行与复核证据保留 + 外键/树/世界组重映射正确。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { BACKUP_REFERENCE_REVIEW_TITLE } from '../../src/lib/export/backup-trust'
import { seedFullProject, EXPORTABLE_PROJECT_TABLES } from '../helpers/seed-full-project'
import { parseWorldPortals } from '../../src/lib/utils/world-portals'

async function tableCount(name: string, projectId: number): Promise<number> {
  return await (db as any)[name].where('projectId').equals(projectId).count()
}

/** 原表行数保留；notes 另以完整便携内容验证新增复核证据。 */
async function expectSameCounts(srcId: number, newId: number, exportedNoteCount: number, tableNames = EXPORTABLE_PROJECT_TABLES) {
  for (const name of tableNames) {
    const a = await tableCount(name, srcId)
    const b = await tableCount(name, newId)
    expect(b, `表 ${name} 往返后行数应一致`).toBe(name === 'notes' ? exportedNoteCount : a)
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

  it('① 派生导出 → 派生导入:原表行与复核证据保留 + 外键重映射正确', async () => {
    const { projectId } = await seedFullProject()
    const sourceNotes = await db.notes.where('projectId').equals(projectId).toArray()
    const sourceModule = await db.narrativeModules.where('projectId').equals(projectId).first()
    expect(sourceModule?.sourceProjection).toBe('outline')
    expect(sourceModule?.ragDocumentId).toMatch(/^res:v1:narrative-module:/)
    const exported = await exportProjectJSON(projectId)        // 现已转发到派生引擎
    // The legacy outline locator is evidence, not permission to guess a current FK.
    const reviews = exported.notes.filter(note => note.content.startsWith(BACKUP_REFERENCE_REVIEW_TITLE))
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({
      _workOwnerExportId: exported.ownership.workExportId, _chapterExportId: null,
      color: 'yellow', pinned: true,
    })
    expect(reviews[0].content.split('\n').slice(3).map(line => JSON.parse(line))).toEqual([{
      来源表: 'narrativeModules', 原行序号: 0, 便携行键: 0, 资源UID: sourceModule!.ragDocumentId,
      字段: 'sourceRefId', 原值: sourceModule!.sourceRefId, 原因: '来源类型没有可确认的关联目标',
    }])
    expect(exported.notes).toHaveLength(sourceNotes.length + 1)
    for (const note of sourceNotes) {
      const authorValues = Object.fromEntries(Object.entries(note)
        .filter(([key]) => !['id', 'projectId', 'worldId', 'workId', 'chapterId'].includes(key)))
      expect(exported.notes).toContainEqual(expect.objectContaining(authorValues))
    }
    const newId = await importProjectJSON(exported)
    expect(newId).not.toBe(projectId)
    await expectSameCounts(projectId, newId, exported.notes.length)
    expect(await db.notes.where('projectId').equals(projectId).toArray()).toEqual(sourceNotes)
    expect((await exportProjectJSON(newId)).notes).toEqual(exported.notes)
    expect(await db.narrativeModules.where('projectId').equals(newId).first()).toMatchObject({
      title: sourceModule!.title, description: sourceModule!.description, sourceProjection: 'outline', sourceRefId: null,
    })
    await expectKeysRemapped(newId)
  })
})
