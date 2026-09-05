import type { TextOpenWorldCalibrationConfigV1 } from '../open-world/product-config'

export const TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1 = [
  'narrative',
  'world',
  'actors',
  'quests',
  'actions',
  'progression',
  'combat',
  'items',
  'crafting',
  'economy',
  'relationships',
  'time-weather',
  'director',
  'knowledge',
  'presentation',
] as const

export type TextOpenWorldRuntimeModuleKeyV1 = typeof TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1[number]

export interface TextOpenWorldRuntimeModuleEnvelopeV1 {
  moduleKey: TextOpenWorldRuntimeModuleKeyV1
  schemaVersion: number
  contentHash: string
  dependencies: TextOpenWorldRuntimeModuleKeyV1[]
  payload: unknown
}

export interface TextOpenWorldRuntimePackageV1 {
  schema: 'storyforge.text-open-world.runtime-package'
  version: 1
  metadata: {
    packageKey: string
    title: string
    description: string
    contentLanguage: string
    rulesetKey: string
    rulesetVersion: number
  }
  sourceManifest: {
    kind: 'world-release' | 'novel-source-pin'
    sourceKey: string
    sourceVersion: number
    contentHash: string
    selectionHash: string
    resourceHashes: Array<{ resourceId: string; contentHash: string }>
  }
  experienceContract: {
    corePromise: string
    coreGoal: string
    freedomBoundary: string
    mainlinePolicy: 'strict-sequence'
    endingCount: number
    requiredPlayMinutes: { minimum: number; maximum: number }
    optionalInventoryMinutes: { minimum: number; maximum: number }
  }
  calibration: TextOpenWorldCalibrationConfigV1
  modules: Record<TextOpenWorldRuntimeModuleKeyV1, TextOpenWorldRuntimeModuleEnvelopeV1>
  mediaManifest: {
    version: 1
    slotKeys: string[]
    requiredSlotKeys: string[]
  }
  qualityManifest: {
    version: 1
    hardGateIds: string[]
    softMetricIds: string[]
    waivedMetricIds: string[]
  }
  compatibility: {
    minimumReaderVersion: number
    compatiblePreviousPackageHashes: string[]
    legacyInputKinds: Array<'open-world-v1' | 'adventure-v1' | 'open-world-evolution-v1'>
    migrationPolicy: 'old-release-pinned'
  }
}
