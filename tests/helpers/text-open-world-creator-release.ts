import { db } from '../../src/lib/db/schema'
import {
  createTextOpenWorldCreatorReleaseAuthorizationV1,
  createTextOpenWorldCreatorReleaseLineageV1,
  createTextOpenWorldCreatorReleaseSourceContractsV1,
} from '../../src/lib/open-world/creator-release-contract'
import {
  TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
  type TextOpenWorldCreatorReleaseQualityEvidenceV1,
} from '../../src/lib/open-world/creator-quality-contract'
import {
  freezeTextOpenWorldNovelSourceV1,
  freezeTextOpenWorldWorldReleaseSourceV1,
} from '../../src/lib/open-world/source-pin'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import {
  parseProductRuntimePackageV1,
  productReleaseIdentityHashV1,
  verifyProductReleaseManifestV1,
} from '../../src/lib/product-production/runtime-package'
import type {
  ProductReleaseManifestV1,
  TextOpenWorldCreatorReleaseArtifactReceiptV1,
  TextOpenWorldIntegrationReportV1,
  TextOpenWorldSourceManifestV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProductWorld } from './current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from './text-open-world-creator-build'
import { createTextOpenWorldProductRuntimePackageFixtureV1 } from './text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from './text-open-world-vnext-fixture'

const RECEIPT_POLICY_ID = 'storyforge.text-open-world-creator-release-quality.v1'

async function seedNovelSource() {
  const workspace = await createWorkspace({
    name: `Creator Release Novel ${crypto.randomUUID()}`,
    genres: ['fantasy'], status: 'drafting', description: '小说双来源发布夹具。',
    targetWordCount: 50_000, enableMultiWorld: false,
  }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  const now = Date.now() - 10_000
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(workspace.scope, 'outlineNodes', {
    projectId: workspace.scope.projectId, parentId: null, type: 'chapter',
    title: '第一章 盐渠断流', summary: '守渠人发现断流并踏上旅程。', order: 0,
    createdAt: now, updatedAt: now,
  } as never, { owner: 'work' })) as number
  await db.chapters.add(stampNewRecord(workspace.scope, 'chapters', {
    projectId: workspace.scope.projectId, outlineNodeId, title: '第一章 盐渠断流',
    content: '<p>守渠人在黎明发现盐渠断流，旧契约正在迫使两地作出选择。</p>',
    wordCount: 28, status: 'final', order: 0, notes: '', summary: '断流调查开始。',
    createdAt: now, updatedAt: now,
  } as never, { owner: 'work' }))
  await db.storyCores.add(stampNewRecord(workspace.scope, 'storyCores', {
    projectId: workspace.scope.projectId, theme: '成长与共同体',
    centralConflict: '两地必须在争夺和共管之间选择。', plotPattern: '调查—远行—抉择',
    logline: '守渠人追查断流真相。', concept: '小说改编为文字开放世界。',
    mainPlot: '逐区追查断流源头。', subPlots: '角色、势力与地域故事。',
    createdAt: now, updatedAt: now,
  } as never, { owner: 'work' }))
  return workspace
}

function sortedReceipts(rows: TextOpenWorldCreatorReleaseArtifactReceiptV1[]) {
  return rows.sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
}

export async function createTextOpenWorldCreatorReleaseFixtureV1(
  sourceKind: 'world-release' | 'novel' = 'world-release',
) {
  const sourceWorkspace = sourceKind === 'world-release'
    ? await seedCurrentProductWorld(`Creator Release World ${crypto.randomUUID()}`)
    : await seedNovelSource()
  const source = sourceKind === 'world-release'
      ? {
        kind: 'world-release' as const,
        scope: sourceWorkspace.scope,
        localReleaseRecordId: (sourceWorkspace as Awaited<ReturnType<typeof seedCurrentProductWorld>>).release.id!,
        expectedReleaseHash: (sourceWorkspace as Awaited<ReturnType<typeof seedCurrentProductWorld>>).release.contentHash,
      }
      : {
        kind: 'novel' as const,
        scope: sourceWorkspace.scope,
        selection: { mode: 'entire-work' as const },
      }
  const localWorldReleaseId = sourceKind === 'world-release' ? source.localReleaseRecordId : null
  const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source, sessionKey: `g5-10-${sourceKind}-${crypto.randomUUID()}`,
  })
  const frozenAt = creator.start.authorizedAt + 1
  const pinBundle = sourceKind === 'world-release'
    ? await freezeTextOpenWorldWorldReleaseSourceV1({
        scope: creator.scope,
        localReleaseRecordId: source.localReleaseRecordId,
        expectedReleaseHash: source.expectedReleaseHash,
        selection: { mode: 'entire-release' },
        authorization: creator.authorization,
        createdAt: frozenAt,
      })
    : await freezeTextOpenWorldNovelSourceV1({
        targetScope: creator.scope,
        sourceScope: source.scope,
        selection: source.selection,
        expectedSourceVersionHash: creator.sourcePlan.sourceVersionHash,
        expectedSourceBoundaryHash: creator.sourcePlan.expectedSourceBoundaryHash,
        authorization: creator.authorization,
        createdAt: frozenAt,
      })

  const manifestUnits = pinBundle.pin.units.map(unit => ({
    unitKey: unit.unitKey, artifactKey: unit.artifactKey, kind: unit.kind, label: unit.label,
    order: unit.order, sourceResourceKey: unit.sourceResourceKey,
    sourceContentHash: unit.sourceContentHash, frozenDepth: unit.readDepth,
    curationStatus: 'read' as const, curationDepth: 'full' as const,
    deliveredContentHash: unit.sourceContentHash,
    deliveryEvidenceHash: 'd'.repeat(64), modelBatchKey: `p1.batch.${unit.order + 1}`,
  }))
  const readRows = manifestUnits.map(unit => ({
    unitKey: unit.unitKey, sourceContentHash: unit.sourceContentHash,
    curationDepth: unit.curationDepth, deliveredContentHash: unit.deliveredContentHash,
    deliveryEvidenceHash: unit.deliveryEvidenceHash, modelBatchKey: unit.modelBatchKey,
  }))
  const sourceManifestBody: Omit<TextOpenWorldSourceManifestV1, 'manifestHash'> = {
    schema: 'storyforge.text-open-world-source-manifest', version: 1,
    productType: 'text-open-world', productInstanceKey: creator.productionKey,
    sourceKind, sourcePinHash: pinBundle.pin.pinHash,
    sourceBoundaryHash: pinBundle.pin.sourceBoundaryHash, units: manifestUnits,
    readUnitCount: manifestUnits.length, unreadUnitCount: 0,
    readSetHash: await hashProductProductionValueV2(readRows), createdAt: frozenAt + 1,
  }
  const sourceManifest: TextOpenWorldSourceManifestV1 = {
    ...sourceManifestBody,
    manifestHash: await hashProductProductionValueV2(sourceManifestBody),
  }

  const inner = createTextOpenWorldVNextFixture()
  inner.metadata.packageKey = creator.productionKey
  inner.metadata.title = creator.brief.draft.gameTitle
  inner.sourceManifest = {
    kind: sourceKind === 'world-release' ? 'world-release' : 'novel-source-pin',
    sourceKey: `source.${sourceKind}.${pinBundle.pin.sourceVersionHash.slice(0, 16)}`,
    sourceVersion: pinBundle.pin.source.kind === 'world-release'
      ? pinBundle.pin.source.releaseVersion : pinBundle.pin.source.snapshotVersion,
    contentHash: pinBundle.pin.sourceVersionHash,
    selectionHash: pinBundle.pin.sourceBoundaryHash,
    resourceHashes: pinBundle.pin.units.map(unit => ({
      resourceId: unit.sourceResourceKey ?? unit.unitKey,
      contentHash: unit.sourceContentHash,
    })),
  }
  const candidate = createTextOpenWorldProductRuntimePackageFixtureV1(inner)
  candidate.definition.productKey = creator.productionKey
  candidate.definition.title = creator.brief.draft.gameTitle
  candidate.sourceWorld = {
    contentHash: creator.sourcePlan.sourceVersionHash,
    selection: {
      ...candidate.sourceWorld.selection,
      worldReferenceHash: creator.sourcePlan.sourceBindingHash,
    },
  }
  const runtimePackage = parseProductRuntimePackageV1(candidate)
  const runtimePackageHash = await hashProductProductionValueV2(runtimePackage)
  const moduleRows = Object.entries(inner.modules).map(([moduleKey, module]) => ({
    moduleKey: moduleKey as keyof typeof inner.modules,
    schemaVersion: module.schemaVersion, contentHash: module.contentHash,
    sourceArtifactKeys: [`text-open-world.${moduleKey}`], parsed: true as const,
  }))
  const mediaSlots = (inner.modules.presentation.payload as { mediaSlots: unknown[] }).mediaSlots
  const mediaBody = {
    qualityProfile: 'prototype' as const, slotCount: mediaSlots.length,
    requiredSlotCount: inner.mediaManifest.requiredSlotKeys.length,
    requiredGeneratedSlotCount: 0, generatedBindingCount: 0,
    generatedRequiredBindingCount: 0, fallbackReadyCount: mediaSlots.length,
    playableCoverage: 1, generatedRequiredCoverage: 1, evaluatedCoverage: 1,
    minimumCoverage: 0, releaseReady: true,
  }
  const rightsBody = {
    evaluatedArtifactCount: 0, evidence: [], complete: true as const,
    commercialPolicyPassed: true,
  }
  const reportHashes = {
    systemConfigsHash: '1'.repeat(64), deterministicPreflightHash: '2'.repeat(64),
    balanceReviewHash: '3'.repeat(64), semanticReviewHash: '4'.repeat(64),
  }
  const coverageEvidenceHash = await hashProductProductionValueV2(mediaBody)
  const rightsEvidenceHash = await hashProductProductionValueV2(rightsBody)
  const basisHash = await hashProductProductionValueV2({
    runtimePackageHash, sourcePinHash: pinBundle.pin.pinHash, ...reportHashes,
    coverageEvidenceHash, rightsEvidenceHash,
  })
  const reportBody: Omit<TextOpenWorldIntegrationReportV1, 'integrationReportHash'> = {
    schema: 'storyforge.text-open-world-integration-report', version: 1,
    productType: 'text-open-world', productInstanceKey: creator.productionKey,
    runtimePackageHash, sourcePinHash: pinBundle.pin.pinHash, ...reportHashes,
    modules: moduleRows,
    generatedBindings: { endingActionKeys: [], generatedMediaArtifactKeys: [], fallbackMediaSlotKeys: [] },
    verification: {
      productPackageParsed: true, allModulesParsed: true, initialProjectionCreated: true,
      mainlineHasStart: true, endingActionsReachable: true, sourceProvenanceClosed: true,
      rightsEvidenceClosed: true, mediaCoveragePolicyEvaluated: true,
    },
    media: { ...mediaBody, coverageEvidenceHash },
    rights: { ...rightsBody, rightsEvidenceHash },
    governance: {
      compilerOnly: true, acceptedArtifactsNeverMutated: true,
      runtimeStateSessionOwned: true, productReleaseOwned: true,
    },
    basisHash, createdAt: frozenAt + 2,
  }
  const integrationReport: TextOpenWorldIntegrationReportV1 = {
    ...reportBody,
    integrationReportHash: await hashProductProductionValueV2(reportBody),
  }

  const qualityReportHash = '5'.repeat(64)
  const buildBinding = {
    productionKey: creator.productionKey, buildNumber: creator.buildNumber,
    packageHash: runtimePackageHash, previewHash: '6'.repeat(64), manifestHash: '7'.repeat(64),
    qualityReportHash, rootTerminalReceiptHash: '8'.repeat(64),
  }
  const completedAt = frozenAt + 3
  const qualityEvidence: TextOpenWorldCreatorReleaseQualityEvidenceV1 = {
    schema: 'storyforge.text-open-world-creator-release-quality-evidence', version: 1,
    build: buildBinding, hardGateReceiptHash: '9'.repeat(64),
    semanticDecisionReceiptHash: 'a'.repeat(64), grayboxReceiptHash: 'b'.repeat(64),
    issueReceiptHashes: [], issueWaiverReceiptHashes: [], issueSetHash: 'c'.repeat(64),
    status: 'passed', completedAt,
  }
  const qualityReceiptBody = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.creator-release-quality-join', verifierVersion: '1',
    verifierKind: 'deterministic' as const,
    inputHashes: [runtimePackageHash, buildBinding.previewHash, qualityEvidence.hardGateReceiptHash,
      qualityEvidence.semanticDecisionReceiptHash, qualityEvidence.grayboxReceiptHash, qualityEvidence.issueSetHash],
    environmentHash: null, measuredJson: canonicalProductProductionJsonV2(qualityEvidence),
    status: 'passed' as const, thresholdProfileId: RECEIPT_POLICY_ID,
    thresholdProfileVersion: '1',
    evidenceRefs: [qualityEvidence.hardGateReceiptHash, qualityEvidence.semanticDecisionReceiptHash,
      qualityEvidence.grayboxReceiptHash], createdAt: completedAt,
  }
  const releaseQuality = {
    rowId: 1, gateId: TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1,
    status: 'passed' as const, receiptHash: await hashProductProductionValueV2(qualityReceiptBody),
    evidence: qualityEvidence, createdAt: completedAt,
  }
  const artifactReceipts = sortedReceipts([
    { artifactKey: 'text-open-world.source-pin', version: 1, contentHash: pinBundle.pin.pinHash, producerReceiptHash: 'd'.repeat(64) },
    { artifactKey: 'text-open-world.source-manifest', version: 1, contentHash: sourceManifest.manifestHash, producerReceiptHash: 'e'.repeat(64) },
    { artifactKey: 'text-open-world.integration-report', version: 1, contentHash: integrationReport.integrationReportHash, producerReceiptHash: 'f'.repeat(64) },
    { artifactKey: 'text-open-world.runtime-package', version: 1, contentHash: runtimePackageHash, producerReceiptHash: '0'.repeat(64) },
    { artifactKey: 'text-open-world.quality-report', version: 1, contentHash: qualityReportHash, producerReceiptHash: '1'.repeat(64) },
    ...pinBundle.pin.units.map((unit, index) => ({
      artifactKey: unit.artifactKey, version: 1, contentHash: unit.artifactContentHash,
      producerReceiptHash: String((index + 2) % 10).repeat(64),
    })),
  ])
  const adoptionIntentHash = 'e'.repeat(64)
  const releaseAuthorization = await createTextOpenWorldCreatorReleaseAuthorizationV1({
    productInstanceKey: creator.productionKey, buildNumber: creator.buildNumber,
    adoptionIntentHash, buildManifestHash: buildBinding.manifestHash,
    runtimePackageHash, releaseQualityReceiptHash: releaseQuality.receiptHash,
    releaseLabel: `${creator.brief.draft.gameTitle} v1`,
    acknowledgement: {
      sourceAndRightsReviewed: true, buildAndQualityReviewed: true,
      immutableReleaseReviewed: true, publishNow: true,
    },
    authorizationNonce: `release-${sourceKind}-${crypto.randomUUID()}`,
    authorizedAt: completedAt + 1,
  })
  const governanceSnapshotHash = 'f'.repeat(64)
  const sourceContracts = await createTextOpenWorldCreatorReleaseSourceContractsV1({
    creatorBrief: creator.brief, sourcePlan: creator.sourcePlan, creatorStart: creator.start,
    sourcePin: pinBundle.pin, sourceManifest, artifactReceipts, integrationReport,
    governanceSnapshotHash, releaseQuality, releaseAuthorization, runtimePackage,
  })
  const productionProvenance = {
    productionKey: creator.productionKey, buildNumber: creator.buildNumber,
    buildManifestHash: buildBinding.manifestHash,
    rootTerminalReceiptHash: buildBinding.rootTerminalReceiptHash,
  }
  const identityBody: Omit<ProductReleaseManifestV1, 'releaseIdentityHash' | 'lineage'> = {
    schema: 'storyforge.product-release', version: 1, productType: 'text-open-world',
    sourceWorldRelease: { contentHash: creator.sourcePlan.sourceVersionHash },
    runtimePackage, packageHash: runtimePackageHash, productionProvenance, sourceContracts,
  }
  const releaseIdentityHash = await productReleaseIdentityHashV1(identityBody)
  const releaseUid = `PR-text-open-world-${encodeURIComponent(creator.productionKey)}-v1-${releaseIdentityHash.slice(0, 24)}`
  const lineage = await createTextOpenWorldCreatorReleaseLineageV1({
    sourceContracts, releaseUid, releaseVersion: 1, releaseHash: releaseIdentityHash,
    parentRelease: null,
    build: { buildUid: `GB-${encodeURIComponent(creator.productionKey)}-b1-${buildBinding.manifestHash.slice(0, 24)}`, buildHash: buildBinding.manifestHash },
    qualityReceiptHashes: [buildBinding.rootTerminalReceiptHash, releaseQuality.receiptHash],
    compatibility: { status: 'initial', protocolVersion: 1, evidenceHashes: ['2'.repeat(64)] },
    createdAt: completedAt + 2,
  })
  const manifest = await verifyProductReleaseManifestV1({
    ...identityBody, releaseIdentityHash, lineage,
  })
  return {
    scope: creator.scope as WorkspaceScope, creator, pinBundle, sourceManifest,
    runtimePackage, integrationReport, releaseQuality, releaseAuthorization,
    sourceContracts, manifest, sourceWorkspace, localWorldReleaseId, adoptionIntentHash,
  }
}
