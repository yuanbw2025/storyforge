import { db } from '../db/schema'
import {
  canonicalGameProductionJsonV2,
  hashGameProductionValueV2,
} from '../game-production/hash'
import {
  createGameReleaseManifestV2,
  parseGameRuntimePackageV2,
  verifyGameReleaseManifestV2,
} from '../game-production/runtime-package'
import type {
  FrozenGameNarrativeNode,
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  GameRelease,
  GameRuntimePackageV2,
  TtrpgCampaignContentV1,
  WorkspaceScope,
  WorldGameSourceSelectionV2,
  WorldReleaseManifestV2,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../world-engine/scope'
import { isTtrpgFixtureCampaignV1, parseTtrpgCampaignContentV1, validateTtrpgCampaignForPublicationV1 } from './campaign'
import { parseRulePackV1, runRulePackFixturesV1 } from './rule-pack'

function portableIds(manifest: WorldReleaseManifestV2, tableName: string): number[] {
  const rows = manifest.records[tableName] ?? []
  if (!Array.isArray(rows)) throw new Error(`[ttrpg-release] ${tableName} 不是数组`)
  return rows.flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`[ttrpg-release] ${tableName}[${index}] 无效`)
    }
    const id = (value as Record<string, unknown>)._exportId ?? index
    if (!Number.isInteger(id) || Number(id) < 0) throw new Error(`[ttrpg-release] ${tableName}[${index}] 缺少便携 ID`)
    return [Number(id)]
  }).sort((left, right) => left - right)
}

function portableArtifactIds(manifest: WorldReleaseManifestV2): number[] {
  const categories = new Set((manifest.records.codexCategories ?? []).flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (row.builtInKey !== 'artifact') return []
    const id = row._exportId ?? index
    return Number.isInteger(id) && Number(id) >= 0 ? [Number(id)] : []
  }))
  return (manifest.records.codexEntries ?? []).flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (!categories.has(Number(row._categoryExportId))) return []
    const id = row._exportId ?? index
    if (!Number.isInteger(id) || Number(id) < 0) throw new Error(`[ttrpg-release] codexEntries[${index}] 缺少便携 ID`)
    return [Number(id)]
  }).sort((left, right) => left - right)
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function selectedSubset(actual: readonly number[], available: readonly number[], label: string): number[] {
  const sorted = [...actual].sort((left, right) => left - right)
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`[ttrpg-release] ${label} 包含重复便携 ID`)
  }
  const allowed = new Set(available)
  if (sorted.some(id => !allowed.has(id))) {
    throw new Error(`[ttrpg-release] ${label} 包含不属于冻结 WorldRelease 的便携 ID`)
  }
  return sorted
}

function validateProductionSelection(
  manifest: WorldReleaseManifestV2,
  selection: WorldGameSourceSelectionV2,
  worldContentHash: string,
): WorldGameSourceSelectionV2 {
  if (selection.schema !== 'storyforge.world-game-source' || selection.version !== 2
    || selection.productType !== 'ttrpg' || selection.worldContentHash !== worldContentHash) {
    throw new Error('[ttrpg-release] TTRPG 生产选择与冻结 WorldRelease 不一致')
  }
  const expected = {
    narrativeModuleExportIds: manifest.selectedNarrativeModules.map(module => module.exportId).sort((a, b) => a - b),
    characterExportIds: portableIds(manifest, 'characters'),
    characterRelationExportIds: portableIds(manifest, 'characterRelations'),
    importantLocationExportIds: portableIds(manifest, 'importantLocations'),
    artifactExportIds: portableArtifactIds(manifest),
    codexEntryExportIds: portableIds(manifest, 'codexEntries'),
    storyArcExportIds: portableIds(manifest, 'storyArcs'),
    avgMediaAssetExportIds: portableIds(manifest, 'avgMediaAssets'),
  }
  for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
    selectedSubset(selection[field], expected[field], field)
  }
  const productSource = selection.productSource
  if (!productSource || productSource.kind !== 'ttrpg'
    || !sameIds([...productSource.participantCharacterExportIds].sort((a, b) => a - b), [...selection.characterExportIds].sort((a, b) => a - b))
    || !sameIds([...productSource.locationExportIds].sort((a, b) => a - b), [...selection.importantLocationExportIds].sort((a, b) => a - b))
    || !sameIds([...productSource.questStoryArcExportIds].sort((a, b) => a - b), [...selection.storyArcExportIds].sort((a, b) => a - b))) {
    throw new Error('[ttrpg-release] TTRPG productSource 与 Brief 素材选择不一致')
  }
  return structuredClone(selection)
}

export function ttrpgCampaignNarrativeV1(campaign: TtrpgCampaignContentV1): GameRuntimePackageV2['narrative'] {
  const endingTargetsForScene = (sceneKey: string): string[] => {
    const machineBound = campaign.endings.filter(ending => ending.trigger?.sceneKey === sceneKey)
    return (machineBound.length ? machineBound : campaign.endings.filter(ending => !ending.trigger))
      .map(ending => ending.endingKey)
  }
  const nodes: FrozenGameNarrativeNode[] = [
    ...campaign.scenes.map(scene => ({
      key: scene.sceneKey,
      kind: scene.sceneKey === campaign.openingSceneKey ? 'entry' as const : 'scene' as const,
      title: scene.title,
      summary: scene.description,
      conditionJson: '{}',
      effectsJson: '[]',
      successorKeys: scene.nextSceneKeys.length ? scene.nextSceneKeys : endingTargetsForScene(scene.sceneKey),
    })),
    ...campaign.endings.map(ending => ({
      key: ending.endingKey, kind: 'ending' as const, title: ending.title, summary: ending.epilogue,
      conditionJson: '{}', effectsJson: '[]', successorKeys: [],
    })),
  ]
  const beats: FrozenNarrativeBeat[] = nodes.map((node, index) => ({
    beatKey: `beat.${node.key}`, nodeKey: node.key, kind: 'narration', speakerKey: null,
    text: node.summary, order: index,
  }))
  const choices: FrozenNarrativeChoice[] = campaign.scenes.flatMap(scene => {
    const successors = scene.nextSceneKeys.length ? scene.nextSceneKeys : endingTargetsForScene(scene.sceneKey)
    return successors.map((targetNodeKey, index) => {
      const target = nodes.find(node => node.key === targetNodeKey)!
      return {
        choiceKey: `choice.${scene.sceneKey}.${targetNodeKey}`,
        sourceNodeKey: scene.sceneKey,
        text: target.kind === 'ending' ? `选择结局：${target.title}` : `前往：${target.title}`,
        description: target.summary,
        unavailableReason: '', targetNodeKey,
        displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]',
        tags: target.kind === 'ending' ? ['ending'] : ['campaign-scene'], order: index,
      }
    })
  })
  return {
    moduleKind: 'quest', moduleTitle: campaign.title, entryNodeKey: campaign.openingSceneKey,
    nodes, beats, choices,
  }
}

export async function buildTtrpgRuntimePackageV1(input: {
  worldReleaseManifest: WorldReleaseManifestV2
  worldContentHash: string
  selection?: WorldGameSourceSelectionV2
  rulePack: unknown
  rulePackContentHash: string
  campaign: unknown
}): Promise<GameRuntimePackageV2> {
  const rulePack = parseRulePackV1(input.rulePack)
  runRulePackFixturesV1(rulePack)
  if (await hashGameProductionValueV2(rulePack) !== input.rulePackContentHash) {
    throw new Error('[ttrpg-release] RulePack contentHash 校验失败')
  }
  const campaign = parseTtrpgCampaignContentV1(input.campaign, rulePack)
  const report = validateTtrpgCampaignForPublicationV1(campaign, rulePack)
  if (!report.valid) throw new Error(`[ttrpg-release] CampaignPack 未通过发布预检:${report.errors.join('；')}`)
  if (campaign.sourceWorld.contentHash !== input.worldContentHash) {
    throw new Error('[ttrpg-release] CampaignPack 来源不是目标 WorldRelease')
  }
  const manifest = input.worldReleaseManifest
  if (manifest.schema !== 'storyforge.world-package' || manifest.version !== 2) {
    throw new Error('[ttrpg-release] 只支持 WorldRelease manifest v2')
  }
  const narrativeModuleExportIds = manifest.selectedNarrativeModules.map(module => module.exportId).sort((a, b) => a - b)
  const characterExportIds = portableIds(manifest, 'characters')
  const importantLocationExportIds = portableIds(manifest, 'importantLocations')
  const storyArcExportIds = portableIds(manifest, 'storyArcs')
  const completeSelection: WorldGameSourceSelectionV2 = {
    schema: 'storyforge.world-game-source', version: 2, productType: 'ttrpg',
    worldContentHash: input.worldContentHash,
    narrativeModuleExportIds, characterExportIds,
    characterRelationExportIds: portableIds(manifest, 'characterRelations'),
    importantLocationExportIds,
    artifactExportIds: portableArtifactIds(manifest),
    codexEntryExportIds: portableIds(manifest, 'codexEntries'),
    storyArcExportIds,
    avgMediaAssetExportIds: portableIds(manifest, 'avgMediaAssets'),
    productSource: {
      kind: 'ttrpg', participantCharacterExportIds: characterExportIds,
      locationExportIds: importantLocationExportIds, questStoryArcExportIds: storyArcExportIds,
    },
  }
  const selection = input.selection
    ? validateProductionSelection(manifest, input.selection, input.worldContentHash)
    : completeSelection
  return parseGameRuntimePackageV2({
    schema: 'storyforge.game-runtime-package', version: 2, productType: 'ttrpg',
    definition: {
      gameKey: campaign.campaignKey, title: campaign.title, description: campaign.pitch,
      enabledCapabilities: ['narrative', 'ttrpg'], rulesetVersion: 1,
      initialVariables: { sessionZeroComplete: false, revealedClueKeys: [], completedQuestKeys: [] },
    },
    sourceWorld: { contentHash: input.worldContentHash, selection },
    narrative: ttrpgCampaignNarrativeV1(campaign),
    ttrpg: {
      rulePack: { content: rulePack, contentHash: input.rulePackContentHash },
      campaign,
      compatibility: { runtimeProtocol: 1, minimumPlayerVersion: 1 },
    },
  })
}

export async function publishTtrpgCampaignReleaseV1(input: {
  scope: WorkspaceScope
  campaignModuleId: number
  label?: string
  /** Isolated tests may publish the deterministic fixture to exercise runtime lifecycle. */
  testOnlyAllowFixtureCampaign?: true
}): Promise<GameRelease> {
  if (import.meta.env.MODE !== 'test') {
    throw new Error('[ttrpg-release] 旧 CampaignPack 发布仅允许隔离测试；正式发布必须进入跑团产品生产流程')
  }
  const scope = await resolveScope({ scope: input.scope })
  const campaignRow = await db.ttrpgCampaignModules.get(input.campaignModuleId)
  if (!campaignRow || !await assertRecordInScope(scope, 'ttrpgCampaignModules', campaignRow, { owner: 'work' })) {
    throw new Error('[ttrpg-release] CampaignPack 不存在或跨 Work')
  }
  const [ruleRow, worldRelease] = await Promise.all([
    db.gameRulePacks.get(campaignRow.rulePackId),
    db.worldReleases.get(campaignRow.sourceWorldReleaseId),
  ])
  if (!ruleRow || !await assertRecordInScope(scope, 'gameRulePacks', ruleRow, { owner: 'work' })) {
    throw new Error('[ttrpg-release] RulePack 不存在或跨 Work')
  }
  if (!worldRelease || !await assertRecordInScope(scope, 'worldReleases', worldRelease, { owner: 'world' })) {
    throw new Error('[ttrpg-release] WorldRelease 不存在或跨 World')
  }
  if (ruleRow.status !== 'validated' || campaignRow.status !== 'validated') {
    throw new Error('[ttrpg-release] RulePack 与 CampaignPack 都必须是 validated')
  }
  const rulePack = parseRulePackV1(ruleRow.rulePackJson)
  const campaign = parseTtrpgCampaignContentV1(campaignRow.contentJson, rulePack)
  if (isTtrpgFixtureCampaignV1(campaign) && input.testOnlyAllowFixtureCampaign !== true) {
    throw new Error('[ttrpg-release] 固定战役 fixture 不得进入正式 GameRelease；请通过跑团制作流程生成 CampaignPack')
  }
  const runtimePackage = await buildTtrpgRuntimePackageV1({
    worldReleaseManifest: JSON.parse(worldRelease.manifestJson) as WorldReleaseManifestV2,
    worldContentHash: worldRelease.contentHash,
    rulePack, rulePackContentHash: ruleRow.contentHash, campaign,
  })
  const releaseManifest = await createGameReleaseManifestV2({ runtimePackage, productionProvenance: null })
  await verifyGameReleaseManifestV2(releaseManifest)
  const manifestJson = canonicalGameProductionJsonV2(releaseManifest)
  const contentHash = await hashGameProductionValueV2(releaseManifest)
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(
    db.gameRulePacks, db.ttrpgCampaignModules, db.worldReleases, db.gameReleases,
  ), async () => {
    const [currentCampaign, currentRule, currentWorld] = await Promise.all([
      db.ttrpgCampaignModules.get(campaignRow.id!),
      db.gameRulePacks.get(ruleRow.id!),
      db.worldReleases.get(worldRelease.id!),
    ])
    if (!currentCampaign || currentCampaign.contentHash !== campaignRow.contentHash
      || currentCampaign.status !== 'validated' || !currentRule
      || currentRule.contentHash !== ruleRow.contentHash || currentRule.status !== 'validated'
      || !currentWorld || currentWorld.contentHash !== worldRelease.contentHash
      || currentWorld.manifestJson !== worldRelease.manifestJson) {
      throw new Error('[ttrpg-release] 发布来源在提交前发生变化')
    }
    const duplicate = await db.gameReleases.where('contentHash').equals(contentHash).and(row => (
      row.workId === scope.workId && row.worldReleaseId === worldRelease.id
    )).first()
    if (duplicate) return duplicate
    const releases = await db.gameReleases.where('workId').equals(scope.workId).toArray()
    const prior = releases.filter(release => {
      try {
        const parsed = JSON.parse(release.manifestJson) as { productType?: string; runtimePackage?: { definition?: { gameKey?: string } } }
        return parsed.productType === 'ttrpg' && parsed.runtimePackage?.definition?.gameKey === runtimePackage.definition.gameKey
      } catch { return false }
    })
    const row: GameRelease = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      gameDefinitionId: null, worldReleaseId: worldRelease.id!,
      version: Math.max(0, ...prior.map(release => release.version)) + 1,
      label: input.label?.trim() || `${campaignRow.title} v${prior.length + 1}`,
      manifestJson, contentHash, createdAt: now,
    }
    const id = await db.gameReleases.add(row) as number
    return { ...row, id }
  })
}
