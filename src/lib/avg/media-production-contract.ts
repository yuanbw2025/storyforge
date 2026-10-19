import type { FrozenRuntimeMediaAssetV2, ProductMediaKind } from '../types'
import { parseAvgConsumerV1, type AvgConsumerV1 } from './runtime-contract-v2'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { parseAvgMediaReferencesV1, type AvgMediaReferenceV1 } from './media-reference-contract'
import { avgBoolean, avgEnum, avgHash, avgKey, avgKeys, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import { parseAvgCharacterFamilyBatchV1, type AvgCharacterFamilyBatchV1 } from './character-family-contract'

/** An image request is production input, never a selected image or a binding. */
export interface AvgVisualProductionRequirementV1 {
  requirementKey: string
  revision: number
  assetKey: string
  name: string
  altText: string
  family: { subjectKey: string; familyKey: string; variantKey: string; revision: number }
  consumer: AvgConsumerV1
  triggerBeatKey: string | null
  itemVariantKey: string | null
  mediaKind: Extract<ProductMediaKind, 'background' | 'character-pose' | 'character-expression' | 'cg' | 'ui'>
  prompt: string
  negativePrompt: string
  invariants: string[]
  forbiddenDepictions: string[]
  width: number
  height: number
  resolutionTier: '1K' | '2K'
  alpha: 'required' | 'not-required'
  references: AvgMediaReferenceV1[]
}

export interface AvgVisualProductionBatchV1 {
  schema: 'storyforge.avg.visual-production-batch'
  version: 1
  batchKey: string
  revision: number
  /** Required before the final author-stage exists, so dispatch can validate
   * exact accepted rules/scripts without consulting a mutable editor draft. */
  aspectRatio: '16:9' | '4:3'
  sourceInputHash: string
  requirements: AvgVisualProductionRequirementV1[]
  characterFamily?: AvgCharacterFamilyBatchV1
  visualReviewPolicy?: 'author-visual-v1'
}

/** A separate author selection over an immutable provider Artifact. Raw output
 * may be accepted as production evidence; this selection grants its exact use. */
export interface AvgAuthorMediaChoiceV1 {
  schema: 'storyforge.avg.media-choice'
  version: 1
  requirementKey: string
  requirementRevision: number
  raw: { artifactKey: string; version: number; contentHash: string }
  asset: FrozenRuntimeMediaAssetV2
  referenceOnly: boolean
  declaration: string
}
/** V1 remains raw-only. V2 selects a separately proved local derivative while
 * retaining the exact original provider revision. */
export interface AvgAuthorMediaChoiceV2 extends Omit<AvgAuthorMediaChoiceV1,'version'> {
  version:2
  processed:{artifactKey:string;version:number;contentHash:string}
}
export type AvgAuthorMediaChoice=AvgAuthorMediaChoiceV1|AvgAuthorMediaChoiceV2

export const AVG_VISUAL_BATCH_LIMIT_V1 = 8
export function avgRawMediaArtifactKeyV1(requirementKey: string): string { return `avg.media.raw.${requirementKey}` }
export function avgMediaChoiceArtifactKeyV1(requirementKey: string): string { return `avg.media.choice.${requirementKey}` }
export function avgVisualReviewArtifactKeyV1(requirementKey:string):string{return `avg.review.visual.${requirementKey}`}

function texts(value: unknown, label: string): string[] {
  return avgList(value, label, (value, path) => avgText(value, path, 2000), 100)
}
function requirementKey(value: unknown): string {
  avgText(value, 'requirementKey', 80)
  return avgKey(value, 'requirementKey')
}

export function parseAvgVisualProductionRequirementV1(value: unknown): AvgVisualProductionRequirementV1 {
  return parseAvgVisualProductionRequirementWithReferences(value,parseAvgMediaReferencesV1)
}

/** Shared scalar/consumer validation; each public codec supplies its exact reference version. */
export function parseAvgVisualProductionRequirementWithReferences<R>(value:unknown,parseReferences:(value:unknown)=>R[]):Omit<AvgVisualProductionRequirementV1,'references'>&{references:R[]} {
  const r = avgRecord(value, ['requirementKey', 'revision', 'assetKey', 'name', 'altText', 'family', 'consumer', 'mediaKind',
    'triggerBeatKey', 'itemVariantKey', 'prompt', 'negativePrompt', 'invariants', 'forbiddenDepictions', 'width', 'height', 'resolutionTier', 'alpha', 'references'], 'visual requirement')
  const f = avgRecord(r.family, ['subjectKey', 'familyKey', 'variantKey', 'revision'], 'media family')
  const consumer = parseAvgConsumerV1(r.consumer)
  const mediaKind = avgEnum(r.mediaKind, ['background', 'character-pose', 'character-expression', 'cg', 'ui'] as const, 'mediaKind')
  const subjectKey = avgKey(f.subjectKey, 'family.subjectKey')
  if (subjectKey !== consumer.subjectKey) throw new Error('[avg-media] 家族与 consumer 主体不一致')
  const supported = consumer.domain === 'stage' && (
    consumer.slot === 'background' && mediaKind === 'background'
    || consumer.slot === 'actor' && ['character-pose', 'character-expression'].includes(mediaKind)
    || consumer.slot === 'cg' && mediaKind === 'cg'
  ) || consumer.domain === 'inventory' && consumer.slot === 'icon' && mediaKind === 'ui'
    || consumer.domain === 'evidence' && consumer.slot === 'detail' && mediaKind === 'cg'
    || consumer.domain === 'reference' && ['identity', 'style'].includes(consumer.slot)
  if (!supported) throw new Error('[avg-media] 媒资用途与已实现的图像消费者不闭合')
  const triggerBeatKey = r.triggerBeatKey === null ? null : avgKey(r.triggerBeatKey, 'triggerBeatKey')
  const itemVariantKey = r.itemVariantKey === null ? null : avgKey(r.itemVariantKey, 'itemVariantKey')
  if ((consumer.domain === 'stage') !== (triggerBeatKey !== null)
    || consumer.domain !== 'stage' && consumer.sceneKey !== null
    || itemVariantKey !== null && !['inventory', 'evidence'].includes(consumer.domain)) throw new Error('[avg-media] 消费触发拍或物件显示变体与用途不符')
  const invariants = texts(r.invariants, 'invariants'), forbiddenDepictions = texts(r.forbiddenDepictions, 'forbiddenDepictions')
  const prompt = avgText(r.prompt, 'prompt', 12_000), negativePrompt = avgText(r.negativePrompt, 'negativePrompt', 4000, true)
  if (prompt.length + invariants.join('\n').length > 18_000 || negativePrompt.length + forbiddenDepictions.join('\n').length > 7000) {
    throw new Error('[avg-media] 合成后的图像需求超过单请求文本上限')
  }
  return {
    requirementKey: requirementKey(r.requirementKey), revision: avgNumber(r.revision, 'requirement.revision', 1, 1_000_000),
    assetKey: avgKey(r.assetKey, 'assetKey'), name: avgText(r.name, 'name', 200), altText: avgText(r.altText, 'altText', 1000),
    family: { subjectKey, familyKey: avgKey(f.familyKey, 'familyKey'), variantKey: avgKey(f.variantKey, 'variantKey'), revision: avgNumber(f.revision, 'family.revision', 1, 1_000_000) },
    consumer, triggerBeatKey, itemVariantKey, mediaKind, prompt, negativePrompt, invariants, forbiddenDepictions,
    width: avgNumber(r.width, 'width', 320, 8192), height: avgNumber(r.height, 'height', 320, 8192),
    resolutionTier: avgEnum(r.resolutionTier, ['1K', '2K'] as const, 'resolutionTier'), alpha: avgEnum(r.alpha, ['required', 'not-required'] as const, 'alpha'),
    references: parseReferences(r.references),
  }
}

export function parseAvgVisualProductionBatchV1(value: unknown): AvgVisualProductionBatchV1 {
  return parseAvgVisualProductionBatchWithCodecs(value,1,parseAvgVisualProductionRequirementV1,parseAvgCharacterFamilyBatchV1)
}

/** Closed batch shape, bounds and consumer uniqueness shared by explicit versions. */
export function parseAvgVisualProductionBatchWithCodecs<V extends 1|2,R extends Pick<AvgVisualProductionRequirementV1,'requirementKey'|'assetKey'|'consumer'|'triggerBeatKey'|'itemVariantKey'>,F>(value:unknown,expectedVersion:V,parseRequirement:(value:unknown)=>R,parseFamily:(value:unknown)=>F) {
  const body=avgProtocolBody(value),hasFamily=!!body&&Object.prototype.hasOwnProperty.call(body,'characterFamily'),hasReview=!!body&&Object.prototype.hasOwnProperty.call(body,'visualReviewPolicy')
  const r = avgRecord(body, ['schema', 'version', 'batchKey', 'revision', 'aspectRatio', 'sourceInputHash', 'requirements',...(hasFamily?['characterFamily']:[]),...(hasReview?['visualReviewPolicy']:[])], 'visual batch')
  if (r.schema !== 'storyforge.avg.visual-production-batch' || r.version !== expectedVersion) throw new Error('[avg-media] 未登记的视觉批次版本')
  const requirements = avgUnique(avgList(r.requirements, 'requirements', parseRequirement, AVG_VISUAL_BATCH_LIMIT_V1), r => r.requirementKey, 'requirements')
  if (!requirements.length) throw new Error('[avg-media] 视觉批次必须有明确需求')
  avgUnique(requirements, r => r.assetKey, 'generated asset keys')
  // Same target twice is a visible choice/conflict, never last-write-wins binding.
  avgUnique(requirements.filter(r => r.consumer.domain !== 'reference'), r => [r.consumer.domain, r.consumer.slot, r.consumer.subjectKey,
    r.consumer.sceneKey, r.consumer.lineKey, r.triggerBeatKey, r.itemVariantKey].join('\u0000'), 'media consumer targets')
  return { schema: 'storyforge.avg.visual-production-batch' as const, version: expectedVersion, batchKey: avgKey(r.batchKey, 'batchKey'),
    revision: avgNumber(r.revision, 'batch.revision', 1, 1_000_000), aspectRatio: avgEnum(r.aspectRatio, ['16:9', '4:3'] as const, 'batch.aspectRatio'),
    sourceInputHash: avgHash(r.sourceInputHash, 'sourceInputHash'), requirements,
    ...(hasFamily?{characterFamily:parseFamily(r.characterFamily)}:{}),...(hasReview?{visualReviewPolicy:avgEnum(r.visualReviewPolicy,['author-visual-v1'] as const,'visualReviewPolicy')}:{}) }
}

export function parseAvgAuthorMediaChoiceV1(value: unknown): AvgAuthorMediaChoiceV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'requirementKey', 'requirementRevision', 'raw', 'asset', 'referenceOnly', 'declaration'], 'author media choice')
  if (r.schema !== 'storyforge.avg.media-choice' || r.version !== 1) throw new Error('[avg-media] 未登记的媒资选择版本')
  return {...parseAuthorMediaChoiceFields(r,true),version:1}
}
function parseAuthorMediaChoiceFields(r:Record<string,unknown>,rawOnly:boolean):Omit<AvgAuthorMediaChoiceV1,'version'>{
  const raw = avgRecord(r.raw, ['artifactKey', 'version', 'contentHash'], 'raw media artifact')
  const key = requirementKey(r.requirementKey)
  if (avgKey(raw.artifactKey, 'raw.artifactKey') !== avgRawMediaArtifactKeyV1(key)) throw new Error('[avg-media] 原始候选与需求 key 不一致')
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [r.asset] }).assets[0]!
  if (!asset.mimeType.startsWith('image/') || !['background', 'character-pose', 'character-expression', 'cg', 'ui'].includes(asset.kind)
    || rawOnly&&asset.contentHash !== raw.contentHash) throw new Error('[avg-media] V1 媒资选择只接受原始图片；加工产物须独立 lineage 合同')
  return { schema: 'storyforge.avg.media-choice', requirementKey: key,
    requirementRevision: avgNumber(r.requirementRevision, 'requirementRevision', 1, 1_000_000),
    raw: { artifactKey: raw.artifactKey as string, version: avgNumber(raw.version, 'raw.version', 1, 1_000_000), contentHash: avgHash(raw.contentHash, 'raw.contentHash') },
    asset,
    referenceOnly: avgBoolean(r.referenceOnly, 'referenceOnly'), declaration: avgText(r.declaration, 'media choice declaration', 2000) }
}

export function parseAvgAuthorMediaChoice(value:unknown):AvgAuthorMediaChoice{
  const body=avgProtocolBody(value)
  if((body as {version?:unknown}|null)?.version!==2)return parseAvgAuthorMediaChoiceV1(body)
  const r=avgRecord(body,['schema','version','requirementKey','requirementRevision','raw','processed','asset','referenceOnly','declaration'],'processed media choice')
  if(r.schema!=='storyforge.avg.media-choice')throw new Error('[avg-process] 未登记的加工图选择版本')
  const p=avgRecord(r.processed,['artifactKey','version','contentHash'],'processed choice'),parsed=parseAuthorMediaChoiceFields(r,false),asset=parsed.asset
  if(p.artifactKey!==`avg.media.processed.${parsed.requirementKey}`||p.contentHash!==asset.contentHash)throw new Error('[avg-process] 作者选择与准确加工图不一致')
  return {...parsed,version:2,asset,processed:{artifactKey:p.artifactKey,version:avgNumber(p.version,'processed.version',1,1e9),contentHash:avgHash(p.contentHash,'processed.contentHash')}}
}

/** Frozen Plan outputs include each raw candidate and its explicit author choice. */
export function avgVisualBatchArtifactKeysV1(batch: AvgVisualProductionBatchV1): string[] {
  return avgKeys(batch.requirements.flatMap(r => [avgRawMediaArtifactKeyV1(r.requirementKey),...(batch.visualReviewPolicy?[avgVisualReviewArtifactKeyV1(r.requirementKey)]:[]), avgMediaChoiceArtifactKeyV1(r.requirementKey)]), 'media outputs')
}
