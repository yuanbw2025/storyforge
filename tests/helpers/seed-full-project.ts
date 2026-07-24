/**
 * 全量项目种子 · 测试共享 helper
 *
 * 覆盖全部 31 张 exportable 表 + 双世界组 + 树 + 各类外键。
 * 供 R-export-fullcoverage(往返安全网)与 R-export-derive-equivalence(派生等价性)共用。
 */
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'

const now = 1_700_000_000_000 // 固定时间戳,保证派生/手写两版导出可逐字段比对

/** 种子:每张 exportable 表至少一行,带双世界组 + 树 + 各类外键。返回各源 id 便于断言。 */
export async function seedFullProject() {
  const projectId = await db.projects.add({
    name: '全量作品', genre: 'fantasy', genres: ['fantasy'], description: '全表往返',
    targetWordCount: 100000, enableMultiWorld: true, createdAt: now, updatedAt: now,
  } as any) as number

  // ── 双世界组(order 决定导出序) ──
  const wgA = await db.worldGroups.add({ projectId, name: '主世界群', order: 0, createdAt: now, updatedAt: now } as any) as number
  const wgB = await db.worldGroups.add({ projectId, name: '镜世界群', order: 1, createdAt: now, updatedAt: now } as any) as number
  await db.worldGroupLinks.add({ projectId, fromGroupId: wgA, toGroupId: wgB, type: 'portal', createdAt: now, updatedAt: now } as any)

  // ── worldScoped 设定表(挂 wgA / wgB,验证 worldGroupId 重映射) ──
  await db.worldviews.add({ projectId, worldGroupId: wgA, worldOrigin: '混沌创世', powerHierarchy: '炼气→金丹', createdAt: now, updatedAt: now } as any)
  await db.worldviews.add({ projectId, worldGroupId: wgB, worldOrigin: '镜中倒影', createdAt: now, updatedAt: now } as any)
  await db.storyCores.add({ projectId, logline: '少年逆袭', mainPlot: '从山村到仙界', createdAt: now, updatedAt: now } as any)
  await db.powerSystems.add({ projectId, worldGroupId: wgA, name: '修真体系', description: '九重天', createdAt: now, updatedAt: now } as any)
  await db.geographies.add({ projectId, worldGroupId: wgA, overview: '三大洲', createdAt: now, updatedAt: now } as any)
  await db.histories.add({ projectId, worldGroupId: wgA, summary: '上古神战', createdAt: now, updatedAt: now } as any)
  await db.historicalTimelineEvents.add({ projectId, worldGroupId: wgA, title: '封神之战', year: -1000, createdAt: now, updatedAt: now } as any)
  await db.historicalKeywords.add({ projectId, worldGroupId: wgA, keyword: '神器', createdAt: now, updatedAt: now } as any)
  await db.worldRulesProfiles.add({ projectId, worldGroupId: wgA, rules: '魔法守恒', createdAt: now, updatedAt: now } as any)

  // ── worldNodes(树 + portalsJSON 自引用,wgA) ──
  const rootWorld = await db.worldNodes.add({ projectId, worldGroupId: wgA, parentId: null, name: '主世界', description: '起点', sortOrder: 0, createdAt: now, updatedAt: now } as any) as number
  const mirrorWorld = await db.worldNodes.add({ projectId, worldGroupId: wgA, parentId: rootWorld, name: '镜界', description: '镜中', sortOrder: 1, createdAt: now, updatedAt: now } as any) as number
  await db.worldNodes.update(rootWorld, { portalsJSON: JSON.stringify([{ name: '镜门', targetWorldId: mirrorWorld, x: 1, y: 2 }]) })

  // ── importantLocations(树) ──
  const locParent = await db.importantLocations.add({ projectId, parentId: null, name: '青云山', type: 'mountain', createdAt: now, updatedAt: now } as any) as number
  await db.importantLocations.add({ projectId, parentId: locParent, name: '青云峰', type: 'peak', createdAt: now, updatedAt: now } as any)

  // ── 角色(homeWorldScoped:一个挂 wgA,一个跨世界) ──
  const char1 = await db.characters.add({ projectId, homeWorldGroupId: wgA, name: '林惊羽', role: 'protagonist', personality: '坚毅', createdAt: now, updatedAt: now } as any) as number
  const char2 = await db.characters.add({ projectId, isCrossWorld: true, name: '苏长歌', role: 'supporting', createdAt: now, updatedAt: now } as any) as number
  await db.characterRelations.add({ projectId, fromCharacterId: char1, toCharacterId: char2, type: 'ally', description: '同门', createdAt: now, updatedAt: now } as any)

  // ── 大纲(树,wgA)+ 章节 + 细纲 + 情感卡 ──
  const vol = await db.outlineNodes.add({ projectId, worldGroupId: wgA, parentId: null, type: 'volume', title: '第一卷', summary: '开篇', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapNode = await db.outlineNodes.add({ projectId, worldGroupId: wgA, parentId: vol, type: 'chapter', title: '第1章', summary: '觉醒', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapter = await db.chapters.add({ projectId, outlineNodeId: chapNode, title: '第1章', content: '<p>废墟中睁眼</p>', wordCount: 6, status: 'draft', order: 0, createdAt: now, updatedAt: now } as any) as number
  await db.detailedOutlines.add({ projectId, outlineNodeId: chapNode, openingHook: '承接', endingCliffhanger: '黑影', appearingCharacterIds: [char1], scenes: [{ sceneId: 's1', title: '苏醒', summary: '醒来', characterIds: [char1], location: '废墟', conflict: '失忆' }], createdAt: now, updatedAt: now } as any)
  await db.emotionBeatCards.add({ projectId, chapterId: chapter, overallArc: '低落→振奋', beats: '[]', createdAt: now, updatedAt: now } as any)

  // ── 下游产物 ──
  await db.foreshadows.add({ projectId, name: '神秘玉佩', type: 'item', status: 'planted', description: '身世之谜', createdAt: now, updatedAt: now } as any)
  await db.storyArcs.add({ projectId, type: 'main', name: '复仇线', stages: '[]', createdAt: now, updatedAt: now } as any)
  await db.stateCards.add({ projectId, category: 'character', entityName: '林惊羽', fields: JSON.stringify([{ key: '境界', value: '炼气一层' }]), createdAt: now, updatedAt: now } as any)
  await db.itemLedger.add({ projectId, itemName: '青锋剑', heldByName: '林惊羽', characterId: char1, action: 'gain', quantity: 1, chapterId: chapter, chapterTitle: '第1章', createdAt: now, updatedAt: now } as any)
  await db.storyTimelineEvents.add({ projectId, chapterId: chapter, title: '获得青锋剑', createdAt: now, updatedAt: now } as any)
  await db.notes.add({ projectId, title: '灵感', content: '记一笔', createdAt: now, updatedAt: now } as any)

  // ── 参考书 + 分块分析(creativeRules 引用 reference) ──
  const ref1 = await db.references.add({ projectId, title: '斗破苍穹', author: '天蚕土豆', type: 'story', note: '参考爽点', createdAt: now, updatedAt: now } as any) as number
  await db.referenceChunkAnalysis.add({ referenceId: ref1, chunkIndex: 0, openingTechnique: '天才陨落钩子', createdAt: now, updatedAt: now } as any)
  await db.creativeRules.add({ projectId, citedReferenceIds: [ref1], content: '多爽点', createdAt: now, updatedAt: now } as any)

  // ── 词条(树,wgA) ──
  const cat = await db.codexCategories.add({ projectId, worldGroupId: wgA, parentId: null, name: '势力', order: 0, createdAt: now, updatedAt: now } as any) as number
  const subCat = await db.codexCategories.add({ projectId, worldGroupId: wgA, parentId: cat, name: '宗门', order: 0, createdAt: now, updatedAt: now } as any) as number
  await db.codexEntries.add({ projectId, worldGroupId: wgA, categoryId: subCat, name: '青云宗', summary: '正道魁首', createdAt: now, updatedAt: now } as any)

  // ── FB-5 文风画像 ──
  await db.userStyleProfiles.add({ projectId, profile: '简洁明快', enabled: true, createdAt: now, updatedAt: now } as any)

  // ── NS-4 时序事实账本（带分类型 FK，供全表往返覆盖） ──
  await db.temporalFacts.add({ projectId, worldGroupId: wgA, characterId: char1, subjectName: '林惊羽', predicate: 'powerStage', factKind: 'state', value: '炼气一层', sourceType: 'chapter', sourceChapterId: chapter, validFromChapterId: chapter, status: 'confirmed', locked: false, createdAt: now, updatedAt: now } as any)

  return { projectId, wgA, wgB, char1, char2, vol, chapNode, chapter, ref1, cat, subCat, rootWorld, mirrorWorld, locParent }
}

/** 所有 exportable 的项目级表名(可按 projectId 查;排除 projects 与 direct-child referenceChunkAnalysis) */
export const EXPORTABLE_PROJECT_TABLES = PROJECT_TABLES
  .filter(s => s.exportable && s.name !== 'projects' && s.name !== 'referenceChunkAnalysis')
  .map(s => s.name)
