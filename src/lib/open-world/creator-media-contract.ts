import type { ProductMediaKind, ProductTaskBudgetReservationV1 } from '../types'
import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-media] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || expected.some((key, index) => actual[index] !== key)) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string' || !KEY.test(value)) fail(`${label} 无效`)
  return value
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSha256Hash(value)) fail(`${label} 无效`)
  return value
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label} 为空或过长`)
  return normalized
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 整数无效`)
  }
  return Number(value)
}

function amount(value: unknown, label: string, maximum = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    fail(`${label} 数值无效`)
  }
  return value
}

function keys(value: unknown, label: string, maximum = 128): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => key(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`)
  return result
}

export type TextOpenWorldCreatorMediaModeV1 = 'provider-generate' | 'author-import'
export type TextOpenWorldCreatorMediaRightsBasisV1 = 'author-owned' | 'licensed' | 'public-domain'

export interface TextOpenWorldCreatorMediaBuildIdentityV1 {
  buildNumber: number
  stateRevision: number
  controlEpoch: number
  briefRevision: number
  briefHash: string
  planHash: string
  manifestHash: string
  rootTerminalReceiptHash: string
}

export interface TextOpenWorldCreatorMediaSlotV1 {
  artifactKey: string
  slotKey: string
  slotKind: 'character-portrait' | 'scene-background'
  subjectKey: string
  mediaKind: Extract<ProductMediaKind, 'character-pose' | 'background'>
  title: string
  altText: string
  width: number
  height: number
}

export interface TextOpenWorldCreatorImportedMediaV1 {
  artifactKey: string
  slotKey: string
  contentHash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  byteSize: number
  width: number
  height: number
  assetKey: string
  name: string
  altText: string
  source: string
  license: string
  rightsBasis: TextOpenWorldCreatorMediaRightsBasisV1
  rightsNote: string
  commercialUse: true
}

export interface TextOpenWorldCreatorMediaCapabilityV1 {
  requirementKey: string
  adapterId: string
  bindingHash: string
  bindingReceiptHash: string
  execution: 'provider' | 'local-import'
  maximumCostUsd: number
}

export interface TextOpenWorldCreatorMediaPlanV1 {
  schema: 'storyforge.text-open-world-creator-media-plan'
  version: 1
  portable: true
  productType: 'text-open-world'
  productionKey: string
  baseBuild: TextOpenWorldCreatorMediaBuildIdentityV1
  targetBuildNumber: number
  mediaRequirementsHash: string
  mode: TextOpenWorldCreatorMediaModeV1
  slots: TextOpenWorldCreatorMediaSlotV1[]
  imports: TextOpenWorldCreatorImportedMediaV1[]
  capability: TextOpenWorldCreatorMediaCapabilityV1
  targetTaskKeys: ['media.visual']
  staleTaskKeys: string[]
  reuseTaskKeys: string[]
  requiredCoverage: {
    proceduralMapReady: true
    portraitSlotCount: number
    backgroundSlotCount: number
    audioFallback: 'silent'
  }
  estimatedRerunBudget: ProductTaskBudgetReservationV1
  planHash: string
}

export interface TextOpenWorldCreatorMediaAuthorizationV1 {
  schema: 'storyforge.text-open-world-creator-media-authorization'
  version: 1
  portable: true
  plan: TextOpenWorldCreatorMediaPlanV1
  mediaPlanHash: string
  targetProductionPlanHash: string
  expectedStateRevision: number
  authorizationNonceHash: string
  acknowledgement: {
    completeBundle: true
    rightsAndProvenance: true
    costAndProvider: true
    oldBuildImmutable: true
  }
  authorizedAt: number
  authorizationHash: string
}

function parseBuild(value: unknown): TextOpenWorldCreatorMediaBuildIdentityV1 {
  const row = record(value, 'baseBuild')
  exact(row, [
    'buildNumber', 'stateRevision', 'controlEpoch', 'briefRevision', 'briefHash',
    'planHash', 'manifestHash', 'rootTerminalReceiptHash',
  ], 'baseBuild')
  return {
    buildNumber: integer(row.buildNumber, 'baseBuild.buildNumber', 1),
    stateRevision: integer(row.stateRevision, 'baseBuild.stateRevision'),
    controlEpoch: integer(row.controlEpoch, 'baseBuild.controlEpoch'),
    briefRevision: integer(row.briefRevision, 'baseBuild.briefRevision', 1),
    briefHash: hash(row.briefHash, 'baseBuild.briefHash'),
    planHash: hash(row.planHash, 'baseBuild.planHash'),
    manifestHash: hash(row.manifestHash, 'baseBuild.manifestHash'),
    rootTerminalReceiptHash: hash(row.rootTerminalReceiptHash, 'baseBuild.rootTerminalReceiptHash'),
  }
}

function parseSlot(value: unknown, index: number): TextOpenWorldCreatorMediaSlotV1 {
  const row = record(value, `slots[${index}]`)
  exact(row, [
    'artifactKey', 'slotKey', 'slotKind', 'subjectKey', 'mediaKind', 'title',
    'altText', 'width', 'height',
  ], `slots[${index}]`)
  if (row.slotKind !== 'character-portrait' && row.slotKind !== 'scene-background') {
    fail(`slots[${index}].slotKind 无效`)
  }
  const expectedKind = row.slotKind === 'character-portrait' ? 'character-pose' : 'background'
  if (row.mediaKind !== expectedKind) fail(`slots[${index}].mediaKind 与槽位不一致`)
  return {
    artifactKey: key(row.artifactKey, `slots[${index}].artifactKey`),
    slotKey: key(row.slotKey, `slots[${index}].slotKey`),
    slotKind: row.slotKind,
    subjectKey: key(row.subjectKey, `slots[${index}].subjectKey`),
    mediaKind: expectedKind,
    title: text(row.title, `slots[${index}].title`, 500),
    altText: text(row.altText, `slots[${index}].altText`, 1_000),
    width: integer(row.width, `slots[${index}].width`, 1, 32_768),
    height: integer(row.height, `slots[${index}].height`, 1, 32_768),
  }
}

function parseImport(value: unknown, index: number): TextOpenWorldCreatorImportedMediaV1 {
  const row = record(value, `imports[${index}]`)
  exact(row, [
    'artifactKey', 'slotKey', 'contentHash', 'mimeType', 'byteSize', 'width', 'height',
    'assetKey', 'name', 'altText', 'source', 'license', 'rightsBasis', 'rightsNote',
    'commercialUse',
  ], `imports[${index}]`)
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(row.mimeType))) {
    fail(`imports[${index}].mimeType 无效`)
  }
  if (!['author-owned', 'licensed', 'public-domain'].includes(String(row.rightsBasis))) {
    fail(`imports[${index}].rightsBasis 无效`)
  }
  if (row.commercialUse !== true) fail(`imports[${index}] 必须确认可用于当前产品`)
  return {
    artifactKey: key(row.artifactKey, `imports[${index}].artifactKey`),
    slotKey: key(row.slotKey, `imports[${index}].slotKey`),
    contentHash: hash(row.contentHash, `imports[${index}].contentHash`),
    mimeType: row.mimeType as TextOpenWorldCreatorImportedMediaV1['mimeType'],
    byteSize: integer(row.byteSize, `imports[${index}].byteSize`, 4, 100 * 1024 * 1024),
    width: integer(row.width, `imports[${index}].width`, 1, 32_768),
    height: integer(row.height, `imports[${index}].height`, 1, 32_768),
    assetKey: key(row.assetKey, `imports[${index}].assetKey`),
    name: text(row.name, `imports[${index}].name`, 500),
    altText: text(row.altText, `imports[${index}].altText`, 1_000),
    source: text(row.source, `imports[${index}].source`, 1_000),
    license: text(row.license, `imports[${index}].license`, 500),
    rightsBasis: row.rightsBasis as TextOpenWorldCreatorMediaRightsBasisV1,
    rightsNote: text(row.rightsNote, `imports[${index}].rightsNote`, 2_000),
    commercialUse: true,
  }
}

function parseCapability(value: unknown): TextOpenWorldCreatorMediaCapabilityV1 {
  const row = record(value, 'capability')
  exact(row, [
    'requirementKey', 'adapterId', 'bindingHash', 'bindingReceiptHash', 'execution',
    'maximumCostUsd',
  ], 'capability')
  if (row.execution !== 'provider' && row.execution !== 'local-import') {
    fail('capability.execution 无效')
  }
  const maximumCostUsd = amount(row.maximumCostUsd, 'capability.maximumCostUsd')
  if ((row.execution === 'provider') !== (maximumCostUsd > 0)) {
    fail('Provider 生成必须具有正费用上限，本地导入必须为零')
  }
  return {
    requirementKey: key(row.requirementKey, 'capability.requirementKey'),
    adapterId: key(row.adapterId, 'capability.adapterId'),
    bindingHash: hash(row.bindingHash, 'capability.bindingHash'),
    bindingReceiptHash: hash(row.bindingReceiptHash, 'capability.bindingReceiptHash'),
    execution: row.execution,
    maximumCostUsd,
  }
}

function parseBudget(value: unknown): ProductTaskBudgetReservationV1 {
  const row = record(value, 'estimatedRerunBudget')
  exact(row, [
    'modelCalls', 'inputTokens', 'outputTokens', 'mediaCalls', 'maximumCostUsd',
    'durationMs', 'storageBytes',
  ], 'estimatedRerunBudget')
  return {
    modelCalls: integer(row.modelCalls, 'estimatedRerunBudget.modelCalls'),
    inputTokens: integer(row.inputTokens, 'estimatedRerunBudget.inputTokens'),
    outputTokens: integer(row.outputTokens, 'estimatedRerunBudget.outputTokens'),
    mediaCalls: integer(row.mediaCalls, 'estimatedRerunBudget.mediaCalls'),
    maximumCostUsd: row.maximumCostUsd === null
      ? null : amount(row.maximumCostUsd, 'estimatedRerunBudget.maximumCostUsd'),
    durationMs: integer(row.durationMs, 'estimatedRerunBudget.durationMs'),
    storageBytes: integer(row.storageBytes, 'estimatedRerunBudget.storageBytes'),
  }
}

export async function parseTextOpenWorldCreatorMediaPlanV1(
  value: unknown,
): Promise<TextOpenWorldCreatorMediaPlanV1> {
  let source = value
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { fail('mediaPlan 不是合法 JSON') }
  }
  const row = record(source, 'mediaPlan')
  exact(row, [
    'schema', 'version', 'portable', 'productType', 'productionKey', 'baseBuild',
    'targetBuildNumber', 'mediaRequirementsHash', 'mode', 'slots', 'imports',
    'capability', 'targetTaskKeys', 'staleTaskKeys', 'reuseTaskKeys',
    'requiredCoverage', 'estimatedRerunBudget', 'planHash',
  ], 'mediaPlan')
  if (row.schema !== 'storyforge.text-open-world-creator-media-plan' || row.version !== 1
    || row.portable !== true || row.productType !== 'text-open-world'
    || (row.mode !== 'provider-generate' && row.mode !== 'author-import')) {
    fail('mediaPlan 身份或模式无效')
  }
  if (!Array.isArray(row.slots) || row.slots.length < 2 || row.slots.length > 64
    || !Array.isArray(row.imports)) fail('mediaPlan 槽位或导入清单无效')
  const slots = row.slots.map(parseSlot)
  const imports = row.imports.map(parseImport)
  if (new Set(slots.map(slot => slot.artifactKey)).size !== slots.length
    || new Set(slots.map(slot => slot.slotKey)).size !== slots.length) fail('mediaPlan 槽位身份重复')
  const mode = row.mode as TextOpenWorldCreatorMediaModeV1
  if ((mode === 'author-import' && imports.length !== slots.length)
    || (mode === 'provider-generate' && imports.length !== 0)) fail('mediaPlan 模式与导入清单不一致')
  if (mode === 'author-import' && imports.some((item, index) => (
    item.artifactKey !== slots[index]?.artifactKey || item.slotKey !== slots[index]?.slotKey
  ))) fail('导入清单没有逐槽覆盖完整 sibling group')
  const capability = parseCapability(row.capability)
  if ((mode === 'provider-generate') !== (capability.execution === 'provider')) {
    fail('mediaPlan 模式与 capability 不一致')
  }
  const targetTaskKeys = keys(row.targetTaskKeys, 'targetTaskKeys')
  if (targetTaskKeys.length !== 1 || targetTaskKeys[0] !== 'media.visual') {
    fail('mediaPlan 只允许替换完整 media.visual sibling group')
  }
  const staleTaskKeys = keys(row.staleTaskKeys, 'staleTaskKeys')
  const reuseTaskKeys = keys(row.reuseTaskKeys, 'reuseTaskKeys')
  if (!staleTaskKeys.includes('media.visual')
    || staleTaskKeys.some(item => reuseTaskKeys.includes(item))) fail('mediaPlan stale/reuse 分区无效')
  const coverage = record(row.requiredCoverage, 'requiredCoverage')
  exact(coverage, [
    'proceduralMapReady', 'portraitSlotCount', 'backgroundSlotCount', 'audioFallback',
  ], 'requiredCoverage')
  if (coverage.proceduralMapReady !== true || coverage.audioFallback !== 'silent') {
    fail('最低地图或音频降级合同无效')
  }
  const portraitSlotCount = integer(coverage.portraitSlotCount, 'requiredCoverage.portraitSlotCount', 1)
  const backgroundSlotCount = integer(coverage.backgroundSlotCount, 'requiredCoverage.backgroundSlotCount', 1)
  if (portraitSlotCount + backgroundSlotCount !== slots.length
    || slots.filter(slot => slot.slotKind === 'character-portrait').length !== portraitSlotCount
    || slots.filter(slot => slot.slotKind === 'scene-background').length !== backgroundSlotCount) {
    fail('最低头像与背景覆盖计数无效')
  }
  const parsed: TextOpenWorldCreatorMediaPlanV1 = {
    schema: 'storyforge.text-open-world-creator-media-plan',
    version: 1,
    portable: true,
    productType: 'text-open-world',
    productionKey: key(row.productionKey, 'productionKey'),
    baseBuild: parseBuild(row.baseBuild),
    targetBuildNumber: integer(row.targetBuildNumber, 'targetBuildNumber', 2),
    mediaRequirementsHash: hash(row.mediaRequirementsHash, 'mediaRequirementsHash'),
    mode,
    slots,
    imports,
    capability,
    targetTaskKeys: ['media.visual'],
    staleTaskKeys,
    reuseTaskKeys,
    requiredCoverage: {
      proceduralMapReady: true,
      portraitSlotCount,
      backgroundSlotCount,
      audioFallback: 'silent',
    },
    estimatedRerunBudget: parseBudget(row.estimatedRerunBudget),
    planHash: hash(row.planHash, 'planHash'),
  }
  const { planHash, ...body } = parsed
  if (await hashProductProductionValueV2(body) !== planHash) fail('mediaPlan Hash 不匹配')
  if (parsed.targetBuildNumber !== parsed.baseBuild.buildNumber + 1) {
    fail('mediaPlan 目标 Build 必须紧邻基线')
  }
  return parsed
}

export async function parseTextOpenWorldCreatorMediaAuthorizationV1(
  value: unknown,
): Promise<TextOpenWorldCreatorMediaAuthorizationV1> {
  let source = value
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { fail('mediaAuthorization 不是合法 JSON') }
  }
  const row = record(source, 'mediaAuthorization')
  exact(row, [
    'schema', 'version', 'portable', 'plan', 'mediaPlanHash', 'targetProductionPlanHash',
    'expectedStateRevision', 'authorizationNonceHash', 'acknowledgement', 'authorizedAt',
    'authorizationHash',
  ], 'mediaAuthorization')
  if (row.schema !== 'storyforge.text-open-world-creator-media-authorization'
    || row.version !== 1 || row.portable !== true) fail('mediaAuthorization 身份无效')
  const plan = await parseTextOpenWorldCreatorMediaPlanV1(row.plan)
  const acknowledgement = record(row.acknowledgement, 'acknowledgement')
  exact(acknowledgement, [
    'completeBundle', 'rightsAndProvenance', 'costAndProvider', 'oldBuildImmutable',
  ], 'acknowledgement')
  if (Object.values(acknowledgement).some(value => value !== true)) {
    fail('mediaAuthorization 四项确认不完整')
  }
  const parsed: TextOpenWorldCreatorMediaAuthorizationV1 = {
    schema: 'storyforge.text-open-world-creator-media-authorization',
    version: 1,
    portable: true,
    plan,
    mediaPlanHash: hash(row.mediaPlanHash, 'mediaPlanHash'),
    targetProductionPlanHash: hash(row.targetProductionPlanHash, 'targetProductionPlanHash'),
    expectedStateRevision: integer(row.expectedStateRevision, 'expectedStateRevision'),
    authorizationNonceHash: hash(row.authorizationNonceHash, 'authorizationNonceHash'),
    acknowledgement: {
      completeBundle: true,
      rightsAndProvenance: true,
      costAndProvider: true,
      oldBuildImmutable: true,
    },
    authorizedAt: integer(row.authorizedAt, 'authorizedAt', 1),
    authorizationHash: hash(row.authorizationHash, 'authorizationHash'),
  }
  if (parsed.mediaPlanHash !== plan.planHash) fail('mediaAuthorization 未绑定 mediaPlan Hash')
  const { authorizationHash, ...body } = parsed
  if (await hashProductProductionValueV2(body) !== authorizationHash) {
    fail('mediaAuthorization Hash 不匹配')
  }
  return parsed
}
