import { parseAdventureContent } from '../adventure/runtime'
import { parseAvgPresentationContent, validateAvgPresentation } from '../avg/runtime'
import { freezeProductMediaAsset } from './media-contracts'
import { parseOpenWorldEvolutionContent, validateOpenWorldEvolutionContent } from '../open-world/evolution-runtime'
import { parseOpenWorldContent, validateOpenWorldContent } from '../open-world/runtime'
import { validateNarrativeContentGraph } from '../product/narrative-content'
import { parseTtrpgCampaignContentV1 } from '../ttrpg/campaign'
import { parseRulePackV1 } from '../ttrpg/rule-pack'
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
  ProductReleaseLineageV1,
  ProductSourcePlanV1,
  ConfirmedProductBriefV1,
  ProductSourceManifestV1,
  ProductWorldSourceSelectionV1,
} from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import {
  validateConfirmedProductBriefV1,
  validateProductReleaseLineageV1,
  validateProductSourceManifestV1,
  validateProductSourcePlanV1,
} from '../product/source-contracts'

const PRODUCT_TYPES = new Set<ProductionProductKindV1>(PRODUCTION_PRODUCT_KINDS_V1)

const CAPABILITIES: Record<ProductionProductKindV1, string[]> = {
  'character-interaction': ['narrative', 'interaction'],
  'text-adventure': ['narrative', 'interaction', 'adventure'],
  avg: ['narrative', 'presentation'],
  'text-open-world': ['narrative', 'interaction', 'adventure', 'openWorldEvolution', 'open-world'],
  ttrpg: ['narrative', 'ttrpg'],
}

const PRODUCT_MODULE_KEYS: Record<ProductionProductKindV1, string[]> = {
  'character-interaction': ['interaction'],
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

function worldResourceKey(value: unknown, label: string): string {
  const key = requiredText(value, label, 1_000)
  if (!key.startsWith('world-release:') || /\s/.test(key)) fail(`${label} 不是中立世界资源 key`)
  return key
}

function worldResourceKeyArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 20_000) fail(`${label} 必须是有界数组`)
  const keys = value.map((item, index) => worldResourceKey(item, `${label}[${index}]`))
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
  const selection = record(value, 'sourceWorld.selection')
  exactKeys(selection, ['schema', 'version', 'productType', 'worldReferenceHash', 'resourceKeys', 'roleBindings'], 'sourceWorld.selection')
  if (selection.schema !== 'storyforge.product-world-source-selection' || selection.version !== 1) {
    fail('source selection 版本无效')
  }
  const selectedProduct = productType(selection.productType)
  if (!isSha256Hash(selection.worldReferenceHash)) fail('selection.worldReferenceHash 无效')
  const resourceKeys = worldResourceKeyArray(selection.resourceKeys, 'selection.resourceKeys')
  const roleRecord = record(selection.roleBindings, 'selection.roleBindings')
  if (Object.keys(roleRecord).length > 100) fail('selection.roleBindings 数量超限')
  const allowed = new Set(resourceKeys)
  const roleBindings = Object.fromEntries(Object.entries(roleRecord).sort(([left], [right]) => left.localeCompare(right)).map(([role, rawKeys]) => {
    stableKey(role, `selection.roleBindings.${role}`)
    const keys = worldResourceKeyArray(rawKeys, `selection.roleBindings.${role}`)
    if (keys.some(key => !allowed.has(key))) fail(`selection.roleBindings.${role} 超出资源选择`)
    return [role, keys]
  }))
  return {
    schema: 'storyforge.product-world-source-selection',
    version: 1,
    productType: selectedProduct,
    worldReferenceHash: selection.worldReferenceHash,
    resourceKeys,
    roleBindings,
  }
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
  for (const scene of interaction.sceneTemplates) {
    requiredText(scene.sceneKey, 'sceneKey', 500)
    if (!Array.isArray(scene.participantKeys) || scene.participantKeys.some(key => !participants.has(key))) {
      fail(`interaction 场景参与者无效:${scene.sceneKey}`)
    }
  }
  return structuredClone(interaction)
}

export function parseProductRuntimePackageV1(value: string | unknown): ProductRuntimePackageV1 {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('不是合法 JSON') }
  }
  const pkg = record(raw, 'package')
  const selectedProduct = productType(pkg.productType)
  const hasTtrpgPresentation = selectedProduct === 'ttrpg'
    && Object.prototype.hasOwnProperty.call(pkg, 'presentation')
  exactKeys(pkg, [
    'schema', 'version', 'productType', 'definition', 'sourceWorld', 'narrative',
    ...PRODUCT_MODULE_KEYS[selectedProduct],
    ...(hasTtrpgPresentation ? ['presentation'] : []),
  ], 'package')
  if (pkg.schema !== 'storyforge.product-runtime-package' || pkg.version !== 1) fail('schema/version 无效')

  const definition = record(pkg.definition, 'definition')
  exactKeys(definition, [
    'productKey', 'title', 'description', 'enabledCapabilities', 'rulesetVersion', 'initialVariables',
  ], 'definition')
  const enabledCapabilities = stringArray(definition.enabledCapabilities, 'enabledCapabilities', 20)
  const expectedCapabilities = hasTtrpgPresentation
    ? [...CAPABILITIES[selectedProduct], 'presentation'] : CAPABILITIES[selectedProduct]
  if (enabledCapabilities.join(',') !== expectedCapabilities.join(',')) fail('enabledCapabilities 与 productType 不一致')
  const initialVariables = record(definition.initialVariables, 'initialVariables')
  canonicalProductProductionJsonV2(initialVariables)

  const sourceWorld = record(pkg.sourceWorld, 'sourceWorld')
  exactKeys(sourceWorld, ['contentHash', 'selection'], 'sourceWorld')
  if (!isSha256Hash(sourceWorld.contentHash)) fail('sourceWorld.contentHash 无效')
  const selection = parseProductWorldSourceSelectionV1(sourceWorld.selection)
  if (selection.productType !== selectedProduct) {
    fail('source selection 与 package 来源不一致')
  }

  const narrative = parseFrozenNarrative(pkg.narrative)
  const graph = validateNarrativeContentGraph({
    entryNodeKey: narrative.entryNodeKey,
    nodes: narrative.nodes,
    beats: narrative.beats,
    choices: narrative.choices,
  })
  if (!graph.valid) fail(`narrative 图无效:${graph.errors.join('；')}`)

  const parsed: ProductRuntimePackageV1 = {
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

  if (selectedProduct === 'character-interaction' || selectedProduct === 'text-adventure'
    || selectedProduct === 'text-open-world') parsed.interaction = validateInteraction(pkg.interaction)
  if (selectedProduct === 'text-adventure' || selectedProduct === 'text-open-world') {
    parsed.adventure = parseAdventureContent(pkg.adventure as never)
  }
  if (selectedProduct === 'avg' || hasTtrpgPresentation) {
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
  if (selectedProduct === 'text-open-world') {
    const openWorldEvolution = parseOpenWorldEvolutionContent(pkg.openWorldEvolution)
    const report = validateOpenWorldEvolutionContent({
      content: openWorldEvolution,
      narrativeNodeKeys: narrative.nodes.map(node => node.key),
    })
    if (!report.valid) fail(`openWorldEvolution 无效:${report.errors.join('；')}`)
    parsed.openWorldEvolution = openWorldEvolution
  }
  if (selectedProduct === 'text-open-world') {
    const openWorld = parseOpenWorldContent(pkg.openWorld)
    const report = validateOpenWorldContent({
      content: openWorld,
      adventure: parsed.adventure!,
      interactionProfiles: parsed.interaction!.profiles,
      interactionScenes: parsed.interaction!.sceneTemplates,
      openWorldEvolution: parsed.openWorldEvolution!,
      narrativeNodeKeys: narrative.nodes.map(node => node.key),
    })
    if (!report.valid) fail(`openWorld 无效:${report.errors.join('；')}`)
    parsed.openWorld = openWorld
  }
  if (selectedProduct === 'ttrpg') parsed.ttrpg = validateTtrpg(pkg.ttrpg, sourceWorld.contentHash)
  return parsed
}

export function parseProductReleaseManifestV1(value: string | unknown): ProductReleaseManifestV1 {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('Release v3 不是合法 JSON') }
  }
  const manifest = record(raw, 'release')
  exactKeys(manifest, [
    'schema', 'version', 'productType', 'sourceWorldRelease', 'runtimePackage', 'packageHash',
    'productionProvenance', 'sourceContracts', 'releaseIdentityHash', 'lineage',
  ], 'release')
  if (manifest.schema !== 'storyforge.product-release' || manifest.version !== 1) fail('ProductRelease schema/version 无效')
  const selectedProduct = productType(manifest.productType)
  const sourceWorldRelease = record(manifest.sourceWorldRelease, 'sourceWorldRelease')
  exactKeys(sourceWorldRelease, ['contentHash'], 'sourceWorldRelease')
  if (!isSha256Hash(sourceWorldRelease.contentHash)) fail('sourceWorldRelease.contentHash 无效')
  const runtimePackage = parseProductRuntimePackageV1(manifest.runtimePackage)
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
  const sourceContracts = record(manifest.sourceContracts, 'sourceContracts')
  exactKeys(sourceContracts, ['sourcePlan', 'confirmedBrief', 'sourceManifest'], 'sourceContracts')
  const lineage = record(manifest.lineage, 'lineage') as unknown as ProductReleaseLineageV1
  return {
    schema: 'storyforge.product-release',
    version: 1,
    productType: selectedProduct,
    sourceWorldRelease: { contentHash: sourceWorldRelease.contentHash },
    runtimePackage,
    packageHash: manifest.packageHash,
    productionProvenance,
    sourceContracts: {
      sourcePlan: sourceContracts.sourcePlan as ProductSourcePlanV1,
      confirmedBrief: sourceContracts.confirmedBrief as ConfirmedProductBriefV1,
      sourceManifest: sourceContracts.sourceManifest as ProductSourceManifestV1,
    },
    releaseIdentityHash: manifest.releaseIdentityHash,
    lineage,
  }
}

type ProductReleaseIdentityBodyV1 = Omit<ProductReleaseManifestV1, 'releaseIdentityHash' | 'lineage'>

export async function productReleaseIdentityHashV1(body: ProductReleaseIdentityBodyV1): Promise<string> {
  return hashProductProductionValueV2(body)
}

export async function verifyProductReleaseManifestV1(value: string | unknown): Promise<ProductReleaseManifestV1> {
  const manifest = parseProductReleaseManifestV1(value)
  if (await hashProductProductionValueV2(manifest.runtimePackage) !== manifest.packageHash) fail('packageHash 校验失败')
  if (manifest.productType === 'ttrpg' && manifest.runtimePackage.ttrpg
    && await hashProductProductionValueV2(manifest.runtimePackage.ttrpg.rulePack.content)
      !== manifest.runtimePackage.ttrpg.rulePack.contentHash) fail('TTRPG RulePack contentHash 校验失败')
  const sourcePlan = await validateProductSourcePlanV1(manifest.sourceContracts.sourcePlan)
  const confirmedBrief = await validateConfirmedProductBriefV1({
    brief: manifest.sourceContracts.confirmedBrief,
    sourcePlan,
  })
  const sourceManifest = await validateProductSourceManifestV1({
    sourceManifest: manifest.sourceContracts.sourceManifest,
    sourcePlan,
  })
  const lineage = await validateProductReleaseLineageV1(manifest.lineage)
  const { releaseIdentityHash, lineage: _lineage, ...identityBody } = manifest
  const expectedIdentity = await productReleaseIdentityHashV1(identityBody)
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

export async function createProductReleaseManifestV1(input: {
  runtimePackage: ProductRuntimePackageV1
  productionProvenance: ProductReleaseManifestV1['productionProvenance']
  sourceContracts: ProductReleaseManifestV1['sourceContracts']
  lineage: ProductReleaseLineageV1
}): Promise<ProductReleaseManifestV1> {
  const runtimePackage = parseProductRuntimePackageV1(input.runtimePackage)
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
  const manifest = parseProductReleaseManifestV1({
    ...identityBody,
    releaseIdentityHash,
    lineage: input.lineage,
  })
  return verifyProductReleaseManifestV1(manifest)
}
