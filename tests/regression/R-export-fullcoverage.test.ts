/**
 * R-export-fullcoverage · 全部 exportable 表 · 多世界全量导出/导入安全网
 *
 * 目的(AUDIT-1 重构安全网):在把 json-export 从「手写枚举」重构为「注册表派生」之前,
 * 先用一个**覆盖全部 exportable 表 + 双世界组**的种子做往返,锁死当前手写版的正确行为。
 * 重构后此测试必须保持全绿——任何外键重映射/树重建/世界组重映射的行为漂移都会被它抓到。
 *
 * 比 R-export-import-roundtrip 更严:那条是单世界(worldGroupId 全 null),本条是**双世界组**,
 * 真正覆盖 worldGroupId / homeWorldGroupId 重映射这条最复杂的路径。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { parseWorldPortals } from '../../src/lib/utils/world-portals'
import { seedFullProject as seedEverything, EXPORTABLE_PROJECT_TABLES } from '../helpers/seed-full-project'

describe('R-export-fullcoverage · 全表多世界往返安全网', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('每张 exportable 表都有种子数据(种子完整性自检)', async () => {
    const { projectId } = await seedEverything()
    for (const name of EXPORTABLE_PROJECT_TABLES) {
      const count = await (db as any)[name].where('projectId').equals(projectId).count()
      expect(count, `表 ${name} 应有种子数据`).toBeGreaterThan(0)
    }
    // referenceChunkAnalysis 走 referenceId
    const refIds = await db.references.where('projectId').equals(projectId).primaryKeys()
    const rcaCount = await db.referenceChunkAnalysis.where('referenceId').anyOf(refIds as number[]).count()
    expect(rcaCount, 'referenceChunkAnalysis 应有种子数据').toBeGreaterThan(0)
  })

  it('全量导出→导入:每张表行数一致 + 外键/树/世界组重映射正确', async () => {
    const src = await seedEverything()
    const sourceDetail = await db.detailedOutlines.where('projectId').equals(src.projectId).first()
    const sourceForeshadow = await db.foreshadows.where('projectId').equals(src.projectId).first()
    await db.detailedOutlines.update(sourceDetail!.id!, { foreshadowIds: [sourceForeshadow!.id!] })
    const exported = await exportProjectJSON(src.projectId)
    const newId = await importProjectJSON(exported)
    expect(newId).not.toBe(src.projectId)

    // 每张项目级表行数一致
    for (const name of EXPORTABLE_PROJECT_TABLES) {
      const srcCount = await (db as any)[name].where('projectId').equals(src.projectId).count()
      const newCount = await (db as any)[name].where('projectId').equals(newId).count()
      expect(newCount, `表 ${name} 往返后行数应一致`).toBe(srcCount)
    }

    // WORLD-2C: Workspace → World → Work → character binding 全部使用便携 ID。
    const newWorld = await db.worlds.where('projectId').equals(newId).first()
    const newWork = await db.works.where('projectId').equals(newId).first()
    const newBinding = await db.workCharacterBindings.where('projectId').equals(newId).first()
    const newProject = await db.projects.get(newId)
    expect(newWorld?.id).not.toBe(src.worldId)
    expect(newWork?.worldId).toBe(newWorld?.id)
    expect(newWork?.worldId).not.toBe(src.worldId)
    expect(newBinding?.workId).toBe(newWork?.id)
    expect(newProject?.activeWorldId).toBe(newWorld?.id)
    expect(newProject?.activeWorkId).toBe(newWork?.id)

    // 世界组重映射:新项目两个世界组,worldviews 分别挂到正确的新世界组
    const newGroups = await db.worldGroups.where('projectId').equals(newId).sortBy('order')
    expect(newGroups).toHaveLength(2)
    const newWgA = newGroups[0].id!, newWgB = newGroups[1].id!
    const newWorldviews = await db.worldviews.where('projectId').equals(newId).toArray()
    expect(newWorldviews.find(w => w.worldOrigin?.includes('混沌'))?.worldGroupId).toBe(newWgA)
    expect(newWorldviews.find(w => w.worldOrigin?.includes('镜中'))?.worldGroupId).toBe(newWgB)

    // worldGroupLinks 重映射
    const newLinks = await db.worldGroupLinks.where('projectId').equals(newId).toArray()
    expect(newLinks[0].fromGroupId).toBe(newWgA)
    expect(newLinks[0].toGroupId).toBe(newWgB)

    // 角色 homeWorldGroupId 重映射(char1 挂 wgA,char2 跨世界 null)
    const newChars = await db.characters.where('projectId').equals(newId).toArray()
    const newChar1 = newChars.find(c => c.name === '林惊羽')!
    expect(newBinding?.characterId).toBe(newChar1.id)
    expect(newChar1.homeWorldGroupId).toBe(newWgA)
    const newCultivation = await db.cultivationSystems.where('projectId').equals(newId).first()
    const newCodexEntries = await db.codexEntries.where('projectId').equals(newId).toArray()
    expect(newCultivation?.worldGroupId).toBe(newWgA)
    expect(newChar1.cultivationSystemId).toBe(newCultivation?.id)
    expect(newChar1.cultivationStageId).toBe('qi')
    expect(newChar1.raceEntryId).toBe(newCodexEntries.find(entry => entry.name === '青云宗')?.id)

    // 角色关系重映射
    const newRels = await db.characterRelations.where('projectId').equals(newId).toArray()
    expect(newRels).toHaveLength(1)
    const newChar2 = newChars.find(c => c.role === 'supporting')!
    expect(newRels[0].fromCharacterId).toBe(newChar1.id)
    expect(newRels[0].toCharacterId).toBe(newChar2.id)

    // 大纲树 + 章节外键
    const newOutline = await db.outlineNodes.where('projectId').equals(newId).toArray()
    const newVol = newOutline.find(n => n.type === 'volume')!
    const newChapNode = newOutline.find(n => n.type === 'chapter')!
    expect(newChapNode.parentId).toBe(newVol.id) // 树重建
    expect(newChapNode.worldGroupId).toBe(newWgA) // 世界组重映射
    const newChapter = await db.chapters.where('projectId').equals(newId).first()
    expect(newChapter!.outlineNodeId).toBe(newChapNode.id)
    expect(newChapter!.content).toContain('废墟中睁眼')

    // Phase 34 修炼进度 → 世界/角色/体系/章节全部重映射
    const newCultivationProgress = await db.cultivationProgress.where('projectId').equals(newId).first()
    expect(newCultivationProgress).toMatchObject({
      worldGroupId: newWgA,
      characterId: newChar1.id,
      cultivationSystemId: newCultivation!.id,
      sourceChapterId: newChapter!.id,
      stageId: 'qi',
      status: 'confirmed',
    })

    // 细纲外键(outlineNodeId 重映射正确)
    const newDetail = await db.detailedOutlines.where('projectId').equals(newId).first()
    expect(newDetail!.outlineNodeId).toBe(newChapNode.id)
    expect(newDetail!.appearingCharacterIds).toEqual([newChar1.id])
    expect(newDetail!.scenes[0].characterIds).toEqual([newChar1.id])
    const newForeshadow = await db.foreshadows.where('projectId').equals(newId).first()
    expect(newDetail!.foreshadowIds).toEqual([newForeshadow!.id])

    // 情感卡 → 章节
    const newBeat = await db.emotionBeatCards.where('projectId').equals(newId).first()
    expect(newBeat!.chapterId).toBe(newChapter!.id)

    // itemLedger/storyTimeline → 章节
    const newItem = await db.itemLedger.where('projectId').equals(newId).first()
    expect(newItem!.chapterId).toBe(newChapter!.id)
    const newSte = await db.storyTimelineEvents.where('projectId').equals(newId).first()
    expect(newSte!.chapterId).toBe(newChapter!.id)

    // Phase 39 动态故事线 → StoryArc / Chapter 全部重映射
    const newArc = await db.storyArcs.where('projectId').equals(newId).first()
    const newProgress = await db.storylineProgress.where('projectId').equals(newId).first()
    const newCrossing = await db.storylineCrossings.where('projectId').equals(newId).first()
    expect(newProgress).toMatchObject({
      arcId: newArc!.id,
      lastActiveChapterId: newChapter!.id,
      status: 'active',
    })
    expect(newCrossing).toMatchObject({
      arcIdA: newArc!.id,
      arcIdB: newArc!.id,
      chapterId: newChapter!.id,
    })

    // SIM-1 运行时 → 世界、父分支与会话引用全部重映射
    const newSimulationSessions = await db.simulationSessions
      .where('projectId').equals(newId).toArray()
    const newSimulationParent = newSimulationSessions.find(row => row.title === '青云山战役')!
    const newSimulationChild = newSimulationSessions.find(row => row.title === '青云山战役 · 分支')!
    expect(newSimulationParent.worldGroupId).toBe(newWgA)
    expect(newSimulationChild).toMatchObject({
      worldGroupId: newWgA,
      parentSessionId: newSimulationParent.id,
      parentThroughSequence: 0,
    })
    const newSimulationEvent = await db.simulationEvents.where('projectId').equals(newId).first()
    const newSimulationCheckpoint = await db.simulationCheckpoints
      .where('projectId').equals(newId).first()
    expect(newSimulationEvent).toMatchObject({
      worldGroupId: newWgA,
      sessionId: newSimulationChild.id,
      sequence: 1,
    })
    expect(newSimulationCheckpoint).toMatchObject({
      worldGroupId: newWgA,
      sessionId: newSimulationChild.id,
      throughSequence: 1,
    })

    // knowledgeLedger → 世界/角色/章节/事实全部重映射
    const newKnowledge = await db.knowledgeLedger.where('projectId').equals(newId).first()
    const newFact = await db.temporalFacts.where('projectId').equals(newId).first()
    expect(newKnowledge).toMatchObject({
      worldGroupId: newWgA,
      characterId: newChar1.id,
      sourceChapterId: newChapter!.id,
      factId: newFact!.id,
      knowledgeKey: 'self.power_stage',
      status: 'confirmed',
    })

    // 重要地点树
    const newLocs = await db.importantLocations.where('projectId').equals(newId).toArray()
    const newLocParent = newLocs.find(l => l.name === '青云山')!
    const newLocChild = newLocs.find(l => l.name === '青云峰')!
    expect(newLocChild.parentId).toBe(newLocParent.id)

    // 词条树 + 词条外键 + 世界组
    const newCats = await db.codexCategories.where('projectId').equals(newId).toArray()
    const newCat = newCats.find(c => c.name === '势力')!
    const newSubCat = newCats.find(c => c.name === '宗门')!
    expect(newSubCat.parentId).toBe(newCat.id)
    expect(newSubCat.worldGroupId).toBe(newWgA)
    const newEntry = await db.codexEntries.where('projectId').equals(newId).first()
    expect(newEntry!.categoryId).toBe(newSubCat.id)
    expect(newEntry!.worldGroupId).toBe(newWgA)
    expect(newEntry!.importantLocationId).toBe(newLocParent.id)

    // creativeRules 引用 reference 重映射
    const newRefs = await db.references.where('projectId').equals(newId).toArray()
    const newRef1 = newRefs[0]
    const newRules = await db.creativeRules.where('projectId').equals(newId).first()
    expect(JSON.parse(newRules!.citedReferenceIds || '[]')).toEqual([newRef1.id])
    const newRca = await db.referenceChunkAnalysis.where('referenceId').equals(newRef1.id!).first()
    expect(newRca!.openingTechnique).toContain('天才陨落')

    // worldNodes portalsJSON 自引用重映射
    const newWorldNodes = await db.worldNodes.where('projectId').equals(newId).toArray()
    const newRoot = newWorldNodes.find(n => n.name === '主世界')!
    const newMirror = newWorldNodes.find(n => n.name === '镜界')!
    expect(newMirror.parentId).toBe(newRoot.id)
    const portals = parseWorldPortals(newRoot.portalsJSON)
    expect(portals).toHaveLength(1)
    expect(portals[0].targetWorldId).toBe(newMirror.id)
  })

  it('认知账本导入遇到不可映射 FK 时保留事件但降级复核，不把缺失章节误当基线', async () => {
    const src = await seedEverything()
    const exported = await exportProjectJSON(src.projectId)
    expect(exported.knowledgeLedger).toHaveLength(1)
    ;(exported.knowledgeLedger![0] as any)._sourceChapterExportId = 9999

    const newId = await importProjectJSON(exported)
    const imported = await db.knowledgeLedger.where('projectId').equals(newId).first()
    expect(imported).toMatchObject({
      sourceChapterId: null,
      status: 'source-missing',
      knowledgeKey: 'self.power_stage',
    })
  })
})
