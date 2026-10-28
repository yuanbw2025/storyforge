import Dexie from 'dexie'
import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductBuildRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { verifyHistoricalAvgAudioProcessingProducerV1 } from '../product-production/artifact-store'
import { readAvgConfirmedSoundChoicesV1, readAvgConfirmedSoundPlanV1 } from './author-artifacts'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorStageV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { parseAvgGeneratedSoundSourceV1 } from './stage-sound-source-contract'
import { parseAvgGeneratedSoundSource, parseAvgGeneratedSoundSourceV2, type AvgGeneratedSoundSource } from './stage-processed-sound-source-contract'
import type { AvgRawSoundPayloadV1 } from './sound-review'
import type { AvgSceneScriptV1 } from './artifact-contract'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
type Choice = Awaited<ReturnType<typeof readAvgConfirmedSoundChoicesV1>>[number]
type Input = { scope: WorkspaceScope; productionKey: string; targetBuildNumber: number; worldContentHash: string }
/** Original and derivative locators share the original author/request chain.
 * Derivatives additionally retain a real completed local producer proof. */
async function sourceOf(scope: WorkspaceScope, build: ProductBuildRecordV1, productionKey: string, choice: Choice): Promise<AvgGeneratedSoundSource> {
  const base = {
    schema: 'storyforge.avg.generated-sound-source', version: 1, productionKey, buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch, briefHash: build.briefHash, planHash: build.planHash,
    requirementKey: choice.payload.requirementKey, requestIdentityHash: choice.payload.requestIdentityHash,
    raw: { artifactKey: choice.raw.artifactKey, version: choice.raw.version, contentHash: choice.raw.contentHash,
      producerReceiptHash: choice.raw.producerReceiptHash, responseEvidenceHash: choice.validation.responseEvidenceHash,
      requestSnapshotHash: choice.validation.requestSnapshotHash, rightsHash: choice.validation.rightsHash },
    compiled: choice.validation.compiled, review: { ...choice.review.artifact, authorReceiptHash: choice.review.authorReceiptHash },
    choice: { ...choice.artifact, authorReceiptHash: choice.authorReceiptHash } }
  if (choice.payload.version === 1) {
    if (choice.processed || choice.validation.version !== 1) throw new Error('[avg-sound-process] 原声音来源不能夹带加工证明')
    return parseAvgGeneratedSoundSourceV1(base)
  }
  if (!build.id || !choice.processed || choice.validation.version !== 2) throw new Error('[avg-sound-process] 加工声音沿用缺少准确加工producer及采用证明')
  const processed = choice.processed, validation = choice.validation
  const proof = await verifyHistoricalAvgAudioProcessingProducerV1({ scope, buildId: build.id,
    expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash,
    sourceControlEpoch: build.controlEpoch, artifactKey: processed.artifactKey, version: processed.version, contentHash: processed.contentHash })
  if (!same(proof.artifact, processed)
    || !same(validation.processed, { artifactKey: processed.artifactKey, version: processed.version, contentHash: processed.contentHash })
    || proof.provenance.producerReceiptHash !== validation.processedProducerReceiptHash
    || validation.processingReceiptHash !== choice.payload.processed.receiptHash
    || validation.recipeHash !== choice.payload.processed.recipeHash || validation.sourceRightsHash !== validation.rightsHash) {
    throw new Error('[avg-sound-process] 加工声音沿用的原权利、加工producer或选择版本已变化')
  }
  return parseAvgGeneratedSoundSourceV2({ ...base, version: 2, processing: proof.provenance })
}

async function readOriginal(input: { scope: WorkspaceScope; source: AvgGeneratedSoundSource }) {
  const source = parseAvgGeneratedSoundSource(input.source)
  const productions = await db.productProductions.where('workId').equals(input.scope.workId)
    .filter(row => row.productType === 'avg' && row.productionKey === source.productionKey).limit(2).toArray()
  const production = productions[0]
  if (productions.length !== 1 || !production?.id || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) throw new Error('[avg-sound] 原声音制作来源不存在、重复或跨作品')
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, source.buildNumber]).first()
  if (!build?.id || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || build.controlEpoch !== source.controlEpoch || build.briefHash !== source.briefHash || build.planHash !== source.planHash) throw new Error('[avg-sound] 原声音准确版本已变化')
  // The frozen reader proves actual producer/response/bytes, original review,
  // author commands and fixed Plan, including after supersession or remap.
  const choices = await readAvgConfirmedSoundChoicesV1({ scope: input.scope, buildId: build.id,
    expectedBuildRevision: build.stateRevision, controlEpoch: source.controlEpoch }, true)
  const choice = choices.find(c => c.payload.requirementKey === source.requirementKey)
  if (!choice || !same(await sourceOf(input.scope, build, production.productionKey, choice), source)
    || !same(build, await db.productBuilds.get(build.id))) throw new Error('[avg-sound] 原声音producer、权利、审听或作者选用证明已变化')
  return { choice, worldContentHash: choice.sourceWorldContentHash, build, production }
}

/** Exact adopted original and selected audio, including portable remapping.
 * This read grants no new request, processing, adoption or consumer binding;
 * a successor must separately prove its current Preview and stage consumer. */
export async function readAvgAdoptedGeneratedSoundV1(input: { scope: WorkspaceScope; source: AvgGeneratedSoundSource }) {
  const captured = { scope: structuredClone(input.scope), source: structuredClone(input.source) }
  const scope = await resolveScope({ scope: captured.scope })
  const source = parseAvgGeneratedSoundSource(captured.source)
  const { choice, worldContentHash, build, production } = await readOriginal({ scope, source })
  const stored = await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!stored?.id || !await assertRecordInScope(scope, 'productProductionBriefs', stored, { owner: 'work' })
    || stored.briefHash !== source.briefHash || stored.authorizedAt !== build.authorizedAt
    || !['authorized', 'superseded'].includes(stored.status)) throw new Error('[avg-sound] 已采用声音缺少准确原冻结Brief')
  const brief = parseProductProductionBriefV3(stored.briefJson)
  if (await hashProductProductionValueV2(brief) !== source.briefHash) throw new Error('[avg-sound] 已采用声音的原冻结Brief已变化')
  const soundPlan: Awaited<ReturnType<typeof readAvgConfirmedSoundPlanV1>> = brief.avgSoundPlanning?.version === 2
    ? (await readAvgAdoptedGeneratedSoundV1({ scope, source: brief.avgSoundPlanning.repair.source })).soundPlan
    : await readAvgConfirmedSoundPlanV1({ scope, buildId: build.id!,
      expectedBuildRevision: build.stateRevision, controlEpoch: source.controlEpoch }, true)
  const rawPayload = JSON.parse(choice.raw.payloadJson) as AvgRawSoundPayloadV1
  const originalAsset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [JSON.parse(choice.raw.metadataJson)] }).assets[0]!
  const originalBlobObjectId = choice.raw.blobObjectId
  if (originalBlobObjectId === null) throw new Error('[avg-sound] 已采用声音缺少准确原件Blob')
  const readData = async (blobObjectId: number, asset: FrozenRuntimeMediaAssetV2) => {
    const blob = await db.mediaBlobObjects.get(blobObjectId)
    if (!blob?.id || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
      || blob.contentHash !== asset.contentHash || blob.mimeType !== asset.mimeType || blob.byteSize !== asset.byteSize) {
      throw new Error('[avg-sound] 已采用声音缺少同作品的准确原件或所选Blob')
    }
    const read = () => readVerifiedMediaBlobObjectData(blob)
    return Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(read), 20_000) : read()
  }
  const asset = choice.payload.asset, originalData = await readData(originalBlobObjectId, originalAsset)
  const data = choice.blobObjectId === originalBlobObjectId && same(asset, originalAsset)
    ? originalData : await readData(choice.blobObjectId, asset)
  if (!same(await db.productBuilds.get(build.id!), build) || !same(await db.productProductionBriefs.get(stored.id), stored)
    || !same(await db.productProductions.get(production.id!), production)) throw new Error('[avg-sound] 已采用声音读取期间原版本或冻结授权已变化')
  return { source, production, build, brief, soundPlan, choice, compiled: choice.compiled, raw: choice.raw, processed: choice.processed ?? null,
    rawPayload, asset, originalAsset, blobObjectId: choice.blobObjectId, originalBlobObjectId, data, originalData,
    sourceWorldContentHash: worldContentHash }
}

/** Reuse the original approved consumer. Changing a cue/channel/scene is a
 * new listening decision, never implied by an unrelated dialogue/rule edit. */
export function assertAvgInheritedSoundBindingV1(input: { asset: FrozenRuntimeMediaAssetV2; raw: AvgRawSoundPayloadV1;
  payload: AvgAuthorStageV1; scripts: AvgSceneScriptV1[] }) {
  const t = input.raw.requirement.template
  const expected = parseAvgExecutableStageV1({ version: 1, assets: [input.asset], cues: [{ ...t.cue,
    type: 'play-audio', assetKey: t.assetKey, durationMs: 0, easing: 'linear' }] }).cues[0]!
  const cues = input.payload.stage.cues.filter(c => c.assetKey === input.asset.assetKey)
  const lines = input.scripts.filter(s => s.sceneKey === t.consumer.sceneKey).flatMap(s => s.lines).filter(l => l.lineKey === t.cue.beatKey)
  if (input.asset.assetKey !== t.assetKey || input.asset.kind !== t.channel || lines.length !== 1
    || cues.length !== 1 || !same(cues[0], expected)
    || input.payload.stage.cues.some(c => c.cueKey !== expected.cueKey && c.type === 'play-audio' && c.beatKey === expected.beatKey
      && c.phase === expected.phase && input.payload.stage.assets.find(a => a.assetKey === c.assetKey)?.kind === t.channel)) {
    throw new Error('[avg-sound] 沿用声音的原场景、触发位置、通道、音量或循环已变化，请明确重新审听或移除旧绑定')
  }
}

export async function readAvgInheritedStageSoundsV1(input: Input & { payload: AvgAuthorStageV1; scripts: AvgSceneScriptV1[] }) {
  const sounds = new Map<string, { asset: FrozenRuntimeMediaAssetV2; blobObjectId: number }>()
  for (const entry of input.payload.inheritedSounds ?? []) {
    const { choice, worldContentHash } = await readOriginal({ scope: input.scope, source: entry.source })
    const asset = input.payload.stage.assets.find(a => a.assetKey === entry.assetKey)
    if (!asset || !same(asset, choice.payload.asset) || worldContentHash !== input.worldContentHash
      || entry.source.productionKey === input.productionKey && entry.source.buildNumber >= input.targetBuildNumber) throw new Error('[avg-sound] 沿用声音不是准确旧版本、原字节或冻结世界')
    assertAvgInheritedSoundBindingV1({ asset, raw: JSON.parse(choice.raw.payloadJson) as AvgRawSoundPayloadV1, payload: input.payload, scripts: input.scripts })
    sounds.set(entry.assetKey, { asset, blobObjectId: choice.blobObjectId })
  }
  return sounds
}

/** Only proposes portable sources in the editable draft; never copies old
 * choice authority into the new Plan or issues another provider request. */
export async function prepareAvgInheritedSoundDraftV1(input: Input & { workspace: AvgAuthorWorkspaceV1; build: ProductBuildRecordV1 }) {
  const next = parseAvgAuthorWorkspaceV1(input.workspace)
  if (!input.build.id) throw new Error('[avg-sound] 原声音版本不存在')
  const choices = await readAvgConfirmedSoundChoicesV1({ scope: input.scope, buildId: input.build.id,
    expectedBuildRevision: input.build.stateRevision, controlEpoch: input.build.controlEpoch }, true)
  const entries = [...(next.presentation.inheritedSounds ?? [])]
  for (const choice of choices) {
    if (!next.presentation.stage.assets.some(a => same(a, choice.payload.asset))) continue
    const source = await sourceOf(input.scope, input.build, input.productionKey, choice), existing = entries.find(e => e.assetKey === choice.payload.asset.assetKey)
    if (existing && !same(existing.source, source)) throw new Error('[avg-sound] 不能覆盖已有声音来源')
    if (!existing) entries.push({ assetKey: choice.payload.asset.assetKey, source,
      declaration: choice.payload.version === 2
        ? '在编辑草稿保留准确已采用加工声音与原播放用途；新版本仍须独立确认演出、路线与全部媒资'
        : '在编辑草稿保留准确原声音与原播放用途；新版本仍须独立确认演出、路线与全部媒资' })
  }
  if (entries.length) next.presentation.inheritedSounds = entries
  await readAvgInheritedStageSoundsV1({ ...input, payload: next.presentation, scripts: next.scripts })
  return next
}
