import type {
  RuleActionDefinitionV1,
  TtrpgCharacterTemplateV1,
} from '../types'
import type { TtrpgPredicateEvaluationContextV1 } from './predicate'
import { evaluateTtrpgPredicateV1, serializeTtrpgPredicateV1 } from './predicate'
import type {
  RulePackV2,
  TtrpgCampaignContentV2,
  TtrpgOpenApprovalActorV1,
  TtrpgOpenCompanionPolicyV1,
  TtrpgOpenEffectPrimitiveV1,
  TtrpgOpenGenericCheckV1,
  TtrpgPredicateV1,
} from './open-contract'
import { companionPolicy as parseCompanionPolicy } from './open-content-templates'
import { parseRulePackV2 } from './rule-pack-v2'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_INTENT_ROUTES = [
  'existing-action',
  'generic-check',
  'oracle',
  'no-roll',
  'needs-clarification',
  'rejected',
] as const

export type TtrpgOpenIntentRouteV1 = typeof TTRPG_OPEN_INTENT_ROUTES[number]
export type TtrpgOpenIntentActionKindV1 =
  | 'observe'
  | 'talk'
  | 'assist'
  | 'move'
  | 'low-risk-check'
  | 'other'
export type TtrpgOpenIntentConfirmationReasonKindV1 =
  | 'irreversible'
  | 'resource-spend'
  | 'party-relation-change'
  | 'secret-reveal'

const CONFIRMATION_REASON_KINDS = [
  'irreversible',
  'resource-spend',
  'party-relation-change',
  'secret-reveal',
] as const satisfies readonly TtrpgOpenIntentConfirmationReasonKindV1[]

const MAX_RISK_ITEMS = 5
const MAX_COST_ITEMS = 5
const COMPANION_ACTION_LIMIT_PER_WORLD_TURN = 1

export interface TtrpgOpenIntentV1 {
  intentKey: string
  clarificationThreadKey: string
  actorKey: string
  goal: string
  method: string | null
  targetRefs: string[]
  declaredResources: string[]
  declaredAssumptions: string[]
  requestedOutcome: string | null
  source: 'player' | `companion:${string}` | 'gm'
  inputRevision: string
}

export interface TtrpgOpenIntentTargetMethodV1 {
  targetRefs: string[]
  method: string | null
}

export interface TtrpgOpenIntentResolutionBindingV1 {
  actorKey: string
  targetRefs: string[]
  method: string | null
  actionKey: string | null
  checkKey: string | null
  oracleKey: string | null
  interactionKey?: string
}

export type TtrpgOpenIntentAuthorizationV1 =
  | 'not-applicable'
  | 'preauthorized'
  | 'requires-confirmation'
  | 'blocked'

export interface TtrpgOpenIntentPreviewV1 {
  intentKey: string
  route: TtrpgOpenIntentRouteV1
  routeDetail: {
    actionKey: string | null
    checkKey: string | null
    oracleKey: string | null
    interactionKey?: string
  }
  actionKind: TtrpgOpenIntentActionKindV1
  isRetreat: boolean
  riskSummary: string[]
  possibleCosts: string[]
  irreversible: boolean
  unsatisfiedPredicates: string[]
  missingFields: Array<'goal' | 'method' | 'targetRefs'>
  requiresConfirmation: boolean
  confirmationReasonKinds: TtrpgOpenIntentConfirmationReasonKindV1[]
  targetMethod: TtrpgOpenIntentTargetMethodV1
  resolutionBinding: TtrpgOpenIntentResolutionBindingV1
  affectedActorKeys: string[]
  timeCostWorldTurns: number
  authorization: TtrpgOpenIntentAuthorizationV1
  confirmationApproverSeatKeys: string[]
  confirmationApproverActorKeys: string[]
}

export interface TtrpgOpenIntentCompanionStateV1 {
  consecutiveActions: number
  lastActedWorldTurn: number | null
}

export interface TtrpgOpenIntentRoutingSnapshotV1 {
  rulePack: RulePackV2
  campaign?: TtrpgCampaignContentV2
  companionPolicy?: TtrpgOpenCompanionPolicyV1
  actors?: readonly TtrpgOpenApprovalActorV1[]
  characterTemplates?: readonly TtrpgCharacterTemplateV1[]
  predicateContext: TtrpgPredicateEvaluationContextV1
  companionStates?: Readonly<Record<string, TtrpgOpenIntentCompanionStateV1>>
  companions?: Readonly<Record<string, TtrpgOpenIntentCompanionStateV1>>
  clarificationCounts?: Readonly<Record<string, number>>
}

export interface TtrpgOpenIntentRouteRequestV1 {
  intent: unknown
  snapshot?: TtrpgOpenIntentRoutingSnapshotV1
  state?: TtrpgOpenIntentRoutingSnapshotV1
}

function fail(message: string): never {
  return p.fail(`open-intent: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseSource(value: unknown, label: string): TtrpgOpenIntentV1['source'] {
  const source = p.text(value, label, 220)
  if (source === 'player' || source === 'gm') return source
  if (source.startsWith('companion:')) {
    return `companion:${p.key(source.slice('companion:'.length), `${label}.actorKey`)}`
  }
  return p.fail(`${label}: source 无效`)
}

export function parseTtrpgOpenIntentV1(value: unknown): TtrpgOpenIntentV1 {
  const row = p.record(p.json(value), [
    'intentKey',
    'clarificationThreadKey',
    'actorKey',
    'goal',
    'method',
    'targetRefs',
    'declaredResources',
    'declaredAssumptions',
    'requestedOutcome',
    'source',
    'inputRevision',
  ], 'openIntentV1')
  return {
    intentKey: p.key(row.intentKey, 'openIntentV1.intentKey'),
    clarificationThreadKey: p.key(row.clarificationThreadKey, 'openIntentV1.clarificationThreadKey'),
    actorKey: p.key(row.actorKey, 'openIntentV1.actorKey'),
    goal: p.text(row.goal, 'openIntentV1.goal', 2_000),
    method: p.nullable(row.method, (item, label) => p.text(item, label, 2_000), 'openIntentV1.method'),
    targetRefs: p.keys(row.targetRefs, 'openIntentV1.targetRefs', 16),
    declaredResources: p.keys(row.declaredResources, 'openIntentV1.declaredResources', 16),
    declaredAssumptions: p.texts(row.declaredAssumptions, 'openIntentV1.declaredAssumptions', 8),
    requestedOutcome: p.nullable(row.requestedOutcome, (item, label) => p.text(item, label, 500), 'openIntentV1.requestedOutcome'),
    source: parseSource(row.source, 'openIntentV1.source'),
    inputRevision: p.hash(row.inputRevision, 'openIntentV1.inputRevision'),
  }
}

function normalizedText(value: string | null): string {
  return value == null ? '' : value.normalize('NFC').toLocaleLowerCase()
}

function intentText(intent: TtrpgOpenIntentV1): string {
  return [
    intent.goal,
    intent.method,
    intent.requestedOutcome,
    ...intent.declaredAssumptions,
  ].filter((value): value is string => value !== null).map(normalizedText).join('\u0000')
}

function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some(term => text.includes(term))
}

function uniqueLimited(values: readonly string[], maximum: number): string[] {
  return [...new Set(values)].slice(0, maximum)
}

function actorFromSource(
  intent: TtrpgOpenIntentV1,
  actors: readonly ActorRecord[],
): { actor: ActorRecord | null; rejection: string | null } {
  const actor = actors.find(candidate => candidate.characterKey === intent.actorKey) ?? null
  if (!actor) return { actor: null, rejection: '行动者不在当前冻结角色集合中' }
  if (intent.source === 'player') {
    if (actor.controller !== 'human' && actor.controller !== 'hybrid') {
      return { actor, rejection: 'AI 或主持角色不能冒充真人玩家提交意图' }
    }
    return { actor, rejection: null }
  }
  if (intent.source === 'gm') {
    if (actor.controller !== 'gm') return { actor, rejection: 'gm 意图必须绑定主持角色' }
    return { actor, rejection: null }
  }
  const companionKey = intent.source.slice('companion:'.length)
  if (companionKey !== intent.actorKey) return { actor, rejection: '队友来源与行动者不一致' }
  if (actor.role !== 'player' || (actor.controller !== 'ai' && actor.controller !== 'hybrid')) {
    return { actor, rejection: '只有 AI/hybrid 玩家队友可以提交 companion 意图' }
  }
  return { actor, rejection: null }
}

type ActorRecord = TtrpgOpenApprovalActorV1 & {
  actionKeys?: readonly string[]
  name?: string
}

type EffectLike = TtrpgOpenEffectPrimitiveV1 | RuleActionDefinitionV1['effects'][number]

function toActorRecords(snapshot: TtrpgOpenIntentRoutingSnapshotV1): ActorRecord[] {
  const source = snapshot.characterTemplates ?? snapshot.actors ?? snapshot.campaign?.characterTemplates
  if (!source || !Array.isArray(source)) return fail('routing snapshot 缺少角色集合')
  return source.map(item => item as ActorRecord)
}

function toCompanionPolicy(snapshot: TtrpgOpenIntentRoutingSnapshotV1): TtrpgOpenCompanionPolicyV1 {
  const value = snapshot.companionPolicy ?? snapshot.campaign?.companionPolicy
  if (!value) return fail('routing snapshot 缺少 companionPolicy')
  return parseCompanionPolicy(value, 'routing.companionPolicy')
}

function toCampaign(snapshot: TtrpgOpenIntentRoutingSnapshotV1): TtrpgCampaignContentV2 | null {
  return snapshot.campaign ?? null
}

function textMatchesDefinition(
  intent: TtrpgOpenIntentV1,
  definition: { key: string; name?: string; title?: string },
): boolean {
  const method = normalizedText(intent.method)
  const goal = normalizedText(intent.goal)
  const candidates = [definition.key, definition.name, definition.title]
    .filter((value): value is string => Boolean(value))
    .map(normalizedText)
  return candidates.some(candidate => method === candidate || method.includes(candidate) || goal.includes(candidate))
}

function explicitActionMatch(intent: TtrpgOpenIntentV1, actions: readonly RuleActionDefinitionV1[]): RuleActionDefinitionV1 | null {
  return actions.find(action => textMatchesDefinition(intent, action)) ?? null
}

function explicitGenericCheckMatch(intent: TtrpgOpenIntentV1, checks: readonly TtrpgOpenGenericCheckV1[]): TtrpgOpenGenericCheckV1 | null {
  return checks.find(check => textMatchesDefinition(intent, { key: check.checkKey, title: check.title })) ?? null
}

function explicitOracleMatch(intent: TtrpgOpenIntentV1, rulePack: RulePackV2): RulePackV2['oracles'][number] | null {
  return rulePack.oracles.find(oracle => textMatchesDefinition(intent, {
    key: oracle.oracleKey,
    title: oracle.title,
  })) ?? null
}

function inferActionKind(text: string, definition: { key?: string; name?: string; title?: string } | null, defaultKind: TtrpgOpenIntentActionKindV1): TtrpgOpenIntentActionKindV1 {
  const source = `${text}\u0000${normalizedText(definition?.key ?? null)}\u0000${normalizedText(definition?.name ?? definition?.title ?? null)}`
  if (containsAny(source, ['撤退', '退却', '逃跑', '逃离', 'retreat', 'withdraw', 'flee'])) return 'move'
  if (containsAny(source, ['观察', '调查', '侦查', '查看', '搜索', 'look', 'observe', 'investigate', 'search'])) return 'observe'
  if (containsAny(source, ['交谈', '对话', '询问', '说服', '欺骗', '鼓舞', '威慑', 'talk', 'speak', 'persuade', 'influence'])) return 'talk'
  if (containsAny(source, ['协助', '帮助', '保护', '救助', 'assist', 'help'])) return 'assist'
  if (containsAny(source, ['移动', '前往', '离开', '旅行', 'move', 'travel'])) return 'move'
  if (defaultKind !== 'other') return defaultKind
  return 'other'
}

function isRetreat(text: string): boolean {
  return containsAny(text, ['撤退', '退却', '逃跑', '逃离', '脱离战斗', 'retreat', 'withdraw', 'flee'])
}

function overreachReason(intent: TtrpgOpenIntentV1, actors: readonly ActorRecord[]): string | null {
  const text = intentText(intent)
  if (containsAny(text, [
    '改规则',
    '修改规则',
    '改变规则',
    '改写规则',
    '改世界事实',
    '修改世界事实',
    '改写世界',
    'retcon',
    'change the rules',
    'rewrite canon',
    'rewrite the world',
  ])) return '自由意图不能改写冻结规则或世界事实'
  if (containsAny(text, [
    '代替他人决定',
    '替别人决定',
    '替他人决定',
    '替别人选择',
    '替他人选择',
    'decide for',
    'choose for',
    '假扮真人',
    'pretend to be',
  ])) return '自由意图不能替其他真人作决定'
  const humanTarget = intent.targetRefs.some(target => actors.some(actor =>
    actor.characterKey === target && (actor.controller === 'human' || actor.controller === 'hybrid')))
  if (humanTarget && containsAny(text, ['秘密', '私人物品', '个人资源', 'secret', 'private resource'])) {
    return '涉及其他真人的秘密或个人资源必须由该真人单独授权'
  }
  return null
}

function knownRefs(
  context: TtrpgPredicateEvaluationContextV1,
  actors: readonly ActorRecord[],
  campaign: TtrpgCampaignContentV2 | null,
): Set<string> {
  const refs = new Set(context.knownRefs ?? [])
  for (const actor of actors) refs.add(actor.characterKey)
  for (const binding of campaign?.entityBindings ?? []) refs.add(binding.bindingKey)
  for (const entry of campaign?.frozenWorldPredicateIndex.entries ?? []) {
    refs.add(entry.subjectRef)
    if (entry.objectRef !== null) refs.add(entry.objectRef)
  }
  for (const oracle of campaign?.situationTemplates ?? []) refs.add(oracle.templateKey)
  return refs
}

function unsatisfiedPredicates(
  predicates: readonly TtrpgPredicateV1[],
  context: TtrpgPredicateEvaluationContextV1,
): { values: string[]; error: string | null } {
  const values: string[] = []
  for (const predicate of predicates) {
    try {
      if (!evaluateTtrpgPredicateV1(predicate, context)) values.push(serializeTtrpgPredicateV1(predicate))
    } catch (error) {
      return { values, error: error instanceof Error ? error.message : '谓词无法求值' }
    }
  }
  return { values, error: null }
}

function effectOperation(effect: EffectLike): string {
  if ('operation' in effect) return effect.operation
  if (effect.kind === 'resource') return effect.delta < 0 ? 'resource.spend' : 'resource.gain'
  if (effect.kind === 'damage') return 'damage'
  if (effect.kind === 'condition') return 'condition.apply'
  return effect.kind
}

function effectTarget(effect: EffectLike): string | null {
  return 'targetRef' in effect ? effect.targetRef : null
}

function effectsForCheck(
  check: TtrpgOpenGenericCheckV1,
  campaign: TtrpgCampaignContentV2 | null,
): EffectLike[] {
  const planKeys = Object.values(check.effectPlanByDegree).filter((value): value is string => value !== null)
  return (campaign?.effectPlanTemplates ?? [])
    .filter(plan => planKeys.includes(plan.planKey))
    .flatMap(plan => plan.effects as EffectLike[])
}

function actionEffects(action: RuleActionDefinitionV1): EffectLike[] {
  return action.effects as EffectLike[]
}

function actionKindFor(
  intent: TtrpgOpenIntentV1,
  definition: { key?: string; name?: string; title?: string } | null,
  defaultKind: TtrpgOpenIntentActionKindV1,
): TtrpgOpenIntentActionKindV1 {
  return inferActionKind(intentText(intent), definition, defaultKind)
}

function riskAndCosts(input: {
  action: RuleActionDefinitionV1 | null
  check: TtrpgOpenGenericCheckV1 | null
  campaign: TtrpgCampaignContentV2 | null
  timeCostWorldTurns: number
}): { riskSummary: string[]; possibleCosts: string[]; irreversible: boolean; reasons: Set<TtrpgOpenIntentConfirmationReasonKindV1> } {
  const effects = input.action
    ? actionEffects(input.action)
    : input.check
      ? effectsForCheck(input.check, input.campaign)
      : []
  const riskSummary: string[] = []
  const possibleCosts: string[] = []
  const reasons = new Set<TtrpgOpenIntentConfirmationReasonKindV1>()
  const irreversibleOperations = [
    'item.remove',
    'item.transfer',
    'ability.disable',
    'advancement.choice',
    'reputation',
    'faction',
    'relationship',
    'wanted',
    'debt',
    'secret.reveal',
    'quest.set',
    'location.set',
    'world-fact.candidate',
  ]
  const relationOperations = ['reputation', 'faction', 'relationship', 'wanted', 'debt']
  const secretOperations = ['secret.reveal']
  for (const effect of effects) {
    const operation = effectOperation(effect)
    if (irreversibleOperations.includes(operation)) reasons.add('irreversible')
    if (relationOperations.includes(operation)) reasons.add('party-relation-change')
    if (secretOperations.includes(operation)) reasons.add('secret-reveal')
    if (operation === 'damage' || operation === 'condition.apply') {
      riskSummary.push('可能改变角色状态')
    }
    if (operation === 'resource.spend') {
      reasons.add('resource-spend')
      possibleCosts.push(`可能消耗资源${effectTarget(effect) ? `（${effectTarget(effect)}）` : ''}`)
    }
    if (operation === 'secret.reveal') riskSummary.push('可能公开受保护信息')
    if (relationOperations.includes(operation)) riskSummary.push('可能改变队伍或角色关系')
  }
  if (input.action) {
    if (input.action.description) riskSummary.push(input.action.description)
    if (input.action.costResourceKey !== null && input.action.costAmount > 0) {
      possibleCosts.push(`消耗 ${input.action.costResourceKey} × ${input.action.costAmount}`)
      reasons.add('resource-spend')
    }
    if (input.action.usage.mode === 'resource-cost'
      && input.action.usage.resourceKey !== null
      && input.action.usage.cost !== null
      && input.action.usage.cost > 0) {
      possibleCosts.push(`消耗 ${input.action.usage.resourceKey} × ${input.action.usage.cost}`)
      reasons.add('resource-spend')
    }
  }
  if (input.check) {
    for (const ref of input.check.riskFactRefs) riskSummary.push(`可能影响已声明风险事实：${ref}`)
    for (const cost of input.check.resourceCosts) {
      if (cost.amount > 0) {
        possibleCosts.push(`消耗 ${cost.resourceKey} × ${cost.amount}`)
        reasons.add('resource-spend')
      }
    }
  }
  if (input.timeCostWorldTurns > 0) possibleCosts.push(`耗时 ${input.timeCostWorldTurns} 个世界回合`)
  return {
    riskSummary: uniqueLimited(riskSummary, MAX_RISK_ITEMS),
    possibleCosts: uniqueLimited(possibleCosts, MAX_COST_ITEMS),
    irreversible: reasons.has('irreversible'),
    reasons,
  }
}

function requiredTargetMissing(
  action: RuleActionDefinitionV1 | null,
  check: TtrpgOpenGenericCheckV1 | null,
  targetRefs: readonly string[],
): boolean {
  if (action) return (action.target === 'single-ally' || action.target === 'single-enemy') && targetRefs.length !== 1
  if (check) return !check.targetKinds.includes('self') && targetRefs.length === 0
  return false
}

function actionTargetInvalid(action: RuleActionDefinitionV1, targetRefs: readonly string[]): boolean {
  if (action.target === 'single-ally' || action.target === 'single-enemy') return targetRefs.length !== 1
  if (action.target === 'self') return targetRefs.length > 0
  return false
}

function timeCostFor(input: {
  rulePack: RulePackV2
  action: RuleActionDefinitionV1 | null
  check: TtrpgOpenGenericCheckV1 | null
  route: TtrpgOpenIntentRouteV1
}): number {
  if (input.route === 'oracle') return input.rulePack.timePolicy.oracleConsultation
  if (input.route === 'no-roll') return input.rulePack.timePolicy.noRoll
  if (input.route === 'existing-action') {
    const override = input.rulePack.timePolicy.actionOverrides.find(item => item.actionKey === input.action?.key)
    return override?.timeCostWorldTurns ?? input.rulePack.timePolicy.existingAction
  }
  if (input.route === 'generic-check') return input.check?.timeCostWorldTurns ?? input.rulePack.timePolicy.genericCheck
  return 0
}

function confirmationApprovers(
  intent: TtrpgOpenIntentV1,
  actor: ActorRecord,
  policy: TtrpgOpenCompanionPolicyV1,
  actors: readonly ActorRecord[],
): { seats: string[]; actorKeys: string[] } {
  if (intent.source === 'companion:') return { seats: [], actorKeys: [] }
  if (intent.source.startsWith('companion:')) {
    const binding = policy.approvalBindings.find(item => item.companionActorKey === intent.actorKey)
    if (!binding) return { seats: [], actorKeys: [] }
    const approvers = actors.filter(candidate =>
      candidate.seatKey !== null
      && binding.approverSeatKeys.includes(candidate.seatKey)
      && candidate.characterKey !== actor.characterKey
      && candidate.role === 'player'
      && (candidate.controller === 'human' || candidate.controller === 'hybrid'))
    return {
      seats: approvers.flatMap(candidate => candidate.seatKey === null ? [] : [candidate.seatKey]),
      actorKeys: approvers.map(candidate => candidate.characterKey),
    }
  }
  if (intent.source === 'player' && actor.seatKey !== null) {
    return { seats: [actor.seatKey], actorKeys: [actor.characterKey] }
  }
  return { seats: [], actorKeys: [] }
}

function basePreview(intent: TtrpgOpenIntentV1, route: TtrpgOpenIntentRouteV1): TtrpgOpenIntentPreviewV1 {
  const targetMethod = { targetRefs: [...intent.targetRefs], method: intent.method }
  return {
    intentKey: intent.intentKey,
    route,
    routeDetail: { actionKey: null, checkKey: null, oracleKey: null },
    actionKind: 'other',
    isRetreat: isRetreat(intentText(intent)),
    riskSummary: [],
    possibleCosts: [],
    irreversible: false,
    unsatisfiedPredicates: [],
    missingFields: [],
    requiresConfirmation: false,
    confirmationReasonKinds: [],
    targetMethod,
    resolutionBinding: {
      actorKey: intent.actorKey,
      targetRefs: [...intent.targetRefs],
      method: intent.method,
      actionKey: null,
      checkKey: null,
      oracleKey: null,
    },
    affectedActorKeys: [intent.actorKey],
    timeCostWorldTurns: 0,
    authorization: route === 'rejected' ? 'blocked' : 'not-applicable',
    confirmationApproverSeatKeys: [],
    confirmationApproverActorKeys: [],
  }
}

function rejectedPreview(intent: TtrpgOpenIntentV1, reason: string): TtrpgOpenIntentPreviewV1 {
  const preview = basePreview(intent, 'rejected')
  preview.riskSummary = [reason]
  return preview
}

function clarificationPreview(
  intent: TtrpgOpenIntentV1,
  missingFields: Array<'goal' | 'method' | 'targetRefs'>,
  reason?: string,
): TtrpgOpenIntentPreviewV1 {
  const preview = basePreview(intent, 'needs-clarification')
  preview.missingFields = [...new Set(missingFields)]
  if (reason) preview.riskSummary = [reason]
  return preview
}

function companionLimitExceeded(
  intent: TtrpgOpenIntentV1,
  snapshot: TtrpgOpenIntentRoutingSnapshotV1,
): boolean {
  if (!intent.source.startsWith('companion:')) return false
  const states = snapshot.companionStates ?? snapshot.companions
  const state = states?.[intent.actorKey]
  if (!state || state.consecutiveActions < COMPANION_ACTION_LIMIT_PER_WORLD_TURN) return false
  return state.lastActedWorldTurn === null
    || state.lastActedWorldTurn === snapshot.predicateContext.worldTurn
}

function clarificationLimitReached(
  intent: TtrpgOpenIntentV1,
  snapshot: TtrpgOpenIntentRoutingSnapshotV1,
): boolean {
  return (snapshot.clarificationCounts?.[intent.clarificationThreadKey] ?? 0) >= 3
}

function routeWithSnapshot(intent: TtrpgOpenIntentV1, snapshot: TtrpgOpenIntentRoutingSnapshotV1): TtrpgOpenIntentPreviewV1 {
  const rulePack = parseRulePackV2(snapshot.rulePack)
  const campaign = toCampaign(snapshot)
  const actors = toActorRecords(snapshot)
  const policy = toCompanionPolicy(snapshot)
  const sourceBinding = actorFromSource(intent, actors)
  const base = basePreview(intent, 'rejected')
  base.affectedActorKeys = uniqueLimited([intent.actorKey, ...intent.targetRefs.filter(target => actors.some(actor => actor.characterKey === target))], 16)

  const overreach = overreachReason(intent, actors)
  if (overreach) return rejectedPreview(intent, overreach)
  if (sourceBinding.rejection) return rejectedPreview(intent, sourceBinding.rejection)
  if (companionLimitExceeded(intent, snapshot)) return rejectedPreview(intent, '同一 worldTurn 内每名 AI 队友最多执行一次行动')
  if (intent.source.startsWith('companion:') && !policy.approvalBindings.some(binding => binding.companionActorKey === intent.actorKey)) {
    return rejectedPreview(intent, 'AI 队友没有 Session Zero approvalBinding')
  }
  if (clarificationLimitReached(intent, snapshot)) return rejectedPreview(intent, '同一澄清线程已达到三次上限')

  const actor = sourceBinding.actor!
  const text = intentText(intent)
  const allRefs = knownRefs(snapshot.predicateContext, actors, campaign)
  const unknownTargets = intent.targetRefs.filter(target => allRefs.size > 0 && !allRefs.has(target))
  if (unknownTargets.length > 0) return clarificationPreview(intent, ['targetRefs'], '目标引用无法唯一绑定，请补充可识别的目标')

  // The method names one frozen interaction exactly. Natural-language keywords alone
  // cannot choose among distinct destinations, costs or consequences.
  const interactions = (rulePack.interactionBindings ?? []).filter(binding =>
    normalizedText(intent.method) === normalizedText(binding.interactionKey) || normalizedText(intent.method) === normalizedText(binding.title))
  if (interactions.length > 1) return clarificationPreview(intent,['method'],'互动名称不唯一，请指定冻结 interactionKey')
  const interaction = interactions[0]
  const action = interaction ? rulePack.actions.find(a => a.key === interaction.actionKey)! : explicitActionMatch(intent, rulePack.actions)
  if (!interaction && action && rulePack.interactionBindings?.some(b => b.actionKey === action.key)) {
    return clarificationPreview(intent,['method'],'该行动要求明确选择冻结互动，请指定 interactionKey')
  }
  if (interaction?.kind === 'retreat' && intent.source !== 'player') return rejectedPreview(intent,'撤退必须由控制角色的真人明确提出')
  const check = action === null ? explicitGenericCheckMatch(intent, rulePack.genericChecks) : null
  const oracle = action === null && check === null ? explicitOracleMatch(intent, rulePack) : null
  const explicitOracleRequest = containsAny(text, ['oracle', '命运', '占卜', '问骰', '问问命运', 'yes-no'])
  const explicitNoRoll = containsAny(text, [
    '对话',
    '交谈',
    '聊天',
    '询问',
    '观察',
    '查看',
    '环顾',
    '规则问题',
    '规则询问',
    '桌外',
    'out of character',
    'talk',
    'speak',
    'observe',
    'look',
  ])
  const uncertainCost = containsAny(text, ['不确定代价', '不知道代价', '不清楚会不会消耗', 'unsure about the cost', 'unknown cost'])

  if (action) {
    const fullActor = actors.find(candidate => candidate.characterKey === actor.characterKey)
    if (fullActor?.actionKeys && !fullActor.actionKeys.includes(action.key)) {
      return rejectedPreview(intent, '当前角色没有被授予该规则行动')
    }
    if (actionTargetInvalid(action, intent.targetRefs)) {
      return clarificationPreview(intent, requiredTargetMissing(action, null, intent.targetRefs) ? ['targetRefs'] : ['targetRefs'], '目标数量与规则行动不匹配')
    }
  }
  if (check && requiredTargetMissing(null, check, intent.targetRefs)) {
    return clarificationPreview(intent, ['targetRefs'], '通用检定需要明确目标')
  }
  if (uncertainCost) return clarificationPreview(intent, [], '玩家尚不能确认这项行动的代价')

  let route: TtrpgOpenIntentRouteV1
  if (interaction) route = 'no-roll'
  else if (action) route = 'existing-action'
  else if (check) route = 'generic-check'
  else if (oracle || explicitOracleRequest) {
    if (!oracle) return rejectedPreview(intent, '请求的 Oracle 不在冻结规则包中')
    if (containsAny(text, ['替我决定', '替我选择', '你来决定', 'decide for me', 'choose for me'])) {
      return rejectedPreview(intent, 'Oracle 不能替玩家作重大决定')
    }
    route = 'oracle'
  } else if (explicitNoRoll) route = 'no-roll'
  else {
    const missing: Array<'goal' | 'method' | 'targetRefs'> = []
    if (intent.method === null) missing.push('method')
    if (intent.targetRefs.length === 0 && intent.method !== null) missing.push('targetRefs')
    if (missing.length > 0) return clarificationPreview(intent, missing)
    return clarificationPreview(intent, ['method'], '目标与方法还不能绑定到冻结裁定方式')
  }

  const preview = basePreview(intent, route)
  const definition = action ?? check ?? oracle
  const defaultKind: TtrpgOpenIntentActionKindV1 = route === 'generic-check' ? 'low-risk-check' : 'other'
  preview.actionKind = actionKindFor(intent, definition && 'oracleKey' in definition ? { key: definition.oracleKey, title: definition.title }
    : definition && 'checkKey' in definition ? { key: definition.checkKey, title: definition.title }
      : definition && 'key' in definition ? definition : null, defaultKind)
  preview.routeDetail = {
    actionKey: action?.key ?? null,
    checkKey: check?.checkKey ?? null,
    oracleKey: oracle?.oracleKey ?? null,
    ...(interaction ? { interactionKey: interaction.interactionKey } : {}),
  }
  preview.resolutionBinding = {
    actorKey: intent.actorKey,
    targetRefs: [...intent.targetRefs],
    method: intent.method,
    actionKey: action?.key ?? null,
    checkKey: check?.checkKey ?? null,
    oracleKey: oracle?.oracleKey ?? null,
    ...(interaction ? { interactionKey: interaction.interactionKey } : {}),
  }
  preview.targetMethod = { targetRefs: [...intent.targetRefs], method: intent.method }
  preview.timeCostWorldTurns = interaction?.timeCostWorldTurns ?? timeCostFor({ rulePack, action, check, route })
  if (interaction) {
    preview.actionKind = interaction.kind === 'dialogue' ? 'talk' : interaction.kind === 'retreat' ? 'move' : interaction.kind
    preview.isRetreat = interaction.kind === 'retreat'
  }
  preview.affectedActorKeys = uniqueLimited([
    intent.actorKey,
    ...intent.targetRefs.filter(target => actors.some(candidate => candidate.characterKey === target)),
  ], 16)

  if (route === 'existing-action' || route === 'generic-check' || interaction) {
    const predicateResult = action
      ? unsatisfiedPredicates(interaction?.preconditions ?? [], snapshot.predicateContext)
      : unsatisfiedPredicates(check?.preconditions ?? [], snapshot.predicateContext)
    preview.unsatisfiedPredicates = interaction ? predicateResult.values.map(() => '冻结互动条件尚未满足') : predicateResult.values
    if (predicateResult.error) return rejectedPreview(intent,interaction ? '冻结互动条件无法验证' : `前置谓词无法求值：${predicateResult.error}`)
  }

  const details = riskAndCosts({
    action,
    check,
    campaign,
    timeCostWorldTurns: preview.timeCostWorldTurns,
  })
  preview.riskSummary = details.riskSummary
  preview.possibleCosts = details.possibleCosts
  preview.irreversible = details.irreversible
  if (interaction?.effectPlanRef) {
    // The actual risk owner projects visible details. Never disclose hidden templates here.
    preview.riskSummary.push('包含冻结互动后果，执行前须审阅并确认')
    preview.requiresConfirmation = true
  }
  if (interaction?.kind === 'retreat') {
    preview.riskSummary.push('撤退会增加混乱值')
    details.reasons.add('irreversible');preview.irreversible = true
  }
  for (const effect of [
    ...(action ? actionEffects(action) : []),
    ...(check ? effectsForCheck(check, campaign) : []),
  ]) {
    const operation = effectOperation(effect)
    if (operation === 'secret.reveal') details.reasons.add('secret-reveal')
    if (['reputation', 'faction', 'relationship', 'wanted', 'debt'].includes(operation)) details.reasons.add('party-relation-change')
  }
  if (containsAny(text, ['秘密', '揭示秘密', 'secret', 'reveal'])) details.reasons.add('secret-reveal')
  if (containsAny(text, ['关系', '盟友', '背叛', 'relationship', 'ally', 'betray'])) details.reasons.add('party-relation-change')
  if (details.irreversible) details.reasons.add('irreversible')
  if (action && action.costResourceKey !== null && action.costAmount > 0 && !intent.declaredResources.includes(action.costResourceKey)) {
    details.reasons.add('resource-spend')
  }
  if (action?.usage.mode === 'resource-cost'
    && action.usage.resourceKey !== null
    && action.usage.cost !== null
    && action.usage.cost > 0
    && !intent.declaredResources.includes(action.usage.resourceKey)) {
    details.reasons.add('resource-spend')
  }
  if (check) {
    for (const cost of check.resourceCosts) {
      if (cost.amount > 0 && !intent.declaredResources.includes(cost.resourceKey)) details.reasons.add('resource-spend')
    }
  }
  preview.confirmationReasonKinds = CONFIRMATION_REASON_KINDS.filter(kind => details.reasons.has(kind))
  if (preview.actionKind === 'other') preview.requiresConfirmation = true

  if (intent.source.startsWith('companion:')) {
    const preauthorized = policy.preauthorizedActionKinds.includes(preview.actionKind as typeof policy.preauthorizedActionKinds[number])
    preview.authorization = preauthorized && !preview.requiresConfirmation && preview.confirmationReasonKinds.length === 0
      ? 'preauthorized'
      : 'requires-confirmation'
    if (!preauthorized || preview.confirmationReasonKinds.length > 0) preview.requiresConfirmation = true
    if (preview.requiresConfirmation) {
      const approvers = confirmationApprovers(intent, actor, policy, actors)
      preview.confirmationApproverSeatKeys = approvers.seats
      preview.confirmationApproverActorKeys = approvers.actorKeys
      if (approvers.seats.length === 0) {
        return rejectedPreview(intent, '该 AI 队友意图没有可用的真人批准席位')
      }
    }
  } else if (intent.source === 'player') {
    preview.authorization = 'not-applicable'
    const approvers = confirmationApprovers(intent, actor, policy, actors)
    preview.confirmationApproverSeatKeys = approvers.seats
    preview.confirmationApproverActorKeys = approvers.actorKeys
  } else {
    preview.authorization = 'not-applicable'
  }
  if (preview.confirmationReasonKinds.length > 0) preview.requiresConfirmation = true
  if (preview.route === 'oracle' || (preview.route === 'no-roll' && !interaction)) {
    preview.confirmationReasonKinds = preview.confirmationReasonKinds.filter(kind => kind !== 'resource-spend')
  }
  return preview
}

export function routeTtrpgOpenIntentV1(
  intent: TtrpgOpenIntentV1 | unknown,
  snapshot: TtrpgOpenIntentRoutingSnapshotV1,
): TtrpgOpenIntentPreviewV1
export function routeTtrpgOpenIntentV1(
  request: TtrpgOpenIntentRouteRequestV1,
): TtrpgOpenIntentPreviewV1
export function routeTtrpgOpenIntentV1(
  intentOrRequest: TtrpgOpenIntentV1 | TtrpgOpenIntentRouteRequestV1 | unknown,
  maybeSnapshot?: TtrpgOpenIntentRoutingSnapshotV1,
): TtrpgOpenIntentPreviewV1 {
  if (maybeSnapshot !== undefined) {
    return routeWithSnapshot(parseTtrpgOpenIntentV1(intentOrRequest), maybeSnapshot)
  }
  if (!isRecord(intentOrRequest) || !('intent' in intentOrRequest)) {
    return fail('route 必须接收 intent + snapshot，或分别接收两个参数')
  }
  const request = intentOrRequest as unknown as TtrpgOpenIntentRouteRequestV1
  const snapshot = request.snapshot ?? request.state
  if (!snapshot) return fail('route 缺少只读状态快照')
  return routeWithSnapshot(parseTtrpgOpenIntentV1(request.intent), snapshot)
}
