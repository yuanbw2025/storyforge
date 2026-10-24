import type {ChatRequestOptions} from '../ai/client'
import type {ChatNarrativeProductionSourceV1} from './narrative-production'
import {CHAT_INITIAL_FACT_CAPACITY_V1} from './narrative-contract'
import {CHAT_OPENING_REFERENCE_SCHEMA, validateChatOpeningFactCatalogV2} from './opening-source-references'

/** Transport shape for new source-complete production only. The deterministic
 * parser, independent semantic review and author selection remain authoritative.
 * No source prose or secrets are copied into the provider's schema. */
export async function chatOpeningOutputSchemaV1(source: ChatNarrativeProductionSourceV1, catalogValue: unknown): Promise<NonNullable<ChatRequestOptions['jsonSchema']>> {
  const catalog = await validateChatOpeningFactCatalogV2(catalogValue, source)
  const text = (maxLength = 4000) => ({type: 'string', minLength: 1, maxLength})
  const object = (properties: Record<string, unknown>) => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false})
  const array = (items: unknown, maxItems: number, minItems = 0) => ({type: 'array', items, minItems, maxItems})
  const choice = (values: string[]) => values.length ? {type: 'string', enum: values} : text(160)
  const actors = source.participants.map(p => p.participantKey), viewers = ['player', ...actors]
  const key = text(160), evidence = array(key, CHAT_INITIAL_FACT_CAPACITY_V1)
  const audience = array(choice(viewers), viewers.length), actor = choice(actors)
  const local = {factKey: key, text: text(7900), audienceKeys: audience}
  const discovery = object({sceneKey: key, actorKeys: array(actor, actors.length, 1), condition: text(2000), prerequisiteFactKeys: array(key, CHAT_INITIAL_FACT_CAPACITY_V1, 1)})
  const localFact = source.settings.narrative.permissions.maxDiscoveriesPerSituation
    ? {anyOf: [object(local), object({...local, discovery})]} : object(local)
  const setup = source.settings.narrative
  const situation = object({
    situationKey: key, sceneKey: key, title: text(1000),
    location: setup.location ? {type: 'string', enum: [setup.location]} : text(1000),
    timeLabel: setup.timeLabel ? {type: 'string', enum: [setup.timeLabel]} : text(1000),
    worldFactKeys: array(choice(catalog.facts.map(f => f.factKey)), catalog.facts.length),
    localFacts: array(localFact, CHAT_INITIAL_FACT_CAPACITY_V1 - catalog.facts.length),
    goals: array(object({goalKey: key, actorKey: actor, desire: text(), concern: text(), boundary: text(), evidenceFactKeys: evidence}), 32, actors.length),
    beliefs: array(object({beliefKey: key, actorKey: actor, text: text(), evidenceFactKeys: evidence}), 64),
    threads: array(object({threadKey: key, title: text(1000), question: text(), audienceKeys: audience,
      participantKeys: array(actor, actors.length, 1), evidenceFactKeys: evidence, closureSignals: array(text(1000), 8, 1)}),
    setup.permissions.maxActiveThreads, setup.permissions.mode === 'story' ? 1 : 0),
    possibilities: array(object({actorKey: actor, text: text(), evidenceFactKeys: evidence}), 32),
  })
  return {name: 'chat_opening_source_complete_v1', strict: true, schema: object({
    schema: {type: 'string', enum: [CHAT_OPENING_REFERENCE_SCHEMA]}, version: {type: 'integer', enum: [1]},
    options: array(object({optionKey: key, title: text(1000), pitch: text(2000), situation}), setup.openingCount, setup.openingCount),
  })}
}
