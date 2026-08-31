import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  assertCharacterInteractionFormalProductionReadyV1,
  confirmCharacterInteractionBriefV1,
  createCharacterInteractionProductionV1,
  loadCharacterInteractionProductionV1,
  parseCharacterInteractionBriefV1,
  type CharacterInteractionBriefInputV1,
} from '../../src/lib/character-interaction/production'
import { loadCharacterInteractionWorldSourceCatalogV1 } from '../../src/lib/character-interaction/world-source'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'

async function fixture() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '角色互动正式生产', genre: 'drama', genres: ['drama'], status: 'drafting',
    description: '冻结来源、Brief 和 Run Contract', targetWordCount: 20_000,
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    createdAt: now, updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const characterIds: number[] = []
  for (const [index, name] of ['岑星', '白榆'].entries()) {
    characterIds.push(await db.characters.add(stampNewRecord(owned.scope, 'characters', {
      projectId,
      name,
      role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: `${name}经历过旧港停战。`, appearance: '', personality: '克制',
      background: '旧港居民', motivation: '重新理解彼此', abilities: '', relationships: '[]',
      arc: '在终局之后开始新生活', speechStyle: '谨慎简短',
      createdAt: now + index, updatedAt: now + index,
    } as any, { owner: 'world' })) as number)
  }
  await db.workCharacterBindings.bulkAdd(characterIds.map((characterId, index) => (
    stampNewRecord(owned.scope, 'workCharacterBindings', {
      projectId, workId: owned.scope.workId, characterId, role: `终局角色${index + 1}`,
      arc: '重新建立联系', outcome: index === 0 ? '隐居灯塔' : '留在旧港',
      createdAt: now + index, updatedAt: now + index,
    } as any, { owner: 'work' })
  )))
  await db.characterRelations.add(stampNewRecord(owned.scope, 'characterRelations', {
    projectId, fromCharacterId: characterIds[0], toCharacterId: characterIds[1],
    relationType: 'friend', label: '旧友', description: '停战后保持书信往来。',
    isBidirectional: true, createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  const locationId = await db.importantLocations.add(stampNewRecord(owned.scope, 'importantLocations', {
    projectId, name: '守潮灯塔', tags: '["灯塔"]', description: '岑星隐居的灯塔。',
    significance: '角色聊天起点', parentId: null, sortOrder: 0, createdAt: now, updatedAt: now,
  } as any, { owner: 'world' })) as number
  const revision = await createWorldRevision({ scope: owned.scope, label: '终局角色正式来源' })
  const release = await publishWorldRevision(revision.id!, '终局角色正式来源 v1')
  return { ...owned, projectId, release, characterIds, locationId }
}

function brief(title = '旧港重逢'): CharacterInteractionBriefInputV1 {
  return {
    title,
    userInstruction: '我以多年后归来的旧友身份，和他们谈停战后的生活，并共同调查灯塔异响。',
    userRole: 'original-visitor',
    guests: [{
      guestKey: 'guest:returning-friend',
      name: '归港人',
      relationToWorld: '曾在停战前离开旧港，与岑星通信多年。',
      profile: '尊重角色边界，希望了解真相而不是强迫任何人和解。',
    }],
    storyMode: 'new-event',
    timeContext: '旧港停战十年后的秋夜',
    locationContext: '守潮灯塔一层会客室',
    historicalContext: '主要冲突已经结束，角色均保留各自终局记忆。',
    chatGoal: '在叙旧中确认灯塔异响是否与旧案有关。',
    desiredDirections: ['先叙旧，再调查', '允许角色拒绝回答'],
    safetyBoundaries: ['不推翻原作终局', '不强制角色原谅任何人'],
    publicKnowledge: ['停战已经持续十年'],
    privateKnowledge: ['归港人收到过一封没有署名的信'],
    prohibitedDisclosure: ['未触发调查前不得直接揭露寄信人'],
    sceneCount: 2,
    maxTurnsPerScene: 60,
    directorBudget: 10,
    endingStrategy: 'user-decides',
    mediaTier: 'text-core',
    allowWorldFeedbackCandidate: true,
  }
}

async function createProduction() {
  const owned = await fixture()
  const catalog = await loadCharacterInteractionWorldSourceCatalogV1({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
  })
  const characterExportIds = catalog.records.characters!.map(item => item.exportId)
  const locationExportId = catalog.records.importantLocations!.find(item => item.label === '守潮灯塔')!.exportId
  const bundle = await createCharacterInteractionProductionV1({
    scope: owned.scope,
    productionKey: 'old-harbor-reunion',
    worldReleaseId: owned.release.id!,
    participantCharacterExportIds: characterExportIds,
    optionalRecordSelections: [{ table: 'importantLocations', exportIds: [locationExportId] }],
    brief: brief(),
  })
  return { ...owned, bundle }
}

describe('CHATGAME-3C · SourceSelection、Brief 与 Run Contract 正式门禁', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('校验失败时保持零产品写入；成功时原子冻结来源和 Brief 草稿且不创建旧游戏表', async () => {
    const owned = await fixture()
    await expect(createCharacterInteractionProductionV1({
      scope: owned.scope,
      productionKey: 'invalid-source',
      worldReleaseId: owned.release.id!,
      participantCharacterExportIds: [999_999],
      brief: brief('不应创建'),
    })).rejects.toThrow('世界角色不存在')
    expect(await db.characterInteractionProductions.count()).toBe(0)
    expect(await db.characterInteractionSourceSelections.count()).toBe(0)
    expect(await db.characterInteractionBriefs.count()).toBe(0)

    const catalog = await loadCharacterInteractionWorldSourceCatalogV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
    })
    const bundle = await createCharacterInteractionProductionV1({
      scope: owned.scope,
      productionKey: 'atomic-source',
      worldReleaseId: owned.release.id!,
      participantCharacterExportIds: catalog.records.characters!.map(item => item.exportId),
      brief: brief(),
    })
    expect(bundle.production).toMatchObject({ status: 'brief-draft', activeSourceSelectionId: bundle.sourceRecord.id })
    expect(bundle.sourceRecord).toMatchObject({ status: 'frozen', selectionHash: bundle.selection.selectionHash })
    expect(bundle.briefRecord).toMatchObject({ status: 'draft', revision: 1, runContractHash: null })
    expect(Object.isFrozen(bundle.selection)).toBe(true)
    expect(await db.gameDefinitions.count()).toBe(0)
    expect(await db.interactionCharacterProfiles.count()).toBe(0)
    expect(await db.interactionSceneTemplates.count()).toBe(0)
    await expect(assertCharacterInteractionFormalProductionReadyV1({
      scope: owned.scope,
      productionId: bundle.production.id,
    })).rejects.toThrow('正式生产要求')
  }, 30_000)

  it('确认 Brief 后追加 revision、生成候选只写 Run Contract，并只经 CONTEXT_SOURCES 读取冻结世界', async () => {
    const owned = await createProduction()
    expect(() => parseCharacterInteractionBriefV1({ ...owned.bundle.brief, injected: true }))
      .toThrow('未知字段')
    const confirmed = await confirmCharacterInteractionBriefV1({
      scope: owned.scope,
      productionId: owned.bundle.production.id,
    })
    expect(confirmed.production.status).toBe('brief-confirmed')
    expect(confirmed.briefRecord).toMatchObject({ status: 'confirmed', revision: 2 })
    expect(await db.characterInteractionBriefs.where('productionId').equals(confirmed.production.id).count()).toBe(2)
    expect(confirmed.runContract).toMatchObject({
      allowedContextSourceKeys: ['characterInteractionProduction'],
      writeMode: 'candidate-only',
      worldWritebackAllowed: false,
      formalMediaWriteAllowed: false,
    })
    await db.characters.update(owned.characterIds[0], { name: '活动表改名不应进入生产', updatedAt: Date.now() })
    const assembled = await assembleContext({
      projectId: owned.projectId,
      scope: owned.scope,
      sourceKeys: ['characterInteractionProduction'],
      characterInteractionProductionId: confirmed.production.id,
      inputBudgetMaxTokens: 20_000,
    })
    expect(assembled.included).toEqual(['characterInteractionProduction'])
    expect(assembled.text).toContain('岑星')
    expect(assembled.text).not.toContain('活动表改名不应进入生产')
    await expect(confirmCharacterInteractionBriefV1({
      scope: owned.scope,
      productionId: confirmed.production.id,
    })).rejects.toThrow('只有 Brief 草稿可以确认')
  }, 30_000)

  it('项目往返重映射表字段和三份合同 JSON 内的 WorldRelease 引用，哈希保持可验证', async () => {
    const owned = await createProduction()
    const confirmed = await confirmCharacterInteractionBriefV1({
      scope: owned.scope,
      productionId: owned.bundle.production.id,
    })
    const exported = await exportProjectJSON(owned.projectId)
    const portableSelection = JSON.parse((exported.characterInteractionSourceSelections![0] as any)._portableSelectionJson)
    expect(portableSelection.worldReleaseId).toBe((exported.characterInteractionSourceSelections![0] as any)._sourceWorldReleaseExportId)
    const tampered = structuredClone(exported)
    ;(tampered.characterInteractionSourceSelections![0] as any)._portableSelectionJson = JSON.stringify({
      ...portableSelection,
      worldReleaseId: 999_999,
    })
    const projectCountBeforeTamperedImport = await db.projects.count()
    await expect(importProjectJSON(tampered)).rejects.toThrow('缺少本地映射')
    expect(await db.projects.count()).toBe(projectCountBeforeTamperedImport)
    const importedProjectId = await importProjectJSON(exported)
    const importedProject = await db.projects.get(importedProjectId)
    const importedScope = {
      projectId: importedProjectId,
      worldId: importedProject!.activeWorldId!,
      workId: importedProject!.activeWorkId!,
    }
    const importedProduction = await db.characterInteractionProductions.where('projectId').equals(importedProjectId).first()
    const imported = await loadCharacterInteractionProductionV1({
      scope: importedScope,
      productionId: importedProduction!.id!,
    })
    expect(imported.production.id).not.toBe(confirmed.production.id)
    expect(imported.selection.worldReleaseId).toBe(imported.sourceRecord.sourceWorldReleaseId)
    expect(imported.brief.source.worldReleaseId).toBe(imported.selection.worldReleaseId)
    expect(imported.runContract?.sourceWorldReleaseId).toBe(imported.selection.worldReleaseId)
    expect(imported.selection.selectionHash).toBe(confirmed.selection.selectionHash)
    expect(imported.briefRecord.briefHash).toBe(confirmed.briefRecord.briefHash)
    expect(imported.briefRecord.runContractHash).toBe(confirmed.briefRecord.runContractHash)
    await cascadeDeleteProject(importedProjectId)
    expect(await db.characterInteractionProductions.where('projectId').equals(importedProjectId).count()).toBe(0)
    expect(await db.characterInteractionSourceSelections.where('projectId').equals(importedProjectId).count()).toBe(0)
    expect(await db.characterInteractionBriefs.where('projectId').equals(importedProjectId).count()).toBe(0)
  }, 60_000)
})
