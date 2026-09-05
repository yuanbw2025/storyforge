import { canonicalGameProductionJsonV2, isSha256Hash } from '../game-production/hash'
import type {
  TextOpenWorldRuntimeModuleEnvelopeV1,
  TextOpenWorldRuntimeModuleKeyV1,
  TextOpenWorldRuntimePackageV1,
} from '../types/text-open-world-runtime'
import { TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1 } from '../types/text-open-world-runtime'
import { parseTextOpenWorldCalibrationConfigV1 } from './product-config'

type JsonRecord = Record<string, unknown>

const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

function fail(message: string): never {
  throw new Error(`[text-open-world-package] ${message}`)
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as JsonRecord
}

function exact(value: JsonRecord, keys: readonly string[], label: string) {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不符合合同:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function stableKey(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!STABLE_KEY.test(parsed)) fail(`${label} 不是稳定key`)
  return parsed
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 必须是 ${minimum} 到 ${maximum} 的整数`)
  }
  return Number(value)
}

function hash(value: unknown, label: string): string {
  if (!isSha256Hash(value)) fail(`${label} 不是SHA-256`)
  return value
}

function uniqueStrings(value: unknown, label: string, maximum: number, parse: (item: unknown, label: string) => string): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => parse(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label} 不能重复`)
  return result
}

function range(value: unknown, label: string): { minimum: number; maximum: number } {
  const parsed = record(value, label)
  exact(parsed, ['minimum', 'maximum'], label)
  const minimum = integer(parsed.minimum, `${label}.minimum`, 1, 1_000_000)
  const maximum = integer(parsed.maximum, `${label}.maximum`, 1, 1_000_000)
  if (minimum > maximum) fail(`${label} minimum 不能大于 maximum`)
  return { minimum, maximum }
}

function moduleEnvelope(value: unknown, expectedKey: TextOpenWorldRuntimeModuleKeyV1): TextOpenWorldRuntimeModuleEnvelopeV1 {
  const parsed = record(value, `modules.${expectedKey}`)
  exact(parsed, ['moduleKey', 'schemaVersion', 'contentHash', 'dependencies', 'payload'], `modules.${expectedKey}`)
  if (parsed.moduleKey !== expectedKey) fail(`modules.${expectedKey}.moduleKey 不一致`)
  const dependencies = uniqueStrings(
    parsed.dependencies,
    `modules.${expectedKey}.dependencies`,
    TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.length,
    (item, label) => {
      const key = text(item, label, 100) as TextOpenWorldRuntimeModuleKeyV1
      if (!TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.includes(key)) fail(`${label} 模块不存在`)
      return key
    },
  ) as TextOpenWorldRuntimeModuleKeyV1[]
  if (dependencies.includes(expectedKey)) fail(`modules.${expectedKey} 不能依赖自身`)
  canonicalGameProductionJsonV2(parsed.payload)
  return {
    moduleKey: expectedKey,
    schemaVersion: integer(parsed.schemaVersion, `modules.${expectedKey}.schemaVersion`, 1, 1_000),
    contentHash: hash(parsed.contentHash, `modules.${expectedKey}.contentHash`),
    dependencies,
    payload: structuredClone(parsed.payload),
  }
}

function assertAcyclic(modules: TextOpenWorldRuntimePackageV1['modules']) {
  const visiting = new Set<TextOpenWorldRuntimeModuleKeyV1>()
  const visited = new Set<TextOpenWorldRuntimeModuleKeyV1>()
  const visit = (key: TextOpenWorldRuntimeModuleKeyV1) => {
    if (visiting.has(key)) fail(`模块依赖存在环:${[...visiting, key].join('->')}`)
    if (visited.has(key)) return
    visiting.add(key)
    modules[key].dependencies.forEach(visit)
    visiting.delete(key)
    visited.add(key)
  }
  TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.forEach(visit)
}

export function parseTextOpenWorldRuntimePackageV1(value: string | unknown): TextOpenWorldRuntimePackageV1 {
  let raw: unknown = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { fail('不是合法JSON') }
  }
  const root = record(raw, 'package')
  exact(root, ['schema', 'version', 'metadata', 'sourceManifest', 'experienceContract', 'calibration', 'modules', 'mediaManifest', 'qualityManifest', 'compatibility'], 'package')
  if (root.schema !== 'storyforge.text-open-world.runtime-package' || root.version !== 1) fail('schema/version 无效')

  const metadata = record(root.metadata, 'metadata')
  exact(metadata, ['packageKey', 'title', 'description', 'contentLanguage', 'rulesetKey', 'rulesetVersion'], 'metadata')
  const contentLanguage = text(metadata.contentLanguage, 'metadata.contentLanguage', 50)
  if (!LOCALE.test(contentLanguage)) fail('metadata.contentLanguage 不是合法locale')

  const source = record(root.sourceManifest, 'sourceManifest')
  exact(source, ['kind', 'sourceKey', 'sourceVersion', 'contentHash', 'selectionHash', 'resourceHashes'], 'sourceManifest')
  if (source.kind !== 'world-release' && source.kind !== 'novel-source-pin') fail('sourceManifest.kind 无效')
  if (!Array.isArray(source.resourceHashes) || source.resourceHashes.length > 20_000) fail('sourceManifest.resourceHashes 必须是有界数组')
  const resourceHashes = source.resourceHashes.map((value, index) => {
    const item = record(value, `sourceManifest.resourceHashes[${index}]`)
    exact(item, ['resourceId', 'contentHash'], `sourceManifest.resourceHashes[${index}]`)
    return {
      resourceId: text(item.resourceId, `sourceManifest.resourceHashes[${index}].resourceId`, 1_000),
      contentHash: hash(item.contentHash, `sourceManifest.resourceHashes[${index}].contentHash`),
    }
  })
  if (new Set(resourceHashes.map(item => item.resourceId)).size !== resourceHashes.length) fail('sourceManifest.resourceHashes resourceId重复')

  const experience = record(root.experienceContract, 'experienceContract')
  exact(experience, ['corePromise', 'coreGoal', 'freedomBoundary', 'mainlinePolicy', 'endingCount', 'requiredPlayMinutes', 'optionalInventoryMinutes'], 'experienceContract')
  if (experience.mainlinePolicy !== 'strict-sequence') fail('experienceContract.mainlinePolicy 无效')

  const rawModules = record(root.modules, 'modules')
  exact(rawModules, TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1, 'modules')
  const modules = Object.fromEntries(TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.map(key => [
    key,
    moduleEnvelope(rawModules[key], key),
  ])) as unknown as TextOpenWorldRuntimePackageV1['modules']
  assertAcyclic(modules)

  const media = record(root.mediaManifest, 'mediaManifest')
  exact(media, ['version', 'slotKeys', 'requiredSlotKeys'], 'mediaManifest')
  if (media.version !== 1) fail('mediaManifest.version 无效')
  const slotKeys = uniqueStrings(media.slotKeys, 'mediaManifest.slotKeys', 20_000, stableKey)
  const requiredSlotKeys = uniqueStrings(media.requiredSlotKeys, 'mediaManifest.requiredSlotKeys', 20_000, stableKey)
  if (requiredSlotKeys.some(key => !slotKeys.includes(key))) fail('mediaManifest.requiredSlotKeys 必须属于slotKeys')

  const quality = record(root.qualityManifest, 'qualityManifest')
  exact(quality, ['version', 'hardGateIds', 'softMetricIds', 'waivedMetricIds'], 'qualityManifest')
  if (quality.version !== 1) fail('qualityManifest.version 无效')
  const hardGateIds = uniqueStrings(quality.hardGateIds, 'qualityManifest.hardGateIds', 5_000, stableKey)
  const softMetricIds = uniqueStrings(quality.softMetricIds, 'qualityManifest.softMetricIds', 5_000, stableKey)
  const waivedMetricIds = uniqueStrings(quality.waivedMetricIds, 'qualityManifest.waivedMetricIds', 5_000, stableKey)
  if (waivedMetricIds.some(key => !softMetricIds.includes(key))) fail('waivedMetricIds 只能引用softMetricIds')

  const compatibility = record(root.compatibility, 'compatibility')
  exact(compatibility, ['minimumReaderVersion', 'compatiblePreviousPackageHashes', 'legacyInputKinds', 'migrationPolicy'], 'compatibility')
  const compatiblePreviousPackageHashes = uniqueStrings(
    compatibility.compatiblePreviousPackageHashes,
    'compatibility.compatiblePreviousPackageHashes',
    1_000,
    (item, label) => hash(item, label),
  )
  const allowedLegacy = ['open-world-v1', 'adventure-v1', 'narrative-simulation-v1'] as const
  const legacyInputKinds = uniqueStrings(
    compatibility.legacyInputKinds,
    'compatibility.legacyInputKinds',
    allowedLegacy.length,
    (item, label) => {
      const parsed = text(item, label, 100) as typeof allowedLegacy[number]
      if (!allowedLegacy.includes(parsed)) fail(`${label} 无效`)
      return parsed
    },
  ) as TextOpenWorldRuntimePackageV1['compatibility']['legacyInputKinds']
  if (compatibility.migrationPolicy !== 'old-release-pinned') fail('compatibility.migrationPolicy 无效')

  return {
    schema: 'storyforge.text-open-world.runtime-package', version: 1,
    metadata: {
      packageKey: stableKey(metadata.packageKey, 'metadata.packageKey'),
      title: text(metadata.title, 'metadata.title', 2_000),
      description: text(metadata.description, 'metadata.description', 20_000, true),
      contentLanguage,
      rulesetKey: stableKey(metadata.rulesetKey, 'metadata.rulesetKey'),
      rulesetVersion: integer(metadata.rulesetVersion, 'metadata.rulesetVersion', 1, 1_000),
    },
    sourceManifest: {
      kind: source.kind,
      sourceKey: stableKey(source.sourceKey, 'sourceManifest.sourceKey'),
      sourceVersion: integer(source.sourceVersion, 'sourceManifest.sourceVersion', 1, 1_000_000),
      contentHash: hash(source.contentHash, 'sourceManifest.contentHash'),
      selectionHash: hash(source.selectionHash, 'sourceManifest.selectionHash'),
      resourceHashes,
    },
    experienceContract: {
      corePromise: text(experience.corePromise, 'experienceContract.corePromise', 5_000),
      coreGoal: text(experience.coreGoal, 'experienceContract.coreGoal', 5_000),
      freedomBoundary: text(experience.freedomBoundary, 'experienceContract.freedomBoundary', 5_000),
      mainlinePolicy: 'strict-sequence',
      endingCount: integer(experience.endingCount, 'experienceContract.endingCount', 1, 100),
      requiredPlayMinutes: range(experience.requiredPlayMinutes, 'experienceContract.requiredPlayMinutes'),
      optionalInventoryMinutes: range(experience.optionalInventoryMinutes, 'experienceContract.optionalInventoryMinutes'),
    },
    calibration: parseTextOpenWorldCalibrationConfigV1(root.calibration),
    modules,
    mediaManifest: { version: 1, slotKeys, requiredSlotKeys },
    qualityManifest: { version: 1, hardGateIds, softMetricIds, waivedMetricIds },
    compatibility: {
      minimumReaderVersion: integer(compatibility.minimumReaderVersion, 'compatibility.minimumReaderVersion', 1, 1_000),
      compatiblePreviousPackageHashes,
      legacyInputKinds,
      migrationPolicy: 'old-release-pinned',
    },
  }
}
