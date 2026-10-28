import type { FrozenRuntimeMediaAssetV2, ProductBuildArtifactRecordV1 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgEnum, avgHash, avgKey, avgNumber, avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { avgProcessedAudioArtifactKeyV1, parseAvgAudioProductionProcessingPlanV1,
  parseAvgAudioProductionProcessingPlan, type AvgAudioProductionProcessingPlan,
  type AvgAudioProductionProcessingPlanV1, type AvgAudioProcessingDomainV1 } from './audio-production-contract'
import { assertAvgAudioProcessingReceiptV1, parseAvgAudioProcessingReceiptV1, parseAvgAudioProcessingRecipeV1,
  type AvgAudioProcessingReceiptV1, type AvgAudioProcessingRecipeV1 } from './audio-processing-contract'
import { parseAvgAudioProcessingRecipe, parseAvgAudioProcessingReceipt, assertAvgAudioProcessingReceipt } from './audio-processing-versioned-contract'
import type { AvgAudioProcessingRecipeV2, AvgAudioProcessingReceiptV2 } from './audio-processing-contract-v2'

export interface AvgProcessedAudioRawReferenceV1 {
  artifactKey: string; version: number; contentHash: string; producerReceiptHash: string
}
export interface AvgProcessedAudioPayloadV1 {
  schema: 'storyforge.avg.processed-audio'; version: 1
  domain: AvgAudioProcessingDomainV1; requirementKey: string; requestIdentityHash: string
  raw: AvgProcessedAudioRawReferenceV1; sourceAsset: FrozenRuntimeMediaAssetV2
  recipe: AvgAudioProcessingRecipeV1; receipt: AvgAudioProcessingReceiptV1
}
export interface AvgProcessedAudioPayloadV2 extends Omit<AvgProcessedAudioPayloadV1, 'version' | 'recipe' | 'receipt'> {
  version: 2
  recipe: AvgAudioProcessingRecipeV2; receipt: AvgAudioProcessingReceiptV2
}
export type AvgProcessedAudioPayload = AvgProcessedAudioPayloadV1 | AvgProcessedAudioPayloadV2
export type AvgAudioProcessingEntryV1 = AvgAudioProductionProcessingPlanV1['entries'][number]
export type AvgAudioProcessingEntry = AvgAudioProductionProcessingPlan['entries'][number]
export type AvgProcessedAudioArtifactFieldsV1 = Pick<ProductBuildArtifactRecordV1,
  'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize'>
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
const asset = (value: unknown) => parseAvgExecutableStageV1({ version: 1, cues: [], assets: [value] }).assets[0]!

/** A strict candidate envelope, never an actual Work/producer, licence,
 * playback observation or author-adoption proof. Original request identity
 * and raw producer remain separate from the local recipe/processing receipt. */
export async function parseAvgProcessedAudioPayloadV1(value: unknown): Promise<AvgProcessedAudioPayloadV1> {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'domain', 'requirementKey',
    'requestIdentityHash', 'raw', 'sourceAsset', 'recipe', 'receipt'], 'processed audio')
  if (r.schema !== 'storyforge.avg.processed-audio' || r.version !== 1) throw new Error('[avg-audio-process] 加工音频工件版本无效')
  const domain = avgEnum(r.domain, ['voice', 'sound'] as const, 'processed audio domain')
  const requirementKey = avgKey(r.requirementKey, 'processed audio requirement')
  const requestIdentityHash = avgHash(r.requestIdentityHash, 'processed original request')
  const ref = avgRecord(r.raw, ['artifactKey', 'version', 'contentHash', 'producerReceiptHash'], 'processed raw audio reference')
  const raw = { artifactKey: avgKey(ref.artifactKey, 'processed original artifact'),
    version: avgNumber(ref.version, 'processed original version', 1, 1e6),
    contentHash: avgHash(ref.contentHash, 'processed original content'),
    producerReceiptHash: avgHash(ref.producerReceiptHash, 'processed original producer receipt') }
  const sourceAsset = asset(r.sourceAsset), recipe = parseAvgAudioProcessingRecipeV1(r.recipe)
  // Parse all caller-owned fields before the first hash await.
  const observation = parseAvgAudioProcessingReceiptV1(r.receipt)
  const receipt = await assertAvgAudioProcessingReceiptV1(recipe, observation)
  if (raw.artifactKey !== 'avg.' + domain + '.raw.' + requirementKey
    || (domain === 'voice') !== (sourceAsset.kind === 'voice')
    || !['voice', 'bgm', 'sfx', 'ambience'].includes(sourceAsset.kind)
    || sourceAsset.kind !== receipt.source.kind || sourceAsset.mimeType !== 'audio/wav'
    || sourceAsset.contentHash !== raw.contentHash || sourceAsset.blobContentHash !== raw.contentHash
    || receipt.source.contentHash !== raw.contentHash || sourceAsset.byteSize !== receipt.source.byteSize
    || sourceAsset.width !== null || sourceAsset.height !== null || sourceAsset.durationMs === null
    || !Number.isSafeInteger(sourceAsset.durationMs)
    || Math.abs(sourceAsset.durationMs - receipt.source.durationMs) > 1 || sourceAsset.version >= 1e6) {
    throw new Error('[avg-audio-process] 加工音频的准确域、原producer引用、WAV字节或时间轴不一致')
  }
  return { schema: 'storyforge.avg.processed-audio', version: 1, domain, requirementKey,
    requestIdentityHash, raw, sourceAsset, recipe, receipt }
}

export function deriveAvgProcessedAudioAssetV1(payload: AvgProcessedAudioPayload): FrozenRuntimeMediaAssetV2 {
  return asset({ ...payload.sourceAsset, version: payload.sourceAsset.version + 1,
    contentHash: payload.receipt.output.contentHash, blobContentHash: payload.receipt.output.contentHash,
    byteSize: payload.receipt.output.byteSize, durationMs: payload.receipt.output.durationMs,
    mimeType: 'audio/wav', source: payload.receipt.processor })
}

/** Preserve the exact original rights record by hash; local gain cannot
 * upgrade an unknown model licence, grant commercial use or sign a review. */
export async function deriveAvgProcessedAudioRightsV1(payload: AvgProcessedAudioPayload, originalRights: unknown) {
  const frozen = { payload: structuredClone(payload), rights: structuredClone(originalRights) }
  const source = frozen.payload
  return { origin: 'local-processing', sourceContentHash: source.raw.contentHash,
    sourceProducerReceiptHash: source.raw.producerReceiptHash,
    sourceRightsHash: await hashProductProductionValueV2(frozen.rights),
    sourceLicense: source.sourceAsset.license, declaration: source.recipe.declaration,
    requiresAuthorReview: true, commercialUse: null }
}

/** Caller must separately prove current/frozen Brief, actual raw producer,
 * original response, owned physical bytes, context/claim and author decisions.
 * This pure comparison cannot admit an artifact or select a producer mode. */
export async function assertAvgProcessedAudioArtifactV1(input: {
  entry: AvgAudioProcessingEntryV1
  source: { raw: AvgProcessedAudioRawReferenceV1; asset: FrozenRuntimeMediaAssetV2;
    requestIdentityHash: string; rights: unknown }
  row: AvgProcessedAudioArtifactFieldsV1
}) {
  const frozen = structuredClone(input)
  const entry = parseAvgAudioProductionProcessingPlanV1({ schema: 'storyforge.avg.audio-production-processing-plan',
    version: 1, entries: [frozen.entry] }).entries[0]!
  const payload = await parseAvgProcessedAudioPayloadV1(frozen.row.payloadJson)
  const expected = deriveAvgProcessedAudioAssetV1(payload)
  const rights = await deriveAvgProcessedAudioRightsV1(payload, frozen.source.rights)
  const row = frozen.row
  if (entry.domain !== payload.domain || entry.requirementKey !== payload.requirementKey
    || !same(entry.recipe, payload.recipe) || !same(frozen.source.raw, payload.raw)
    || !same(frozen.source.asset, payload.sourceAsset)
    || frozen.source.requestIdentityHash !== payload.requestIdentityHash
    || row.artifactKey !== avgProcessedAudioArtifactKeyV1(payload.domain, payload.requirementKey)
    || row.kind !== 'audio' || row.mediaKind !== expected.kind || row.mimeType !== 'audio/wav'
    || row.contentHash !== expected.contentHash || row.byteSize !== expected.byteSize
    || !same(asset(JSON.parse(row.metadataJson)), expected) || !same(JSON.parse(row.rightsJson), rights)) {
    throw new Error('[avg-audio-process] 加工音频与冻结配方、原请求/版本/权利或实际候选元数据不一致')
  }
  return { payload, asset: expected, rights }
}

/** A V2 envelope binds a V2 recipe and receipt explicitly. Merely changing
 * the envelope version cannot upgrade a legacy receipt or its authority. */
export async function parseAvgProcessedAudioPayloadV2(value: unknown): Promise<AvgProcessedAudioPayloadV2> {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'domain', 'requirementKey',
    'requestIdentityHash', 'raw', 'sourceAsset', 'recipe', 'receipt'], 'processed audio V2')
  if (r.schema !== 'storyforge.avg.processed-audio' || r.version !== 2) throw new Error('[avg-audio-process] 后继加工音频工件版本无效')
  const domain = avgEnum(r.domain, ['voice', 'sound'] as const, 'processed audio domain')
  const requirementKey = avgKey(r.requirementKey, 'processed audio requirement')
  const requestIdentityHash = avgHash(r.requestIdentityHash, 'processed original request')
  const ref = avgRecord(r.raw, ['artifactKey', 'version', 'contentHash', 'producerReceiptHash'], 'processed raw audio reference')
  const raw = { artifactKey: avgKey(ref.artifactKey, 'processed original artifact'),
    version: avgNumber(ref.version, 'processed original version', 1, 1e6),
    contentHash: avgHash(ref.contentHash, 'processed original content'),
    producerReceiptHash: avgHash(ref.producerReceiptHash, 'processed original producer receipt') }
  const sourceAsset = asset(r.sourceAsset), recipe = parseAvgAudioProcessingRecipe(r.recipe)
  // Both codecs capture all caller-owned fields before the first hash await.
  const observation = parseAvgAudioProcessingReceipt(r.receipt)
  if (recipe.version !== 2 || observation.version !== 2) throw new Error('[avg-audio-process] V2工件须绑定准确V2配方及处理回执')
  const receipt = await assertAvgAudioProcessingReceipt(recipe, observation)
  if (receipt.version !== 2) throw new Error('[avg-audio-process] V2处理回执不能回退原增益版本')
  if (raw.artifactKey !== 'avg.' + domain + '.raw.' + requirementKey
    || (domain === 'voice') !== (sourceAsset.kind === 'voice')
    || !['voice', 'bgm', 'sfx', 'ambience'].includes(sourceAsset.kind)
    || sourceAsset.kind !== receipt.source.kind || sourceAsset.mimeType !== 'audio/wav'
    || sourceAsset.contentHash !== raw.contentHash || sourceAsset.blobContentHash !== raw.contentHash
    || receipt.source.contentHash !== raw.contentHash || sourceAsset.byteSize !== receipt.source.byteSize
    || sourceAsset.width !== null || sourceAsset.height !== null || sourceAsset.durationMs === null
    || !Number.isSafeInteger(sourceAsset.durationMs)
    || Math.abs(sourceAsset.durationMs - receipt.source.durationMs) > 1 || sourceAsset.version >= 1e6) {
    throw new Error('[avg-audio-process] 后继加工音频的准确域、原producer引用、WAV字节或时间轴不一致')
  }
  return { schema: 'storyforge.avg.processed-audio', version: 2, domain, requirementKey,
    requestIdentityHash, raw, sourceAsset, recipe, receipt }
}

export async function parseAvgProcessedAudioPayload(value: unknown): Promise<AvgProcessedAudioPayload> {
  return (avgProtocolBody(value) as { version?: unknown } | null)?.version === 2
    ? parseAvgProcessedAudioPayloadV2(value) : parseAvgProcessedAudioPayloadV1(value)
}

/** Dispatch by the declared entry recipe, never by caller-supplied rights or
 * source labels. A V1 entry in a mixed plan still requires its V1 payload. */
export async function assertAvgProcessedAudioArtifact(input: Omit<Parameters<typeof assertAvgProcessedAudioArtifactV1>[0], 'entry'> & {
  entry: AvgAudioProcessingEntry
}) {
  const frozen = structuredClone(input), recipe = parseAvgAudioProcessingRecipe(frozen.entry.recipe)
  if (recipe.version === 1) {
    const entry = parseAvgAudioProductionProcessingPlanV1({ schema: 'storyforge.avg.audio-production-processing-plan',
      version: 1, entries: [frozen.entry] }).entries[0]!
    return assertAvgProcessedAudioArtifactV1({ ...frozen, entry })
  }
  const entry = parseAvgAudioProductionProcessingPlan({ schema: 'storyforge.avg.audio-production-processing-plan',
    version: 2, entries: [frozen.entry] }).entries[0]!
  const payload = await parseAvgProcessedAudioPayload(frozen.row.payloadJson)
  if (entry.recipe.version !== 2 || payload.version !== 2) throw new Error('[avg-audio-process] 冻结V2配方与实际工件版本不一致，不能回退原增益工件')
  const expected = deriveAvgProcessedAudioAssetV1(payload)
  const rights = await deriveAvgProcessedAudioRightsV1(payload, frozen.source.rights)
  const row = frozen.row
  if (entry.domain !== payload.domain || entry.requirementKey !== payload.requirementKey
    || !same(entry.recipe, payload.recipe) || !same(frozen.source.raw, payload.raw)
    || !same(frozen.source.asset, payload.sourceAsset)
    || frozen.source.requestIdentityHash !== payload.requestIdentityHash
    || row.artifactKey !== avgProcessedAudioArtifactKeyV1(payload.domain, payload.requirementKey)
    || row.kind !== 'audio' || row.mediaKind !== expected.kind || row.mimeType !== 'audio/wav'
    || row.contentHash !== expected.contentHash || row.byteSize !== expected.byteSize
    || !same(asset(JSON.parse(row.metadataJson)), expected) || !same(JSON.parse(row.rightsJson), rights)) {
    throw new Error('[avg-audio-process] 后继加工音频与冻结配方、原请求/版本/权利或实际候选元数据不一致')
  }
  return { payload, asset: expected, rights }
}
