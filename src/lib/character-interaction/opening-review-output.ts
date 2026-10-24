import type {ChatRequestOptions} from '../ai/client'
import {parseChatSituationCandidatesV1, type ChatNarrativeProductionSourceV1, type ChatSituationCandidatesV1} from './narrative-production'
import {CHAT_OPENING_CHECKS} from './situation-production-review'

/** Canonical, string-valued JSON Pointers only. The schema contains identities
 * and paths, never source prose, model conclusions or newly granted knowledge. */
function stringPaths(root: unknown, path = ''): string[] {
  if (path.length > 300 || path.split('/').length > 20) return []
  if (typeof root === 'string') return root.trim() && path ? [path] : []
  if (!root || typeof root !== 'object') return []
  return Object.entries(root).flatMap(([key, value]) =>
    stringPaths(value, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`))
}

// The reviewer reads the complete registered input, but evidence quotes need
// narrative text, not hundreds of hashes, resource keys and classification IDs.
// Limiting transport enums does not remove any source content or change parsing.
function sourceCitationPath(path: string): boolean {
  return /^\/settings\/(?:openingSituation|playerRole|contentBoundaries|experience)$/u.test(path)
    || /^\/settings\/characters\/\d+\/(?:privateKnowledge|voiceRules)$/u.test(path)
    || /^\/participants\/\d+\/(?:name|voiceRules)$/u.test(path)
    || path === '/source/playerRole'
    || /^\/source\/knowledge\/\d+\/(?:content|discovery\/condition)$/u.test(path)
    || /^\/source\/sourceUnits\/bundles\/\d+\/(?:source\/fragments\/\d+\/valueJson|candidate\/fragments\/\d+\/(?:facts|constraints)\/\d+\/text|permissions\/\d+\/discovery\/condition)$/u.test(path)
}
function optionCitationPath(path: string): boolean {
  return /^\/(?:title|pitch)$/u.test(path)
    || /^\/situation\/(?:title|location|timeLabel)$/u.test(path)
    || /^\/situation\/facts\/\d+\/(?:text|discovery\/condition)$/u.test(path)
    || /^\/situation\/goals\/\d+\/(?:desire|concern|boundary)$/u.test(path)
    || /^\/situation\/(?:beliefs|possibilities)\/\d+\/text$/u.test(path)
    || /^\/situation\/threads\/\d+\/(?:title|question|closureSignals\/\d+)$/u.test(path)
}

/** Shared citation surface; historical output schemas keep their exact bytes. */
export function chatOpeningCitationPathsV1(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1) {
  parseChatSituationCandidatesV1(candidates, source)
  return {
    source: stringPaths(source).filter(sourceCitationPath),
    options: candidates.options.map(option => ({optionKey: option.optionKey, paths: stringPaths(option).filter(optionCitationPath)})),
  }
}

export function chatOpeningReviewOutputSchemaV1(
  source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1,
): NonNullable<ChatRequestOptions['jsonSchema']> {
  parseChatSituationCandidatesV1(candidates, source)
  const text = (maxLength: number) => ({type: 'string', minLength: 1, maxLength})
  const object = (properties: Record<string, unknown>) =>
    ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false})
  const array = (items: unknown, minItems: number, maxItems: number) => ({type: 'array', items, minItems, maxItems})
  const choice = (values: string[]) => ({type: 'string', enum: values})
  const evidence = (target: 'source' | 'option', paths: string[]) =>
    object({target: choice([target]), pointer: choice(paths), quote: text(800)})
  const options = candidates.options.map(option => {
    const directions = option.situation.possibilities.flatMap((direction, possibilityIndex) => {
      const goals = option.situation.goals.filter(goal => goal.actorKey === direction.actorKey)
      const facts = option.situation.facts.filter(fact =>
        direction.evidenceFactKeys.includes(fact.factKey) && fact.audienceKeys.includes(direction.actorKey))
      if (!goals.length || !facts.length) return []
      return [object({
        actorKey: choice([direction.actorKey]), goalKey: choice(goals.map(goal => goal.goalKey)),
        possibilityIndex: {type: 'integer', enum: [possibilityIndex]},
        basisFactKeys: array(choice(facts.map(fact => fact.factKey)), 1, Math.min(3, facts.length)),
        mode: choice(['act', 'wait']), expectedChange: text(600), unresolved: text(600),
      })]
    })
    return object({
      optionKey: choice([option.optionKey]),
      agency: {anyOf: [{type: 'null'}, ...directions]},
      checks: array(object({
        check: choice([...CHAT_OPENING_CHECKS]), passed: {type: 'boolean'}, reason: text(1000),
        evidence: array({anyOf: [
          {$ref: '#/$defs/sourceEvidence'}, evidence('option', stringPaths(option).filter(optionCitationPath)),
        ]}, 1, 4),
      }), CHAT_OPENING_CHECKS.length, CHAT_OPENING_CHECKS.length),
    })
  })
  return {name: 'chat_opening_review_v1', strict: true, schema: {
    ...object({options: array({anyOf: options}, options.length, options.length)}),
    $defs: {sourceEvidence: evidence('source', stringPaths(source).filter(sourceCitationPath))},
  }}
}

/** A branch-free transport schema for constrained decoders. Cross-field
 * relations are still checked by parseChatOpeningReviewDraftV1 against the
 * exact option; a provider accepting this schema never authorizes adoption.
 * V1 stays byte-for-byte unchanged for historical execution bindings. */
export function chatOpeningReviewOutputSchemaV2(
  source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1,
): NonNullable<ChatRequestOptions['jsonSchema']> {
  return flatReviewSchema(source, candidates, 2)
}

export function chatOpeningReviewOutputSchemaV3(
  source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1,
): NonNullable<ChatRequestOptions['jsonSchema']> {
  return flatReviewSchema(source, candidates, 3)
}

function flatReviewSchema(source: ChatNarrativeProductionSourceV1, candidates: ChatSituationCandidatesV1, version: 2 | 3): NonNullable<ChatRequestOptions['jsonSchema']> {
  parseChatSituationCandidatesV1(candidates, source)
  const text = (maxLength: number) => ({type: 'string', minLength: 1, maxLength})
  const object = (properties: Record<string, unknown>) =>
    ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false})
  const array = (items: unknown, minItems: number, maxItems: number) => ({type: 'array', items, minItems, maxItems})
  const choice = (values: string[]) => ({type: 'string', enum: [...new Set(values)]})
  const actors = source.participants.map(p => p.participantKey)
  const options = candidates.options
  const facts = options.flatMap(o => o.situation.facts
    .filter(f => f.audienceKeys.some(key => actors.includes(key))).map(f => f.factKey))
  const maximumPossibilities = Math.max(...options.map(o => o.situation.possibilities.length))
  const agency = maximumPossibilities && facts.length ? {
    ...object({
      actorKey: choice(actors), goalKey: choice(options.flatMap(o => o.situation.goals.map(g => g.goalKey))),
      possibilityIndex: {type: 'integer', minimum: 0, maximum: maximumPossibilities - 1},
      basisFactKeys: array(choice(facts), 1, 3), mode: choice(['act', 'wait']),
      expectedChange: text(600), unresolved: text(600),
    }), type: ['object', 'null'],
  } : {type: 'null'}
  const development = maximumPossibilities && facts.length ? {
    ...object({mode: choice(['direct', 'adaptive', 'conversation', 'wait']),
      possibilityIndex: {type: 'integer', minimum: 0, maximum: maximumPossibilities - 1},
      basisFactKeys: array(choice(facts), 1, 3), expectedChange: text(600), unresolved: text(600),
    }), type: ['object', 'null'],
  } : {type: 'null'}
  const pointers = [
    ...stringPaths(source).filter(sourceCitationPath),
    ...options.flatMap(o => stringPaths(o).filter(optionCitationPath)),
  ]
  return {name: `chat_opening_review_v${version}`, strict: true, schema: object({
    options: array(object({
      optionKey: choice(options.map(o => o.optionKey)), agency,
      ...(version === 3 ? {development} : {}),
      checks: array(object({
        check: choice([...CHAT_OPENING_CHECKS]), passed: {type: 'boolean'}, reason: text(1000),
        evidence: array(object({target: choice(['source', 'option']), pointer: choice(pointers), quote: text(800)}), 1, 4),
      }), CHAT_OPENING_CHECKS.length, CHAT_OPENING_CHECKS.length),
    }), options.length, options.length),
  })}
}
