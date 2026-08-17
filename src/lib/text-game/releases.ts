import Dexie from 'dexie'
import { db } from '../db/schema'
import { parseAdventureContent } from '../adventure/runtime'
import { freezeAvgMediaAsset, parseAvgPresentationContent, validateAvgPresentation } from '../avg/runtime'
import { parseNarrativeSimulationContent, validateNarrativeSimulationContent } from '../narrative-simulation/runtime'
import { parseOpenWorldContent, validateOpenWorldContent } from '../open-world/runtime'
import type {
  AnyGameReleaseManifestV1,
  AvgGameReleaseManifestV1,
  AvgMediaAsset,
  FrozenGameNarrativeNode,
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  GameDefinition,
  GameRelease,
  GameReleaseManifestV1,
  NarrativeSimulationGameReleaseManifestV1,
  TextOpenWorldGameReleaseManifestV1,
  WorkspaceScope,
  WorldReleaseManifestV2,
} from '../types'
import { assertReleaseUnchanged } from '../world-engine/releases'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../world-engine/scope'
import {
  parseGameCapabilities,
  parseGameDefinitionWorldSource,
  parseGameInitialVariables,
  validateNarrativeContentGraph,
} from './content'
import {
  parseNarrativeCondition,
  parseNarrativeEffects,
} from '../narrative/blueprint'
import { parseInteractionSourceCharacterSnapshot } from '../character-interaction/source-character'

export function parseWorldReleaseSpeakerNames(manifestJson: string): Record<string, string> {
  const manifest = JSON.parse(manifestJson) as WorldReleaseManifestV2
  if (manifest.schema !== 'storyforge.world-package' || manifest.version !== 2) return {}
  const characters = (manifest.records.characters ?? []) as Array<Record<string, unknown>>
  return Object.fromEntries(characters.flatMap((row, index) => {
    if (typeof row.name !== 'string' || !row.name.trim()) return []
    // Strict v4 exports use the stable array index as the portable identity
    // for tables without an explicit exportIdField. NarrativeBeat references
    // use that same fallback in _speakerCharacterExportId.
    const exportId = Number.isInteger(row._exportId) ? Number(row._exportId) : index
    return [[`character:${exportId}`, row.name.trim()]]
  }))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: unknown): Promise<string> {
  const digestPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
  const digest = Dexie.currentTransaction ? await Dexie.waitFor(digestPromise) : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function decodePortableDataUrl(value: string): ArrayBuffer {
  const match = /^data:[^;,]*;base64,([A-Za-z0-9+/=]*)$/.exec(value)
  if (!match) throw new Error('[avg] WorldRelease 媒资不是合法 data URL')
  let binary = ''
  try { binary = atob(match[1]) } catch { throw new Error('[avg] WorldRelease 媒资 base64 无效') }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

async function sha256Binary(value: ArrayBuffer): Promise<string> {
  const digestPromise = crypto.subtle.digest('SHA-256', value)
  const digest = Dexie.currentTransaction ? await Dexie.waitFor(digestPromise) : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseWorldManifest(value: string): WorldReleaseManifestV2 {
  const manifest = JSON.parse(value) as WorldReleaseManifestV2
  if (manifest.schema !== 'storyforge.world-package' || manifest.version !== 2) {
    throw new Error('[storygame] GameRelease 必须绑定 WorldRelease v2')
  }
  return manifest
}

function releaseModuleExportId(
  manifest: WorldReleaseManifestV2,
  module: { kind: string; title: string },
): number {
  const modules = (manifest.records.narrativeModules ?? []) as Array<Record<string, unknown>>
  const selected = manifest.selectedNarrativeModules.filter(item => (
    item.kind === module.kind && item.title === module.title
  ))
  if (selected.length !== 1) throw new Error('[storygame] WorldRelease 中叙事模块身份缺失或不唯一')
  const candidate = modules.find(row => row._exportId === selected[0].exportId
    && row.kind === module.kind && row.title === module.title)
  const exportId = typeof candidate?._exportId === 'number' ? candidate._exportId : null
  if (exportId == null) throw new Error('[storygame] WorldRelease 不包含游戏定义的叙事模块')
  return exportId
}

function freezeNodes(rows: Array<Record<string, unknown>>): FrozenGameNarrativeNode[] {
  return rows.map(row => {
    const conditionJson = String(row.conditionJson ?? '{}')
    const effectsJson = String(row.effectsJson ?? '[]')
    parseNarrativeCondition(conditionJson)
    parseNarrativeEffects(effectsJson)
    const successors = JSON.parse(String(row.successorKeysJson ?? '[]')) as unknown
    if (!Array.isArray(successors) || successors.some(key => typeof key !== 'string' || !key.trim())) {
      throw new Error(`[storygame] 发布节点后继无效:${String(row.key ?? '')}`)
    }
    return {
      key: String(row.key ?? '').trim(),
      kind: row.kind as FrozenGameNarrativeNode['kind'],
      title: String(row.title ?? '').trim(),
      summary: String(row.summary ?? '').trim(),
      conditionJson,
      effectsJson,
      successorKeys: successors.map(key => String(key).trim()),
    }
  })
}

function freezeBeat(row: Record<string, unknown>, characterCount: number): FrozenNarrativeBeat {
  const speakerExportId = row._speakerCharacterExportId
  if (speakerExportId != null
    && (!Number.isInteger(speakerExportId) || Number(speakerExportId) < 0 || Number(speakerExportId) >= characterCount)) {
    throw new Error(`[storygame] WorldRelease 中 Beat speaker 越界:${String(row.beatKey ?? '')}`)
  }
  return {
    beatKey: String(row.beatKey ?? '').trim(),
    nodeKey: String(row.nodeKey ?? '').trim(),
    kind: row.kind as FrozenNarrativeBeat['kind'],
    speakerKey: speakerExportId == null ? null : `character:${Number(speakerExportId)}`,
    text: String(row.text ?? ''),
    order: Number(row.order ?? 0),
  }
}

function freezeChoice(row: Record<string, unknown>): FrozenNarrativeChoice {
  const displayConditionJson = String(row.displayConditionJson ?? '{}')
  const availableConditionJson = String(row.availableConditionJson ?? '{}')
  const effectsJson = String(row.effectsJson ?? '[]')
  parseNarrativeCondition(displayConditionJson)
  parseNarrativeCondition(availableConditionJson)
  parseNarrativeEffects(effectsJson)
  const tags = JSON.parse(String(row.tagsJson ?? '[]')) as unknown
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
    throw new Error(`[storygame] Choice 标签无效:${String(row.choiceKey ?? '')}`)
  }
  return {
    choiceKey: String(row.choiceKey ?? '').trim(),
    sourceNodeKey: String(row.sourceNodeKey ?? '').trim(),
    text: String(row.text ?? ''),
    description: String(row.description ?? ''),
    unavailableReason: String(row.unavailableReason ?? ''),
    targetNodeKey: String(row.targetNodeKey ?? '').trim(),
    displayConditionJson,
    availableConditionJson,
    effectsJson,
    tags: tags.map(tag => String(tag).trim()),
    order: Number(row.order ?? 0),
  }
}

function parseArray<T>(value: unknown, label: string): T[] {
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { throw new Error(`[chatgame] ${label} 不是合法 JSON`) }
  }
  if (!Array.isArray(parsed)) throw new Error(`[chatgame] ${label} 必须是数组`)
  return structuredClone(parsed) as T[]
}

function freezeInteractionProfile(
  row: Record<string, unknown>,
  characters: Array<Record<string, unknown>>,
): FrozenInteractionCharacterProfile {
  const characterExportId = typeof row._characterExportId === 'number'
    ? row._characterExportId
    : Number.NaN
  // Characters retain the legacy portable-array-index contract instead of an
  // explicit _exportId field; references still use that stable export index.
  const character = Number.isInteger(characterExportId) ? characters[characterExportId] : null
  const sourceCharacter = parseInteractionSourceCharacterSnapshot(row.sourceSnapshotJson)
  if (character && sourceCharacter) {
    throw new Error(`[chatgame] 互动角色同时冻结了两种身份:${String(row.participantKey ?? '')}`)
  }
  if ((!character || typeof character.name !== 'string' || !character.name.trim()) && !sourceCharacter) {
    throw new Error(`[chatgame] 互动角色没有有效的冻结 Character:${String(row.participantKey ?? '')}`)
  }
  return {
    participantKey: String(row.participantKey ?? '').trim(),
    characterKey: sourceCharacter?.characterKey ?? `character:${characterExportId}`,
    name: sourceCharacter?.name ?? String(character!.name).trim(),
    roleLabel: String(row.roleLabel ?? '').trim(),
    voiceRules: String(row.voiceRules ?? '').trim(),
    initialKnowledge: parseArray(row.initialKnowledgeJson ?? '[]', '初始知识'),
    relationshipDimensions: parseArray(row.relationshipDimensionsJson ?? '[]', '关系维度'),
    maxMemoryEntries: Number(row.maxMemoryEntries ?? 24),
  }
}

function freezeInteractionScene(row: Record<string, unknown>): FrozenInteractionSceneTemplate {
  return {
    sceneKey: String(row.sceneKey ?? '').trim(),
    title: String(row.title ?? '').trim(),
    purpose: String(row.purpose ?? '').trim(),
    location: String(row.location ?? '').trim(),
    timeLabel: String(row.timeLabel ?? '').trim(),
    participantKeys: parseArray(row.participantKeysJson ?? '[]', '场景参与者'),
    publicKnowledgeKeys: parseArray(row.publicKnowledgeKeysJson ?? '[]', '场景公开知识'),
    goals: parseArray(row.goalsJson ?? '[]', '场景目标'),
    endingConditions: parseArray(row.endingConditionsJson ?? '[]', '场景结束条件'),
    safetyBoundaries: parseArray(row.safetyBoundariesJson ?? '[]', '场景安全边界'),
    relationshipRules: parseArray(row.relationshipRulesJson ?? '[]', '场景关系规则'),
    openingNodeKey: typeof row.openingNodeKey === 'string' && row.openingNodeKey.trim() ? row.openingNodeKey.trim() : null,
    endingNodeKey: typeof row.endingNodeKey === 'string' && row.endingNodeKey.trim() ? row.endingNodeKey.trim() : null,
    maxTurns: Number(row.maxTurns ?? 20),
    directorBudget: Number(row.directorBudget ?? 1),
    order: Number(row.order ?? 0),
  }
}

function gateAdventureEndingChoices(input: {
  nodes: FrozenGameNarrativeNode[]
  choices: FrozenNarrativeChoice[]
  adventure: ReturnType<typeof parseAdventureContent>
}): FrozenNarrativeChoice[] {
  const mainQuest = input.adventure.quests.find(item => item.completionNodeKey || item.failureNodeKey)
  if (!mainQuest) return input.choices
  const endingKeys = new Set(input.nodes.filter(item => item.kind === 'ending').map(item => item.key))
  const questProjectionKey = mainQuest.key.replace(/[^a-zA-Z0-9_]/g, '_')
  return input.choices.map(choice => {
    if (!endingKeys.has(choice.targetNodeKey)
      || choice.tags.some(tag => tag.startsWith('adventure-action:'))) return choice
    const status = mainQuest.failureNodeKey != null && choice.targetNodeKey === mainQuest.failureNodeKey
      ? 'failed'
      : 'completed'
    const gate = { path: `adventure.quests.${questProjectionKey}.status`, eq: status }
    const original = JSON.parse(choice.availableConditionJson) as Record<string, unknown>
    return {
      ...choice,
      availableConditionJson: JSON.stringify(Object.keys(original).length ? { all: [original, gate] } : gate),
    }
  })
}

async function buildGameReleaseManifest(input: {
  scope: WorkspaceScope
  definition: GameDefinition
  worldReleaseId: number
}): Promise<AnyGameReleaseManifestV1> {
  const scope = await resolveScope({ scope: input.scope })
  const worldRelease = await db.worldReleases.get(input.worldReleaseId)
  if (!worldRelease || worldRelease.worldId !== scope.worldId || worldRelease.projectId !== scope.projectId) {
    throw new Error('[storygame] WorldRelease 不属于当前 World')
  }
  await assertReleaseUnchanged(worldRelease.id!)
  const worldManifest = parseWorldManifest(worldRelease.manifestJson)
  const liveModule = await db.narrativeModules.get(input.definition.narrativeModuleId)
  if (!liveModule || !await assertRecordInScope(scope, 'narrativeModules', liveModule)) {
    throw new Error('[storygame] 游戏定义的叙事模块不属于当前 scope')
  }
  const moduleExportId = releaseModuleExportId(worldManifest, liveModule)
  const source = parseGameDefinitionWorldSource(input.definition)
  const moduleRow = (worldManifest.records.narrativeModules ?? []).find(raw => (
    !!raw && typeof raw === 'object' && (raw as Record<string, unknown>)._exportId === moduleExportId
  )) as Record<string, unknown> | undefined
  if (!moduleRow) throw new Error('[storygame] WorldRelease 缺少冻结叙事模块')
  const nodeRows = (worldManifest.records.narrativeNodes ?? []).filter(raw => (
    !!raw && typeof raw === 'object' && (raw as Record<string, unknown>)._moduleExportId === moduleExportId
  )) as Array<Record<string, unknown>>
  const beatRows = (worldManifest.records.narrativeBeats ?? []).filter(raw => (
    !!raw && typeof raw === 'object' && (raw as Record<string, unknown>)._moduleExportId === moduleExportId
  )) as Array<Record<string, unknown>>
  const choiceRows = (worldManifest.records.narrativeChoices ?? []).filter(raw => (
    !!raw && typeof raw === 'object' && (raw as Record<string, unknown>)._moduleExportId === moduleExportId
  )) as Array<Record<string, unknown>>
  const nodes = freezeNodes(nodeRows)
  const characterCount = (worldManifest.records.characters ?? []).length
  const frozenBeats = beatRows.map(row => freezeBeat(row, characterCount))
  const frozenChoices = choiceRows.map(freezeChoice)
  const entryNodeKey = String(moduleRow.entryNodeKey ?? '').trim()
  const common = {
    schema: 'storyforge.game-release' as const,
    version: 1 as const,
    definition: {
      gameKey: input.definition.gameKey,
      title: input.definition.title,
      description: input.definition.description,
      enabledCapabilities: parseGameCapabilities(input.definition),
      rulesetVersion: input.definition.rulesetVersion,
      initialVariables: parseGameInitialVariables(input.definition),
      source: source
        ? {
            worldContentHash: source.worldContentHash,
            mappingVersion: source.mappingVersion,
            selection: source.selection,
          }
        : null,
    },
    worldRelease: {
      contentHash: worldRelease.contentHash,
      narrativeModuleExportId: moduleExportId,
    },
    narrative: {
      moduleKind: moduleRow.kind as GameReleaseManifestV1['narrative']['moduleKind'],
      moduleTitle: String(moduleRow.title ?? '').trim(),
      entryNodeKey,
      nodes,
      beats: frozenBeats,
      choices: frozenChoices,
    },
  }
  let gameManifest: AnyGameReleaseManifestV1
  if (input.definition.productType === 'storygame') {
    gameManifest = { ...common, productType: 'storygame' }
  } else if (input.definition.productType === 'character-interaction') {
    const definitionRows = (worldManifest.records.gameDefinitions ?? []) as Array<Record<string, unknown>>
    const definitionRow = definitionRows.find(row => row.gameKey === input.definition.gameKey
      && row.productType === 'character-interaction')
    if (!definitionRow || !Number.isInteger(definitionRow._exportId)) {
      throw new Error('[chatgame] WorldRelease 缺少当前互动游戏定义')
    }
    const definitionExportId = Number(definitionRow._exportId)
    const profileRows = (worldManifest.records.interactionCharacterProfiles ?? [])
      .filter(raw => !!raw && typeof raw === 'object'
        && (raw as Record<string, unknown>)._gameDefinitionExportId === definitionExportId) as Array<Record<string, unknown>>
    const sceneRows = (worldManifest.records.interactionSceneTemplates ?? [])
      .filter(raw => !!raw && typeof raw === 'object'
        && (raw as Record<string, unknown>)._gameDefinitionExportId === definitionExportId) as Array<Record<string, unknown>>
    gameManifest = {
      ...common,
      productType: 'character-interaction',
      interaction: {
        playerKey: 'player',
        profiles: profileRows.map(row => freezeInteractionProfile(
          row,
          (worldManifest.records.characters ?? []) as Array<Record<string, unknown>>,
        )).sort((left, right) => left.participantKey.localeCompare(right.participantKey)),
        sceneTemplates: sceneRows.map(freezeInteractionScene)
          .sort((left, right) => left.order - right.order || left.sceneKey.localeCompare(right.sceneKey)),
      },
    }
  } else if (input.definition.productType === 'text-adventure') {
    const definitionRows = (worldManifest.records.gameDefinitions ?? []) as Array<Record<string, unknown>>
    const definitionRow = definitionRows.find(row => row.gameKey === input.definition.gameKey
      && row.productType === 'text-adventure')
    if (!definitionRow || !Number.isInteger(definitionRow._exportId)) {
      throw new Error('[adventure] WorldRelease 缺少当前文字冒险定义')
    }
    const moduleRows = (worldManifest.records.adventureModules ?? []) as Array<Record<string, unknown>>
    const moduleRow = moduleRows.find(row => row._gameDefinitionExportId === Number(definitionRow._exportId))
    if (!moduleRow || typeof moduleRow.contentJson !== 'string') {
      throw new Error('[adventure] WorldRelease 缺少当前冒险内容模块')
    }
    const definitionExportId = Number(definitionRow._exportId)
    const profileRows = (worldManifest.records.interactionCharacterProfiles ?? [])
      .filter(raw => !!raw && typeof raw === 'object'
        && (raw as Record<string, unknown>)._gameDefinitionExportId === definitionExportId) as Array<Record<string, unknown>>
    const sceneRows = (worldManifest.records.interactionSceneTemplates ?? [])
      .filter(raw => !!raw && typeof raw === 'object'
        && (raw as Record<string, unknown>)._gameDefinitionExportId === definitionExportId) as Array<Record<string, unknown>>
    const adventure = parseAdventureContent(moduleRow.contentJson)
    gameManifest = {
      ...common,
      productType: 'text-adventure',
      narrative: {
        ...common.narrative,
        choices: gateAdventureEndingChoices({
          nodes: common.narrative.nodes,
          choices: common.narrative.choices,
          adventure,
        }),
      },
      interaction: {
        playerKey: 'player',
        profiles: profileRows.map(row => freezeInteractionProfile(
          row,
          (worldManifest.records.characters ?? []) as Array<Record<string, unknown>>,
        )).sort((left, right) => left.participantKey.localeCompare(right.participantKey)),
        sceneTemplates: sceneRows.map(freezeInteractionScene)
          .sort((left, right) => left.order - right.order || left.sceneKey.localeCompare(right.sceneKey)),
      },
      adventure,
    }
  } else if (input.definition.productType === 'avg') {
    const definitionRows = (worldManifest.records.gameDefinitions ?? []) as Array<Record<string, unknown>>
    const definitionRow = definitionRows.find(row => row.gameKey === input.definition.gameKey && row.productType === 'avg')
    if (!definitionRow || !Number.isInteger(definitionRow._exportId)) throw new Error('[avg] WorldRelease 缺少当前 AVG 定义')
    const presentationRow = ((worldManifest.records.avgPresentationModules ?? []) as Array<Record<string, unknown>>)
      .find(row => row._gameDefinitionExportId === Number(definitionRow._exportId))
    if (!presentationRow || typeof presentationRow.contentJson !== 'string') throw new Error('[avg] WorldRelease 缺少演出模块')
    const content = parseAvgPresentationContent(presentationRow.contentJson)
    const referencedAssetKeys = new Set(content.cues.flatMap(cue => cue.assetKey ? [cue.assetKey] : []))
    const allAssetRows = (worldManifest.records.avgMediaAssets ?? []) as Array<Record<string, unknown>>
    const latestByKey = new Map<string, Record<string, unknown>>()
    for (const row of allAssetRows) {
      const key = String(row.assetKey ?? '')
      const current = latestByKey.get(key)
      if (!current || Number(row.version) > Number(current.version)) latestByKey.set(key, row)
    }
    const assets = [...referencedAssetKeys].map(key => {
      const row = latestByKey.get(key)
      if (!row) throw new Error(`[avg] 缺少媒资:${key}`)
      return freezeAvgMediaAsset(row as unknown as AvgMediaAsset)
    }).sort((left, right) => left.assetKey.localeCompare(right.assetKey))
    const report = validateAvgPresentation({ content, beats: frozenBeats, assets })
    if (!report.valid) throw new Error(`[avg] 演出内容不可发布:${report.errors.join('；')}`)
    const blobRows = (worldManifest.records.avgMediaBlobs ?? []) as Array<Record<string, unknown>>
    for (const asset of assets) {
      const source = allAssetRows.find(row => row.assetKey === asset.assetKey && row.version === asset.version)
      const blob = blobRows.find(row => row._mediaAssetExportId === source?._exportId)
      if (!blob || typeof blob.data !== 'string' || !blob.data.startsWith('data:')) {
        throw new Error(`[avg] 媒资二进制未随 WorldRelease 冻结:${asset.assetKey}`)
      }
      const binary = decodePortableDataUrl(blob.data)
      if (binary.byteLength !== asset.byteSize || await sha256Binary(binary) !== asset.contentHash) {
        throw new Error(`[avg] WorldRelease 媒资二进制完整性失败:${asset.assetKey}@${asset.version}`)
      }
    }
    gameManifest = { ...common, productType: 'avg', presentation: { ...content, assets } }
  } else if (input.definition.productType === 'narrative-simulation') {
    const definitionRows = (worldManifest.records.gameDefinitions ?? []) as Array<Record<string, unknown>>
    const definitionRow = definitionRows.find(row => row.gameKey === input.definition.gameKey
      && row.productType === 'narrative-simulation')
    if (!definitionRow || !Number.isInteger(definitionRow._exportId)) {
      throw new Error('[textsim] WorldRelease 缺少当前叙事模拟定义')
    }
    const simulationRow = ((worldManifest.records.narrativeSimulationModules ?? []) as Array<Record<string, unknown>>)
      .find(row => row._gameDefinitionExportId === Number(definitionRow._exportId))
    if (!simulationRow || typeof simulationRow.contentJson !== 'string') {
      throw new Error('[textsim] WorldRelease 缺少叙事模拟内容模块')
    }
    const simulation = parseNarrativeSimulationContent(simulationRow.contentJson)
    const simulationReport = validateNarrativeSimulationContent({
      content: simulation,
      narrativeNodeKeys: nodes.map(node => node.key),
    })
    if (!simulationReport.valid) {
      throw new Error(`[textsim] 叙事模拟内容不可发布:${simulationReport.errors.join('；')}`)
    }
    gameManifest = { ...common, productType: 'narrative-simulation', simulation }
  } else if (input.definition.productType === 'text-open-world') {
    const definitionRows = (worldManifest.records.gameDefinitions ?? []) as Array<Record<string, unknown>>
    const definitionRow = definitionRows.find(row => row.gameKey === input.definition.gameKey
      && row.productType === 'text-open-world')
    if (!definitionRow || !Number.isInteger(definitionRow._exportId)) {
      throw new Error('[textworld] WorldRelease 缺少当前开放世界定义')
    }
    const definitionExportId = Number(definitionRow._exportId)
    const adventureRow = ((worldManifest.records.adventureModules ?? []) as Array<Record<string, unknown>>)
      .find(row => row._gameDefinitionExportId === definitionExportId)
    const simulationRow = ((worldManifest.records.narrativeSimulationModules ?? []) as Array<Record<string, unknown>>)
      .find(row => row._gameDefinitionExportId === definitionExportId)
    const openWorldRow = ((worldManifest.records.openWorldModules ?? []) as Array<Record<string, unknown>>)
      .find(row => row._gameDefinitionExportId === definitionExportId)
    if (typeof adventureRow?.contentJson !== 'string' || typeof simulationRow?.contentJson !== 'string'
      || typeof openWorldRow?.contentJson !== 'string') {
      throw new Error('[textworld] WorldRelease 缺少冒险、模拟或区域内容模块')
    }
    const profileRows = (worldManifest.records.interactionCharacterProfiles ?? [])
      .filter(raw => !!raw && typeof raw === 'object'
        && (raw as Record<string, unknown>)._gameDefinitionExportId === definitionExportId) as Array<Record<string, unknown>>
    const sceneRows = (worldManifest.records.interactionSceneTemplates ?? [])
      .filter(raw => !!raw && typeof raw === 'object'
        && (raw as Record<string, unknown>)._gameDefinitionExportId === definitionExportId) as Array<Record<string, unknown>>
    const interaction = {
      playerKey: 'player' as const,
      profiles: profileRows.map(row => freezeInteractionProfile(
        row,
        (worldManifest.records.characters ?? []) as Array<Record<string, unknown>>,
      )).sort((left, right) => left.participantKey.localeCompare(right.participantKey)),
      sceneTemplates: sceneRows.map(freezeInteractionScene)
        .sort((left, right) => left.order - right.order || left.sceneKey.localeCompare(right.sceneKey)),
    }
    const adventure = parseAdventureContent(adventureRow.contentJson)
    const simulation = parseNarrativeSimulationContent(simulationRow.contentJson)
    const simulationReport = validateNarrativeSimulationContent({
      content: simulation,
      narrativeNodeKeys: nodes.map(node => node.key),
    })
    if (!simulationReport.valid) throw new Error(`[textworld] 模拟内容不可发布:${simulationReport.errors.join('；')}`)
    const openWorld = parseOpenWorldContent(openWorldRow.contentJson)
    const openWorldReport = validateOpenWorldContent({
      content: openWorld,
      adventure,
      interactionProfiles: interaction.profiles,
      interactionScenes: interaction.sceneTemplates,
      simulation,
      narrativeNodeKeys: nodes.map(node => node.key),
    })
    if (!openWorldReport.valid) throw new Error(`[textworld] 开放世界内容不可发布:${openWorldReport.errors.join('；')}`)
    gameManifest = { ...common, productType: 'text-open-world', interaction, adventure, simulation, openWorld }
  } else {
    throw new Error(`[game-release] 尚未实现产品发布:${input.definition.productType}`)
  }
  const knownSpeakerKeys = new Set(Array.from(
    { length: characterCount },
    (_, index) => `character:${index}`,
  ))
  const graph = validateNarrativeContentGraph({
    entryNodeKey,
    nodes,
    beats: frozenBeats,
    choices: frozenChoices,
    knownSpeakerKeys,
  })
  if (!graph.valid) {
    throw new Error(`[storygame] WorldRelease 中的冻结内容图不可发布:${[
      ...graph.errors,
      ...graph.danglingSuccessors.map(item => `${item.nodeKey}->${item.successorKey}`),
      ...graph.invalidChoiceTargets.map(item => `${item.choiceKey}->${item.targetNodeKey}`),
      ...graph.unreachableNodeKeys.map(key => `不可达:${key}`),
    ].join('；')}`)
  }
  if (gameManifest.productType === 'character-interaction' || gameManifest.productType === 'text-adventure'
    || gameManifest.productType === 'text-open-world') {
    const profiles = gameManifest.interaction.profiles
    const scenes = gameManifest.interaction.sceneTemplates
    const participantKeys = new Set(profiles.map(profile => profile.participantKey))
    const knowledgeKeys = new Set(profiles.flatMap(profile => profile.initialKnowledge.map(item => item.key)))
    if (!profiles.length || !scenes.length || participantKeys.size !== profiles.length) {
      throw new Error('[chatgame] 至少需要一个唯一互动角色和一个场景模板')
    }
    for (const profile of profiles) {
      if (!profile.participantKey || !profile.roleLabel || !profile.voiceRules
        || !Number.isInteger(profile.maxMemoryEntries) || profile.maxMemoryEntries < 1) {
        throw new Error(`[chatgame] 互动角色配置无效:${profile.participantKey}`)
      }
      for (const knowledge of profile.initialKnowledge) {
        if (!knowledge.key || !knowledge.content || !['public', 'private'].includes(knowledge.visibility)
          || !Number.isInteger(knowledge.importance) || knowledge.importance < 0 || knowledge.importance > 100) {
          throw new Error(`[chatgame] 初始知识无效:${profile.participantKey}`)
        }
      }
      for (const dimension of profile.relationshipDimensions) {
        if (!['trust', 'closeness', 'wariness', 'respect'].includes(dimension.key)
          || dimension.minimum > dimension.initial || dimension.initial > dimension.maximum
          || dimension.largeChangeThreshold < 0) {
          throw new Error(`[chatgame] 关系维度无效:${profile.participantKey}`)
        }
      }
    }
    for (const scene of scenes) {
      if (!scene.sceneKey || !scene.title || !scene.purpose || !scene.location || !scene.timeLabel
        || !scene.participantKeys.length || !scene.goals.length || !scene.endingConditions.length
        || scene.participantKeys.some(key => !participantKeys.has(key))
        || scene.publicKnowledgeKeys.some(key => !knowledgeKeys.has(key))) {
        throw new Error(`[chatgame] 场景模板无效:${scene.sceneKey}`)
      }
      for (const rule of scene.relationshipRules ?? []) {
        const profile = profiles.find(item => item.participantKey === rule.fromParticipantKey)
        if (!profile || rule.toParticipantKey !== 'player'
          || !profile.relationshipDimensions.some(item => item.key === rule.dimensionKey)
          || !rule.ruleKey || !rule.playerText || !rule.reason || rule.delta === 0) {
          throw new Error(`[chatgame] 场景关系规则无效:${rule.ruleKey}`)
        }
      }
    }
  }
  if (gameManifest.productType === 'text-adventure' || gameManifest.productType === 'text-open-world') {
    const profiles = gameManifest.interaction.profiles
    const scenes = gameManifest.interaction.sceneTemplates
    const profileKeys = new Set(profiles.map(item => item.participantKey))
    const sceneByKey = new Map(scenes.map(item => [item.sceneKey, item]))
    for (const action of gameManifest.adventure.actions.filter(item => item.kind === 'talk')) {
      const binding = action.interaction
      const scene = binding ? sceneByKey.get(binding.sceneKey) : null
      const rule = scene?.relationshipRules.find(item => item.ruleKey === binding?.ruleKey)
      if (!binding || !profileKeys.has(binding.participantKey) || !scene
        || !scene.participantKeys.includes(binding.participantKey)
        || !rule || rule.fromParticipantKey !== binding.participantKey) {
        throw new Error(`[adventure] talk 行动没有有效的冻结角色互动绑定:${action.key}`)
      }
    }
  }
  return gameManifest
}

export async function publishGameDefinition(input: {
  scope: WorkspaceScope
  gameDefinitionId: number
  worldReleaseId: number
  label?: string
}): Promise<GameRelease> {
  const scope = await resolveScope({ scope: input.scope })
  const definition = await db.gameDefinitions.get(input.gameDefinitionId)
  if (!definition || !await assertRecordInScope(scope, 'gameDefinitions', definition, { owner: 'work' })) {
    throw new Error('[storygame] 游戏定义不属于当前 Work')
  }
  if (definition.productType !== 'storygame' && definition.productType !== 'character-interaction'
    && definition.productType !== 'text-adventure' && definition.productType !== 'avg'
    && definition.productType !== 'narrative-simulation' && definition.productType !== 'text-open-world') {
    throw new Error(`[game-release] 尚未实现产品发布:${definition.productType}`)
  }
  const manifest = await buildGameReleaseManifest({
    scope,
    definition,
    worldReleaseId: input.worldReleaseId,
  })
  const manifestJson = stableJson(manifest)
  const contentHash = await sha256(manifest)
  return db.transaction('rw', scopeTransactionTables(
    db.gameDefinitions,
    db.gameReleases,
    db.worldReleases,
    db.narrativeModules,
    db.narrativeNodes,
    db.narrativeBeats,
    db.narrativeChoices,
    db.characters,
    db.interactionCharacterProfiles,
    db.interactionSceneTemplates,
    db.adventureModules,
    db.avgPresentationModules,
    db.avgMediaAssets,
    db.avgMediaBlobs,
    db.narrativeSimulationModules,
    db.openWorldModules,
  ), async () => {
    const currentScope = await resolveScope({ scope })
    const current = await db.gameDefinitions.get(definition.id!)
    if (!current || !await assertRecordInScope(currentScope, 'gameDefinitions', current, { owner: 'work' })) {
      throw new Error('[storygame] 游戏定义在发布过程中丢失')
    }
    const currentManifest = await buildGameReleaseManifest({
      scope: currentScope,
      definition: current,
      worldReleaseId: input.worldReleaseId,
    })
    if (stableJson(currentManifest) !== manifestJson) throw new Error('[storygame] 游戏内容在发布冻结期间发生变化')
    const existing = await db.gameReleases
      .where('gameDefinitionId').equals(definition.id!)
      .filter(release => release.contentHash === contentHash)
      .first()
    if (existing) return existing
    const releases = await db.gameReleases.where('gameDefinitionId').equals(definition.id!).toArray()
    const row: GameRelease = {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      gameDefinitionId: definition.id!,
      worldReleaseId: input.worldReleaseId,
      version: Math.max(0, ...releases.map(release => release.version)) + 1,
      label: input.label?.trim() || `${definition.title} v${releases.length + 1}`,
      manifestJson,
      contentHash,
      createdAt: Date.now(),
    }
    const id = await db.gameReleases.add(row) as number
    return { ...row, id }
  })
}

export async function assertGameReleaseUnchanged(gameReleaseId: number): Promise<GameRelease> {
  const release = await db.gameReleases.get(gameReleaseId)
  if (!release) throw new Error('[storygame] GameRelease 不存在')
  const manifest = parseAnyGameReleaseManifest(release.manifestJson)
  if (await sha256(manifest) !== release.contentHash) throw new Error('[storygame] GameRelease 已被篡改')
  const worldRelease = await db.worldReleases.get(release.worldReleaseId)
  if (!worldRelease || worldRelease.projectId !== release.projectId || worldRelease.worldId !== release.worldId
    || worldRelease.contentHash !== manifest.worldRelease.contentHash) {
    throw new Error('[storygame] GameRelease 的 WorldRelease 绑定损坏')
  }
  await assertReleaseUnchanged(worldRelease.id!)
  return release
}

export function parseGameReleaseManifest(value: string): GameReleaseManifestV1 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'storygame') {
    throw new Error('[storygame] 不支持的 GameRelease 清单')
  }
  return parsed
}

export function parseAnyGameReleaseManifest(value: string): AnyGameReleaseManifestV1 {
  const parsed = JSON.parse(value) as AnyGameReleaseManifestV1
  if (parsed.schema !== 'storyforge.game-release' || parsed.version !== 1
    || (parsed.productType !== 'storygame' && parsed.productType !== 'character-interaction'
      && parsed.productType !== 'text-adventure' && parsed.productType !== 'avg'
      && parsed.productType !== 'narrative-simulation' && parsed.productType !== 'text-open-world')) {
    throw new Error('[game-release] 不支持的 GameRelease 清单')
  }
  if (!parsed.definition?.gameKey || !Array.isArray(parsed.definition.enabledCapabilities)
    || !parsed.definition.enabledCapabilities.includes('narrative')) {
    throw new Error('[game-release] GameRelease 定义无效')
  }
  if (parsed.definition.source) {
    parseGameDefinitionWorldSource({
      productType: parsed.productType,
      sourceWorldContentHash: parsed.definition.source.worldContentHash,
      sourceSelectionJson: JSON.stringify(parsed.definition.source.selection),
      sourceMappingVersion: parsed.definition.source.mappingVersion,
    })
  }
  if (!parsed.narrative?.entryNodeKey || !Array.isArray(parsed.narrative.nodes)
    || !Array.isArray(parsed.narrative.beats) || !Array.isArray(parsed.narrative.choices)) {
    throw new Error('[game-release] GameRelease 内容无效')
  }
  if (parsed.productType === 'storygame'
    && parsed.definition.enabledCapabilities.join(',') !== 'narrative') {
    throw new Error('[storygame] GameRelease 定义无效')
  }
  if (parsed.productType === 'character-interaction'
    && (!parsed.definition.enabledCapabilities.includes('interaction')
      || !Array.isArray(parsed.interaction?.profiles)
      || !Array.isArray(parsed.interaction?.sceneTemplates))) {
    throw new Error('[chatgame] GameRelease 互动内容无效')
  }
  if (parsed.productType === 'text-adventure') {
    if (parsed.definition.enabledCapabilities.join(',') !== 'narrative,interaction,adventure') {
      throw new Error('[adventure] GameRelease 定义无效')
    }
    const adventure = parseAdventureContent(parsed.adventure)
    if (!Array.isArray(parsed.interaction?.profiles) || !Array.isArray(parsed.interaction?.sceneTemplates)) {
      throw new Error('[adventure] GameRelease 缺少角色互动内容')
    }
    const profiles = new Set(parsed.interaction.profiles.map(item => item.participantKey))
    for (const action of adventure.actions.filter(item => item.kind === 'talk')) {
      const binding = action.interaction
      const scene = parsed.interaction.sceneTemplates.find(item => item.sceneKey === binding?.sceneKey)
      if (!binding || !profiles.has(binding.participantKey) || !scene?.participantKeys.includes(binding.participantKey)
        || !scene.relationshipRules.some(item => item.ruleKey === binding.ruleKey
          && item.fromParticipantKey === binding.participantKey)) {
        throw new Error(`[adventure] GameRelease talk 互动绑定无效:${action.key}`)
      }
    }
    const actions = new Map(adventure.actions.map(action => [action.key, action]))
    const choices = new Map(parsed.narrative.choices.map(choice => [choice.choiceKey, choice]))
    for (const choice of parsed.narrative.choices) {
      const bindings = choice.tags.filter(tag => tag.startsWith('adventure-action:'))
      if (bindings.length > 1) throw new Error(`[adventure] Choice 只能绑定一个公共行动:${choice.choiceKey}`)
      if (bindings.length === 1) {
        const actionKey = bindings[0].slice('adventure-action:'.length)
        if (actions.get(actionKey)?.narrativeChoiceKey !== choice.choiceKey) {
          throw new Error(`[adventure] Choice 公共行动绑定无效:${choice.choiceKey}->${actionKey}`)
        }
      }
    }
    for (const action of adventure.actions.filter(item => item.narrativeChoiceKey != null)) {
      const choice = choices.get(action.narrativeChoiceKey!)
      if (!choice?.tags.includes(`adventure-action:${action.key}`)) {
        throw new Error(`[adventure] 公共行动缺少 Choice 反向绑定:${action.key}`)
      }
    }
  }
  if (parsed.productType === 'avg') {
    if (parsed.definition.enabledCapabilities.join(',') !== 'narrative,presentation') throw new Error('[avg] GameRelease 定义无效')
    if (!Array.isArray(parsed.presentation?.assets)) throw new Error('[avg] GameRelease 缺少媒资清单')
    const content = parseAvgPresentationContent(parsed.presentation)
    const assets = parsed.presentation.assets.map(asset => freezeAvgMediaAsset(asset as unknown as AvgMediaAsset))
    if (new Set(assets.map(asset => asset.assetKey)).size !== assets.length) throw new Error('[avg] GameRelease 媒资 key 重复')
    const report = validateAvgPresentation({ content, beats: parsed.narrative.beats, assets })
    if (!report.valid) throw new Error(`[avg] GameRelease 演出无效:${report.errors.join('；')}`)
  }
  if (parsed.productType === 'narrative-simulation') {
    if (parsed.definition.enabledCapabilities.join(',') !== 'narrative,simulation') {
      throw new Error('[textsim] GameRelease 定义无效')
    }
    const simulation = parseNarrativeSimulationContent(parsed.simulation)
    const report = validateNarrativeSimulationContent({
      content: simulation,
      narrativeNodeKeys: parsed.narrative.nodes.map(node => node.key),
    })
    if (!report.valid) throw new Error(`[textsim] GameRelease 模拟内容无效:${report.errors.join('；')}`)
  }
  if (parsed.productType === 'text-open-world') {
    if (parsed.definition.enabledCapabilities.join(',') !== 'narrative,interaction,adventure,simulation,open-world') {
      throw new Error('[textworld] GameRelease 定义无效')
    }
    if (!Array.isArray(parsed.interaction?.profiles) || !Array.isArray(parsed.interaction?.sceneTemplates)) {
      throw new Error('[textworld] GameRelease 缺少角色互动内容')
    }
    const adventure = parseAdventureContent(parsed.adventure)
    const simulation = parseNarrativeSimulationContent(parsed.simulation)
    const simulationReport = validateNarrativeSimulationContent({
      content: simulation,
      narrativeNodeKeys: parsed.narrative.nodes.map(node => node.key),
    })
    if (!simulationReport.valid) throw new Error(`[textworld] GameRelease 模拟内容无效:${simulationReport.errors.join('；')}`)
    const openWorld = parseOpenWorldContent(parsed.openWorld)
    const report = validateOpenWorldContent({
      content: openWorld,
      adventure,
      interactionProfiles: parsed.interaction.profiles,
      interactionScenes: parsed.interaction.sceneTemplates,
      simulation,
      narrativeNodeKeys: parsed.narrative.nodes.map(node => node.key),
    })
    if (!report.valid) throw new Error(`[textworld] GameRelease 开放世界内容无效:${report.errors.join('；')}`)
  }
  return structuredClone(parsed)
}

export function parseInteractionGameReleaseManifest(value: string) {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'character-interaction') throw new Error('[chatgame] 不是角色互动 GameRelease')
  return parsed
}

export function parseAdventureGameReleaseManifest(value: string) {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'text-adventure') throw new Error('[adventure] 不是文字冒险 GameRelease')
  return parsed
}

export function parseAvgGameReleaseManifest(value: string): AvgGameReleaseManifestV1 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'avg') throw new Error('[avg] 不是 AVG GameRelease')
  return parsed
}

export function parseNarrativeSimulationGameReleaseManifest(value: string): NarrativeSimulationGameReleaseManifestV1 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'narrative-simulation') throw new Error('[textsim] 不是叙事模拟 GameRelease')
  return parsed
}

export function parseTextOpenWorldGameReleaseManifest(value: string): TextOpenWorldGameReleaseManifestV1 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'text-open-world') throw new Error('[textworld] 不是文字开放世界 GameRelease')
  return parsed
}
