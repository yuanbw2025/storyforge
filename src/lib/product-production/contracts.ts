import { parseChatAuthoringSettingsV1 } from '../character-interaction/authoring-contract'
import { parseAvgAuthoringSettingsV1 } from '../avg/authoring-contract'
import type {
  ProductConsultationBudgetV1,
  ProductProductionBlockerResolutionV1,
  ProductProductionBriefV3,
  ProductProductionBudgetV3,
  ProductProductionCommandV1,
  ProductProductionCompletionContractV1,
  ProductProductionExternalDataPolicyV1,
  ProductProductionFallbackPolicyV1,
  ProductProductionMediaProfileV1,
  ProductProductionScaleV1,
  ProductEvolutionAffectedLaneV1,
  ProductEvolutionBaseV1,
  ProductEvolutionImpactV1,
  ProductStartingPointV1,
  ProviderCapabilityRequirementV1,
} from '../types'
import { PRODUCT_MEDIA_KINDS, PRODUCT_PRODUCTION_COMMAND_TYPES, PRODUCTION_PRODUCT_KINDS_V1 } from '../types'
import { isSha256Hash, canonicalProductProductionJsonV2 } from './hash'
import { parseProductRuntimePackageV1, parseProductWorldSourceSelectionV1 } from './runtime-package'
import { parseTtrpgProductionBriefV2 } from '../ttrpg/production-brief'
import { parseAiTownProductionBriefV1 } from '../ai-town/contracts'
import { parseTextAdventureProductionBriefV1 } from '../adventure/production-brief'
import {
  parseTextOpenWorldCreatorBriefV1,
  parseTextOpenWorldCreatorSourceLocatorV1,
} from '../open-world/creator-brief-persistence'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[product-production-contract] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys)
  const actual = Object.keys(value)
  const unknown = actual.filter(key => !expected.has(key))
  const missing = keys.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (unknown.length || missing.length) fail(`${label} 字段不精确 unknown=${unknown.join(',')} missing=${missing.join(',')}`)
}

function text(value: unknown, label: string, maximum = 10_000): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label} 为空或过长`)
  return normalized
}

function stableKey(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!STABLE_KEY.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}

function finite(value: unknown, label: string, maximum: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum
    || (integer && !Number.isInteger(value))) fail(`${label} 数值无效`)
  return value
}

function positiveId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) fail(`${label} 必须是正整数`)
  return value
}

function nullableCost(value: unknown, label: string): number | null {
  return value === null ? null : finite(value, label, 1_000_000)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是 boolean`)
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 枚举无效`)
  return value as T
}

function stringArray(value: unknown, label: string, maximumItems = 100, stable = false): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => stable ? stableKey(item, `${label}[${index}]`) : text(item, `${label}[${index}]`, 2000))
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`)
  return result
}

function parseStartingPoint(value: unknown): ProductStartingPointV1 {
  const row = record(value, 'source.startingPoint')
  exactKeys(row, ['kind', 'title', 'summary', 'sourceRefs', 'protagonistRefs', 'openingConflict'], 'source.startingPoint')
  return {
    kind: enumValue(row.kind, ['mainline', 'branch', 'character', 'history', 'custom'], 'startingPoint.kind'),
    title: text(row.title, 'startingPoint.title', 300),
    summary: text(row.summary, 'startingPoint.summary', 4000),
    sourceRefs: stringArray(row.sourceRefs, 'startingPoint.sourceRefs', 100, true),
    protagonistRefs: stringArray(row.protagonistRefs, 'startingPoint.protagonistRefs', 50, true),
    openingConflict: text(row.openingConflict, 'startingPoint.openingConflict', 4000),
  }
}

function parseScale(value: unknown): ProductProductionScaleV1 {
  const row = record(value, 'scale')
  exactKeys(row, ['scope', 'targetPlayMinutes', 'targetWordCount', 'targetEndingCount'], 'scale')
  return {
    scope: enumValue(row.scope, ['scene', 'short-arc', 'chapter', 'multi-chapter', 'campaign'], 'scale.scope'),
    targetPlayMinutes: finite(row.targetPlayMinutes, 'scale.targetPlayMinutes', 100_000, true),
    targetWordCount: finite(row.targetWordCount, 'scale.targetWordCount', 20_000_000, true),
    targetEndingCount: finite(row.targetEndingCount, 'scale.targetEndingCount', 1000, true),
  }
}

function parseMedia(value: unknown): ProductProductionMediaProfileV1 {
  const row = record(value, 'media')
  exactKeys(row, ['visualLevel', 'audioLevel', 'imageCount', 'musicTrackCount', 'sfxCount', 'voiceLineCount', 'requiredMediaKinds'], 'media')
  const requiredMediaKinds = stringArray(row.requiredMediaKinds, 'media.requiredMediaKinds', PRODUCT_MEDIA_KINDS.length) as ProductProductionMediaProfileV1['requiredMediaKinds']
  if (requiredMediaKinds.some(kind => !PRODUCT_MEDIA_KINDS.includes(kind))) fail('media.requiredMediaKinds 枚举无效')
  return {
    visualLevel: enumValue(row.visualLevel, ['none', 'key-scenes', 'illustrated'], 'media.visualLevel'),
    audioLevel: enumValue(row.audioLevel, ['none', 'music-sfx', 'full'], 'media.audioLevel'),
    imageCount: finite(row.imageCount, 'media.imageCount', 10_000, true),
    musicTrackCount: finite(row.musicTrackCount, 'media.musicTrackCount', 1000, true),
    sfxCount: finite(row.sfxCount, 'media.sfxCount', 10_000, true),
    voiceLineCount: finite(row.voiceLineCount, 'media.voiceLineCount', 1_000_000, true),
    requiredMediaKinds,
  }
}

function parseConsultationBudget(value: unknown, label: string): ProductConsultationBudgetV1 {
  const row = record(value, label)
  exactKeys(row, ['maximumModelCalls', 'maximumInputTokens', 'maximumOutputTokens', 'maximumCostUsd'], label)
  return {
    maximumModelCalls: finite(row.maximumModelCalls, `${label}.maximumModelCalls`, 100_000, true),
    maximumInputTokens: finite(row.maximumInputTokens, `${label}.maximumInputTokens`, 1_000_000_000, true),
    maximumOutputTokens: finite(row.maximumOutputTokens, `${label}.maximumOutputTokens`, 1_000_000_000, true),
    maximumCostUsd: nullableCost(row.maximumCostUsd, `${label}.maximumCostUsd`),
  }
}

function parseProductionBudget(value: unknown): ProductProductionBudgetV3 {
  const row = record(value, 'productionBudget')
  exactKeys(row, [
    'maximumModelCalls', 'maximumInputTokens', 'maximumOutputTokens', 'maximumCostUsd',
    'maximumMediaCalls', 'maximumDurationMs', 'maximumStorageBytes',
  ], 'productionBudget')
  return {
    ...parseConsultationBudget({
      maximumModelCalls: row.maximumModelCalls, maximumInputTokens: row.maximumInputTokens,
      maximumOutputTokens: row.maximumOutputTokens, maximumCostUsd: row.maximumCostUsd,
    }, 'productionBudget.base'),
    maximumMediaCalls: finite(row.maximumMediaCalls, 'productionBudget.maximumMediaCalls', 100_000, true),
    maximumDurationMs: finite(row.maximumDurationMs, 'productionBudget.maximumDurationMs', 31_536_000_000, true),
    maximumStorageBytes: finite(row.maximumStorageBytes, 'productionBudget.maximumStorageBytes', 1_000_000_000_000, true),
  }
}

function parseCapability(value: unknown, index: number): ProviderCapabilityRequirementV1 {
  const row = record(value, `capabilityRequirements[${index}]`)
  exactKeys(row, [
    'requirementKey', 'mediaClass', 'operation', 'adapterFamily', 'minimumCapabilityVersion',
    'allowedDataClasses', 'maximumRequestCost', 'maximumTotalCost', 'rightsPolicyVersion',
    'capabilityHash', 'required',
  ], `capabilityRequirements[${index}]`)
  if (!isSha256Hash(row.capabilityHash)) fail(`capabilityRequirements[${index}].capabilityHash 无效`)
  return {
    requirementKey: stableKey(row.requirementKey, `capabilityRequirements[${index}].requirementKey`),
    mediaClass: enumValue(row.mediaClass, ['text', 'image', 'music', 'sfx', 'voice', 'transcode'], `capabilityRequirements[${index}].mediaClass`),
    operation: stableKey(row.operation, `capabilityRequirements[${index}].operation`),
    adapterFamily: stableKey(row.adapterFamily, `capabilityRequirements[${index}].adapterFamily`),
    minimumCapabilityVersion: text(row.minimumCapabilityVersion, `capabilityRequirements[${index}].minimumCapabilityVersion`, 100),
    allowedDataClasses: stringArray(row.allowedDataClasses, `capabilityRequirements[${index}].allowedDataClasses`, 100, true),
    maximumRequestCost: nullableCost(row.maximumRequestCost, `capabilityRequirements[${index}].maximumRequestCost`),
    maximumTotalCost: nullableCost(row.maximumTotalCost, `capabilityRequirements[${index}].maximumTotalCost`),
    rightsPolicyVersion: stableKey(row.rightsPolicyVersion, `capabilityRequirements[${index}].rightsPolicyVersion`),
    capabilityHash: row.capabilityHash,
    required: boolean(row.required, `capabilityRequirements[${index}].required`),
  }
}

function parseExternalDataPolicy(value: unknown): ProductProductionExternalDataPolicyV1 {
  const row = record(value, 'externalDataPolicy')
  exactKeys(row, ['allowedDataClasses', 'forbiddenDataClasses', 'allowReferenceImages', 'allowVoiceScripts'], 'externalDataPolicy')
  const allowedDataClasses = stringArray(row.allowedDataClasses, 'externalDataPolicy.allowedDataClasses', 100, true)
  const forbiddenDataClasses = stringArray(row.forbiddenDataClasses, 'externalDataPolicy.forbiddenDataClasses', 100, true)
  if (allowedDataClasses.some(item => forbiddenDataClasses.includes(item))) fail('externalDataPolicy 允许与禁止类别冲突')
  return {
    allowedDataClasses, forbiddenDataClasses,
    allowReferenceImages: boolean(row.allowReferenceImages, 'externalDataPolicy.allowReferenceImages'),
    allowVoiceScripts: boolean(row.allowVoiceScripts, 'externalDataPolicy.allowVoiceScripts'),
  }
}

function parseFallbackPolicy(value: unknown): ProductProductionFallbackPolicyV1 {
  const row = record(value, 'fallbackPolicy')
  exactKeys(row, ['allowTextOnly', 'allowExistingProjectMedia', 'allowProceduralAudio', 'onRequiredCapabilityMissing'], 'fallbackPolicy')
  return {
    allowTextOnly: boolean(row.allowTextOnly, 'fallbackPolicy.allowTextOnly'),
    allowExistingProjectMedia: boolean(row.allowExistingProjectMedia, 'fallbackPolicy.allowExistingProjectMedia'),
    allowProceduralAudio: boolean(row.allowProceduralAudio, 'fallbackPolicy.allowProceduralAudio'),
    onRequiredCapabilityMissing: enumValue(row.onRequiredCapabilityMissing, ['pause', 'fail'], 'fallbackPolicy.onRequiredCapabilityMissing'),
  }
}

function parseCompletionContract(value: unknown): ProductProductionCompletionContractV1 {
  const row = record(value, 'completionContract')
  exactKeys(row, ['requiresPlayablePreview', 'requiredGateIds', 'minimumMediaCoverage', 'allowSoftWaivers'], 'completionContract')
  return {
    requiresPlayablePreview: boolean(row.requiresPlayablePreview, 'completionContract.requiresPlayablePreview'),
    requiredGateIds: stringArray(row.requiredGateIds, 'completionContract.requiredGateIds', 100, true),
    minimumMediaCoverage: finite(row.minimumMediaCoverage, 'completionContract.minimumMediaCoverage', 1),
    allowSoftWaivers: boolean(row.allowSoftWaivers, 'completionContract.allowSoftWaivers'),
  }
}

function parseEvolutionBase(value: unknown, label: string): ProductEvolutionBaseV1 {
  const base = record(value, label)
  if (base.kind === 'build') {
    exactKeys(base, ['kind', 'buildNumber', 'manifestHash'], label)
    if (!isSha256Hash(base.manifestHash)) fail(`${label}.manifestHash 无效`)
    return { kind: 'build', buildNumber: positiveId(base.buildNumber, `${label}.buildNumber`), manifestHash: base.manifestHash }
  }
  if (base.kind === 'recovery-build') {
    exactKeys(base, ['kind', 'buildNumber', 'briefHash', 'planHash', 'controlEpoch'], label)
    if (!isSha256Hash(base.briefHash) || !isSha256Hash(base.planHash)) fail(`${label} recovery hash 无效`)
    return {
      kind: 'recovery-build',
      buildNumber: positiveId(base.buildNumber, `${label}.buildNumber`),
      briefHash: base.briefHash,
      planHash: base.planHash,
      controlEpoch: finite(base.controlEpoch, `${label}.controlEpoch`, Number.MAX_SAFE_INTEGER, true),
    }
  }
  exactKeys(base, ['kind', 'productReleaseId', 'contentHash'], label)
  if (base.kind !== 'release' || !isSha256Hash(base.contentHash)) fail(`${label} release 无效`)
  return { kind: 'release', productReleaseId: positiveId(base.productReleaseId, `${label}.productReleaseId`), contentHash: base.contentHash }
}

const EVOLUTION_LANES: readonly ProductEvolutionAffectedLaneV1[] = [
  'content', 'product', 'visual', 'audio', 'runtime', 'world-source', 'production-budget', 'execution-plan',
]

function parseEvolutionImpact(value: unknown): ProductEvolutionImpactV1 {
  const row = record(value, 'evolution')
  exactKeys(row, ['schema', 'version', 'base', 'userGoal', 'affectedLanes'], 'evolution')
  if (row.schema !== 'storyforge.product-evolution-impact' || row.version !== 1) fail('evolution schema/version 无效')
  const affectedLanes = stringArray(row.affectedLanes, 'evolution.affectedLanes', EVOLUTION_LANES.length, true)
    .map((lane, index) => enumValue(lane, EVOLUTION_LANES, `evolution.affectedLanes[${index}]`))
  if (!affectedLanes.length) fail('evolution.affectedLanes 不能为空')
  return {
    schema: 'storyforge.product-evolution-impact', version: 1,
    base: parseEvolutionBase(row.base, 'evolution.base'),
    userGoal: text(row.userGoal, 'evolution.userGoal', 2000), affectedLanes,
  }
}

export function parseProductProductionBriefV3(value: unknown): ProductProductionBriefV3 {
  let candidate = value
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) } catch { fail('brief 不是合法 JSON') }
  }
  const row = record(candidate, 'brief')
  exactKeys(row, [
    'schema', 'version', 'source', 'intent', 'scale', 'media', 'consultationBudget',
    'productionBudget', 'qualityProfile', 'capabilityRequirements', 'externalDataPolicy',
    'fallbackPolicy', 'completionContract', 'unresolvedDecisionKeys',
    ...(Object.prototype.hasOwnProperty.call(row, 'characterChat') ? ['characterChat'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'avg') ? ['avg'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'avgRevision') ? ['avgRevision'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'ttrpg') ? ['ttrpg'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'aiTown') ? ['aiTown'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'textAdventure') ? ['textAdventure'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'authorConfirmations') ? ['authorConfirmations'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'evolution') ? ['evolution'] : []),
  ], 'brief')
  if (row.schema !== 'storyforge.product-production-brief' || row.version !== 3) fail('brief schema/version 无效')
  const source = record(row.source, 'source')
  exactKeys(source, ['worldReleaseId', 'worldContentHash', 'selection', 'startingPoint'], 'source')
  if (!isSha256Hash(source.worldContentHash)) fail('source.worldContentHash 无效')
  const selection = parseProductWorldSourceSelectionV1(source.selection)

  const intent = record(row.intent, 'intent')
  exactKeys(intent, [
    'productType', 'playerRole', 'protagonistRefs', 'openingSituation', 'coreExperience',
    'requiredFacts', 'forbiddenChanges', 'contentBoundaries', 'tone',
  ], 'intent')
  const productType = enumValue(intent.productType, PRODUCTION_PRODUCT_KINDS_V1, 'intent.productType')
  if (productType !== selection.productType) fail('intent.productType 与 selection 不一致')
  if (!Array.isArray(row.capabilityRequirements) || row.capabilityRequirements.length > 100) fail('capabilityRequirements 必须是有界数组')
  const capabilityRequirements = row.capabilityRequirements.map(parseCapability)
  if (new Set(capabilityRequirements.map(item => item.requirementKey)).size !== capabilityRequirements.length) fail('capability requirementKey 重复')

  if (row.characterChat && productType !== 'character-interaction') fail('角色聊天设置不能用于其他产品')
  if (row.avg && productType !== 'avg') fail('AVG 设置只能用于 AVG')
  let avgRevision: ProductProductionBriefV3['avgRevision']
  if (row.avgRevision != null) {
    const revision = record(row.avgRevision, 'avgRevision')
    exactKeys(revision, ['version','basePackageHash','runtimePackage'], 'avgRevision')
    if (productType !== 'avg' || revision.version !== 1 || !isSha256Hash(revision.basePackageHash)) fail('AVG 修订身份无效')
    const runtimePackage = parseProductRuntimePackageV1(revision.runtimePackage)
    if (runtimePackage.productType !== 'avg' || runtimePackage.sourceWorld.contentHash !== source.worldContentHash || canonicalProductProductionJsonV2(runtimePackage.sourceWorld.selection)!==canonicalProductProductionJsonV2(selection)) fail('AVG 修订不得替换冻结来源')
    avgRevision = { version: 1, basePackageHash: revision.basePackageHash, runtimePackage }
  }
  const parsed: ProductProductionBriefV3 = {
    ...(avgRevision ? { avgRevision } : {}),
    ...(row.characterChat ? { characterChat: parseChatAuthoringSettingsV1(row.characterChat) } : {}),
    ...(row.avg ? { avg: parseAvgAuthoringSettingsV1(row.avg) } : {}),
    schema: 'storyforge.product-production-brief', version: 3,
    source: {
      worldReleaseId: positiveId(source.worldReleaseId, 'source.worldReleaseId'),
      worldContentHash: source.worldContentHash,
      selection,
      startingPoint: parseStartingPoint(source.startingPoint),
    },
    intent: {
      productType,
      playerRole: text(intent.playerRole, 'intent.playerRole', 1000),
      protagonistRefs: stringArray(intent.protagonistRefs, 'intent.protagonistRefs', 50, true),
      openingSituation: text(intent.openingSituation, 'intent.openingSituation', 5000),
      coreExperience: stringArray(intent.coreExperience, 'intent.coreExperience', 50),
      requiredFacts: stringArray(intent.requiredFacts, 'intent.requiredFacts', 200),
      forbiddenChanges: stringArray(intent.forbiddenChanges, 'intent.forbiddenChanges', 200),
      contentBoundaries: stringArray(intent.contentBoundaries, 'intent.contentBoundaries', 200),
      tone: stringArray(intent.tone, 'intent.tone', 50),
    },
    scale: parseScale(row.scale), media: parseMedia(row.media),
    consultationBudget: parseConsultationBudget(row.consultationBudget, 'consultationBudget'),
    productionBudget: parseProductionBudget(row.productionBudget),
    qualityProfile: enumValue(row.qualityProfile, ['prototype', 'internal', 'commercial-candidate'], 'qualityProfile'),
    capabilityRequirements, externalDataPolicy: parseExternalDataPolicy(row.externalDataPolicy),
    fallbackPolicy: parseFallbackPolicy(row.fallbackPolicy),
    completionContract: parseCompletionContract(row.completionContract),
    unresolvedDecisionKeys: stringArray(row.unresolvedDecisionKeys, 'unresolvedDecisionKeys', 100, true),
    ...(Object.prototype.hasOwnProperty.call(row, 'ttrpg')
      ? { ttrpg: parseTtrpgProductionBriefV2(row.ttrpg) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(row, 'aiTown')
      ? { aiTown: parseAiTownProductionBriefV1(row.aiTown) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(row, 'textAdventure')
      ? { textAdventure: parseTextAdventureProductionBriefV1(row.textAdventure) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(row, 'authorConfirmations')
      ? { authorConfirmations: (() => {
        const confirmations = record(row.authorConfirmations, 'authorConfirmations')
        exactKeys(confirmations, ['ttrpgDefaultRuleMappings'], 'authorConfirmations')
        return {
          ttrpgDefaultRuleMappings: boolean(
            confirmations.ttrpgDefaultRuleMappings,
            'authorConfirmations.ttrpgDefaultRuleMappings',
          ),
        }
      })() }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(row, 'evolution')
      ? { evolution: parseEvolutionImpact(row.evolution) }
      : {}),
  }
  if (parsed.intent.protagonistRefs.some(ref => !parsed.source.startingPoint.protagonistRefs.includes(ref))) {
    fail('intent.protagonistRefs 必须来自 startingPoint 候选')
  }
  if ((parsed.intent.productType === 'ttrpg') !== (parsed.ttrpg != null)) {
    fail('ttrpg 产品与 TtrpgProductionBriefV2 不闭合')
  }
  if ((parsed.intent.productType === 'ai-town') !== (parsed.aiTown != null)) {
    fail('ai-town 产品与 AiTownProductionBriefV1 不闭合')
  }
  if (parsed.aiTown) {
    const townSource = parsed.aiTown.sourceSelection
    if (townSource.worldReleaseId !== parsed.source.worldReleaseId
      || townSource.worldContentHash !== parsed.source.worldContentHash
      || townSource.worldReferenceHash !== parsed.source.selection.worldReferenceHash) {
      fail('AI 小镇专属来源与产品冻结来源不一致')
    }
    const selected = new Set(parsed.source.selection.resourceKeys)
    const relationKeys = new Set(townSource.relationSubgraphResourceKeys)
    const explicitKeys = [
      ...townSource.endingResourceKeys, ...townSource.residentResourceKeys,
      ...townSource.locationResourceKeys, ...townSource.ruleAndLoreResourceKeys,
      ...townSource.artifactResourceKeys,
    ]
    if (explicitKeys.some(key => !selected.has(key))) fail('AI 小镇显式来源超出产品冻结选择')
    if ([...selected].some(key => !townSource.dependencyClosureResourceKeys.includes(key))
      || townSource.dependencyClosureResourceKeys.some(key => !selected.has(key) && !relationKeys.has(key))) {
      fail('AI 小镇来源闭包与产品冻结选择/关系子图不一致')
    }
    if (!parsed.aiTown.authorConfirmed && !parsed.unresolvedDecisionKeys.includes('ai-town-author-confirmation')) {
      fail('AI 小镇未确认状态必须登记 unresolved decision')
    }
  }
  if ((parsed.intent.productType === 'text-adventure') !== (parsed.textAdventure != null)) {
    fail('text-adventure 产品与 TextAdventureProductionBriefV1 不闭合')
  }
  if (parsed.textAdventure) {
    if (parsed.scale.targetPlayMinutes > 120 || ['multi-chapter', 'campaign'].includes(parsed.scale.scope)) {
      fail('文字冒险第一阶段只允许 15–120 分钟的有限篇幅')
    }
    if (parsed.textAdventure.narrative.targetEndingCount !== parsed.scale.targetEndingCount) {
      fail('文字冒险结局目标与通用规模不一致')
    }
    const confirmationUnresolved = parsed.unresolvedDecisionKeys.includes('text-adventure-boundary-confirmation')
    if (confirmationUnresolved === Object.values(parsed.textAdventure.confirmations).every(Boolean)) {
      fail('文字冒险边界确认状态与 unresolvedDecisionKeys 不一致')
    }
  }
  if (parsed.ttrpg) {
    if (parsed.ttrpg.campaignDesign.sourceWorldContentHash !== parsed.source.worldContentHash) {
      fail('TTRPG 战役提案来源与冻结 WorldRelease 不一致')
    }
    const proposalDecisionUnresolved = parsed.unresolvedDecisionKeys.includes('ttrpg-campaign-proposal-selection')
    if (proposalDecisionUnresolved === parsed.ttrpg.campaignDesign.selection.confirmed) {
      fail('TTRPG 战役提案确认状态与 unresolvedDecisionKeys 不一致')
    }
    const allowedCharacters = new Set(parsed.source.selection.roleBindings.participants ?? [])
    if (parsed.ttrpg.table.seats.some(seat => seat.sourceCharacterResourceKey != null
      && !allowedCharacters.has(seat.sourceCharacterResourceKey))) {
      fail('TTRPG 席位引用了未进入冻结选择的世界角色')
    }
    if (parsed.authorConfirmations?.ttrpgDefaultRuleMappings !== parsed.ttrpg.confirmations.numericMappings) {
      fail('数值映射确认与 TTRPG Brief 不一致')
    }
  }
  return parsed
}

function commandHeader(row: Record<string, unknown>, type: ProductProductionCommandV1['type'], keys: string[]): string {
  exactKeys(row, ['type', 'commandId', ...keys], `command.${type}`)
  if (row.type !== type) fail(`command type 应为 ${type}`)
  return stableKey(row.commandId, 'command.commandId')
}

function expectedRevision(value: unknown): number {
  return finite(value, 'command.expectedStateRevision', Number.MAX_SAFE_INTEGER, true)
}

function parseResolution(value: unknown): ProductProductionBlockerResolutionV1 {
  const row = record(value, 'resolution')
  const hasUnknownReservation = Object.prototype.hasOwnProperty.call(row, 'unknownResultReservation')
  exactKeys(row, [
    'action', 'note',
    ...(row.action === 'author-edit' ? ['authorDraftJson'] : []),
    ...(hasUnknownReservation ? ['unknownResultReservation'] : []),
  ], 'resolution')
  if (row.action === 'author-edit') record(JSON.parse(text(row.authorDraftJson, 'resolution.authorDraftJson', 120000)), 'authorDraft')
  const unknownResultReservation = hasUnknownReservation
    ? (() => {
        const reservation = record(row.unknownResultReservation, 'resolution.unknownResultReservation')
        exactKeys(reservation, ['runId', 'attempt', 'controlEpoch', 'disposition'], 'resolution.unknownResultReservation')
        return {
          runId: positiveId(reservation.runId, 'resolution.unknownResultReservation.runId'),
          attempt: positiveId(reservation.attempt, 'resolution.unknownResultReservation.attempt'),
          controlEpoch: finite(reservation.controlEpoch, 'resolution.unknownResultReservation.controlEpoch', Number.MAX_SAFE_INTEGER, true),
          disposition: enumValue(reservation.disposition, [
            'confirmed-not-charged', 'charge-reservation-upper-bound',
          ], 'resolution.unknownResultReservation.disposition'),
        }
      })()
    : undefined
  return {
    action: enumValue(row.action, [
      'retry', 'author-edit', 'fallback', 'waive-soft-gate', 'change-capability',
      'accept-product-private-expansion', 'confirm-character-anchors', 'cancel',
    ], 'resolution.action'),
    note: text(row.note, 'resolution.note', 4000),
    ...(row.action === 'author-edit' ? { authorDraftJson: text(row.authorDraftJson, 'resolution.authorDraftJson', 120000) } : {}),
    ...(unknownResultReservation ? { unknownResultReservation } : {}),
  }
}

export function parseProductProductionCommandV1(value: unknown): ProductProductionCommandV1 {
  const row = record(value, 'command')
  const type = enumValue(row.type, PRODUCT_PRODUCTION_COMMAND_TYPES, 'command.type')
  if (type === 'create-intent') return {
    type, commandId: commandHeader(row, type, ['productionKey', 'productType', 'worldReleaseId', 'userText']),
    productionKey: stableKey(row.productionKey, 'productionKey'), worldReleaseId: positiveId(row.worldReleaseId, 'worldReleaseId'),
    productType: enumValue(row.productType, PRODUCTION_PRODUCT_KINDS_V1, 'productType'),
    userText: text(row.userText, 'userText', 20_000),
  }
  if (type === 'create-text-open-world-intent') {
    const commandId = commandHeader(row, type, [
      'productionKey', 'productType', 'sourceLocator', 'expectedSourceBindingHash', 'userText',
    ])
    if (row.productType !== 'text-open-world' || !isSha256Hash(row.expectedSourceBindingHash)) {
      fail('文字开放世界 intent 的产品身份或来源 Hash 无效')
    }
    return {
      type,
      commandId,
      productionKey: stableKey(row.productionKey, 'productionKey'),
      productType: 'text-open-world',
      sourceLocator: parseTextOpenWorldCreatorSourceLocatorV1(row.sourceLocator),
      expectedSourceBindingHash: row.expectedSourceBindingHash,
      userText: text(row.userText, 'userText', 20_000),
    }
  }
  if (type === 'save-brief-revision') return {
    type, commandId: commandHeader(row, type, ['expectedStateRevision', 'parentRevision', 'brief']),
    expectedStateRevision: expectedRevision(row.expectedStateRevision),
    parentRevision: row.parentRevision === null ? null : finite(row.parentRevision, 'parentRevision', Number.MAX_SAFE_INTEGER, true),
    brief: parseProductProductionBriefV3(row.brief),
  }
  if (type === 'save-text-open-world-creator-brief') return {
    type,
    commandId: commandHeader(row, type, [
      'expectedStateRevision', 'parentRevision', 'sourceLocator', 'candidateRunId', 'brief',
    ]),
    expectedStateRevision: expectedRevision(row.expectedStateRevision),
    parentRevision: row.parentRevision === null
      ? null
      : finite(row.parentRevision, 'parentRevision', Number.MAX_SAFE_INTEGER, true),
    sourceLocator: parseTextOpenWorldCreatorSourceLocatorV1(row.sourceLocator),
    candidateRunId: positiveId(row.candidateRunId, 'candidateRunId'),
    brief: parseTextOpenWorldCreatorBriefV1(row.brief),
  }
  if (type === 'authorize-start') {
    const commandId = commandHeader(row, type, ['expectedStateRevision', 'briefRevision', 'briefHash', 'authorizationNonce'])
    if (!isSha256Hash(row.briefHash)) fail('briefHash 无效')
    return { type, commandId, expectedStateRevision: expectedRevision(row.expectedStateRevision), briefRevision: positiveId(row.briefRevision, 'briefRevision'), briefHash: row.briefHash, authorizationNonce: stableKey(row.authorizationNonce, 'authorizationNonce') }
  }
  if (type === 'authorize-text-open-world-creator-start') {
    const commandId = commandHeader(row, type, [
      'expectedStateRevision', 'briefRevision', 'briefHash', 'sourceLocator', 'preflight',
      'confirmation', 'rightsBasis', 'rightsNote', 'authorizationNonce', 'expectedPlanHash',
      'authorizedAt',
    ])
    if (!isSha256Hash(row.briefHash) || !isSha256Hash(row.expectedPlanHash)) {
      fail('Creator start 的 briefHash/expectedPlanHash 无效')
    }
    if (!['author-owned', 'licensed', 'public-domain'].includes(String(row.rightsBasis))) {
      fail('Creator start 的 rightsBasis 无效')
    }
    if (typeof row.rightsNote !== 'string' || !row.rightsNote.trim()
      || row.rightsNote.trim().length > 2_000) {
      fail('Creator start 的 rightsNote 无效')
    }
    record(row.preflight, 'command.preflight')
    record(row.confirmation, 'command.confirmation')
    return {
      type,
      commandId,
      expectedStateRevision: expectedRevision(row.expectedStateRevision),
      briefRevision: positiveId(row.briefRevision, 'briefRevision'),
      briefHash: row.briefHash,
      sourceLocator: parseTextOpenWorldCreatorSourceLocatorV1(row.sourceLocator),
      preflight: structuredClone(row.preflight) as Extract<
        ProductProductionCommandV1,
        { type: 'authorize-text-open-world-creator-start' }
      >['preflight'],
      confirmation: structuredClone(row.confirmation) as Extract<
        ProductProductionCommandV1,
        { type: 'authorize-text-open-world-creator-start' }
      >['confirmation'],
      rightsBasis: row.rightsBasis as 'author-owned' | 'licensed' | 'public-domain',
      rightsNote: row.rightsNote.trim().normalize('NFC'),
      authorizationNonce: stableKey(row.authorizationNonce, 'authorizationNonce'),
      expectedPlanHash: row.expectedPlanHash,
      authorizedAt: finite(row.authorizedAt, 'authorizedAt', Number.MAX_SAFE_INTEGER, true),
    }
  }
  if (type === 'authorize-text-open-world-creator-repair') {
    const commandId = commandHeader(row, type, [
      'expectedStateRevision', 'baseBuildNumber', 'expectedBasePlanHash',
      'expectedHandoffSetHash', 'expectedImpactPlanHash', 'expectedTargetPlanHash',
      'authorizationNonce', 'authorizedAt',
    ])
    for (const key of [
      'expectedBasePlanHash', 'expectedHandoffSetHash',
      'expectedImpactPlanHash', 'expectedTargetPlanHash',
    ] as const) {
      if (!isSha256Hash(row[key])) fail(`Creator repair 的 ${key} 无效`)
    }
    return {
      type,
      commandId,
      expectedStateRevision: expectedRevision(row.expectedStateRevision),
      baseBuildNumber: positiveId(row.baseBuildNumber, 'baseBuildNumber'),
      expectedBasePlanHash: row.expectedBasePlanHash as string,
      expectedHandoffSetHash: row.expectedHandoffSetHash as string,
      expectedImpactPlanHash: row.expectedImpactPlanHash as string,
      expectedTargetPlanHash: row.expectedTargetPlanHash as string,
      authorizationNonce: stableKey(row.authorizationNonce, 'authorizationNonce'),
      authorizedAt: finite(row.authorizedAt, 'authorizedAt', Number.MAX_SAFE_INTEGER, true),
    }
  }
  if (type === 'authorize-text-open-world-creator-media') {
    const commandId = commandHeader(row, type, [
      'expectedStateRevision', 'baseBuildNumber', 'expectedBasePlanHash',
      'expectedMediaPlanHash', 'expectedTargetPlanHash', 'mode',
      'acknowledgement', 'authorizationNonce', 'authorizedAt',
    ])
    for (const key of [
      'expectedBasePlanHash', 'expectedMediaPlanHash', 'expectedTargetPlanHash',
    ] as const) {
      if (!isSha256Hash(row[key])) fail(`Creator media 的 ${key} 无效`)
    }
    if (row.mode !== 'provider-generate' && row.mode !== 'author-import') {
      fail('Creator media 的 mode 无效')
    }
    const acknowledgement = record(row.acknowledgement, 'command.acknowledgement')
    exactKeys(acknowledgement, [
      'completeBundle', 'rightsAndProvenance', 'costAndProvider', 'oldBuildImmutable',
    ], 'command.acknowledgement')
    if (Object.values(acknowledgement).some(value => value !== true)) {
      fail('Creator media 的四项作者确认不完整')
    }
    return {
      type,
      commandId,
      expectedStateRevision: expectedRevision(row.expectedStateRevision),
      baseBuildNumber: positiveId(row.baseBuildNumber, 'baseBuildNumber'),
      expectedBasePlanHash: row.expectedBasePlanHash as string,
      expectedMediaPlanHash: row.expectedMediaPlanHash as string,
      expectedTargetPlanHash: row.expectedTargetPlanHash as string,
      mode: row.mode,
      acknowledgement: {
        completeBundle: true,
        rightsAndProvenance: true,
        costAndProvider: true,
        oldBuildImmutable: true,
      },
      authorizationNonce: stableKey(row.authorizationNonce, 'authorizationNonce'),
      authorizedAt: finite(row.authorizedAt, 'authorizedAt', Number.MAX_SAFE_INTEGER, true),
    }
  }
  if (type === 'pause') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'reason']), expectedStateRevision: expectedRevision(row.expectedStateRevision), reason: text(row.reason, 'reason', 4000) }
  if (type === 'resume') {
    const hasPausedReservations = Object.prototype.hasOwnProperty.call(row, 'pausedReservationDispositions')
    const commandId = commandHeader(row, type, [
      'expectedStateRevision',
      ...(hasPausedReservations ? ['pausedReservationDispositions'] : []),
    ])
    const pausedReservationDispositions = hasPausedReservations
      ? (() => {
          if (!Array.isArray(row.pausedReservationDispositions)
            || row.pausedReservationDispositions.length < 1
            || row.pausedReservationDispositions.length > 64) {
            fail('resume.pausedReservationDispositions 必须是 1～64 项数组')
          }
          const seen = new Set<string>()
          return row.pausedReservationDispositions.map((value, index) => {
            const reservation = record(value, `resume.pausedReservationDispositions[${index}]`)
            exactKeys(reservation, [
              'taskKey', 'runId', 'attempt', 'controlEpoch', 'disposition',
            ], `resume.pausedReservationDispositions[${index}]`)
            const parsed = {
              taskKey: stableKey(reservation.taskKey, `resume.pausedReservationDispositions[${index}].taskKey`),
              runId: positiveId(reservation.runId, `resume.pausedReservationDispositions[${index}].runId`),
              attempt: positiveId(reservation.attempt, `resume.pausedReservationDispositions[${index}].attempt`),
              controlEpoch: finite(
                reservation.controlEpoch,
                `resume.pausedReservationDispositions[${index}].controlEpoch`,
                Number.MAX_SAFE_INTEGER,
                true,
              ),
              disposition: enumValue(reservation.disposition, [
                'confirmed-not-charged', 'charge-reservation-upper-bound',
              ], `resume.pausedReservationDispositions[${index}].disposition`),
            }
            const identity = `${parsed.runId}:${parsed.attempt}`
            if (seen.has(identity)) fail('resume.pausedReservationDispositions 存在重复 attempt')
            seen.add(identity)
            return parsed
          })
        })()
      : undefined
    return {
      type,
      commandId,
      expectedStateRevision: expectedRevision(row.expectedStateRevision),
      ...(pausedReservationDispositions ? { pausedReservationDispositions } : {}),
    }
  }
  if (type === 'stop') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'retention']), expectedStateRevision: expectedRevision(row.expectedStateRevision), retention: enumValue(row.retention, ['keep-build', 'discard-unreleased'], 'retention') }
  if (type === 'archive') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'reason']), expectedStateRevision: expectedRevision(row.expectedStateRevision), reason: text(row.reason, 'reason', 4000) }
  if (type === 'restore') return { type, commandId: commandHeader(row, type, ['expectedStateRevision']), expectedStateRevision: expectedRevision(row.expectedStateRevision) }
  if (type === 'resolve-blocker') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'blockerKey', 'resolution']), expectedStateRevision: expectedRevision(row.expectedStateRevision), blockerKey: stableKey(row.blockerKey, 'blockerKey'), resolution: parseResolution(row.resolution) }
  if (type === 'request-preview') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'buildNumber']), expectedStateRevision: expectedRevision(row.expectedStateRevision), buildNumber: positiveId(row.buildNumber, 'buildNumber') }
  if (type === 'revise-media-asset') {
    const commandId = commandHeader(row, type, [
      'expectedStateRevision', 'buildNumber', 'artifactKey', 'expectedArtifactHash', 'action',
      ...(Object.prototype.hasOwnProperty.call(row, 'repairFeedback') ? ['repairFeedback'] : []), 'replacement',
    ])
    if (!isSha256Hash(row.expectedArtifactHash)) fail('expectedArtifactHash 无效')
    const action = enumValue(row.action, ['upload-replacement', 'regenerate', 'lock', 'unlock'], 'action')
    let repairFeedback: Extract<ProductProductionCommandV1, { type: 'revise-media-asset' }>['repairFeedback'] = null
    if (row.repairFeedback != null) {
      const item = record(row.repairFeedback, 'repairFeedback')
      exactKeys(item, [
        'sourceGateReceiptHash', 'sourceEvidenceHash', 'priorContentHash', 'note',
      ], 'repairFeedback')
      if (!isSha256Hash(item.sourceGateReceiptHash) || !isSha256Hash(item.sourceEvidenceHash)
        || !isSha256Hash(item.priorContentHash)) fail('repairFeedback hash 无效')
      repairFeedback = {
        sourceGateReceiptHash: item.sourceGateReceiptHash,
        sourceEvidenceHash: item.sourceEvidenceHash,
        priorContentHash: item.priorContentHash,
        note: text(item.note, 'repairFeedback.note', 2_000),
      }
    }
    let replacement: Extract<ProductProductionCommandV1, { type: 'revise-media-asset' }>['replacement'] = null
    if (row.replacement != null) {
      const item = record(row.replacement, 'replacement')
      exactKeys(item, [
        'blobObjectId', 'contentHash', 'mimeType', 'byteSize', 'width', 'height', 'altText',
        'license', 'commercialUse', 'redistribution', 'declaration', 'attribution',
      ], 'replacement')
      if (!isSha256Hash(item.contentHash)) fail('replacement.contentHash 无效')
      if (typeof item.commercialUse !== 'boolean' || typeof item.redistribution !== 'boolean') {
        fail('replacement 权利布尔值无效')
      }
      const byteSize = finite(item.byteSize, 'replacement.byteSize', 100 * 1024 * 1024, true)
      const width = finite(item.width, 'replacement.width', 10_000, true)
      const height = finite(item.height, 'replacement.height', 10_000, true)
      if (byteSize < 1 || width < 1 || height < 1) fail('replacement 大小与尺寸必须为正整数')
      replacement = {
        blobObjectId: positiveId(item.blobObjectId, 'replacement.blobObjectId'),
        contentHash: item.contentHash,
        mimeType: enumValue(item.mimeType, ['image/png', 'image/jpeg', 'image/webp'], 'replacement.mimeType'),
        byteSize, width, height,
        altText: text(item.altText, 'replacement.altText', 1_000),
        license: text(item.license, 'replacement.license', 500),
        commercialUse: item.commercialUse,
        redistribution: item.redistribution,
        declaration: text(item.declaration, 'replacement.declaration', 4_000),
        attribution: text(item.attribution, 'replacement.attribution', 1_000),
      }
    }
    if ((action === 'upload-replacement') !== (replacement != null)) {
      fail('仅 upload-replacement 必须携带 replacement')
    }
    if ((action === 'regenerate') !== (repairFeedback != null)) {
      fail('仅 regenerate 必须携带已冻结的作者退回证据')
    }
    return {
      type, commandId, expectedStateRevision: expectedRevision(row.expectedStateRevision),
      buildNumber: positiveId(row.buildNumber, 'buildNumber'),
      artifactKey: stableKey(row.artifactKey, 'artifactKey'),
      expectedArtifactHash: row.expectedArtifactHash,
      action, repairFeedback, replacement,
    }
  }
  if (type === 'revise-media-assets') {
    const commandId = commandHeader(row, type, [
      'expectedStateRevision', 'buildNumber', 'action', 'targets',
    ])
    if (row.action !== 'regenerate' || !Array.isArray(row.targets)
      || row.targets.length < 1 || row.targets.length > 24) {
      fail('批量媒资修订只允许 1–24 个 regenerate 目标')
    }
    const targets = row.targets.map((value, index) => {
      const target = record(value, `targets[${index}]`)
      exactKeys(target, ['artifactKey', 'expectedArtifactHash'], `targets[${index}]`)
      if (!isSha256Hash(target.expectedArtifactHash)) fail(`targets[${index}].expectedArtifactHash 无效`)
      return {
        artifactKey: stableKey(target.artifactKey, `targets[${index}].artifactKey`),
        expectedArtifactHash: target.expectedArtifactHash,
      }
    })
    if (new Set(targets.map(target => target.artifactKey)).size !== targets.length) {
      fail('批量媒资修订目标重复')
    }
    return {
      type, commandId, expectedStateRevision: expectedRevision(row.expectedStateRevision),
      buildNumber: positiveId(row.buildNumber, 'buildNumber'), action: 'regenerate', targets,
    }
  }
  if (type === 'publish') {
    const creatorReleaseAuthorizationHash = row.creatorReleaseAuthorizationHash == null
      ? undefined
      : row.creatorReleaseAuthorizationHash
    const commandId = commandHeader(row, type, [
      'expectedStateRevision', 'buildNumber', 'expectedManifestHash', 'adoptionIntentHash',
      ...(creatorReleaseAuthorizationHash == null ? [] : ['creatorReleaseAuthorizationHash']),
    ])
    if (!isSha256Hash(row.expectedManifestHash) || !isSha256Hash(row.adoptionIntentHash)) fail('publish hash 无效')
    if (creatorReleaseAuthorizationHash != null && !isSha256Hash(creatorReleaseAuthorizationHash)) {
      fail('creatorReleaseAuthorizationHash 无效')
    }
    return {
      type, commandId, expectedStateRevision: expectedRevision(row.expectedStateRevision),
      buildNumber: positiveId(row.buildNumber, 'buildNumber'),
      expectedManifestHash: row.expectedManifestHash, adoptionIntentHash: row.adoptionIntentHash,
      ...(creatorReleaseAuthorizationHash == null ? {} : { creatorReleaseAuthorizationHash }),
    }
  }
  const commandId = commandHeader(row, type, ['expectedStateRevision', 'base', 'userText', 'affectedLanes'])
  const affectedLanes = stringArray(row.affectedLanes, 'affectedLanes', EVOLUTION_LANES.length, true)
    .map((lane, index) => enumValue(lane, EVOLUTION_LANES, `affectedLanes[${index}]`))
  if (!affectedLanes.length) fail('affectedLanes 不能为空')
  return {
    type, commandId, expectedStateRevision: expectedRevision(row.expectedStateRevision),
    base: parseEvolutionBase(row.base, 'base'), userText: text(row.userText, 'userText', 20_000),
    affectedLanes,
  }
}
