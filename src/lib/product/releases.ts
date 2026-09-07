import { db } from '../db/schema'
import { hashProductProductionValueV2 } from '../product-production/hash'
import {
  parseProductReleaseManifestV1,
  verifyProductReleaseManifestV1,
} from '../product-production/runtime-package'
import type {
  AdventureProductRuntimePackageV1,
  AvgProductRuntimePackageV1,
  ProductRelease,
  ProductRuntimePackageV1,
  CharacterInteractionProductRuntimePackageV1,
  PlayableTextOpenWorldProductRuntimePackageV1,
  TextOpenWorldProductRuntimePackageV1,
} from '../types'

export interface RuntimePlayerCharacterV2 {
  speakerKey: string
  name: string
  description: string
}

const TEXT_OPEN_WORLD_LEGACY_RUNTIME_KEYS = [
  'interaction', 'adventure', 'openWorldEvolution', 'openWorld',
] as const

export type TextOpenWorldRuntimePackageShapeV1 = 'legacy-only' | 'hybrid' | 'vnext-only'

/** Product-boundary shape guard; callers must not infer vNext-only from a partial legacy closure. */
export function classifyTextOpenWorldRuntimePackageShapeV1(value: unknown): TextOpenWorldRuntimePackageShapeV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[text-open-world] RuntimePackage 无效')
  }
  const runtimePackage = value as Record<string, unknown>
  if (runtimePackage.productType !== 'text-open-world') {
    throw new Error('[text-open-world] 不是文字开放世界 RuntimePackage')
  }
  const legacyPresence = TEXT_OPEN_WORLD_LEGACY_RUNTIME_KEYS
    .filter(key => Object.prototype.hasOwnProperty.call(runtimePackage, key)).length
  if (legacyPresence > 0 && legacyPresence < TEXT_OPEN_WORLD_LEGACY_RUNTIME_KEYS.length) {
    throw new Error('[text-open-world] 旧四运行模块必须完整存在或完整省略')
  }
  const hasVNext = Object.prototype.hasOwnProperty.call(runtimePackage, 'textOpenWorldVNext')
    && runtimePackage.textOpenWorldVNext != null
  if (legacyPresence === 0 && !hasVNext) {
    throw new Error('[text-open-world] RuntimePackage 未提供可玩运行模块')
  }
  if (legacyPresence === 0) return 'vnext-only'
  return hasVNext ? 'hybrid' : 'legacy-only'
}

function preflightTextOpenWorldReleaseShape(value: string): void {
  let candidate: unknown
  try { candidate = JSON.parse(value) } catch { return }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
  const runtimePackage = (candidate as Record<string, unknown>).runtimePackage
  if (!runtimePackage || typeof runtimePackage !== 'object' || Array.isArray(runtimePackage)) return
  if ((runtimePackage as Record<string, unknown>).productType === 'text-open-world') {
    classifyTextOpenWorldRuntimePackageShapeV1(runtimePackage)
  }
}

/** Product-owned display names; runtime never reopens the source WorldRelease. */
export function runtimePackageSpeakerNames(runtimePackage: ProductRuntimePackageV1): Record<string, string> {
  return Object.fromEntries((runtimePackage.interaction?.profiles ?? []).flatMap(profile => [
    [profile.characterKey, profile.name],
    [profile.participantKey, profile.name],
  ]))
}

/** Resolve an unambiguous product-owned protagonist without reading world tables. */
export function runtimePackagePlayerCharacter(runtimePackage: ProductRuntimePackageV1): RuntimePlayerCharacterV2 | null {
  const profiles = runtimePackage.interaction?.profiles ?? []
  const candidates = profiles.filter(profile => /主角|玩家|核心/.test(profile.roleLabel))
  const selected = candidates.length === 1 ? candidates[0] : profiles.length === 1 ? profiles[0] : null
  return selected ? {
    speakerKey: selected.characterKey,
    name: selected.name,
    description: selected.initialKnowledge[0]?.content ?? selected.roleLabel,
  } : null
}

/**
 * Formal runtime release integrity check. The current ProductRelease is self-contained;
 * WorldRelease is lineage evidence and is deliberately not a runtime dependency.
 */
export async function assertProductReleaseUnchanged(productReleaseId: number): Promise<ProductRelease> {
  const release = await db.productReleases.get(productReleaseId)
  if (!release) throw new Error('[product-release] ProductRelease 不存在')
  const manifest = await verifyProductReleaseManifestV1(release.manifestJson)
  if (release.productType !== manifest.productType
    || release.productType !== manifest.runtimePackage.productType) {
    throw new Error('[product-release] 发布根记录与冻结清单的产品身份不一致')
  }
  const contentHash = await hashProductProductionValueV2(manifest)
  if (contentHash !== release.contentHash) throw new Error('[product-release] ProductRelease 已被篡改')
  if (manifest.sourceWorldRelease.contentHash !== manifest.runtimePackage.sourceWorld.contentHash) {
    throw new Error('[product-release] 世界来源谱系证据不一致')
  }
  return release
}

export function parseAnyProductReleaseManifest(value: string): ProductRuntimePackageV1 {
  return parseProductReleaseManifestV1(value).runtimePackage
}

export function parseInteractionProductReleaseManifest(value: string): CharacterInteractionProductRuntimePackageV1 {
  const parsed = parseAnyProductReleaseManifest(value)
  if (parsed.productType !== 'character-interaction' || !parsed.interaction) {
    throw new Error('[character-interaction] 不是当前角色互动 ProductRelease')
  }
  return parsed as CharacterInteractionProductRuntimePackageV1
}

export function parseAdventureProductReleaseManifest(value: string): AdventureProductRuntimePackageV1 {
  const parsed = parseAnyProductReleaseManifest(value)
  if (parsed.productType !== 'text-adventure' || !parsed.interaction || !parsed.adventure) {
    throw new Error('[adventure] 不是当前文字冒险 ProductRelease')
  }
  return parsed as AdventureProductRuntimePackageV1
}

export function parseAdventureCapableProductReleaseManifest(
  value: string,
): AdventureProductRuntimePackageV1 | TextOpenWorldProductRuntimePackageV1 {
  const parsed = parseAnyProductReleaseManifest(value)
  if ((parsed.productType !== 'text-adventure' && parsed.productType !== 'text-open-world')
    || !parsed.interaction || !parsed.adventure) {
    throw new Error('[adventure] 不是含冻结冒险模块的当前 ProductRelease')
  }
  return parsed as AdventureProductRuntimePackageV1 | TextOpenWorldProductRuntimePackageV1
}

export function parseAvgProductReleaseManifest(value: string): AvgProductRuntimePackageV1 {
  const parsed = parseAnyProductReleaseManifest(value)
  if (parsed.productType !== 'avg' || !parsed.presentation) throw new Error('[avg] 不是当前 AVG ProductRelease')
  return parsed as AvgProductRuntimePackageV1
}

export function parseTextOpenWorldProductReleaseManifest(value: string): PlayableTextOpenWorldProductRuntimePackageV1 {
  preflightTextOpenWorldReleaseShape(value)
  const parsed = parseAnyProductReleaseManifest(value)
  if (parsed.productType !== 'text-open-world') {
    throw new Error('[text-open-world] 不是当前文字开放世界 ProductRelease')
  }
  classifyTextOpenWorldRuntimePackageShapeV1(parsed)
  return parsed as PlayableTextOpenWorldProductRuntimePackageV1
}
