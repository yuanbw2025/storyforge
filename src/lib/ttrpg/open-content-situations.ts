import type { TtrpgOpenCampaignClockV1, TtrpgOpenCampaignFrontV1, TtrpgSituationTemplateV1, TtrpgOpenDriverBindingV1 } from './open-contract'
import { parsePredicate } from './open-content-predicates'
import * as p from './open-contract-parse'

export function clock(value: unknown, label: string): TtrpgOpenCampaignClockV1 {
  const r = p.record(value, ['clockKey', 'title', 'description', 'initialValue', 'maximum', 'advanceTriggers', 'autoAdvance', 'onComplete', 'onCompleteEffectPlanRef', 'visibility', 'sourceRefs'], label)
  const maximum = p.integer(r.maximum, label, 2, 100)
  const advanceTriggers = p.list(r.advanceTriggers, label, (v, l) => {
    const a = p.record(v, ['triggerKey', 'sceneKey', 'actionKey', 'condition', 'amount', 'reason'], l)
    const actionKey = p.nullable(a.actionKey, p.key, l), condition = p.nullable(a.condition, parsePredicate, l)
    if (!actionKey && !condition) p.fail(`${l}: actionKey/condition 至少一项`)
    return { triggerKey: p.key(a.triggerKey, l), sceneKey: p.literal(a.sceneKey, null, l), actionKey, condition,
      amount: p.integer(a.amount, l, 1, maximum), reason: p.text(a.reason, l) }
  }, 100)
  p.unique(advanceTriggers.map(a => a.triggerKey), label)
  const a = p.record(r.autoAdvance, ['onFailedCheck', 'onIdleWorldTurns', 'onOracleNo', 'onStageClose'], label)
  const autoAdvance = { onFailedCheck: p.integer(a.onFailedCheck, label, 0, 4), onIdleWorldTurns: p.integer(a.onIdleWorldTurns, label, 0, 8),
    onOracleNo: p.integer(a.onOracleNo, label, 0, 4), onStageClose: p.integer(a.onStageClose, label, 0, 4) }
  if (!advanceTriggers.length && !Object.values(autoAdvance).some(n => n > 0)) p.fail(`${label}: 时钟无法推进`)
  return { clockKey: p.key(r.clockKey, label), title: p.text(r.title, label, 300), description: p.text(r.description, label),
    initialValue: p.integer(r.initialValue, label, 0, maximum - 1), maximum, advanceTriggers, autoAdvance,
    onComplete: p.text(r.onComplete, label), onCompleteEffectPlanRef: p.nullable(r.onCompleteEffectPlanRef, p.key, label),
    visibility: p.oneOf(r.visibility, ['gm-only', 'party', 'public'], label), sourceRefs: p.keys(r.sourceRefs, label, 100, 1) }
}
export function front(value: unknown, label: string): TtrpgOpenCampaignFrontV1 {
  const r = p.record(value, ['frontKey', 'title', 'goal', 'participantKeys', 'clockKeys', 'escalation', 'escalationStages', 'telegraph', 'defeatConditions', 'defeatPredicates', 'sourceRefs'], label)
  const clockKeys = p.keys(r.clockKeys, label, 100, 1)
  const escalationStages = p.list(r.escalationStages, label, (v, l) => {
    const a = p.record(v, ['stageKey', 'clockKey', 'atClockValue', 'effectPlanRef', 'newSituationTemplateKey'], l)
    const clockKey = p.key(a.clockKey, l); p.known(clockKey, clockKeys, l)
    return { stageKey: p.key(a.stageKey, l), clockKey, atClockValue: p.integer(a.atClockValue, l, 1, 100),
      effectPlanRef: p.nullable(a.effectPlanRef, p.key, l), newSituationTemplateKey: p.nullable(a.newSituationTemplateKey, p.key, l) }
  }, 100, 1)
  p.unique(escalationStages.map(s => s.stageKey), label)
  if (escalationStages.some((s, i) => i > 0 && s.atClockValue < escalationStages[i - 1].atClockValue)) p.fail(`${label}: stage 阈值必须非递减`)
  const telegraph = p.list(r.telegraph, label, (v, l) => {
    const a = p.record(v, ['telegraphKey', 'beforeStageKey', 'signalText', 'audience', 'mediaSlotKey', 'minLeadWorldTurns'], l)
    const beforeStageKey = p.key(a.beforeStageKey, l); p.known(beforeStageKey, escalationStages.map(s => s.stageKey), l)
    return { telegraphKey: p.key(a.telegraphKey, l), beforeStageKey, signalText: p.text(a.signalText, l),
      audience: p.oneOf(a.audience, ['party', 'public'], l), mediaSlotKey: p.nullable(a.mediaSlotKey, p.key, l),
      minLeadWorldTurns: p.integer(a.minLeadWorldTurns, l, 1, 10) }
  }, 100, 1)
  p.unique(telegraph.map(t => t.telegraphKey), label)
  if (escalationStages.some(s => !telegraph.some(t => t.beforeStageKey === s.stageKey))) p.fail(`${label}: stage 缺少征兆`)
  return { frontKey: p.key(r.frontKey, label), title: p.text(r.title, label, 300), goal: p.text(r.goal, label),
    participantKeys: p.keys(r.participantKeys, label, 100, 1), clockKeys, escalation: p.texts(r.escalation, label, 100, 1),
    escalationStages, telegraph, defeatConditions: p.texts(r.defeatConditions, label, 100, 1),
    defeatPredicates: p.list(r.defeatPredicates, label, parsePredicate, 32, 1), sourceRefs: p.keys(r.sourceRefs, label, 100, 1) }
}
function driver(value: unknown, label: string): TtrpgOpenDriverBindingV1 {
  const r = p.object(value, label)
  if (r.kind === 'npc') { p.exact(r, ['kind', 'characterKey'], label); return { kind: r.kind, characterKey: p.key(r.characterKey, label) } }
  if (r.kind === 'front') { p.exact(r, ['kind', 'frontKey'], label); return { kind: r.kind, frontKey: p.key(r.frontKey, label) } }
  p.exact(r, ['kind', 'factRef'], label)
  return { kind: p.oneOf(r.kind, ['world-event', 'player-commitment'], label), factRef: p.key(r.factRef, label) }
}
export function situation(value: unknown, label: string): TtrpgSituationTemplateV1 {
  const r = p.record(value, ['templateKey', 'title', 'motive', 'driverBinding', 'driverGoal', 'driverBeliefs', 'preconditions', 'obstacles', 'interventionPoints', 'evidence', 'whyNowRefs', 'noInterventionOutcome', 'consequences', 'sourceRefs'], label)
  const driverBeliefs = p.list(r.driverBeliefs, label, (v, l) => {
    const a = p.record(v, ['factRef', 'belief', 'isMistaken'], l)
    return { factRef: p.nullable(a.factRef, p.key, l), belief: p.text(a.belief, l), isMistaken: p.bool(a.isMistaken, l) }
  }, 100, 1)
  if (!driverBeliefs.some(b => b.factRef !== null)) p.fail(`${label}: S2 缺信念来源`)
  const obstacles = p.list(r.obstacles, label, (v, l) => {
    const a = p.record(v, ['obstacleKey', 'kind', 'ref', 'predicate', 'dependsOn'], l)
    return { obstacleKey: p.key(a.obstacleKey, l), kind: p.oneOf(a.kind, ['physical', 'social', 'informational', 'resource', 'legal'], l),
      ref: p.nullable(a.ref, p.key, l), predicate: parsePredicate(a.predicate, l), dependsOn: p.keys(a.dependsOn, l, 100) }
  }, 100, 2)
  const obstacleKeys = p.unique(obstacles.map(o => o.obstacleKey), label)
  if (!obstacles.some(o => o.dependsOn.length)) p.fail(`${label}: S1 缺障碍依赖`)
  for (const o of obstacles) for (const k of o.dependsOn) p.known(k, obstacleKeys, `${label}.dependsOn`)
  const visiting = new Set<string>(), visited = new Set<string>()
  function visit(k: string): void {
    if (visiting.has(k)) p.fail(`${label}: S1 障碍有环`)
    if (visited.has(k)) return
    visiting.add(k)
    for (const next of obstacles.find(o => o.obstacleKey === k)?.dependsOn ?? []) visit(next)
    visiting.delete(k); visited.add(k)
  }
  obstacleKeys.forEach(visit)
  const interventionPoints = p.list(r.interventionPoints, label, (v, l) => {
    const a = p.record(v, ['pointKey', 'visibleTo', 'knownByActorKeys', 'affordanceHint', 'requiresPredicate', 'suggestedActionKeys', 'targetsObstacleKeys'], l)
    const visibleTo = p.oneOf(a.visibleTo, ['party', 'private', 'public'], l), knownByActorKeys = p.keys(a.knownByActorKeys, l)
    p.recipients(visibleTo, knownByActorKeys, l)
    const targetsObstacleKeys = p.keys(a.targetsObstacleKeys, l, 100, 1)
    targetsObstacleKeys.forEach(k => p.known(k, obstacleKeys, l))
    return { pointKey: p.key(a.pointKey, l), visibleTo, knownByActorKeys, affordanceHint: p.text(a.affordanceHint, l),
      requiresPredicate: p.nullable(a.requiresPredicate, parsePredicate, l), suggestedActionKeys: p.keys(a.suggestedActionKeys, l, 100), targetsObstacleKeys }
  }, 100, 2)
  p.unique(interventionPoints.map(i => i.pointKey), label)
  const evidence = p.list(r.evidence, label, (v, l) => {
    const a = p.record(v, ['clueRef', 'title', 'description', 'sourceFactRefs', 'sourceResourceRefs', 'discoverableBy', 'coversObstacleKeys', 'audience', 'knownByActorKeys', 'isRequired', 'discoveryPolicy'], l)
    const audience = p.oneOf(a.audience, ['gm-only', 'party', 'private'], l), knownByActorKeys = p.keys(a.knownByActorKeys, l)
    p.recipients(audience, knownByActorKeys, l)
    const coversObstacleKeys = p.keys(a.coversObstacleKeys, l, 100)
    coversObstacleKeys.forEach(k => p.known(k, obstacleKeys, l))
    const d = p.record(a.discoveryPolicy, ['preconditions', 'paths', 'failForwardEffectPlanRef', 'costEffectPlanRef', 'allowedAudience', 'recipientActorKeys', 'requiresPlayerConfirmation'], l)
    const paths = p.list(d.paths, l, (v, l) => {
      const path = p.record(v, ['kind', 'key', 'interventionPointKey'], l)
      const interventionPointKey = p.key(path.interventionPointKey, l)
      p.known(interventionPointKey, interventionPoints.map(i => i.pointKey), l)
      return { kind: p.oneOf(path.kind, ['action', 'generic-check'], l), key: p.key(path.key, l), interventionPointKey }
    }, 100, 1)
    p.unique(paths.map(a => `${a.kind}:${a.key}:${a.interventionPointKey}`), l)
    const discoverableBy = p.keys(a.discoverableBy, l, 100, 1)
    if (discoverableBy.some(k => !paths.some(path => path.key === k)) || paths.some(path => !discoverableBy.includes(path.key))) p.fail(`${l}: discoverableBy/paths 不闭合`)
    const allowedAudience = p.oneOf(d.allowedAudience, p.AUDIENCES, l), recipientActorKeys = p.keys(d.recipientActorKeys, l)
    p.recipients(allowedAudience, recipientActorKeys, l)
    const sourceFactRefs = p.keys(a.sourceFactRefs, l), sourceResourceRefs = p.keys(a.sourceResourceRefs, l)
    if (!sourceFactRefs.length && !sourceResourceRefs.length) p.fail(`${l}: evidence 缺来源`)
    return { clueRef: p.key(a.clueRef, l), title: p.text(a.title, l, 300), description: p.text(a.description, l),
      sourceFactRefs, sourceResourceRefs, discoverableBy, coversObstacleKeys, audience, knownByActorKeys, isRequired: p.bool(a.isRequired, l),
      discoveryPolicy: { preconditions: p.list(d.preconditions, l, parsePredicate, 32), paths,
        failForwardEffectPlanRef: p.nullable(d.failForwardEffectPlanRef, p.key, l), costEffectPlanRef: p.nullable(d.costEffectPlanRef, p.key, l),
        allowedAudience, recipientActorKeys, requiresPlayerConfirmation: p.bool(d.requiresPlayerConfirmation, l) } }
  }, 100, 2)
  if (evidence.every(e => e.isRequired)) p.fail(`${label}: S4 需要可选证据`)
  p.unique(evidence.map(e => e.clueRef), label)
  const n = p.record(r.noInterventionOutcome, ['afterWorldTurns', 'description', 'effectPlanRef', 'advancesClockKeys'], label)
  const noInterventionOutcome = { afterWorldTurns: p.integer(n.afterWorldTurns, label, 1, 50), description: p.text(n.description, label),
    effectPlanRef: p.nullable(n.effectPlanRef, p.key, label), advancesClockKeys: p.keys(n.advancesClockKeys, label) }
  if (!noInterventionOutcome.effectPlanRef && !noInterventionOutcome.advancesClockKeys.length) p.fail(`${label}: S5 缺不介入后果`)
  return { templateKey: p.key(r.templateKey, label), title: p.text(r.title, label, 300),
    motive: p.oneOf(r.motive, ['knowledge', 'protection', 'reputation', 'wealth', 'ability', 'equipment', 'conquest', 'serenity', 'comfort'], label),
    driverBinding: driver(r.driverBinding, label), driverGoal: p.text(r.driverGoal, label), driverBeliefs,
    preconditions: p.list(r.preconditions, label, parsePredicate, 32), obstacles, interventionPoints, evidence,
    whyNowRefs: p.keys(r.whyNowRefs, label, 100, 2), noInterventionOutcome,
    consequences: p.list(r.consequences, label, (v, l) => {
      const a = p.record(v, ['scope', 'ref', 'effectPlanRef', 'nextSituationTemplateKey', 'audience'], l)
      return { scope: p.oneOf(a.scope, ['actor', 'faction', 'location', 'world-state', 'party-identity'], l), ref: p.key(a.ref, l),
        effectPlanRef: p.key(a.effectPlanRef, l), nextSituationTemplateKey: p.nullable(a.nextSituationTemplateKey, p.key, l),
        audience: p.oneOf(a.audience, ['gm-only', 'party', 'public'], l) }
    }, 100), sourceRefs: p.keys(r.sourceRefs, label, 100, 1) }
}
