import Dexie from 'dexie'
import {db} from '../db/schema'
import type {ProductBuildRecordV1, ProductProductionCommandV1, WorkspaceScope} from '../types'
import {assertRecordInScope} from '../workspace/scope'
import {canonicalProductProductionJsonV2, hashProductProductionValueV2} from './hash'
import {parseProductProductionCommandV1} from './contracts'
import {parseProductProductionPlanV3} from './plan'
import {readVerifiedMediaBlobObjectData} from './media-blob-store'
import {confirmChatMediaSelectionV1, parseChatMediaReviewSourceV1, readConfirmedChatMediaV1,
  type ChatMediaReviewSourceV1, type ChatMediaSelectionV1} from '../character-interaction/media-selection'

export const CHAT_MEDIA_REVIEW_ARTIFACT = 'media.chat-review'
export const CHAT_MEDIA_AUTHOR_GATE = 'media.chat-author-gate'
export const CHAT_MEDIA_SELECTION_ARTIFACT = 'media.chat-selection'
type Command = Extract<ProductProductionCommandV1, {type: 'resolve-blocker'}>
function fail(message: string): never {throw new Error(`[chat-media-authority] ${message}`)}

/** Read exactly the current Build's accepted review and original bytes. This
 * does not borrow Release assets, write an approval, or invoke a provider. */
export async function readCurrentChatMediaReviewV1(input: {scope: WorkspaceScope; build: ProductBuildRecordV1}) {
  const {scope, build} = structuredClone(input)
  if (!build.id || !await assertRecordInScope(scope, 'productBuilds', build, {owner: 'work'})) fail('图片确认版本不存在或跨作品')
  const production = await db.productProductions.get(build.productionId)
  if (!production || production.productType !== 'character-interaction'
    || !await assertRecordInScope(scope, 'productProductions', production, {owner: 'work'})
    || production.currentBuildNumber !== build.buildNumber || production.controlEpoch !== build.controlEpoch) fail('图片确认不属于当前角色聊天制作')
  const plan = parseProductProductionPlanV3(build.planJson)
  if (plan.productType !== 'character-interaction' || await hashProductProductionValueV2(plan) !== build.planHash || plan.buildNumber !== build.buildNumber
    || plan.controlEpoch !== build.controlEpoch || plan.briefHash !== build.briefHash) fail('图片确认计划与当前制作版本不一致')
  const gate = plan.tasks.find(task => task.taskKey === CHAT_MEDIA_AUTHOR_GATE)
  if (!gate || gate.executionMode !== 'deterministic' || !gate.inputArtifactKeys.includes(CHAT_MEDIA_REVIEW_ARTIFACT)
    || !gate.outputArtifactKeys.includes(CHAT_MEDIA_SELECTION_ARTIFACT)) fail('当前计划没有角色聊天图片确认步骤')
  const readRows = async () => (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.controlEpoch === build.controlEpoch && ['accepted', 'carried-forward'].includes(row.status))
  const rows = await readRows(), reviews = rows.filter(row => row.artifactKey === CHAT_MEDIA_REVIEW_ARTIFACT)
  if (reviews.length !== 1 || reviews[0].blobObjectId != null
    || !await assertRecordInScope(scope, 'productBuildArtifacts', reviews[0], {owner: 'work'})) fail('缺少唯一的当前图片审查来源')
  const source = parseChatMediaReviewSourceV1(JSON.parse(reviews[0].payloadJson))
  const sourceHash = await hashProductProductionValueV2(source)
  if (sourceHash !== reviews[0].contentHash) fail('图片审查来源内容已变化')
  if (rows.filter(row => row.blobObjectId != null).length !== source.assets.length) fail('当前图片目录尚未完整进入审查')
  if (source.assets.reduce((total, asset) => total + asset.byteSize, 0) > 32 * 1024 * 1024) fail('待确认图片超过 32 MiB，请缩小素材后重试')
  const images = []
  for (const asset of source.assets) {
    const matches = rows.filter(row => row.blobObjectId != null && JSON.parse(row.metadataJson).assetKey === asset.assetKey)
    if (matches.length !== 1) fail('待确认图片缺失或不唯一')
    const row = matches[0], metadata = JSON.parse(row.metadataJson), payload = JSON.parse(row.payloadJson)
    if (!await assertRecordInScope(scope, 'productBuildArtifacts', row, {owner: 'work'})
      || row.contentHash !== asset.contentHash || row.mimeType !== asset.mimeType || row.mediaKind !== asset.kind || row.byteSize !== asset.byteSize
      || payload.schema !== 'storyforge.generated-media-artifact' || payload.version !== 1
      || ['name', 'width', 'height', 'durationMs', 'source', 'license', 'altText', 'characterTag', 'sceneTag']
        .some(key => metadata[key] !== asset[key as keyof typeof asset])) fail('当前图片与待确认目录不一致')
    const blob = await db.mediaBlobObjects.get(row.blobObjectId!)
    if (!blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, {owner: 'work'})
      || blob.contentHash !== asset.blobContentHash || blob.mimeType !== asset.mimeType || blob.byteSize !== asset.byteSize) fail('当前图片原始字节缺失或跨作品')
    // Hold the command transaction only around external byte I/O. The byte
    // verifier's own digest must run outside the transaction to avoid nesting
    // waitFor promises that wait on one another.
    const bytes = Dexie.currentTransaction
      ? await Dexie.waitFor(Dexie.ignoreTransaction(() => readVerifiedMediaBlobObjectData(blob)))
      : await readVerifiedMediaBlobObjectData(blob)
    images.push({asset, artifactKey: row.artifactKey, bytes})
  }
  if (canonicalProductProductionJsonV2(await db.productBuilds.get(build.id)) !== canonicalProductProductionJsonV2(build)
    || canonicalProductProductionJsonV2(await db.productProductions.get(production.id!)) !== canonicalProductProductionJsonV2(production)
    || canonicalProductProductionJsonV2(await readRows()) !== canonicalProductProductionJsonV2(rows)) fail('读取图片时制作版本已变化，请重新查看')
  return {source, sourceHash, images}
}

/** Reconstruct the exact request and compare it to the durable command hash.
 * A candidate's command ID or copied boolean never proves author approval. */
async function verifyCommand(input: {scope: WorkspaceScope; productionId: number; buildNumber: number; controlEpoch: number; command: unknown}) {
  const command = parseProductProductionCommandV1(input.command)
  if (command.type !== 'resolve-blocker' || command.blockerKey !== CHAT_MEDIA_AUTHOR_GATE
    || command.resolution.action !== 'confirm-chat-media' || !command.resolution.chatMedia
    || command.resolution.chatMedia.buildNumber !== input.buildNumber
    || command.resolution.chatMedia.controlEpoch >= input.controlEpoch) fail('图片确认命令与当前制作版本不一致')
  const rows = await db.productProductionCommands.where('[productionId+commandId]').equals([input.productionId, command.commandId]).toArray()
  if (rows.length !== 1) fail('图片确认命令不存在或不唯一')
  const row = rows[0], result = JSON.parse(row.resultJson)
  if (!await assertRecordInScope(input.scope, 'productProductionCommands', row, {owner: 'work'})
    || row.status !== 'succeeded' || row.type !== command.type || row.errorCode !== null || row.completedAt == null
    || row.expectedStateRevision !== command.expectedStateRevision || row.payloadHash !== await hashProductProductionValueV2(command)
    || result.buildNumber !== input.buildNumber || result.blockerKey !== CHAT_MEDIA_AUTHOR_GATE || result.action !== 'confirm-chat-media'
    || result.controlEpoch !== command.resolution.chatMedia.controlEpoch + 1) fail('图片确认没有匹配的成功作者命令回执')
  return command
}

export interface ChatMediaAuthorConfirmationV1 {
  schema: 'storyforge.chat-media-author-confirmation'; version: 1
  selection: ChatMediaSelectionV1; command: Command
}
export async function createChatMediaAuthorConfirmationV1(input: {
  scope: WorkspaceScope; productionId: number; buildNumber: number; controlEpoch: number
  source: ChatMediaReviewSourceV1; command: Command
}): Promise<ChatMediaAuthorConfirmationV1> {
  const source = parseChatMediaReviewSourceV1(input.source)
  const command = await verifyCommand(input)
  const decision = command.resolution.chatMedia!
  const selection = await confirmChatMediaSelectionV1({source,
    submitted: {sourceHash: decision.sourceHash, bindings: decision.bindings}, authorCommandId: command.commandId})
  return {schema: 'storyforge.chat-media-author-confirmation', version: 1, selection, command}
}
export async function readChatMediaAuthorConfirmationV1(input: {
  scope: WorkspaceScope; productionId: number; buildNumber: number; controlEpoch: number
  source: ChatMediaReviewSourceV1; value: unknown
}) {
  const source = parseChatMediaReviewSourceV1(input.source), value = structuredClone(input.value) as ChatMediaAuthorConfirmationV1
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'command,schema,selection,version'
    || value.schema !== 'storyforge.chat-media-author-confirmation' || value.version !== 1) fail('图片作者确认工件无效')
  const command = await verifyCommand({...input, command: value.command})
  const decision = command.resolution.chatMedia!
  return readConfirmedChatMediaV1(value.selection, source, {commandId: command.commandId,
    submitted: {sourceHash: decision.sourceHash, bindings: decision.bindings}})
}
