import type {
  TextOpenWorldActionUnavailableReasonV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import {
  projectTextOpenWorldPlayerMapV1,
  type TextOpenWorldMapEdgeViewV1,
  type TextOpenWorldMapLocationViewV1,
  type TextOpenWorldMapRegionViewV1,
} from './map-view'
import { parseTextOpenWorldModulesV1 } from './modules'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'
import {
  projectTextOpenWorldFastTravelOptionsV1,
  projectTextOpenWorldTravelOptionsV1,
  type TextOpenWorldFastTravelOptionV1,
  type TextOpenWorldTravelOptionV1,
} from './travel'

export type TextOpenWorldPlayerMapLocationFunctionV1 = NonNullable<
  TextOpenWorldMapLocationViewV1['functions']
>[number]

export interface TextOpenWorldPlayerMapLocationV1 extends TextOpenWorldMapLocationViewV1 {
  regionTitle: string
  unlockedFastTravelPointKey: string | null
  ordinaryTravelOptions: TextOpenWorldTravelOptionV1[]
  fastTravelOption: TextOpenWorldFastTravelOptionV1 | null
}

export interface TextOpenWorldPlayerMapRouteV1 extends TextOpenWorldMapEdgeViewV1 {
  fromTitle: string
  toTitle: string
  fromCurrentLocation: boolean
  ordinaryTravelOptions: TextOpenWorldTravelOptionV1[]
}

export interface TextOpenWorldPlayerMapRegionV1 extends TextOpenWorldMapRegionViewV1 {
  locations: TextOpenWorldPlayerMapLocationV1[]
}

export interface TextOpenWorldPlayerMapProjectionV1 {
  viewBox: { width: 1000; height: 700 }
  layoutSource: 'authored' | 'deterministic-fallback'
  currentLocationKey: string
  knownLocationCount: number
  visitedLocationCount: number
  unlockedFastTravelPointCount: number
  regions: TextOpenWorldPlayerMapRegionV1[]
  locations: TextOpenWorldPlayerMapLocationV1[]
  routes: TextOpenWorldPlayerMapRouteV1[]
  listFallback: TextOpenWorldPlayerMapLocationV1[]
}

function cloneReasons(
  reasons: readonly TextOpenWorldActionUnavailableReasonV1[],
): TextOpenWorldActionUnavailableReasonV1[] {
  return reasons.map(reason => ({ ...reason }))
}

function cloneOrdinaryOption(option: TextOpenWorldTravelOptionV1): TextOpenWorldTravelOptionV1 {
  return { ...option, unavailableReasons: cloneReasons(option.unavailableReasons) }
}

function cloneFastOption(option: TextOpenWorldFastTravelOptionV1): TextOpenWorldFastTravelOptionV1 {
  return {
    ...option,
    routeEdgeKeys: [...option.routeEdgeKeys],
    unavailableReasons: cloneReasons(option.unavailableReasons),
  }
}

/**
 * Builds the complete player map screen from the frozen Release and the
 * authoritative Session Projection. It deliberately composes the existing
 * disclosure-safe map and governed travel projections instead of reading raw
 * hidden locations in the component or manufacturing a second map state.
 */
export function projectTextOpenWorldPlayerMapScreenV1(
  value: TextOpenWorldSessionProjectionV1 | unknown,
): TextOpenWorldPlayerMapProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(value)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const map = projectTextOpenWorldPlayerMapV1({
    runtimePackage: projection.runtimePackage,
    state: projection.state,
  })
  const ordinaryOptions = projectTextOpenWorldTravelOptionsV1(projection)
  const fastOptions = projectTextOpenWorldFastTravelOptionsV1(projection)
  const regionByKey = new Map(map.regions.map(region => [region.regionKey, region]))
  const visibleLocationByKey = new Map(map.locations.map(location => [location.locationKey, location]))
  const visibleEdgeKeys = new Set(map.edges.map(edge => edge.edgeKey))
  const ordinaryByDestination = new Map<string, TextOpenWorldTravelOptionV1[]>()
  ordinaryOptions.forEach(option => {
    const options = ordinaryByDestination.get(option.destinationLocationKey) ?? []
    options.push(cloneOrdinaryOption(option))
    ordinaryByDestination.set(option.destinationLocationKey, options)
  })
  const fastByDestination = new Map(fastOptions.map(option => [
    option.destinationLocationKey,
    {
      ...cloneFastOption(option),
      // A shortest fast-travel path may cross undiscovered intermediate
      // locations. Only disclosed edges may leave this player projector.
      routeEdgeKeys: option.routeEdgeKeys.filter(edgeKey => visibleEdgeKeys.has(edgeKey)),
    },
  ]))
  const unlockedPointByLocation = new Map(modules.world.fastTravelPoints
    .filter(point => projection.state.map.unlockedFastTravelPointKeys.includes(point.key)
      && visibleLocationByKey.has(point.locationKey))
    .map(point => [point.locationKey, point.key]))

  const locations = map.locations.map(location => ({
    ...location,
    functions: location.functions ? [...location.functions] : null,
    regionTitle: regionByKey.get(location.regionKey)!.title,
    unlockedFastTravelPointKey: unlockedPointByLocation.get(location.locationKey) ?? null,
    ordinaryTravelOptions: (ordinaryByDestination.get(location.locationKey) ?? []).map(option => ({
      ...option,
      description: location.knowledge === 'heard'
        ? `前往${location.title}。`
        : option.description,
    })),
    fastTravelOption: fastByDestination.has(location.locationKey)
      ? {
          ...fastByDestination.get(location.locationKey)!,
          description: location.knowledge === 'heard'
            ? `快速前往${location.title}。`
            : fastByDestination.get(location.locationKey)!.description,
        }
      : null,
  }))
  const locationByKey = new Map(locations.map(location => [location.locationKey, location]))
  const routes = map.edges.map(edge => ({
    ...edge,
    fromTitle: locationByKey.get(edge.fromLocationKey)!.title,
    toTitle: locationByKey.get(edge.toLocationKey)!.title,
    fromCurrentLocation: edge.fromLocationKey === projection.state.map.currentLocationKey
      || (edge.bidirectional && edge.toLocationKey === projection.state.map.currentLocationKey),
    ordinaryTravelOptions: ordinaryOptions
      .filter(option => option.edgeKey === edge.edgeKey)
      .map(cloneOrdinaryOption),
  }))
  const regions = map.regions.map(region => ({
    ...region,
    levelBand: region.levelBand ? { ...region.levelBand } : null,
    locations: locations.filter(location => location.regionKey === region.regionKey),
  }))

  return {
    viewBox: map.viewBox,
    layoutSource: map.layoutSource,
    currentLocationKey: projection.state.map.currentLocationKey,
    knownLocationCount: locations.length,
    visitedLocationCount: locations.filter(location => location.knowledge !== 'heard').length,
    unlockedFastTravelPointCount: unlockedPointByLocation.size,
    regions,
    locations,
    routes,
    listFallback: locations.map(location => ({
      ...location,
      functions: location.functions ? [...location.functions] : null,
      ordinaryTravelOptions: location.ordinaryTravelOptions.map(cloneOrdinaryOption),
      fastTravelOption: location.fastTravelOption ? cloneFastOption(location.fastTravelOption) : null,
    })),
  }
}
