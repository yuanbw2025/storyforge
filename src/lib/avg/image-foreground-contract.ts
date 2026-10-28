import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../product-production/character-alpha-matting'
import { avgEnum, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from './image-foreground-boundary-unmix'
import { AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3 } from './image-foreground-estimated-magenta-v3'

export const AVG_FOREGROUND_SAM2_MATTING_ID_V4 = 'storyforge.avg.foreground.sam2.1-pymatting.v4' as const
export const AVG_FOREGROUND_SAM2_MODEL_REVISION_V4 = '2b90b9f5ceec907a1c18123530e92e794ad901a4' as const
export const AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4 = '7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69' as const
export const AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4 = 'portrait-center-box75-v3' as const
export const AVG_FOREGROUND_SAM2_MATTING_METHOD_V4 = 'sam-mask-band4-pymatting-cf-ml-640' as const
export const AVG_FOREGROUND_SAM2_MATTING_ID_V5 = 'storyforge.avg.foreground.sam2.1-pymatting.v5' as const
export const AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5 = 'portrait-box75-or-body-anchors-v1' as const
export const AVG_FOREGROUND_SAM2_QUALITY_GATE_V5 = 'score075-largest010090-alpha010090-v1' as const
export const AVG_FOREGROUND_SAM2_MATTING_ID_V6 = 'storyforge.avg.foreground.sam2.1-pymatting.v6' as const
export const AVG_FOREGROUND_SAM2_MATTING_METHOD_V6 = 'sam-neutral-band4-pymatting-cf-ml-640.v1' as const
export const AVG_FOREGROUND_SAM2_QUALITY_GATE_V6 = 'score075-largest010090-neutral-edge.v1' as const
export const AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6 = 'bright-neutral-edge-connected.v1' as const
export const AVG_FOREGROUND_SAM2_MIN_SCORE_V5 = 0.75
export const AVG_FOREGROUND_SAM2_MIN_COVERAGE_V5 = 0.10
export const AVG_FOREGROUND_SAM2_MAX_COVERAGE_V5 = 0.90

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
/** Explicit local estimation is separate from the exact producer-side
 * reserved-magenta request. It records the observed border color in its
 * receipt and never relaxes V1/V2 semantics. */
export interface AvgForegroundPolicyV3 extends Omit<AvgForegroundPolicyV1, 'version' | 'algorithm' | 'method'> {
  version: 3
  method: 'estimated-magenta-family'
  algorithm: typeof AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3
}
/** Local semantic segmentation plus bounded-resolution alpha/foreground
 * estimation. Its model and recipe are frozen independently of magenta color
 * key contracts; its output remains a candidate for author review. */
export interface AvgForegroundPolicyV4 {
  schema: 'storyforge.avg.foreground-policy'
  version: 4
  method: 'local-sam2-box-matting'
  algorithm: typeof AVG_FOREGROUND_SAM2_MATTING_ID_V4
  model: 'sam2.1-hiera-tiny'
  modelRevision: typeof AVG_FOREGROUND_SAM2_MODEL_REVISION_V4
  checkpointSha256: typeof AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4
  promptStrategy: typeof AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4
  mattingMethod: typeof AVG_FOREGROUND_SAM2_MATTING_METHOD_V4
  declaration: string
}
/** The alternative prompt set and plausibility gate are a new frozen policy;
 * old V4 recipes keep their original box-only execution and receipt shape. */
export interface AvgForegroundPolicyV5 extends Omit<AvgForegroundPolicyV4, 'version' | 'method' | 'algorithm' | 'promptStrategy'> {
  version: 5
  method: 'local-sam2-box-anchor-matting'
  algorithm: typeof AVG_FOREGROUND_SAM2_MATTING_ID_V5
  promptStrategy: typeof AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5
  qualityGate: typeof AVG_FOREGROUND_SAM2_QUALITY_GATE_V5
}
/** A separate source prerequisite and refinement, never an amendment of a
 * frozen V5 candidate. It accepts only stable bright neutral backgrounds. */
export interface AvgForegroundPolicyV6 extends Omit<AvgForegroundPolicyV5, 'version' | 'method' | 'algorithm' | 'mattingMethod' | 'qualityGate'> {
  version: 6
  method: 'local-sam2-neutral-background-matting'
  algorithm: typeof AVG_FOREGROUND_SAM2_MATTING_ID_V6
  mattingMethod: typeof AVG_FOREGROUND_SAM2_MATTING_METHOD_V6
  qualityGate: typeof AVG_FOREGROUND_SAM2_QUALITY_GATE_V6
  backgroundRule: typeof AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6
}
export type AvgForegroundPolicy = AvgForegroundPolicyV1 | AvgForegroundPolicyV2 | AvgForegroundPolicyV3 | AvgForegroundPolicyV4 | AvgForegroundPolicyV5 | AvgForegroundPolicyV6

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
export function parseAvgForegroundPolicyV3(value: unknown): AvgForegroundPolicyV3 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'method', 'reservedColor',
    'subjectUsesReservedColor', 'algorithm', 'declaration'], 'estimated foreground policy')
  if (r.schema !== 'storyforge.avg.foreground-policy' || r.version !== 3 || r.subjectUsesReservedColor !== false) {
    throw new Error('[avg-foreground] 估色前景策略版本或主体用色声明无效')
  }
  return { schema: r.schema, version: 3,
    method: avgEnum(r.method, ['estimated-magenta-family'] as const, 'foreground.method'),
    reservedColor: avgEnum(r.reservedColor, ['#FF00FF'] as const, 'foreground.reservedColor'),
    subjectUsesReservedColor: false,
    algorithm: avgEnum(r.algorithm, [AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3] as const, 'foreground.algorithm'),
    declaration: avgText(r.declaration, 'foreground.declaration', 2000) }
}
export function parseAvgForegroundPolicyV4(value: unknown): AvgForegroundPolicyV4 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'method', 'algorithm', 'model',
    'modelRevision', 'checkpointSha256', 'promptStrategy', 'mattingMethod', 'declaration'], 'SAM 2 foreground policy')
  if (r.schema !== 'storyforge.avg.foreground-policy' || r.version !== 4) throw new Error('[avg-foreground] SAM 2 前景策略版本无效')
  return { schema: r.schema, version: 4,
    method: avgEnum(r.method, ['local-sam2-box-matting'] as const, 'foreground.method'),
    algorithm: avgEnum(r.algorithm, [AVG_FOREGROUND_SAM2_MATTING_ID_V4] as const, 'foreground.algorithm'),
    model: avgEnum(r.model, ['sam2.1-hiera-tiny'] as const, 'foreground.model'),
    modelRevision: avgEnum(r.modelRevision, [AVG_FOREGROUND_SAM2_MODEL_REVISION_V4] as const, 'foreground.modelRevision'),
    checkpointSha256: avgEnum(r.checkpointSha256, [AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4] as const, 'foreground.checkpointSha256'),
    promptStrategy: avgEnum(r.promptStrategy, [AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4] as const, 'foreground.promptStrategy'),
    mattingMethod: avgEnum(r.mattingMethod, [AVG_FOREGROUND_SAM2_MATTING_METHOD_V4] as const, 'foreground.mattingMethod'),
    declaration: avgText(r.declaration, 'foreground.declaration', 2000) }
}
export function parseAvgForegroundPolicyV5(value: unknown): AvgForegroundPolicyV5 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'method', 'algorithm', 'model',
    'modelRevision', 'checkpointSha256', 'promptStrategy', 'mattingMethod', 'qualityGate', 'declaration'], 'SAM 2 anchored foreground policy')
  if (r.schema !== 'storyforge.avg.foreground-policy' || r.version !== 5) throw new Error('[avg-foreground] SAM 2 锚点前景策略版本无效')
  return { schema: r.schema, version: 5,
    method: avgEnum(r.method, ['local-sam2-box-anchor-matting'] as const, 'foreground.method'),
    algorithm: avgEnum(r.algorithm, [AVG_FOREGROUND_SAM2_MATTING_ID_V5] as const, 'foreground.algorithm'),
    model: avgEnum(r.model, ['sam2.1-hiera-tiny'] as const, 'foreground.model'),
    modelRevision: avgEnum(r.modelRevision, [AVG_FOREGROUND_SAM2_MODEL_REVISION_V4] as const, 'foreground.modelRevision'),
    checkpointSha256: avgEnum(r.checkpointSha256, [AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4] as const, 'foreground.checkpointSha256'),
    promptStrategy: avgEnum(r.promptStrategy, [AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5] as const, 'foreground.promptStrategy'),
    mattingMethod: avgEnum(r.mattingMethod, [AVG_FOREGROUND_SAM2_MATTING_METHOD_V4] as const, 'foreground.mattingMethod'),
    qualityGate: avgEnum(r.qualityGate, [AVG_FOREGROUND_SAM2_QUALITY_GATE_V5] as const, 'foreground.qualityGate'),
    declaration: avgText(r.declaration, 'foreground.declaration', 2000) }
}
export function parseAvgForegroundPolicyV6(value: unknown): AvgForegroundPolicyV6 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'method', 'algorithm', 'model',
    'modelRevision', 'checkpointSha256', 'promptStrategy', 'mattingMethod', 'qualityGate', 'backgroundRule', 'declaration'], 'SAM 2 neutral background policy')
  if (r.schema !== 'storyforge.avg.foreground-policy' || r.version !== 6) throw new Error('[avg-foreground] SAM 2 亮灰背景策略版本无效')
  return { schema: r.schema, version: 6,
    method: avgEnum(r.method, ['local-sam2-neutral-background-matting'] as const, 'foreground.method'),
    algorithm: avgEnum(r.algorithm, [AVG_FOREGROUND_SAM2_MATTING_ID_V6] as const, 'foreground.algorithm'),
    model: avgEnum(r.model, ['sam2.1-hiera-tiny'] as const, 'foreground.model'),
    modelRevision: avgEnum(r.modelRevision, [AVG_FOREGROUND_SAM2_MODEL_REVISION_V4] as const, 'foreground.modelRevision'),
    checkpointSha256: avgEnum(r.checkpointSha256, [AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4] as const, 'foreground.checkpointSha256'),
    promptStrategy: avgEnum(r.promptStrategy, [AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5] as const, 'foreground.promptStrategy'),
    mattingMethod: avgEnum(r.mattingMethod, [AVG_FOREGROUND_SAM2_MATTING_METHOD_V6] as const, 'foreground.mattingMethod'),
    qualityGate: avgEnum(r.qualityGate, [AVG_FOREGROUND_SAM2_QUALITY_GATE_V6] as const, 'foreground.qualityGate'),
    backgroundRule: avgEnum(r.backgroundRule, [AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6] as const, 'foreground.backgroundRule'),
    declaration: avgText(r.declaration, 'foreground.declaration', 2000) }
}
export function parseAvgForegroundPolicy(value: unknown): AvgForegroundPolicy {
  const body = avgProtocolBody(value), version = body && typeof body === 'object' && 'version' in body ? body.version : null
  if (version === 1) return parseAvgForegroundPolicyV1(body)
  if (version === 2) return parseAvgForegroundPolicyV2(body)
  if (version === 3) return parseAvgForegroundPolicyV3(body)
  if (version === 4) return parseAvgForegroundPolicyV4(body)
  if (version === 5) return parseAvgForegroundPolicyV5(body)
  if (version === 6) return parseAvgForegroundPolicyV6(body)
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
export function supportsAvgSam2ForegroundRequirementV4(requirement: Pick<Requirement, 'mediaKind' | 'consumer' | 'alpha'>): boolean {
  return requirement.alpha === 'required'
    && ['character-pose', 'character-expression'].includes(requirement.mediaKind)
    && (requirement.consumer.domain === 'stage' && requirement.consumer.slot === 'actor'
      || requirement.consumer.domain === 'reference' && requirement.consumer.slot === 'identity')
}
function assertSam2ForegroundTarget(requirement: Requirement) {
  if (!supportsAvgSam2ForegroundRequirementV4(requirement)) {
    throw new Error('[avg-foreground] SAM 2 固定人物框策略只支持要求透明的人物立绘与身份参考')
  }
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
  if (parsed.version === 4 || parsed.version === 5 || parsed.version === 6) { assertSam2ForegroundTarget(requirement); return structuredClone(requirement) }
  assertForegroundTarget(requirement)
  const result = structuredClone(requirement)
  if (!result.invariants.includes(AVG_RESERVED_MAGENTA_INVARIANT_V1)) result.invariants.push(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  if (!result.forbiddenDepictions.includes(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)) result.forbiddenDepictions.push(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)
  return result
}
export function assertAvgForegroundRequirementBinding(policy: AvgForegroundPolicy, requirement: Requirement) {
  const parsed = parseAvgForegroundPolicy(policy)
  if (parsed.version === 1) return assertAvgForegroundRequirementBindingV1(parsed, requirement)
  if (parsed.version === 4 || parsed.version === 5 || parsed.version === 6) { assertSam2ForegroundTarget(requirement); return }
  assertForegroundTarget(requirement)
  if (!requirement.invariants.includes(AVG_RESERVED_MAGENTA_INVARIANT_V1)
    || !requirement.forbiddenDepictions.includes(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)) {
    throw new Error('[avg-foreground] 原图需求缺少冻结的保留底色与主体排除声明')
  }
}
