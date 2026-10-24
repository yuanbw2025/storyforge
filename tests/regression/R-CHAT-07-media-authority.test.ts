import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import type {ProductProductionCommandV1, ProductProductionPlanTaskV3, ProductProductionPlanV3} from '../../src/lib/types'
import {createChatMediaReviewSourceV1} from '../../src/lib/character-interaction/media-selection'
import {canonicalProductProductionJsonV2, hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {parseProductProductionCommandV1} from '../../src/lib/product-production/contracts'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {readCurrentChatMediaReviewV1, createChatMediaAuthorConfirmationV1, readChatMediaAuthorConfirmationV1,
  CHAT_MEDIA_REVIEW_ARTIFACT, CHAT_MEDIA_AUTHOR_GATE, CHAT_MEDIA_SELECTION_ARTIFACT} from '../../src/lib/product-production/chat-media-authority'
import {seedChatMediaBuildFixture} from '../helpers/chat-media-fixture'
import {draftProductProductionBriefV3, suggestProductStartingPoints} from '../../src/lib/product-production/consultation'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
// A minimal deterministic acceptance graph exercises the command boundary.
// It is not a generated artwork Build or an end-to-end production receipt.
function task(taskKey: string, outputs: string[], dependsOn: string[] = [], inputs: string[] = []): ProductProductionPlanTaskV3 {
  return {taskKey, lane: 'integration', kind: 'chat-media-test', skillId: null, executionMode: 'deterministic', dependsOn,
    requiredReceipts: dependsOn.map(taskKey => ({taskKey, receiptHash: null})), inputArtifactKeys: inputs, outputArtifactKeys: outputs,
    requirementKeys: [], capabilityRequirementKeys: [], concurrencyGroup: 'deterministic', subjectLockKeys: outputs, priority: 1,
    budgetReservation: {modelCalls: 0, mediaCalls: 0, inputTokens: 0, outputTokens: 0, maximumCostUsd: 0, durationMs: 1000, storageBytes: 0},
    maxAttempts: 1, timeoutMs: 1000, failurePolicy: 'pause', fallbackTaskKey: null, acceptanceGateIds: ['artifact.protocol'], reuse: null}
}
async function fixture() {
  const f = await seedChatMediaBuildFixture()
  const briefRow = (await db.productProductionBriefs.where('productionId').equals(f.productionId).first())!
  const starting = await suggestProductStartingPoints({scope: f.scope, worldReleaseId: briefRow.sourceWorldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope: f.scope, worldReleaseId: briefRow.sourceWorldReleaseId!,
    suggestionKey: starting.suggestions[0].suggestionKey, productType: 'character-interaction', playerRole: '工程玩家', openingSituation: '工程开场', visualLevel: 'none', audioLevel: 'none'})
  const briefHash = await hashProductProductionValueV2(brief)
  await db.productProductionBriefs.update(briefRow.id!, {briefJson: canonicalProductProductionJsonV2(brief), briefHash})
  const assets = f.runtimePackage.presentation!.assets
  const source = createChatMediaReviewSourceV1(f.runtimePackage.interaction!, assets), sourceHash = await hashProductProductionValueV2(source)
  const imageKeys = assets.map(asset => asset.assetKey)
  const plan: ProductProductionPlanV3 = {schema: 'storyforge.product-production-plan', version: 3, productType: 'character-interaction',
    buildNumber: 1, controlEpoch: 0, briefHash,
    concurrency: {maximumCostBearingTasks: 1, maximumTextProviderTasks: 1, maximumMediaProviderTasks: 1},
    tasks: [task('images', imageKeys), task(CHAT_MEDIA_REVIEW_ARTIFACT, [CHAT_MEDIA_REVIEW_ARTIFACT], ['images'], imageKeys),
      task(CHAT_MEDIA_AUTHOR_GATE, [CHAT_MEDIA_SELECTION_ARTIFACT], [CHAT_MEDIA_REVIEW_ARTIFACT], [CHAT_MEDIA_REVIEW_ARTIFACT])], terminalTaskKey: CHAT_MEDIA_AUTHOR_GATE}
  const rows = await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray()
  for (const asset of assets) {
    const row = rows.find(row => row.artifactKey === asset.assetKey)!
    await db.productBuildArtifacts.update(row.id!, {metadataJson: JSON.stringify(asset), payloadJson: JSON.stringify({schema: 'storyforge.generated-media-artifact', version: 1})})
  }
  const exemplar = rows.find(row => row.blobObjectId != null)!, {id: _id, ...fields} = exemplar
  await db.productBuildArtifacts.add({...fields, artifactKey: CHAT_MEDIA_REVIEW_ARTIFACT, kind: 'asset-manifest', mediaKind: null,
    contentHash: sourceHash, payloadJson: canonicalProductProductionJsonV2(source), metadataJson: '{}', blobObjectId: null, mimeType: null, byteSize: 0})
  await db.productBuilds.update(f.buildId, {briefHash, status: 'recovery-required', planJson: canonicalProductProductionJsonV2(plan), planHash: await hashProductProductionValueV2(plan),
    failureJson: JSON.stringify({taskKey: CHAT_MEDIA_AUTHOR_GATE, code: 'executor-failed', detail: 'await explicit author choice'})})
  const command: Extract<ProductProductionCommandV1, {type: 'resolve-blocker'}> = {type: 'resolve-blocker', commandId: 'author.chat.media.1', expectedStateRevision: 2,
    blockerKey: CHAT_MEDIA_AUTHOR_GATE, resolution: {action: 'confirm-chat-media', note: '作者明确确认当前工程图片和用途',
      chatMedia: {buildNumber: 1, controlEpoch: 0, sourceHash, bindings: f.runtimePackage.interaction!.chatMedia!}}}
  return {...f, source, sourceHash, command, build: (await db.productBuilds.get(f.buildId))!}
}

it('requires an exact current review and actual bytes, then verifies the full successful command and idempotent replay', async () => {
  const f = await fixture()
  const review = await readCurrentChatMediaReviewV1(f)
  expect(review.source).toEqual(f.source); expect(review.images).toHaveLength(3)
  expect(await db.productProductionCommands.count()).toBe(0)
  const result = await executeProductProductionCommand({scope: f.scope, productionId: f.productionId, command: f.command})
  expect(result.ok).toBe(true)
  const authority = {scope: f.scope, productionId: f.productionId, buildNumber: 1, controlEpoch: 1, source: f.source}
  const confirmed = await createChatMediaAuthorConfirmationV1({...authority, command: f.command})
  expect(await readChatMediaAuthorConfirmationV1({...authority, value: confirmed})).toEqual(f.command.resolution.chatMedia!.bindings)
  expect((await executeProductProductionCommand({scope: f.scope, productionId: f.productionId, command: f.command})).replayed).toBe(true)
  expect(await db.productProductionCommands.count()).toBe(1)
})

it('does not approve altered bindings or note text with the same command ID, or a non-successful durable receipt', async () => {
  const f = await fixture()
  await executeProductProductionCommand({scope: f.scope, productionId: f.productionId, command: f.command})
  const input = {scope: f.scope, productionId: f.productionId, buildNumber: 1, controlEpoch: 1, source: f.source}
  const confirmed = await createChatMediaAuthorConfirmationV1({...input, command: f.command})
  const changedNote = structuredClone(confirmed); changedNote.command.resolution.note += 'changed'
  await expect(readChatMediaAuthorConfirmationV1({...input, value: changedNote})).rejects.toThrow('成功作者命令')
  const changed = structuredClone(confirmed)
  changed.command.resolution.chatMedia!.bindings.participants[0].avatarAssetKey = null
  changed.selection.bindings.participants[0].avatarAssetKey = null
  await expect(readChatMediaAuthorConfirmationV1({...input, value: changed})).rejects.toThrow('成功作者命令')
  const row = (await db.productProductionCommands.toArray())[0]
  await db.productProductionCommands.update(row.id!, {status: 'failed'})
  await expect(readChatMediaAuthorConfirmationV1({...input, value: confirmed})).rejects.toThrow('成功作者命令')
  await expect(readChatMediaAuthorConfirmationV1({...input, buildNumber: 2, value: confirmed})).rejects.toThrow('当前制作版本')
})

it('rejects stale Build/epoch, mismatched catalog and missing Build bytes without borrowing the Release', async () => {
  const f = await fixture(), before = (await db.productProductions.get(f.productionId))!
  for (const field of ['buildNumber', 'controlEpoch'] as const) {
    const command = structuredClone(f.command); command.commandId += field; command.resolution.chatMedia![field]++
    expect((await executeProductProductionCommand({scope: f.scope, productionId: f.productionId, command})).ok).toBe(false)
  }
  const image = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray()).find(row => row.blobObjectId != null)!
  const metadata = JSON.parse(image.metadataJson)
  await db.productBuildArtifacts.update(image.id!, {metadataJson: JSON.stringify({...metadata, license: 'changed'})})
  await expect(readCurrentChatMediaReviewV1(f)).rejects.toThrow('待确认目录')
  await db.productBuildArtifacts.update(image.id!, {metadataJson: image.metadataJson})
  await db.productBuildArtifacts.delete(image.id!)
  await expect(readCurrentChatMediaReviewV1(f)).rejects.toThrow('当前图片目录')
  expect(await db.productMediaAssets.where('productReleaseId').equals(f.releaseId).count()).toBe(3)
  expect((await executeProductProductionCommand({scope: f.scope, productionId: f.productionId, command: f.command})).ok).toBe(false)
  expect(await db.productProductions.get(f.productionId)).toEqual(before)
})

it('rejects corrupt original bytes and invalid command shapes before accepting an author decision', async () => {
  const f = await fixture(), row = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray()).find(row => row.blobObjectId != null)!
  const blob = (await db.mediaBlobObjects.get(row.blobObjectId!))!, data = blob.data!.slice(0)
  new Uint8Array(data)[0] ^= 255
  await db.mediaBlobObjects.update(blob.id!, {data})
  await expect(readCurrentChatMediaReviewV1(f)).rejects.toThrow('哈希')
  expect((await executeProductProductionCommand({scope: f.scope, productionId: f.productionId, command: f.command})).ok).toBe(false)
  expect(() => parseProductProductionCommandV1({...f.command, resolution: {...f.command.resolution, chatMedia: {...f.command.resolution.chatMedia, controlEpoch: -1}}})).toThrow()
  expect(() => parseProductProductionCommandV1({...f.command, resolution: {...f.command.resolution, unknownResultReservation: {}}})).toThrow('未知费用')
})

it('holds the author transaction during asynchronous OPFS byte verification without nested transaction waits', async () => {
  const f = await fixture(), row = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray()).find(row => row.blobObjectId != null)!
  const blob = (await db.mediaBlobObjects.get(row.blobObjectId!))!, bytes = blob.data!.slice(0)
  await db.mediaBlobObjects.update(blob.id!, {backend: 'opfs', data: null, opfsPath: 'storyforge/media/v1/engineering.png'})
  const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
  let reads = 0
  const directory: Pick<FileSystemDirectoryHandle, 'getDirectoryHandle' | 'getFileHandle'> = {
    async getDirectoryHandle() {return directory as FileSystemDirectoryHandle},
    async getFileHandle() {return {getFile: async () => ({arrayBuffer: async () => {
      reads++; await new Promise(resolve => setTimeout(resolve, 10)); return bytes.slice(0)
    }} as File)} as FileSystemFileHandle},
  }
  Object.defineProperty(navigator, 'storage', {configurable: true, value: {getDirectory: async () => directory}})
  try {
    const receipt = await executeProductProductionCommand({scope: f.scope, productionId: f.productionId, command: f.command})
    expect(receipt.ok).toBe(true); expect(reads).toBeGreaterThan(0)
    expect((await db.productBuilds.get(f.buildId))!.controlEpoch).toBe(1)
  } finally {
    if (original) Object.defineProperty(navigator, 'storage', original)
    else delete (navigator as {storage?: unknown}).storage
  }
})

it('retains the exact command authority across project transfer and rejects a different Work', async () => {
  const f = await fixture()
  expect((await executeProductProductionCommand({scope: f.scope, productionId: f.productionId, command: f.command})).ok).toBe(true)
  const authority = {scope: f.scope, productionId: f.productionId, buildNumber: 1, controlEpoch: 1, source: f.source}
  const confirmation = await createChatMediaAuthorConfirmationV1({...authority, command: f.command})
  const oldProduction = (await db.productProductions.get(f.productionId))!
  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const production = (await db.productProductions.where('projectId').equals(importedId).filter(row => row.productionKey === oldProduction.productionKey).first())!
  const scope = {projectId: importedId, worldId: production.worldId, workId: production.workId}
  expect(await readChatMediaAuthorConfirmationV1({...authority, scope, productionId: production.id!, value: confirmation})).toEqual(confirmation.selection.bindings)
  await expect(readChatMediaAuthorConfirmationV1({...authority, scope, value: confirmation})).rejects.toThrow('成功作者命令')
})
