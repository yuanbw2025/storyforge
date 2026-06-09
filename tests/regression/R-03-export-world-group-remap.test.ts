/**
 * R-3: 多世界导出/导入 worldGroupId remap 正确性
 *
 * 对应 MASTER-BLUEPRINT §4.0.4 / BUG-EXPORT-WG。
 *
 * 反例:
 *   worldGroups 导出使用 _exportId 序号,但其它表保留原始 DB worldGroupId。
 *   导入时用原始 id 去查 exportId 映射,导致归属清空或串台。
 *
 * 期望:
 *   导出只写 _worldGroupExportId/_homeWorldGroupExportId,
 *   导入后所有 worldScoped/homeWorldScoped 表都归属到导入后的对应世界组。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

describe('R-03: 多世界导出/导入 worldGroupId remap', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('导入后所有 worldScoped 表归属到导入后的副世界', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'R-03 多世界项目',
      genre: 'fantasy',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: true,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const primaryId = await db.worldGroups.add({
      projectId,
      name: '主世界',
      type: 'primary',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const sideId = await db.worldGroups.add({
      projectId,
      name: '斗破',
      type: 'parallel',
      order: 1,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const categoryId = await db.codexCategories.add({
      projectId,
      worldGroupId: sideId,
      domain: 'natural',
      parentId: null,
      name: '灵材',
      fieldSchema: '[]',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    await db.worldviews.add({ projectId, worldGroupId: sideId, geography: '', history: '', society: '', culture: '', economy: '', rules: '', summary: '', createdAt: now, updatedAt: now } as any)
    await db.powerSystems.add({ projectId, worldGroupId: sideId, name: '斗气', description: '', levels: '[]', rules: '', createdAt: now, updatedAt: now } as any)
    await db.characters.add({ projectId, homeWorldGroupId: sideId, name: '萧炎', role: 'protagonist', shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '', createdAt: now, updatedAt: now } as any)
    await db.outlineNodes.add({ projectId, worldGroupId: sideId, parentId: null, type: 'volume', title: '斗破卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any)
    await db.geographies.add({ projectId, worldGroupId: sideId, overview: '', locations: '[]', createdAt: now, updatedAt: now } as any)
    await db.histories.add({ projectId, worldGroupId: sideId, overview: '', eraSystem: '', events: '[]', createdAt: now, updatedAt: now } as any)
    await db.worldNodes.add({ projectId, worldGroupId: sideId, parentId: null, name: '斗气大陆', description: '', sortOrder: 0, createdAt: now, updatedAt: now } as any)
    await db.historicalTimelineEvents.add({ projectId, worldGroupId: sideId, era: 'custom', year: 1, date: '元年', title: '开端', description: '', isHistorical: false, createdAt: now, updatedAt: now } as any)
    await db.historicalKeywords.add({ projectId, worldGroupId: sideId, keyword: '异火', category: 'technology', era: 'custom', description: '', createdAt: now, updatedAt: now } as any)
    await db.codexEntries.add({ projectId, worldGroupId: sideId, categoryId, name: '青莲地心火', summary: '', description: '', fields: '{}', refs: '{}', order: 0, createdAt: now, updatedAt: now } as any)
    await db.worldRulesProfiles.add({ projectId, worldGroupId: sideId, entries: {}, customNodes: [], globalNote: '斗气世界规则', createdAt: now, updatedAt: now } as any)
    await db.worldGroupLinks.add({ projectId, fromGroupId: primaryId, toGroupId: sideId, type: 'portal', createdAt: now } as any)

    const exported = await exportProjectJSON(projectId)
    expect((exported.worldviews[0] as any).worldGroupId).toBeUndefined()
    expect((exported.worldviews[0] as any)._worldGroupExportId).toBe(1)
    expect((exported.worldRulesProfiles?.[0] as any).worldGroupId).toBeUndefined()
    expect((exported.worldRulesProfiles?.[0] as any)._worldGroupExportId).toBe(1)
    expect((exported.characters[0] as any).homeWorldGroupId).toBeUndefined()
    expect((exported.characters[0] as any)._homeWorldGroupExportId).toBe(1)

    const importedProjectId = await importProjectJSON(exported)
    const importedSide = await db.worldGroups
      .where('projectId').equals(importedProjectId)
      .filter(group => group.name === '斗破')
      .first()
    expect(importedSide?.id).toBeTypeOf('number')
    expect(importedSide!.id).not.toBe(sideId)

    const importedSideId = importedSide!.id!
    const countWorldGroupId = async <T extends { worldGroupId?: number | null }>(
      table: { where: (key: string) => { equals: (value: number) => { toArray: () => Promise<T[]> } } },
    ) => (await table.where('projectId').equals(importedProjectId).toArray())
      .filter(row => row.worldGroupId === importedSideId).length

    expect(await countWorldGroupId(db.worldviews)).toBe(1)
    expect(await countWorldGroupId(db.powerSystems)).toBe(1)
    expect(await countWorldGroupId(db.outlineNodes)).toBe(1)
    expect(await countWorldGroupId(db.geographies)).toBe(1)
    expect(await countWorldGroupId(db.histories)).toBe(1)
    expect(await countWorldGroupId(db.worldNodes)).toBe(1)
    expect(await countWorldGroupId(db.historicalTimelineEvents)).toBe(1)
    expect(await countWorldGroupId(db.historicalKeywords)).toBe(1)
    expect(await countWorldGroupId(db.codexCategories)).toBe(1)
    expect(await countWorldGroupId(db.codexEntries)).toBe(1)
    expect(await countWorldGroupId(db.worldRulesProfiles)).toBe(1)

    const chars = await db.characters.where('projectId').equals(importedProjectId).toArray()
    expect(chars.filter(char => char.homeWorldGroupId === importedSideId)).toHaveLength(1)
  })
})
