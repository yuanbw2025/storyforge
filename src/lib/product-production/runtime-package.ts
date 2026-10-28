import {parseChatVisualDesignV1} from '../character-interaction/visual-design'
import {parseChatExperienceInfoV1} from '../character-interaction/experience-info'
import { parseAdventureContent } from '../adventure/runtime'
import {parseChatMediaBindingsV1} from '../character-interaction/media-contract'
import {parseChatCharacterCardCreditsV1} from '../character-interaction/card-credits'
import { parseAvgPresentationContent, validateAvgPresentation } from '../avg/runtime'
import { parseAvgRuntimeModuleV1 } from '../avg/runtime-contract-v2'
import { avgExecutableModule, avgModuleNarrativeV2, avgExecutableCapabilities, parseAvgRuntimeModuleV2 } from '../avg/executable-module'
import { buildAvgSystemGraphV1 } from '../avg/system-graph'
import { freezeProductMediaAsset } from './media-contracts'
import { parseOpenWorldEvolutionContent, validateOpenWorldEvolutionContent } from '../open-world/evolution-runtime'
import { parseOpenWorldContent, validateOpenWorldContent } from '../open-world/runtime'
import { parseTextOpenWorldModulesV1 } from '../open-world/modules'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from '../open-world/player-stats'
import { parseTextOpenWorldRuntimePackageV1 } from '../open-world/runtime-package'
import { validateNarrativeContentGraph } from '../product/narrative-content'
import { parseTtrpgCampaignContentV1 } from '../ttrpg/campaign'
import { parseRulePackV1 } from '../ttrpg/rule-pack'
import {
  createTtrpgVerifiedContentViewV1,
  parseTtrpgRuntimeContentVersionedV1,
  verifyTtrpgFrozenContentHashesV1,
  type ProductRuntimePackageWithTtrpgV2,
  type ProductReleaseManifestWithTtrpgV2,
} from '../ttrpg/content-version'
import { validateTtrpgOpenNarrativeEnvelopeV1 } from '../ttrpg/open-narrative-envelope'
import { parseAiTownRuntimeContentV1 } from '../ai-town/runtime'
import { parseFrozenChatSourceV1 } from '../character-interaction/runtime'
import { parseFrozenChatNarrativeV1 } from '../character-interaction/narrative-contract'
import { isChatNarrativeShellV1 } from '../character-interaction/narrative-production'
import {
  NARRATIVE_BEAT_KINDS,
  NARRATIVE_MODULE_KINDS,
  NARRATIVE_NODE_KINDS,
  PRODUCTION_PRODUCT_KINDS_V1,
} from '../types'
import type {
  ProductMediaAsset,
  FrozenProductNarrativeNode,
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  ProductionProductKindV1,
  ProductReleaseManifestV1,
  ProductRuntimePackageV1,
  ProductRuntimePackageV2,
  ProductReleaseManifestV2,
  AnyProductRuntimePackage,
  AnyProductReleaseManifest,
  ProductReleaseLineageV1,
  ProductSourcePlan,
  ConfirmedProductBriefV1,
  ProductSourceManifest,
  ProductWorldSourceSelectionV1,
  ProductWorldSourceSelection,
  TextOpenWorldCreatorReleaseSourceContractsV1,
  TextOpenWorldCreatorReleaseLineageV1,
} from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import {
  validateConfirmedProductBriefV1,
  validateProductReleaseLineageV1,
  validateProductSourceManifest,
  validateProductSourcePlan,
} from '../product/source-contracts'

const PRODUCT_TYPES = new Set<ProductionProductKindV1>(PRODUCTION_PRODUCT_KINDS_V1)

function isCreatorReleaseSourceContracts(
  value: ProductReleaseManifestV1['sourceContracts'],
): value is TextOpenWorldCreatorReleaseSourceContractsV1 {
  return 'schema' in value
    && value.schema === 'storyforge.text-open-world-creator-release-source-contracts'
}

export interface ProductProductionTerminalArtifactKeysV1 {
  runtimePackage: string
  qualityReport: string
}

/** Product-specific terminal Artifact names share one routing fact across the
 * scheduler and atomic adoption path. */
export function productProductionTerminalArtifactKeysV1(
  productType: ProductionProductKindV1,
): ProductProductionTerminalArtifactKeysV1 {
  return productType === 'text-open-world'
    ? {
        runtimePackage: 'text-open-world.runtime-package',
        qualityReport: 'text-open-world.quality-report',
      }
    : { runtimePackage: 'runtime.package', qualityReport: 'quality.report' }
}

const CAPABILITIES: Record<ProductionProductKindV1, string[]> = {
  'character-interaction': ['narrative', 'interaction'],
  'ai-town': ['narrative', 'interaction', 'town'],
  'text-adventure': ['narrative', 'interaction', 'adventure'],
  avg: ['narrative', 'presentation'],
  'text-open-world': ['narrative', 'interaction', 'adventure', 'openWorldEvolution', 'open-world'],
  ttrpg: ['narrative', 'ttrpg'],
}

const PRODUCT_MODULE_KEYS: Record<ProductionProductKindV1, string[]> = {
  'character-interaction': ['interaction'],
  'ai-town': ['interaction', 'town'],
  'text-adventure': ['interaction', 'adventure'],
  avg: ['presentation'],
  'text-open-world': ['interaction', 'adventure', 'openWorldEvolution', 'openWorld'],
  ttrpg: ['ttrpg'],
}

function fail(message: string): never {
  throw new Error(`[product-runtime-package] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不符合合同: ${actual.join(',')}`)
  }
}

function requiredText(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function optionalText(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string' || value.length > maximum) fail(`${label} 无效`)
  return value.normalize('NFC')
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail(`${label} 必须是 >=${minimum} 的整数`)
  return Number(value)
}

function stringArray(value: unknown, label: string, maximum = 2_000): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => requiredText(item, `${label}[${index}]`, 2_000))
  if (new Set(result).size !== result.length) fail(`${label} 不能重复`)
  return result
}

function stableKey(value: unknown, label: string): string {
  const result = requiredText(value, label, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) fail(`${label} 不是稳定 key`)
  return result
}

function stableKeyArray(value: unknown, label: string, maximum = 2_000): string[] {
  const values = stringArray(value, label, maximum)
  return values.map((item, index) => stableKey(item, `${label}[${index}]`))
}

function parseFrozenNarrative(value: unknown): ProductRuntimePackageV1['narrative'] {
  const narrative = record(value, 'narrative')
  exactKeys(narrative, ['moduleKind', 'moduleTitle', 'entryNodeKey', 'nodes', 'beats', 'choices'], 'narrative')
  if (!NARRATIVE_MODULE_KINDS.includes(narrative.moduleKind as typeof NARRATIVE_MODULE_KINDS[number])) {
    fail('narrative.moduleKind 无效')
  }
  if (!Array.isArray(narrative.nodes) || !Array.isArray(narrative.beats) || !Array.isArray(narrative.choices)
    || narrative.nodes.length > 10_000 || narrative.beats.length > 100_000 || narrative.choices.length > 100_000) {
    fail('narrative 内容无效或超出数量上限')
  }
  const nodes: FrozenProductNarrativeNode[] = narrative.nodes.map((value, index) => {
    const node = record(value, `narrative.nodes[${index}]`)
    exactKeys(node, ['key', 'kind', 'title', 'summary', 'conditionJson', 'effectsJson', 'successorKeys'], `narrative.nodes[${index}]`)
    if (!NARRATIVE_NODE_KINDS.includes(node.kind as typeof NARRATIVE_NODE_KINDS[number])) {
      fail(`narrative.nodes[${index}].kind 无效`)
    }
    return {
      key: stableKey(node.key, `narrative.nodes[${index}].key`),
      kind: node.kind as FrozenProductNarrativeNode['kind'],
      title: requiredText(node.title, `narrative.nodes[${index}].title`, 500),
      summary: optionalText(node.summary, `narrative.nodes[${index}].summary`, 20_000),
      conditionJson: requiredText(node.conditionJson, `narrative.nodes[${index}].conditionJson`, 64_000),
      effectsJson: requiredText(node.effectsJson, `narrative.nodes[${index}].effectsJson`, 64_000),
      successorKeys: stableKeyArray(node.successorKeys, `narrative.nodes[${index}].successorKeys`),
    }
  })
  const beats: FrozenNarrativeBeat[] = narrative.beats.map((value, index) => {
    const beat = record(value, `narrative.beats[${index}]`)
    exactKeys(beat, ['beatKey', 'nodeKey', 'kind', 'speakerKey', 'text', 'order'], `narrative.beats[${index}]`)
    if (!NARRATIVE_BEAT_KINDS.includes(beat.kind as typeof NARRATIVE_BEAT_KINDS[number])) {
      fail(`narrative.beats[${index}].kind 无效`)
    }
    return {
      beatKey: stableKey(beat.beatKey, `narrative.beats[${index}].beatKey`),
      nodeKey: stableKey(beat.nodeKey, `narrative.beats[${index}].nodeKey`),
      kind: beat.kind as FrozenNarrativeBeat['kind'],
      speakerKey: beat.speakerKey == null ? null : stableKey(beat.speakerKey, `narrative.beats[${index}].speakerKey`),
      text: requiredText(beat.text, `narrative.beats[${index}].text`, 20_000),
      order: integer(beat.order, `narrative.beats[${index}].order`),
    }
  })
  const choices: FrozenNarrativeChoice[] = narrative.choices.map((value, index) => {
    const choice = record(value, `narrative.choices[${index}]`)
    exactKeys(choice, [
      'choiceKey', 'sourceNodeKey', 'text', 'description', 'unavailableReason', 'targetNodeKey',
      'displayConditionJson', 'availableConditionJson', 'effectsJson', 'tags', 'order',
    ], `narrative.choices[${index}]`)
    return {
      choiceKey: stableKey(choice.choiceKey, `narrative.choices[${index}].choiceKey`),
      sourceNodeKey: stableKey(choice.sourceNodeKey, `narrative.choices[${index}].sourceNodeKey`),
      text: requiredText(choice.text, `narrative.choices[${index}].text`, 2_000),
      description: optionalText(choice.description, `narrative.choices[${index}].description`, 20_000),
      unavailableReason: optionalText(choice.unavailableReason, `narrative.choices[${index}].unavailableReason`, 20_000),
      targetNodeKey: stableKey(choice.targetNodeKey, `narrative.choices[${index}].targetNodeKey`),
      displayConditionJson: requiredText(choice.displayConditionJson, `narrative.choices[${index}].displayConditionJson`, 64_000),
      availableConditionJson: requiredText(choice.availableConditionJson, `narrative.choices[${index}].availableConditionJson`, 64_000),
      effectsJson: requiredText(choice.effectsJson, `narrative.choices[${index}].effectsJson`, 64_000),
      tags: stringArray(choice.tags, `narrative.choices[${index}].tags`, 100),
      order: integer(choice.order, `narrative.choices[${index}].order`),
    }
  })
  return {
    moduleKind: narrative.moduleKind as ProductRuntimePackageV1['narrative']['moduleKind'],
    moduleTitle: requiredText(narrative.moduleTitle, 'narrative.moduleTitle', 2_000),
    entryNodeKey: stableKey(narrative.entryNodeKey, 'narrative.entryNodeKey'),
    nodes,
    beats,
    choices,
  }
}

function productType(value: unknown): ProductionProductKindV1 {
  if (typeof value !== 'string' || !PRODUCT_TYPES.has(value as ProductionProductKindV1)) fail('productType 无效')
  return value as ProductionProductKindV1
}

function worldResourceKey(value: unknown, label: string, version: 1 | 2): string {
  const key = requiredText(value, label, 1_000)
  if ((version === 1 ? !key.startsWith('world-release:') || /\s/.test(key) : !/^world-narrative:[a-f0-9]{64}$/.test(key))) fail(`${label} 不是该版本的中立世界资源 key`)
  return key
}

function worldResourceKeyArray(value: unknown, label: string, version: 1 | 2): string[] {
  if (!Array.isArray(value) || value.length > 20_000) fail(`${label} 必须是有界数组`)
  const keys = value.map((item, index) => worldResourceKey(item, `${label}[${index}]`, version))
  if (new Set(keys).size !== keys.length) fail(`${label} 不能重复`)
  return keys.sort()
}

function validateTtrpg(value: unknown, sourceWorldHash: string): NonNullable<ProductRuntimePackageV1['ttrpg']> {
  const ttrpg = record(value, 'ttrpg')
  exactKeys(ttrpg, ['rulePack', 'campaign', 'compatibility'], 'ttrpg')
  const rulePack = record(ttrpg.rulePack, 'ttrpg.rulePack')
  exactKeys(rulePack, ['content', 'contentHash'], 'ttrpg.rulePack')
  if (!isSha256Hash(rulePack.contentHash)) fail('ttrpg.rulePack.contentHash 无效')
  const ruleContent = parseRulePackV1(rulePack.content)
  const campaign = parseTtrpgCampaignContentV1(ttrpg.campaign, ruleContent)
  if (campaign.sourceWorld.contentHash !== sourceWorldHash || !isSha256Hash(campaign.sourceWorld.bundleHash)) {
    fail('ttrpg campaign 来源与 RuntimePackage 不一致')
  }
  const compatibility = record(ttrpg.compatibility, 'ttrpg.compatibility')
  exactKeys(compatibility, ['runtimeProtocol', 'minimumPlayerVersion'], 'ttrpg.compatibility')
  if (compatibility.runtimeProtocol !== 1 || compatibility.minimumPlayerVersion !== 1) {
    fail('ttrpg runtime compatibility 无效')
  }
  return {
    rulePack: { content: ruleContent, contentHash: rulePack.contentHash },
    campaign,
    compatibility: { runtimeProtocol: 1, minimumPlayerVersion: 1 },
  }
}

export function parseProductWorldSourceSelectionV1(value: unknown): ProductWorldSourceSelectionV1 {
  if (record(value, 'sourceWorld.selection').version !== 1) fail('V1 入口只接受旧版世界选择')
  return parseProductWorldSourceSelection(value) as ProductWorldSourceSelectionV1
}

export function parseProductWorldSourceSelection(value: unknown): ProductWorldSourceSelection {
  const selection = record(value, 'sourceWorld.selection')
  exactKeys(selection, ['schema', 'version', 'productType', 'worldReferenceHash', 'resourceKeys', 'roleBindings'], 'sourceWorld.selection')
  if (selection.schema !== 'storyforge.product-world-source-selection' || (selection.version !== 1 && selection.version !== 2)) {
    fail('source selection 版本无效')
  }
  const selectedProduct = productType(selection.productType)
  if (selection.version === 2 && selectedProduct !== 'character-interaction' && selectedProduct !== 'avg') fail('此产品尚未登记叙事来源选择')
  if (!isSha256Hash(selection.worldReferenceHash)) fail('selection.worldReferenceHash 无效')
  const resourceKeys = worldResourceKeyArray(selection.resourceKeys, 'selection.resourceKeys', selection.version)
  const roleRecord = record(selection.roleBindings, 'selection.roleBindings')
  if (Object.keys(roleRecord).length > 100) fail('selection.roleBindings 数量超限')
  const allowed = new Set(resourceKeys)
  const roleBindings = Object.fromEntries(Object.entries(roleRecord).sort(([left], [right]) => left.localeCompare(right)).map(([role, rawKeys]) => {
    stableKey(role, `selection.roleBindings.${role}`)
    const keys = worldResourceKeyArray(rawKeys, `selection.roleBindings.${role}`, selection.version as 1 | 2)
    if (keys.some(key => !allowed.has(key))) fail(`selection.roleBindings.${role} 超出资源选择`)
    return [role, keys]
  }))
  return {
    schema: 'storyforge.product-world-source-selection',
    version: selection.version,
    productType: selectedProduct,
    worldReferenceHash: selection.worldReferenceHash,
    resourceKeys,
    roleBindings,
  } as ProductWorldSourceSelection
}

function validateInteraction(value: unknown): ProductRuntimePackageV1['interaction'] {
  const interaction = record(value, 'interaction') as unknown as NonNullable<ProductRuntimePackageV1['interaction']>
  if (interaction.playerKey !== 'player' || !Array.isArray(interaction.profiles) || !Array.isArray(interaction.sceneTemplates)) {
    fail('interaction 内容无效')
  }
  const participantKeys = interaction.profiles.map(item => requiredText(item?.participantKey, 'participantKey', 500))
  if (!participantKeys.length || new Set(participantKeys).size !== participantKeys.length || !interaction.sceneTemplates.length) {
    fail('interaction 至少需要唯一角色和场景')
  }
  const participants = new Set(participantKeys)
  if (interaction.chatSource) parseFrozenChatSourceV1(interaction.chatSource, participantKeys, interaction.profiles.map(p => p.characterKey))
  if (interaction.chatCardCredits !== undefined) parseChatCharacterCardCreditsV1(interaction.chatCardCredits, interaction)
  if (interaction.chatExperienceInfo !== undefined) parseChatExperienceInfoV1(interaction.chatExperienceInfo)
  if (interaction.chatNarrative !== undefined) {
    if (!interaction.chatSource) fail('主动叙事情境缺少已确认资料')
    parseFrozenChatNarrativeV1(interaction.chatNarrative, {source: interaction.chatSource, participantKeys,
      characterKeys: interaction.profiles.map(p => p.characterKey), sceneKeys: interaction.sceneTemplates.map(s => s.sceneKey)})
  }
  for (const scene of interaction.sceneTemplates) {
    requiredText(scene.sceneKey, 'sceneKey', 500)
    if (!Array.isArray(scene.participantKeys) || scene.participantKeys.some(key => !participants.has(key))) {
      fail(`interaction 场景参与者无效:${scene.sceneKey}`)
    }
  }
  return structuredClone(interaction)
}

export interface ProductTtrpgProtocol2ReaderV1 {
  ttrpgProtocol: 2
}

export function parseProductRuntimePackageV1(value: string | unknown): ProductRuntimePackageV1
export function parseProductRuntimePackageV1(
  value: string | unknown, reader: ProductTtrpgProtocol2ReaderV1,
): ProductRuntimePackageWithTtrpgV2
export function parseProductRuntimePackageV1(
  value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1,
): ProductRuntimePackageWithTtrpgV2 {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('不是合法 JSON') }
  }
  const pkg = record(raw, 'package')
  const selectedProduct = productType(pkg.productType)
  if (selectedProduct !== 'character-interaction' && (pkg.interaction as {chatSource?: unknown} | undefined)?.chatSource) {
    fail('角色资料投影只属于角色聊天产品')
  }
  if (selectedProduct !== 'character-interaction' && (pkg.interaction as {chatNarrative?: unknown} | undefined)?.chatNarrative !== undefined) fail('主动叙事情境只属于角色聊天产品')
  const chatVisualDesign = (pkg.interaction as {chatVisualDesign?: unknown} | undefined)?.chatVisualDesign
  if (selectedProduct !== 'character-interaction' && chatVisualDesign !== undefined) fail('角色美术设计只属于角色聊天产品')
  const chatMedia = (pkg.interaction as {chatMedia?: unknown} | undefined)?.chatMedia
  if (selectedProduct !== 'character-interaction' && (pkg.interaction as {chatCardCredits?: unknown} | undefined)?.chatCardCredits !== undefined) fail('角色卡署名只属于角色聊天产品')
  if (selectedProduct !== 'character-interaction' && (pkg.interaction as {chatExperienceInfo?: unknown} | undefined)?.chatExperienceInfo !== undefined) fail('聊天作品说明只属于角色聊天产品')
  if (selectedProduct !== 'character-interaction' && chatMedia !== undefined) fail('角色图片绑定只属于角色聊天产品')
  const hasOptionalPresentation = (
    selectedProduct === 'ttrpg'
    || selectedProduct === 'ai-town'
    || selectedProduct === 'text-adventure'
    || selectedProduct === 'character-interaction'
  )
    && Object.prototype.hasOwnProperty.call(pkg, 'presentation')
  const hasTextOpenWorldVNext = selectedProduct === 'text-open-world'
    && Object.prototype.hasOwnProperty.call(pkg, 'textOpenWorldVNext')
  const textOpenWorldLegacyKeys = PRODUCT_MODULE_KEYS['text-open-world']
  const hasAnyTextOpenWorldLegacy = selectedProduct === 'text-open-world'
    && textOpenWorldLegacyKeys.some(key => Object.prototype.hasOwnProperty.call(pkg, key))
  const hasTextOpenWorldLegacy = selectedProduct === 'text-open-world'
    && textOpenWorldLegacyKeys.every(key => Object.prototype.hasOwnProperty.call(pkg, key))
  if (hasAnyTextOpenWorldLegacy !== hasTextOpenWorldLegacy) {
    fail('text-open-world旧模块必须完整存在或完整省略')
  }
  const hasTextOpenWorldPresentation = hasTextOpenWorldVNext
    && Object.prototype.hasOwnProperty.call(pkg, 'presentation')
  const productModuleKeys = hasTextOpenWorldVNext && !hasTextOpenWorldLegacy
    ? [] : PRODUCT_MODULE_KEYS[selectedProduct]
  exactKeys(pkg, [
    'schema', 'version', 'productType', 'definition', 'sourceWorld', 'narrative',
    ...productModuleKeys,
    ...(hasOptionalPresentation ? ['presentation'] : []),
    ...(hasTextOpenWorldPresentation ? ['presentation'] : []),
    ...(hasTextOpenWorldVNext ? ['textOpenWorldVNext'] : []),
  ], 'package')
  if (pkg.schema !== 'storyforge.product-runtime-package' || pkg.version !== 1) fail('schema/version 无效')

  const definition = record(pkg.definition, 'definition')
  exactKeys(definition, [
    'productKey', 'title', 'description', 'enabledCapabilities', 'rulesetVersion', 'initialVariables',
  ], 'definition')
  const enabledCapabilities = stringArray(definition.enabledCapabilities, 'enabledCapabilities', 20)
  const expectedCapabilities = hasTextOpenWorldVNext
    ? hasTextOpenWorldLegacy
      ? [...CAPABILITIES[selectedProduct], 'textOpenWorldVNext', ...(hasTextOpenWorldPresentation ? ['presentation'] : [])]
      : ['narrative', 'textOpenWorldVNext', ...(hasTextOpenWorldPresentation ? ['presentation'] : [])]
    : hasOptionalPresentation
      ? [...CAPABILITIES[selectedProduct], 'presentation'] : CAPABILITIES[selectedProduct]
  if (enabledCapabilities.join(',') !== expectedCapabilities.join(',')) fail('enabledCapabilities 与 productType 不一致')
  const initialVariables = record(definition.initialVariables, 'initialVariables')
  canonicalProductProductionJsonV2(initialVariables)

  const sourceWorld = record(pkg.sourceWorld, 'sourceWorld')
  exactKeys(sourceWorld, ['contentHash', 'selection'], 'sourceWorld')
  if (!isSha256Hash(sourceWorld.contentHash)) fail('sourceWorld.contentHash 无效')
  const selection = parseProductWorldSourceSelection(sourceWorld.selection)
  if (selection.productType !== selectedProduct) {
    fail('source selection 与 package 来源不一致')
  }

  // The product discriminator is validated before choosing narrative semantics.
  // Protocol-1 callers keep the exact original parser and canonical representation.
  const ttrpg = selectedProduct === 'ttrpg'
    ? reader?.ttrpgProtocol === 2
      ? parseTtrpgRuntimeContentVersionedV1(pkg.ttrpg, sourceWorld.contentHash, 2)
      : validateTtrpg(pkg.ttrpg, sourceWorld.contentHash)
    : undefined
  if (ttrpg?.campaign.version === 2) {
    const allowedResources = new Set(selection.resourceKeys)
    const sourceResources = [
      ...ttrpg.campaign.frozenWorldPredicateIndex.entries.flatMap(entry => [
        ...entry.sourceResourceRefs, ...entry.sourceFieldRefs.map(ref => ref.resourceKey),
      ]),
      ...ttrpg.campaign.entityBindings.flatMap(binding => [
        ...(binding.sourceResourceRef === null ? [] : [binding.sourceResourceRef]),
        ...binding.sourceFieldRefs.map(ref => ref.resourceKey),
      ]),
    ]
    if (sourceResources.some(key => !allowedResources.has(key))) {
      fail('open 内容来源超出冻结的世界资源选择')
    }
  }
  const narrative = parseFrozenNarrative(pkg.narrative)
  const chatInteraction = selectedProduct === 'character-interaction' ? validateInteraction(pkg.interaction) : null
  const graph = ttrpg?.campaign.version === 2
    ? validateTtrpgOpenNarrativeEnvelopeV1(
        narrative, new Set(ttrpg.campaign.characterTemplates.map(character => character.characterKey)),
      )
    : validateNarrativeContentGraph({
    entryNodeKey: narrative.entryNodeKey,
    nodes: narrative.nodes,
    beats: narrative.beats,
    choices: narrative.choices,
  })
  if (chatInteraction?.chatNarrative) {
    if (!isChatNarrativeShellV1(narrative, chatInteraction.chatNarrative)) fail('主动叙事情境导航不匹配，不能混入预设未来或秘密')
  } else if (!graph.valid) fail(`narrative 图无效:${graph.errors.join('；')}`)

  const parsed: ProductRuntimePackageWithTtrpgV2 = {
    schema: 'storyforge.product-runtime-package',
    version: 1,
    productType: selectedProduct,
    definition: {
      productKey: requiredText(definition.productKey, 'productKey', 500),
      title: requiredText(definition.title, 'title', 2_000),
      description: optionalText(definition.description, 'description'),
      enabledCapabilities,
      rulesetVersion: integer(definition.rulesetVersion, 'rulesetVersion', 1),
      initialVariables: structuredClone(initialVariables),
    },
    sourceWorld: { contentHash: sourceWorld.contentHash, selection },
    narrative: structuredClone(narrative),
  }

  if ((!hasTextOpenWorldVNext || hasTextOpenWorldLegacy) && (selectedProduct === 'character-interaction' || selectedProduct === 'ai-town' || selectedProduct === 'text-adventure'
    || selectedProduct === 'text-open-world')) parsed.interaction = chatInteraction ?? validateInteraction(pkg.interaction)
  if (parsed.interaction?.chatSource && parsed.interaction.chatSource.worldReleaseHash !== sourceWorld.contentHash) {
    fail('角色资料投影与发布包世界版本不一致')
  }
  if ((!hasTextOpenWorldVNext || hasTextOpenWorldLegacy) && (selectedProduct === 'text-adventure' || selectedProduct === 'text-open-world')) {
    parsed.adventure = parseAdventureContent(pkg.adventure as never)
    if (selectedProduct === 'text-open-world' && parsed.adventure.version !== 1) {
      fail('text-open-world 仍只接受隔离的 Adventure V1，不能复用文字冒险 V2 私域状态')
    }
    if (selectedProduct === 'text-adventure' && parsed.adventure.version === 2) {
      const narrativeNodes = new Map(narrative.nodes.map(node => [node.key, node]))
      for (const ending of parsed.adventure.endings) {
        const node = narrativeNodes.get(ending.narrativeNodeKey)
        if (!node || node.kind !== 'ending') fail(`Adventure V2 结局没有对应 ending 节点:${ending.key}`)
      }
    }
  }
  if (selectedProduct === 'avg' || hasOptionalPresentation || hasTextOpenWorldPresentation) {
    const presentation = record(pkg.presentation, 'presentation')
    if (!Array.isArray(presentation.assets)) fail('presentation.assets 无效')
    const content = parseAvgPresentationContent(presentation)
    const assets = presentation.assets.map((asset, index) => {
      const row = record(asset, `presentation.assets[${index}]`)
      if (!isSha256Hash(row.blobContentHash)) fail(`presentation.assets[${index}].blobContentHash 无效`)
      const frozen = freezeProductMediaAsset(row as unknown as ProductMediaAsset)
      if (frozen.contentHash !== row.blobContentHash) fail(`presentation.assets[${index}] bytes hash 不一致`)
      return { ...frozen, blobContentHash: row.blobContentHash }
    })
    if (new Set(assets.map(asset => asset.assetKey)).size !== assets.length) fail('presentation assetKey 重复')
    const report = validateAvgPresentation({ content, beats: narrative.beats, assets })
    if (!report.valid) fail(`presentation 无效:${report.errors.join('；')}`)
    parsed.presentation = { ...content, assets }
  }
  if (selectedProduct === 'character-interaction' && (chatMedia !== undefined || parsed.presentation)) {
    if (!parsed.presentation || chatMedia === undefined) fail('角色图片目录与绑定必须同时存在')
    if (parsed.presentation.cues.length) fail('角色聊天图片不能执行预设节拍演出')
    parsed.interaction!.chatMedia = parseChatMediaBindingsV1(chatMedia, parsed.interaction!, parsed.presentation.assets)
  }
  if (chatVisualDesign !== undefined) {
    if (!parsed.interaction?.chatMedia || !parsed.interaction.chatNarrative) fail('角色美术设计缺少内容与消费槽')
    const design = parseChatVisualDesignV1(chatVisualDesign), content = parsed.interaction
    const initial = content.chatNarrative!.initialSituation
    if (design.characters.length !== content.profiles.length || design.characters.some(character => !content.profiles.some(profile =>
      profile.characterKey === character.characterKey && profile.participantKey === character.participantKey && profile.name === character.name))
      || design.scene.sceneKey !== initial.sceneKey || design.scene.location !== initial.location || design.scene.timeLabel !== initial.timeLabel) fail('美术设计与发布角色或场景不一致')
    content.chatVisualDesign = design
  }
  if (selectedProduct === 'text-open-world' && (!hasTextOpenWorldVNext || hasTextOpenWorldLegacy)) {
    const openWorldEvolution = parseOpenWorldEvolutionContent(pkg.openWorldEvolution)
    const report = validateOpenWorldEvolutionContent({
      content: openWorldEvolution,
      narrativeNodeKeys: narrative.nodes.map(node => node.key),
    })
    if (!report.valid) fail(`openWorldEvolution 无效:${report.errors.join('；')}`)
    parsed.openWorldEvolution = openWorldEvolution
  }
  if (selectedProduct === 'text-open-world' && (!hasTextOpenWorldVNext || hasTextOpenWorldLegacy)) {
    const adventure = parsed.adventure
    if (!adventure || adventure.version !== 1) fail('text-open-world 冒险兼容层必须是 V1')
    const openWorld = parseOpenWorldContent(pkg.openWorld)
    const report = validateOpenWorldContent({
      content: openWorld,
      adventure,
      interactionProfiles: parsed.interaction!.profiles,
      interactionScenes: parsed.interaction!.sceneTemplates,
      openWorldEvolution: parsed.openWorldEvolution!,
      narrativeNodeKeys: narrative.nodes.map(node => node.key),
    })
    if (!report.valid) fail(`openWorld 无效:${report.errors.join('；')}`)
    parsed.openWorld = openWorld
  }
  if (hasTextOpenWorldVNext) {
    const textOpenWorldVNext = parseTextOpenWorldRuntimePackageV1(pkg.textOpenWorldVNext)
    const textOpenWorldModules = parseTextOpenWorldModulesV1(textOpenWorldVNext)
    deriveTextOpenWorldPlayerStatsFromModulesV1({
      modules: textOpenWorldModules,
      level: textOpenWorldModules.actors.player.build.initialLevel,
      attributes: textOpenWorldModules.actors.player.build.attributes,
      equippedItemKeyBySlot: { weapon: null, armor: null, accessory: null },
    })
    if (textOpenWorldVNext.sourceManifest.contentHash !== sourceWorld.contentHash
      || textOpenWorldVNext.metadata.rulesetVersion !== parsed.definition.rulesetVersion) {
      fail('textOpenWorldVNext 与 ProductRuntimePackage 来源或规则版本不一致')
    }
    // ProductRelease adoption reparses this package. Closing the product-local
    // slot references here makes every bound vNext asset trace to exactly one
    // frozen outer presentation asset, while unbound required slots retain the
    // non-empty fallback already enforced by the module parser.
    const boundSlotAssetKeys = textOpenWorldModules.presentation.mediaSlots
      .flatMap(slot => slot.assetKey == null ? [] : [slot.assetKey]).sort()
    const frozenAssetKeys = (parsed.presentation?.assets ?? []).map(asset => asset.assetKey).sort()
    if (boundSlotAssetKeys.join('|') !== frozenAssetKeys.join('|')) {
      fail('textOpenWorldVNext 媒资槽与 ProductRuntimePackage 资产不闭合')
    }
    parsed.textOpenWorldVNext = textOpenWorldVNext
  }
  if (selectedProduct === 'ttrpg') parsed.ttrpg = ttrpg
  if (selectedProduct === 'ai-town') parsed.town = parseAiTownRuntimeContentV1(pkg.town)
  return parsed
}

/** Inspect the exact outer protocol before dispatching; never fall back to V1. */
export function productProtocolVersion(value: string | unknown, schema: string): 1 | 2 {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('不是合法 JSON') }
  }
  const envelope = record(raw, 'protocol')
  if (envelope.schema !== schema || (envelope.version !== 1 && envelope.version !== 2)) {
    fail(`${schema} schema/version 不支持`)
  }
  return envelope.version
}

/** Registered AVG carriers remain distinct from playable runtime capability. */
export function parseProductRuntimePackageV2(value: string | unknown): ProductRuntimePackageV2 {
  productProtocolVersion(value, 'storyforge.product-runtime-package')
  const pkg = record(typeof value === 'string' ? JSON.parse(value) : value, 'package')
  exactKeys(pkg, ['schema', 'version', 'productType', 'definition', 'sourceWorld', 'narrative', 'modules'], 'package V2')
  if (pkg.version !== 2 || pkg.productType !== 'avg') fail('V2 只支持已声明的 AVG 载体')
  if (!Array.isArray(pkg.modules) || pkg.modules.length > 1) fail('V2 包含未登记模块或重复模块')
  const modules = pkg.modules.map(value => record(value, 'AVG module').version === 2 ? parseAvgRuntimeModuleV2(value) : parseAvgRuntimeModuleV1(value))
  const definition = record(pkg.definition, 'definition')
  exactKeys(definition, ['productKey', 'title', 'description', 'enabledCapabilities', 'rulesetVersion', 'initialVariables'], 'definition')
  const enabledCapabilities = stringArray(definition.enabledCapabilities, 'enabledCapabilities', 20)
  const executable = modules.find(module => module.version === 2)
  if (executable && definition.rulesetVersion !== executable.systemPlan.version) fail('AVG 规则版本未支持')
  if (enabledCapabilities.join(',') !== (executable ? avgExecutableCapabilities(executable).join(',') : 'narrative')) fail('V2 启用了未登记能力')
  const initialVariables = record(definition.initialVariables, 'initialVariables')
  canonicalProductProductionJsonV2(initialVariables)
  const sourceWorld = record(pkg.sourceWorld, 'sourceWorld')
  exactKeys(sourceWorld, ['contentHash', 'selection'], 'sourceWorld')
  if (!isSha256Hash(sourceWorld.contentHash)) fail('sourceWorld.contentHash 无效')
  const selection = parseProductWorldSourceSelection(sourceWorld.selection)
  if (selection.productType !== 'avg') fail('source selection 与 V2 package 来源不一致')
  const narrative = parseFrozenNarrative(pkg.narrative)
  const graph = validateNarrativeContentGraph({
    entryNodeKey: narrative.entryNodeKey, nodes: narrative.nodes, beats: narrative.beats, choices: narrative.choices,
  })
  if (!graph.valid) fail(`narrative 图无效:${graph.errors.join('；')}`)
  const beatsByKey = new Map(narrative.beats.map(beat => [beat.beatKey, beat]))
  for (const module of modules) {
    if (module.version === 2) {
      const compiled = buildAvgSystemGraphV1(module.systemPlan)
      if (canonicalProductProductionJsonV2(initialVariables) !== canonicalProductProductionJsonV2(compiled.initialVariables)
        || canonicalProductProductionJsonV2(narrative) !== canonicalProductProductionJsonV2(avgModuleNarrativeV2(module))) fail('AVG 可执行规则、规范句与 narrative/初值不一致')
      continue
    }
    if (module.lines.length !== narrative.beats.length
      || module.lines.some(line => {
        const beat = beatsByKey.get(line.lineKey)
        return !beat || beat.nodeKey !== line.sceneKey || beat.speakerKey !== line.speakerKey || beat.text !== line.text
      })) {
      fail('AVG module lines 与规范 narrative 不一致')
    }
    if (module.storyMode === 'linear' && narrative.choices.length) fail('linear AVG module 不得嵌入分支 choice')
  }
  return {
    schema: 'storyforge.product-runtime-package', version: 2, productType: 'avg',
    definition: {
      productKey: requiredText(definition.productKey, 'productKey', 500),
      title: requiredText(definition.title, 'title', 2_000),
      description: optionalText(definition.description, 'description'), enabledCapabilities,
      rulesetVersion: integer(definition.rulesetVersion, 'rulesetVersion', 1),
      initialVariables: structuredClone(initialVariables),
    },
    sourceWorld: { contentHash: sourceWorld.contentHash, selection },
    narrative: structuredClone(narrative), modules,
  }
}

export function parseProductRuntimePackage(value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1): AnyProductRuntimePackage {
  return productProtocolVersion(value, 'storyforge.product-runtime-package') === 1
    ? (reader ? parseProductRuntimePackageV1(value, reader) : parseProductRuntimePackageV1(value)) : parseProductRuntimePackageV2(value)
}

/** Protocol support is distinct from runtime capability support. */
export function requirePlayableProductRuntimePackageV1(pkg: AnyProductRuntimePackage): ProductRuntimePackageV1 {
  if (pkg.version !== 1) fail('V2 载体尚未登记可玩模块；不能启动运行或降级为 V1')
  return parseProductRuntimePackageV1(pkg)
}

/** Native version-aware admission. An inert V2 carrier remains unplayable. */
export function requirePlayableProductRuntimePackage(pkg: AnyProductRuntimePackage): AnyProductRuntimePackage {
  if (pkg.version === 2 && !avgExecutableModule(pkg)) fail('V2 载体尚未登记可玩模块；不能启动运行或降级为 V1')
  return pkg
}

export function parseProductReleaseManifestV1(value: string | unknown): ProductReleaseManifestV1
export function parseProductReleaseManifestV1(value: string | unknown, reader: ProductTtrpgProtocol2ReaderV1): ProductReleaseManifestWithTtrpgV2
export function parseProductReleaseManifestV1(value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1): ProductReleaseManifestWithTtrpgV2 {
  const manifest = parseProductReleaseManifestAtVersion(value, 1, reader)
  if (manifest.version !== 1) fail('ProductRelease V1 分派失败')
  return manifest
}

export function parseProductReleaseManifestV2(value: string | unknown): ProductReleaseManifestV2 {
  const manifest = parseProductReleaseManifestAtVersion(value, 2)
  if (manifest.version !== 2) fail('ProductRelease V2 分派失败')
  return manifest
}

export function parseProductReleaseManifest(value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1): AnyProductReleaseManifest {
  return productProtocolVersion(value, 'storyforge.product-release') === 1
    ? (reader ? parseProductReleaseManifestV1(value, reader) : parseProductReleaseManifestV1(value)) : parseProductReleaseManifestV2(value)
}

function parseProductReleaseManifestAtVersion(value: string | unknown, version: 1 | 2, reader?: ProductTtrpgProtocol2ReaderV1): AnyProductReleaseManifest {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('Release v3 不是合法 JSON') }
  }
  const manifest = record(raw, 'release')
  exactKeys(manifest, [
    'schema', 'version', 'productType', 'sourceWorldRelease', 'runtimePackage', 'packageHash',
    'productionProvenance', 'sourceContracts', 'releaseIdentityHash', 'lineage',
  ], 'release')
  if (manifest.schema !== 'storyforge.product-release' || manifest.version !== version) fail('ProductRelease schema/version 无效')
  const selectedProduct = productType(manifest.productType)
  const sourceWorldRelease = record(manifest.sourceWorldRelease, 'sourceWorldRelease')
  exactKeys(sourceWorldRelease, ['contentHash'], 'sourceWorldRelease')
  if (!isSha256Hash(sourceWorldRelease.contentHash)) fail('sourceWorldRelease.contentHash 无效')
  const runtimePackage = version === 1
    ? (reader ? parseProductRuntimePackageV1(manifest.runtimePackage, reader) : parseProductRuntimePackageV1(manifest.runtimePackage))
    : parseProductRuntimePackageV2(manifest.runtimePackage)
  if (runtimePackage.productType !== selectedProduct
    || runtimePackage.sourceWorld.contentHash !== sourceWorldRelease.contentHash) fail('Release v3 与 RuntimePackage 来源不一致')
  if (!isSha256Hash(manifest.packageHash)) fail('packageHash 无效')
  if (!isSha256Hash(manifest.releaseIdentityHash)) fail('releaseIdentityHash 无效')

  const provenance = record(manifest.productionProvenance, 'productionProvenance')
  exactKeys(provenance, [
    'productionKey', 'buildNumber', 'buildManifestHash', 'rootTerminalReceiptHash',
  ], 'productionProvenance')
  if (!isSha256Hash(provenance.buildManifestHash) || !isSha256Hash(provenance.rootTerminalReceiptHash)) {
    fail('productionProvenance hash 无效')
  }
  const productionProvenance: ProductReleaseManifestV1['productionProvenance'] = {
    productionKey: requiredText(provenance.productionKey, 'productionKey', 500),
    buildNumber: integer(provenance.buildNumber, 'buildNumber', 1),
    buildManifestHash: provenance.buildManifestHash,
    rootTerminalReceiptHash: provenance.rootTerminalReceiptHash,
  }
  if (avgExecutableModule(runtimePackage) && runtimePackage.definition.productKey !== productionProvenance.productionKey) fail('AVG Release 产品身份与生产来源不一致')
  const sourceContracts = record(manifest.sourceContracts, 'sourceContracts')
  const creatorSourceContracts = sourceContracts.schema
    === 'storyforge.text-open-world-creator-release-source-contracts'
  if (!creatorSourceContracts) {
    exactKeys(sourceContracts, ['sourcePlan', 'confirmedBrief', 'sourceManifest'], 'sourceContracts')
  }
  const lineage = record(manifest.lineage, 'lineage') as unknown as
    ProductReleaseLineageV1 | TextOpenWorldCreatorReleaseLineageV1
  if (runtimePackage.version === 2) {
    if (creatorSourceContracts || lineage.schema !== 'storyforge.product-release-lineage') {
      fail('V2 只接受共享 WorldRelease 来源合同与 lineage')
    }
    return {
      schema: 'storyforge.product-release', version: 2, productType: 'avg',
      sourceWorldRelease: { contentHash: sourceWorldRelease.contentHash }, runtimePackage,
      packageHash: manifest.packageHash, productionProvenance,
      sourceContracts: {
        sourcePlan: sourceContracts.sourcePlan as ProductSourcePlan,
        confirmedBrief: sourceContracts.confirmedBrief as ConfirmedProductBriefV1,
        sourceManifest: sourceContracts.sourceManifest as ProductSourceManifest,
      },
      releaseIdentityHash: manifest.releaseIdentityHash, lineage,
    }
  }
  return {
    schema: 'storyforge.product-release',
    version: 1,
    productType: selectedProduct,
    sourceWorldRelease: { contentHash: sourceWorldRelease.contentHash },
    runtimePackage,
    packageHash: manifest.packageHash,
    productionProvenance,
    sourceContracts: creatorSourceContracts
      ? structuredClone(sourceContracts) as unknown as TextOpenWorldCreatorReleaseSourceContractsV1
      : {
          sourcePlan: sourceContracts.sourcePlan as ProductSourcePlan,
          confirmedBrief: sourceContracts.confirmedBrief as ConfirmedProductBriefV1,
          sourceManifest: sourceContracts.sourceManifest as ProductSourceManifest,
        },
    releaseIdentityHash: manifest.releaseIdentityHash,
    lineage,
  }
}

type ProductReleaseIdentityBodyV1 = Omit<ProductReleaseManifestWithTtrpgV2, 'releaseIdentityHash' | 'lineage'>

export async function productReleaseIdentityHashV1(body: ProductReleaseIdentityBodyV1): Promise<string> {
  return hashProductProductionValueV2(body)
}

export function verifyProductReleaseManifestV1(value: string | unknown): Promise<ProductReleaseManifestV1>
export function verifyProductReleaseManifestV1(value: string | unknown, reader: ProductTtrpgProtocol2ReaderV1): Promise<ProductReleaseManifestWithTtrpgV2>
export async function verifyProductReleaseManifestV1(value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1): Promise<ProductReleaseManifestWithTtrpgV2> {
  return verifyProductReleaseManifestBindings(reader ? parseProductReleaseManifestV1(value, reader) : parseProductReleaseManifestV1(value))
}

async function verifyProductReleaseManifestBindings<T extends AnyProductReleaseManifest>(manifest: T): Promise<T> {
  if (await hashProductProductionValueV2(manifest.runtimePackage) !== manifest.packageHash) fail('packageHash 校验失败')
  if (manifest.productType === 'ttrpg' && manifest.runtimePackage.ttrpg) {
    await verifyTtrpgFrozenContentHashesV1(manifest.runtimePackage.ttrpg)
  }
  if (isCreatorReleaseSourceContracts(manifest.sourceContracts)) {
    if (manifest.version !== 1) fail('V2 不接受未登记的 Creator 来源合同')
    const { verifyTextOpenWorldCreatorReleaseManifestBindingsV1 } = await import(
      '../open-world/creator-release-contract'
    )
    // The creator contract belongs only to text-open-world. Reparse through the
    // legacy entry before handing it to that product; no open TTRPG cast or bypass.
    await verifyTextOpenWorldCreatorReleaseManifestBindingsV1(parseProductReleaseManifestV1(manifest))
    const { releaseIdentityHash, lineage: _lineage, ...identityBody } = manifest
    const expectedIdentity = await hashProductProductionValueV2(identityBody)
    if (releaseIdentityHash !== expectedIdentity || manifest.lineage.releaseHash !== expectedIdentity) {
      fail('Creator Release identity或lineage hash不一致')
    }
    return manifest
  }
  if (manifest.lineage.schema !== 'storyforge.product-release-lineage') {
    fail('共享WorldRelease来源必须使用共享lineage')
  }
  const sourcePlan = await validateProductSourcePlan(manifest.sourceContracts.sourcePlan)
  const selection = manifest.runtimePackage.sourceWorld.selection
  if (selection.version !== sourcePlan.worldReference.version) fail('产品选择协议与冻结世界引用版本不一致')
  if (sourcePlan.version === 2) {
    const roles = Object.fromEntries(Object.entries(selection.roleBindings).map(([key, values]) => [key, [...values].sort()]))
    if (await hashProductProductionValueV2([...selection.resourceKeys].sort()) !== await hashProductProductionValueV2(sourcePlan.exact.authorResourceKeys)
      || await hashProductProductionValueV2(roles) !== await hashProductProductionValueV2(sourcePlan.configuration.roleBindings)) {
      fail('发布内容的精确选择或角色绑定与冻结计划不一致')
    }
  }
  const confirmedBrief = await validateConfirmedProductBriefV1({
    brief: manifest.sourceContracts.confirmedBrief,
    sourcePlan,
  })
  const sourceManifest = await validateProductSourceManifest({
    sourceManifest: manifest.sourceContracts.sourceManifest,
    sourcePlan,
  })
  const lineage = await validateProductReleaseLineageV1(manifest.lineage)
  const { releaseIdentityHash, lineage: _lineage, ...identityBody } = manifest
  const expectedIdentity = await hashProductProductionValueV2(identityBody)
  if (releaseIdentityHash !== expectedIdentity || lineage.releaseHash !== expectedIdentity
    || lineage.productType !== manifest.productType
    || lineage.productInstanceKey !== sourcePlan.productInstanceKey
    || lineage.worldReferenceHash !== sourcePlan.worldReference.referenceHash
    || lineage.sourcePlanHash !== sourcePlan.planHash
    || lineage.sourceManifestHash !== sourceManifest.manifestHash
    || lineage.confirmedBriefHash !== confirmedBrief.confirmationHash
    || sourcePlan.worldReference.releaseHash !== manifest.sourceWorldRelease.contentHash
    || manifest.productionProvenance.productionKey !== sourcePlan.productInstanceKey
    || manifest.runtimePackage.sourceWorld.selection.worldReferenceHash
      !== sourcePlan.worldReference.referenceHash
    || manifest.runtimePackage.sourceWorld.selection.productType !== manifest.productType) {
    fail('Release v3 来源合同、身份或 lineage 链不一致')
  }
  return manifest
}

/** Identity validation precedes all compatibility or mechanical projection. */
export async function verifyProductReleaseRuntimeViewV1(
  value: string | unknown,
  reader: ProductTtrpgProtocol2ReaderV1,
) {
  const rawManifest = await verifyProductReleaseManifestV1(value, reader)
  const rawRuntimePackage = rawManifest.runtimePackage
  return {
    rawManifest,
    rawRuntimePackage,
    validatedHashes: {
      packageHash: rawManifest.packageHash,
      releaseIdentityHash: rawManifest.releaseIdentityHash,
      ruleContentHash: rawRuntimePackage.ttrpg?.rulePack.contentHash ?? null,
    },
    runtimeView: rawRuntimePackage.ttrpg
      ? await createTtrpgVerifiedContentViewV1(rawRuntimePackage.ttrpg)
      : null,
  }
}

interface ProductReleaseManifestInputV1 {
  runtimePackage: ProductRuntimePackageV1
  productionProvenance: ProductReleaseManifestV1['productionProvenance']
  sourceContracts: {
    sourcePlan: ProductSourcePlan
    confirmedBrief: ConfirmedProductBriefV1
    sourceManifest: ProductSourceManifest
  }
  lineage: ProductReleaseLineageV1
}
type ProductReleaseManifestInputWithTtrpgV2 =
  Omit<ProductReleaseManifestInputV1, 'runtimePackage'> & { runtimePackage: ProductRuntimePackageWithTtrpgV2 }

export function createProductReleaseManifestV1(input: ProductReleaseManifestInputV1): Promise<ProductReleaseManifestV1>
export function createProductReleaseManifestV1(
  input: ProductReleaseManifestInputWithTtrpgV2, reader: ProductTtrpgProtocol2ReaderV1,
): Promise<ProductReleaseManifestWithTtrpgV2>
export async function createProductReleaseManifestV1(
  input: ProductReleaseManifestInputWithTtrpgV2, reader?: ProductTtrpgProtocol2ReaderV1,
): Promise<ProductReleaseManifestWithTtrpgV2> {
  const runtimePackage = reader
    ? parseProductRuntimePackageV1(input.runtimePackage, reader)
    : parseProductRuntimePackageV1(input.runtimePackage)
  const identityBody: ProductReleaseIdentityBodyV1 = {
    schema: 'storyforge.product-release',
    version: 1,
    productType: runtimePackage.productType,
    sourceWorldRelease: { contentHash: runtimePackage.sourceWorld.contentHash },
    runtimePackage,
    packageHash: await hashProductProductionValueV2(runtimePackage),
    productionProvenance: input.productionProvenance,
    sourceContracts: input.sourceContracts,
  }
  const releaseIdentityHash = await productReleaseIdentityHashV1(identityBody)
  if (input.lineage.releaseHash !== releaseIdentityHash) {
    fail('lineage.releaseHash 与 Release identity 不一致')
  }
  const manifest = {
    ...identityBody,
    releaseIdentityHash,
    lineage: input.lineage,
  }
  return reader
    ? verifyProductReleaseManifestV1(manifest, reader)
    : verifyProductReleaseManifestV1(manifest)
}

export async function verifyProductReleaseManifest(value: string | unknown, reader?: ProductTtrpgProtocol2ReaderV1): Promise<AnyProductReleaseManifest> {
  return verifyProductReleaseManifestBindings(parseProductReleaseManifest(value, reader))
}

export async function verifyProductReleaseManifestV2(value: string | unknown): Promise<ProductReleaseManifestV2> {
  return verifyProductReleaseManifestBindings(parseProductReleaseManifestV2(value))
}

export async function productReleaseIdentityHashV2(
  body: Omit<ProductReleaseManifestV2, 'releaseIdentityHash' | 'lineage'>,
): Promise<string> {
  return hashProductProductionValueV2(body)
}

export async function createProductReleaseManifestV2(input: {
  runtimePackage: ProductRuntimePackageV2
  productionProvenance: ProductReleaseManifestV2['productionProvenance']
  sourceContracts: ProductReleaseManifestV2['sourceContracts']
  lineage: ProductReleaseLineageV1
}): Promise<ProductReleaseManifestV2> {
  const runtimePackage = parseProductRuntimePackageV2(input.runtimePackage)
  const identityBody: Omit<ProductReleaseManifestV2, 'releaseIdentityHash' | 'lineage'> = {
    schema: 'storyforge.product-release', version: 2, productType: 'avg',
    sourceWorldRelease: { contentHash: runtimePackage.sourceWorld.contentHash }, runtimePackage,
    packageHash: await hashProductProductionValueV2(runtimePackage),
    productionProvenance: input.productionProvenance, sourceContracts: input.sourceContracts,
  }
  const releaseIdentityHash = await productReleaseIdentityHashV2(identityBody)
  if (input.lineage.releaseHash !== releaseIdentityHash) fail('lineage.releaseHash 与 V2 Release identity 不一致')
  return verifyProductReleaseManifestV2({ ...identityBody, releaseIdentityHash, lineage: input.lineage })
}
