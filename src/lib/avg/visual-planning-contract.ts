import { avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import { AVG_VISUAL_BATCH_LIMIT_V1, parseAvgVisualProductionRequirementV1, type AvgVisualProductionRequirementV1 } from './media-production-contract'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V1, parseAvgMediaReferencesV1, type AvgMediaReferenceV1 } from './media-reference-contract'

export const AVG_VISUAL_DESIGN_KINDS_V1 = ['character', 'environment', 'prop'] as const
/** A shared direction can outlive many bounded eight-image batches. */
export const AVG_VISUAL_BIBLE_SUBJECT_LIMIT_V1 = 128
export type AvgVisualDesignKindV1 = typeof AVG_VISUAL_DESIGN_KINDS_V1[number]
export type AvgVisualTemplateParametersV1 = Omit<AvgVisualProductionRequirementV1,
  'prompt' | 'negativePrompt' | 'invariants' | 'forbiddenDepictions' | 'references'>

/** Author/system-owned boundary, not model output or permission evidence. */
export interface AvgVisualRequirementTemplateV1 {
  subjectKind: AvgVisualDesignKindV1
  parameters: AvgVisualTemplateParametersV1
  requiredDetails: string[]
  forbiddenDepictions: string[]
  allowedReferenceKeys: string[]
  requiredReferenceKeys: string[]
}
export interface AvgVisualPlanningScopeV1 {
  schema: 'storyforge.avg.visual-planning-scope'; version: 1
  batchKey: string; revision: number; aspectRatio: '16:9' | '4:3'; sourceInputHash: string
  templates: AvgVisualRequirementTemplateV1[]
  referenceCatalog: Array<{ referenceKey: string; reference: AvgMediaReferenceV1 }>
}

/** Inert parameters for source/Plan validation only. Real requests must use
 * the adopted compiler artifact; these words are never stored or dispatched. */
export function avgVisualPlanningTemplateRequirementsV1(scope: AvgVisualPlanningScopeV1): AvgVisualProductionRequirementV1[] {
  return scope.templates.map(t=>({...t.parameters,prompt:'Topology validation only',negativePrompt:'',
    invariants:[...new Set(t.requiredDetails)],forbiddenDepictions:[...new Set(t.forbiddenDepictions)],
    references:t.requiredReferenceKeys.map(key=>scope.referenceCatalog.find(r=>r.referenceKey===key)!.reference)}))
}

/** Semantic candidates only. No model-supplied hashes, grants or receipts. */
export interface AvgVisualBibleV1 {
  schema: 'storyforge.avg.visual-bible'; version: 1
  style: { medium: string; rendering: string; palette: string[]; lighting: string; composition: string }
  subjects: Array<{ subjectKey: string; subjectKind: AvgVisualDesignKindV1; identityInvariants: string[]; allowedChanges: string[]; forbiddenDepictions: string[] }>
}
export interface AvgMediaBriefV1 {
  schema: 'storyforge.avg.media-brief'; version: 1
  subjectKey: string; subjectKind: AvgVisualDesignKindV1; designIntent: string
  outputs: Array<{ requirementKey: string; prompt: string; negativePrompt: string; invariants: string[]; forbiddenDepictions: string[]; referenceKeys: string[] }>
}

const parameterKeys = ['requirementKey', 'revision', 'assetKey', 'name', 'altText', 'family', 'consumer',
  'triggerBeatKey', 'itemVariantKey', 'mediaKind', 'width', 'height', 'resolutionTier', 'alpha'] as const
const texts = (value: unknown, label: string) => avgList(value, label, (v, p) => avgText(v, p, 1000), 24)
const keys = (value: unknown, label: string, max: number) => avgUnique(avgList(value, label, avgKey, max), v => v, label)
const kind = (value: unknown) => avgEnum(value, AVG_VISUAL_DESIGN_KINDS_V1, 'subjectKind')

export function parseAvgVisualRequirementTemplateV1(value: unknown): AvgVisualRequirementTemplateV1 {
  const r = avgRecord(value, ['subjectKind', 'parameters', 'requiredDetails', 'forbiddenDepictions', 'allowedReferenceKeys', 'requiredReferenceKeys'], 'visual requirement template')
  const p = avgRecord(r.parameters, parameterKeys, 'visual template parameters')
  const { prompt: _prompt, negativePrompt: _negative, invariants: _invariants, forbiddenDepictions: _forbidden, references: _references, ...parameters } =
    parseAvgVisualProductionRequirementV1({ ...p, prompt: 'Planning input only', negativePrompt: '', invariants: [], forbiddenDepictions: [], references: [] })
  const subjectKind = kind(r.subjectKind), c = parameters.consumer
  const supported = subjectKind === 'character' && (c.domain === 'stage' && c.slot === 'actor' || c.domain === 'reference')
      && ['character-pose', 'character-expression'].includes(parameters.mediaKind)
    || subjectKind === 'environment' && (c.domain === 'stage' && c.slot === 'background' || c.domain === 'reference')
      && parameters.mediaKind === 'background'
    || subjectKind === 'prop' && (c.domain === 'inventory' || c.domain === 'evidence' || c.domain === 'reference')
      && ['ui', 'cg'].includes(parameters.mediaKind)
  if (!supported) throw new Error('[avg-visual-plan] 专业岗位与已支持的图片消费槽不一致')
  const allowedReferenceKeys = keys(r.allowedReferenceKeys, 'allowedReferenceKeys', AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferences)
  const requiredReferenceKeys = keys(r.requiredReferenceKeys, 'requiredReferenceKeys', AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferences)
  if (requiredReferenceKeys.some(key => !allowedReferenceKeys.includes(key))) throw new Error('[avg-visual-plan] 必需参考超出允许目录')
  return { subjectKind, parameters, requiredDetails: texts(r.requiredDetails, 'requiredDetails'),
    forbiddenDepictions: texts(r.forbiddenDepictions, 'forbiddenDepictions'), allowedReferenceKeys, requiredReferenceKeys }
}

export function parseAvgVisualPlanningScopeV1(value: unknown): AvgVisualPlanningScopeV1 {
  return parseAvgVisualPlanningScopeWithReferences(value,1,value=>parseAvgMediaReferencesV1([value])[0]!)
}

/** Shared frozen topology; reference codecs and enclosing version stay explicit. */
export function parseAvgVisualPlanningScopeWithReferences<V extends 1|2,R>(value:unknown,expectedVersion:V,parseReference:(value:unknown)=>R) {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'batchKey', 'revision', 'aspectRatio', 'sourceInputHash', 'templates', 'referenceCatalog'], 'visual planning scope')
  if (r.schema !== 'storyforge.avg.visual-planning-scope' || r.version !== expectedVersion) throw new Error('[avg-visual-plan] 策划范围版本无效')
  const templates = avgUnique(avgList(r.templates, 'templates', parseAvgVisualRequirementTemplateV1, AVG_VISUAL_BATCH_LIMIT_V1), t => t.parameters.requirementKey, 'templates')
  if (!templates.length) throw new Error('[avg-visual-plan] 必须先冻结具体图片用途')
  avgUnique(templates, t => t.parameters.assetKey, 'template asset keys')
  const subjectKinds = new Map<string, AvgVisualDesignKindV1>()
  for (const template of templates) {
    const key = template.parameters.family.subjectKey, previous = subjectKinds.get(key)
    avgMediaBriefArtifactKeyV1(template.subjectKind, key)
    if (previous && previous !== template.subjectKind) throw new Error('[avg-visual-plan] 同一主体不能借用不同专业岗位')
    subjectKinds.set(key, template.subjectKind)
  }
  const referenceCatalog = avgUnique(avgList(r.referenceCatalog, 'referenceCatalog', value => {
    const entry = avgRecord(value, ['referenceKey', 'reference'], 'planning reference')
    return { referenceKey: avgKey(entry.referenceKey, 'referenceKey'), reference: parseReference(entry.reference) }
  }, AVG_VISUAL_BATCH_LIMIT_V1 * AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferences), e => e.referenceKey, 'reference catalog')
  const used = new Set(templates.flatMap(t => t.allowedReferenceKeys))
  if (referenceCatalog.some(e => !used.has(e.referenceKey)) || [...used].some(key => !referenceCatalog.some(e => e.referenceKey === key))) {
    throw new Error('[avg-visual-plan] 参考目录与本批明确允许范围不闭合')
  }
  return { schema: 'storyforge.avg.visual-planning-scope' as const, version: expectedVersion, batchKey: avgKey(r.batchKey, 'batchKey'), revision: avgNumber(r.revision, 'scope.revision', 1, 1_000_000),
    aspectRatio: avgEnum(r.aspectRatio, ['16:9', '4:3'] as const, 'scope.aspectRatio'), sourceInputHash: avgHash(r.sourceInputHash, 'scope.sourceInputHash'), templates, referenceCatalog }
}

export function parseAvgVisualBibleV1(value: unknown): AvgVisualBibleV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'style', 'subjects'], 'visual bible')
  if (r.schema !== 'storyforge.avg.visual-bible' || r.version !== 1) throw new Error('[avg-visual-plan] 视觉基准版本无效')
  const s = avgRecord(r.style, ['medium', 'rendering', 'palette', 'lighting', 'composition'], 'visual style')
  const palette = avgList(s.palette, 'palette', (v, p) => avgText(v, p, 100), 12)
  if (!palette.length) throw new Error('[avg-visual-plan] 视觉基准缺少明确配色')
  const subjects = avgUnique(avgList(r.subjects, 'visual subjects', value => {
    const subject = avgRecord(value, ['subjectKey', 'subjectKind', 'identityInvariants', 'allowedChanges', 'forbiddenDepictions'], 'visual subject')
    const identityInvariants = texts(subject.identityInvariants, 'identityInvariants'), allowedChanges = texts(subject.allowedChanges, 'allowedChanges')
    if (!identityInvariants.length || !allowedChanges.length) throw new Error('[avg-visual-plan] 主体必须明确保持项与允许变化')
    return { subjectKey: avgKey(subject.subjectKey, 'subjectKey'), subjectKind: kind(subject.subjectKind), identityInvariants, allowedChanges,
      forbiddenDepictions: texts(subject.forbiddenDepictions, 'subject.forbiddenDepictions') }
  }, AVG_VISUAL_BIBLE_SUBJECT_LIMIT_V1), subject => subject.subjectKey, 'visual subjects')
  if (!subjects.length) throw new Error('[avg-visual-plan] 视觉基准缺少本批主体')
  return { schema: r.schema, version: 1, style: { medium: avgText(s.medium, 'medium', 1000), rendering: avgText(s.rendering, 'rendering', 1000),
    palette, lighting: avgText(s.lighting, 'lighting', 1000), composition: avgText(s.composition, 'composition', 2000) }, subjects }
}

export function parseAvgMediaBriefV1(value: unknown): AvgMediaBriefV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'subjectKey', 'subjectKind', 'designIntent', 'outputs'], 'media brief')
  if (r.schema !== 'storyforge.avg.media-brief' || r.version !== 1) throw new Error('[avg-visual-plan] 主体媒资方案版本无效')
  const outputs = avgUnique(avgList(r.outputs, 'brief outputs', value => {
    const o = avgRecord(value, ['requirementKey', 'prompt', 'negativePrompt', 'invariants', 'forbiddenDepictions', 'referenceKeys'], 'brief output')
    return { requirementKey: avgKey(o.requirementKey, 'output.requirementKey'), prompt: avgText(o.prompt, 'output.prompt', 6000),
      negativePrompt: avgText(o.negativePrompt, 'output.negativePrompt', 2000, true), invariants: texts(o.invariants, 'output.invariants'),
      forbiddenDepictions: texts(o.forbiddenDepictions, 'output.forbiddenDepictions'), referenceKeys: keys(o.referenceKeys, 'output.referenceKeys', AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferences) }
  }, AVG_VISUAL_BATCH_LIMIT_V1), output => output.requirementKey, 'brief outputs')
  if (!outputs.length) throw new Error('[avg-visual-plan] 主体方案缺少准确需求')
  return { schema: r.schema, version: 1, subjectKey: avgKey(r.subjectKey, 'subjectKey'), subjectKind: kind(r.subjectKind),
    designIntent: avgText(r.designIntent, 'designIntent', 2000), outputs }
}

export function avgMediaBriefArtifactKeyV1(subjectKind: AvgVisualDesignKindV1, subjectKey: string): string {
  kind(subjectKind)
  return avgKey(`avg.media.${subjectKind}-brief.${avgKey(subjectKey, 'subjectKey')}`, 'media brief artifactKey')
}
