import { db } from '../db/schema'
import { createNarrativeModule, addNarrativeNode } from '../narrative/blueprint'
import type {
  AdventureActionDefinition,
  AdventureContentV1,
  AvgMediaKind,
  AvgPresentationContentV1,
  AvgPresentationCue,
  GameDefinition,
  NarrativeBeatKind,
  NarrativeContentGraphReport,
  NarrativeModuleKind,
  NarrativeNodeKind,
  WorkspaceScope,
  WorldRelease,
  WorldReleaseManifestV2,
  WorldGameSourceSelectionV1,
} from '../types'
import { AVG_MEDIA_KINDS } from '../types'
import { createAdventureGame, validateAdventureGameDraft } from '../adventure/authoring'
import { createAvgGameFromNarrative, importAvgMediaAsset, validateAvgGame } from '../avg/authoring'
import { assertReleaseUnchanged } from '../world-engine/releases'
import { resolveScope, scopeTransactionTables } from '../world-engine/scope'
import {
  addNarrativeBeat,
  addNarrativeChoice,
  createGameDefinition,
  validateStoryGameContent,
} from './content'

export const WORLD_GAME_MAPPING_VERSION = 1

export interface WorldGameSourceCatalog {
  release: WorldRelease
  manifest: WorldReleaseManifestV2
  narrativeModules: WorldReleaseManifestV2['selectedNarrativeModules']
  characters: Array<{ exportId: number; name: string; description: string }>
  relationships: Array<{
    exportId: number
    fromCharacterExportId: number
    toCharacterExportId: number
    relationType: string
    label: string
    description: string
    isBidirectional: boolean
  }>
  locations: Array<{ exportId: number; name: string; description: string }>
  artifacts: Array<{ exportId: number; name: string; description: string }>
  loreEntries: Array<{ exportId: number; name: string; description: string }>
  storyArcs: Array<{ exportId: number; name: string; description: string; type: string }>
  mediaAssets: PortableWorldMediaAsset[]
}

export interface PortableWorldMediaAsset {
  exportId: number
  assetKey: string
  version: number
  kind: AvgMediaKind
  name: string
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  durationMs: number | null
  contentHash: string
  source: string
  license: string
  altText: string
  characterTag: string
  sceneTag: string
  dataUrl: string
}

export interface PortableStoryNode {
  key: string
  kind: NarrativeNodeKind
  title: string
  summary: string
  conditionJson: string
  effectsJson: string
  successorKeys: string[]
  order: number
}

export interface PortableStoryBeat {
  beatKey: string
  nodeKey: string
  kind: NarrativeBeatKind
  speakerCharacterExportId: number | null
  text: string
  order: number
}

export interface PortableStoryChoice {
  sourceNodeKey: string
  choiceKey: string
  text: string
  description: string
  unavailableReason: string
  targetNodeKey: string
  displayConditionJson: string
  availableConditionJson: string
  effectsJson: string
  tagsJson: string
  order: number
}

export interface PortableStoryGameDraftV1 {
  source: WorldGameSourceSelectionV1
  title: string
  description: string
  moduleKind: NarrativeModuleKind
  entryNodeKey: string
  nodes: PortableStoryNode[]
  beats: PortableStoryBeat[]
  choices: PortableStoryChoice[]
}

export interface GeneratedStoryGame {
  definition: GameDefinition
  report: NarrativeContentGraphReport
  source: WorldGameSourceSelectionV1
  warnings: string[]
}

export interface GeneratedAdventureGame {
  definition: GameDefinition
  source: WorldGameSourceSelectionV1
  warnings: string[]
}

export interface GeneratedAvgGame {
  definition: GameDefinition
  source: WorldGameSourceSelectionV1
  warnings: string[]
}

export type GeneratedAuthoredWorldGame = GeneratedStoryGame | GeneratedAdventureGame | GeneratedAvgGame

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[world-game] ${label} 无效`)
  return value as Record<string, unknown>
}

function rows(manifest: WorldReleaseManifestV2, table: string): Array<Record<string, unknown>> {
  const value = manifest.records[table] ?? []
  if (!Array.isArray(value)) throw new Error(`[world-game] ${table} 不是记录数组`)
  return value.map((item, index) => record(item, `${table}[${index}]`))
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`[world-game] ${label} 不能为空`)
  return value.trim()
}

function jsonString(value: unknown, fallback: string, label: string): string {
  const text = typeof value === 'string' && value.trim() ? value : fallback
  try { JSON.parse(text) } catch { throw new Error(`[world-game] ${label} 不是合法 JSON`) }
  return text
}

function exportIdOf(row: Record<string, unknown>, fallbackIndex: number, label: string): number {
  const value = row._exportId ?? fallbackIndex
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`[world-game] ${label} 缺少便携 exportId`)
  return Number(value)
}

function sorted<T extends { order: number }>(value: T[]): T[] {
  return value.sort((left, right) => left.order - right.order)
}

function parseStringArray(value: unknown, label: string): string[] {
  const parsed = JSON.parse(jsonString(value, '[]', label)) as unknown
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`[world-game] ${label} 必须是字符串数组`)
  }
  return parsed.map(item => String(item).trim())
}

function parseManifest(value: string): WorldReleaseManifestV2 {
  const manifest = JSON.parse(value) as WorldReleaseManifestV2
  if (manifest.schema !== 'storyforge.world-package' || manifest.version !== 2 || !manifest.records) {
    throw new Error('[world-game] 只能消费 WorldReleaseManifestV2')
  }
  return manifest
}

function categoryArtifacts(manifest: WorldReleaseManifestV2): Set<number> {
  return new Set(rows(manifest, 'codexCategories').flatMap((row, index) => (
    row.builtInKey === 'artifact' ? [exportIdOf(row, index, 'codexCategories')] : []
  )))
}

function catalogRows(
  sourceRows: Array<Record<string, unknown>>,
  nameField: string,
  descriptionFields: string[],
): Array<{ exportId: number; name: string; description: string }> {
  return sourceRows.flatMap((row, index) => {
    const name = typeof row[nameField] === 'string' ? String(row[nameField]).trim() : ''
    if (!name) return []
    const description = descriptionFields
      .map(field => typeof row[field] === 'string' ? String(row[field]).trim() : '')
      .find(Boolean) ?? ''
    return [{ exportId: exportIdOf(row, index, nameField), name, description }]
  })
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value == null) return null
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`[world-game] ${label} 无效`)
  return Number(value)
}

function mediaCatalog(manifest: WorldReleaseManifestV2): PortableWorldMediaAsset[] {
  const blobByAsset = new Map<number, Record<string, unknown>>()
  for (const row of rows(manifest, 'avgMediaBlobs')) {
    if (Number.isInteger(row._mediaAssetExportId)) blobByAsset.set(Number(row._mediaAssetExportId), row)
  }
  const latest = new Map<string, PortableWorldMediaAsset>()
  for (const [index, row] of rows(manifest, 'avgMediaAssets').entries()) {
    const exportId = exportIdOf(row, index, 'avgMediaAssets')
    const blob = blobByAsset.get(exportId)
    const assetKey = nonEmpty(row.assetKey, 'AVG assetKey')
    const version = Number(row.version)
    if (!Number.isInteger(version) || version < 1) throw new Error(`[world-game] AVG 媒资版本无效:${assetKey}`)
    const kind = row.kind as AvgMediaKind
    if (!AVG_MEDIA_KINDS.includes(kind)) throw new Error(`[world-game] AVG 媒资类型无效:${assetKey}`)
    const byteSize = Number(row.byteSize)
    if (!Number.isInteger(byteSize) || byteSize < 0) throw new Error(`[world-game] AVG 媒资大小无效:${assetKey}`)
    const contentHash = nonEmpty(row.contentHash, `AVG contentHash:${assetKey}`)
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error(`[world-game] AVG contentHash 无效:${assetKey}`)
    const dataUrl = typeof blob?.data === 'string' ? blob.data : ''
    if (!/^data:[^;,]*;base64,[A-Za-z0-9+/=]*$/.test(dataUrl)) {
      throw new Error(`[world-game] AVG 媒资二进制未冻结:${assetKey}@${version}`)
    }
    const candidate: PortableWorldMediaAsset = {
      exportId,
      assetKey,
      version,
      kind,
      name: nonEmpty(row.name, `AVG 媒资名称:${assetKey}`),
      mimeType: nonEmpty(row.mimeType, `AVG mimeType:${assetKey}`).toLowerCase(),
      byteSize,
      width: nullableInteger(row.width, `AVG width:${assetKey}`),
      height: nullableInteger(row.height, `AVG height:${assetKey}`),
      durationMs: nullableInteger(row.durationMs, `AVG durationMs:${assetKey}`),
      contentHash,
      source: typeof row.source === 'string' ? row.source.trim() : '',
      license: typeof row.license === 'string' ? row.license.trim() : '',
      altText: typeof row.altText === 'string' ? row.altText.trim() : '',
      characterTag: typeof row.characterTag === 'string' ? row.characterTag.trim() : '',
      sceneTag: typeof row.sceneTag === 'string' ? row.sceneTag.trim() : '',
      dataUrl,
    }
    const previous = latest.get(assetKey)
    if (!previous || candidate.version > previous.version) latest.set(assetKey, candidate)
  }
  return [...latest.values()].sort((left, right) => left.assetKey.localeCompare(right.assetKey))
}

export async function loadWorldGameSourceCatalog(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<WorldGameSourceCatalog> {
  const scope = await resolveScope({ scope: input.scope })
  const release = await db.worldReleases.get(input.worldReleaseId)
  if (!release || release.projectId !== scope.projectId || release.worldId !== scope.worldId) {
    throw new Error('[world-game] WorldRelease 不属于当前 World')
  }
  await assertReleaseUnchanged(release.id!)
  const manifest = parseManifest(release.manifestJson)
  const artifactCategories = categoryArtifacts(manifest)
  const codexRows = rows(manifest, 'codexEntries')
  const storyArcRows = rows(manifest, 'storyArcs')
  return {
    release,
    manifest,
    narrativeModules: manifest.selectedNarrativeModules,
    characters: catalogRows(rows(manifest, 'characters'), 'name', ['shortDescription', 'background']),
    relationships: rows(manifest, 'characterRelations').flatMap((row, index) => {
      const fromCharacterExportId = Number(row._fromCharacterIndex)
      const toCharacterExportId = Number(row._toCharacterIndex)
      if (!Number.isInteger(fromCharacterExportId) || !Number.isInteger(toCharacterExportId)) return []
      return [{
        exportId: exportIdOf(row, index, 'characterRelations'),
        fromCharacterExportId,
        toCharacterExportId,
        relationType: typeof row.relationType === 'string' ? row.relationType : 'other',
        label: typeof row.label === 'string' ? row.label.trim() : '',
        description: typeof row.description === 'string' ? row.description.trim() : '',
        isBidirectional: row.isBidirectional === true,
      }]
    }),
    locations: catalogRows(rows(manifest, 'importantLocations'), 'name', ['description', 'significance']),
    artifacts: catalogRows(codexRows.filter(row => artifactCategories.has(Number(row._categoryExportId))), 'name', ['summary', 'description']),
    loreEntries: catalogRows(codexRows.filter(row => !artifactCategories.has(Number(row._categoryExportId))), 'name', ['summary', 'description']),
    storyArcs: catalogRows(storyArcRows, 'name', ['description']).map(item => ({
      ...item,
      type: String(storyArcRows.find((row, index) => exportIdOf(row, index, 'storyArcs') === item.exportId)?.type ?? ''),
    })),
    mediaAssets: mediaCatalog(manifest),
  }
}

export function buildStoryGameDraftFromWorldRelease(input: {
  manifest: WorldReleaseManifestV2
  worldContentHash: string
  narrativeModuleExportId: number
  storyArcExportIds?: number[]
}): PortableStoryGameDraftV1 {
  const selected = input.manifest.selectedNarrativeModules.find(item => item.exportId === input.narrativeModuleExportId)
  if (!selected) throw new Error('[world-game] 选择的 NarrativeModule 不在该 WorldRelease 中')
  const moduleRow = rows(input.manifest, 'narrativeModules').find(row => row._exportId === selected.exportId)
  if (!moduleRow || moduleRow.kind !== selected.kind || moduleRow.title !== selected.title) {
    throw new Error('[world-game] NarrativeModule 便携身份不一致')
  }
  const nodeRows = rows(input.manifest, 'narrativeNodes')
    .filter(row => row._moduleExportId === selected.exportId)
  const nodes = sorted(nodeRows.map(row => ({
    key: nonEmpty(row.key, '节点 key'),
    kind: row.kind as NarrativeNodeKind,
    title: nonEmpty(row.title, '节点标题'),
    summary: typeof row.summary === 'string' ? row.summary.trim() : '',
    conditionJson: jsonString(row.conditionJson, '{}', `${String(row.key)}.conditionJson`),
    effectsJson: jsonString(row.effectsJson, '[]', `${String(row.key)}.effectsJson`),
    successorKeys: parseStringArray(row.successorKeysJson, `${String(row.key)}.successorKeysJson`),
    order: Number(row.order ?? 0),
  })))
  if (!nodes.length) throw new Error('[world-game] 冻结叙事没有节点')
  const nodeKeys = new Set(nodes.map(node => node.key))
  const entryNodeKey = typeof moduleRow.entryNodeKey === 'string' && nodeKeys.has(moduleRow.entryNodeKey)
    ? moduleRow.entryNodeKey
    : nodes.find(node => node.kind === 'entry')?.key ?? ''
  if (!entryNodeKey) throw new Error('[world-game] 冻结叙事没有入口')

  const beats = sorted(rows(input.manifest, 'narrativeBeats')
    .filter(row => row._moduleExportId === selected.exportId)
    .map(row => ({
      beatKey: nonEmpty(row.beatKey, 'Beat key'),
      nodeKey: nonEmpty(row.nodeKey, 'Beat nodeKey'),
      kind: row.kind as NarrativeBeatKind,
      speakerCharacterExportId: row._speakerCharacterExportId == null ? null : Number(row._speakerCharacterExportId),
      text: nonEmpty(row.text, 'Beat 文本'),
      order: Number(row.order ?? 0),
    })))
  for (const node of nodes) {
    if (!beats.some(beat => beat.nodeKey === node.key)) {
      beats.push({
        beatKey: `${node.key}.world-summary`,
        nodeKey: node.key,
        kind: node.kind === 'entry' ? 'system' : 'narration',
        speakerCharacterExportId: null,
        text: node.summary || node.title,
        order: 0,
      })
    }
  }

  const choices = sorted(rows(input.manifest, 'narrativeChoices')
    .filter(row => row._moduleExportId === selected.exportId)
    .map(row => ({
      sourceNodeKey: nonEmpty(row.sourceNodeKey, 'Choice sourceNodeKey'),
      choiceKey: nonEmpty(row.choiceKey, 'Choice key'),
      text: nonEmpty(row.text, 'Choice 文本'),
      description: typeof row.description === 'string' ? row.description.trim() : '',
      unavailableReason: typeof row.unavailableReason === 'string' ? row.unavailableReason.trim() : '',
      targetNodeKey: nonEmpty(row.targetNodeKey, 'Choice targetNodeKey'),
      displayConditionJson: jsonString(row.displayConditionJson, '{}', `${String(row.choiceKey)}.displayConditionJson`),
      availableConditionJson: jsonString(row.availableConditionJson, '{}', `${String(row.choiceKey)}.availableConditionJson`),
      effectsJson: jsonString(row.effectsJson, '[]', `${String(row.choiceKey)}.effectsJson`),
      tagsJson: jsonString(row.tagsJson, '[]', `${String(row.choiceKey)}.tagsJson`),
      order: Number(row.order ?? 0),
    })))
  for (const node of nodes.filter(item => item.kind !== 'ending')) {
    if (choices.some(choice => choice.sourceNodeKey === node.key)) continue
    for (const [index, targetNodeKey] of node.successorKeys.entries()) {
      const target = nodes.find(item => item.key === targetNodeKey)
      if (!target) continue
      choices.push({
        sourceNodeKey: node.key,
        choiceKey: `${node.key}.to.${targetNodeKey}`,
        text: `前往${target.title}`,
        description: target.summary,
        unavailableReason: '',
        targetNodeKey,
        displayConditionJson: '{}',
        availableConditionJson: '{}',
        effectsJson: '[]',
        tagsJson: '["world-release-projection"]',
        order: index,
      })
    }
  }
  const speakerIds = [...new Set(beats.flatMap(beat => beat.speakerCharacterExportId == null ? [] : [beat.speakerCharacterExportId]))]
  const availableStoryArcs = catalogRows(rows(input.manifest, 'storyArcs'), 'name', ['description'])
  const defaultStoryArcIds = rows(input.manifest, 'storyArcs').flatMap((row, index) => (
    row.type === 'main' ? [exportIdOf(row, index, 'storyArcs')] : []
  ))
  const selectedStoryArcs = selectedCatalogRows(
    availableStoryArcs,
    input.storyArcExportIds === undefined ? defaultStoryArcIds : input.storyArcExportIds,
    '故事线',
  )
  const source: WorldGameSourceSelectionV1 = {
    schema: 'storyforge.world-game-source',
    version: 1,
    productType: 'storygame',
    worldContentHash: input.worldContentHash,
    narrativeModuleExportId: selected.exportId,
    characterExportIds: speakerIds.sort((left, right) => left - right),
    characterRelationExportIds: [],
    importantLocationExportIds: [],
    artifactExportIds: [],
    codexEntryExportIds: [],
    storyArcExportIds: selectedStoryArcs.map(item => item.exportId),
    avgMediaAssetExportIds: [],
  }
  return {
    source,
    title: selected.title,
    description: typeof moduleRow.description === 'string' ? moduleRow.description.trim() : '',
    moduleKind: selected.kind,
    entryNodeKey,
    nodes,
    beats: sorted(beats),
    choices: sorted(choices),
  }
}

function defaultStoryGameKey(contentHash: string, moduleExportId: number): string {
  return `world-story-${contentHash.slice(0, 10)}-${moduleExportId}`
}

function selectedCatalogRows<T extends { exportId: number }>(
  available: T[],
  selected: number[] | undefined,
  label: string,
): T[] {
  const ids = selected == null ? available.map(item => item.exportId) : [...new Set(selected)]
  const byId = new Map(available.map(item => [item.exportId, item]))
  const missing = ids.filter(id => !byId.has(id))
  if (missing.length) throw new Error(`[world-game] ${label}便携引用不存在:${missing.join(',')}`)
  const selectedIds = new Set(ids)
  return available.filter(item => selectedIds.has(item.exportId))
}

function adventureSceneLocationIndex(
  node: PortableStoryNode,
  locations: Array<{ title: string }>,
  fallbackIndex: number,
): number {
  const scene = `${node.key} ${node.title}`.toLowerCase()
  const rules: Array<{ scene: RegExp; location: RegExp }> = [
    { scene: /archive|vault|档案|库房/, location: /档案|archive/ },
    { scene: /market|patrol|集市|巡潮/, location: /集市|market/ },
    { scene: /north|father|council|北塔|父亲|议会/, location: /北塔|灯室|lighthouse/ },
    { scene: /outbound|dock|离港|码头|航行/, location: /码头|港口|dock|harbor/ },
    { scene: /bell|public|sealed|undercity|pump|shrine|钟|潮心|神龛/, location: /钟楼|bell|tower/ },
    { scene: /entry|开场|失潮/, location: /码头|港口|dock|harbor/ },
  ]
  for (const rule of rules) {
    if (!rule.scene.test(scene)) continue
    const match = locations.findIndex(location => rule.location.test(location.title.toLowerCase()))
    if (match >= 0) return match
  }
  return fallbackIndex % locations.length
}

function adventureStoryExcerpt(
  story: PortableStoryGameDraftV1,
  catalog: WorldGameSourceCatalog,
  nodeKey: string,
  limit = 6,
): string {
  const characterById = new Map(catalog.characters.map(item => [item.exportId, item.name]))
  return story.beats
    .filter(beat => beat.nodeKey === nodeKey)
    .slice(0, limit)
    .map(beat => {
      const speaker = beat.speakerCharacterExportId == null ? '' : characterById.get(beat.speakerCharacterExportId)
      return speaker ? `${speaker}：“${beat.text}”` : beat.text
    })
    .join(' ')
}

export function buildAdventureContent(input: {
  catalog: WorldGameSourceCatalog
  narrativeModuleExportId: number
  storyDraft?: PortableStoryGameDraftV1
  storyArcExportIds?: number[]
  locationExportIds?: number[]
  artifactExportIds?: number[]
  codexEntryExportIds?: number[]
  characterExportIds?: number[]
}): { content: AdventureContentV1; source: WorldGameSourceSelectionV1; participants: Array<{ exportId: number; participantKey: string; relationSummary: string }> } {
  const narrative = input.catalog.narrativeModules.find(item => item.exportId === input.narrativeModuleExportId)
  if (!narrative) throw new Error('[world-game] 文字冒险来源叙事不在该 WorldRelease 中')
  const story = input.storyDraft ?? buildStoryGameDraftFromWorldRelease({
    manifest: input.catalog.manifest,
    worldContentHash: input.catalog.release.contentHash,
    narrativeModuleExportId: input.narrativeModuleExportId,
    storyArcExportIds: input.storyArcExportIds,
  })
  const selectedLocations = selectedCatalogRows(input.catalog.locations, input.locationExportIds, '地点')
  const selectedArtifacts = selectedCatalogRows(input.catalog.artifacts, input.artifactExportIds, '道具')
  const selectedLore = selectedCatalogRows(input.catalog.loreEntries, input.codexEntryExportIds, '世界词条')
  const requestedCharacters = selectedCatalogRows(input.catalog.characters, input.characterExportIds, '角色')
  const requiredCharacterIds = new Set([
    ...story.source.characterExportIds,
    ...requestedCharacters.map(item => item.exportId),
  ])
  const selectedCharacters = input.catalog.characters.filter(item => requiredCharacterIds.has(item.exportId))
  const selectedRelations = input.catalog.relationships.filter(item => (
    requiredCharacterIds.has(item.fromCharacterExportId) && requiredCharacterIds.has(item.toCharacterExportId)
  ))
  if (selectedLocations.length < 2) throw new Error('[world-game] 文字冒险至少需要两个冻结世界地点')
  if (!selectedArtifacts.length) throw new Error('[world-game] 文字冒险至少需要一个 codex artifact 道具')

  const locations = selectedLocations.map(item => ({
    key: `location-${item.exportId}`,
    title: item.name,
    description: item.description || `${item.name}是本次冒险的重要地点。`,
    tags: ['world-release'],
  }))
  const storySceneNodes = story.nodes.filter(item => item.kind !== 'ending')
  const sceneAssignments = new Map(storySceneNodes.map((node, index) => [
    node.key,
    adventureSceneLocationIndex(node, locations, index),
  ]))
  const objects = selectedLocations.map(item => ({
    key: `landmark-${item.exportId}`,
    locationKey: `location-${item.exportId}`,
    title: `${item.name}线索`,
    description: item.description || `观察${item.name}可以推进调查。`,
    tags: ['world-release', 'clue'],
  })).concat(selectedLore.map((item, index) => ({
    key: `lore-${item.exportId}`,
    locationKey: `location-${selectedLocations[index % selectedLocations.length].exportId}`,
    title: item.name,
    description: item.description || `${item.name}是冻结世界词条中记录的知识。`,
    tags: ['world-release', 'lore'],
  }))).concat(storySceneNodes.filter(item => item.kind !== 'entry').map(node => ({
    key: `story-${node.key}`,
    locationKey: locations[sceneAssignments.get(node.key) ?? 0].key,
    title: `剧情线索 · ${node.title}`,
    description: node.summary || `调查这里与“${node.title}”有关的现场。`,
    tags: ['world-release', 'story-scene'],
  })))
  const items = selectedArtifacts.map(item => ({
    key: `artifact-${item.exportId}`,
    title: item.name,
    description: item.description || `${item.name}来自冻结世界词条。`,
    tags: ['world-release', 'artifact'],
    stackable: false,
    consumable: false,
  }))
  const actions: AdventureActionDefinition[] = []
  for (const [index, location] of locations.entries()) {
    actions.push({
      key: `look.${location.key}`,
      kind: 'look',
      label: `观察${location.title}`,
      description: location.description,
      locationKey: location.key,
      targetKey: `landmark-${selectedLocations[index].exportId}`,
      requirements: [],
      rule: { kind: 'automatic' },
      successEffects: index === 0 ? [{ op: 'accept-quest', questKey: 'main.bell' }] : [],
      costlySuccessEffects: [],
      failureEffects: [],
      successText: index === 0 ? `你从${location.title}开始追查“${narrative.title}”。` : `你记下了${location.title}的线索。`,
      costlySuccessText: `你费力辨认出${location.title}的线索。`,
      failureText: '当前没有发现新的线索。',
      unavailableText: '当前无法观察。',
      repeatable: index !== 0,
      narrativeChoiceKey: null,
    })
    const next = locations[index + 1]
    if (next) {
      actions.push({
        key: `move.${location.key}.${next.key}`,
        kind: 'move', label: `前往${next.title}`, description: `从${location.title}前往${next.title}。`,
        locationKey: location.key, targetKey: next.key, requirements: [], rule: { kind: 'automatic' },
        successEffects: [{ op: 'enter-location', locationKey: next.key }], costlySuccessEffects: [], failureEffects: [],
        successText: `你抵达${next.title}。`, costlySuccessText: `你付出代价后抵达${next.title}。`, failureText: '道路暂时无法通过。', unavailableText: '当前不能移动。', repeatable: true, narrativeChoiceKey: null,
      })
      actions.push({
        key: `move.${next.key}.${location.key}`,
        kind: 'move', label: `返回${location.title}`, description: `从${next.title}返回${location.title}。`,
        locationKey: next.key, targetKey: location.key, requirements: [], rule: { kind: 'automatic' },
        successEffects: [{ op: 'enter-location', locationKey: location.key }], costlySuccessEffects: [], failureEffects: [],
        successText: `你返回${location.title}。`, costlySuccessText: `你付出代价后返回${location.title}。`, failureText: '道路暂时无法通过。', unavailableText: '当前不能移动。', repeatable: true, narrativeChoiceKey: null,
      })
    }
  }
  for (const [index, item] of items.entries()) {
    const location = locations[(index + 1) % locations.length]
    actions.push({
      key: `take.${item.key}`,
      kind: 'take', label: `取得${item.title}`, description: item.description,
      locationKey: location.key, targetKey: item.key,
      requirements: [{ questKey: 'main.bell', questStatus: 'active' }], rule: { kind: 'automatic' },
      successEffects: [
        { op: 'gain-item', itemKey: item.key, quantity: 1, claimKey: `claim.${item.key}` },
        { op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'find-evidence' },
      ],
      costlySuccessEffects: [], failureEffects: [], successText: `你取得了${item.title}。`, costlySuccessText: `你付出代价取得了${item.title}。`, failureText: `${item.title}暂时无法取得。`, unavailableText: '先开始主线调查，或该道具已经取得。', repeatable: false, narrativeChoiceKey: null,
    })
  }
  for (const [index, lore] of selectedLore.entries()) {
    const location = locations[index % locations.length]
    actions.push({
      key: `inspect.lore-${lore.exportId}`,
      kind: 'inspect', label: `查阅${lore.name}`, description: lore.description || `了解${lore.name}。`,
      locationKey: location.key, targetKey: `lore-${lore.exportId}`,
      requirements: [], rule: { kind: 'automatic' }, successEffects: [], costlySuccessEffects: [], failureEffects: [],
      successText: lore.description || `你了解了${lore.name}。`, costlySuccessText: `你费力还原了${lore.name}的记录。`,
      failureText: '记录暂时无法辨认。', unavailableText: '当前无法查阅。', repeatable: true, narrativeChoiceKey: null,
    })
  }
  for (const node of storySceneNodes.filter(item => item.kind !== 'entry')) {
    const location = locations[sceneAssignments.get(node.key) ?? 0]
    const actionKey = `investigate.story-${node.key}`
    const excerpt = adventureStoryExcerpt(story, input.catalog, node.key)
    actions.push({
      key: actionKey,
      kind: 'inspect',
      label: `深入调查：${node.title}`,
      description: node.summary || `还原“${node.title}”的现场与人物证言。`,
      locationKey: location.key,
      targetKey: `story-${node.key}`,
      requirements: [{ questKey: 'main.bell', questStatus: 'active' }],
      rule: { kind: 'automatic' },
      successEffects: [],
      costlySuccessEffects: [],
      failureEffects: [],
      successText: excerpt || node.summary || `你还原了“${node.title}”的关键经过。`,
      costlySuccessText: `你付出时间与体力，终于还原“${node.title}”的关键经过。${excerpt ? ` ${excerpt}` : ''}`,
      failureText: `现场仍缺少能够解释“${node.title}”的证据。`,
      unavailableText: '先从起点接受失潮调查。',
      repeatable: false,
      narrativeChoiceKey: null,
    })
  }
  const participants = selectedCharacters.map(item => {
    const relationships = selectedRelations.filter(relation => relation.fromCharacterExportId === item.exportId
      || relation.toCharacterExportId === item.exportId)
    const relationSummary = relationships.map(relation => {
      const otherId = relation.fromCharacterExportId === item.exportId
        ? relation.toCharacterExportId
        : relation.fromCharacterExportId
      const other = selectedCharacters.find(character => character.exportId === otherId)
      return `${other?.name ?? `角色 ${otherId}`}：${relation.label || relation.relationType}${relation.description ? `（${relation.description}）` : ''}`
    }).join('；')
    return { exportId: item.exportId, participantKey: `character-${item.exportId}`, relationSummary }
  })
  for (const [index, participant] of participants.entries()) {
    const character = selectedCharacters[index]
    const location = locations[index % locations.length]
    actions.push({
      key: `talk.${participant.participantKey}`,
      kind: 'talk', label: `询问${character.name}`,
      description: [character.description || `向${character.name}询问世界线索。`, participant.relationSummary]
        .filter(Boolean).join(' 关系：'),
      locationKey: location.key, targetKey: `character:${participant.participantKey}`,
      requirements: [], rule: { kind: 'automatic' }, successEffects: [], costlySuccessEffects: [], failureEffects: [],
      successText: `${character.name}提供了与“${narrative.title}”有关的证言。${participant.relationSummary ? ` 你也确认了关系：${participant.relationSummary}` : ''}`,
      costlySuccessText: `${character.name}在迟疑后给出证言。`, failureText: `${character.name}暂时不愿回答。`, unavailableText: '当前无法交谈。', repeatable: true, narrativeChoiceKey: null,
      interaction: { participantKey: participant.participantKey, sceneKey: `scene.${participant.participantKey}`, ruleKey: `rule.${participant.participantKey}.testimony` },
    })
  }
  const finalLocation = locations.find(item => /钟楼|bell|tower/i.test(item.title)) ?? locations[locations.length - 1]
  const evidence = items[0]
  const finalRequirement = [{ questKey: 'main.bell', questStatus: 'active' as const }, { itemKey: evidence.key, itemQuantity: 1 }]
  const endingNodes = story.nodes.filter(item => item.kind === 'ending')
  const endingExcerpt = (preferredKey: string, fallbackIndex: number) => {
    const node = endingNodes.find(item => item.key === preferredKey) ?? endingNodes[fallbackIndex] ?? endingNodes[0]
    return node ? adventureStoryExcerpt(story, input.catalog, node.key, 8) || node.summary : `你完成了“${narrative.title}”。`
  }
  actions.push(
    {
      key: 'resolve.main', kind: 'use', label: '限制共振，签下七日公开之约', description: '使用黄铜主钥匙恢复潮汐，以不可撤销的七日期限保证原始记录公开。',
      locationKey: finalLocation.key, targetKey: evidence.key, requirements: finalRequirement, rule: { kind: 'automatic' },
      successEffects: [{ op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'resolve' }], costlySuccessEffects: [], failureEffects: [],
      successText: endingExcerpt('home', 1), costlySuccessText: `你付出代价守住雾港，并把公开真相的期限写进每一盏潮灯。 ${endingExcerpt('home', 1)}`, failureText: '校准值仍在失控，钟机拒绝接受这份七日之约。', unavailableText: `需要先取得${evidence.title}并保持主线调查进行中。`, repeatable: false, narrativeChoiceKey: null,
    },
    {
      key: 'resolve.truth', kind: 'use', label: '公开全部记录，敲响真相之钟', description: '让全港同时恢复被压缩的记忆，在混乱中公开黑潮事故原始记录。',
      locationKey: finalLocation.key, targetKey: evidence.key, requirements: finalRequirement, rule: { kind: 'automatic' },
      successEffects: [{ op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'resolve' }], costlySuccessEffects: [], failureEffects: [],
      successText: endingExcerpt('truth', 0), costlySuccessText: `真相引发震荡，但巡潮队转而保护证人与疏散通道。 ${endingExcerpt('truth', 0)}`, failureText: '广播线路被钟机共振压制，原始记录没有传出钟楼。', unavailableText: `需要先取得${evidence.title}并保持主线调查进行中。`, repeatable: false, narrativeChoiceKey: null,
    },
    {
      key: 'resolve.sea', kind: 'use', label: '彻底断钟，带领船队驶向黑潮', description: '停止用城市记忆驱动钟机，点亮外海航道并追查异常潮汐的源头。',
      locationKey: finalLocation.key, targetKey: evidence.key, requirements: finalRequirement, rule: { kind: 'automatic' },
      successEffects: [{ op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'resolve' }], costlySuccessEffects: [], failureEffects: [],
      successText: endingExcerpt('sea', 2), costlySuccessText: `撤离让雾港受损，却保住了所有人的姓名与选择。 ${endingExcerpt('sea', 2)}`, failureText: '船队尚未完成集结，贸然断钟只会让黑潮吞没航道。', unavailableText: `需要先取得${evidence.title}并保持主线调查进行中。`, repeatable: false, narrativeChoiceKey: null,
    },
    {
      key: 'attempt.resolve-risky', kind: 'attempt', label: '冒险强行推进', description: '以风险判定完成主线，并可能留下被追捕的代价。',
      locationKey: finalLocation.key, targetKey: `landmark-${selectedLocations[selectedLocations.length - 1].exportId}`,
      requirements: finalRequirement, rule: { kind: 'random', abilityKey: 'reason', expression: '1d6', difficulty: 7, costlySuccessFloor: 5 },
      successEffects: [{ op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'resolve' }],
      costlySuccessEffects: [{ op: 'apply-condition', conditionKey: 'wanted', duration: 3 }, { op: 'complete-objective', questKey: 'main.bell', objectiveKey: 'resolve' }],
      failureEffects: [{ op: 'change-resource', resourceKey: 'time', delta: -1 }],
      successText: `你在钟机彻底过载前抓住了唯一的校准窗口。${endingExcerpt('truth', 0)}`, costlySuccessText: `你强行完成校准，却让巡潮队锁定了自己的位置。${endingExcerpt('truth', 0)}`, failureText: '齿轮从指间滑脱，黑潮又逼近了一层；剩余时间正在减少。', unavailableText: `需要先取得${evidence.title}。`, repeatable: false, narrativeChoiceKey: null,
    },
    {
      key: 'quest.abandon', kind: 'quest-action', label: '终止调查并组织紧急撤离', description: '承认当前证据不足以安全启动钟机，把剩余时间全部用于撤离港民。',
      locationKey: finalLocation.key, targetKey: null, requirements: [{ questKey: 'main.bell', questStatus: 'active' }], rule: { kind: 'automatic' },
      successEffects: [{ op: 'fail-quest', questKey: 'main.bell' }], costlySuccessEffects: [], failureEffects: [],
      successText: '你关闭钟楼入口，把所有仍能行动的人编入撤离队。雾港没有等来钟声，但至少没有人再因一条被删除的命令留在错误地点。', costlySuccessText: '你带着未能公开的证据离开钟楼，把每一页记录分给不同船只保管。', failureText: '人群拒绝在没有解释的情况下离开，你必须先给出一个能让他们相信的方案。', unavailableText: '主线尚未开始或已经结束。', repeatable: false, narrativeChoiceKey: null,
    },
  )
  const source: WorldGameSourceSelectionV1 = {
    schema: 'storyforge.world-game-source', version: 1, productType: 'text-adventure',
    worldContentHash: input.catalog.release.contentHash,
    narrativeModuleExportId: narrative.exportId,
    characterExportIds: selectedCharacters.map(item => item.exportId),
    characterRelationExportIds: selectedRelations.map(item => item.exportId),
    importantLocationExportIds: selectedLocations.map(item => item.exportId),
    artifactExportIds: selectedArtifacts.map(item => item.exportId),
    codexEntryExportIds: selectedLore.map(item => item.exportId),
    storyArcExportIds: story.source.storyArcExportIds,
    avgMediaAssetExportIds: [],
  }
  return {
    source,
    participants,
    content: {
      version: 1,
      initialLocationKey: locations[0].key,
      playerKey: 'player',
      locations,
      objects,
      items,
      abilities: [
        { key: 'observe', title: '观察', description: '发现环境与人物留下的线索。', initial: 2, minimum: 0, maximum: 10 },
        { key: 'reason', title: '推理', description: '根据证据判断风险与真相。', initial: 2, minimum: 0, maximum: 10 },
        { key: 'agility', title: '灵巧', description: '穿过封锁、检修机械并在涨潮前抵达目标。', initial: 2, minimum: 0, maximum: 10 },
        { key: 'empathy', title: '共情', description: '理解证言背后的恐惧、愧疚与未说出口的请求。', initial: 2, minimum: 0, maximum: 10 },
      ],
      conditions: [
        { key: 'wanted', title: '被追踪', description: '冒险行动惊动了仍在执行封锁令的人。' },
        { key: 'shaken', title: '记忆震荡', description: '钟机共振让熟悉的姓名与道路短暂变得陌生。' },
        { key: 'inspired', title: '守灯誓言', description: '你已不再独自守灯，并愿意为选择承担可见的代价。' },
      ],
      resources: [
        { key: 'stamina', title: '体力', initial: 6, minimum: 0, maximum: 10 },
        { key: 'time', title: '剩余时间', initial: 8, minimum: 0, maximum: 12 },
      ],
      quests: [{
        key: 'main.bell', title: narrative.title, description: `午夜潮汐没有到来，港民姓名开始消失。沿冻结世界中的地点、角色、道具与旧案证词追查钟机真相，并在黑潮抵达前决定雾港的未来。`, initialStatus: 'available', prerequisites: [],
        objectives: [
          { key: 'find-evidence', title: `取得${evidence.title}`, optional: false, alternativeActionKeys: items.map(item => `take.${item.key}`) },
          { key: 'resolve', title: '在钟楼选择公开真相、七日之约或驶向黑潮', optional: false, alternativeActionKeys: ['resolve.main', 'resolve.truth', 'resolve.sea', 'attempt.resolve-risky'] },
        ],
        rewardEffects: [{ op: 'change-ability', abilityKey: 'reason', delta: 1 }, { op: 'apply-condition', conditionKey: 'inspired', duration: null }],
        completionNodeKey: story.nodes.find(item => item.kind === 'ending')?.key ?? null,
        failureNodeKey: story.nodes.filter(item => item.kind === 'ending').length > 1
          ? [...story.nodes].reverse().find(item => item.kind === 'ending')?.key ?? null
          : null,
      }],
      actions,
      initialInventory: [],
    },
  }
}

function defaultAdventureGameKey(contentHash: string, moduleExportId: number): string {
  return `world-adventure-${contentHash.slice(0, 10)}-${moduleExportId}`
}

export async function generateAdventureGameFromWorldRelease(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  narrativeModuleExportId: number
  title?: string
  gameKey?: string
  storyArcExportIds?: number[]
  locationExportIds?: number[]
  artifactExportIds?: number[]
  codexEntryExportIds?: number[]
  characterExportIds?: number[]
}): Promise<GeneratedAdventureGame> {
  const scope = await resolveScope({ scope: input.scope })
  const catalog = await loadWorldGameSourceCatalog({ scope, worldReleaseId: input.worldReleaseId })
  const draft = buildAdventureContent({ catalog, ...input })
  const gameKey = input.gameKey?.trim() || defaultAdventureGameKey(catalog.release.contentHash, input.narrativeModuleExportId)
  const story = await generateStoryGameFromWorldRelease({
    scope,
    worldReleaseId: input.worldReleaseId,
    narrativeModuleExportId: input.narrativeModuleExportId,
    title: input.title?.trim() || undefined,
    storyArcExportIds: input.storyArcExportIds,
  })
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, gameKey]).first()
  if (existing) {
    if (existing.productType !== 'text-adventure' || existing.sourceWorldContentHash !== catalog.release.contentHash
      || existing.sourceSelectionJson !== JSON.stringify(draft.source)
      || existing.narrativeModuleId !== story.definition.narrativeModuleId) throw new Error(`[world-game] gameKey 已被其它来源占用:${gameKey}`)
    return { definition: existing, source: draft.source, warnings: [] }
  }
  const definition = await createAdventureGame({
    scope,
    title: input.title?.trim() || `${catalog.manifest.worldName} · ${catalog.narrativeModules.find(item => item.exportId === input.narrativeModuleExportId)?.title ?? '文字冒险'}`,
    gameKey,
    content: draft.content,
    interactionCharacters: draft.participants.map(item => ({
      participantKey: item.participantKey,
      relationSummary: item.relationSummary,
      sourceCharacter: {
        worldContentHash: catalog.release.contentHash,
        characterExportId: item.exportId,
        name: catalog.characters.find(character => character.exportId === item.exportId)!.name,
        description: catalog.characters.find(character => character.exportId === item.exportId)!.description,
        voiceRules: '只根据冻结 WorldRelease 中的身份、关系和现场证据回应。',
      },
    })),
    sourceWorldContentHash: catalog.release.contentHash,
    sourceSelectionJson: JSON.stringify(draft.source),
    sourceMappingVersion: WORLD_GAME_MAPPING_VERSION,
    narrativeModuleId: story.definition.narrativeModuleId,
  })
  const report = await validateAdventureGameDraft(scope, definition.id!)
  if (!report.valid) throw new Error(`[world-game] 文字冒险投影不可发布:${report.errors.join('；')}`)
  return { definition, source: draft.source, warnings: [] }
}

export async function generateStoryGameFromWorldRelease(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  narrativeModuleExportId: number
  title?: string
  gameKey?: string
  storyArcExportIds?: number[]
}): Promise<GeneratedStoryGame> {
  const scope = await resolveScope({ scope: input.scope })
  const catalog = await loadWorldGameSourceCatalog({ scope, worldReleaseId: input.worldReleaseId })
  const draft = buildStoryGameDraftFromWorldRelease({
    manifest: catalog.manifest,
    worldContentHash: catalog.release.contentHash,
    narrativeModuleExportId: input.narrativeModuleExportId,
    storyArcExportIds: input.storyArcExportIds,
  })
  const gameKey = input.gameKey?.trim() || defaultStoryGameKey(catalog.release.contentHash, input.narrativeModuleExportId)
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, gameKey]).first()
  if (existing) {
    if (existing.productType !== 'storygame' || existing.sourceWorldContentHash !== catalog.release.contentHash
      || existing.sourceSelectionJson !== JSON.stringify(draft.source)) {
      throw new Error(`[world-game] gameKey 已被其它来源占用:${gameKey}`)
    }
    return {
      definition: existing,
      report: await validateStoryGameContent(scope, existing.narrativeModuleId),
      source: draft.source,
      warnings: [],
    }
  }
  const warnings: string[] = []
  const definition = await db.transaction('rw', scopeTransactionTables(
    db.worldReleases,
    // addNarrativeBeat owns the shared speaker validation transaction even when
    // this portable projection intentionally supplies no live speaker id.
    db.characters,
    db.narrativeModules,
    db.narrativeNodes,
    db.narrativeBeats,
    db.narrativeChoices,
    db.gameDefinitions,
    db.outlineNodes,
  ), async () => {
    const currentRelease = await db.worldReleases.get(catalog.release.id!)
    if (!currentRelease || currentRelease.contentHash !== catalog.release.contentHash
      || currentRelease.manifestJson !== catalog.release.manifestJson) {
      throw new Error('[world-game] 来源 WorldRelease 在生成期间发生变化')
    }
    const module = await createNarrativeModule({
      scope,
      owner: 'work',
      kind: draft.moduleKind,
      title: `${input.title?.trim() || draft.title} · 游戏投影`,
      description: draft.description,
      sourceProjection: 'custom',
    })
    for (const node of draft.nodes) {
      await addNarrativeNode({
        scope,
        moduleId: module.id!,
        key: node.key,
        kind: node.kind,
        title: node.title,
        summary: node.summary,
        conditionJson: node.conditionJson,
        effectsJson: node.effectsJson,
        successorKeys: node.successorKeys,
        order: node.order,
      })
    }
    await db.narrativeModules.update(module.id!, { entryNodeKey: draft.entryNodeKey, updatedAt: Date.now() })
    for (const beat of draft.beats) {
      const sourceCharacter = beat.speakerCharacterExportId == null
        ? null
        : catalog.characters.find(item => item.exportId === beat.speakerCharacterExportId)
      const portableDialogue = beat.kind === 'dialogue'
      const warning = portableDialogue
        ? `角色“${sourceCharacter?.name ?? beat.speakerCharacterExportId}”按冻结便携身份投影，对话以署名文本保留。`
        : ''
      if (warning && !warnings.includes(warning)) warnings.push(warning)
      await addNarrativeBeat({
        scope,
        moduleId: module.id!,
        nodeKey: beat.nodeKey,
        beatKey: beat.beatKey,
        kind: portableDialogue ? 'narration' : beat.kind,
        speakerCharacterId: null,
        text: portableDialogue && sourceCharacter ? `【${sourceCharacter.name}】${beat.text}` : beat.text,
        order: beat.order,
      })
    }
    for (const choice of draft.choices) {
      await addNarrativeChoice({
        scope,
        moduleId: module.id!,
        sourceNodeKey: choice.sourceNodeKey,
        choiceKey: choice.choiceKey,
        text: choice.text,
        description: choice.description,
        unavailableReason: choice.unavailableReason,
        targetNodeKey: choice.targetNodeKey,
        displayConditionJson: choice.displayConditionJson,
        availableConditionJson: choice.availableConditionJson,
        effectsJson: choice.effectsJson,
        tags: JSON.parse(choice.tagsJson) as string[],
        order: choice.order,
      })
    }
    const created = await createGameDefinition({
      scope,
      gameKey,
      title: input.title?.trim() || draft.title,
      description: draft.description,
      narrativeModuleId: module.id!,
      productType: 'storygame',
      sourceWorldContentHash: catalog.release.contentHash,
      sourceSelectionJson: JSON.stringify(draft.source),
      sourceMappingVersion: WORLD_GAME_MAPPING_VERSION,
    })
    const report = await validateStoryGameContent(scope, module.id!)
    if (!report.valid) throw new Error(`[world-game] 分支叙事投影不可发布:${[
      ...report.errors,
      ...report.unreachableNodeKeys.map(key => `不可达:${key}`),
      ...report.deadEndNodeKeys.map(key => `死路:${key}`),
    ].join('；')}`)
    return created
  })
  return {
    definition,
    report: await validateStoryGameContent(scope, definition.narrativeModuleId),
    source: draft.source,
    warnings,
  }
}

/**
 * Deterministically materialize an author/Agent-edited portable narrative.
 * The creative step happens before this function; this boundary only verifies
 * the frozen WorldRelease selection and writes the same governed tables used by
 * hand-authored games.
 */
export async function generateAuthoredStoryGameFromWorldRelease(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  draft: PortableStoryGameDraftV1
  gameKey: string
}): Promise<GeneratedStoryGame> {
  const scope = await resolveScope({ scope: input.scope })
  const catalog = await loadWorldGameSourceCatalog({ scope, worldReleaseId: input.worldReleaseId })
  const draft = input.draft
  if (draft.source.worldContentHash !== catalog.release.contentHash) {
    throw new Error('[world-game] AI 游戏候选的冻结世界版本已变化')
  }
  if (!catalog.narrativeModules.some(item => item.exportId === draft.source.narrativeModuleExportId)) {
    throw new Error('[world-game] AI 游戏候选引用的冻结叙事不存在')
  }
  const knownCharacters = new Set(catalog.characters.map(item => item.exportId))
  const invalidSpeakers = draft.beats.flatMap(beat => (
    beat.speakerCharacterExportId == null || knownCharacters.has(beat.speakerCharacterExportId)
      ? []
      : [beat.speakerCharacterExportId]
  ))
  if (invalidSpeakers.length) {
    throw new Error(`[world-game] AI 游戏候选引用了未选择的冻结角色:${[...new Set(invalidSpeakers)].join(',')}`)
  }
  const source: WorldGameSourceSelectionV1 = { ...draft.source, productType: 'storygame' }
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, input.gameKey]).first()
  if (existing) {
    if (existing.productType !== 'storygame'
      || existing.sourceWorldContentHash !== catalog.release.contentHash
      || existing.sourceSelectionJson !== JSON.stringify(source)) {
      throw new Error(`[world-game] gameKey 已被其它来源占用:${input.gameKey}`)
    }
    return {
      definition: existing,
      report: await validateStoryGameContent(scope, existing.narrativeModuleId),
      source,
      warnings: [],
    }
  }

  const warnings: string[] = []
  const definition = await db.transaction('rw', scopeTransactionTables(
    db.worldReleases,
    db.characters,
    db.narrativeModules,
    db.narrativeNodes,
    db.narrativeBeats,
    db.narrativeChoices,
    db.gameDefinitions,
    db.outlineNodes,
  ), async () => {
    const currentRelease = await db.worldReleases.get(catalog.release.id!)
    if (!currentRelease || currentRelease.contentHash !== catalog.release.contentHash
      || currentRelease.manifestJson !== catalog.release.manifestJson) {
      throw new Error('[world-game] 来源 WorldRelease 在 AI 候选采纳期间发生变化')
    }
    const module = await createNarrativeModule({
      scope,
      owner: 'work',
      kind: draft.moduleKind,
      title: `${draft.title} · AI 演化`,
      description: draft.description,
      sourceProjection: 'custom',
    })
    for (const node of draft.nodes) {
      await addNarrativeNode({
        scope,
        moduleId: module.id!,
        key: node.key,
        kind: node.kind,
        title: node.title,
        summary: node.summary,
        conditionJson: node.conditionJson,
        effectsJson: node.effectsJson,
        successorKeys: node.successorKeys,
        order: node.order,
      })
    }
    await db.narrativeModules.update(module.id!, {
      entryNodeKey: draft.entryNodeKey,
      updatedAt: Date.now(),
    })
    for (const beat of draft.beats) {
      const sourceCharacter = beat.speakerCharacterExportId == null
        ? null
        : catalog.characters.find(item => item.exportId === beat.speakerCharacterExportId)
      const portableDialogue = beat.kind === 'dialogue'
      if (portableDialogue && sourceCharacter) {
        const warning = `角色“${sourceCharacter.name}”按冻结便携身份投影，对话以署名文本保留。`
        if (!warnings.includes(warning)) warnings.push(warning)
      }
      await addNarrativeBeat({
        scope,
        moduleId: module.id!,
        nodeKey: beat.nodeKey,
        beatKey: beat.beatKey,
        kind: portableDialogue ? 'narration' : beat.kind,
        speakerCharacterId: null,
        text: portableDialogue && sourceCharacter ? `【${sourceCharacter.name}】${beat.text}` : beat.text,
        order: beat.order,
      })
    }
    for (const choice of draft.choices) {
      await addNarrativeChoice({
        scope,
        moduleId: module.id!,
        sourceNodeKey: choice.sourceNodeKey,
        choiceKey: choice.choiceKey,
        text: choice.text,
        description: choice.description,
        unavailableReason: choice.unavailableReason,
        targetNodeKey: choice.targetNodeKey,
        displayConditionJson: choice.displayConditionJson,
        availableConditionJson: choice.availableConditionJson,
        effectsJson: choice.effectsJson,
        tags: JSON.parse(choice.tagsJson) as string[],
        order: choice.order,
      })
    }
    const created = await createGameDefinition({
      scope,
      gameKey: input.gameKey,
      title: draft.title,
      description: draft.description,
      narrativeModuleId: module.id!,
      productType: 'storygame',
      sourceWorldContentHash: catalog.release.contentHash,
      sourceSelectionJson: JSON.stringify(source),
      sourceMappingVersion: WORLD_GAME_MAPPING_VERSION,
    })
    const report = await validateStoryGameContent(scope, module.id!)
    if (!report.valid) {
      throw new Error(`[world-game] AI 分支叙事不可发布:${[
        ...report.errors,
        ...report.unreachableNodeKeys.map(key => `不可达:${key}`),
        ...report.deadEndNodeKeys.map(key => `死路:${key}`),
      ].join('；')}`)
    }
    return created
  })
  return {
    definition,
    report: await validateStoryGameContent(scope, definition.narrativeModuleId),
    source,
    warnings,
  }
}

function avgCue(
  cueKey: string,
  beatKey: string,
  type: AvgPresentationCue['type'],
  assetKey: string | null,
  order: number,
  extra: Partial<AvgPresentationCue> = {},
): AvgPresentationCue {
  return {
    cueKey,
    beatKey,
    phase: 'before',
    type,
    assetKey,
    actorKey: null,
    slot: null,
    layer: null,
    x: null,
    y: null,
    scale: null,
    opacity: null,
    tone: null,
    durationMs: 320,
    easing: 'ease',
    volume: null,
    loop: false,
    snapshotKey: null,
    order,
    ...extra,
  }
}

function normalTag(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function selectedMediaAssets(
  available: PortableWorldMediaAsset[],
  selected: number[] | undefined,
): PortableWorldMediaAsset[] {
  if (selected == null) return available
  const unique = [...new Set(selected)]
  const byId = new Map(available.map(item => [item.exportId, item]))
  const missing = unique.filter(id => !byId.has(id))
  if (missing.length) throw new Error(`[world-game] AVG 媒资便携引用不存在:${missing.join(',')}`)
  const selectedIds = new Set(unique)
  return available.filter(item => selectedIds.has(item.exportId))
}

/** Pure deterministic projection from a frozen world package to declarative AVG cues. */
export function buildAvgPresentationFromWorldRelease(input: {
  catalog: WorldGameSourceCatalog
  narrativeModuleExportId: number
  storyDraft?: PortableStoryGameDraftV1
  characterExportIds?: number[]
  mediaAssetExportIds?: number[]
}): {
  content: AvgPresentationContentV1
  source: WorldGameSourceSelectionV1
  assets: PortableWorldMediaAsset[]
  warnings: string[]
} {
  const story = input.storyDraft ?? buildStoryGameDraftFromWorldRelease({
    manifest: input.catalog.manifest,
    worldContentHash: input.catalog.release.contentHash,
    narrativeModuleExportId: input.narrativeModuleExportId,
  })
  const defaultCharacterIds = story.source.characterExportIds.length
    ? story.source.characterExportIds
    : input.catalog.characters.map(item => item.exportId)
  const requestedCharacters = selectedCatalogRows(
    input.catalog.characters,
    input.characterExportIds === undefined ? defaultCharacterIds : input.characterExportIds,
    '角色',
  )
  const selectedCharacterIds = new Set([
    ...story.source.characterExportIds,
    ...requestedCharacters.map(item => item.exportId),
  ])
  const characters = input.catalog.characters.filter(item => selectedCharacterIds.has(item.exportId))
  const assets = selectedMediaAssets(input.catalog.mediaAssets, input.mediaAssetExportIds)
  const backgrounds = assets.filter(item => item.kind === 'background')
  const actors = assets.filter(item => item.kind === 'character-pose' || item.kind === 'character-expression')
  const cgs = assets.filter(item => item.kind === 'cg')
  const audio = assets.filter(item => ['bgm', 'ambience'].includes(item.kind))
  const cues: AvgPresentationCue[] = []
  const warnings: string[] = []
  const firstBeatByNode = new Map<string, PortableStoryBeat>()
  for (const beat of story.beats) {
    if (!firstBeatByNode.has(beat.nodeKey)) firstBeatByNode.set(beat.nodeKey, beat)
  }
  let cueSerial = 0
  for (const [index, node] of story.nodes.entries()) {
    const beat = firstBeatByNode.get(node.key)
    if (!beat) continue
    if (backgrounds.length && node.kind !== 'ending') {
      const tagged = backgrounds.find(item => normalTag(item.sceneTag) === normalTag(node.key)
        || normalTag(item.sceneTag) === normalTag(node.title))
      const asset = tagged ?? backgrounds[index % backgrounds.length]
      cues.push(avgCue(`world.avg.${cueSerial++}.background`, beat.beatKey, 'set-background', asset.assetKey, 0))
    }
    if (node.kind === 'ending' && cgs.length) {
      const tagged = cgs.find(item => normalTag(item.sceneTag) === normalTag(node.key)
        || normalTag(item.sceneTag) === normalTag(node.title))
      const asset = tagged ?? cgs[index % cgs.length]
      cues.push(avgCue(`world.avg.${cueSerial++}.cg`, beat.beatKey, 'show-cg', asset.assetKey, 0))
    }
  }
  const nodeByKey = new Map(story.nodes.map(node => [node.key, node]))
  const actorPlans = characters.flatMap(character => {
    const dialogueBeats = story.beats.filter(beat => beat.speakerCharacterExportId === character.exportId)
    if (!dialogueBeats.length || !actors.length) return []
    const aliases = new Set([normalTag(character.name), `character:${character.exportId}`, `character-${character.exportId}`])
    const matchingAssets = actors.filter(item => aliases.has(normalTag(item.characterTag)))
    if (!matchingAssets.length) {
      warnings.push(`角色“${character.name}”没有匹配的立绘，AVG 将仅显示姓名与文本。`)
      return []
    }
    const defaultAsset = matchingAssets.find(item => item.kind === 'character-pose')
      ?? matchingAssets[0]
    return [{ character, dialogueBeats, matchingAssets, defaultAsset }]
  })
  for (const [index, plan] of actorPlans.entries()) {
    const { character, dialogueBeats, matchingAssets, defaultAsset } = plan
    const slot = actorPlans.length === 1
      ? 'center'
      : actorPlans.length === 2
        ? index === 0 ? 'left' : 'right'
        : ['left', 'center', 'right'][index % 3]
    for (const beat of dialogueBeats) {
      const node = nodeByKey.get(beat.nodeKey)
      const desiredTag = beat.nodeKey === story.entryNodeKey ? 'entry' : node?.kind === 'choice'
        ? 'choice'
        : node?.kind === 'ending' ? 'ending' : 'scene'
      const asset = matchingAssets.find(item => normalTag(item.sceneTag) === desiredTag) ?? defaultAsset
      cues.push(avgCue(`world.avg.${cueSerial++}.actor`, beat.beatKey, 'show-actor', asset.assetKey, index, {
        actorKey: `character-${character.exportId}`,
        slot,
        layer: 'actor-front',
      }))
    }
  }
  const entryBeat = firstBeatByNode.get(story.entryNodeKey)
  if (entryBeat) {
    for (const [index, asset] of audio.slice(0, 2).entries()) {
      cues.push(avgCue(`world.avg.${cueSerial++}.audio`, entryBeat.beatKey, 'play-audio', asset.assetKey, index + 10, {
        durationMs: 0,
        volume: asset.kind === 'bgm' ? 0.55 : 0.35,
        loop: true,
      }))
    }
  }
  if (!assets.length) warnings.push('该 WorldRelease 未冻结 AVG 媒资，已生成可发布、可试玩的纯文字 AVG。')
  else {
    if (!backgrounds.length) warnings.push('未选择场景背景，AVG 将使用纯色舞台。')
    if (!actors.length && characters.length) warnings.push('未选择角色立绘，角色对话将仅显示姓名与文本。')
  }
  const source: WorldGameSourceSelectionV1 = {
    ...story.source,
    productType: 'avg',
    characterExportIds: characters.map(item => item.exportId),
    avgMediaAssetExportIds: assets.map(item => item.exportId),
  }
  return { content: { version: 1, cues }, source, assets, warnings }
}

function decodeWorldMediaDataUrl(value: string): ArrayBuffer {
  const match = /^data:[^;,]*;base64,([A-Za-z0-9+/=]*)$/.exec(value)
  if (!match) throw new Error('[world-game] AVG 媒资不是合法 data URL')
  let binary = ''
  try { binary = atob(match[1]) } catch { throw new Error('[world-game] AVG 媒资 base64 无效') }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

async function materializeAvgAssets(scope: WorkspaceScope, assets: PortableWorldMediaAsset[]): Promise<void> {
  for (const source of assets) {
    const binary = decodeWorldMediaDataUrl(source.dataUrl)
    if (binary.byteLength !== source.byteSize) throw new Error(`[world-game] AVG 媒资大小不一致:${source.assetKey}`)
    const imported = await importAvgMediaAsset({
      scope,
      assetKey: source.assetKey,
      kind: source.kind,
      name: source.name,
      blob: new Blob([binary], { type: source.mimeType }),
      altText: source.altText,
      source: source.source,
      license: source.license,
      width: source.width,
      height: source.height,
      durationMs: source.durationMs,
      characterTag: source.characterTag,
      sceneTag: source.sceneTag,
      forceLatest: true,
    })
    if (imported.contentHash !== source.contentHash || imported.byteSize !== source.byteSize) {
      throw new Error(`[world-game] AVG 媒资完整性失败:${source.assetKey}@${source.version}`)
    }
  }
}

function defaultAvgGameKey(contentHash: string, moduleExportId: number): string {
  return `world-avg-${contentHash.slice(0, 10)}-${moduleExportId}`
}

export async function generateAvgGameFromWorldRelease(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  narrativeModuleExportId: number
  title?: string
  gameKey?: string
  characterExportIds?: number[]
  mediaAssetExportIds?: number[]
}): Promise<GeneratedAvgGame> {
  const scope = await resolveScope({ scope: input.scope })
  const catalog = await loadWorldGameSourceCatalog({ scope, worldReleaseId: input.worldReleaseId })
  const draft = buildAvgPresentationFromWorldRelease({ catalog, ...input })
  const gameKey = input.gameKey?.trim() || defaultAvgGameKey(catalog.release.contentHash, input.narrativeModuleExportId)
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, gameKey]).first()
  if (existing) {
    if (existing.productType !== 'avg' || existing.sourceWorldContentHash !== catalog.release.contentHash
      || existing.sourceSelectionJson !== JSON.stringify(draft.source)) throw new Error(`[world-game] gameKey 已被其它来源占用:${gameKey}`)
    return { definition: existing, source: draft.source, warnings: draft.warnings }
  }
  // AVG intentionally reuses the governed story projection instead of cloning another narrative runtime.
  const story = await generateStoryGameFromWorldRelease({
    scope,
    worldReleaseId: input.worldReleaseId,
    narrativeModuleExportId: input.narrativeModuleExportId,
    title: input.title?.trim() || undefined,
  })
  await materializeAvgAssets(scope, draft.assets)
  const definition = await createAvgGameFromNarrative({
    scope,
    title: input.title?.trim() || `${catalog.manifest.worldName} · ${catalog.narrativeModules.find(item => item.exportId === input.narrativeModuleExportId)?.title ?? 'AVG'}`,
    gameKey,
    narrativeModuleId: story.definition.narrativeModuleId,
    content: draft.content,
    sourceWorldContentHash: catalog.release.contentHash,
    sourceSelectionJson: JSON.stringify(draft.source),
    sourceMappingVersion: WORLD_GAME_MAPPING_VERSION,
  })
  const report = await validateAvgGame(scope, definition.id!)
  if (!report.valid) throw new Error(`[world-game] AVG 投影不可发布:${report.errors.join('；')}`)
  return { definition, source: draft.source, warnings: [...story.warnings, ...draft.warnings, ...report.warnings] }
}

/**
 * Shared adoption target for Main Agent authored games. AI supplies only the
 * portable narrative graph; product-specific world assets are projected by the
 * deterministic builders already used by the manual WorldRelease bridge.
 */
export async function generateAuthoredWorldGameFromWorldRelease(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  draft: PortableStoryGameDraftV1
  candidateHash: string
}): Promise<GeneratedAuthoredWorldGame> {
  const scope = await resolveScope({ scope: input.scope })
  const productType = input.draft.source.productType
  const gameKey = `ai-${productType}-${input.candidateHash.slice(0, 20)}`
  const storySource: WorldGameSourceSelectionV1 = {
    ...input.draft.source,
    productType: 'storygame',
  }
  const story = await generateAuthoredStoryGameFromWorldRelease({
    scope,
    worldReleaseId: input.worldReleaseId,
    draft: { ...input.draft, source: storySource },
    gameKey: productType === 'storygame' ? gameKey : `${gameKey}-narrative`,
  })
  if (productType === 'storygame') return story

  const catalog = await loadWorldGameSourceCatalog({ scope, worldReleaseId: input.worldReleaseId })
  if (productType === 'text-adventure') {
    const projected = buildAdventureContent({
      catalog,
      narrativeModuleExportId: input.draft.source.narrativeModuleExportId,
      storyDraft: input.draft,
      storyArcExportIds: input.draft.source.storyArcExportIds,
      locationExportIds: input.draft.source.importantLocationExportIds,
      artifactExportIds: input.draft.source.artifactExportIds,
      codexEntryExportIds: input.draft.source.codexEntryExportIds,
      characterExportIds: input.draft.source.characterExportIds,
    })
    const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, gameKey]).first()
    if (existing) {
      if (existing.productType !== productType
        || existing.sourceWorldContentHash !== catalog.release.contentHash
        || existing.sourceSelectionJson !== JSON.stringify(projected.source)
        || existing.narrativeModuleId !== story.definition.narrativeModuleId) {
        throw new Error(`[world-game] gameKey 已被其它来源占用:${gameKey}`)
      }
      return { definition: existing, source: projected.source, warnings: story.warnings }
    }
    const definition = await createAdventureGame({
      scope,
      title: input.draft.title,
      gameKey,
      content: projected.content,
      interactionCharacters: projected.participants.map(item => ({
        participantKey: item.participantKey,
        relationSummary: item.relationSummary,
        sourceCharacter: {
          worldContentHash: catalog.release.contentHash,
          characterExportId: item.exportId,
          name: catalog.characters.find(character => character.exportId === item.exportId)!.name,
          description: catalog.characters.find(character => character.exportId === item.exportId)!.description,
          voiceRules: '只根据冻结 WorldRelease 中的身份、关系和现场证据回应。',
        },
      })),
      sourceWorldContentHash: catalog.release.contentHash,
      sourceSelectionJson: JSON.stringify(projected.source),
      sourceMappingVersion: WORLD_GAME_MAPPING_VERSION,
      narrativeModuleId: story.definition.narrativeModuleId,
    })
    const report = await validateAdventureGameDraft(scope, definition.id!)
    if (!report.valid) throw new Error(`[world-game] AI 文字冒险不可发布:${report.errors.join('；')}`)
    return { definition, source: projected.source, warnings: story.warnings }
  }

  const projected = buildAvgPresentationFromWorldRelease({
    catalog,
    narrativeModuleExportId: input.draft.source.narrativeModuleExportId,
    storyDraft: input.draft,
    characterExportIds: input.draft.source.characterExportIds,
    mediaAssetExportIds: input.draft.source.avgMediaAssetExportIds,
  })
  const existing = await db.gameDefinitions.where('[workId+gameKey]').equals([scope.workId, gameKey]).first()
  if (existing) {
    if (existing.productType !== productType
      || existing.sourceWorldContentHash !== catalog.release.contentHash
      || existing.sourceSelectionJson !== JSON.stringify(projected.source)
      || existing.narrativeModuleId !== story.definition.narrativeModuleId) {
      throw new Error(`[world-game] gameKey 已被其它来源占用:${gameKey}`)
    }
    return { definition: existing, source: projected.source, warnings: [...story.warnings, ...projected.warnings] }
  }
  await materializeAvgAssets(scope, projected.assets)
  const definition = await createAvgGameFromNarrative({
    scope,
    title: input.draft.title,
    gameKey,
    narrativeModuleId: story.definition.narrativeModuleId,
    content: projected.content,
    sourceWorldContentHash: catalog.release.contentHash,
    sourceSelectionJson: JSON.stringify(projected.source),
    sourceMappingVersion: WORLD_GAME_MAPPING_VERSION,
  })
  const report = await validateAvgGame(scope, definition.id!)
  if (!report.valid) throw new Error(`[world-game] AI AVG 不可发布:${report.errors.join('；')}`)
  return {
    definition,
    source: projected.source,
    warnings: [...story.warnings, ...projected.warnings, ...report.warnings],
  }
}
