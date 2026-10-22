import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import * as p from './open-contract-parse'
import { evaluateTtrpgPredicateV1 } from './predicate'
import type { TtrpgPredicateEvaluationContextV1 } from './predicate'

export type { TtrpgContextTriggerLogicV1, TtrpgContextAudienceV1, TtrpgContextTriggerV1 } from './context-trigger-contract'
import { normalizeTtrpgContextTextV1, parseTtrpgContextTriggerDefinitionV1, type TtrpgContextAudienceV1, type TtrpgContextTriggerV1 } from './context-trigger-contract'
export interface TtrpgContextTriggerStateV1 {
  triggerKey: string
  matchedWorldTurn?: number
  lastMatchedWorldTurn?: number
  lastTriggeredWorldTurn?: number
  stickyUntilWorldTurn?: number
  cooldownUntilWorldTurn?: number
}

export interface TtrpgContextViewerV1 {
  audience: TtrpgContextAudienceV1
  actorKey?: string
}

export interface TtrpgContextInjectionV1 {
  triggerKey: string
  sourceKey: string | null
  sourceRefs: string[]
  injectText: string
  text: string
  audience: TtrpgContextAudienceV1
  knownByActorKeys: string[]
  group: string | null
  priority: number
  matchedBy: 'text-match' | 'predicate' | 'both' | 'always' | 'sticky'
}

export interface TtrpgContextTriggerSelectionInputV1 {
  triggers: readonly TtrpgContextTriggerV1[]
  worldTurn: number
  text?: string
  inputText?: string
  predicateContext?: TtrpgPredicateEvaluationContextV1
  evaluatePredicate?: (predicate: NonNullable<TtrpgContextTriggerV1['predicate']>) => boolean
  viewer?: TtrpgContextViewerV1
  audience?: TtrpgContextAudienceV1
  actorKey?: string | null
  triggerStates?: readonly TtrpgContextTriggerStateV1[] | Readonly<Record<string, TtrpgContextTriggerStateV1>>
  states?: readonly TtrpgContextTriggerStateV1[] | Readonly<Record<string, TtrpgContextTriggerStateV1>>
  history?: readonly TtrpgContextTriggerStateV1[] | Readonly<Record<string, TtrpgContextTriggerStateV1>>
  [key: string]: unknown
}

const AUDIENCES = ['gm-only', 'party', 'private', 'public'] as const
const MAX_WORLD_TURNS = 1_000_000
const AUDIENCE_RANK: Readonly<Record<TtrpgContextAudienceV1, number>> = {
  public: 0,
  party: 1,
  private: 2,
  'gm-only': 3,
}

function fail(message: string): never {
  return p.fail(`[ttrpg-context-trigger] ${message}`)
}


function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function containsWholeWord(text: string, pattern: string): boolean {
  if (!pattern) return false
  if (hasCjk(pattern)) return text.includes(pattern)
  const expression = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(pattern)}(?=$|[^\\p{L}\\p{N}_])`,
    'iu',
  )
  return expression.test(text)
}

function registeredSourceRefs(value: unknown, label: string): string[] {
  const refs = p.keys(value, label, 128, 0)
  for (const sourceKey of refs) {
    if (!CONTEXT_SOURCE_BY_KEY.has(sourceKey)) {
      fail(`${label}含未登记 sourceKey:${sourceKey}`)
    }
  }
  return refs
}

export function parseTtrpgContextTriggerV1(value: unknown): TtrpgContextTriggerV1 {
  const result = parseTtrpgContextTriggerDefinitionV1(value)
  registeredSourceRefs(result.sourceRefs, 'contextTrigger.sourceRefs')
  return result
}

function stateMap(
  input: TtrpgContextTriggerSelectionInputV1,
): ReadonlyMap<string, TtrpgContextTriggerStateV1> {
  const candidate = input.triggerStates ?? input.states ?? input.history
  if (!candidate) return new Map()
  if (Array.isArray(candidate)) {
    return new Map(candidate.map(state => [state.triggerKey, state]))
  }
  return new Map(Object.entries(candidate))
}

function viewerFor(input: TtrpgContextTriggerSelectionInputV1): TtrpgContextViewerV1 {
  const viewer = input.viewer ?? {
    audience: input.audience ?? 'public',
    ...(input.actorKey == null ? {} : { actorKey: input.actorKey }),
  }
  const audience = p.oneOf(viewer.audience, AUDIENCES, 'contextSelection.viewer.audience')
  if (viewer.actorKey !== undefined) p.key(viewer.actorKey, 'contextSelection.viewer.actorKey')
  return { audience, actorKey: viewer.actorKey }
}

function audienceVisible(trigger: TtrpgContextTriggerV1, viewer: TtrpgContextViewerV1): boolean {
  if (viewer.audience === 'gm-only') return true
  if (AUDIENCE_RANK[trigger.audience] > AUDIENCE_RANK[viewer.audience]) {
    return false
  }
  if (trigger.audience === 'private') {
    return viewer.actorKey !== undefined && trigger.knownByActorKeys.includes(viewer.actorKey)
  }
  return true
}

function stateNumber(
  state: TtrpgContextTriggerStateV1 | undefined,
  keys: readonly (
    'matchedWorldTurn'
    | 'lastMatchedWorldTurn'
    | 'lastTriggeredWorldTurn'
    | 'stickyUntilWorldTurn'
    | 'cooldownUntilWorldTurn'
  )[],
): number | undefined {
  for (const key of keys) {
    const value = state?.[key]
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_WORLD_TURNS) {
      fail(`trigger state ${String(key)} 必须是非负安全整数`)
    }
    return value
  }
  return undefined
}

function triggerMatches(
  trigger: TtrpgContextTriggerV1,
  inputText: string,
  predicateContext: TtrpgPredicateEvaluationContextV1 | undefined,
  evaluatePredicate?: TtrpgContextTriggerSelectionInputV1['evaluatePredicate'],
): { matched: boolean; matchedBy: TtrpgContextInjectionV1['matchedBy'] } {
  const textMatched = trigger.textPatterns.some(pattern => containsWholeWord(inputText, pattern))
  const predicateMatched = trigger.predicate === null
    ? false
    : evaluatePredicate ? evaluatePredicate(trigger.predicate)
    : predicateContext === undefined
      ? fail(`trigger ${trigger.triggerKey} 求值缺少 predicateContext`)
      : evaluateTtrpgPredicateV1(trigger.predicate, predicateContext)
  if (trigger.logic === 'always') return { matched: true, matchedBy: 'always' }
  if (trigger.logic === 'text-match') return { matched: textMatched, matchedBy: 'text-match' }
  if (trigger.logic === 'predicate') return { matched: predicateMatched, matchedBy: 'predicate' }
  return { matched: textMatched && predicateMatched, matchedBy: 'both' }
}

export function matchesTtrpgContextTriggerV1(trigger: TtrpgContextTriggerV1, input: Pick<TtrpgContextTriggerSelectionInputV1, 'text' | 'inputText' | 'predicateContext' | 'evaluatePredicate'>): boolean {
  return triggerMatches(parseTtrpgContextTriggerV1(trigger), normalizeTtrpgContextTextV1(input.text ?? input.inputText ?? ''), input.predicateContext, input.evaluatePredicate).matched
}

function selectionAllowedByTiming(
  trigger: TtrpgContextTriggerV1,
  worldTurn: number,
  state: TtrpgContextTriggerStateV1 | undefined,
): { allowed: boolean; sticky: boolean } {
  const lastTriggered = stateNumber(state, ['lastTriggeredWorldTurn'])
  const stickyUntil = stateNumber(state, ['stickyUntilWorldTurn'])
    ?? (lastTriggered === undefined ? undefined : lastTriggered + trigger.timing.stickyWorldTurns)
  const sticky = trigger.timing.stickyWorldTurns > 0 && lastTriggered !== undefined
    && stickyUntil !== undefined
    && worldTurn >= lastTriggered
    && worldTurn <= stickyUntil
  if (sticky) return { allowed: true, sticky: true }

  const cooldownUntil = stateNumber(state, ['cooldownUntilWorldTurn'])
    ?? (lastTriggered === undefined || trigger.timing.cooldownWorldTurns === 0 ? undefined : lastTriggered + trigger.timing.cooldownWorldTurns + 1)
  if (cooldownUntil !== undefined && worldTurn < cooldownUntil) return { allowed: false, sticky: false }

  if (trigger.timing.delayWorldTurns > 0) {
    const matchedWorldTurn = stateNumber(state, ['matchedWorldTurn', 'lastMatchedWorldTurn'])
    if (matchedWorldTurn === undefined || worldTurn < matchedWorldTurn + trigger.timing.delayWorldTurns) {
      return { allowed: false, sticky: false }
    }
  }
  return { allowed: true, sticky: false }
}

function betterTrigger(
  left: TtrpgContextTriggerV1,
  right: TtrpgContextTriggerV1,
): TtrpgContextTriggerV1 {
  return left.priority > right.priority
    || (left.priority === right.priority && left.triggerKey < right.triggerKey)
    ? left
    : right
}

export function selectTtrpgContextInjectionsV1(
  input: TtrpgContextTriggerSelectionInputV1,
): TtrpgContextInjectionV1[] {
  if (!Number.isSafeInteger(input.worldTurn) || input.worldTurn < 0 || input.worldTurn > MAX_WORLD_TURNS) {
    fail('worldTurn 必须是非负安全整数')
  }
  const viewer = viewerFor(input)
  const states = stateMap(input)
  const normalizedText = normalizeTtrpgContextTextV1(input.text ?? input.inputText ?? '')
  const candidates: Array<{ trigger: TtrpgContextTriggerV1; matchedBy: TtrpgContextInjectionV1['matchedBy'] }> = []

  for (const rawTrigger of input.triggers) {
    const trigger = parseTtrpgContextTriggerV1(rawTrigger)
    if (!audienceVisible(trigger, viewer)) continue
    const timing = selectionAllowedByTiming(trigger, input.worldTurn, states.get(trigger.triggerKey))
    if (!timing.allowed) continue
    const match = timing.sticky
      ? { matched: true, matchedBy: 'sticky' as const }
      : triggerMatches(trigger, normalizedText, input.predicateContext, input.evaluatePredicate)
    if (match.matched) candidates.push({ trigger, matchedBy: match.matchedBy })
  }

  const selectedByGroup = new Map<string, { trigger: TtrpgContextTriggerV1; matchedBy: TtrpgContextInjectionV1['matchedBy'] }>()
  const selectedUngrouped: Array<{ trigger: TtrpgContextTriggerV1; matchedBy: TtrpgContextInjectionV1['matchedBy'] }> = []
  for (const candidate of candidates) {
    if (candidate.trigger.group === null) {
      selectedUngrouped.push(candidate)
      continue
    }
    const previous = selectedByGroup.get(candidate.trigger.group)
    if (!previous) selectedByGroup.set(candidate.trigger.group, candidate)
    else if (betterTrigger(candidate.trigger, previous.trigger) === candidate.trigger) selectedByGroup.set(candidate.trigger.group, candidate)
  }

  return [...selectedUngrouped, ...selectedByGroup.values()]
    .sort((left, right) => right.trigger.priority - left.trigger.priority
      || (left.trigger.triggerKey < right.trigger.triggerKey ? -1 : left.trigger.triggerKey > right.trigger.triggerKey ? 1 : 0))
    .map(({ trigger, matchedBy }) => ({
      triggerKey: trigger.triggerKey,
      sourceKey: trigger.sourceRefs[0] ?? null,
      sourceRefs: [...trigger.sourceRefs],
      injectText: trigger.injectText,
      text: trigger.injectText,
      audience: trigger.audience,
      knownByActorKeys: [...trigger.knownByActorKeys],
      group: trigger.group,
      priority: trigger.priority,
      matchedBy,
    }))
}
