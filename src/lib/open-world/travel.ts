import type { TextOpenWorldActionUnavailableReasonV1, TextOpenWorldSessionProjectionV1 } from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { projectTextOpenWorldPlayerMapV1 } from './map-view'
import { parseTextOpenWorldModulesV1 } from './modules'
import { deriveTextOpenWorldContextsV1, parseTextOpenWorldSessionProjectionV1 } from './session-projection'

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

/**
 * Projects only player-known, directly adjacent ordinary travel Actions.
 * Arrival is deliberately not a Scene/Quest trigger; it only commits the
 * Release-authored travel Effect sequence.
 */
export function projectTextOpenWorldTravelOptionsV1(value: TextOpenWorldSessionProjectionV1): TextOpenWorldTravelOptionV1[] {
  const projection = parseTextOpenWorldSessionProjectionV1(value)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const visibleLocations = new Map(projectTextOpenWorldPlayerMapV1({
    runtimePackage: projection.runtimePackage,
    state: projection.state,
  }).locations.map(location => [location.locationKey, location]))
  const actions = createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(deriveTextOpenWorldContextsV1(projection).action)
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
