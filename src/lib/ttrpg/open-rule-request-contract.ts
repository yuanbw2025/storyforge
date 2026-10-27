/** Pure request shapes shared by frozen rule plans and durable clarification records. */
import * as p from './open-contract-parse'
import type { RuleActionDefinitionV1 } from '../types'

export interface TtrpgOpenSceneScopeV1 { kind: 'current-scene'; locationRef: string }
export function parseTtrpgOpenSceneScopeV1(value: unknown): TtrpgOpenSceneScopeV1 {
  const r = p.record(value,['kind','locationRef'],'intent scene scope')
  return { kind: p.literal(r.kind,'current-scene','scene scope kind'),locationRef: p.key(r.locationRef,'scene location') }
}
/** Preserve semantic scope separately from the kernel's null scene target. */
export function resolveTtrpgOpenIntentTargetV1(input: {
  route: 'existing-action' | 'generic-check'; actionTarget?: RuleActionDefinitionV1['target']
  actorKey: string; targetRefs: readonly string[]; currentLocationRef: string | null
}): { targetKey: string | null; sceneScope?: TtrpgOpenSceneScopeV1 } {
  if (input.targetRefs.length > 1) p.fail('当前裁定需要单个明确目标，不能静默丢弃其他目标')
  if (input.route === 'existing-action' && input.actionTarget === 'scene') {
    if (!input.targetRefs.length) return { targetKey: null }
    if (!input.currentLocationRef || input.targetRefs[0] !== input.currentLocationRef) p.fail('场景行动只能指向行动者的当前场景，请明确澄清目标')
    return { targetKey: null,sceneScope: { kind: 'current-scene',locationRef: input.currentLocationRef } }
  }
  if (input.route === 'existing-action' && input.actionTarget === 'self') {
    if (input.targetRefs.length) p.fail('自身行动不能替换为其他目标，请明确澄清目标')
    return { targetKey: input.actorKey }
  }
  return { targetKey: input.targetRefs[0] ?? null }
}

/** V2 may explicitly identify the acting character; V1's empty implicit self stays frozen. */
export function resolveTtrpgOpenIntentTargetV2(input: Parameters<typeof resolveTtrpgOpenIntentTargetV1>[0]): ReturnType<typeof resolveTtrpgOpenIntentTargetV1> {
  const ownSelf = input.route === 'existing-action' && input.actionTarget === 'self'
    && input.targetRefs.length === 1 && input.targetRefs[0] === input.actorKey
  return resolveTtrpgOpenIntentTargetV1(ownSelf ? { ...input,targetRefs: [] } : input)
}

export interface TtrpgOpenDiscoveryRequestV1 {
  situationKey: string; evidenceRef: string; interventionPointKey: string
  effectBindings: Record<string, Record<string, string | null>>
}
export interface TtrpgOpenRuleRequestV1 {
  route: 'existing-action' | 'generic-check'
  interactionKey?: string
  ruleKey: string
  actorKey: string
  targetKey: string | null
  controllerMode: 'human' | 'ai'
  effectBindings: Record<string, Record<string, string | null>>
  discovery?: TtrpgOpenDiscoveryRequestV1
}
function fail(message: string): never { throw new Error(`[ttrpg-open-rule-plan] ${message}`) }

export function parseTtrpgOpenDiscoveryRequestV1(value: unknown): TtrpgOpenDiscoveryRequestV1 {
  const r = p.record(value, ['situationKey', 'evidenceRef', 'interventionPointKey', 'effectBindings'], 'discovery request')
  const bindings = p.object(r.effectBindings, 'discovery bindings')
  if (Object.keys(bindings).length > 2) p.fail('发现最多绑定冻结代价与失败前进计划')
  return { situationKey: p.key(r.situationKey, 'discovery situation'), evidenceRef: p.key(r.evidenceRef, 'discovery evidence'),
    interventionPointKey: p.key(r.interventionPointKey, 'discovery intervention'), effectBindings: Object.fromEntries(Object.entries(bindings).map(([key, value]) =>
      [p.key(key, 'discovery effect plan'), Object.fromEntries(Object.entries(p.object(value, 'discovery slots')).map(([slot, ref]) =>
        [p.key(slot, 'discovery parameter'), p.nullable(ref, p.key, 'discovery target')]))])) }
}
export function parseTtrpgOpenRuleRequestV1(value: unknown): TtrpgOpenRuleRequestV1 {
  const hasInteraction = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value,'interactionKey')
  const hasDiscovery = value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'discovery')
  const r = p.record(value, ['route', 'ruleKey', 'actorKey', 'targetKey', 'controllerMode', 'effectBindings', ...(hasDiscovery ? ['discovery'] : []),...(hasInteraction ? ['interactionKey'] : [])], 'rule request')
  const rawBindings = p.object(r.effectBindings, 'effectBindings')
  if (Object.keys(rawBindings).length > 7) fail('effectBindings 超过七档后果')
  const effectBindings = Object.fromEntries(Object.entries(rawBindings).map(([planKey, value]) => {
    const row = p.object(value, 'effect parameter bindings')
    if (Object.keys(row).length > 32) fail('参数槽超过32')
    return [p.key(planKey, 'effect plan key'), Object.fromEntries(Object.entries(row).map(([slot, ref]) =>
      [p.key(slot, 'parameterKey'), p.nullable(ref, p.key, 'parameter binding')]))]
  }))
  if (hasInteraction && r.route !== 'existing-action') fail('互动只能绑定真实自动行动')
  return { ...(hasInteraction ? { interactionKey: p.key(r.interactionKey,'interaction key') } : {}),route: p.oneOf(r.route, ['existing-action', 'generic-check'], 'route'),
    ruleKey: p.key(r.ruleKey, 'ruleKey'), actorKey: p.key(r.actorKey, 'actorKey'),
    targetKey: p.nullable(r.targetKey, p.key, 'targetKey'),
    controllerMode: p.oneOf(r.controllerMode, ['human', 'ai'], 'controllerMode'), effectBindings,
    ...(hasDiscovery ? { discovery: parseTtrpgOpenDiscoveryRequestV1(r.discovery) } : {}) }
}
