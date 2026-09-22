import type {
  ProductRuntimeCheckpoint,
  TextOpenWorldEffectStateV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { validateTextOpenWorldEffectStateV1 } from './effect-dsl'
import { parseTextOpenWorldModulesV1 } from './modules'

export interface TextOpenWorldLifeProjectionV1 {
  phase: 'healthy' | 'wounded' | 'defeated'
  healthRatio: number
  harmfulStatusKeys: string[]
  rest: { available: boolean; reason: string | null }
  respawnPoints: Array<{ fastTravelPointKey: string; locationKey: string; title: string }>
  combatRetryCheckpointIds: number[]
}

export function deriveTextOpenWorldLifeProjectionV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1
  state: TextOpenWorldEffectStateV1
  checkpoints?: ProductRuntimeCheckpoint[]
}): TextOpenWorldLifeProjectionV1 {
  const modules = parseTextOpenWorldModulesV1(input.runtimePackage)
  validateTextOpenWorldEffectStateV1(input.state, modules)
  const state = input.state
  const defeated = state.combat?.status === 'defeat'
  const phase = defeated ? 'defeated' : state.player.health < state.player.maximumHealth ? 'wounded' : 'healthy'
  const harmfulDefinitions = new Set(modules.progression.statuses.filter(status => status.polarity === 'harmful').map(status => status.key))
  const restUnavailableReason = defeated
    ? '战败后必须选择战前重试、读档或复活。'
    : state.combat?.status === 'active'
      ? '战斗进行中不能休息。'
      : null
  const respawnPoints = modules.world.fastTravelPoints.filter(point => point.canRespawn && state.map.unlockedFastTravelPointKeys.includes(point.key)).map(point => ({
    fastTravelPointKey: point.key,
    locationKey: point.locationKey,
    title: modules.world.locations.find(location => location.key === point.locationKey)!.title,
  }))
  const retryIds = (input.checkpoints ?? []).filter(checkpoint => checkpoint.id != null
    && checkpoint.purpose === 'combat-retry'
    && checkpoint.subjectKey === state.combat?.encounterKey)
    .sort((left, right) => right.throughSequence - left.throughSequence || right.createdAt - left.createdAt)
    .map(checkpoint => checkpoint.id!)
  return {
    phase,
    healthRatio: state.player.health / state.player.maximumHealth,
    harmfulStatusKeys: state.player.statusKeys.filter(key => harmfulDefinitions.has(key)),
    rest: { available: restUnavailableReason == null, reason: restUnavailableReason },
    respawnPoints,
    combatRetryCheckpointIds: retryIds,
  }
}
