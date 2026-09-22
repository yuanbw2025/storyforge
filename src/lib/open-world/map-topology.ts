import type { TextOpenWorldParsedModulesV1 } from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

type WorldModule = TextOpenWorldParsedModulesV1['world']
type RegionDefinition = WorldModule['regions'][number]
type LocationDefinition = WorldModule['locations'][number]
type EdgeDefinition = WorldModule['edges'][number]
type FastTravelPointDefinition = WorldModule['fastTravelPoints'][number]

export interface TextOpenWorldLocationContentBindingsV1 {
  locationKey: string
  sceneKeys: string[]
  regionalQuestDefinitionKeys: string[]
  actorKeys: string[]
  encounterKeys: string[]
  vendorKeys: string[]
}

export interface TextOpenWorldMapDefinitionV1 {
  initialLocationKey: string
  regionByKey: Record<string, RegionDefinition>
  locationByKey: Record<string, LocationDefinition>
  edgeByKey: Record<string, EdgeDefinition>
  fastTravelPointByKey: Record<string, FastTravelPointDefinition>
  outgoingEdgeKeysByLocationKey: Record<string, string[]>
  contentBindingsByLocationKey: Record<string, TextOpenWorldLocationContentBindingsV1>
}

export interface TextOpenWorldMapConnectionV1 {
  edgeKey: string
  fromLocationKey: string
  destinationLocationKey: string
  destinationRegionKey: string
  travelMinutes: number
  riskProfile: EdgeDefinition['riskProfile']
  currentlyOpen: boolean
}

export interface TextOpenWorldRouteStepV1 extends TextOpenWorldMapConnectionV1 {
  currentlyOpen: true
}

export interface TextOpenWorldRoutePlanV1 {
  fromLocationKey: string
  destinationLocationKey: string
  locationKeys: string[]
  regionKeys: string[]
  edgeKeys: string[]
  totalTravelMinutes: number
  steps: TextOpenWorldRouteStepV1[]
}

function fail(message: string): never { throw new Error(`[text-open-world-map] ${message}`) }

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function destinationFor(edge: EdgeDefinition, fromLocationKey: string): string | null {
  if (edge.fromLocationKey === fromLocationKey) return edge.toLocationKey
  if (edge.bidirectional && edge.toLocationKey === fromLocationKey) return edge.fromLocationKey
  return null
}

function bindingsForLocation(modules: TextOpenWorldParsedModulesV1, locationKey: string): TextOpenWorldLocationContentBindingsV1 {
  const location = modules.world.locations.find(item => item.key === locationKey) ?? fail(`地点不存在:${locationKey}`)
  return {
    locationKey,
    // These are content candidates only. Arrival never executes a Scene or Quest.
    sceneKeys: stableUnique(modules.narrative.scenes.filter(scene => scene.locationKey === locationKey).map(scene => scene.key)),
    regionalQuestDefinitionKeys: stableUnique(modules.quests.quests.filter(quest => quest.regionKeys.includes(location.regionKey)).map(quest => quest.key)),
    actorKeys: stableUnique(modules.actors.actors.filter(actor => actor.homeLocationKey === locationKey
      || modules.actors.schedules.some(schedule => schedule.actorKey === actor.key && schedule.entries.some(entry => entry.locationKey === locationKey))).map(actor => actor.key)),
    encounterKeys: stableUnique(modules.combat.encounters.filter(encounter => encounter.locationKey === locationKey).map(encounter => encounter.key)),
    vendorKeys: stableUnique(modules.economy.vendors.filter(vendor => vendor.locationKey === locationKey).map(vendor => vendor.key)),
  }
}

function connectionsForLocation(
  modules: TextOpenWorldParsedModulesV1,
  currentLocationKey: string,
  openEdgeKeys: ReadonlySet<string>,
): TextOpenWorldMapConnectionV1[] {
  return modules.world.edges.flatMap(edge => {
    const destinationLocationKey = destinationFor(edge, currentLocationKey)
    if (!destinationLocationKey) return []
    const destination = modules.world.locations.find(location => location.key === destinationLocationKey)!
    return [{
      edgeKey: edge.key,
      fromLocationKey: currentLocationKey,
      destinationLocationKey,
      destinationRegionKey: destination.regionKey,
      travelMinutes: edge.travelMinutes,
      riskProfile: edge.riskProfile,
      currentlyOpen: openEdgeKeys.has(edge.key),
    }]
  }).sort((left, right) => left.travelMinutes - right.travelMinutes
    || left.edgeKey.localeCompare(right.edgeKey)
    || left.destinationLocationKey.localeCompare(right.destinationLocationKey))
}

/** Builds the immutable, query-oriented map definition owned by a Release. */
export function createTextOpenWorldMapDefinitionV1(value: unknown): TextOpenWorldMapDefinitionV1 {
  const modules = parseTextOpenWorldModulesV1(value)
  const outgoingEdgeKeysByLocationKey = Object.fromEntries(modules.world.locations.map(location => [
    location.key,
    stableUnique(modules.world.edges.filter(edge => destinationFor(edge, location.key) != null).map(edge => edge.key)),
  ]))
  return {
    initialLocationKey: modules.world.initialLocationKey,
    regionByKey: Object.fromEntries(modules.world.regions.map(item => [item.key, structuredClone(item)])),
    locationByKey: Object.fromEntries(modules.world.locations.map(item => [item.key, structuredClone(item)])),
    edgeByKey: Object.fromEntries(modules.world.edges.map(item => [item.key, structuredClone(item)])),
    fastTravelPointByKey: Object.fromEntries(modules.world.fastTravelPoints.map(item => [item.key, structuredClone(item)])),
    outgoingEdgeKeysByLocationKey,
    contentBindingsByLocationKey: Object.fromEntries(modules.world.locations.map(location => [location.key, bindingsForLocation(modules, location.key)])),
  }
}

/**
 * Projects adjacent destinations without treating location arrival as a story
 * trigger. G2-15 consumes these connections to perform governed travel.
 */
export function projectTextOpenWorldMapConnectionsV1(input: {
  runtimePackage: unknown
  currentLocationKey: string
  openEdgeKeys: readonly string[]
}): TextOpenWorldMapConnectionV1[] {
  const modules = parseTextOpenWorldModulesV1(input.runtimePackage)
  if (!modules.world.locations.some(location => location.key === input.currentLocationKey)) fail(`当前位置不存在:${input.currentLocationKey}`)
  const knownEdgeKeys = new Set(modules.world.edges.map(edge => edge.key))
  if (new Set(input.openEdgeKeys).size !== input.openEdgeKeys.length) fail('openEdgeKeys不能重复')
  input.openEdgeKeys.forEach(edgeKey => { if (!knownEdgeKeys.has(edgeKey)) fail(`openEdgeKeys包含未知道路:${edgeKey}`) })
  const openEdgeKeys = new Set(input.openEdgeKeys)
  return connectionsForLocation(modules, input.currentLocationKey, openEdgeKeys)
}

/** Deterministic shortest-time route; undefined openEdgeKeys means structural planning. */
export function planTextOpenWorldRouteV1(input: {
  runtimePackage: unknown
  fromLocationKey: string
  destinationLocationKey: string
  openEdgeKeys?: readonly string[]
}): TextOpenWorldRoutePlanV1 | null {
  const modules = parseTextOpenWorldModulesV1(input.runtimePackage)
  const locationByKey = new Map(modules.world.locations.map(location => [location.key, location]))
  if (!locationByKey.has(input.fromLocationKey)) fail(`出发地点不存在:${input.fromLocationKey}`)
  if (!locationByKey.has(input.destinationLocationKey)) fail(`目标地点不存在:${input.destinationLocationKey}`)
  const allEdgeKeys = new Set(modules.world.edges.map(edge => edge.key))
  const allowedEdgeKeys = input.openEdgeKeys == null ? allEdgeKeys : new Set(input.openEdgeKeys)
  if (input.openEdgeKeys && allowedEdgeKeys.size !== input.openEdgeKeys.length) fail('openEdgeKeys不能重复')
  allowedEdgeKeys.forEach(edgeKey => { if (!allEdgeKeys.has(edgeKey)) fail(`openEdgeKeys包含未知道路:${edgeKey}`) })
  if (input.fromLocationKey === input.destinationLocationKey) {
    return {
      fromLocationKey: input.fromLocationKey,
      destinationLocationKey: input.destinationLocationKey,
      locationKeys: [input.fromLocationKey],
      regionKeys: [locationByKey.get(input.fromLocationKey)!.regionKey],
      edgeKeys: [], totalTravelMinutes: 0, steps: [],
    }
  }

  type Candidate = { locationKey: string; minutes: number; edgeKeys: string[]; locationKeys: string[]; steps: TextOpenWorldRouteStepV1[] }
  const candidates: Candidate[] = [{ locationKey: input.fromLocationKey, minutes: 0, edgeKeys: [], locationKeys: [input.fromLocationKey], steps: [] }]
  const best = new Map<string, { minutes: number; signature: string }>([[input.fromLocationKey, { minutes: 0, signature: '' }]])
  while (candidates.length) {
    candidates.sort((left, right) => left.minutes - right.minutes || left.edgeKeys.join('\u0000').localeCompare(right.edgeKeys.join('\u0000')))
    const current = candidates.shift()!
    const currentSignature = current.edgeKeys.join('\u0000')
    const recorded = best.get(current.locationKey)
    if (!recorded || recorded.minutes !== current.minutes || recorded.signature !== currentSignature) continue
    if (current.locationKey === input.destinationLocationKey) {
      return {
        fromLocationKey: input.fromLocationKey,
        destinationLocationKey: input.destinationLocationKey,
        locationKeys: current.locationKeys,
        regionKeys: current.locationKeys.map(locationKey => locationByKey.get(locationKey)!.regionKey)
          .filter((regionKey, index, values) => index === 0 || regionKey !== values[index - 1]),
        edgeKeys: current.edgeKeys,
        totalTravelMinutes: current.minutes,
        steps: current.steps,
      }
    }
    const connections = connectionsForLocation(modules, current.locationKey, allowedEdgeKeys).filter(connection => connection.currentlyOpen)
    for (const connection of connections) {
      const minutes = current.minutes + connection.travelMinutes
      const edgeKeys = [...current.edgeKeys, connection.edgeKey]
      const signature = edgeKeys.join('\u0000')
      const prior = best.get(connection.destinationLocationKey)
      if (prior && (prior.minutes < minutes || (prior.minutes === minutes && prior.signature.localeCompare(signature) <= 0))) continue
      best.set(connection.destinationLocationKey, { minutes, signature })
      candidates.push({
        locationKey: connection.destinationLocationKey,
        minutes,
        edgeKeys,
        locationKeys: [...current.locationKeys, connection.destinationLocationKey],
        steps: [...current.steps, { ...connection, currentlyOpen: true }],
      })
    }
  }
  return null
}

export function deriveTextOpenWorldLocationContentBindingsV1(input: {
  runtimePackage: unknown
  locationKey: string
}): TextOpenWorldLocationContentBindingsV1 {
  return bindingsForLocation(parseTextOpenWorldModulesV1(input.runtimePackage), input.locationKey)
}
