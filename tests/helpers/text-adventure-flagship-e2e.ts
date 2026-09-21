import { db } from '../../src/lib/db/schema'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionRecordV1,
  ProductProductionWorldSourceCatalogV2,
  ProductQualityGateReceiptRecordV1,
  ProductRelease,
  ProductRuntimePackageV1,
  WorkspaceScope,
  WorldRelease,
} from '../../src/lib/types'
import type { TextAdventureCommunityPackageV1 } from '../../src/lib/adventure/community-package'
import { createTextAdventureFoundationRuntimePackageV2 } from './text-adventure-v2-foundation'

/**
 * Materialises the already-verified portable candidate as an authored local
 * Production/Build/Release. This helper exists only so Playwright can exercise
 * the real package-panel download path; it never replaces production code.
 */
export async function seedAuthoredTextAdventureCandidateForExportV1(input: {
  scope: WorkspaceScope
  worldRelease: WorldRelease & { id: number }
  candidate: TextAdventureCommunityPackageV1
}) {
  const { scope, worldRelease, candidate } = input
  const now = Date.now()
  const { manifest } = candidate.distributionBundle.productRelease
  const { brief, buildManifest, qualityReport, artifacts, gateReceipts } = candidate.evidence
  const productionKey = manifest.productionProvenance?.productionKey ?? 'candidate.fixture'
  const briefHash = await hashProductProductionValueV2(brief)
  const buildManifestHash = await hashProductProductionValueV2(buildManifest)
  const qualityReportHash = await hashProductProductionValueV2(qualityReport)
  if (briefHash !== buildManifest.briefHash
    || buildManifestHash !== manifest.productionProvenance?.buildManifestHash
    || qualityReport.packageHash !== manifest.packageHash) {
    throw new Error('[text-adventure-flagship-e2e] 候选证据无法物化为同一 Build')
  }

  const production = stampNewRecord(scope, 'productProductions', {
    ...scope,
    productionKey,
    productType: 'text-adventure' as const,
    title: candidate.dossier.title,
    status: 'released' as const,
    stateRevision: 3,
    controlEpoch: buildManifest.controlEpoch,
    currentBriefRevision: 1,
    currentBuildNumber: buildManifest.buildNumber,
    currentProductReleaseId: null,
    lastErrorJson: '{}',
    createdAt: now,
    updatedAt: now,
  } satisfies ProductProductionRecordV1, { owner: 'work' })
  const productionId = await db.productProductions.add(production) as number
  const sourcePlan = { schema: 'storyforge.e2e-source-plan', version: 1, worldReleaseId: worldRelease.id }
  const confirmedBrief = { schema: 'storyforge.e2e-confirmed-brief', version: 1, briefHash }
  const briefRow = stampNewRecord(scope, 'productProductionBriefs', {
    ...scope,
    productionId,
    revision: 1,
    parentRevision: null,
    status: 'authorized' as const,
    sourceWorldReleaseId: worldRelease.id,
    sourceWorldContentHash: worldRelease.contentHash,
    userIntentSummary: brief.intent.openingSituation,
    unresolvedJson: canonicalProductProductionJsonV2(brief.unresolvedDecisionKeys),
    estimateJson: canonicalProductProductionJsonV2({ scale: brief.scale, media: brief.media }),
    briefJson: canonicalProductProductionJsonV2(brief),
    briefHash,
    sourcePlanJson: canonicalProductProductionJsonV2(sourcePlan),
    sourcePlanHash: await hashProductProductionValueV2(sourcePlan),
    confirmedBriefJson: canonicalProductProductionJsonV2(confirmedBrief),
    confirmedBriefHash: await hashProductProductionValueV2(confirmedBrief),
    authorizedAt: now,
    createdAt: now,
  } satisfies ProductProductionBriefRecordV1, { owner: 'work' })
  await db.productProductionBriefs.add(briefRow)

  const build = stampNewRecord(scope, 'productBuilds', {
    ...scope,
    productionId,
    buildNumber: buildManifest.buildNumber,
    briefRevision: 1,
    briefHash,
    parentBuildNumber: null,
    sourceProductReleaseId: null,
    status: 'released' as const,
    resumeState: null,
    stateRevision: 3,
    controlEpoch: buildManifest.controlEpoch,
    planRevision: 1,
    planJson: '{}',
    planHash: buildManifest.planHash,
    budgetLedgerJson: '{}',
    manifestJson: canonicalProductProductionJsonV2(buildManifest),
    manifestHash: buildManifestHash,
    packageHash: manifest.packageHash,
    previewManifestJson: '{}',
    previewHash: candidate.evidence.previewHash,
    qualityReportJson: canonicalProductProductionJsonV2(qualityReport),
    qualityReportHash,
    compatibilityJson: '{}',
    rootTerminalReceiptHash: manifest.productionProvenance?.rootTerminalReceiptHash ?? null,
    adoptionIntentHash: null,
    releasedProductReleaseId: null,
    failureJson: '{}',
    authorizedAt: now,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  } satisfies ProductBuildRecordV1, { owner: 'work' })
  const buildId = await db.productBuilds.add(build) as number

  for (const artifact of artifacts) {
    await db.productBuildArtifacts.add(stampNewRecord(scope, 'productBuildArtifacts', {
      ...scope,
      buildId,
      artifactKey: artifact.artifactKey,
      requirementKey: null,
      version: 1,
      kind: 'quality-report' as const,
      mediaKind: null,
      status: 'accepted' as const,
      producerRunId: null,
      producerReceiptHash: null,
      controlEpoch: buildManifest.controlEpoch,
      inputHash: briefHash,
      contentHash: artifact.contentHash,
      payloadJson: canonicalProductProductionJsonV2(artifact.payload),
      metadataJson: '{}',
      qualityJson: '{}',
      rightsJson: '{}',
      blobObjectId: null,
      mimeType: null,
      byteSize: 0,
      parentArtifactHash: null,
      carriedFrom: null,
      createdAt: now,
      updatedAt: now,
    } satisfies ProductBuildArtifactRecordV1, { owner: 'work' }))
  }
  for (const receipt of gateReceipts) {
    await db.productQualityGateReceipts.add(stampNewRecord(scope, 'productQualityGateReceipts', {
      ...scope,
      buildId,
      gateId: receipt.gateId,
      gateVersion: receipt.gateVersion,
      verifierId: receipt.verifierId,
      verifierVersion: receipt.verifierVersion,
      status: receipt.status,
      receiptJson: canonicalProductProductionJsonV2(receipt),
      receiptHash: receipt.receiptHash,
      createdAt: receipt.createdAt,
    } satisfies ProductQualityGateReceiptRecordV1, { owner: 'work' }))
  }

  const release = stampNewRecord(scope, 'productReleases', {
    ...scope,
    productionKey,
    productType: 'text-adventure' as const,
    worldReleaseId: worldRelease.id,
    version: manifest.lineage.releaseVersion,
    label: candidate.dossier.title,
    manifestJson: canonicalProductProductionJsonV2(manifest),
    contentHash: candidate.distributionBundle.productRelease.contentHash,
    createdAt: now,
  } satisfies ProductRelease, { owner: 'work' })
  const productReleaseId = await db.productReleases.add(release) as number
  await Promise.all([
    db.productBuilds.update(buildId, { releasedProductReleaseId: productReleaseId }),
    db.productProductions.update(productionId, { currentProductReleaseId: productReleaseId }),
  ])
  const project = await db.projects.get(scope.projectId)
  await db.projects.update(scope.projectId, {
    productPlatformOptIns: {
      ...(project?.productPlatformOptIns ?? {}),
      productProductionV3: true,
    },
  })
  return { productionId, buildId, productReleaseId, briefHash, buildManifestHash }
}

/** Browser-matrix package with a three-stage optional quest and repeatable
 * random/resource actions. It is a deterministic test product, not a public
 * community candidate. */
export function createTextAdventureBrowserMatrixRuntimePackageV2(input: {
  worldRelease: WorldRelease & { id: number }
  sourceCatalog: ProductProductionWorldSourceCatalogV2
}): ProductRuntimePackageV1 {
  const runtime = createTextAdventureFoundationRuntimePackageV2(input)
  const adventure = runtime.adventure!
  adventure.conditions.push(
    { key: 'condition.side-ledger-open', title: '潮账已展开', description: '支线潮账已在封港仓房展开。', tags: ['side-quest'] },
    { key: 'condition.side-signal-matched', title: '信号已比对', description: '封港仓房中的旧信号已经完成比对。', tags: ['side-quest'] },
  )
  adventure.quests.push({
    key: 'quest.side-signal-ledger',
    title: '封港仓房的失真潮账',
    description: '可在封港仓房选择接受并完成，也可完全跳过而不阻断主线。',
    initialStatus: 'available',
    prerequisites: [],
    category: 'side',
    stages: [
      { key: 'stage.side.accept', title: '接过潮账', objectiveKeys: ['objective.side.accept'] },
      { key: 'stage.side.compare', title: '比对信号', objectiveKeys: ['objective.side.compare'] },
      { key: 'stage.side.return', title: '留下结论', objectiveKeys: ['objective.side.return'] },
    ],
    objectives: [
      { key: 'objective.side.accept', title: '在封港仓房接过潮账', optional: false, stageKey: 'stage.side.accept', alternativeActionKeys: ['action.side.accept'] },
      { key: 'objective.side.compare', title: '在封港仓房比对失真信号', optional: false, stageKey: 'stage.side.compare', alternativeActionKeys: ['action.side.compare'] },
      { key: 'objective.side.return', title: '在封港仓房写下比对结论', optional: false, stageKey: 'stage.side.return', alternativeActionKeys: ['action.side.finish'] },
    ],
    rewardEffects: [
      { op: 'change-resource', resourceKey: 'resource.experience', delta: 5 },
      { op: 'change-resource', resourceKey: 'resource.coin', delta: 1 },
    ],
    completionNodeKey: null,
    failureNodeKey: null,
  })
  adventure.actions.push(
    {
      key: 'action.side.accept', kind: 'quest-action', label: '接下失真潮账',
      description: '在封港仓房接受可选支线。', locationKey: 'location.harbor', targetKey: 'object.chart',
      requirements: [{ questKey: 'quest.side-signal-ledger', questStatus: 'available' }], rule: { kind: 'automatic' },
      successEffects: [
        { op: 'accept-quest', questKey: 'quest.side-signal-ledger' },
        { op: 'complete-objective', questKey: 'quest.side-signal-ledger', objectiveKey: 'objective.side.accept' },
        { op: 'apply-condition', conditionKey: 'condition.side-ledger-open', duration: null },
      ],
      costlySuccessEffects: [], failureEffects: [], successText: '你在封港仓房接过潮账，支线开始。',
      costlySuccessText: '你迟疑后接过潮账。', failureText: '潮账没有交到你手中。',
      unavailableText: '这份潮账已处理或当前不可接受。', repeatable: false, narrativeChoiceKey: null, interaction: null,
    },
    {
      key: 'action.side.compare', kind: 'inspect', label: '比对潮账与信号',
      description: '在封港仓房完成支线第二阶段。', locationKey: 'location.harbor', targetKey: 'object.chart',
      requirements: [
        { questKey: 'quest.side-signal-ledger', questStatus: 'active' },
        { conditionKey: 'condition.side-ledger-open', conditionPresent: true },
      ], rule: { kind: 'automatic' },
      successEffects: [
        { op: 'complete-objective', questKey: 'quest.side-signal-ledger', objectiveKey: 'objective.side.compare' },
        { op: 'apply-condition', conditionKey: 'condition.side-signal-matched', duration: null },
      ],
      costlySuccessEffects: [], failureEffects: [], successText: '你在封港仓房找到了潮账与求救信号之间的错位。',
      costlySuccessText: '你勉强完成比对。', failureText: '比对没有得到结论。',
      unavailableText: '需要先接过潮账。', repeatable: false, narrativeChoiceKey: null, interaction: null,
    },
    {
      key: 'action.side.finish', kind: 'quest-action', label: '写下潮账结论',
      description: '在封港仓房完成支线第三阶段。', locationKey: 'location.harbor', targetKey: 'object.chart',
      requirements: [
        { questKey: 'quest.side-signal-ledger', questStatus: 'active' },
        { conditionKey: 'condition.side-signal-matched', conditionPresent: true },
      ], rule: { kind: 'automatic' },
      successEffects: [{ op: 'complete-objective', questKey: 'quest.side-signal-ledger', objectiveKey: 'objective.side.return' }],
      costlySuccessEffects: [], failureEffects: [], successText: '你在封港仓房留下结论，支线完成并结算奖励。',
      costlySuccessText: '你付出代价后交回结论。', failureText: '结论没有被记录。',
      unavailableText: '需要先完成信号比对。', repeatable: false, narrativeChoiceKey: null, interaction: null,
    },
    {
      key: 'action.random-watch', kind: 'inspect', label: '反复校验潮针',
      description: '用于浏览器长回合种子化随机压力测试。', locationKey: 'location.harbor', targetKey: 'object.chart',
      requirements: [], rule: { kind: 'random', abilityKey: 'ability.perception', expression: '1d6', difficulty: 6, costlySuccessFloor: 4 },
      successEffects: [], costlySuccessEffects: [], failureEffects: [], successText: '潮针与刻度完全重合。',
      costlySuccessText: '潮针短暂摇摆后停住。', failureText: '潮针仍在雾气里失真。', unavailableText: '当前无法校验潮针。',
      repeatable: true, narrativeChoiceKey: null, interaction: null,
    },
    {
      key: 'action.resource-edge', kind: 'rest', label: '维持封港绞盘',
      description: '每次支付一点体力；归零后给出确定性不可执行结果。', locationKey: 'location.harbor', targetKey: 'object.chart',
      requirements: [], rule: { kind: 'resource-payment', resourceKey: 'resource.stamina', amount: 1 },
      successEffects: [], costlySuccessEffects: [], failureEffects: [], successText: '你支付体力，让绞盘多维持了一轮。',
      costlySuccessText: '绞盘勉强维持。', failureText: '绞盘停止。', unavailableText: '体力不足，无法继续维持绞盘。',
      repeatable: true, narrativeChoiceKey: null, interaction: null,
    },
  )
  adventure.scenes.find(scene => scene.key === 'scene.harbor')!.actionKeys.push(
    'action.side.accept', 'action.side.compare', 'action.side.finish', 'action.random-watch', 'action.resource-edge',
  )
  adventure.storylets.push({
    key: 'storylet.side-signal-ledger', title: '封港仓房的失真潮账',
    actionKeys: ['action.side.accept', 'action.side.compare', 'action.side.finish'], requirements: [], once: false, priority: 15,
  })
  return parseProductRuntimePackageV1(runtime)
}
