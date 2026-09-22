import type {
  PlayableTextOpenWorldProductRuntimePackageV1,
  ProductRelease,
} from '../types'
import {
  classifyTextOpenWorldRuntimePackageShapeV1,
  runtimePackagePlayerCharacter,
  type TextOpenWorldRuntimePackageShapeV1,
} from '../product/releases'
import { parseTextOpenWorldModulesV1 } from './modules'

export interface TextOpenWorldReleaseSummaryV1 {
  title: string
  description: string
  protagonistName: string
  protagonistDescription: string
  regionCount: number
  locationCount: number
  questCount: number
  actorCount: number
  shape: TextOpenWorldRuntimePackageShapeV1
  shapeLabel: string
  sourceHash: string
  packageHash: string
  releaseHash: string
}

const SHAPE_LABELS: Record<TextOpenWorldRuntimePackageShapeV1, string> = {
  'vnext-only': 'vNext 原生运行包',
  hybrid: 'vNext / 旧版兼容包',
  'legacy-only': '旧版兼容运行包',
}

interface TextOpenWorldReleaseCatalogItemV1 {
  release: ProductRelease
}

/**
 * One title-card per stable product instance. Imported timestamps and same-name
 * games are not identity: release version is authoritative inside productionKey.
 */
export function currentTextOpenWorldReleasesV1<T extends TextOpenWorldReleaseCatalogItemV1>(
  items: readonly T[],
): T[] {
  const current = new Map<string, T>()
  const isNewerVersion = (left: T, right: T) => left.release.version > right.release.version
    || (left.release.version === right.release.version
      && (left.release.createdAt > right.release.createdAt
        || (left.release.createdAt === right.release.createdAt
          && (left.release.id ?? 0) > (right.release.id ?? 0))))
  for (const item of items) {
    const existing = current.get(item.release.productionKey)
    if (!existing || isNewerVersion(item, existing)) current.set(item.release.productionKey, item)
  }
  return [...current.values()].sort((left, right) => right.release.createdAt - left.release.createdAt
    || (right.release.id ?? 0) - (left.release.id ?? 0))
}

/** Immutable versions belonging to one stable product instance, newest first. */
export function textOpenWorldReleaseVersionsV1<T extends TextOpenWorldReleaseCatalogItemV1>(
  items: readonly T[],
  productionKey: string,
): T[] {
  return items
    .filter(item => item.release.productionKey === productionKey)
    .slice()
    .sort((left, right) => right.release.version - left.release.version
      || right.release.createdAt - left.release.createdAt
      || (right.release.id ?? 0) - (left.release.id ?? 0))
}

/** Player-facing metadata is derived only from the frozen ProductRelease. */
export function summarizeTextOpenWorldReleaseV1(input: {
  release: ProductRelease
  manifest: PlayableTextOpenWorldProductRuntimePackageV1
  packageHash: string
}): TextOpenWorldReleaseSummaryV1 {
  const { release, manifest, packageHash } = input
  const shape = classifyTextOpenWorldRuntimePackageShapeV1(manifest)
  if (manifest.textOpenWorldVNext) {
    const modules = parseTextOpenWorldModulesV1(manifest.textOpenWorldVNext)
    return {
      title: manifest.definition.title || manifest.textOpenWorldVNext.metadata.title,
      description: manifest.definition.description || manifest.textOpenWorldVNext.metadata.description,
      protagonistName: modules.actors.player.identity.name,
      protagonistDescription: modules.actors.player.identity.background,
      regionCount: modules.world.regions.length,
      locationCount: modules.world.locations.length,
      questCount: modules.quests.quests.length,
      actorCount: modules.actors.actors.length,
      shape,
      shapeLabel: SHAPE_LABELS[shape],
      sourceHash: manifest.textOpenWorldVNext.sourceManifest.contentHash,
      packageHash,
      releaseHash: release.contentHash,
    }
  }

  const player = manifest.adventure?.playerIdentity ?? runtimePackagePlayerCharacter(manifest)
  return {
    title: manifest.definition.title || release.label,
    description: manifest.definition.description || '一款可离线运行的文字开放世界游戏。',
    protagonistName: player?.name ?? '玩家角色',
    protagonistDescription: player?.description ?? '由当前发布冻结的主角。',
    regionCount: manifest.openWorld?.regions.length ?? 0,
    locationCount: manifest.adventure?.locations.length
      ?? new Set(manifest.openWorld?.regions.map(region => region.locationKey) ?? []).size,
    questCount: (manifest.openWorld?.fixedTaskCards.length ?? 0)
      + (manifest.openWorld?.taskTemplates.length ?? 0),
    actorCount: manifest.interaction?.profiles.length ?? 0,
    shape,
    shapeLabel: SHAPE_LABELS[shape],
    sourceHash: manifest.sourceWorld.contentHash,
    packageHash,
    releaseHash: release.contentHash,
  }
}
