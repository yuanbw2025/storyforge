import type { TextOpenWorldEffectStateV1, TextOpenWorldParsedModulesV1 } from '../types'
import { validateTextOpenWorldEffectStateV1 } from './effect-dsl'
import { parseTextOpenWorldModulesV1 } from './modules'

type Knowledge = 'unknown' | 'heard' | 'visited' | 'familiar'

export interface TextOpenWorldMapRegionViewV1 {
  regionKey: string
  knowledge: Knowledge
  title: string
  description: string | null
  theme: string | null
  levelBand: { minimum: number; maximum: number } | null
}

export interface TextOpenWorldMapLocationViewV1 {
  locationKey: string
  regionKey: string
  knowledge: Exclude<Knowledge, 'unknown'>
  title: string
  description: string | null
  earlyArrivalDescription: string | null
  functions: TextOpenWorldParsedModulesV1['world']['locations'][number]['functions'] | null
  kind: TextOpenWorldParsedModulesV1['world']['locations'][number]['kind'] | null
  x: number
  y: number
  current: boolean
}

export interface TextOpenWorldMapEdgeViewV1 {
  edgeKey: string
  fromLocationKey: string
  toLocationKey: string
  travelMinutes: number
  riskProfile: TextOpenWorldParsedModulesV1['world']['edges'][number]['riskProfile']
  open: boolean
}

export interface TextOpenWorldPlayerMapViewV1 {
  viewBox: { width: 1000; height: 700 }
  layoutSource: 'authored' | 'deterministic-fallback'
  regions: TextOpenWorldMapRegionViewV1[]
  locations: TextOpenWorldMapLocationViewV1[]
  edges: TextOpenWorldMapEdgeViewV1[]
  listFallback: TextOpenWorldMapLocationViewV1[]
}

function disclosedRegion(
  region: TextOpenWorldParsedModulesV1['world']['regions'][number],
  knowledge: Knowledge,
): TextOpenWorldMapRegionViewV1 | null {
  if (knowledge === 'unknown' && region.knowledgePolicy !== 'always-visible') return null
  const visited = knowledge === 'visited' || knowledge === 'familiar'
  return {
    regionKey: region.key,
    knowledge,
    title: region.title,
    description: visited ? region.description : null,
    theme: visited ? region.theme : null,
    levelBand: visited ? structuredClone(region.levelBand) : null,
  }
}

/**
 * Produces one disclosure-safe projection for both SVG and the equivalent list
 * fallback. Hidden definitions are omitted instead of being redacted in place.
 */
export function projectTextOpenWorldPlayerMapV1(input: {
  runtimePackage: unknown
  state: TextOpenWorldEffectStateV1
}): TextOpenWorldPlayerMapViewV1 {
  const modules = parseTextOpenWorldModulesV1(input.runtimePackage)
  validateTextOpenWorldEffectStateV1(input.state, modules)
  const nodeByLocationKey = new Map(modules.presentation.mapLayout.locationNodes.map(node => [node.locationKey, node]))
  const regions = modules.world.regions.flatMap(region => {
    const projected = disclosedRegion(region, input.state.map.regionKnowledgeByKey[region.key] ?? 'unknown')
    return projected ? [projected] : []
  }).sort((left, right) => left.regionKey.localeCompare(right.regionKey))
  const visibleRegionKeys = new Set(regions.map(region => region.regionKey))
  const locations = modules.world.locations.flatMap(location => {
    const knowledge = input.state.map.locationKnowledgeByKey[location.key] ?? 'unknown'
    if (knowledge === 'unknown' || !visibleRegionKeys.has(location.regionKey)) return []
    const node = nodeByLocationKey.get(location.key)!
    const visited = knowledge === 'visited' || knowledge === 'familiar'
    return [{
      locationKey: location.key,
      regionKey: location.regionKey,
      knowledge,
      title: location.title,
      description: visited ? location.description : null,
      earlyArrivalDescription: input.state.map.currentLocationKey === location.key ? location.earlyArrivalDescription : null,
      functions: visited ? [...location.functions] : null,
      kind: visited ? location.kind : null,
      x: node.x,
      y: node.y,
      current: input.state.map.currentLocationKey === location.key,
    } satisfies TextOpenWorldMapLocationViewV1]
  }).sort((left, right) => left.locationKey.localeCompare(right.locationKey))
  const visibleLocationKeys = new Set(locations.map(location => location.locationKey))
  const edges = modules.world.edges.filter(edge => visibleLocationKeys.has(edge.fromLocationKey) && visibleLocationKeys.has(edge.toLocationKey))
    .map(edge => ({
      edgeKey: edge.key,
      fromLocationKey: edge.fromLocationKey,
      toLocationKey: edge.toLocationKey,
      travelMinutes: edge.travelMinutes,
      riskProfile: edge.riskProfile,
      open: input.state.map.openEdgeKeys.includes(edge.key),
    }))
    .sort((left, right) => left.edgeKey.localeCompare(right.edgeKey))
  return {
    viewBox: { width: 1000, height: 700 },
    layoutSource: modules.presentation.mapLayout.source,
    regions,
    locations,
    edges,
    listFallback: locations.map(location => ({ ...location, functions: location.functions ? [...location.functions] : null })),
  }
}
