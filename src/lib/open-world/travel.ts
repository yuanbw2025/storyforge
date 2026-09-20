import type { TextOpenWorldActionUnavailableReasonV1, TextOpenWorldSessionProjectionV1 } from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { projectTextOpenWorldPlayerMapV1 } from './map-view'
import { parseTextOpenWorldModulesV1 } from './modules'
import { deriveTextOpenWorldContextsV1, parseTextOpenWorldSessionProjectionV1 } from './session-projection'
import { createTextOpenWorldFastTravelCatalogV1 } from './fast-travel'

export interface TextOpenWorldTravelOptionV1 {
  actionKey: string
  edgeKey: string
  originLocationKey: string
  destinationLocationKey: string
  destinationTitle: string
  label: string
  description: string
  travelMinutes: number
  riskProfile: 'safe' | 'ordinary' | 'dangerous'
  available: boolean
  unavailableReasons: TextOpenWorldActionUnavailableReasonV1[]
}

export interface TextOpenWorldFastTravelOptionV1 {
  actionKey: string
  fastTravelPointKey: string
  originLocationKey: string
  destinationLocationKey: string
  destinationTitle: string
  label: string
  description: string
  routeEdgeKeys: string[]
  travelMinutes: number | null
  available: boolean
  unavailableReasons: TextOpenWorldActionUnavailableReasonV1[]
}

function projectionDependencies(value: TextOpenWorldSessionProjectionV1) {
  const projection = parseTextOpenWorldSessionProjectionV1(value)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const visibleLocations = new Map(projectTextOpenWorldPlayerMapV1({
    runtimePackage: projection.runtimePackage,
    state: projection.state,
  }).locations.map(location => [location.locationKey, location]))
  const actions = createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(deriveTextOpenWorldContextsV1(projection).action)
  return { projection, modules, visibleLocations, actions }
}

function ordinaryOptions(dependencies: ReturnType<typeof projectionDependencies>): TextOpenWorldTravelOptionV1[] {
  const { projection, modules, visibleLocations, actions } = dependencies
  return actions.filter(entry => entry.action.category === 'travel'
    && entry.action.locationKeys.includes(projection.state.map.currentLocationKey))
    .flatMap(entry => {
      const start = entry.action.successEffectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
        .find(effect => effect.operation === 'start-travel')
      if (!start || start.operation !== 'start-travel') return []
      const destination = visibleLocations.get(start.payload.destinationLocationKey)
      const edge = modules.world.edges.find(candidate => candidate.key === start.payload.edgeKey)
      if (!destination || !edge) return []
      return [{
        actionKey: entry.action.key,
        edgeKey: edge.key,
        originLocationKey: projection.state.map.currentLocationKey,
        destinationLocationKey: destination.locationKey,
        destinationTitle: destination.title,
        label: entry.action.label,
        description: entry.action.description,
        travelMinutes: edge.travelMinutes,
        riskProfile: edge.riskProfile,
        available: entry.available,
        unavailableReasons: structuredClone(entry.unavailableReasons),
      } satisfies TextOpenWorldTravelOptionV1]
    }).sort((left, right) => left.travelMinutes - right.travelMinutes
      || left.edgeKey.localeCompare(right.edgeKey)
      || left.destinationLocationKey.localeCompare(right.destinationLocationKey))
}

function fastOptions(dependencies: ReturnType<typeof projectionDependencies>): TextOpenWorldFastTravelOptionV1[] {
  const { projection, modules, visibleLocations, actions } = dependencies
  const projectedAction = actions.find(entry => entry.action.category === 'fast-travel')
  if (!projectedAction) return []
  const effect = projectedAction.action.successEffectKeys.map(effectKey => modules.actions.effects.find(candidate => candidate.key === effectKey)!)
    .find(candidate => candidate.operation === 'fast-travel')
  if (!effect || effect.operation !== 'fast-travel') return []
  const catalog = createTextOpenWorldFastTravelCatalogV1(projection.runtimePackage, modules)
  return modules.world.fastTravelPoints
    .filter(point => projection.state.map.unlockedFastTravelPointKeys.includes(point.key)
      && point.locationKey !== projection.state.map.currentLocationKey
      && visibleLocations.has(point.locationKey))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(point => {
      let routeEdgeKeys: string[] = []
      let travelMinutes: number | null = null
      let routeAvailable = true
      try {
        const authorization = catalog.prepare({ state: projection.state, effect, destinationLocationKey: point.locationKey })
        routeEdgeKeys = authorization.routeEdgeKeys
        travelMinutes = authorization.travelMinutes
      } catch {
        routeAvailable = false
      }
      const available = routeAvailable && projectedAction.available && projectedAction.validTargetKeys.includes(point.locationKey)
      const unavailableReasons = available
        ? []
        : projectedAction.unavailableReasons.length
          ? structuredClone(projectedAction.unavailableReasons)
          : [{ code: 'route-closed' as const, message: '当前没有通往该地点的开放路线。', conditionKey: null }]
      return {
        actionKey: projectedAction.action.key,
        fastTravelPointKey: point.key,
        originLocationKey: projection.state.map.currentLocationKey,
        destinationLocationKey: point.locationKey,
        destinationTitle: visibleLocations.get(point.locationKey)!.title,
        label: projectedAction.action.label,
        description: projectedAction.action.description,
        routeEdgeKeys,
        travelMinutes,
        available,
        unavailableReasons,
      }
    })
}

/** One-pass projector used by the full map screen to avoid reparsing the same immutable package. */
export function projectTextOpenWorldTravelSurfacesV1(value: TextOpenWorldSessionProjectionV1): {
  ordinary: TextOpenWorldTravelOptionV1[]
  fast: TextOpenWorldFastTravelOptionV1[]
} {
  const dependencies = projectionDependencies(value)
  return {
    ordinary: ordinaryOptions(dependencies),
    fast: fastOptions(dependencies),
  }
}

/**
 * Projects only player-known, directly adjacent ordinary travel Actions.
 * Arrival is deliberately not a Scene/Quest trigger; it only commits the
 * Release-authored travel Effect sequence.
 */
export function projectTextOpenWorldTravelOptionsV1(value: TextOpenWorldSessionProjectionV1): TextOpenWorldTravelOptionV1[] {
  return ordinaryOptions(projectionDependencies(value))
}

/** Projects only previously visited, unlocked destinations for atomic fast travel. */
export function projectTextOpenWorldFastTravelOptionsV1(value: TextOpenWorldSessionProjectionV1): TextOpenWorldFastTravelOptionV1[] {
  return fastOptions(projectionDependencies(value))
}
