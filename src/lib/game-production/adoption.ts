import { db } from '../db/schema'
import type {
  ProductMediaAsset,
  ProductMediaBlob,
  GameBuildArtifactRecordV1,
  GameBuildManifestV1,
  GameBuildQualityReportV1,
  GameProductionCommandRecordV1,
  GameProductionCommandV1,
  GameRelease,
  GameRuntimePackageV2,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../world-engine/scope'
import { assertReleaseUnchanged } from '../world-engine/releases'
import { parseGameProductionBriefV3, parseGameProductionCommandV1 } from './contracts'
import { canonicalGameProductionJsonV2, hashGameProductionValueV2, isSha256Hash } from './hash'
import { readVerifiedMediaBlobObjectData } from './media-blob-store'
import { parseGameProductionPlanV3 } from './plan'
import { verifyGameBuildPreviewManifestV1 } from './preview-manifest'
import {
  requirePassedGameBrowserPerformanceGateV1,
  requirePassedGameBuildMainRouteGateV1,
  requirePassedGameMediaRuntimeGateV1,
} from './quality-receipts'
import { createGameReleaseManifestV2 } from './runtime-package'
import { createGameBuildRootTerminalReceiptV1 } from './receipts'

type PublishCommandV1 = Extract<GameProductionCommandV1, { type: 'publish' }>

export interface GameProductionAdoptionIntentV1 {
  schema: 'storyforge.game-production-adoption-intent'
  version: 1
  productionId: number
  productionKey: string
  expectedStateRevision: number
  buildId: number
  buildNumber: number
  controlEpoch: number
  briefHash: string
  planHash: string
  manifestHash: string
  packageHash: string
  previewHash: string
  qualityReportHash: string
  rootTerminalReceiptHash: string
  browserPerformanceReceiptHash: string | null
  mainRoutePlaythroughReceiptHash: string | null
  mediaRuntimeReceiptHash: string | null
  worldReleaseId: number
  worldContentHash: string
}

export interface PreparedGameProductionAdoptionV1 {
  intent: GameProductionAdoptionIntentV1
  adoptionIntentHash: string
  productType: GameRuntimePackageV2['productType']
  title: string
  mediaAssetKeys: string[]
}

export interface GameProductionPublishReceiptV1 {
  productionId: number
  buildId: number
  buildNumber: number
  gameReleaseId: number
  releaseVersion: number
  releaseContentHash: string
  packageHash: string
  adoptionIntentHash: string
  stateRevision: number
  replayed: boolean
}

interface VerifiedAdoption extends PreparedGameProductionAdoptionV1 {
  scope: WorkspaceScope
  runtimePackage: GameRuntimePackageV2
  artifacts: GameBuildArtifactRecordV1[]
  mediaArtifacts: Map<string, GameBuildArtifactRecordV1>
}

function fail(message: string): never {
  throw new Error(`[game-production-adoption] ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不符合合同:${actual.join(',')}`)
  }
}

export function parseGameBuildManifestV1(value: string): GameBuildManifestV1 {
  let raw: unknown
  try { raw = JSON.parse(value) } catch { fail('Build manifest 不是合法 JSON') }
  const row = object(raw, 'Build manifest')
  exactKeys(row, [
    'schema', 'version', 'productionKey', 'buildNumber', 'briefRevision', 'briefHash', 'planHash',
    'controlEpoch', 'runtimePackageHash', 'artifactReceipts', 'completedGateIds', 'fallbackSummary',
  ], 'Build manifest')
  if (row.schema !== 'storyforge.game-build-manifest' || row.version !== 1
    || !Number.isInteger(row.buildNumber) || !Number.isInteger(row.briefRevision)
    || !Number.isInteger(row.controlEpoch) || !isSha256Hash(row.briefHash)
    || !isSha256Hash(row.planHash) || !isSha256Hash(row.runtimePackageHash)
    || typeof row.productionKey !== 'string' || !row.productionKey.trim()
    || !Array.isArray(row.artifactReceipts) || !Array.isArray(row.completedGateIds)
    || !Array.isArray(row.fallbackSummary)) fail('Build manifest 基础字段无效')
  const artifactReceipts = row.artifactReceipts.map((value, index) => {
    const receipt = object(value, `artifactReceipts[${index}]`)
    exactKeys(receipt, ['artifactKey', 'version', 'contentHash', 'producerReceiptHash'], `artifactReceipts[${index}]`)
    if (typeof receipt.artifactKey !== 'string' || !receipt.artifactKey
      || !Number.isInteger(receipt.version) || Number(receipt.version) < 1
      || !isSha256Hash(receipt.contentHash)
      || (receipt.producerReceiptHash != null && !isSha256Hash(receipt.producerReceiptHash))) {
      fail(`artifactReceipts[${index}] 无效`)
    }
    return {
      artifactKey: receipt.artifactKey,
      version: Number(receipt.version),
      contentHash: receipt.contentHash,
      producerReceiptHash: receipt.producerReceiptHash as string | null,
    }
  })
  const completedGateIds = row.completedGateIds.map(value => String(value).trim())
  const fallbackSummary = row.fallbackSummary.map(value => String(value).trim())
  if (completedGateIds.some(value => !value) || fallbackSummary.some(value => !value)
    || new Set(completedGateIds).size !== completedGateIds.length
    || new Set(fallbackSummary).size !== fallbackSummary.length) fail('Build manifest 数组无效')
  return {
    schema: 'storyforge.game-build-manifest', version: 1,
    productionKey: row.productionKey.trim(), buildNumber: Number(row.buildNumber),
    briefRevision: Number(row.briefRevision), briefHash: row.briefHash,
    planHash: row.planHash, controlEpoch: Number(row.controlEpoch),
    runtimePackageHash: row.runtimePackageHash, artifactReceipts,
    completedGateIds, fallbackSummary,
  }
}

export function parseGameBuildQualityReportV1(value: string): GameBuildQualityReportV1 {
  let raw: unknown
  try { raw = JSON.parse(value) } catch { fail('Quality report 不是合法 JSON') }
  const row = object(raw, 'Quality report')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'packageHash', 'hardGateResults', 'softGateResults',
    'mediaCoverage', 'playable', 'releaseReady', 'warnings',
  ], 'Quality report')
  if (row.schema !== 'storyforge.game-build-quality-report' || row.version !== 1
    || !Number.isInteger(row.buildNumber) || !isSha256Hash(row.packageHash)
    || !Array.isArray(row.hardGateResults) || !Array.isArray(row.softGateResults)
    || !Array.isArray(row.warnings) || typeof row.playable !== 'boolean'
    || typeof row.releaseReady !== 'boolean' || typeof row.mediaCoverage !== 'number'
    || row.mediaCoverage < 0 || row.mediaCoverage > 1) fail('Quality report 基础字段无效')
  const gates = (values: unknown[], label: string) => values.map((value, index) => {
    const gate = object(value, `${label}[${index}]`)
    exactKeys(gate, ['gateId', 'passed', 'evidence'], `${label}[${index}]`)
    if (typeof gate.gateId !== 'string' || !gate.gateId.trim() || typeof gate.passed !== 'boolean'
      || !Array.isArray(gate.evidence) || gate.evidence.some(item => typeof item !== 'string' || !item.trim())) {
      fail(`${label}[${index}] 无效`)
    }
    return { gateId: gate.gateId.trim(), passed: gate.passed, evidence: [...gate.evidence] as string[] }
  })
  return {
    schema: 'storyforge.game-build-quality-report', version: 1,
    buildNumber: Number(row.buildNumber), packageHash: row.packageHash,
    hardGateResults: gates(row.hardGateResults, 'hardGateResults'),
    softGateResults: gates(row.softGateResults, 'softGateResults'),
    mediaCoverage: row.mediaCoverage, playable: row.playable, releaseReady: row.releaseReady,
    warnings: row.warnings.map(value => String(value)),
  }
}

async function inspectAdoption(scope: WorkspaceScope, productionId: number): Promise<VerifiedAdoption> {
  const production = await db.gameProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'gameProductions', production, { owner: 'work' })) {
    fail('Production 不存在或跨 Work')
  }
  if (production.status !== 'preview-ready' || production.currentBuildNumber == null
    || production.currentBriefRevision == null) fail('Production 尚未达到可发布状态')
  const [build, briefRow] = await Promise.all([
    db.gameBuilds.where('[productionId+buildNumber]').equals([production.id!, production.currentBuildNumber]).first(),
    db.gameProductionBriefs.where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first(),
  ])
  if (!build || !briefRow || !await assertRecordInScope(scope, 'gameBuilds', build, { owner: 'work' })
    || !['preview-ready', 'release-ready'].includes(build.status) || briefRow.status !== 'authorized'
    || build.briefRevision !== briefRow.revision || build.briefHash !== briefRow.briefHash
    || build.controlEpoch !== production.controlEpoch || !build.rootTerminalReceiptHash) {
    fail('Build/Brief/status/epoch 绑定不满足发布条件')
  }
  const brief = parseGameProductionBriefV3(briefRow.briefJson)
  if (await hashGameProductionValueV2(brief) !== briefRow.briefHash) fail('Brief hash 校验失败')
  const mediaRuntimeRequired = brief.media.requiredMediaKinds.length > 0
  const [browserPerformance, mainRoutePlaythrough, mediaRuntime] = brief.qualityProfile === 'commercial-candidate'
    ? await Promise.all([
      requirePassedGameBrowserPerformanceGateV1({ scope, gameBuildId: build.id! }),
      requirePassedGameBuildMainRouteGateV1({ scope, gameBuildId: build.id! }),
      mediaRuntimeRequired
        ? requirePassedGameMediaRuntimeGateV1({ scope, gameBuildId: build.id! })
        : Promise.resolve(null),
    ])
    : [null, null, null]
  if (build.status !== 'release-ready') fail('Build 尚未通过全部发布硬门')
  const plan = parseGameProductionPlanV3(build.planJson, brief, briefRow.briefHash)
  if (await hashGameProductionValueV2(plan) !== build.planHash
    || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch) fail('Plan hash/Build 绑定失败')
  const manifest = parseGameBuildManifestV1(build.manifestJson)
  if (await hashGameProductionValueV2(manifest) !== build.manifestHash
    || manifest.productionKey !== production.productionKey || manifest.buildNumber !== build.buildNumber
    || manifest.briefRevision !== briefRow.revision || manifest.briefHash !== briefRow.briefHash
    || manifest.planHash !== build.planHash || manifest.controlEpoch !== build.controlEpoch
    || manifest.runtimePackageHash !== build.packageHash) fail('Build manifest hash/指针校验失败')
  const quality = parseGameBuildQualityReportV1(build.qualityReportJson)
  if (await hashGameProductionValueV2(quality) !== build.qualityReportHash
    || quality.buildNumber !== build.buildNumber || quality.packageHash !== build.packageHash
    || !quality.playable || !quality.releaseReady || quality.hardGateResults.some(gate => !gate.passed)) {
    fail('Quality report 未通过发布硬门')
  }
  const hardGates = new Set(quality.hardGateResults.filter(gate => gate.passed).map(gate => gate.gateId))
  if (brief.completionContract.requiredGateIds.some(gate => !hardGates.has(gate))
    || brief.completionContract.requiredGateIds.some(gate => !manifest.completedGateIds.includes(gate))) {
    fail('Brief 要求的完成门未全部进入质量报告和 Build manifest')
  }
  const preview = await verifyGameBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.previewHash !== build.previewHash || preview.buildManifestHash !== build.manifestHash
    || preview.packageHash !== build.packageHash || preview.productionKey !== production.productionKey
    || preview.buildNumber !== build.buildNumber || preview.runtimePackage.sourceWorld.contentHash !== brief.source.worldContentHash) {
    fail('Preview 与 Build/Brief 不闭合')
  }
  const artifacts = (await db.gameBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.status === 'accepted' || row.status === 'carried-forward')
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
  if (!artifacts.length || new Set(artifacts.map(row => row.artifactKey)).size !== artifacts.length
    || artifacts.some(row => row.controlEpoch !== build.controlEpoch)) fail('Artifact 集合存在重复 key 或旧 epoch')
  const receipts = artifacts.map(row => ({
    artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash,
    producerReceiptHash: row.producerReceiptHash,
  }))
  if (canonicalGameProductionJsonV2(receipts) !== canonicalGameProductionJsonV2(manifest.artifactReceipts)) {
    fail('Build manifest 未完整且唯一地覆盖 accepted Artifacts')
  }
  const packageArtifact = artifacts.find(row => row.artifactKey === 'runtime.package')
  const qualityArtifact = artifacts.find(row => row.artifactKey === 'quality.report')
  if (!packageArtifact || packageArtifact.contentHash !== build.packageHash
    || !qualityArtifact || qualityArtifact.contentHash !== build.qualityReportHash) fail('Runtime/Quality Artifact 缺失')
  const expectedRootReceipt = await createGameBuildRootTerminalReceiptV1({
    planHash: build.planHash, manifestHash: build.manifestHash, packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash, controlEpoch: build.controlEpoch,
    budgetLedgerJson: build.budgetLedgerJson, artifacts,
  })
  if (expectedRootReceipt !== build.rootTerminalReceiptHash) fail('root terminal receipt 校验失败')

  const mediaArtifacts = new Map<string, GameBuildArtifactRecordV1>()
  const runtimeAssets = preview.runtimePackage.presentation?.assets ?? []
  if (preview.mediaBindings.length !== runtimeAssets.length) fail('Release-ready Preview 必须绑定全部 RuntimePackage 媒资')
  for (const asset of runtimeAssets) {
    const binding = preview.mediaBindings.find(row => row.assetKey === asset.assetKey)
    const artifact = binding ? artifacts.find(row => row.artifactKey === binding.artifactKey) : null
    if (!binding || !artifact || artifact.blobObjectId == null || artifact.contentHash !== asset.blobContentHash
      || artifact.mimeType !== asset.mimeType || artifact.byteSize !== asset.byteSize) fail(`媒资 Artifact 绑定无效:${asset.assetKey}`)
    const rights = object(JSON.parse(artifact.rightsJson), `rights:${artifact.artifactKey}`)
    if (rights.commercialUse !== true || typeof rights.license !== 'string' || !rights.license.trim()) {
      fail(`媒资商业权利不完整:${artifact.artifactKey}`)
    }
    const blob = await db.mediaBlobObjects.get(artifact.blobObjectId)
    if (!blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
      || blob.contentHash !== asset.blobContentHash || blob.mimeType !== asset.mimeType
      || blob.byteSize !== asset.byteSize) fail(`媒资物理对象不匹配:${asset.assetKey}`)
    await readVerifiedMediaBlobObjectData(blob)
    mediaArtifacts.set(asset.assetKey, artifact)
  }
  const worldRelease = await db.worldReleases.get(brief.source.worldReleaseId)
  if (!worldRelease || worldRelease.projectId !== scope.projectId || worldRelease.worldId !== scope.worldId
    || worldRelease.contentHash !== brief.source.worldContentHash
    || preview.runtimePackage.sourceWorld.contentHash !== worldRelease.contentHash) fail('WorldRelease 来源绑定失败')
  await assertReleaseUnchanged(worldRelease.id!)

  const intent: GameProductionAdoptionIntentV1 = {
    schema: 'storyforge.game-production-adoption-intent', version: 1,
    productionId: production.id!, productionKey: production.productionKey,
    expectedStateRevision: production.stateRevision, buildId: build.id!, buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch, briefHash: build.briefHash, planHash: build.planHash,
    manifestHash: build.manifestHash, packageHash: build.packageHash, previewHash: build.previewHash,
    qualityReportHash: build.qualityReportHash, rootTerminalReceiptHash: build.rootTerminalReceiptHash,
    browserPerformanceReceiptHash: browserPerformance?.gateReceipt.receiptHash ?? null,
    mainRoutePlaythroughReceiptHash: mainRoutePlaythrough?.gateReceipt.receiptHash ?? null,
    mediaRuntimeReceiptHash: mediaRuntime?.gateReceipt.receiptHash ?? null,
    worldReleaseId: worldRelease.id!, worldContentHash: worldRelease.contentHash,
  }
  return {
    scope, intent, adoptionIntentHash: await hashGameProductionValueV2(intent),
    productType: preview.runtimePackage.productType, title: preview.runtimePackage.definition.title,
    mediaAssetKeys: runtimeAssets.map(asset => asset.assetKey).sort(),
    runtimePackage: preview.runtimePackage, artifacts, mediaArtifacts,
  }
}

export async function prepareGameProductionAdoption(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<PreparedGameProductionAdoptionV1> {
  const scope = await resolveScope({ scope: input.scope })
  const verified = await inspectAdoption(scope, input.productionId)
  return {
    intent: verified.intent, adoptionIntentHash: verified.adoptionIntentHash,
    productType: verified.productType, title: verified.title, mediaAssetKeys: verified.mediaAssetKeys,
  }
}

async function materializeReleaseMedia(verified: VerifiedAdoption, now: number): Promise<void> {
  for (const asset of verified.runtimePackage.presentation?.assets ?? []) {
    const artifact = verified.mediaArtifacts.get(asset.assetKey)!
    const existing = await db.productMediaAssets
      .where('[workId+assetKey+version]').equals([verified.scope.workId, asset.assetKey, asset.version]).first()
    if (existing) {
      if (existing.contentHash !== asset.contentHash || existing.mimeType !== asset.mimeType
        || existing.byteSize !== asset.byteSize || existing.kind !== asset.kind) fail(`正式媒资版本冲突:${asset.assetKey}`)
      const blob = await db.productMediaBlobs.where('mediaAssetId').equals(existing.id!).first()
      if (!blob || blob.blobObjectId !== artifact.blobObjectId) fail(`正式媒资二进制绑定冲突:${asset.assetKey}`)
      continue
    }
    const row = stampNewRecord(verified.scope, 'productMediaAssets', {
      projectId: verified.scope.projectId, worldId: verified.scope.worldId, workId: verified.scope.workId,
      assetKey: asset.assetKey, version: asset.version, kind: asset.kind, name: asset.name,
      mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height,
      durationMs: asset.durationMs, contentHash: asset.contentHash, source: asset.source,
      license: asset.license, altText: asset.altText, characterTag: asset.characterTag,
      sceneTag: asset.sceneTag, createdAt: now, updatedAt: now,
    } satisfies ProductMediaAsset, { owner: 'work' })
    const mediaAssetId = await db.productMediaAssets.add(row) as number
    await db.productMediaBlobs.add(stampNewRecord(verified.scope, 'productMediaBlobs', {
      projectId: verified.scope.projectId, worldId: verified.scope.worldId, workId: verified.scope.workId,
      mediaAssetId, blobObjectId: artifact.blobObjectId!, data: null, createdAt: now,
    } satisfies ProductMediaBlob, { owner: 'work' }))
  }
}

async function assertPreparedAdoptionUnchangedInTransaction(verified: VerifiedAdoption): Promise<void> {
  const [production, build, worldRelease, artifacts, qualityReceipts] = await Promise.all([
    db.gameProductions.get(verified.intent.productionId),
    db.gameBuilds.get(verified.intent.buildId),
    db.worldReleases.get(verified.intent.worldReleaseId),
    db.gameBuildArtifacts.where('buildId').equals(verified.intent.buildId).toArray(),
    db.gameQualityGateReceipts.where('buildId').equals(verified.intent.buildId).toArray(),
  ])
  const brief = build
    ? await db.gameProductionBriefs
      .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
    : null
  if (!production || production.status !== 'preview-ready'
    || production.stateRevision !== verified.intent.expectedStateRevision
    || production.currentBuildNumber !== verified.intent.buildNumber
    || production.controlEpoch !== verified.intent.controlEpoch
    || !build || build.status !== 'release-ready' || build.buildNumber !== verified.intent.buildNumber
    || build.controlEpoch !== verified.intent.controlEpoch || build.briefHash !== verified.intent.briefHash
    || build.planHash !== verified.intent.planHash || build.manifestHash !== verified.intent.manifestHash
    || build.packageHash !== verified.intent.packageHash || build.previewHash !== verified.intent.previewHash
    || build.qualityReportHash !== verified.intent.qualityReportHash
    || build.rootTerminalReceiptHash !== verified.intent.rootTerminalReceiptHash
    || !brief || brief.briefHash !== verified.intent.briefHash || brief.status !== 'authorized'
    || !worldRelease || worldRelease.contentHash !== verified.intent.worldContentHash) {
    fail('adoption intent 在提交前发生变化')
  }
  const accepted = artifacts
    .filter(row => row.status === 'accepted' || row.status === 'carried-forward')
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
  const binding = (rows: GameBuildArtifactRecordV1[]) => rows.map(row => ({
    id: row.id, artifactKey: row.artifactKey, version: row.version, status: row.status,
    controlEpoch: row.controlEpoch, contentHash: row.contentHash, blobObjectId: row.blobObjectId,
    mimeType: row.mimeType, byteSize: row.byteSize, producerReceiptHash: row.producerReceiptHash,
  }))
  if (canonicalGameProductionJsonV2(binding(accepted))
    !== canonicalGameProductionJsonV2(binding(verified.artifacts))) {
    fail('Artifact 集合在提交前发生变化')
  }
  const requiredGateHashes = [
    verified.intent.browserPerformanceReceiptHash,
    verified.intent.mainRoutePlaythroughReceiptHash,
    verified.intent.mediaRuntimeReceiptHash,
  ].filter((value): value is string => value != null)
  const currentGateHashes = new Set(qualityReceipts.map(row => row.receiptHash))
  if (requiredGateHashes.some(hash => !currentGateHashes.has(hash))) fail('商业质量回执在提交前发生变化')
  for (const artifact of verified.mediaArtifacts.values()) {
    if (artifact.blobObjectId == null) fail(`媒资 Artifact 缺少 Blob:${artifact.artifactKey}`)
    const blob = await db.mediaBlobObjects.get(artifact.blobObjectId)
    if (!blob || blob.storageState !== 'ready' || blob.contentHash !== artifact.contentHash
      || blob.mimeType !== artifact.mimeType || blob.byteSize !== artifact.byteSize) {
      fail(`媒资物理对象在提交前发生变化:${artifact.artifactKey}`)
    }
  }
}

export async function publishGameProductionBuild(input: {
  scope: WorkspaceScope
  productionId: number
  command: PublishCommandV1
  label?: string
}): Promise<GameProductionPublishReceiptV1> {
  const scope = await resolveScope({ scope: input.scope })
  const command = parseGameProductionCommandV1(input.command)
  if (command.type !== 'publish') fail('命令类型必须是 publish')
  const payloadHash = await hashGameProductionValueV2(command)
  const production = await db.gameProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(scope, 'gameProductions', production, { owner: 'work' })) fail('Production 不存在或跨 Work')
  const replay = await db.gameProductionCommands
    .where('[productionId+commandId]').equals([production.id!, command.commandId]).first()
  if (replay) {
    if (replay.payloadHash !== payloadHash) fail('相同 commandId 的 payload 不同')
    if (replay.status !== 'succeeded') fail('publish command 尚未成功')
    return { ...(JSON.parse(replay.resultJson) as GameProductionPublishReceiptV1), replayed: true }
  }
  const prepared = await inspectAdoption(scope, input.productionId)
  if (command.expectedStateRevision !== prepared.intent.expectedStateRevision
    || command.buildNumber !== prepared.intent.buildNumber
    || command.expectedManifestHash !== prepared.intent.manifestHash
    || command.adoptionIntentHash !== prepared.adoptionIntentHash) fail('publish command 与 adoption intent 不一致或已过期')

  // All expensive canonical hashing, browser-receipt replay and physical blob
  // verification happen before acquiring the write transaction. The
  // transaction repeats a bounded field-level CAS over every locked authority
  // row, so it stays atomic without holding IndexedDB open across WebCrypto or
  // multi-megabyte byte verification.
  const releaseManifest = await createGameReleaseManifestV2({
    runtimePackage: prepared.runtimePackage,
    productionProvenance: {
      productionKey: prepared.intent.productionKey, buildNumber: prepared.intent.buildNumber,
      buildManifestHash: prepared.intent.manifestHash,
      rootTerminalReceiptHash: prepared.intent.rootTerminalReceiptHash,
    },
  })
  const manifestJson = canonicalGameProductionJsonV2(releaseManifest)
  const contentHash = await hashGameProductionValueV2(releaseManifest)

  return db.transaction('rw', scopeTransactionTables(
    db.gameProductions, db.gameProductionBriefs, db.gameProductionCommands, db.gameBuilds,
    db.gameBuildArtifacts, db.mediaBlobObjects, db.worldReleases, db.gameReleases,
    db.productMediaAssets, db.productMediaBlobs, db.gameQualityGateReceipts,
  ), async () => {
    const verified = prepared
    await assertPreparedAdoptionUnchangedInTransaction(verified)
    const duplicateCommand = await db.gameProductionCommands
      .where('[productionId+commandId]').equals([input.productionId, command.commandId]).first()
    if (duplicateCommand) fail('publish command 已被并发 claim')
    const now = Date.now()
    const claim = stampNewRecord(scope, 'gameProductionCommands', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: input.productionId, commandId: command.commandId, type: 'publish' as const,
      payloadHash, expectedStateRevision: command.expectedStateRevision, status: 'claimed' as const,
      resultJson: '{}', errorCode: null, createdAt: now, completedAt: null,
    } satisfies GameProductionCommandRecordV1, { owner: 'work' })
    const claimId = await db.gameProductionCommands.add(claim) as number
    await materializeReleaseMedia(verified, now)
    const priorReleases = await db.gameReleases.where('workId').equals(scope.workId).toArray()
    const productionReleases = priorReleases.filter(release => {
      try {
        const raw = JSON.parse(release.manifestJson) as { productionProvenance?: { productionKey?: string } | null }
        return raw.productionProvenance?.productionKey === verified.intent.productionKey
      } catch { return false }
    })
    const releaseRow: GameRelease = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionKey: verified.intent.productionKey,
      worldReleaseId: verified.intent.worldReleaseId,
      version: Math.max(0, ...productionReleases.map(release => release.version)) + 1,
      label: input.label?.trim() || `${verified.title} v${productionReleases.length + 1}`,
      manifestJson, contentHash, createdAt: now,
    }
    const gameReleaseId = await db.gameReleases.add(releaseRow) as number
    const stateRevision = verified.intent.expectedStateRevision + 1
    await db.gameBuilds.update(verified.intent.buildId, {
      status: 'released', stateRevision: (await db.gameBuilds.get(verified.intent.buildId))!.stateRevision + 1,
      adoptionIntentHash: verified.adoptionIntentHash, releasedGameReleaseId: gameReleaseId,
      completedAt: now, updatedAt: now,
    })
    await db.gameProductions.update(input.productionId, {
      status: 'released', stateRevision, currentGameReleaseId: gameReleaseId, updatedAt: now,
    })
    const receipt: GameProductionPublishReceiptV1 = {
      productionId: input.productionId, buildId: verified.intent.buildId,
      buildNumber: verified.intent.buildNumber, gameReleaseId, releaseVersion: releaseRow.version,
      releaseContentHash: contentHash, packageHash: verified.intent.packageHash,
      adoptionIntentHash: verified.adoptionIntentHash, stateRevision, replayed: false,
    }
    await db.gameProductionCommands.update(claimId, {
      status: 'succeeded', resultJson: canonicalGameProductionJsonV2(receipt), completedAt: now,
    })
    return receipt
  })
}
