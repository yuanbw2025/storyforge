import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../product-production/character-alpha-matting'
import { avgEnum, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from './image-foreground-boundary-unmix'

export interface AvgForegroundPolicyV1 {
  schema: 'storyforge.avg.foreground-policy'
  version: 1
  method: 'reserved-magenta'
  reservedColor: '#FF00FF'
  subjectUsesReservedColor: false
  algorithm: typeof DECLARED_MAGENTA_ALPHA_MATTING_ID_V1
  declaration: string
}
export interface AvgForegroundPolicyV2 extends Omit<AvgForegroundPolicyV1, 'version' | 'algorithm'> {
  version: 2
  algorithm: typeof AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2
}
export type AvgForegroundPolicy = AvgForegroundPolicyV1 | AvgForegroundPolicyV2

export const AVG_RESERVED_MAGENTA_INVARIANT_V1 = '[storyforge.avg.foreground-policy@1] 角色或物件以外的底色只能为纯品红 #FF00FF；不得有渐变、阴影、纹理或棋盘格。'
export const AVG_RESERVED_MAGENTA_FORBIDDEN_V1 = '[storyforge.avg.foreground-policy@1] 主体、服装和道具禁止使用品红及其相近色；保留底色只允许作为待移除背景。'

export function parseAvgForegroundPolicyV1(value: unknown): AvgForegroundPolicyV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'method', 'reservedColor',
    'subjectUsesReservedColor', 'algorithm', 'declaration'], 'foreground policy')
  if (r.schema !== 'storyforge.avg.foreground-policy' || r.version !== 1 || r.subjectUsesReservedColor !== false) {
    throw new Error('[avg-foreground] 前景策略版本或主体底色声明无效')
  }
  return { schema: r.schema, version: 1,
    method: avgEnum(r.method, ['reserved-magenta'] as const, 'foreground.method'),
    reservedColor: avgEnum(r.reservedColor, ['#FF00FF'] as const, 'foreground.reservedColor'),
    subjectUsesReservedColor: false,
    algorithm: avgEnum(r.algorithm, [DECLARED_MAGENTA_ALPHA_MATTING_ID_V1] as const, 'foreground.algorithm'),
    declaration: avgText(r.declaration, 'foreground.declaration', 2000) }
}

/** The reserved source colour contract remains exact; only the explicit local
 * algorithm changes. This does not amend a prior request or grant new rights. */
export function parseAvgForegroundPolicyV2(value: unknown): AvgForegroundPolicyV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'method', 'reservedColor',
    'subjectUsesReservedColor', 'algorithm', 'declaration'], 'foreground boundary policy')
  if (r.schema !== 'storyforge.avg.foreground-policy' || r.version !== 2 || r.subjectUsesReservedColor !== false) {
    throw new Error('[avg-foreground] 边缘还原策略版本或主体底色声明无效')
  }
  return { schema: r.schema, version: 2,
    method: avgEnum(r.method, ['reserved-magenta'] as const, 'foreground.method'),
    reservedColor: avgEnum(r.reservedColor, ['#FF00FF'] as const, 'foreground.reservedColor'),
    subjectUsesReservedColor: false,
    algorithm: avgEnum(r.algorithm, [AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2] as const, 'foreground.algorithm'),
    declaration: avgText(r.declaration, 'foreground.declaration', 2000) }
}
export function parseAvgForegroundPolicy(value: unknown): AvgForegroundPolicy {
  const body = avgProtocolBody(value), version = body && typeof body === 'object' && 'version' in body ? body.version : null
  if (version === 1) return parseAvgForegroundPolicyV1(body)
  if (version === 2) return parseAvgForegroundPolicyV2(body)
  throw new Error('[avg-foreground] 未登记的前景策略版本')
}

type Requirement = Pick<AvgVisualProductionRequirementV1, 'mediaKind' | 'consumer' | 'alpha' | 'invariants' | 'forbiddenDepictions'>

export function supportsAvgForegroundRequirementV1(requirement:Pick<Requirement,'mediaKind'|'consumer'|'alpha'>):boolean {
  const character = ['character-pose', 'character-expression'].includes(requirement.mediaKind)
    && (requirement.consumer.domain === 'stage' && requirement.consumer.slot === 'actor'
      || requirement.consumer.domain === 'reference' && requirement.consumer.slot === 'identity')
  const icon = requirement.mediaKind === 'ui' && requirement.consumer.domain === 'inventory' && requirement.consumer.slot === 'icon'
  return requirement.alpha==='required'&&(character||icon)
}
function assertForegroundTarget(requirement: Requirement) {
  if (!supportsAvgForegroundRequirementV1(requirement)) throw new Error('[avg-foreground] 该用途没有明确的透明前景合同')
}

/** Pure compiler proposal, without dispatch, author adoption or byte authority.
 * The caller must reparse the complete requirement and freeze it before the
 * original request; it must never patch an already authorized raw request. */
export function compileAvgForegroundRequirementV1<T extends Requirement>(policy: AvgForegroundPolicyV1, requirement: T): T {
  parseAvgForegroundPolicyV1(policy)
  assertForegroundTarget(requirement)
  const result = structuredClone(requirement)
  if (!result.invariants.includes(AVG_RESERVED_MAGENTA_INVARIANT_V1)) result.invariants.push(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  if (!result.forbiddenDepictions.includes(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)) result.forbiddenDepictions.push(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)
  return result
}

/** Must be checked against the actual frozen requirement and raw producer by
 * the formal caller. Strings alone grant no processing or selection rights. */
export function assertAvgForegroundRequirementBindingV1(policy: AvgForegroundPolicyV1, requirement: Requirement) {
  parseAvgForegroundPolicyV1(policy)
  assertForegroundTarget(requirement)
  if (!requirement.invariants.includes(AVG_RESERVED_MAGENTA_INVARIANT_V1)
    || !requirement.forbiddenDepictions.includes(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)) {
    throw new Error('[avg-foreground] 原图需求缺少冻结的保留底色与主体排除声明')
  }
}

export function compileAvgForegroundRequirement<T extends Requirement>(policy: AvgForegroundPolicy, requirement: T): T {
  const parsed = parseAvgForegroundPolicy(policy)
  if (parsed.version === 1) return compileAvgForegroundRequirementV1(parsed, requirement)
  assertForegroundTarget(requirement)
  const result = structuredClone(requirement)
  if (!result.invariants.includes(AVG_RESERVED_MAGENTA_INVARIANT_V1)) result.invariants.push(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  if (!result.forbiddenDepictions.includes(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)) result.forbiddenDepictions.push(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)
  return result
}
export function assertAvgForegroundRequirementBinding(policy: AvgForegroundPolicy, requirement: Requirement) {
  const parsed = parseAvgForegroundPolicy(policy)
  if (parsed.version === 1) return assertAvgForegroundRequirementBindingV1(parsed, requirement)
  assertForegroundTarget(requirement)
  if (!requirement.invariants.includes(AVG_RESERVED_MAGENTA_INVARIANT_V1)
    || !requirement.forbiddenDepictions.includes(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)) {
    throw new Error('[avg-foreground] 原图需求缺少冻结的保留底色与主体排除声明')
  }
}
