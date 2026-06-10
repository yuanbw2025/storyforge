/**
 * R-export-import-roundtrip · 全量内容导出 → 导入 往返完整性
 *
 * 目的(用户安全网验证):用户把世界观/故事核心/大纲/细纲/正文/角色/状态卡/物品台账
 * 都做好后,导出 JSON,再导入,所有内容必须**一字不丢、外键关系完整**。
 * Gist 云存档复用同一 ProjectExportData 格式,故此测试同时覆盖云存档。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const now = Date.now()

async function seedFullProject(): Promise<number> {
  const projectId = await db.projects.add({
    name: '完整作品', genre: 'fantasy', description: '测试往返', targetWordCount: 100000,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number

  await db.worldviews.add({
    projectId, worldOrigin: '由造物主从混沌创世', powerHierarchy: '炼气→筑基→金丹',
    races: '人族/妖族/灵族', factionLayout: '三大宗门鼎立', createdAt: now, updatedAt: now,
  } as any)
  await db.storyCores.add({
    projectId, logline: '少年逆袭成仙', theme: '成长与抉择', centralConflict: '宿命对抗',
    mainPlot: '从山村到仙界', createdAt: now, updatedAt: now,
  } as any)

  const volId = await db.outlineNodes.add({
    projectId, parentId: null, type: 'volume', title: '第一卷 风起山村', summary: '开篇',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const chapNodeId = await db.outlineNodes.add({
    projectId, parentId: volId, type: 'chapter', title: '第1章 觉醒', summary: '主角觉醒',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number

  await db.detailedOutlines.add({
    projectId, outlineNodeId: chapNodeId, openingHook: '承接序章', endingCliffhanger: '黑影现身',
    scenes: [{ sceneId: 's1', title: '废墟苏醒', summary: '主角醒来', characterIds: [], location: '废墟', conflict: '失忆', pace: 'normal', estimatedWords: 800, notes: '' }],
    createdAt: now, updatedAt: now,
  } as any)
  await db.chapters.add({
    projectId, outlineNodeId: chapNodeId, title: '第1章 觉醒',
    content: '<p>主角在废墟中睁开眼，记忆一片空白……</p>', wordCount: 18, status: 'draft', order: 0, notes: '',
    createdAt: now, updatedAt: now,
  } as any)
  await db.characters.add({
    projectId, name: '林惊羽', role: 'protagonist', shortDescription: '天才剑修',
    personality: '坚毅', background: '灭门遗孤', createdAt: now, updatedAt: now,
  } as any)
  await db.stateCards.add({
    projectId, category: 'character', entityName: '林惊羽',
    fields: JSON.stringify([{ key: '境界', value: '炼气一层' }]), createdAt: now, updatedAt: now,
  } as any)
  await db.itemLedger.add({
    projectId, itemName: '青锋剑', action: 'gain', quantity: 1, chapterId: null,
    chapterTitle: '第1章 觉醒', createdAt: now, updatedAt: now,
  } as any)

  return projectId
}

describe('R-roundtrip · 全量内容导出→导入往返', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('导出再导入:世界观/故事/大纲/细纲/正文/角色/状态/物品 全部还原且外键完整', async () => {
    const srcId = await seedFullProject()
    const exported = await exportProjectJSON(srcId)
    const newId = await importProjectJSON(exported)
    expect(newId).not.toBe(srcId)

    // 各表内容都在新项目里
    const wv = await db.worldviews.where('projectId').equals(newId).first()
    expect(wv?.worldOrigin).toContain('造物主')
    expect(wv?.powerHierarchy).toContain('金丹')

    const sc = await db.storyCores.where('projectId').equals(newId).first()
    expect(sc?.logline).toContain('逆袭')
    expect(sc?.mainPlot).toContain('仙界')

    const outline = await db.outlineNodes.where('projectId').equals(newId).toArray()
    expect(outline.filter(n => n.type === 'volume').length).toBe(1)
    const newChap = outline.find(n => n.type === 'chapter')!
    expect(newChap.title).toContain('觉醒')

    const detail = await db.detailedOutlines.where('projectId').equals(newId).first()
    expect(detail?.scenes?.[0]?.title).toBe('废墟苏醒')
    expect(detail?.outlineNodeId).toBe(newChap.id) // 细纲外键重映射到新章节节点

    const chapter = await db.chapters.where('projectId').equals(newId).first()
    expect(chapter?.content).toContain('废墟中睁开眼')
    expect(chapter?.outlineNodeId).toBe(newChap.id) // 正文外键重映射正确

    const char = await db.characters.where('projectId').equals(newId).first()
    expect(char?.name).toBe('林惊羽')

    const state = await db.stateCards.where('projectId').equals(newId).first()
    expect(state?.entityName).toBe('林惊羽')
    expect(state?.fields).toContain('炼气一层')

    const item = await db.itemLedger.where('projectId').equals(newId).first()
    expect(item?.itemName).toBe('青锋剑')
  })

  it('二次往返(导入后再导出再导入)仍完整(可反复导入)', async () => {
    const srcId = await seedFullProject()
    const e1 = await exportProjectJSON(srcId)
    const id2 = await importProjectJSON(e1)
    const e2 = await exportProjectJSON(id2)   // 从导入的项目再导出
    const id3 = await importProjectJSON(e2)    // 再导入一次
    const chapter = await db.chapters.where('projectId').equals(id3).first()
    expect(chapter?.content).toContain('废墟中睁开眼')
    const detail = await db.detailedOutlines.where('projectId').equals(id3).first()
    expect(detail?.scenes?.[0]?.title).toBe('废墟苏醒')
  })
})
