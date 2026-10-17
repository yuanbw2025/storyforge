import { parseTtrpgOpenInteractionBindingV1,assertTtrpgOpenInteractionActionV1 } from './open-interaction'
import type { RulePackV1 } from '../types'
import type { RulePackV2, TtrpgOpenFactPolicyV1, TtrpgOpenGenericCheckV1, TtrpgOracleTableV1, TtrpgOpenSocialTierMappingV1, TtrpgOpenTimePolicyV1 } from './open-contract'
import { OPEN_FACT_PREDICATES } from './open-contract'
import { parseRulePackV1 } from './rule-pack'
import { createTtrpgOpenUsagePoolsV1 } from './ability-ledger'
import { parsePredicate } from './open-content-predicates'
import * as p from './open-contract-parse'
export type { RulePackV2 } from './open-contract'

const MECHANICAL_FIELDS = ['schema', 'version', 'ruleSystemId', 'ruleSystemVersion', 'title', 'description', 'license', 'attributes', 'derivedStats', 'diceModels', 'checks', 'resources', 'conditions', 'actions', 'turnStructure', 'items', 'advancement', 'characterSheetUi', 'compendium', 'migrations', 'tests'] as const
const OPEN_FIELDS = ['runFormat', 'oracles', 'factPolicy', 'genericChecks', 'socialTierMappings', 'timePolicy'] as const

function mechanicalInput(root: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(MECHANICAL_FIELDS.map(k => [k, k === 'version' ? 1 : root[k]]))
}
export function parseTtrpgOpenFactPolicyV1(value: unknown, label = 'factPolicy'): TtrpgOpenFactPolicyV1 {
  const r = p.record(value, ['predicateKey', 'valueType', 'cardinality', 'allowedKinds', 'mutuallyExclusiveWith', 'authority', 'allowNewSubjects'], label)
  const a = p.record(r.authority, ['invariant', 'initialState', 'session'], `${label}.authority`)
  const owner = (v: unknown, l: string) => p.oneOf(v, ['semantic-fact', 'entity', 'inventory', 'social-ledger'], l)
  const result: TtrpgOpenFactPolicyV1 = {
    predicateKey: p.oneOf(r.predicateKey, OPEN_FACT_PREDICATES, label),
    valueType: p.oneOf(r.valueType, ['boolean', 'number', 'string', 'entity-ref'], label),
    cardinality: p.oneOf(r.cardinality, ['one', 'many'], label),
    allowedKinds: p.unique(p.list(r.allowedKinds, label, (v, l) => p.oneOf(v, ['entity', 'relation', 'state', 'event-truth', 'location', 'item'], l), 6, 1), label),
    mutuallyExclusiveWith: p.unique(p.list(r.mutuallyExclusiveWith, label, (v, l) => p.oneOf(v, OPEN_FACT_PREDICATES, l), 12), label),
    authority: { invariant: p.nullable(a.invariant, owner, label), initialState: p.nullable(a.initialState, owner, label), session: p.nullable(a.session, owner, label) },
    allowNewSubjects: p.bool(r.allowNewSubjects, label),
  }
  const mechanicalOwner = result.predicateKey === 'owns' ? 'inventory'
    : ['allied-with', 'hostile-to', 'owes'].includes(result.predicateKey) ? 'social-ledger'
      : ['located-at', 'damaged', 'destroyed', 'blocked', 'open'].includes(result.predicateKey) ? 'entity' : null
  if (mechanicalOwner) {
    if (result.authority.invariant !== null || result.authority.initialState !== mechanicalOwner || result.authority.session !== mechanicalOwner) p.fail(`${label}: 机械谓词权威映射无效`)
  } else if (Object.values(result.authority).some(o => o !== null && o !== 'semantic-fact') || !Object.values(result.authority).some(Boolean)) {
    p.fail(`${label}: 语义谓词权威映射无效`)
  }
  const requiredType = ['exists', 'destroyed', 'blocked', 'open', 'allied-with', 'hostile-to', 'knows'].includes(result.predicateKey) ? 'boolean'
    : ['located-at', 'owns'].includes(result.predicateKey) ? 'entity-ref'
      : ['owes', 'damaged'].includes(result.predicateKey) ? 'number' : 'string'
  if (result.valueType !== requiredType) p.fail(`${label}: owner/valueType 不匹配`)
  const many = ['knows', 'allied-with', 'hostile-to', 'owes', 'promised'].includes(result.predicateKey)
  if ((result.cardinality === 'many') !== many) p.fail(`${label}: cardinality 不匹配`)
  if (result.mutuallyExclusiveWith.includes(result.predicateKey)) p.fail(`${label}: 不得与自身互斥`)
  const allowedExclusions = result.predicateKey === 'open' ? ['blocked'] : result.predicateKey === 'blocked' ? ['open']
    : result.predicateKey === 'allied-with' ? ['hostile-to'] : result.predicateKey === 'hostile-to' ? ['allied-with'] : []
  if (result.mutuallyExclusiveWith.some(k => !allowedExclusions.includes(k))) p.fail(`${label}: 不允许跨 owner 互斥`)
  return result
}
function oracle(value: unknown, label: string, rule: RulePackV1): TtrpgOracleTableV1 {
  const r = p.record(value, ['oracleKey', 'title', 'kind', 'diceModelKey', 'audience', 'chaosCoupled', 'likelihood', 'entries', 'interpretation', 'tests', 'sourceRefs'], label)
  const diceModelKey = p.key(r.diceModelKey, label)
  const dice = rule.diceModels.find(d => d.key === diceModelKey)
  if (!dice) return p.fail(`${label}: 未知 diceModelKey`)
  const low = dice.keep === 'all' ? dice.count : 1
  const high = dice.keep === 'all' ? dice.count * dice.sides : dice.sides
  const kind = p.oneOf(r.kind, ['yes-no', 'meaning', 'event'], label)
  const chaosCoupled = p.bool(r.chaosCoupled, label)
  const likelihood = p.nullable(r.likelihood, (v, l) => {
    const a = p.record(v, ['tiers', 'defaultTierKey'], l)
    const tiers = p.list(a.tiers, l, (v, l) => {
      const t = p.record(v, ['tierKey', 'label', 'yesAtOrAbove', 'yesButBand', 'noButBand'], l)
      const yesAtOrAbove = p.integer(t.yesAtOrAbove, l, low, high)
      return { tierKey: p.key(t.tierKey, l), label: p.text(t.label, l, 300), yesAtOrAbove,
        yesButBand: p.integer(t.yesButBand, l, 0, high - yesAtOrAbove + 1),
        noButBand: p.integer(t.noButBand, l, 0, yesAtOrAbove - low) }
    }, 100, 1)
    p.unique(tiers.map(t => t.tierKey), l)
    const defaultTierKey = p.key(a.defaultTierKey, l); p.known(defaultTierKey, tiers.map(t => t.tierKey), l)
    return { tiers, defaultTierKey }
  }, label)
  const entries = p.nullable(r.entries, (v, l) => p.list(v, l, (v, l) => {
    const e = p.record(v, ['entryKey', 'weight', 'text', 'tags'], l)
    return { entryKey: p.key(e.entryKey, l), weight: p.integer(e.weight, l, 1, 1000), text: p.text(e.text, l), tags: p.texts(e.tags, l, 100) }
  }, 1000, 4), label)
  if ((kind === 'yes-no') !== (likelihood !== null) || (kind === 'yes-no') !== (entries === null)) p.fail(`${label}: Oracle kind 字段组合无效`)
  if (entries) {
    p.unique(entries.map(e => e.entryKey), label)
    if (entries.reduce((sum, e) => sum + e.weight, 0) > 100_000) p.fail(`${label}: Oracle 总权重超过100000`)
  }
  const i = p.record(r.interpretation, ['mustRespect', 'forbiddenScopes', 'maxNewEntities'], label)
  const forbiddenScopes = p.unique(p.list(i.forbiddenScopes, label, (v, l) => p.oneOf(v, ['world-fact', 'rule-change', 'player-decision', 'retcon'], l), 4, 4), label)
  const tests = p.list(r.tests, label, (v, l) => {
    const t = p.record(v, ['testKey', 'seed', 'nonce', 'chaosValue', 'likelihoodTierKey', 'expectedRawResult', 'expectedEntryKey'], l)
    const chaosValue = p.nullable(t.chaosValue, (v, l) => p.integer(v, l, 1, 9), l)
    const likelihoodTierKey = p.nullable(t.likelihoodTierKey, p.key, l)
    const expectedRawResult = p.nullable(t.expectedRawResult, (v, l) => p.oneOf(v, ['yes', 'yes-but', 'no-but', 'no'], l), l)
    const expectedEntryKey = p.nullable(t.expectedEntryKey, p.key, l)
    if (chaosCoupled !== (chaosValue !== null)) p.fail(`${l}: chaosValue 与 chaosCoupled 不匹配`)
    if (kind === 'yes-no') {
      if (likelihoodTierKey === null || expectedRawResult === null || expectedEntryKey !== null) p.fail(`${l}: yes-no 测试字段无效`)
      p.known(likelihoodTierKey, likelihood?.tiers.map(t => t.tierKey) ?? [], l)
    } else {
      if (likelihoodTierKey !== null || expectedRawResult !== null || expectedEntryKey === null) p.fail(`${l}: entry 测试字段无效`)
      p.known(expectedEntryKey, entries?.map(e => e.entryKey) ?? [], l)
    }
    return { testKey: p.key(t.testKey, l), seed: p.text(t.seed, l, 2000), nonce: p.text(t.nonce, l, 2000), chaosValue, likelihoodTierKey, expectedRawResult, expectedEntryKey }
  }, 1000, 1)
  p.unique(tests.map(t => t.testKey), label)
  return { oracleKey: p.key(r.oracleKey, label), title: p.text(r.title, label, 300), kind, diceModelKey,
    audience: p.oneOf(r.audience, ['gm-only', 'party', 'public'], label), chaosCoupled, likelihood, entries,
    interpretation: { mustRespect: p.texts(i.mustRespect, label, 100, 1), forbiddenScopes, maxNewEntities: p.integer(i.maxNewEntities, label, 0, 3) },
    tests, sourceRefs: p.keys(r.sourceRefs, label, 100, 1) }
}
export function parseTtrpgOpenGenericCheckV1(value: unknown, label: string, rule: RulePackV1): TtrpgOpenGenericCheckV1 {
  const r = p.record(value, ['checkKey', 'title', 'actorAttributeKey', 'diceModelKey', 'difficulty', 'preconditions', 'targetKinds', 'effectPlanByDegree', 'riskFactRefs', 'resourceCosts', 'timeCostWorldTurns', 'audience', 'sourceRefs'], label)
  const checkKey = p.key(r.checkKey, label)
  const actorAttributeKey = p.key(r.actorAttributeKey, label)
  const diceModelKey = p.key(r.diceModelKey, label)
  p.known(actorAttributeKey, rule.attributes.map(a => a.key), label)
  p.known(diceModelKey, rule.diceModels.map(d => d.key), label)
  // The common check is the frozen resolver authority; no implicit resolver is invented.
  const check = rule.checks.find(c => c.key === checkKey)
  if (!check || !check.attributeKeys.includes(actorAttributeKey) || check.diceModelKey !== diceModelKey) return p.fail(`${label}: 必须绑定相同 check/attribute/dice`)
  const difficulty = p.number(r.difficulty, label, -1000, 1000)
  if (!('targetMode' in check)) {
    if (check.resolver.mode === 'opposed') p.fail(`${label}: 不支持的 generic resolver`)
    if (check.resolver.mode === 'roll-under') p.integer(difficulty, label, 1, 100)
    if (check.resolver.mode === 'success-pool') p.integer(difficulty, label, 1, 100)
  }
  const d = p.record(r.effectPlanByDegree, p.DEGREES, `${label}.effectPlanByDegree`)
  const degree = (k: string) => p.nullable(d[k], p.key, `${label}.${k}`)
  const resourceCosts = p.list(r.resourceCosts, label, (v, l) => {
    const c = p.record(v, ['resourceKey', 'amount'], l); const resourceKey = p.key(c.resourceKey, l)
    p.known(resourceKey, rule.resources.map(r => r.key), l)
    return { resourceKey, amount: p.integer(c.amount, l) }
  }, 16)
  p.unique(resourceCosts.map(c => c.resourceKey), label)
  return { checkKey, title: p.text(r.title, label, 300), actorAttributeKey, diceModelKey, difficulty,
    preconditions: p.list(r.preconditions, label, parsePredicate, 32),
    targetKinds: p.unique(p.list(r.targetKinds, label, (v, l) => p.oneOf(v, ['self', 'actor', 'location', 'item'], l), 4, 1), label),
    effectPlanByDegree: { 'critical-success': degree('critical-success'), 'extreme-success': degree('extreme-success'), 'hard-success': degree('hard-success'), success: degree('success'), 'partial-success': degree('partial-success'), failure: degree('failure'), 'critical-failure': degree('critical-failure') },
    riskFactRefs: p.keys(r.riskFactRefs, label), resourceCosts, timeCostWorldTurns: p.integer(r.timeCostWorldTurns, label, 0, 10),
    audience: p.effectAudience(r.audience, label), sourceRefs: p.keys(r.sourceRefs, label, 100, 1) }
}
function timePolicy(value: unknown): TtrpgOpenTimePolicyV1 {
  const l = 'timePolicy'
  const r = p.record(value, ['existingAction', 'genericCheck', 'noRoll', 'outOfCharacter', 'view', 'rulesQuestion', 'preflight', 'oracleConsultation', 'actionOverrides'], l)
  const actionOverrides = p.list(r.actionOverrides, l, (v, l) => {
    const a = p.record(v, ['actionKey', 'timeCostWorldTurns'], l)
    return { actionKey: p.key(a.actionKey, l), timeCostWorldTurns: p.integer(a.timeCostWorldTurns, l, 0, 10) }
  })
  p.unique(actionOverrides.map(a => a.actionKey), l)
  return { existingAction: p.integer(r.existingAction, l, 0, 10), genericCheck: p.integer(r.genericCheck, l, 0, 10), noRoll: p.integer(r.noRoll, l, 0, 10),
    outOfCharacter: p.literal(r.outOfCharacter, 0, l), view: p.literal(r.view, 0, l), rulesQuestion: p.literal(r.rulesQuestion, 0, l),
    preflight: p.literal(r.preflight, 0, l), oracleConsultation: p.literal(r.oracleConsultation, 0, l), actionOverrides }
}
export function parseRulePackV2(input: unknown): RulePackV2 {
  const raw = p.json(input),hasInteractions = Object.prototype.hasOwnProperty.call(p.object(raw,'rulePackV2'),'interactionBindings')
  const root = p.record(raw, [...MECHANICAL_FIELDS, ...OPEN_FIELDS,...(hasInteractions ? ['interactionBindings'] : [])], 'rulePackV2')
  p.literal(root.version, 2, 'rulePackV2.version'); p.literal(root.runFormat, 'open', 'rulePackV2.runFormat')
  const core = parseRulePackV1(mechanicalInput(root))
  createTtrpgOpenUsagePoolsV1(core.actions)
  const interactionBindings = hasInteractions ? p.list(root.interactionBindings,'interaction bindings',parseTtrpgOpenInteractionBindingV1,100) : undefined
  if (interactionBindings) { p.unique(interactionBindings.map(b => b.interactionKey),'interaction keys');for (const binding of interactionBindings) assertTtrpgOpenInteractionActionV1(binding,core) }
  const oracles = p.list(root.oracles, 'oracles', (v, l) => oracle(v, l, core), 100, 1)
  const policies = p.list(root.factPolicy, 'factPolicy', parseTtrpgOpenFactPolicyV1, 12, 12)
  p.unique(policies.map(f => f.predicateKey), 'factPolicy')
  for (const f of policies) for (const other of f.mutuallyExclusiveWith) {
    if (!policies.find(p => p.predicateKey === other)?.mutuallyExclusiveWith.includes(f.predicateKey)) p.fail('factPolicy: 互斥必须对称')
  }
  const genericChecks = p.list(root.genericChecks, 'genericChecks', (v, l) => parseTtrpgOpenGenericCheckV1(v, l, core))
  const socialTierMappings = p.list(root.socialTierMappings, 'socialTierMappings', (v, l): TtrpgOpenSocialTierMappingV1 => {
    const r = p.record(v, ['mappingKey', 'balanceKey', 'oracleKey', 'ranges', 'defaultTierKey'], l)
    const oracleKey = p.key(r.oracleKey, l); const table = oracles.find(o => o.oracleKey === oracleKey)
    if (!table?.likelihood) return p.fail(`${l}: 必须引用 yes-no Oracle`)
    const ranges = p.list(r.ranges, l, (v, l) => {
      const a = p.record(v, ['minimum', 'maximum', 'minimumInclusive', 'maximumInclusive', 'tierKey'], l)
      const range = { minimum: p.number(a.minimum, l), maximum: p.number(a.maximum, l),
        minimumInclusive: p.bool(a.minimumInclusive, l), maximumInclusive: p.bool(a.maximumInclusive, l), tierKey: p.key(a.tierKey, l) }
      if (range.minimum > range.maximum || (range.minimum === range.maximum && !(range.minimumInclusive && range.maximumInclusive))) p.fail(`${l}: 空区间`)
      p.known(range.tierKey, table.likelihood?.tiers.map(t => t.tierKey) ?? [], l)
      return range
    }, 100)
    const sorted = [...ranges].sort((a, b) => a.minimum - b.minimum)
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i]
      if (b.minimum < a.maximum || (b.minimum === a.maximum && b.minimumInclusive && a.maximumInclusive)) p.fail(`${l}: 社会区间重叠`)
    }
    const defaultTierKey = p.key(r.defaultTierKey, l); p.known(defaultTierKey, table.likelihood.tiers.map(t => t.tierKey), l)
    return { mappingKey: p.key(r.mappingKey, l), balanceKey: p.key(r.balanceKey, l), oracleKey, ranges, defaultTierKey }
  })
  const time = timePolicy(root.timePolicy)
  for (const a of time.actionOverrides) p.known(a.actionKey, core.actions.map(a => a.key), 'timePolicy.actionOverrides')
  p.unique(oracles.map(o => o.oracleKey), 'oracles')
  p.unique(genericChecks.map(c => c.checkKey), 'genericChecks')
  p.unique(socialTierMappings.map(m => m.mappingKey), 'socialTierMappings')
  return { ...core, version: 2, runFormat: 'open',...(interactionBindings ? { interactionBindings } : {}),oracles, factPolicy: policies, genericChecks, socialTierMappings, timePolicy: time }
}

/** A transient algorithm input only. Never use this projection for release identity/hash. */
export function projectTtrpgRulePackMechanicalCoreV1(rule: RulePackV2): RulePackV1 {
  const validated = parseRulePackV2(rule)
  return parseRulePackV1(mechanicalInput(p.object(validated, 'rulePackV2')))
}
