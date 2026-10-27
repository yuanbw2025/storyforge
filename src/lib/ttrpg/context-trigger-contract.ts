/** Pure authored trigger definition, shared by runtime selection and immutable product contracts. */
import type { TtrpgOpenAudience, TtrpgPredicateV1 } from './open-contract'
import * as p from './open-contract-parse'
import { parseTtrpgPredicateV1 } from './predicate'
const LOGICS = ['text-match', 'predicate', 'both', 'always'] as const
const AUDIENCES = ['gm-only', 'party', 'private', 'public'] as const
const MAX_WORLD_TURNS = 1_000_000
const fail = (message: string): never => p.fail(`[ttrpg-context-trigger] ${message}`)
export const TTRPG_CONTEXT_TEXT_NORMALIZATION_V1 = 'nfkc-unicode-lowercase-whitespace-v1' as const
export function normalizeTtrpgContextTextV1(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}
export type TtrpgContextTriggerLogicV1 = 'text-match' | 'predicate' | 'both' | 'always'
export type TtrpgContextAudienceV1 = TtrpgOpenAudience

export interface TtrpgContextTriggerV1 {
  triggerKey: string
  logic: TtrpgContextTriggerLogicV1
  textPatterns: string[]
  predicate: TtrpgPredicateV1 | null
  audience: TtrpgContextAudienceV1
  knownByActorKeys: string[]
  injectText: string
  group: string | null
  priority: number
  timing: {
    stickyWorldTurns: number
    cooldownWorldTurns: number
    delayWorldTurns: number
  }
  sourceRefs: string[]
}

function parseTiming(value: unknown, label: string): TtrpgContextTriggerV1['timing'] {
  const row = p.record(value, ['stickyWorldTurns', 'cooldownWorldTurns', 'delayWorldTurns'], label)
  return {
    stickyWorldTurns: p.integer(row.stickyWorldTurns, `${label}.stickyWorldTurns`, 0, MAX_WORLD_TURNS),
    cooldownWorldTurns: p.integer(row.cooldownWorldTurns, `${label}.cooldownWorldTurns`, 0, MAX_WORLD_TURNS),
    delayWorldTurns: p.integer(row.delayWorldTurns, `${label}.delayWorldTurns`, 0, MAX_WORLD_TURNS),
  }
}

export function parseTtrpgContextTriggerDefinitionV1(value: unknown): TtrpgContextTriggerV1 {
  const row = p.record(p.json(value), [
    'triggerKey', 'logic', 'textPatterns', 'predicate', 'audience', 'knownByActorKeys',
    'injectText', 'group', 'priority', 'timing', 'sourceRefs',
  ], 'contextTrigger')
  const logic = p.oneOf(row.logic, LOGICS, 'contextTrigger.logic')
  const textPatterns = p.texts(row.textPatterns, 'contextTrigger.textPatterns', 64, 0)
    .map(normalizeTtrpgContextTextV1)
  const uniquePatterns = [...new Set(textPatterns)]
  const predicate = p.nullable(row.predicate, parseTtrpgPredicateV1, 'contextTrigger.predicate')
  const audience = p.oneOf(row.audience, AUDIENCES, 'contextTrigger.audience')
  const knownByActorKeys = p.keys(row.knownByActorKeys, 'contextTrigger.knownByActorKeys', 256, 0)
  const injectText = p.text(row.injectText, 'contextTrigger.injectText', 20_000)
  const group = p.nullable(row.group, p.key, 'contextTrigger.group')
  const priority = p.integer(row.priority, 'contextTrigger.priority', 0, 100)
  const timing = parseTiming(row.timing, 'contextTrigger.timing')
  const sourceRefs = p.keys(row.sourceRefs, 'contextTrigger.sourceRefs', 128, 0)

  if (logic === 'text-match' && (uniquePatterns.length === 0 || predicate !== null)) {
    fail('text-match 必须有 textPatterns 且 predicate 必须为 null')
  }
  if (logic === 'predicate' && (uniquePatterns.length !== 0 || predicate === null)) {
    fail('predicate 必须只有 predicate 且 textPatterns 必须为空')
  }
  if (logic === 'both' && (uniquePatterns.length === 0 || predicate === null)) {
    fail('both 必须同时有 textPatterns 与 predicate')
  }
  if (logic === 'always' && (uniquePatterns.length !== 0 || predicate !== null)) {
    fail('always 不得携带 textPatterns 或 predicate')
  }
  if (audience === 'private' && knownByActorKeys.length === 0) {
    fail('private trigger 必须有 knownByActorKeys')
  }

  return {
    triggerKey: p.key(row.triggerKey, 'contextTrigger.triggerKey'),
    logic,
    textPatterns: uniquePatterns,
    predicate,
    audience,
    knownByActorKeys,
    injectText,
    group,
    priority,
    timing,
    sourceRefs,
  }
}
