import { db } from '../db/schema'
import { hashGameProductionValueV2 } from '../game-production/hash'
import {
  parseGameReleaseManifestV3,
  verifyGameReleaseManifestV3,
} from '../game-production/runtime-package'
import type {
  AdventureGameRuntimePackageV2,
  AvgGameRuntimePackageV2,
  GameRelease,
  GameRuntimePackageV2,
  InteractionGameRuntimePackageV2,
  NarrativeSimulationGameRuntimePackageV2,
  StoryGameRuntimePackageV2,
  TextOpenWorldGameRuntimePackageV2,
} from '../types'

export interface RuntimePlayerCharacterV2 {
  speakerKey: string
  name: string
  description: string
}

/** Product-owned display names; runtime never reopens the source WorldRelease. */
export function runtimePackageSpeakerNames(runtimePackage: GameRuntimePackageV2): Record<string, string> {
  return Object.fromEntries((runtimePackage.interaction?.profiles ?? []).flatMap(profile => [
    [profile.characterKey, profile.name],
    [profile.participantKey, profile.name],
  ]))
}

/** Resolve an unambiguous product-owned protagonist without reading world tables. */
export function runtimePackagePlayerCharacter(runtimePackage: GameRuntimePackageV2): RuntimePlayerCharacterV2 | null {
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
 * Formal runtime release integrity check. GameRelease v3 is self-contained;
 * WorldRelease is lineage evidence and is deliberately not a runtime dependency.
 */
export async function assertGameReleaseUnchanged(gameReleaseId: number): Promise<GameRelease> {
  const release = await db.gameReleases.get(gameReleaseId)
  if (!release) throw new Error('[game-release] GameRelease 不存在')
  const manifest = await verifyGameReleaseManifestV3(release.manifestJson)
  const contentHash = await hashGameProductionValueV2(manifest)
  if (contentHash !== release.contentHash) throw new Error('[game-release] GameRelease 已被篡改')
  if (manifest.sourceWorldRelease.contentHash !== manifest.runtimePackage.sourceWorld.contentHash) {
    throw new Error('[game-release] 世界来源谱系证据不一致')
  }
  return release
}

export function parseAnyGameReleaseManifest(value: string): GameRuntimePackageV2 {
  return parseGameReleaseManifestV3(value).runtimePackage
}

export function parseGameReleaseManifest(value: string): StoryGameRuntimePackageV2 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'storygame') throw new Error('[storygame] 不是分支叙事 GameRelease v3')
  return parsed as StoryGameRuntimePackageV2
}

export function parseInteractionGameReleaseManifest(value: string): InteractionGameRuntimePackageV2 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'character-interaction' || !parsed.interaction) {
    throw new Error('[chatgame] 不是角色互动 GameRelease v3')
  }
  return parsed as InteractionGameRuntimePackageV2
}

export function parseAdventureGameReleaseManifest(value: string): AdventureGameRuntimePackageV2 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'text-adventure' || !parsed.interaction || !parsed.adventure) {
    throw new Error('[adventure] 不是文字冒险 GameRelease v3')
  }
  return parsed as AdventureGameRuntimePackageV2
}

export function parseAdventureCapableGameReleaseManifest(
  value: string,
): AdventureGameRuntimePackageV2 | TextOpenWorldGameRuntimePackageV2 {
  const parsed = parseAnyGameReleaseManifest(value)
  if ((parsed.productType !== 'text-adventure' && parsed.productType !== 'text-open-world')
    || !parsed.interaction || !parsed.adventure) {
    throw new Error('[adventure] 不是含冻结冒险模块的 GameRelease v3')
  }
  return parsed as AdventureGameRuntimePackageV2 | TextOpenWorldGameRuntimePackageV2
}

export function parseAvgGameReleaseManifest(value: string): AvgGameRuntimePackageV2 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'avg' || !parsed.presentation) throw new Error('[avg] 不是 AVG GameRelease v3')
  return parsed as AvgGameRuntimePackageV2
}

export function parseNarrativeSimulationGameReleaseManifest(value: string): NarrativeSimulationGameRuntimePackageV2 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'narrative-simulation' || !parsed.simulation) {
    throw new Error('[textsim] 不是叙事模拟 GameRelease v3')
  }
  return parsed as NarrativeSimulationGameRuntimePackageV2
}

export function parseSimulationCapableGameReleaseManifest(
  value: string,
): NarrativeSimulationGameRuntimePackageV2 | TextOpenWorldGameRuntimePackageV2 {
  const parsed = parseAnyGameReleaseManifest(value)
  if ((parsed.productType !== 'narrative-simulation' && parsed.productType !== 'text-open-world')
    || !parsed.simulation) {
    throw new Error('[textsim] 不是含冻结模拟模块的 GameRelease v3')
  }
  return parsed as NarrativeSimulationGameRuntimePackageV2 | TextOpenWorldGameRuntimePackageV2
}

export function parseTextOpenWorldGameReleaseManifest(value: string): TextOpenWorldGameRuntimePackageV2 {
  const parsed = parseAnyGameReleaseManifest(value)
  if (parsed.productType !== 'text-open-world' || !parsed.interaction || !parsed.adventure
    || !parsed.simulation || !parsed.openWorld) {
    throw new Error('[textworld] 不是文字开放世界 GameRelease v3')
  }
  return parsed as TextOpenWorldGameRuntimePackageV2
}
