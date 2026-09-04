import { db } from '../db/schema'
import type {
  ConfirmedProductBriefV1,
  ProductMediaAsset,
  ProductMediaBlob,
  ProductBuildArtifactRecordV1,
  ProductBuildManifestV1,
  ProductBuildQualityReportV1,
  ProductProductionCommandRecordV1,
  ProductProductionCommandV1,
  ProductRelease,
  ProductReleaseManifestV1,
  ProductRuntimePackageV1,
  ProductReleaseLineageV1,
  ProductSourceManifestV1,
  ProductSourcePlanV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { parseProductProductionBriefV3, parseProductProductionCommandV1 } from './contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import { readVerifiedMediaBlobObjectData } from './media-blob-store'
import { parseProductProductionPlanV3 } from './plan'
import { verifyProductBuildPreviewManifestV1 } from './preview-manifest'
import {
  requirePassedProductBrowserPerformanceGateV1,
  requirePassedProductBuildMainRouteGateV1,
  requirePassedProductMediaRuntimeGateV1,
} from './quality-receipts'
import {
  createProductReleaseManifestV1,
  productReleaseIdentityHashV1,
  verifyProductReleaseManifestV1,
} from './runtime-package'
import { createProductBuildRootTerminalReceiptV1 } from './receipts'
import { readAgentRunV1 } from '../agent/run/event-store'
import {
  aggregateProductSourceManifestFromExactRunsV1,
  createProductReleaseLineageV1,
  portableProductSourcePlanV1,
  productReleaseUidV1,
  resolveProductSourceReadBoundaryV1,
  validateProductSourceManifestV1,
} from '../product/source-contracts'
import {
  productProductionTaskUsesWorldGatewayV1,
  parseConfirmedProductBriefV1,
  parseProductProductionSourcePlanV1,
} from './source-contracts'

type PublishCommandV1 = Extract<ProductProductionCommandV1, { type: 'publish' }>

export interface ProductProductionAdoptionIntentV1 {
  schema: 'storyforge.product-production-adoption-intent'
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

export interface PreparedProductProductionAdoptionV1 {
  intent: ProductProductionAdoptionIntentV1
  adoptionIntentHash: string
  productType: ProductRuntimePackageV1['productType']
  title: string
  mediaAssetKeys: string[]
}

export interface ProductProductionPublishReceiptV1 {
  productionId: number
  buildId: number
  buildNumber: number
  productReleaseId: number
  releaseVersion: number
  releaseContentHash: string
  packageHash: string
  adoptionIntentHash: string
  stateRevision: number
  replayed: boolean
}

interface VerifiedAdoption extends PreparedProductProductionAdoptionV1 {
  scope: WorkspaceScope
  runtimePackage: ProductRuntimePackageV1
  artifacts: ProductBuildArtifactRecordV1[]
  mediaArtifacts: Map<string, ProductBuildArtifactRecordV1>
  sourcePlan: ProductSourcePlanV1
  confirmedBrief: ConfirmedProductBriefV1
  sourceManifest: ProductSourceManifestV1
  releaseVersion: number
  parentRelease: ProductReleaseLineageV1['parentRelease']
  compatibilityHash: string
  compatibilityStatus: ProductReleaseLineageV1['compatibility']['status']
  qualityReceiptHashes: string[]
}

function fail(message: string): never {
  throw new Error(`[product-production-adoption] ${message}`)
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

export function parseProductBuildManifestV1(value: string): ProductBuildManifestV1 {
  let raw: unknown
  try { raw = JSON.parse(value) } catch { fail('Build manifest 不是合法 JSON') }
  const row = object(raw, 'Build manifest')
  exactKeys(row, [
    'schema', 'version', 'productionKey', 'buildNumber', 'briefRevision', 'briefHash', 'planHash',
    'controlEpoch', 'runtimePackageHash', 'artifactReceipts', 'completedGateIds', 'fallbackSummary',
  ], 'Build manifest')
  if (row.schema !== 'storyforge.product-build-manifest' || row.version !== 1
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
    schema: 'storyforge.product-build-manifest', version: 1,
    productionKey: row.productionKey.trim(), buildNumber: Number(row.buildNumber),
    briefRevision: Number(row.briefRevision), briefHash: row.briefHash,
    planHash: row.planHash, controlEpoch: Number(row.controlEpoch),
    runtimePackageHash: row.runtimePackageHash, artifactReceipts,
    completedGateIds, fallbackSummary,
  }
}

export function parseProductBuildQualityReportV1(value: string): ProductBuildQualityReportV1 {
  let raw: unknown
  try { raw = JSON.parse(value) } catch { fail('Quality report 不是合法 JSON') }
  const row = object(raw, 'Quality report')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'packageHash', 'hardGateResults', 'softGateResults',
    'mediaCoverage', 'playable', 'releaseReady', 'warnings',
  ], 'Quality report')
  if (row.schema !== 'storyforge.product-build-quality-report' || row.version !== 1
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
    schema: 'storyforge.product-build-quality-report', version: 1,
    buildNumber: Number(row.buildNumber), packageHash: row.packageHash,
    hardGateResults: gates(row.hardGateResults, 'hardGateResults'),
    softGateResults: gates(row.softGateResults, 'softGateResults'),
    mediaCoverage: row.mediaCoverage, playable: row.playable, releaseReady: row.releaseReady,
    warnings: row.warnings.map(value => String(value)),
  }
}

async function worldContextManifestPointersV1(input: {
  scope: WorkspaceScope
  buildId: number
  worldSourceTaskKeys: string[]
}) {
  const wanted = new Set(input.worldSourceTaskKeys)
  const rows = await db.agentRuns.where('productBuildId').equals(input.buildId).toArray()
  const pointers: Array<{ runId: number; stepId: string; attempt: number; manifestHash: string }> = []
  for (const row of rows) {
    if (!row.id || !row.parentRelation?.startsWith('task:')) continue
    const taskKey = row.parentRelation.slice('task:'.length)
    if (!wanted.has(taskKey)) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    for (const event of snapshot.events) {
      if (event.type !== 'context.assembled' || event.payload.stepId !== taskKey) continue
      pointers.push({
        runId: row.id,
        stepId: event.payload.stepId,
        attempt: event.payload.attempt,
        manifestHash: event.payload.manifestHash,
      })
    }
  }
  return pointers.sort((left, right) => left.runId - right.runId
    || left.stepId.localeCompare(right.stepId) || left.attempt - right.attempt)
}

async function priorReleaseLineageV1(input: {
  workId: number
  productionKey: string
}): Promise<{
  version: number
  parentRelease: ProductReleaseLineageV1['parentRelease']
  sourceManifest: ProductSourceManifestV1 | null
}> {
  const rows = (await db.productReleases.where('workId').equals(input.workId).toArray())
    .filter(row => row.productionKey === input.productionKey)
    .sort((left, right) => right.version - left.version)
  const latest = rows[0]
  if (!latest) return { version: 1, parentRelease: null, sourceManifest: null }
  const manifest = await verifyProductReleaseManifestV1(latest.manifestJson)
  return {
    version: latest.version + 1,
    parentRelease: {
      releaseUid: manifest.lineage.releaseUid,
      releaseHash: manifest.lineage.releaseHash,
    },
    sourceManifest: manifest.sourceContracts.sourceManifest,
  }
}

async function inspectAdoption(scope: WorkspaceScope, productionId: number): Promise<VerifiedAdoption> {
  const production = await db.productProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    fail('Production 不存在或跨 Work')
  }
  if (production.status !== 'preview-ready' || production.currentBuildNumber == null
    || production.currentBriefRevision == null) fail('Production 尚未达到可发布状态')
  const [build, briefRow] = await Promise.all([
    db.productBuilds.where('[productionId+buildNumber]').equals([production.id!, production.currentBuildNumber]).first(),
    db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first(),
  ])
  if (!build || !briefRow || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !['preview-ready', 'release-ready'].includes(build.status) || briefRow.status !== 'authorized'
    || build.briefRevision !== briefRow.revision || build.briefHash !== briefRow.briefHash
    || build.controlEpoch !== production.controlEpoch || !build.rootTerminalReceiptHash) {
    fail('Build/Brief/status/epoch 绑定不满足发布条件')
  }
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (await hashProductProductionValueV2(brief) !== briefRow.briefHash) fail('Brief hash 校验失败')
  const mediaRuntimeRequired = brief.media.requiredMediaKinds.length > 0
  const [browserPerformance, mainRoutePlaythrough, mediaRuntime] = brief.qualityProfile === 'commercial-candidate'
    ? await Promise.all([
      requirePassedProductBrowserPerformanceGateV1({ scope, productBuildId: build.id! }),
      requirePassedProductBuildMainRouteGateV1({ scope, productBuildId: build.id! }),
      mediaRuntimeRequired
        ? requirePassedProductMediaRuntimeGateV1({ scope, productBuildId: build.id! })
        : Promise.resolve(null),
    ])
    : [null, null, null]
  if (build.status !== 'release-ready') fail('Build 尚未通过全部发布硬门')
  const plan = parseProductProductionPlanV3(build.planJson, brief, briefRow.briefHash)
  if (await hashProductProductionValueV2(plan) !== build.planHash
    || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch) fail('Plan hash/Build 绑定失败')
  const manifest = parseProductBuildManifestV1(build.manifestJson)
  if (await hashProductProductionValueV2(manifest) !== build.manifestHash
    || manifest.productionKey !== production.productionKey || manifest.buildNumber !== build.buildNumber
    || manifest.briefRevision !== briefRow.revision || manifest.briefHash !== briefRow.briefHash
    || manifest.planHash !== build.planHash || manifest.controlEpoch !== build.controlEpoch
    || manifest.runtimePackageHash !== build.packageHash) fail('Build manifest hash/指针校验失败')
  const quality = parseProductBuildQualityReportV1(build.qualityReportJson)
  if (await hashProductProductionValueV2(quality) !== build.qualityReportHash
    || quality.buildNumber !== build.buildNumber || quality.packageHash !== build.packageHash
    || !quality.playable || !quality.releaseReady || quality.hardGateResults.some(gate => !gate.passed)) {
    fail('Quality report 未通过发布硬门')
  }
  const hardGates = new Set(quality.hardGateResults.filter(gate => gate.passed).map(gate => gate.gateId))
  if (brief.completionContract.requiredGateIds.some(gate => !hardGates.has(gate))
    || brief.completionContract.requiredGateIds.some(gate => !manifest.completedGateIds.includes(gate))) {
    fail('Brief 要求的完成门未全部进入质量报告和 Build manifest')
  }
  const preview = await verifyProductBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.previewHash !== build.previewHash || preview.buildManifestHash !== build.manifestHash
    || preview.packageHash !== build.packageHash || preview.productionKey !== production.productionKey
    || preview.buildNumber !== build.buildNumber || preview.runtimePackage.sourceWorld.contentHash !== brief.source.worldContentHash) {
    fail('Preview 与 Build/Brief 不闭合')
  }
  const artifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.status === 'accepted' || row.status === 'carried-forward')
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
  if (!artifacts.length || new Set(artifacts.map(row => row.artifactKey)).size !== artifacts.length
    || artifacts.some(row => row.controlEpoch !== build.controlEpoch)) fail('Artifact 集合存在重复 key 或旧 epoch')
  const receipts = artifacts.map(row => ({
    artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash,
    producerReceiptHash: row.producerReceiptHash,
  }))
  if (canonicalProductProductionJsonV2(receipts) !== canonicalProductProductionJsonV2(manifest.artifactReceipts)) {
    fail('Build manifest 未完整且唯一地覆盖 accepted Artifacts')
  }
  const packageArtifact = artifacts.find(row => row.artifactKey === 'runtime.package')
  const qualityArtifact = artifacts.find(row => row.artifactKey === 'quality.report')
  if (!packageArtifact || packageArtifact.contentHash !== build.packageHash
    || !qualityArtifact || qualityArtifact.contentHash !== build.qualityReportHash) fail('Runtime/Quality Artifact 缺失')
  const expectedRootReceipt = await createProductBuildRootTerminalReceiptV1({
    planHash: build.planHash, manifestHash: build.manifestHash, packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash, controlEpoch: build.controlEpoch,
    budgetLedgerJson: build.budgetLedgerJson, artifacts,
  })
  if (expectedRootReceipt !== build.rootTerminalReceiptHash) fail('root terminal receipt 校验失败')

  const sourcePlan = await parseProductProductionSourcePlanV1(briefRow)
  const confirmedBrief = await parseConfirmedProductBriefV1({ row: briefRow, sourcePlan })
  if (sourcePlan.productType !== brief.intent.productType
    || sourcePlan.productInstanceKey !== production.productionKey
    || sourcePlan.worldReference.releaseHash !== brief.source.worldContentHash) {
    fail('SourcePlan/ConfirmedBrief 与 Production/Brief/WorldRelease 不闭合')
  }
  await resolveProductSourceReadBoundaryV1(sourcePlan)
  const prior = await priorReleaseLineageV1({
    workId: scope.workId,
    productionKey: production.productionKey,
  })
  const pointers = await worldContextManifestPointersV1({
    scope,
    buildId: build.id!,
    worldSourceTaskKeys: plan.tasks.filter(productProductionTaskUsesWorldGatewayV1).map(task => task.taskKey),
  })
  const sourceManifest = pointers.length > 0
    ? await aggregateProductSourceManifestFromExactRunsV1({
      scope,
      sourcePlan,
      runContextManifests: pointers,
    })
    : prior.sourceManifest && prior.sourceManifest.sourcePlanHash === sourcePlan.planHash
      ? await validateProductSourceManifestV1({ sourceManifest: prior.sourceManifest, sourcePlan })
      : fail('当前 Build 没有真实世界读取 ContextManifestV3，且不存在可继承的同 SourcePlan 来源清单')
  let compatibilityBody: unknown
  try { compatibilityBody = JSON.parse(build.compatibilityJson) }
  catch { fail('Build compatibility JSON 损坏') }
  const compatibilityHash = await hashProductProductionValueV2(compatibilityBody)
  const compatibilityLevel = object(compatibilityBody, 'Build compatibility').level
  const compatibilityStatus: ProductReleaseLineageV1['compatibility']['status'] = prior.parentRelease == null
    ? 'initial'
    : compatibilityLevel === 'compatible'
      ? 'compatible'
      : compatibilityLevel === 'restart-recommended'
        ? 'requires-migration'
        : 'incompatible'
  const qualityReceiptHashes = [
    build.rootTerminalReceiptHash,
    build.manifestHash,
    build.qualityReportHash,
    browserPerformance?.gateReceipt.receiptHash ?? null,
    mainRoutePlaythrough?.gateReceipt.receiptHash ?? null,
    mediaRuntime?.gateReceipt.receiptHash ?? null,
  ].filter((value): value is string => value != null)

  const mediaArtifacts = new Map<string, ProductBuildArtifactRecordV1>()
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
  if (sourcePlan.worldReference.localReleaseRecordId !== brief.source.worldReleaseId
    || sourcePlan.worldReference.releaseHash !== brief.source.worldContentHash
    || preview.runtimePackage.sourceWorld.contentHash !== sourcePlan.worldReference.releaseHash) {
    fail('WorldReference 来源绑定失败')
  }

  const intent: ProductProductionAdoptionIntentV1 = {
    schema: 'storyforge.product-production-adoption-intent', version: 1,
    productionId: production.id!, productionKey: production.productionKey,
    expectedStateRevision: production.stateRevision, buildId: build.id!, buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch, briefHash: build.briefHash, planHash: build.planHash,
    manifestHash: build.manifestHash, packageHash: build.packageHash, previewHash: build.previewHash,
    qualityReportHash: build.qualityReportHash, rootTerminalReceiptHash: build.rootTerminalReceiptHash,
    browserPerformanceReceiptHash: browserPerformance?.gateReceipt.receiptHash ?? null,
    mainRoutePlaythroughReceiptHash: mainRoutePlaythrough?.gateReceipt.receiptHash ?? null,
    mediaRuntimeReceiptHash: mediaRuntime?.gateReceipt.receiptHash ?? null,
    worldReleaseId: sourcePlan.worldReference.localReleaseRecordId,
    worldContentHash: sourcePlan.worldReference.releaseHash,
  }
  return {
    scope, intent, adoptionIntentHash: await hashProductProductionValueV2(intent),
    productType: preview.runtimePackage.productType, title: preview.runtimePackage.definition.title,
    mediaAssetKeys: runtimeAssets.map(asset => asset.assetKey).sort(),
    runtimePackage: preview.runtimePackage, artifacts, mediaArtifacts,
    sourcePlan,
    confirmedBrief,
    sourceManifest,
    releaseVersion: prior.version,
    parentRelease: prior.parentRelease,
    compatibilityHash,
    compatibilityStatus,
    qualityReceiptHashes,
  }
}

export async function prepareProductProductionAdoption(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<PreparedProductProductionAdoptionV1> {
  const scope = await resolveScope({ scope: input.scope })
  const verified = await inspectAdoption(scope, input.productionId)
  return {
    intent: verified.intent, adoptionIntentHash: verified.adoptionIntentHash,
    productType: verified.productType, title: verified.title, mediaAssetKeys: verified.mediaAssetKeys,
  }
}

async function materializeReleaseMedia(
  verified: VerifiedAdoption,
  productReleaseId: number,
  now: number,
): Promise<void> {
  for (const asset of verified.runtimePackage.presentation?.assets ?? []) {
    const artifact = verified.mediaArtifacts.get(asset.assetKey)!
    const existing = await db.productMediaAssets
      .where('[productReleaseId+assetKey+version]')
      .equals([productReleaseId, asset.assetKey, asset.version]).first()
    if (existing) {
      if (existing.contentHash !== asset.contentHash || existing.mimeType !== asset.mimeType
        || existing.byteSize !== asset.byteSize || existing.kind !== asset.kind
        || existing.ownerKind !== 'release' || existing.productRuntimeSessionId !== null
        || existing.productType !== verified.productType) fail(`正式媒资版本冲突:${asset.assetKey}`)
      const blob = await db.productMediaBlobs.where('mediaAssetId').equals(existing.id!).first()
      if (!blob || blob.blobObjectId !== artifact.blobObjectId) fail(`正式媒资二进制绑定冲突:${asset.assetKey}`)
      continue
    }
    const row = stampNewRecord(verified.scope, 'productMediaAssets', {
      projectId: verified.scope.projectId, worldId: verified.scope.worldId, workId: verified.scope.workId,
      ownerKind: 'release', productType: verified.productType,
      productReleaseId, productRuntimeSessionId: null,
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
  const [production, build, artifacts, qualityReceipts] = await Promise.all([
    db.productProductions.get(verified.intent.productionId),
    db.productBuilds.get(verified.intent.buildId),
    db.productBuildArtifacts.where('buildId').equals(verified.intent.buildId).toArray(),
    db.productQualityGateReceipts.where('buildId').equals(verified.intent.buildId).toArray(),
  ])
  const brief = build
    ? await db.productProductionBriefs
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
    || !brief || brief.briefHash !== verified.intent.briefHash || brief.status !== 'authorized') {
    fail('adoption intent 在提交前发生变化')
  }
  const accepted = artifacts
    .filter(row => row.status === 'accepted' || row.status === 'carried-forward')
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
  const binding = (rows: ProductBuildArtifactRecordV1[]) => rows.map(row => ({
    id: row.id, artifactKey: row.artifactKey, version: row.version, status: row.status,
    controlEpoch: row.controlEpoch, contentHash: row.contentHash, blobObjectId: row.blobObjectId,
    mimeType: row.mimeType, byteSize: row.byteSize, producerReceiptHash: row.producerReceiptHash,
  }))
  if (canonicalProductProductionJsonV2(binding(accepted))
    !== canonicalProductProductionJsonV2(binding(verified.artifacts))) {
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

export async function publishProductProductionBuild(input: {
  scope: WorkspaceScope
  productionId: number
  command: PublishCommandV1
  label?: string
}): Promise<ProductProductionPublishReceiptV1> {
  const scope = await resolveScope({ scope: input.scope })
  const command = parseProductProductionCommandV1(input.command)
  if (command.type !== 'publish') fail('命令类型必须是 publish')
  const payloadHash = await hashProductProductionValueV2(command)
  const production = await db.productProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) fail('Production 不存在或跨 Work')
  const replay = await db.productProductionCommands
    .where('[productionId+commandId]').equals([production.id!, command.commandId]).first()
  if (replay) {
    if (replay.payloadHash !== payloadHash) fail('相同 commandId 的 payload 不同')
    if (replay.status !== 'succeeded') fail('publish command 尚未成功')
    return { ...(JSON.parse(replay.resultJson) as ProductProductionPublishReceiptV1), replayed: true }
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
  const productionProvenance: NonNullable<ProductReleaseManifestV1['productionProvenance']> = {
    productionKey: prepared.intent.productionKey,
    buildNumber: prepared.intent.buildNumber,
    buildManifestHash: prepared.intent.manifestHash,
    rootTerminalReceiptHash: prepared.intent.rootTerminalReceiptHash,
  }
  const portableSourcePlan = await portableProductSourcePlanV1(prepared.sourcePlan)
  const sourceContracts: ProductReleaseManifestV1['sourceContracts'] = {
    sourcePlan: portableSourcePlan,
    confirmedBrief: prepared.confirmedBrief,
    sourceManifest: prepared.sourceManifest,
  }
  const identityBody: Omit<ProductReleaseManifestV1, 'releaseIdentityHash' | 'lineage'> = {
    schema: 'storyforge.product-release',
    version: 1,
    productType: prepared.runtimePackage.productType,
    sourceWorldRelease: { contentHash: prepared.runtimePackage.sourceWorld.contentHash },
    runtimePackage: prepared.runtimePackage,
    packageHash: await hashProductProductionValueV2(prepared.runtimePackage),
    productionProvenance,
    sourceContracts,
  }
  const releaseIdentityHash = await productReleaseIdentityHashV1(identityBody)
  const releaseCreatedAt = Date.now()
  const releaseUid = productReleaseUidV1({
    productType: prepared.productType,
    productInstanceKey: prepared.intent.productionKey,
    releaseVersion: prepared.releaseVersion,
    releaseHash: releaseIdentityHash,
  })
  const lineage = await createProductReleaseLineageV1({
    productType: prepared.productType,
    productInstanceKey: prepared.intent.productionKey,
    releaseUid,
    releaseVersion: prepared.releaseVersion,
    releaseHash: releaseIdentityHash,
    parentRelease: prepared.parentRelease,
    worldReference: prepared.sourcePlan.worldReference,
    sourcePlan: portableSourcePlan,
    sourceManifest: prepared.sourceManifest,
    confirmedBrief: prepared.confirmedBrief,
    build: {
      buildUid: `GB-${encodeURIComponent(prepared.intent.productionKey)}-b${prepared.intent.buildNumber}-${prepared.intent.manifestHash.slice(0, 24)}`,
      buildHash: prepared.intent.manifestHash,
    },
    quality: { passed: true, receiptHashes: prepared.qualityReceiptHashes },
    compatibility: {
      status: prepared.compatibilityStatus,
      protocolVersion: 1,
      evidenceHashes: [prepared.compatibilityHash],
    },
    createdAt: releaseCreatedAt,
  })
  const releaseManifest = await createProductReleaseManifestV1({
    runtimePackage: prepared.runtimePackage,
    productionProvenance,
    sourceContracts,
    lineage,
  })
  const manifestJson = canonicalProductProductionJsonV2(releaseManifest)
  const contentHash = await hashProductProductionValueV2(releaseManifest)

  let transactionStage = 'open'
  try {
    return await db.transaction('rw', scopeTransactionTables(
      db.productProductions, db.productProductionBriefs, db.productProductionCommands, db.productBuilds,
      db.productBuildArtifacts, db.mediaBlobObjects, db.productReleases,
      db.productMediaAssets, db.productMediaBlobs, db.productQualityGateReceipts,
    ), async () => {
      const verified = prepared
      transactionStage = 'cas-authorities'
      await assertPreparedAdoptionUnchangedInTransaction(verified)
      transactionStage = 'claim-command'
      const duplicateCommand = await db.productProductionCommands
        .where('[productionId+commandId]').equals([input.productionId, command.commandId]).first()
      if (duplicateCommand) fail('publish command 已被并发 claim')
      const now = releaseCreatedAt
      const claim = stampNewRecord(scope, 'productProductionCommands', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        productionId: input.productionId, commandId: command.commandId, type: 'publish' as const,
        payloadHash, expectedStateRevision: command.expectedStateRevision, status: 'claimed' as const,
        resultJson: '{}', errorCode: null, createdAt: now, completedAt: null,
      } satisfies ProductProductionCommandRecordV1, { owner: 'work' })
      const claimId = await db.productProductionCommands.add(claim) as number
      transactionStage = 'verify-release-version'
      const priorReleases = await db.productReleases.where('workId').equals(scope.workId).toArray()
      const productionReleases = priorReleases.filter(release => {
        try {
          const raw = JSON.parse(release.manifestJson) as { productionProvenance?: { productionKey?: string } | null }
          return raw.productionProvenance?.productionKey === verified.intent.productionKey
        } catch { return false }
      })
      const expectedReleaseVersion = Math.max(0, ...productionReleases.map(release => release.version)) + 1
      if (expectedReleaseVersion !== verified.releaseVersion) fail('发布版本在准备与提交之间发生变化')
      const releaseRow: ProductRelease = {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        productionKey: verified.intent.productionKey,
        productType: verified.productType,
        worldReleaseId: verified.intent.worldReleaseId,
        version: verified.releaseVersion,
        label: input.label?.trim() || `${verified.title} v${verified.releaseVersion}`,
        manifestJson, contentHash, createdAt: now,
      }
      transactionStage = 'insert-release'
      const productReleaseId = await db.productReleases.add(releaseRow) as number
      transactionStage = 'materialize-media'
      await materializeReleaseMedia(verified, productReleaseId, now)
      transactionStage = 'advance-build'
      const stateRevision = verified.intent.expectedStateRevision + 1
      await db.productBuilds.update(verified.intent.buildId, {
        status: 'released', stateRevision: (await db.productBuilds.get(verified.intent.buildId))!.stateRevision + 1,
        adoptionIntentHash: verified.adoptionIntentHash, releasedProductReleaseId: productReleaseId,
        completedAt: now, updatedAt: now,
      })
      transactionStage = 'advance-production'
      await db.productProductions.update(input.productionId, {
        status: 'released', stateRevision, currentProductReleaseId: productReleaseId, updatedAt: now,
      })
      const receipt: ProductProductionPublishReceiptV1 = {
        productionId: input.productionId, buildId: verified.intent.buildId,
        buildNumber: verified.intent.buildNumber, productReleaseId, releaseVersion: releaseRow.version,
        releaseContentHash: contentHash, packageHash: verified.intent.packageHash,
        adoptionIntentHash: verified.adoptionIntentHash, stateRevision, replayed: false,
      }
      transactionStage = 'commit-command'
      await db.productProductionCommands.update(claimId, {
        status: 'succeeded', resultJson: canonicalProductProductionJsonV2(receipt), completedAt: now,
      })
      return receipt
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`[product-production-adoption:${transactionStage}] ${message}`)
  }
}
