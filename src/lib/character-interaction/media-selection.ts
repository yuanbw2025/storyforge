import type {FrozenInteractionRuntimeV2, FrozenRuntimeMediaAssetV2} from '../types'
import {canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash} from '../product-production/hash'
import {freezeProductMediaAsset} from '../product-production/media-contracts'
import {createInitialInteractionState} from './runtime'
import {parseChatMediaBindingsV1, parseChatMediaBindingShapeV1, type ChatMediaBindingsV1} from './media-contract'

/** Author inspection input only. This includes private narrative content and
 * must not become an image-provider prompt or a player-readable artifact. */
export interface ChatMediaReviewSourceV1 {
  schema: 'storyforge.chat-media-review-source'
  version: 1
  interaction: FrozenInteractionRuntimeV2
  assets: FrozenRuntimeMediaAssetV2[]
}
export interface ChatMediaSelectionV1 {
  schema: 'storyforge.chat-media-selection'
  version: 1
  sourceHash: string
  bindings: ChatMediaBindingsV1
  authorCommandId: string
}
export interface ChatMediaSelectionRequestV1 {sourceHash: string; bindings: ChatMediaBindingsV1}
export interface ChatMediaProductionDecisionV1 extends ChatMediaSelectionRequestV1 {buildNumber: number; controlEpoch: number}
function fail(message: string): never {throw new Error(`[chat-media-selection] ${message}`)}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('图片确认字段无效')
  return value as Record<string, unknown>
}
function commandId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200) fail('缺少明确的作者确认命令')
}
export function parseChatMediaSelectionRequestV1(value: unknown): ChatMediaSelectionRequestV1 {
  const row = exact(value, ['sourceHash', 'bindings'])
  if (!isSha256Hash(row.sourceHash)) fail('图片选择需要精确的来源 hash')
  return {sourceHash: row.sourceHash, bindings: parseChatMediaBindingShapeV1(row.bindings)}
}
export function parseChatMediaProductionDecisionV1(value: unknown): ChatMediaProductionDecisionV1 {
  const row = exact(value, ['buildNumber', 'controlEpoch', 'sourceHash', 'bindings'])
  if (!Number.isSafeInteger(row.buildNumber) || Number(row.buildNumber) < 1
    || !Number.isSafeInteger(row.controlEpoch) || Number(row.controlEpoch) < 0) fail('图片确认需要当前制作版本与运行轮次')
  return {buildNumber: Number(row.buildNumber), controlEpoch: Number(row.controlEpoch),
    ...parseChatMediaSelectionRequestV1({sourceHash: row.sourceHash, bindings: row.bindings})}
}

/** Build/epoch, artifact acceptance, original bytes and permission are checked
 * by the existing production command boundary; a hash is not authorization. */
export function createChatMediaReviewSourceV1(interaction: FrozenInteractionRuntimeV2, assets: readonly FrozenRuntimeMediaAssetV2[]): ChatMediaReviewSourceV1 {
  createInitialInteractionState(interaction)
  if (!assets.length || assets.length > 256) fail('待确认图片数量无效')
  const catalog = assets.map(asset => {
    const frozen = {...freezeProductMediaAsset(asset), blobContentHash: asset.blobContentHash}
    if (!isSha256Hash(asset.blobContentHash) || asset.contentHash !== asset.blobContentHash
      || canonicalProductProductionJsonV2(asset) !== canonicalProductProductionJsonV2(frozen)) fail('图片目录与原始字节标识不一致')
    if (!['character-pose', 'character-expression', 'background'].includes(asset.kind)
      || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(asset.mimeType)
      || !asset.source || !asset.license || !asset.altText
      || !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width! < 1 || asset.height! < 1
      || asset.byteSize < 1 || asset.durationMs !== null) fail('待确认图片缺少有效类型、尺寸、说明或许可')
    return frozen
  }).sort((a, b) => a.assetKey < b.assetKey ? -1 : a.assetKey > b.assetKey ? 1 : 0)
  if (new Set(catalog.map(a => a.assetKey)).size !== catalog.length) fail('待确认图片标识重复')
  // A replacement confirmation binds the current content/catalog rather than
  // recursively binding a previous presentation decision.
  const {chatMedia: _previousBinding, ...content} = interaction
  return structuredClone({schema: 'storyforge.chat-media-review-source', version: 1, interaction: content, assets: catalog})
}

/** Call only after an explicit author command. Merely reading the source or
 * rendering previews cannot produce this selection. No DB writes occur here. */
export async function confirmChatMediaSelectionV1(input: {
  source: ChatMediaReviewSourceV1; submitted: {sourceHash: string; bindings: unknown}; authorCommandId: string
}): Promise<ChatMediaSelectionV1> {
  commandId(input.authorCommandId)
  const submitted = parseChatMediaSelectionRequestV1(input.submitted), authorCommandId = input.authorCommandId
  const source = parseChatMediaReviewSourceV1(input.source)
  if (!isSha256Hash(submitted.sourceHash) || await hashProductProductionValueV2(source) !== submitted.sourceHash) fail('人物、场景、图片或许可已变化，请重新查看并确认')
  return {schema: 'storyforge.chat-media-selection', version: 1, sourceHash: submitted.sourceHash,
    bindings: parseChatMediaBindingsV1(submitted.bindings, source.interaction, source.assets), authorCommandId}
}
export function parseChatMediaReviewSourceV1(value: unknown): ChatMediaReviewSourceV1 {
  const row = exact(value, ['schema', 'version', 'interaction', 'assets'])
  if (row.schema !== 'storyforge.chat-media-review-source' || row.version !== 1 || !Array.isArray(row.assets)) fail('图片审查来源无效')
  const source = createChatMediaReviewSourceV1(row.interaction as FrozenInteractionRuntimeV2, row.assets as FrozenRuntimeMediaAssetV2[])
  if (canonicalProductProductionJsonV2(source) !== canonicalProductProductionJsonV2(value)) fail('图片审查来源不是冻结的标准目录')
  return source
}

/** Assembly must supply the exact original request from its verified durable
 * command evidence, not from this candidate. An ID alone cannot bind choices. */
export async function readConfirmedChatMediaV1(value: unknown, source: ChatMediaReviewSourceV1, expectedAuthorCommand: {
  commandId: string; submitted: ChatMediaSelectionRequestV1
}): Promise<ChatMediaBindingsV1> {
  const row = exact(value, ['schema', 'version', 'sourceHash', 'bindings', 'authorCommandId'])
  exact(expectedAuthorCommand, ['commandId', 'submitted']); commandId(expectedAuthorCommand.commandId)
  const submitted = parseChatMediaSelectionRequestV1({sourceHash: row.sourceHash, bindings: row.bindings})
  if (row.schema !== 'storyforge.chat-media-selection' || row.version !== 1 || row.authorCommandId !== expectedAuthorCommand.commandId
    || canonicalProductProductionJsonV2(submitted) !== canonicalProductProductionJsonV2(parseChatMediaSelectionRequestV1(expectedAuthorCommand.submitted))) fail('图片确认与作者命令不一致')
  const confirmed = await confirmChatMediaSelectionV1({source, submitted, authorCommandId: expectedAuthorCommand.commandId})
  return structuredClone(confirmed.bindings)
}
