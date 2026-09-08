import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  draftProductProductionBriefV3,
  suggestProductStartingPoints,
} from '../../src/lib/product-production/consultation'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { loadProductProductionWorldSourceCatalogV2 } from '../../src/lib/product-production/world-source'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createProductProductionWithBriefV1 } from '../../src/lib/product-production/service'
import { assertAiTownWorldSourceSelectionHashV1 } from '../../src/lib/ai-town/contracts'
import {
  assertAiTownWorldSourceCatalogHashV1,
  freezeAiTownWorldSourceSelectionV1,
  loadAiTownWorldSourceCatalogV1,
} from '../../src/lib/ai-town/world-source'
import type { AiTownBriefSettingsV1 } from '../../src/lib/types'

async function workspace(name: string) {
  return seedCurrentProductWorld(name)
}

describe('R-PRODUCTPROD-1B · consultation and reviewable Brief', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('仅有世界基础时可显式冻结设定并制作原创开场，草稿修改不污染来源', async () => {
    const owned = await createWorkspace({ name: '原创设定世界', genres: ['fantasy'], status: 'drafting',
      description: '只有世界起源，没有产品角色或地点。', targetWordCount: 1000, enableMultiWorld: false,
    }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const worldviewId = await db.worldviews.add(stampNewRecord(owned.scope, 'worldviews', {
      projectId: owned.scope.projectId, worldOrigin: '盐晶只能留存自愿交出的感官记忆，不能复活死者。',
      createdAt: Date.now(), updatedAt: Date.now(),
    } as never, { owner: 'world' }))
    const revision = await createWorldRevision({ scope: owned.scope, label: '设定基线' })
    const release = await publishWorldRevision(revision.id!)
    await db.worldviews.update(worldviewId, { worldOrigin: '后续草稿不应被读取' })
    const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
    expect(suggestions.sourceOptions.characters).toHaveLength(0)
    expect(suggestions.sourceOptions.importantLocations).toHaveLength(0)
    const foundation = suggestions.sourceOptions.codexEntries.find(item => item.resourceKey.includes(':worldview:'))!
    expect(foundation).toBeDefined()
    const custom = suggestions.suggestions.find(item => item.kind === 'custom')!
    const selection = structuredClone(suggestions.selectionDefaults[custom.suggestionKey])
    selection.codexEntryResourceKeys = [foundation.resourceKey]
    const input = { scope: owned.scope, worldReleaseId: release.id!, suggestionKey: custom.suggestionKey,
      productType: 'ttrpg' as const, sourceSelection: selection, playerRole: '调查者',
      openingSituation: '在潮阶调查重复的灯号。', confirmTtrpgDefaultMappings: true }
    const undecided = await draftProductProductionBriefV3(input)
    expect(undecided.unresolvedDecisionKeys).toContain('ttrpg-starting-location')
    const brief = await draftProductProductionBriefV3({ ...input, ttrpg: {
      naturalLanguageInstruction: '基于盐晶记忆设定创作独立调查团，AI KP 主持。',
      story: { openingScene: '在产品原创的潮阶场景开始调查重复灯号。' },
    } })
    expect(brief.unresolvedDecisionKeys).not.toContain('ttrpg-starting-location')
    expect(brief.source.selection.resourceKeys).toEqual([foundation.resourceKey])
    const catalog = await loadProductProductionWorldSourceCatalogV2({ scope: owned.scope,
      worldReleaseId: release.id!, selection: brief.source.selection })
    expect(catalog.loreEntries.map(item => item.resourceKey)).toEqual([foundation.resourceKey])
    expect(catalog.resources[0].value.worldOrigin).toContain('不能复活死者')
    expect(JSON.stringify(catalog)).not.toContain('后续草稿不应被读取')
    const productionId = await createProductProductionWithBriefV1({ scope: owned.scope,
      worldReleaseId: release.id!, title: '原创调查团', brief })
    expect(productionId).toBeGreaterThan(0)
    expect(await db.productBuilds.count()).toBe(0)
    await expect(createProductProductionWithBriefV1({ scope: owned.scope, worldReleaseId: release.id!,
      title: '空来源应拦截', brief: { ...brief, source: { ...brief.source,
        selection: { ...brief.source.selection, resourceKeys: [] } } },
    })).rejects.toThrow(/至少需要一个作者冻结的世界资源/)
  })

  it('从登记的冻结来源给出稳定起点建议，重复读取不产生任何 Production/Build/Run', async () => {
    const owned = await workspace('会谈不生产')
    const first = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const second = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    expect(second).toEqual(first)
    expect(first.worldContentHash).toBe(owned.release.contentHash)
    expect(first.suggestions.some(item => item.kind === 'mainline')).toBe(true)
    expect(first.suggestions.at(-1)).toMatchObject({ kind: 'custom' })
    expect(new Set(first.suggestions.map(item => item.suggestionKey)).size).toBe(first.suggestions.length)
    expect(await db.productProductions.count()).toBe(0)
    expect(await db.productBuilds.count()).toBe(0)
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('用户表单编译为 exact Brief；未解决角色决策使授权前保持 consulting', async () => {
    const owned = await workspace('Brief 表单')
    const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const mainline = suggestions.suggestions.find(item => item.kind === 'mainline')!
    const storyBrief = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'avg', scale: 'short-arc', visualLevel: 'key-scenes', audioLevel: 'none',
      playerRole: '扮演收到禁航令的守灯人',
      openingSituation: '暴潮到来前，守灯人必须决定公开失踪船队的求救信号还是先救港内居民。',
      coreExperience: ['调查信号', '在真相和救援之间承担后果'],
      tone: ['悬疑', '克制'], requiredFacts: ['潮汐规律不可被改写'],
      forbiddenChanges: ['不能让失踪船队凭空安全归港'], contentBoundaries: ['不描写露骨伤害'],
    })
    expect(parseProductProductionBriefV3(storyBrief)).toEqual(storyBrief)
    expect(storyBrief).toMatchObject({
      source: { worldContentHash: owned.release.contentHash },
      intent: {
        productType: 'avg', playerRole: '扮演收到禁航令的守灯人',
        openingSituation: '暴潮到来前，守灯人必须决定公开失踪船队的求救信号还是先救港内居民。',
        coreExperience: ['调查信号', '在真相和救援之间承担后果'],
      },
      scale: { scope: 'short-arc', targetEndingCount: 3 },
      media: { visualLevel: 'key-scenes', imageCount: 2, audioLevel: 'none' },
      unresolvedDecisionKeys: [],
    })
    expect(storyBrief.source.selection.roleBindings.story.length).toBeGreaterThan(0)
    expect(await db.productProductions.count()).toBe(0)

    const interactionBrief = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'character-interaction', visualLevel: 'none', audioLevel: 'none',
    })
    expect(interactionBrief.unresolvedDecisionKeys).toContain('player-character-or-counterpart')
    const created = await executeProductProductionCommand({
      scope: owned.scope,
      command: {
        type: 'create-intent', commandId: 'consulting-intent', productionKey: 'interaction-consulting',
        productType: 'character-interaction', worldReleaseId: owned.release.id!, userText: '制作角色互动',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: owned.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'consulting-brief', expectedStateRevision: 0,
        parentRevision: null, brief: interactionBrief,
      },
    })
    expect(saved).toMatchObject({ ok: true, result: { status: 'consulting' } })
    expect(await db.productBuilds.count()).toBe(0)

    const resolvedInteraction = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'character-interaction', visualLevel: 'none', audioLevel: 'none',
      playerRole: '扮演来访者，与守灯人确认信号真相',
      openingSituation: '在潮门关闭前，与守灯人进行一场会改变双方信任的谈话。',
    })
    expect(resolvedInteraction.unresolvedDecisionKeys).not.toContain('player-character-or-counterpart')

    const resolvedAdventure = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'text-adventure', visualLevel: 'none', audioLevel: 'none',
      playerRole: '扮演调查信号的守灯人',
      openingSituation: '从用户确认的潮门信号塔入口开始调查。',
    })
    expect(resolvedAdventure.unresolvedDecisionKeys).not.toContain('adventure-starting-location')

    const ttrpgWithoutConfirmation = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: mainline.suggestionKey,
      productType: 'ttrpg', visualLevel: 'none', audioLevel: 'none',
      playerRole: '扮演调查信号的守灯人', openingSituation: '从潮门信号塔开始战役。',
    })
    expect(ttrpgWithoutConfirmation.unresolvedDecisionKeys).toContain('ttrpg-default-rule-mappings')
    expect(ttrpgWithoutConfirmation.authorConfirmations).toEqual({ ttrpgDefaultRuleMappings: false })

    const confirmedTtrpg = await draftProductProductionBriefV3({
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
    const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const characterStart = suggestions.suggestions.find(item => item.kind === 'character')!
    const brief = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: characterStart.suggestionKey,
      productType: 'ttrpg', playerRole: '扮演所选角色', openingSituation: '从灯塔潮门开始调查。',
      confirmTtrpgDefaultMappings: true,
    })
    const selectedCharacterKey = characterStart.protagonistRefs[0]
    expect(brief.source.selection.roleBindings.participants).toEqual([selectedCharacterKey])
    expect(brief.source.selection.resourceKeys).toContain(selectedCharacterKey)
    expect(brief.source.selection.resourceKeys).toContain(suggestions.sourceOptions.artifacts[0].resourceKey)
    expect(suggestions.sourceOptions.characters).toHaveLength(2)
    expect(suggestions.sourceOptions.artifacts.map(item => item.label)).toEqual(['黄铜潮汐钥匙'])
    expect(suggestions.sourceOptions.codexEntries.map(item => item.label)).not.toContain('黄铜潮汐钥匙')
    expect(suggestions.selectionDefaults[characterStart.suggestionKey].characterResourceKeys)
      .toEqual([selectedCharacterKey])
  })

  it('作者可在冻结白名单内编辑素材子集；编译器重建 productSource 并拒绝伪造 ID', async () => {
    const owned = await workspace('作者素材白名单')
    const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const customStart = suggestions.suggestions.find(item => item.kind === 'custom')!
    const selection = structuredClone(suggestions.selectionDefaults[customStart.suggestionKey])
    const chosenCharacter = suggestions.sourceOptions.characters[1].resourceKey
    selection.characterResourceKeys = [chosenCharacter]
    selection.importantLocationResourceKeys = []
    selection.artifactResourceKeys = []
    const brief = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: customStart.suggestionKey,
      productType: 'ttrpg', playerRole: '扮演自定义调查者', openingSituation: '从海雾中开始。',
      confirmTtrpgDefaultMappings: true, sourceSelection: selection,
    })
    expect(brief.source.selection.roleBindings.participants).toEqual([chosenCharacter])
    expect(brief.source.selection.roleBindings.locations).toEqual([])
    expect(brief.unresolvedDecisionKeys).toContain('ttrpg-starting-location')
    const compiledCatalog = await loadProductProductionWorldSourceCatalogV2({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      selection: brief.source.selection,
    })
    expect(compiledCatalog.characters.map(item => item.resourceKey)).toEqual([chosenCharacter])
    expect(compiledCatalog.locations).toEqual([])
    await expect(loadProductProductionWorldSourceCatalogV2({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      selection: { ...brief.source.selection, worldReferenceHash: 'b'.repeat(64) },
    })).rejects.toThrow(/selection 与冻结 WorldReference 不一致/)

    selection.characterResourceKeys = ['world-release:forged:character:999999']
    await expect(draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: customStart.suggestionKey,
      productType: 'avg', sourceSelection: selection,
    })).rejects.toThrow(/不属于当前 WorldRelease/)
  })

  it('AI 小镇专属表单冻结为严格 Brief，且不可放宽重大变化与私密心智边界', async () => {
    const owned = await seedCurrentProductWorld('AI 小镇 Brief', { minimumCharacters: 5 })
    const townCatalog = await loadAiTownWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id! })
    expect(townCatalog).toMatchObject({ productType: 'ai-town', worldContentHash: owned.release.contentHash })
    expect(townCatalog.residentCandidates).toHaveLength(5)
    await expect(assertAiTownWorldSourceCatalogHashV1({
      ...townCatalog,
      worldContentHash: 'b'.repeat(64),
    })).rejects.toThrow(/catalogHash/)
    const frozenSelection = await freezeAiTownWorldSourceSelectionV1({
      catalog: townCatalog,
      endingResourceKeys: [townCatalog.endingCandidates[0].resourceKey],
      residentResourceKeys: townCatalog.residentCandidates.slice(0, 4).map(item => item.resourceKey),
      locationResourceKeys: townCatalog.locationCandidates.map(item => item.resourceKey),
      ruleAndLoreResourceKeys: townCatalog.ruleAndLoreCandidates.map(item => item.resourceKey),
      artifactResourceKeys: townCatalog.artifactCandidates.map(item => item.resourceKey),
    })
    const selectedResidents = new Set(frozenSelection.residentResourceKeys)
    expect(frozenSelection.relationSubgraphResourceKeys).toEqual(townCatalog.relationEdges
      .filter(edge => selectedResidents.has(edge.fromCharacterResourceKey) && selectedResidents.has(edge.toCharacterResourceKey))
      .map(item => item.resourceKey))
    expect(frozenSelection.dependencyClosureResourceKeys).toEqual(expect.arrayContaining(frozenSelection.relationSubgraphResourceKeys))
    const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const customStart = suggestions.suggestions.find(item => item.kind === 'custom')!
    const townSettings: AiTownBriefSettingsV1 = {
      playerRole: 'caretaker', playerName: '阿晴', homeConcept: '带工作台的旧灯塔看守房',
      townTitle: '潮声余居', elapsedDays: 730, romance: 'opt-in', residentTarget: 4,
      majorLocationTarget: 6, actionsPerDay: 5, offlineEnabled: true, offlineMaximumDays: 2,
      resourceKeys: ['wood', 'food'], startingMoney: 360, sharedProjectConcept: '修复海边温室',
      portraits: true, expressions: false, locationCards: true, ambientAudio: true,
    }
    const brief = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: customStart.suggestionKey,
      productType: 'ai-town', visualLevel: 'key-scenes', audioLevel: 'music-sfx',
      playerRole: '扮演新居民', openingSituation: '危机结束两年后，旧友共同修复海边温室。',
      aiTown: townSettings,
    })
    expect(parseProductProductionBriefV3(brief)).toEqual(brief)
    expect(brief.aiTown).toMatchObject({
      player: { role: 'caretaker', name: '阿晴' },
      continuity: { elapsedDays: 730, romance: 'opt-in' },
      town: { title: '潮声余居', residentTarget: 4, majorLocationTarget: 6 },
      clock: { actionsPerDay: 5 }, autonomy: { offlineMaximumDays: 2 },
      management: { resourceKeys: ['wood', 'food'], startingMoney: 360 },
      safety: { majorChangeConfirmation: true, privateMindPlayerAccess: 'none' },
    })
    expect(brief.media).toMatchObject({
      imageCount: 10,
      musicTrackCount: 0,
      sfxCount: 1,
      requiredMediaKinds: ['background', 'character-pose', 'ambience'],
    })
    expect(brief.capabilityRequirements.filter(item => item.mediaClass !== 'text').map(item => item.mediaClass).sort())
      .toEqual(['image', 'sfx'])
    const boundedResidents = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: customStart.suggestionKey,
      productType: 'ai-town', visualLevel: 'key-scenes', audioLevel: 'none',
      aiTown: { ...townSettings, residentTarget: 8, expressions: true },
    })
    expect(boundedResidents.aiTown?.town.residentTarget).toBe(5)
    expect(boundedResidents.media).toMatchObject({ imageCount: 16 })
    const silentTown = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: customStart.suggestionKey,
      productType: 'ai-town', visualLevel: 'none', audioLevel: 'music-sfx',
      aiTown: { ...townSettings, portraits: false, expressions: false, locationCards: false, ambientAudio: false },
    })
    expect(silentTown.media).toMatchObject({
      visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0, sfxCount: 0,
      requiredMediaKinds: [],
    })
    expect(brief.aiTown?.sourceSelection.residentResourceKeys).toHaveLength(4)
    await expect(assertAiTownWorldSourceSelectionHashV1({
      ...brief.aiTown!.sourceSelection,
      worldContentHash: 'b'.repeat(64),
    })).rejects.toThrow(/selectionHash/)

    await expect(draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: customStart.suggestionKey,
      productType: 'ai-town', aiTown: { ...brief.aiTown!, residentTarget: 9 } as never,
    })).rejects.toThrow(/4\.\.8/)
  })

  it('拒绝伪造 suggestionKey、跨 Work Release 与被篡改的冻结来源', async () => {
    const left = await workspace('会谈左侧')
    const right = await workspace('会谈右侧')
    await expect(suggestProductStartingPoints({ scope: right.scope, worldReleaseId: left.release.id! }))
      .rejects.toThrow(/不属于请求的世界作用域/)
    await expect(draftProductProductionBriefV3({
      scope: left.scope, worldReleaseId: left.release.id!, suggestionKey: 'custom:forged',
      productType: 'avg',
    })).rejects.toThrow(/不属于当前冻结 WorldRelease/)
    await db.worldReleases.update(left.release.id!, { manifestJson: '{}' })
    await expect(suggestProductStartingPoints({ scope: left.scope, worldReleaseId: left.release.id! }))
      .rejects.toThrow(/已被篡改/)
    expect(await db.productProductions.count()).toBe(0)
  })
})
