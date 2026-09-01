import type {
  GameConsultationBudgetV1,
  GameProductionBlockerResolutionV1,
  GameProductionBriefV3,
  GameProductionBudgetV3,
  GameProductionCommandV1,
  GameProductionCompletionContractV1,
  GameProductionExternalDataPolicyV1,
  GameProductionFallbackPolicyV1,
  GameProductionMediaProfileV1,
  GameProductionScaleV1,
  GameEvolutionAffectedLaneV1,
  GameEvolutionBaseV1,
  GameEvolutionImpactV1,
  GameStartingPointV1,
  ProviderCapabilityRequirementV1,
} from '../types'
import { PRODUCT_MEDIA_KINDS, GAME_PRODUCTION_COMMAND_TYPES } from '../types'
import { isSha256Hash } from './hash'
import { parseProductWorldSourceSelectionV1 } from './runtime-package'
import { parseTtrpgProductionBriefV2 } from '../ttrpg/production-brief'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[game-production-contract] ${message}`)
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

function parseStartingPoint(value: unknown): GameStartingPointV1 {
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

function parseScale(value: unknown): GameProductionScaleV1 {
  const row = record(value, 'scale')
  exactKeys(row, ['scope', 'targetPlayMinutes', 'targetWordCount', 'targetEndingCount'], 'scale')
  return {
    scope: enumValue(row.scope, ['scene', 'short-arc', 'chapter', 'multi-chapter', 'campaign'], 'scale.scope'),
    targetPlayMinutes: finite(row.targetPlayMinutes, 'scale.targetPlayMinutes', 100_000, true),
    targetWordCount: finite(row.targetWordCount, 'scale.targetWordCount', 20_000_000, true),
    targetEndingCount: finite(row.targetEndingCount, 'scale.targetEndingCount', 1000, true),
  }
}

function parseMedia(value: unknown): GameProductionMediaProfileV1 {
  const row = record(value, 'media')
  exactKeys(row, ['visualLevel', 'audioLevel', 'imageCount', 'musicTrackCount', 'sfxCount', 'voiceLineCount', 'requiredMediaKinds'], 'media')
  const requiredMediaKinds = stringArray(row.requiredMediaKinds, 'media.requiredMediaKinds', PRODUCT_MEDIA_KINDS.length) as GameProductionMediaProfileV1['requiredMediaKinds']
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

function parseConsultationBudget(value: unknown, label: string): GameConsultationBudgetV1 {
  const row = record(value, label)
  exactKeys(row, ['maximumModelCalls', 'maximumInputTokens', 'maximumOutputTokens', 'maximumCostUsd'], label)
  return {
    maximumModelCalls: finite(row.maximumModelCalls, `${label}.maximumModelCalls`, 100_000, true),
    maximumInputTokens: finite(row.maximumInputTokens, `${label}.maximumInputTokens`, 1_000_000_000, true),
    maximumOutputTokens: finite(row.maximumOutputTokens, `${label}.maximumOutputTokens`, 1_000_000_000, true),
    maximumCostUsd: nullableCost(row.maximumCostUsd, `${label}.maximumCostUsd`),
  }
}

function parseProductionBudget(value: unknown): GameProductionBudgetV3 {
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

function parseExternalDataPolicy(value: unknown): GameProductionExternalDataPolicyV1 {
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

function parseFallbackPolicy(value: unknown): GameProductionFallbackPolicyV1 {
  const row = record(value, 'fallbackPolicy')
  exactKeys(row, ['allowTextOnly', 'allowExistingProjectMedia', 'allowProceduralAudio', 'onRequiredCapabilityMissing'], 'fallbackPolicy')
  return {
    allowTextOnly: boolean(row.allowTextOnly, 'fallbackPolicy.allowTextOnly'),
    allowExistingProjectMedia: boolean(row.allowExistingProjectMedia, 'fallbackPolicy.allowExistingProjectMedia'),
    allowProceduralAudio: boolean(row.allowProceduralAudio, 'fallbackPolicy.allowProceduralAudio'),
    onRequiredCapabilityMissing: enumValue(row.onRequiredCapabilityMissing, ['pause', 'fail'], 'fallbackPolicy.onRequiredCapabilityMissing'),
  }
}

function parseCompletionContract(value: unknown): GameProductionCompletionContractV1 {
  const row = record(value, 'completionContract')
  exactKeys(row, ['requiresPlayablePreview', 'requiredGateIds', 'minimumMediaCoverage', 'allowSoftWaivers'], 'completionContract')
  return {
    requiresPlayablePreview: boolean(row.requiresPlayablePreview, 'completionContract.requiresPlayablePreview'),
    requiredGateIds: stringArray(row.requiredGateIds, 'completionContract.requiredGateIds', 100, true),
    minimumMediaCoverage: finite(row.minimumMediaCoverage, 'completionContract.minimumMediaCoverage', 1),
    allowSoftWaivers: boolean(row.allowSoftWaivers, 'completionContract.allowSoftWaivers'),
  }
}

function parseEvolutionBase(value: unknown, label: string): GameEvolutionBaseV1 {
  const base = record(value, label)
  if (base.kind === 'build') {
    exactKeys(base, ['kind', 'buildNumber', 'manifestHash'], label)
    if (!isSha256Hash(base.manifestHash)) fail(`${label}.manifestHash 无效`)
    return { kind: 'build', buildNumber: positiveId(base.buildNumber, `${label}.buildNumber`), manifestHash: base.manifestHash }
  }
  exactKeys(base, ['kind', 'gameReleaseId', 'contentHash'], label)
  if (base.kind !== 'release' || !isSha256Hash(base.contentHash)) fail(`${label} release 无效`)
  return { kind: 'release', gameReleaseId: positiveId(base.gameReleaseId, `${label}.gameReleaseId`), contentHash: base.contentHash }
}

const EVOLUTION_LANES: readonly GameEvolutionAffectedLaneV1[] = [
  'content', 'product', 'visual', 'audio', 'world-source',
]

function parseEvolutionImpact(value: unknown): GameEvolutionImpactV1 {
  const row = record(value, 'evolution')
  exactKeys(row, ['schema', 'version', 'base', 'userGoal', 'affectedLanes'], 'evolution')
  if (row.schema !== 'storyforge.game-evolution-impact' || row.version !== 1) fail('evolution schema/version 无效')
  const affectedLanes = stringArray(row.affectedLanes, 'evolution.affectedLanes', EVOLUTION_LANES.length, true)
    .map((lane, index) => enumValue(lane, EVOLUTION_LANES, `evolution.affectedLanes[${index}]`))
  if (!affectedLanes.length) fail('evolution.affectedLanes 不能为空')
  return {
    schema: 'storyforge.game-evolution-impact', version: 1,
    base: parseEvolutionBase(row.base, 'evolution.base'),
    userGoal: text(row.userGoal, 'evolution.userGoal', 2000), affectedLanes,
  }
}

export function parseGameProductionBriefV3(value: unknown): GameProductionBriefV3 {
  let candidate = value
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate) } catch { fail('brief 不是合法 JSON') }
  }
  const row = record(candidate, 'brief')
  exactKeys(row, [
    'schema', 'version', 'source', 'intent', 'scale', 'media', 'consultationBudget',
    'productionBudget', 'qualityProfile', 'capabilityRequirements', 'externalDataPolicy',
    'fallbackPolicy', 'completionContract', 'unresolvedDecisionKeys',
    ...(Object.prototype.hasOwnProperty.call(row, 'ttrpg') ? ['ttrpg'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'authorConfirmations') ? ['authorConfirmations'] : []),
    ...(Object.prototype.hasOwnProperty.call(row, 'evolution') ? ['evolution'] : []),
  ], 'brief')
  if (row.schema !== 'storyforge.game-production-brief' || row.version !== 3) fail('brief schema/version 无效')
  const source = record(row.source, 'source')
  exactKeys(source, ['worldReleaseId', 'worldContentHash', 'selection', 'startingPoint'], 'source')
  if (!isSha256Hash(source.worldContentHash)) fail('source.worldContentHash 无效')
  const selection = parseProductWorldSourceSelectionV1(source.selection)

  const intent = record(row.intent, 'intent')
  exactKeys(intent, [
    'productType', 'playerRole', 'protagonistRefs', 'openingSituation', 'coreExperience',
    'requiredFacts', 'forbiddenChanges', 'contentBoundaries', 'tone',
  ], 'intent')
  const productType = enumValue(intent.productType, [
    'storygame', 'character-interaction', 'text-adventure', 'avg',
    'narrative-simulation', 'text-open-world', 'ttrpg',
  ], 'intent.productType')
  if (productType !== selection.productType) fail('intent.productType 与 selection 不一致')
  if (!Array.isArray(row.capabilityRequirements) || row.capabilityRequirements.length > 100) fail('capabilityRequirements 必须是有界数组')
  const capabilityRequirements = row.capabilityRequirements.map(parseCapability)
  if (new Set(capabilityRequirements.map(item => item.requirementKey)).size !== capabilityRequirements.length) fail('capability requirementKey 重复')

  const parsed: GameProductionBriefV3 = {
    schema: 'storyforge.game-production-brief', version: 3,
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
  if (parsed.ttrpg) {
    if (parsed.ttrpg.campaignDesign
      && parsed.ttrpg.campaignDesign.sourceWorldContentHash !== parsed.source.worldContentHash) {
      fail('TTRPG 战役提案来源与冻结 WorldRelease 不一致')
    }
    const proposalDecisionUnresolved = parsed.unresolvedDecisionKeys.includes('ttrpg-campaign-proposal-selection')
    if (parsed.ttrpg.campaignDesign
      && proposalDecisionUnresolved === parsed.ttrpg.campaignDesign.selection.confirmed) {
      fail('TTRPG 战役提案确认状态与 unresolvedDecisionKeys 不一致')
    }
    const allowedCharacters = new Set(parsed.source.selection.roleBindings.participants ?? [])
    if (parsed.ttrpg.table.seats.some(seat => seat.sourceCharacterResourceKey != null
      && !allowedCharacters.has(seat.sourceCharacterResourceKey))) {
      fail('TTRPG 席位引用了未进入冻结选择的世界角色')
    }
    if (parsed.authorConfirmations?.ttrpgDefaultRuleMappings !== parsed.ttrpg.confirmations.numericMappings) {
      fail('旧版数值映射确认与 TTRPG Brief 不一致')
    }
  }
  return parsed
}

function commandHeader(row: Record<string, unknown>, type: GameProductionCommandV1['type'], keys: string[]): string {
  exactKeys(row, ['type', 'commandId', ...keys], `command.${type}`)
  if (row.type !== type) fail(`command type 应为 ${type}`)
  return stableKey(row.commandId, 'command.commandId')
}

function expectedRevision(value: unknown): number {
  return finite(value, 'command.expectedStateRevision', Number.MAX_SAFE_INTEGER, true)
}

function parseResolution(value: unknown): GameProductionBlockerResolutionV1 {
  const row = record(value, 'resolution')
  exactKeys(row, ['action', 'note'], 'resolution')
  return {
    action: enumValue(row.action, ['retry', 'fallback', 'waive-soft-gate', 'change-capability', 'cancel'], 'resolution.action'),
    note: text(row.note, 'resolution.note', 4000),
  }
}

export function parseGameProductionCommandV1(value: unknown): GameProductionCommandV1 {
  const row = record(value, 'command')
  const type = enumValue(row.type, GAME_PRODUCTION_COMMAND_TYPES, 'command.type')
  if (type === 'create-intent') return {
    type, commandId: commandHeader(row, type, ['productionKey', 'worldReleaseId', 'userText']),
    productionKey: stableKey(row.productionKey, 'productionKey'), worldReleaseId: positiveId(row.worldReleaseId, 'worldReleaseId'),
    userText: text(row.userText, 'userText', 20_000),
  }
  if (type === 'save-brief-revision') return {
    type, commandId: commandHeader(row, type, ['expectedStateRevision', 'parentRevision', 'brief']),
    expectedStateRevision: expectedRevision(row.expectedStateRevision),
    parentRevision: row.parentRevision === null ? null : finite(row.parentRevision, 'parentRevision', Number.MAX_SAFE_INTEGER, true),
    brief: parseGameProductionBriefV3(row.brief),
  }
  if (type === 'authorize-start') {
    const commandId = commandHeader(row, type, ['expectedStateRevision', 'briefRevision', 'briefHash', 'authorizationNonce'])
    if (!isSha256Hash(row.briefHash)) fail('briefHash 无效')
    return { type, commandId, expectedStateRevision: expectedRevision(row.expectedStateRevision), briefRevision: positiveId(row.briefRevision, 'briefRevision'), briefHash: row.briefHash, authorizationNonce: stableKey(row.authorizationNonce, 'authorizationNonce') }
  }
  if (type === 'pause') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'reason']), expectedStateRevision: expectedRevision(row.expectedStateRevision), reason: text(row.reason, 'reason', 4000) }
  if (type === 'resume') return { type, commandId: commandHeader(row, type, ['expectedStateRevision']), expectedStateRevision: expectedRevision(row.expectedStateRevision) }
  if (type === 'stop') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'retention']), expectedStateRevision: expectedRevision(row.expectedStateRevision), retention: enumValue(row.retention, ['keep-build', 'discard-unreleased'], 'retention') }
  if (type === 'archive') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'reason']), expectedStateRevision: expectedRevision(row.expectedStateRevision), reason: text(row.reason, 'reason', 4000) }
  if (type === 'restore') return { type, commandId: commandHeader(row, type, ['expectedStateRevision']), expectedStateRevision: expectedRevision(row.expectedStateRevision) }
  if (type === 'resolve-blocker') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'blockerKey', 'resolution']), expectedStateRevision: expectedRevision(row.expectedStateRevision), blockerKey: stableKey(row.blockerKey, 'blockerKey'), resolution: parseResolution(row.resolution) }
  if (type === 'request-preview') return { type, commandId: commandHeader(row, type, ['expectedStateRevision', 'buildNumber']), expectedStateRevision: expectedRevision(row.expectedStateRevision), buildNumber: positiveId(row.buildNumber, 'buildNumber') }
  if (type === 'publish') {
    const commandId = commandHeader(row, type, ['expectedStateRevision', 'buildNumber', 'expectedManifestHash', 'adoptionIntentHash'])
    if (!isSha256Hash(row.expectedManifestHash) || !isSha256Hash(row.adoptionIntentHash)) fail('publish hash 无效')
    return { type, commandId, expectedStateRevision: expectedRevision(row.expectedStateRevision), buildNumber: positiveId(row.buildNumber, 'buildNumber'), expectedManifestHash: row.expectedManifestHash, adoptionIntentHash: row.adoptionIntentHash }
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
