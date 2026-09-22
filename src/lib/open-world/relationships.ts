import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

function fail(message: string): never { throw new Error(`[text-open-world-relationships] ${message}`) }
function rounded(value: number): number { return Math.round(value * 10_000) / 10_000 }

export interface TextOpenWorldActorAttitudeProjectionV1 {
  actorKey: string
  actorName: string
  factionKey: string | null
  attitude: 'bad' | 'neutral' | 'good'
  label: string
  greetingTone: string
  optionalInteractionPolicy: 'available' | 'may-refuse'
  buyPriceMultiplier: number
  sellPriceMultiplier: number
  score: number
  reasons: {
    morality: number
    factionAffinity: number
    experiencedStory: number
  }
}

function projectActor(
  modules: TextOpenWorldParsedModulesV1,
  state: TextOpenWorldEffectStateV1,
  actorKey: string,
): TextOpenWorldActorAttitudeProjectionV1 {
  const actor = modules.actors.actors.find(item => item.key === actorKey) ?? fail(`Actor不存在:${actorKey}`)
  const moralityMultiplier = actor.factionKey == null
    ? modules.relationships.unaffiliatedMoralityMultiplier
    : modules.relationships.factionMorality.find(item => item.factionKey === actor.factionKey)?.moralityMultiplier
      ?? fail(`Actor所属阵营缺少道德解释:${actor.key}:${actor.factionKey}`)
  const affinity = actor.factionKey == null
    ? 0
    : state.relationships.factionAffinityByKey[actor.factionKey] ?? modules.relationships.factionAffinity.initial
  const morality = state.relationships.morality * moralityMultiplier * modules.relationships.attitude.moralityWeight
  const factionAffinity = affinity * modules.relationships.attitude.factionWeight
  const experiencedStory = state.relationships.storyModifierByActorKey[actor.key] ?? 0
  const score = rounded(morality + factionAffinity + experiencedStory)
  const attitude = score <= modules.relationships.attitude.badMaximum
    ? 'bad'
    : score >= modules.relationships.attitude.goodMinimum ? 'good' : 'neutral'
  const band = modules.relationships.attitudeBands.find(item => item.attitude === attitude) ?? fail(`态度档定义不存在:${attitude}`)
  return {
    actorKey: actor.key,
    actorName: actor.name,
    factionKey: actor.factionKey,
    attitude,
    label: band.label,
    greetingTone: band.greetingTone,
    optionalInteractionPolicy: actor.tier === 'mainline' ? 'available' : band.optionalInteractionPolicy,
    buyPriceMultiplier: band.buyPriceMultiplier,
    sellPriceMultiplier: band.sellPriceMultiplier,
    score,
    reasons: { morality: rounded(morality), factionAffinity: rounded(factionAffinity), experiencedStory: rounded(experiencedStory) },
  }
}

export function projectTextOpenWorldRelationshipsV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown
  state: TextOpenWorldEffectStateV1
  actorKeys?: string[]
  factionKeys?: string[]
  parsedModules?: TextOpenWorldParsedModulesV1
}) {
  const modules = input.parsedModules ?? parseTextOpenWorldModulesV1(input.runtimePackage)
  const actorKeys = input.actorKeys ?? modules.actors.actors.map(actor => actor.key)
  if (new Set(actorKeys).size !== actorKeys.length) fail('actorKeys不能重复')
  const factionKeys = input.factionKeys ?? []
  if (new Set(factionKeys).size !== factionKeys.length) fail('factionKeys不能重复')
  factionKeys.forEach(factionKey => {
    if (!modules.actors.factions.some(faction => faction.key === factionKey)) fail(`Faction不存在:${factionKey}`)
  })
  const actors = actorKeys.map(actorKey => projectActor(modules, input.state, actorKey))
  const visibleFactionKeys = new Set([
    ...factionKeys,
    ...actors.flatMap(actor => actor.factionKey ? [actor.factionKey] : []),
  ])
  return {
    morality: {
      value: input.state.relationships.morality,
      minimum: modules.relationships.morality.minimum,
      maximum: modules.relationships.morality.maximum,
    },
    factions: modules.actors.factions.filter(faction => visibleFactionKeys.has(faction.key)).map(faction => ({
      key: faction.key,
      title: faction.title,
      affinity: input.state.relationships.factionAffinityByKey[faction.key] ?? modules.relationships.factionAffinity.initial,
      moralityMultiplier: modules.relationships.factionMorality.find(item => item.factionKey === faction.key)!.moralityMultiplier,
    })),
    actors,
  }
}

export function deriveTextOpenWorldAttitudeByActorKeyV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown
  state: TextOpenWorldEffectStateV1
  parsedModules?: TextOpenWorldParsedModulesV1
}): Record<string, 'bad' | 'neutral' | 'good'> {
  return Object.fromEntries(projectTextOpenWorldRelationshipsV1(input).actors.map(actor => [actor.actorKey, actor.attitude]))
}
