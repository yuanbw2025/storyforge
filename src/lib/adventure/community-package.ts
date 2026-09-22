import { db } from '../db/schema'
import type {
  ProductBuildManifestV1,
  ProductBuildQualityReportV1,
  ProductProductionBriefV3,
  ProductRelease,
  ProductRuntimePackageV1,
  WorkspaceScope,
} from '../types'
import { analyzeTextAdventureRouteQualityV1 } from './quality-analysis'
import {
  parseTextAdventureAutoplayReportV1,
  type TextAdventureAutoplayReportV1,
} from './autoplay'
import {
  exportProductDistributionBundleV2,
  importLocalProductDistributionV2,
  verifyProductDistributionBundleV2,
  type ProductDistributionBundleV2,
} from '../product-platform/distribution-bundle'
import {
  parseProductBuildManifestV1,
  parseProductBuildQualityReportV1,
} from '../product-production/adoption'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import {
  PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1,
  PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1,
  PRODUCT_MEDIA_RUNTIME_GATE_ID_V1,
  TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1,
  TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1,
  requirePassedProductBrowserPerformanceGateV1,
  requirePassedProductBuildMainRouteGateV1,
  requirePassedProductMediaRuntimeGateV1,
  requirePassedTextAdventureHumanPlaytestGateV1,
  requirePassedTextAdventureHumanVisualReviewGateV1,
  verifyPortableProductQualityGateReceiptV1,
  type ProductQualityGateReceiptV1,
  type ProductMainRoutePlaythroughEvidenceV1,
  type TextAdventureHumanPlaytestCoverageEvidenceV1,
} from '../product-production/quality-receipts'
import {
  parseTextAdventureMediaAuditArtifactV1,
  parseTextAdventureVisualQualityReviewArtifactV1,
} from '../product-production/production-executor'
import { assertProductReleaseUnchanged } from '../product/releases'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import { evaluateProductRuntimeProductQualityV1 } from '../product-production/product-quality'
import { assertRecordInScope, resolveScope } from '../workspace/scope'

export const TEXT_ADVENTURE_COMMUNITY_PACKAGE_SCHEMA_V1 = 'storyforge.text-adventure-community-package' as const
export const TEXT_ADVENTURE_COMMUNITY_SUBMISSION_SCHEMA_V1 = 'storyforge.text-adventure-community-submission' as const
export const TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_EXTENSION_V1 = '.storyforge-adventure.json'
export const MAXIMUM_TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_BYTES_V1 = 350 * 1024 * 1024

const REQUIRED_RECOMMENDATION_GATES = [
  'product.adventure.recommendation-analysis-complete',
  'product.adventure.recommendation-route-volume',
  'product.adventure.recommendation-total-volume',
  'product.adventure.recommendation-dialogue-and-cast',
  'product.adventure.recommendation-decisions',
  'product.adventure.recommendation-main-quest',
  'product.adventure.recommendation-endings',
  'product.adventure.recommendation-copy',
] as const

const BASE_EVIDENCE_ARTIFACT_KEYS = ['quality.autoplay'] as const
const MEDIA_EVIDENCE_ARTIFACT_KEYS = [
  'media.requirements', 'media.visual-bible', 'media.audit', 'quality.visual-review',
] as const

export interface TextAdventureCandidateArtifactV1 {
  artifactKey: string
  contentHash: string
  payload: unknown
}

export interface TextAdventureCommunityCandidateDossierV1 {
  schema: 'storyforge.text-adventure-community-candidate-dossier'
  version: 1
  status: 'eligible-for-community-submission'
  title: string
  releaseContentHash: string
  releaseIdentityHash: string
  runtimePackageHash: string
  distributionBundleHash: string
  sourceWorldHash: string
  buildNumber: number
  metrics: {
    routeCount: number
    reachableEndingCount: number
    minimumRouteTextUnits: number
    maximumRouteTextUnits: number
    totalPlayableTextUnits: number
    estimatedMinimumRouteMinutes: number
    minimumRouteDialogueTurns: number
    minimumRouteNarrativeChoices: number
    minimumRouteStatefulDecisions: number
    authoredNpcCount: number
    talkActionCount: number
    mainQuestStageCount: number
    mainQuestObjectiveCount: number
    minimumMainProgressActions: number
  }
  systems: {
    regions: number
    areas: number
    locations: number
    scenes: number
    mainQuests: number
    sideQuests: number
    storylets: number
    items: number
    equipmentItems: number
    abilities: number
    resources: number
    mediaAssets: number
  }
  evidence: {
    buildManifestHash: string
    qualityReportHash: string
    autoplayArtifactHash: string
    gateReceiptHashes: string[]
    mediaAuditHash: string | null
    visualReviewHash: string | null
    authorMainRouteEndingKey: string
    authorMainRouteChoiceCount: number
    humanPlaytest: {
      author: {
        participantLabel: string
        endingKey: string
        elapsedMs: number
        choiceCount: number
        actionCount: number
        meaningfulActionCount: number
        dialogueActionCount: number
        ratings: TextAdventureHumanPlaytestCoverageEvidenceV1['sessions'][number]['assessment']['ratings']
      }
      independentPlayer: {
        participantLabel: string
        endingKey: string
        elapsedMs: number
        choiceCount: number
        actionCount: number
        meaningfulActionCount: number
        dialogueActionCount: number
        ratings: TextAdventureHumanPlaytestCoverageEvidenceV1['sessions'][number]['assessment']['ratings']
      }
    }
  }
  offlineFallback: 'text-only'
}

export interface TextAdventureCommunityPackageV1 {
  schema: typeof TEXT_ADVENTURE_COMMUNITY_PACKAGE_SCHEMA_V1
  version: 1
  distributionBundle: ProductDistributionBundleV2
  dossier: TextAdventureCommunityCandidateDossierV1
  evidence: {
    previewHash: string
    brief: ProductProductionBriefV3
    buildManifest: ProductBuildManifestV1
    qualityReport: ProductBuildQualityReportV1
    artifacts: TextAdventureCandidateArtifactV1[]
    gateReceipts: ProductQualityGateReceiptV1[]
  }
  candidatePackageHash: string
}

/**
 * Network handoff for the hosted review service. The distribution bundle is
 * carried once beside this envelope; the server reconstructs and verifies the
 * complete community package instead of trusting the client dossier.
 */
export interface TextAdventureCommunitySubmissionV1 {
  schema: typeof TEXT_ADVENTURE_COMMUNITY_SUBMISSION_SCHEMA_V1
  version: 1
  dossier: TextAdventureCommunityCandidateDossierV1
  evidence: TextAdventureCommunityPackageV1['evidence']
  candidateHash: string
}

function fail(message: string): never {
  throw new Error(`[text-adventure-community-package] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
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

function dossierText(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function dossierNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${label} 无效`)
  return value
}

/** Strict public parser used by both the local package and remote review UI. */
export function parseTextAdventureCommunityCandidateDossierV1(
  value: unknown,
): TextAdventureCommunityCandidateDossierV1 {
  const row = record(value, 'dossier')
  exactKeys(row, [
    'schema', 'version', 'status', 'title', 'releaseContentHash', 'releaseIdentityHash',
    'runtimePackageHash', 'distributionBundleHash', 'sourceWorldHash', 'buildNumber',
    'metrics', 'systems', 'evidence', 'offlineFallback',
  ], 'dossier')
  if (row.schema !== 'storyforge.text-adventure-community-candidate-dossier'
    || row.version !== 1 || row.status !== 'eligible-for-community-submission'
    || row.offlineFallback !== 'text-only') fail('dossier schema/version/status 无效')
  for (const [key, candidate] of Object.entries({
    releaseContentHash: row.releaseContentHash,
    releaseIdentityHash: row.releaseIdentityHash,
    runtimePackageHash: row.runtimePackageHash,
    distributionBundleHash: row.distributionBundleHash,
    sourceWorldHash: row.sourceWorldHash,
  })) if (!isSha256Hash(candidate)) fail(`dossier.${key} 不是 sha256`)
  if (!Number.isInteger(row.buildNumber) || Number(row.buildNumber) < 1) fail('dossier.buildNumber 无效')

  const metrics = record(row.metrics, 'dossier.metrics')
  const metricKeys = [
    'routeCount', 'reachableEndingCount', 'minimumRouteTextUnits', 'maximumRouteTextUnits',
    'totalPlayableTextUnits', 'estimatedMinimumRouteMinutes', 'minimumRouteDialogueTurns',
    'minimumRouteNarrativeChoices', 'minimumRouteStatefulDecisions', 'authoredNpcCount',
    'talkActionCount', 'mainQuestStageCount', 'mainQuestObjectiveCount', 'minimumMainProgressActions',
  ] as const
  exactKeys(metrics, metricKeys, 'dossier.metrics')
  for (const key of metricKeys) dossierNumber(metrics[key], `dossier.metrics.${key}`)
  const systems = record(row.systems, 'dossier.systems')
  const systemKeys = [
    'regions', 'areas', 'locations', 'scenes', 'mainQuests', 'sideQuests', 'storylets',
    'items', 'equipmentItems', 'abilities', 'resources', 'mediaAssets',
  ] as const
  exactKeys(systems, systemKeys, 'dossier.systems')
  for (const key of systemKeys) {
    if (!Number.isInteger(systems[key])) fail(`dossier.systems.${key} 无效`)
    dossierNumber(systems[key], `dossier.systems.${key}`)
  }

  const evidence = record(row.evidence, 'dossier.evidence')
  exactKeys(evidence, [
    'buildManifestHash', 'qualityReportHash', 'autoplayArtifactHash', 'gateReceiptHashes',
    'mediaAuditHash', 'visualReviewHash', 'authorMainRouteEndingKey',
    'authorMainRouteChoiceCount', 'humanPlaytest',
  ], 'dossier.evidence')
  for (const key of ['buildManifestHash', 'qualityReportHash', 'autoplayArtifactHash'] as const) {
    if (!isSha256Hash(evidence[key])) fail(`dossier.evidence.${key} 不是 sha256`)
  }
  if (!Array.isArray(evidence.gateReceiptHashes) || evidence.gateReceiptHashes.length > 16
    || evidence.gateReceiptHashes.length === 0
    || evidence.gateReceiptHashes.some(item => !isSha256Hash(item))
    || new Set(evidence.gateReceiptHashes).size !== evidence.gateReceiptHashes.length) {
    fail('dossier.evidence.gateReceiptHashes 无效')
  }
  for (const key of ['mediaAuditHash', 'visualReviewHash'] as const) {
    if (evidence[key] != null && !isSha256Hash(evidence[key])) fail(`dossier.evidence.${key} 不是 sha256/null`)
  }
  dossierText(evidence.authorMainRouteEndingKey, 'dossier.evidence.authorMainRouteEndingKey', 200)
  if (!Number.isInteger(evidence.authorMainRouteChoiceCount)
    || Number(evidence.authorMainRouteChoiceCount) < 0) fail('dossier.evidence.authorMainRouteChoiceCount 无效')
  const humanPlaytest = record(evidence.humanPlaytest, 'dossier.evidence.humanPlaytest')
  exactKeys(humanPlaytest, ['author', 'independentPlayer'], 'dossier.evidence.humanPlaytest')
  for (const role of ['author', 'independentPlayer'] as const) {
    const participant = record(humanPlaytest[role], `dossier.evidence.humanPlaytest.${role}`)
    exactKeys(participant, [
      'participantLabel', 'endingKey', 'elapsedMs', 'choiceCount', 'actionCount',
      'meaningfulActionCount', 'dialogueActionCount', 'ratings',
    ], `dossier.evidence.humanPlaytest.${role}`)
    dossierText(participant.participantLabel, `${role}.participantLabel`, 200)
    dossierText(participant.endingKey, `${role}.endingKey`, 200)
    for (const key of ['elapsedMs', 'choiceCount', 'actionCount', 'meaningfulActionCount', 'dialogueActionCount'] as const) {
      if (!Number.isInteger(participant[key])) fail(`${role}.${key} 无效`)
      dossierNumber(participant[key], `${role}.${key}`)
    }
    const ratings = record(participant.ratings, `${role}.ratings`)
    exactKeys(ratings, ['comprehension', 'pacing', 'agency', 'emotionalImpact'], `${role}.ratings`)
    for (const key of ['comprehension', 'pacing', 'agency', 'emotionalImpact']) {
      if (!Number.isInteger(ratings[key]) || Number(ratings[key]) < 1 || Number(ratings[key]) > 5) fail(`${role}.ratings.${key} 无效`)
    }
  }
  dossierText(row.title, 'dossier.title', 300)
  return structuredClone(row) as unknown as TextAdventureCommunityCandidateDossierV1
}

function safeArtifactKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) fail(`${label} 无效`)
  return value
}

function runtimeMetrics(runtimePackage: ProductRuntimePackageV1) {
  if (runtimePackage.productType !== 'text-adventure' || runtimePackage.adventure?.version !== 2) {
    fail('候选包只接受 Adventure V2 文字冒险')
  }
  const route = analyzeTextAdventureRouteQualityV1(runtimePackage)
  if (route.truncated || route.routes.length === 0 || route.copyIssues.length > 0) {
    fail('路线分析不完整或玩家文案仍含阻断问题')
  }
  const adventure = runtimePackage.adventure
  return {
    route,
    metrics: {
      routeCount: route.routes.length,
      reachableEndingCount: route.reachableEndingKeys.length,
      minimumRouteTextUnits: route.minimumRouteTextUnits,
      maximumRouteTextUnits: route.maximumRouteTextUnits,
      totalPlayableTextUnits: route.totalPlayableTextUnits,
      estimatedMinimumRouteMinutes: route.estimatedMinimumRouteMinutes,
      minimumRouteDialogueTurns: route.minimumRouteDialogueTurns,
      minimumRouteNarrativeChoices: route.minimumRouteNarrativeChoices,
      minimumRouteStatefulDecisions: route.minimumRouteStatefulDecisions,
      authoredNpcCount: route.authoredNpcCount,
      talkActionCount: route.talkActionCount,
      mainQuestStageCount: route.mainQuestStageCount,
      mainQuestObjectiveCount: route.mainQuestObjectiveCount,
      minimumMainProgressActions: route.minimumMainProgressActions,
    },
    systems: {
      regions: adventure.regions.length,
      areas: adventure.areas.length,
      locations: adventure.locations.length,
      scenes: adventure.scenes.length,
      mainQuests: adventure.quests.filter(quest => quest.category === 'main').length,
      sideQuests: adventure.quests.filter(quest => quest.category === 'side').length,
      storylets: adventure.storylets.length,
      items: adventure.items.length,
      equipmentItems: adventure.items.filter(item => item.category === 'equipment').length,
      abilities: adventure.abilities.length,
      resources: adventure.resources.length,
      mediaAssets: runtimePackage.presentation?.assets.length ?? 0,
    },
  }
}

function verifiedArtifactSnapshots(input: {
  value: unknown
  buildManifest: ProductBuildManifestV1
  mediaRequired: boolean
}): TextAdventureCandidateArtifactV1[] {
  if (!Array.isArray(input.value) || input.value.length > 20) fail('evidence.artifacts 必须是有界数组')
  const snapshots = input.value.map((value, index) => {
    const row = record(value, `evidence.artifacts[${index}]`)
    exactKeys(row, ['artifactKey', 'contentHash', 'payload'], `evidence.artifacts[${index}]`)
    const artifactKey = safeArtifactKey(row.artifactKey, `evidence.artifacts[${index}].artifactKey`)
    if (!isSha256Hash(row.contentHash)) fail(`evidence.artifacts[${index}].contentHash 无效`)
    return { artifactKey, contentHash: row.contentHash, payload: row.payload }
  }).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
  const expectedKeys = [...BASE_EVIDENCE_ARTIFACT_KEYS, ...(input.mediaRequired ? MEDIA_EVIDENCE_ARTIFACT_KEYS : [])].sort()
  if (new Set(snapshots.map(item => item.artifactKey)).size !== snapshots.length
    || canonicalProductProductionJsonV2(snapshots.map(item => item.artifactKey)) !== canonicalProductProductionJsonV2(expectedKeys)) {
    fail('候选证据 Artifact 不重不漏合同失败')
  }
  const frozen = new Map(input.buildManifest.artifactReceipts.map(item => [item.artifactKey, item.contentHash]))
  return snapshots.map(snapshot => {
    if (frozen.get(snapshot.artifactKey) !== snapshot.contentHash) fail(`Artifact 未被 Build manifest 冻结:${snapshot.artifactKey}`)
    return snapshot
  })
}

async function verifyEvidence(input: {
  raw: unknown
  bundle: ProductDistributionBundleV2
}): Promise<{
  evidence: TextAdventureCommunityPackageV1['evidence']
  autoplay: TextAdventureAutoplayReportV1
  mainRoute: ProductMainRoutePlaythroughEvidenceV1
  humanPlaytest: TextAdventureHumanPlaytestCoverageEvidenceV1
}> {
  const raw = record(input.raw, 'evidence')
  exactKeys(raw, ['previewHash', 'brief', 'buildManifest', 'qualityReport', 'artifacts', 'gateReceipts'], 'evidence')
  if (!isSha256Hash(raw.previewHash)) fail('Preview hash 无效')
  const manifest = input.bundle.productRelease.manifest
  const brief = parseProductProductionBriefV3(canonicalProductProductionJsonV2(raw.brief))
  const briefHash = await hashProductProductionValueV2(brief)
  if (brief.intent.productType !== 'text-adventure' || brief.qualityProfile !== 'commercial-candidate') {
    fail('候选包必须携带商业候选文字冒险 Brief')
  }
  const buildManifest = parseProductBuildManifestV1(canonicalProductProductionJsonV2(raw.buildManifest))
  const buildManifestHash = await hashProductProductionValueV2(buildManifest)
  if (buildManifestHash !== manifest.productionProvenance.buildManifestHash
    || buildManifestHash !== manifest.lineage.build.buildHash
    || buildManifest.buildNumber !== manifest.productionProvenance.buildNumber
    || buildManifest.runtimePackageHash !== manifest.packageHash
    || buildManifest.briefHash !== briefHash) fail('Build manifest 与 Release/Brief 不一致')
  const qualityReport = parseProductBuildQualityReportV1(canonicalProductProductionJsonV2(raw.qualityReport))
  const qualityReportHash = await hashProductProductionValueV2(qualityReport)
  if (qualityReport.buildNumber !== buildManifest.buildNumber || qualityReport.packageHash !== manifest.packageHash
    || !qualityReport.playable || !qualityReport.releaseReady
    || qualityReport.hardGateResults.some(gate => !gate.passed)
    || !manifest.lineage.quality.receiptHashes.includes(qualityReportHash)) fail('质量报告未通过或未进入 Release lineage')
  const hardGateIds = qualityReport.hardGateResults.map(gate => gate.gateId)
  if (new Set(hardGateIds).size !== hardGateIds.length
    || REQUIRED_RECOMMENDATION_GATES.some(gate => !hardGateIds.includes(gate))) {
    fail('质量报告未完整覆盖文字冒险推荐硬门')
  }
  const recalculatedProductQuality = evaluateProductRuntimeProductQualityV1({
    runtimePackage: manifest.runtimePackage,
    brief,
  })
  const reportedHardGates = new Map(qualityReport.hardGateResults.map(gate => [gate.gateId, gate]))
  if (!recalculatedProductQuality.passed || recalculatedProductQuality.gates.some(gate => {
    const reported = reportedHardGates.get(gate.gateId)
    return !reported || canonicalProductProductionJsonV2(reported) !== canonicalProductProductionJsonV2(gate)
  })) {
    fail('冻结 RuntimePackage 重新计算后未通过原始 Brief 的商业质量门')
  }
  const mediaRequired = (manifest.runtimePackage.presentation?.assets.length ?? 0) > 0
  const artifacts = verifiedArtifactSnapshots({ value: raw.artifacts, buildManifest, mediaRequired })
  for (const artifact of artifacts) {
    if (await hashProductProductionValueV2(artifact.payload) !== artifact.contentHash) fail(`Artifact 内容哈希不一致:${artifact.artifactKey}`)
  }
  const artifactByKey = new Map(artifacts.map(item => [item.artifactKey, item]))
  const qualityArtifact = buildManifest.artifactReceipts.find(item => item.artifactKey === 'quality.report')
  if (qualityArtifact?.contentHash !== qualityReportHash) fail('质量报告未被 Build Artifact receipt 冻结')
  const autoplayArtifact = artifactByKey.get('quality.autoplay')!
  const autoplay = parseTextAdventureAutoplayReportV1(autoplayArtifact.payload, {
    buildNumber: buildManifest.buildNumber, packageHash: manifest.packageHash,
  })
  const calculated = runtimeMetrics(manifest.runtimePackage)
  if (!autoplay.passed || autoplay.cases.some(item => !item.passed)
    || autoplay.routeSummary.enumeratedRouteCount !== calculated.route.routes.length
    || autoplay.routeSummary.minimumRouteTextUnits !== calculated.route.minimumRouteTextUnits
    || autoplay.routeSummary.estimatedMinimumRouteMinutes !== calculated.route.estimatedMinimumRouteMinutes
    || canonicalProductProductionJsonV2(autoplay.routeSummary.reachableEndingKeys)
      !== canonicalProductProductionJsonV2(calculated.route.reachableEndingKeys)) {
    fail('自动游玩报告与冻结 RuntimePackage 路线不一致')
  }

  let humanVisual: Parameters<typeof verifyPortableProductQualityGateReceiptV1>[0]['binding']['humanVisual']
  if (mediaRequired) {
    const requirements = artifactByKey.get('media.requirements')!
    const visualBible = artifactByKey.get('media.visual-bible')!
    const auditArtifact = artifactByKey.get('media.audit')!
    const audit = parseTextAdventureMediaAuditArtifactV1(auditArtifact.payload, {
      buildNumber: buildManifest.buildNumber,
      requirementsHash: requirements.contentHash,
      visualBibleHash: visualBible.contentHash,
      artifactKeys: (() => {
        const payload = record(requirements.payload, 'media.requirements')
        if (!Array.isArray(payload.visual)) fail('media.requirements.visual 无效')
        return payload.visual.map((item, index) => safeArtifactKey(record(item, `visual[${index}]`).artifactKey, `visual[${index}].artifactKey`))
      })(),
    })
    const visualReviewArtifact = artifactByKey.get('quality.visual-review')!
    const visualReview = parseTextAdventureVisualQualityReviewArtifactV1(visualReviewArtifact.payload, {
      buildNumber: buildManifest.buildNumber,
      mediaAuditHash: auditArtifact.contentHash,
      assets: audit.assets.map(asset => ({ artifactKey: asset.artifactKey, contentHash: asset.contentHash })),
    })
    if (!audit.passed || visualReview.status !== 'passed' || !visualReview.providerReviewCompleted) {
      fail('媒资审计或独立 Visual QA 未通过')
    }
    const runtimeByKey = new Map((manifest.runtimePackage.presentation?.assets ?? []).map(asset => [asset.assetKey, asset]))
    const fulfilled = audit.assets.filter(asset => asset.status === 'fulfilled')
    if (fulfilled.length !== runtimeByKey.size) fail('media.audit 与 RuntimePackage 媒资数量不一致')
    humanVisual = {
      mediaAuditHash: auditArtifact.contentHash,
      visualReviewHash: visualReviewArtifact.contentHash,
      assets: fulfilled.map(asset => {
        const runtime = asset.assetKey ? runtimeByKey.get(asset.assetKey) : null
        if (!runtime || runtime.contentHash !== asset.contentHash || runtime.blobContentHash !== asset.contentHash
          || runtime.mimeType !== asset.mimeType) fail(`media.audit 与 RuntimePackage 绑定不一致:${asset.artifactKey}`)
        return {
          assetKey: runtime.assetKey, artifactKey: asset.artifactKey,
          contentHash: runtime.contentHash, blobContentHash: runtime.blobContentHash,
          mimeType: runtime.mimeType, byteSize: runtime.byteSize,
        }
      }).sort((left, right) => left.assetKey.localeCompare(right.assetKey)),
    }
  }

  if (!Array.isArray(raw.gateReceipts) || raw.gateReceipts.length > 8) fail('gateReceipts 必须是有界数组')
  const expectedGateIds = [
    PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1,
    PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1,
    TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1,
    ...(mediaRequired ? [PRODUCT_MEDIA_RUNTIME_GATE_ID_V1, TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1] : []),
  ].sort()
  const verifiedGates = await Promise.all(raw.gateReceipts.map(receipt => verifyPortableProductQualityGateReceiptV1({
    receipt,
    binding: {
      buildNumber: buildManifest.buildNumber, packageHash: manifest.packageHash,
      previewHash: raw.previewHash as string, briefHash,
      targetPlayMinutes: Math.round(brief.scale.targetPlayMinutes), humanVisual,
    },
  })))
  verifiedGates.sort((left, right) => left.gateReceipt.gateId.localeCompare(right.gateReceipt.gateId))
  const gateIds = verifiedGates.map(item => item.gateReceipt.gateId)
  if (new Set(gateIds).size !== gateIds.length
    || canonicalProductProductionJsonV2(gateIds) !== canonicalProductProductionJsonV2(expectedGateIds)
    || verifiedGates.some(item => !manifest.lineage.quality.receiptHashes.includes(item.gateReceipt.receiptHash))) {
    fail('候选包 gate receipt 未不重不漏进入 Release lineage')
  }
  const mainRoute = verifiedGates.find(item => item.gateReceipt.gateId === PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1)
    ?.evidence as ProductMainRoutePlaythroughEvidenceV1 | undefined
  if (!mainRoute?.endingKey) fail('候选包缺少可复验的作者主路线结局')
  let currentNodeKey = manifest.runtimePackage.narrative.entryNodeKey
  if (mainRoute.routeEvents[0].nodeKey !== currentNodeKey) fail('作者主路线起点与冻结 RuntimePackage 不一致')
  for (const event of mainRoute.routeEvents.slice(1, -1)) {
    const choice = manifest.runtimePackage.narrative.choices.find(item => item.choiceKey === event.choiceKey)
    if (!choice || event.fromNodeKey !== currentNodeKey || choice.sourceNodeKey !== currentNodeKey
      || event.toNodeKey !== choice.targetNodeKey) {
      fail(`作者主路线 Choice 与冻结 RuntimePackage 不一致:${event.choiceKey ?? 'missing'}`)
    }
    currentNodeKey = choice.targetNodeKey
  }
  const endingNode = manifest.runtimePackage.narrative.nodes.find(node => node.key === mainRoute.endingKey)
  if (currentNodeKey !== mainRoute.endingKey || endingNode?.kind !== 'ending') {
    fail('作者主路线结局不是冻结 RuntimePackage 的可达结局')
  }
  const humanPlaytest = verifiedGates.find(item => item.gateReceipt.gateId === TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1)
    ?.evidence as TextAdventureHumanPlaytestCoverageEvidenceV1 | undefined
  if (!humanPlaytest?.passed || !humanPlaytest.authorSessionEvidenceHash
    || !humanPlaytest.independentPlayerSessionEvidenceHash) fail('候选包缺少作者与独立玩家双角色真人试玩覆盖')
  const narrative = manifest.runtimePackage.narrative
  const adventureActions = new Map(manifest.runtimePackage.adventure!.actions.map(action => [action.key, action]))
  for (const session of humanPlaytest.sessions) {
    let sessionNodeKey = narrative.entryNodeKey
    if (session.routeEvents[0].nodeKey !== sessionNodeKey) fail(`真人试玩起点与冻结 RuntimePackage 不一致:${session.participantRole}`)
    for (const event of session.routeEvents.slice(1, -1)) {
      const choice = narrative.choices.find(item => item.choiceKey === event.choiceKey)
      if (!choice || event.fromNodeKey !== sessionNodeKey || choice.sourceNodeKey !== sessionNodeKey
        || event.toNodeKey !== choice.targetNodeKey) fail(`真人试玩 Choice 不属于冻结 RuntimePackage:${event.choiceKey ?? 'missing'}`)
      sessionNodeKey = choice.targetNodeKey
    }
    const sessionEnding = narrative.nodes.find(node => node.key === session.endingKey)
    if (sessionNodeKey !== session.endingKey || sessionEnding?.kind !== 'ending') {
      fail(`真人试玩结局不是冻结 RuntimePackage 结局:${session.participantRole}`)
    }
    for (const actionEvent of session.actionEvents) {
      const action = adventureActions.get(actionEvent.actionKey)
      if (!action || action.kind !== actionEvent.kind) fail(`真人试玩行动不属于冻结 RuntimePackage:${actionEvent.actionKey}`)
    }
  }
  return {
    evidence: {
      previewHash: raw.previewHash as string,
      brief,
      buildManifest,
      qualityReport,
      artifacts,
      gateReceipts: verifiedGates.map(item => item.gateReceipt),
    },
    autoplay,
    mainRoute,
    humanPlaytest,
  }
}

function createDossier(input: {
  bundle: ProductDistributionBundleV2
  evidence: TextAdventureCommunityPackageV1['evidence']
  mainRoute: ProductMainRoutePlaythroughEvidenceV1
  humanPlaytest: TextAdventureHumanPlaytestCoverageEvidenceV1
}): TextAdventureCommunityCandidateDossierV1 {
  const manifest = input.bundle.productRelease.manifest
  const calculated = runtimeMetrics(manifest.runtimePackage)
  const artifacts = new Map(input.evidence.artifacts.map(item => [item.artifactKey, item.contentHash]))
  const authorSession = input.humanPlaytest.sessions.find(item =>
    item.sessionEvidenceHash === input.humanPlaytest.authorSessionEvidenceHash)!
  const independentSession = input.humanPlaytest.sessions.find(item =>
    item.sessionEvidenceHash === input.humanPlaytest.independentPlayerSessionEvidenceHash)!
  const publicPlaytestProjection = (session: TextAdventureHumanPlaytestCoverageEvidenceV1['sessions'][number]) => ({
    participantLabel: session.participant.label,
    endingKey: session.endingKey,
    elapsedMs: session.elapsedMs,
    choiceCount: session.choiceCount,
    actionCount: session.actionCount,
    meaningfulActionCount: session.meaningfulActionCount,
    dialogueActionCount: session.dialogueActionCount,
    ratings: session.assessment.ratings,
  })
  return {
    schema: 'storyforge.text-adventure-community-candidate-dossier', version: 1,
    status: 'eligible-for-community-submission',
    title: manifest.runtimePackage.definition.title,
    releaseContentHash: input.bundle.productRelease.contentHash,
    releaseIdentityHash: manifest.releaseIdentityHash,
    runtimePackageHash: manifest.packageHash,
    distributionBundleHash: input.bundle.bundleHash,
    sourceWorldHash: manifest.sourceWorldRelease.contentHash,
    buildNumber: manifest.productionProvenance.buildNumber,
    metrics: calculated.metrics,
    systems: calculated.systems,
    evidence: {
      buildManifestHash: manifest.productionProvenance.buildManifestHash,
      qualityReportHash: input.evidence.buildManifest.artifactReceipts
        .find(item => item.artifactKey === 'quality.report')?.contentHash ?? fail('质量报告缺失'),
      autoplayArtifactHash: artifacts.get('quality.autoplay')!,
      gateReceiptHashes: input.evidence.gateReceipts.map(receipt => receipt.receiptHash).sort(),
      mediaAuditHash: artifacts.get('media.audit') ?? null,
      visualReviewHash: artifacts.get('quality.visual-review') ?? null,
      authorMainRouteEndingKey: input.mainRoute.endingKey,
      authorMainRouteChoiceCount: input.mainRoute.choiceCount,
      humanPlaytest: {
        author: publicPlaytestProjection(authorSession),
        independentPlayer: publicPlaytestProjection(independentSession),
      },
    },
    offlineFallback: 'text-only',
  }
}

export async function verifyTextAdventureCommunityPackageV1(value: unknown): Promise<TextAdventureCommunityPackageV1> {
  const raw = record(value, 'package')
  exactKeys(raw, ['schema', 'version', 'distributionBundle', 'dossier', 'evidence', 'candidatePackageHash'], 'package')
  if (raw.schema !== TEXT_ADVENTURE_COMMUNITY_PACKAGE_SCHEMA_V1 || raw.version !== 1
    || !isSha256Hash(raw.candidatePackageHash)) fail('候选包 schema/version/hash 无效')
  const distributionBundle = await verifyProductDistributionBundleV2(raw.distributionBundle)
  const manifest = distributionBundle.productRelease.manifest
  const sourceManifest = manifest.sourceContracts.sourceManifest
  if (manifest.productType !== 'text-adventure' || manifest.runtimePackage.adventure?.version !== 2
    || manifest.lineage.quality.passed !== true
    || !('summary' in sourceManifest)
    || sourceManifest.summary.conflict !== 0
    || sourceManifest.summary.insufficient !== 0) {
    fail('Release 不是来源充分且质量通过的 Adventure V2')
  }
  const verified = await verifyEvidence({ raw: raw.evidence, bundle: distributionBundle })
  const dossier = createDossier({
    bundle: distributionBundle, evidence: verified.evidence,
    mainRoute: verified.mainRoute, humanPlaytest: verified.humanPlaytest,
  })
  if (canonicalProductProductionJsonV2(raw.dossier) !== canonicalProductProductionJsonV2(dossier)) {
    fail('候选档案不是由冻结证据确定性派生')
  }
  const body = {
    schema: TEXT_ADVENTURE_COMMUNITY_PACKAGE_SCHEMA_V1,
    version: 1 as const,
    distributionBundle,
    dossier,
    evidence: verified.evidence,
  }
  if (await hashProductProductionValueV2(body) !== raw.candidatePackageHash) fail('candidatePackageHash 不一致')
  return { ...body, candidatePackageHash: raw.candidatePackageHash }
}

export function createTextAdventureCommunitySubmissionV1(
  value: TextAdventureCommunityPackageV1,
): TextAdventureCommunitySubmissionV1 {
  return {
    schema: TEXT_ADVENTURE_COMMUNITY_SUBMISSION_SCHEMA_V1,
    version: 1,
    dossier: structuredClone(value.dossier),
    evidence: structuredClone(value.evidence),
    candidateHash: value.candidatePackageHash,
  }
}

export async function verifyTextAdventureCommunitySubmissionV1(input: {
  submission: unknown
  distributionBundle: unknown
}): Promise<{ submission: TextAdventureCommunitySubmissionV1; package: TextAdventureCommunityPackageV1 }> {
  const raw = record(input.submission, 'submission')
  exactKeys(raw, ['schema', 'version', 'dossier', 'evidence', 'candidateHash'], 'submission')
  if (raw.schema !== TEXT_ADVENTURE_COMMUNITY_SUBMISSION_SCHEMA_V1
    || raw.version !== 1
    || !isSha256Hash(raw.candidateHash)) fail('远程候选交接 schema/version/hash 无效')
  const verified = await verifyTextAdventureCommunityPackageV1({
    schema: TEXT_ADVENTURE_COMMUNITY_PACKAGE_SCHEMA_V1,
    version: 1,
    distributionBundle: input.distributionBundle,
    dossier: raw.dossier,
    evidence: raw.evidence,
    candidatePackageHash: raw.candidateHash,
  })
  return {
    submission: createTextAdventureCommunitySubmissionV1(verified),
    package: verified,
  }
}

export async function createTextAdventureCommunityPackageV1(input: {
  distributionBundle: unknown
  evidence: TextAdventureCommunityPackageV1['evidence']
}): Promise<TextAdventureCommunityPackageV1> {
  const distributionBundle = await verifyProductDistributionBundleV2(input.distributionBundle)
  const verified = await verifyEvidence({ raw: input.evidence, bundle: distributionBundle })
  const dossier = createDossier({
    bundle: distributionBundle, evidence: verified.evidence,
    mainRoute: verified.mainRoute, humanPlaytest: verified.humanPlaytest,
  })
  const body = {
    schema: TEXT_ADVENTURE_COMMUNITY_PACKAGE_SCHEMA_V1,
    version: 1 as const,
    distributionBundle,
    dossier,
    evidence: verified.evidence,
  }
  return verifyTextAdventureCommunityPackageV1({
    ...body,
    candidatePackageHash: await hashProductProductionValueV2(body),
  })
}

export async function exportTextAdventureCommunityPackageV1(input: {
  scope: WorkspaceScope
  productReleaseId: number
}): Promise<TextAdventureCommunityPackageV1> {
  const scope = await resolveScope({ scope: input.scope })
  const release = await db.productReleases.get(input.productReleaseId)
  if (!release || !await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
    fail('ProductRelease 不存在或跨 Work')
  }
  if (release.distributionProvenance) fail('导入副本不能直接冒充原创社区候选')
  await assertProductReleaseUnchanged(release.id!)
  const manifest = await verifyProductReleaseManifestV1(release.manifestJson)
  if (manifest.productType !== 'text-adventure') fail('所选 Release 不是文字冒险')
  const build = await db.productBuilds.where('releasedProductReleaseId').equals(release.id!).first()
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || build.status !== 'released' || build.buildNumber !== manifest.productionProvenance.buildNumber
    || build.manifestHash !== manifest.productionProvenance.buildManifestHash
    || build.packageHash !== manifest.packageHash) fail('Release 没有同一 Build/hash 的本地发布证据')
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefHash !== build.briefHash) fail('Release 的作者 Brief 不存在或不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (brief.intent.productType !== 'text-adventure' || brief.qualityProfile !== 'commercial-candidate') {
    fail('只有商业候选文字冒险 Release 可以生成社区候选包')
  }
  const buildManifest = parseProductBuildManifestV1(build.manifestJson)
  const qualityReport = parseProductBuildQualityReportV1(build.qualityReportJson)
  const runtimeMedia = manifest.runtimePackage.presentation?.assets ?? []
  const artifactKeys = [...BASE_EVIDENCE_ARTIFACT_KEYS, ...(runtimeMedia.length ? MEDIA_EVIDENCE_ARTIFACT_KEYS : [])]
  const artifactRows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  const artifacts = artifactKeys.map(artifactKey => {
    const matches = artifactRows.filter(row => row.artifactKey === artifactKey
      && ['accepted', 'carried-forward'].includes(row.status) && row.controlEpoch === build.controlEpoch)
    if (matches.length !== 1) fail(`候选包证据 Artifact 缺失或重复:${artifactKey}`)
    const row = matches[0]
    let payload: unknown
    try { payload = JSON.parse(row.payloadJson) } catch { fail(`候选包证据 Artifact JSON 损坏:${artifactKey}`) }
    return { artifactKey, contentHash: row.contentHash, payload }
  }).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
  const [performance, mainRoute, humanPlaytest, mediaRuntime, humanVisual] = await Promise.all([
    requirePassedProductBrowserPerformanceGateV1({ scope, productBuildId: build.id! }),
    requirePassedProductBuildMainRouteGateV1({ scope, productBuildId: build.id! }),
    requirePassedTextAdventureHumanPlaytestGateV1({ scope, productBuildId: build.id! }),
    runtimeMedia.length ? requirePassedProductMediaRuntimeGateV1({ scope, productBuildId: build.id! }) : Promise.resolve(null),
    runtimeMedia.length ? requirePassedTextAdventureHumanVisualReviewGateV1({ scope, productBuildId: build.id! }) : Promise.resolve(null),
  ])
  const distributionBundle = await exportProductDistributionBundleV2({ scope, productReleaseId: release.id! })
  const evidence: TextAdventureCommunityPackageV1['evidence'] = {
    previewHash: build.previewHash,
    brief,
    buildManifest,
    qualityReport,
    artifacts,
    gateReceipts: [performance.gateReceipt, mainRoute.gateReceipt, humanPlaytest.gateReceipt,
      ...(mediaRuntime ? [mediaRuntime.gateReceipt] : []),
      ...(humanVisual ? [humanVisual.gateReceipt] : []),
    ].sort((left, right) => left.gateId.localeCompare(right.gateId)),
  }
  return createTextAdventureCommunityPackageV1({ distributionBundle, evidence })
}

export async function importTextAdventureCommunityPackageV1(input: {
  scope: WorkspaceScope
  package: unknown
}): Promise<{ release: ProductRelease; package: TextAdventureCommunityPackageV1 }> {
  const verified = await verifyTextAdventureCommunityPackageV1(input.package)
  const release = await importLocalProductDistributionV2({
    scope: input.scope,
    bundle: verified.distributionBundle,
    provenance: {
      candidatePackageHash: verified.candidatePackageHash,
      originalReleaseHash: verified.distributionBundle.productRelease.contentHash,
      candidateStatus: verified.dossier.status,
    },
  })
  return { release, package: verified }
}

export function textAdventureCommunityPackageFileNameV1(input: {
  title: string
  releaseVersion: number
  candidatePackageHash: string
}): string {
  const title = input.title.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim()
    .slice(0, 80) || 'storyforge-text-adventure'
  return `${title}-v${Math.max(1, Math.trunc(input.releaseVersion))}-${input.candidatePackageHash.slice(0, 12)}${TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_EXTENSION_V1}`
}
