import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  draftGameProductionBriefV3,
  suggestGameStartingPoints,
} from '../../src/lib/game-production/consultation'
import { executeGameProductionCommand } from '../../src/lib/game-production/commands'
import { parseGameProductionBriefV3 } from '../../src/lib/game-production/contracts'
import { seedStoryGameAcceptanceSample } from '../../src/lib/text-game/authoring'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createLegacyExecutableWorldRevisionFixtureV1 } from '../helpers/legacy-executable-world-release'
import { stampNewRecord } from '../../src/lib/world-engine/scope'

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name, genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 10_000, createdAt: now, updatedAt: now,
  } as never) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  await db.characters.bulkAdd([
    {
      projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      isCrossWorld: true, name: '林舟', role: 'protagonist', roleWeight: 'main',
      identity: '谨慎的守灯调查者', createdAt: now, updatedAt: now,
    },
    {
      projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      isCrossWorld: true, name: '守潮人', role: 'supporting', roleWeight: 'npc',
      identity: '掌握旧港秘密的向导', createdAt: now, updatedAt: now,
    },
  ] as never[])
  await db.importantLocations.add({
    projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
    parentId: null, name: '雾港灯塔', type: 'lighthouse', description: '潮门关闭前仍可进入的调查起点。',
    createdAt: now, updatedAt: now,
  } as never)
  const artifactCategoryId = await db.codexCategories.add(stampNewRecord(owned.scope, 'codexCategories', {
    projectId, domain: 'humanity', parentId: null, name: '人工器物', builtInKey: 'artifact',
    fieldSchema: '[]', hidden: false, order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
  } as never, { owner: 'world' })) as number
  await db.codexEntries.add(stampNewRecord(owned.scope, 'codexEntries', {
    projectId, categoryId: artifactCategoryId, name: '黄铜潮汐钥匙', summary: '能够重新启动潮汐钟机。',
    description: '钥匙齿纹对应着旧档案中的潮位。', fields: '{}', refs: '{}', tags: '["关键道具"]',
    importance: 5, order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
  } as never, { owner: 'world' }))
  const definition = await seedStoryGameAcceptanceSample({ scope: owned.scope })
  const revision = await createLegacyExecutableWorldRevisionFixtureV1({
    scope: owned.scope, label: '会谈冻结来源',
    selectedNarrativeModuleIds: [definition.narrativeModuleId],
  })
  const release = await publishWorldRevision(revision.id!)
  return { ...owned, release }
}

describe('R-GAMEPROD-1B · consultation and reviewable Brief', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('从登记的冻结来源给出稳定起点建议，重复读取不产生任何 Production/Build/Run', async () => {
    const owned = await workspace('会谈不生产')
    const first = await suggestGameStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const second = await suggestGameStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    expect(second).toEqual(first)
    expect(first.worldContentHash).toBe(owned.release.contentHash)
    expect(first.suggestions.some(item => item.kind === 'mainline')).toBe(true)
    expect(first.suggestions.at(-1)).toMatchObject({ kind: 'custom' })
    expect(new Set(first.suggestions.map(item => item.suggestionKey)).size).toBe(first.suggestions.length)
    expect(await db.gameProductions.count()).toBe(0)
    expect(await db.gameBuilds.count()).toBe(0)
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('用户表单编译为 exact Brief；未解决角色决策使授权前保持 consulting', async () => {
    const owned = await workspace('Brief 表单')
    const suggestions = await suggestGameStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const mainline = suggestions.suggestions.find(item => item.kind === 'mainline')!
    const storyBrief = await draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'storygame', scale: 'short-arc', visualLevel: 'key-scenes', audioLevel: 'none',
      playerRole: '扮演收到禁航令的守灯人',
      openingSituation: '暴潮到来前，守灯人必须决定公开失踪船队的求救信号还是先救港内居民。',
      coreExperience: ['调查信号', '在真相和救援之间承担后果'],
      tone: ['悬疑', '克制'], requiredFacts: ['潮汐规律不可被改写'],
      forbiddenChanges: ['不能让失踪船队凭空安全归港'], contentBoundaries: ['不描写露骨伤害'],
    })
    expect(parseGameProductionBriefV3(storyBrief)).toEqual(storyBrief)
    expect(storyBrief).toMatchObject({
      source: { worldContentHash: owned.release.contentHash },
      intent: {
        productType: 'storygame', playerRole: '扮演收到禁航令的守灯人',
        openingSituation: '暴潮到来前，守灯人必须决定公开失踪船队的求救信号还是先救港内居民。',
        coreExperience: ['调查信号', '在真相和救援之间承担后果'],
      },
      scale: { scope: 'short-arc', targetEndingCount: 3 },
      media: { visualLevel: 'none', imageCount: 0, audioLevel: 'none' },
      unresolvedDecisionKeys: [],
    })
    expect(storyBrief.source.selection.narrativeModuleExportIds.length).toBeGreaterThan(0)
    expect(await db.gameProductions.count()).toBe(0)

    const interactionBrief = await draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'character-interaction', visualLevel: 'none', audioLevel: 'none',
    })
    expect(interactionBrief.unresolvedDecisionKeys).toContain('player-character-or-counterpart')
    const created = await executeGameProductionCommand({
      scope: owned.scope,
      command: {
        type: 'create-intent', commandId: 'consulting-intent', productionKey: 'interaction-consulting',
        worldReleaseId: owned.release.id!, userText: '制作角色互动',
      },
    })
    const saved = await executeGameProductionCommand({
      scope: owned.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'consulting-brief', expectedStateRevision: 0,
        parentRevision: null, brief: interactionBrief,
      },
    })
    expect(saved).toMatchObject({ ok: true, result: { status: 'consulting' } })
    expect(await db.gameBuilds.count()).toBe(0)

    const resolvedInteraction = await draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'character-interaction', visualLevel: 'none', audioLevel: 'none',
      playerRole: '扮演来访者，与守灯人确认信号真相',
      openingSituation: '在潮门关闭前，与守灯人进行一场会改变双方信任的谈话。',
    })
    expect(resolvedInteraction.unresolvedDecisionKeys).not.toContain('player-character-or-counterpart')

    const resolvedAdventure = await draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'text-adventure', visualLevel: 'none', audioLevel: 'none',
      playerRole: '扮演调查信号的守灯人',
      openingSituation: '从用户确认的潮门信号塔入口开始调查。',
    })
    expect(resolvedAdventure.unresolvedDecisionKeys).not.toContain('adventure-starting-location')

    const ttrpgWithoutConfirmation = await draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'ttrpg', visualLevel: 'none', audioLevel: 'none',
      playerRole: '扮演调查信号的守灯人', openingSituation: '从潮门信号塔开始战役。',
    })
    expect(ttrpgWithoutConfirmation.unresolvedDecisionKeys).toContain('ttrpg-default-rule-mappings')
    expect(ttrpgWithoutConfirmation.authorConfirmations).toEqual({ ttrpgDefaultRuleMappings: false })

    const confirmedTtrpg = await draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'ttrpg', visualLevel: 'none', audioLevel: 'none',
      playerRole: '扮演调查信号的守灯人', openingSituation: '从潮门信号塔开始战役。',
      confirmTtrpgDefaultMappings: true,
    })
    expect(confirmedTtrpg.unresolvedDecisionKeys).not.toContain('ttrpg-default-rule-mappings')
    expect(confirmedTtrpg.authorConfirmations).toEqual({ ttrpgDefaultRuleMappings: true })
  })

  it('所选角色起点真实收窄 Brief 与 TTRPG productSource，物品读取正式 artifact 词条', async () => {
    const owned = await workspace('起点约束素材')
    const suggestions = await suggestGameStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const characterStart = suggestions.suggestions.find(item => item.kind === 'character')!
    const brief = await draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: characterStart.suggestionKey,
      productType: 'ttrpg', playerRole: '扮演所选角色', openingSituation: '从灯塔潮门开始调查。',
      confirmTtrpgDefaultMappings: true,
    })
    const selectedCharacterId = Number(characterStart.protagonistRefs[0].split(':')[1])
    expect(brief.source.selection.characterExportIds).toEqual([selectedCharacterId])
    expect(brief.source.selection.characterRelationExportIds).toEqual([])
    expect(brief.source.selection.artifactExportIds).toHaveLength(1)
    expect(brief.source.selection.productSource).toEqual({
      kind: 'ttrpg', participantCharacterExportIds: [selectedCharacterId],
      locationExportIds: brief.source.selection.importantLocationExportIds,
      questStoryArcExportIds: brief.source.selection.storyArcExportIds,
    })
    expect(suggestions.sourceOptions.characters).toHaveLength(2)
    expect(suggestions.sourceOptions.artifacts.map(item => item.label)).toEqual(['黄铜潮汐钥匙'])
    expect(suggestions.sourceOptions.codexEntries.map(item => item.label)).not.toContain('黄铜潮汐钥匙')
    expect(suggestions.selectionDefaults[characterStart.suggestionKey].characterExportIds)
      .toEqual([selectedCharacterId])
  })

  it('作者可在冻结白名单内编辑素材子集；编译器重建 productSource 并拒绝伪造 ID', async () => {
    const owned = await workspace('作者素材白名单')
    const suggestions = await suggestGameStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const customStart = suggestions.suggestions.find(item => item.kind === 'custom')!
    const selection = structuredClone(suggestions.selectionDefaults[customStart.suggestionKey])
    const chosenCharacter = suggestions.sourceOptions.characters[1].exportId
    selection.characterExportIds = [chosenCharacter]
    selection.importantLocationExportIds = []
    selection.artifactExportIds = []
    const brief = await draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: customStart.suggestionKey,
      productType: 'ttrpg', playerRole: '扮演自定义调查者', openingSituation: '从海雾中开始。',
      confirmTtrpgDefaultMappings: true, sourceSelection: selection,
    })
    expect(brief.source.selection.characterExportIds).toEqual([chosenCharacter])
    expect(brief.source.selection.characterRelationExportIds).toEqual([])
    expect(brief.source.selection.productSource).toMatchObject({
      kind: 'ttrpg', participantCharacterExportIds: [chosenCharacter], locationExportIds: [],
    })
    expect(brief.unresolvedDecisionKeys).toContain('ttrpg-starting-location')

    selection.characterExportIds = [999_999]
    await expect(draftGameProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: customStart.suggestionKey,
      productType: 'storygame', sourceSelection: selection,
    })).rejects.toThrow(/不属于当前 WorldRelease/)
  })

  it('拒绝伪造 suggestionKey、跨 Work Release 与被篡改的冻结来源', async () => {
    const left = await workspace('会谈左侧')
    const right = await workspace('会谈右侧')
    await expect(suggestGameStartingPoints({ scope: right.scope, worldReleaseId: left.release.id! }))
      .rejects.toThrow(/跨 World/)
    await expect(draftGameProductionBriefV3({
      scope: left.scope, worldReleaseId: left.release.id!, suggestionKey: 'custom:forged',
      productType: 'storygame',
    })).rejects.toThrow(/不属于当前冻结 WorldRelease/)
    await db.worldReleases.update(left.release.id!, { manifestJson: '{}' })
    await expect(suggestGameStartingPoints({ scope: left.scope, worldReleaseId: left.release.id! }))
      .rejects.toThrow(/已被篡改/)
    expect(await db.gameProductions.count()).toBe(0)
  })
})
