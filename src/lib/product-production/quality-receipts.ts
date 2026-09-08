import { db } from '../db/schema'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductQualityGateReceiptRecordV1,
  ProductQualityGateReceiptStatusV1,
  ProductRuntimeEvent,
  ProductRuntimeKind,
  WorkspaceScope,
} from '../types'
import { PRODUCT_RUNTIME_KINDS } from '../types'
import { readProductRuntimeState } from '../product/runtime-api'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import {
  createProductBrowserPerformanceReceiptV1,
  PRODUCT_BROWSER_PERFORMANCE_POLICY_V1,
  type ProductBrowserPerformanceMeasurementV1,
  type ProductBrowserPerformanceReceiptV1,
} from './browser-performance'
import { parseProductProductionBriefV3 } from './contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import { verifyProductBuildPreviewManifestV1 } from './preview-manifest'
import {
  evaluateProductMediaCommercialPolicyV2,
  PRODUCT_COMMERCIAL_MEDIA_POLICY_V2,
} from './media-quality-policy'
import { readMediaBlobObjectData } from './media-blob-store'

export const PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1 = 'browser.performance.desktop'
export const PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1 = 'playthrough.main-route'
export const PRODUCT_MAIN_ROUTE_PLAYTHROUGH_POLICY_ID_V1 = 'storyforge.product-main-route-playthrough.v1'
export const TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1 = 'text-adventure.playtest.human-coverage'
export const TEXT_ADVENTURE_HUMAN_PLAYTEST_POLICY_ID_V1 = 'storyforge.text-adventure-human-playtest.v1'
export const PRODUCT_MEDIA_RUNTIME_GATE_ID_V1 = 'media.runtime.decode'
export const PRODUCT_MEDIA_RUNTIME_POLICY_ID_V1 = 'storyforge.product-media-runtime.v2'
export const TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1 = 'text-adventure.visual.author-approval'
export const TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_POLICY_ID_V1 = 'storyforge.text-adventure-human-visual-review.v1'

export interface ProductQualityGateReceiptV1 {
  schema: 'storyforge.product-quality-gate-receipt'
  version: 1
  gateId: string
  gateVersion: string
  verifierId: string
  verifierVersion: string
  verifierKind: 'deterministic' | 'browser-runtime' | 'provider-review' | 'human-evidence'
  inputHashes: string[]
  environmentHash: string | null
  measuredJson: string
  status: ProductQualityGateReceiptStatusV1
  thresholdProfileId: string
  thresholdProfileVersion: string
  evidenceRefs: string[]
  receiptHash: string
  createdAt: number
}

export interface ProductBrowserPerformanceEvidenceV1 {
  schema: 'storyforge.product-browser-performance-evidence'
  version: 1
  measurement: ProductBrowserPerformanceMeasurementV1
  receipt: ProductBrowserPerformanceReceiptV1
}

export interface VerifiedProductBrowserPerformanceGateV1 {
  row: ProductQualityGateReceiptRecordV1
  gateReceipt: ProductQualityGateReceiptV1
  evidence: ProductBrowserPerformanceEvidenceV1
}

export interface ProductPlaythroughBrowserEnvironmentV1 {
  browserName: string
  browserVersion: string
  platform: string
  viewport: { width: number; height: number }
}

export interface ProductMainRouteEventEvidenceV1 {
  kind: 'started' | 'choice' | 'ending'
  sequence: number
  nodeKey: string | null
  fromNodeKey: string | null
  choiceKey: string | null
  toNodeKey: string | null
  endingKey: string | null
  payloadHash: string
  createdAt: number
}

export interface ProductMainRoutePlaythroughEvidenceV1 {
  schema: 'storyforge.product-main-route-playthrough-evidence'
  version: 1
  packageHash: string
  previewHash: string
  runtimeSourceHash: string
  sessionKind: ProductRuntimeKind
  routeEvents: ProductMainRouteEventEvidenceV1[]
  eventStreamHash: string
  choiceCount: number
  endingKey: string
  environment: ProductPlaythroughBrowserEnvironmentV1
  confirmation: { kind: 'author-confirmed-main-route'; confirmedAt: number }
}

export interface VerifiedProductMainRoutePlaythroughGateV1 {
  row: ProductQualityGateReceiptRecordV1
  gateReceipt: ProductQualityGateReceiptV1
  evidence: ProductMainRoutePlaythroughEvidenceV1
}

export type TextAdventureHumanPlaytestParticipantRoleV1 = 'author' | 'independent-player'

export interface TextAdventureHumanPlaytestActionEvidenceV1 {
  sequence: number
  commandId: string
  actionKey: string
  kind: 'look' | 'move' | 'talk' | 'take' | 'give' | 'use' | 'inspect' | 'attempt' | 'rest' | 'quest-action'
  outcome: 'success' | 'costly-success' | 'failure' | 'not-attempted'
  payloadHash: string
  createdAt: number
}

export interface TextAdventureHumanPlaytestAssessmentV1 {
  ratings: {
    comprehension: number
    pacing: number
    agency: number
    emotionalImpact: number
  }
  blockingIssues: string[]
  feedback: {
    comprehensionObstacles: string
    boringMoments: string
    errors: string
    choiceExperience: string
    endingFeedback: string
  }
  note: string
}

export interface TextAdventureHumanPlaytestSessionEvidenceV1 {
  participantRole: TextAdventureHumanPlaytestParticipantRoleV1
  participant: {
    label: string
    declaration: 'author-self-attestation' | 'not-involved-in-production'
  }
  sessionKind: 'text-adventure'
  routeEvents: ProductMainRouteEventEvidenceV1[]
  actionEvents: TextAdventureHumanPlaytestActionEvidenceV1[]
  eventStreamHash: string
  endingKey: string
  startedAt: number
  completedAt: number
  elapsedMs: number
  choiceCount: number
  actionCount: number
  meaningfulActionCount: number
  dialogueActionCount: number
  thresholds: {
    targetPlayMinutes: number
    minimumElapsedMs: number
    maximumElapsedMs: number
    minimumChoiceCount: number
    minimumActionCount: number
  }
  environment: ProductPlaythroughBrowserEnvironmentV1
  assessment: TextAdventureHumanPlaytestAssessmentV1
  confirmedAt: number
  passed: boolean
  sessionEvidenceHash: string
}

export interface TextAdventureHumanPlaytestCoverageEvidenceV1 {
  schema: 'storyforge.text-adventure-human-playtest-coverage-evidence'
  version: 1
  buildNumber: number
  packageHash: string
  previewHash: string
  briefHash: string
  sessions: TextAdventureHumanPlaytestSessionEvidenceV1[]
  authorSessionEvidenceHash: string | null
  independentPlayerSessionEvidenceHash: string | null
  passed: boolean
}

export interface VerifiedTextAdventureHumanPlaytestGateV1 {
  row: ProductQualityGateReceiptRecordV1
  gateReceipt: ProductQualityGateReceiptV1
  evidence: TextAdventureHumanPlaytestCoverageEvidenceV1
}

export interface ProductMediaRuntimeAssetEvidenceV1 {
  assetKey: string
  contentHash: string
  mimeType: string
  mediaClass: 'image' | 'audio' | 'unsupported'
  status: 'decoded' | 'failed'
  decodedWidth: number | null
  decodedHeight: number | null
  decodedDurationMs: number | null
  decodedHasAlpha: boolean | null
  decodedChannelCount: number | null
  decodedSampleRateHz: number | null
  integratedLufs: number | null
  truePeakDbtp: number | null
  loopSeamDbfs: number | null
  policyFailures: string[]
  failureCode: string | null
}

export interface ProductMediaRuntimeMeasurementV1 {
  assets: ProductMediaRuntimeAssetEvidenceV1[]
  environment: ProductPlaythroughBrowserEnvironmentV1
  measuredAt: number
}

export interface ProductMediaRuntimeEvidenceV1 extends ProductMediaRuntimeMeasurementV1 {
  schema: 'storyforge.product-media-runtime-evidence'
  version: 2
  packageHash: string
  previewHash: string
  briefHash: string
  qualityProfile: 'prototype' | 'internal' | 'commercial-candidate'
  passed: boolean
}

export interface VerifiedProductMediaRuntimeGateV1 {
  row: ProductQualityGateReceiptRecordV1
  gateReceipt: ProductQualityGateReceiptV1
  evidence: ProductMediaRuntimeEvidenceV1
}

export interface TextAdventureHumanVisualDecisionV1 {
  assetKey: string
  decision: 'approved' | 'rejected'
  note: string
}

export interface TextAdventureHumanVisualReviewEvidenceV1 {
  schema: 'storyforge.text-adventure-human-visual-review-evidence'
  version: 1
  buildNumber: number
  packageHash: string
  previewHash: string
  briefHash: string
  mediaAuditHash: string
  visualReviewHash: string
  assets: Array<{
    assetKey: string
    artifactKey: string
    contentHash: string
    blobContentHash: string
    mimeType: string
    decision: 'approved' | 'rejected'
    note: string
  }>
  confirmedAt: number
  passed: boolean
}

export interface VerifiedTextAdventureHumanVisualReviewGateV1 {
  row: ProductQualityGateReceiptRecordV1
  gateReceipt: ProductQualityGateReceiptV1
  evidence: TextAdventureHumanVisualReviewEvidenceV1
}

export interface CompletedProductBuildPlaythroughV1 {
  sessionId: number
  sessionKind: ProductRuntimeKind
  endingKey: string
  choiceCount: number
  actionCount: number
  meaningfulActionCount: number
  dialogueActionCount: number
  startedAt: number
  completedAt: number
  elapsedMs: number
  eventStreamHash: string
}

export interface PortableProductQualityGateBindingV1 {
  buildNumber: number
  packageHash: string
  previewHash: string
  briefHash: string
  targetPlayMinutes: number
  humanVisual?: {
    mediaAuditHash: string
    visualReviewHash: string
    assets: Array<{
      assetKey: string
      artifactKey: string
      contentHash: string
      blobContentHash: string
      mimeType: string
      byteSize: number
    }>
  }
}

export interface VerifiedPortableProductQualityGateV1 {
  gateReceipt: ProductQualityGateReceiptV1
  evidence: ProductBrowserPerformanceEvidenceV1
    | ProductMainRoutePlaythroughEvidenceV1
    | TextAdventureHumanPlaytestCoverageEvidenceV1
    | ProductMediaRuntimeEvidenceV1
    | TextAdventureHumanVisualReviewEvidenceV1
}

function fail(message: string): never {
  throw new Error(`[product-quality-receipt] ${message}`)
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

function boundedText(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function hashArray(value: unknown, label: string, maximum = 100): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 无效`)
  const hashes = value.map(item => {
    if (typeof item !== 'string' || !isSha256Hash(item)) fail(`${label} 含无效 hash`)
    return item
  })
  if (new Set(hashes).size !== hashes.length) fail(`${label} 不能重复`)
  return hashes
}

function textArray(value: unknown, label: string, maximum = 100): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 无效`)
  const values = value.map(item => boundedText(item, label, 2_000))
  if (new Set(values).size !== values.length) fail(`${label} 不能重复`)
  return values
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) fail(`${label} 无效`)
  return Number(value)
}

function nullableStableText(value: unknown, label: string): string | null {
  return value == null ? null : boundedText(value, label, 500)
}

function optionalBoundedText(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string' || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 无效`)
  return Number(value)
}

function parsePlaythroughEnvironment(value: unknown): ProductPlaythroughBrowserEnvironmentV1 {
  const row = record(value, 'playthrough.environment')
  exactKeys(row, ['browserName', 'browserVersion', 'platform', 'viewport'], 'playthrough.environment')
  const viewport = record(row.viewport, 'playthrough.environment.viewport')
  exactKeys(viewport, ['width', 'height'], 'playthrough.environment.viewport')
  return {
    browserName: boundedText(row.browserName, 'browserName', 200),
    browserVersion: boundedText(row.browserVersion, 'browserVersion', 500),
    platform: boundedText(row.platform, 'platform', 200),
    viewport: {
      width: positiveInteger(viewport.width, 'viewport.width'),
      height: positiveInteger(viewport.height, 'viewport.height'),
    },
  }
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  if (value == null) return null
  return positiveInteger(value, label)
}

function nullableFiniteNumber(value: unknown, label: string): number | null {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) fail(`${label} 无效`)
  return value
}

function parseMediaRuntimeEvidence(value: string | unknown): ProductMediaRuntimeEvidenceV1 {
  let raw: unknown = value
  if (typeof value === 'string') {
    try { raw = JSON.parse(value) } catch { fail('媒资运行 measuredJson 不是合法 JSON') }
  }
  const row = record(raw, 'media runtime evidence')
  exactKeys(row, [
    'schema', 'version', 'packageHash', 'previewHash', 'briefHash', 'qualityProfile',
    'assets', 'environment', 'measuredAt', 'passed',
  ], 'media runtime evidence')
  if (row.schema !== 'storyforge.product-media-runtime-evidence' || row.version !== 2
    || !isSha256Hash(row.packageHash) || !isSha256Hash(row.previewHash) || !isSha256Hash(row.briefHash)
    || !['prototype', 'internal', 'commercial-candidate'].includes(String(row.qualityProfile))
    || !Array.isArray(row.assets) || row.assets.length < 1 || row.assets.length > 10_000
    || typeof row.passed !== 'boolean') fail('媒资运行 evidence 基础字段无效')
  const assets: ProductMediaRuntimeAssetEvidenceV1[] = row.assets.map((value, index) => {
    const item = record(value, `media.assets[${index}]`)
    exactKeys(item, [
      'assetKey', 'contentHash', 'mimeType', 'mediaClass', 'status', 'decodedWidth',
      'decodedHeight', 'decodedDurationMs', 'decodedHasAlpha', 'decodedChannelCount',
      'decodedSampleRateHz', 'integratedLufs', 'truePeakDbtp', 'loopSeamDbfs',
      'policyFailures', 'failureCode',
    ], `media.assets[${index}]`)
    if (!isSha256Hash(item.contentHash)
      || !['image', 'audio', 'unsupported'].includes(String(item.mediaClass))
      || !['decoded', 'failed'].includes(String(item.status))) fail(`media.assets[${index}] 基础字段无效`)
    const mediaClass = item.mediaClass as ProductMediaRuntimeAssetEvidenceV1['mediaClass']
    const status = item.status as ProductMediaRuntimeAssetEvidenceV1['status']
    const decodedWidth = nullablePositiveInteger(item.decodedWidth, `media.assets[${index}].decodedWidth`)
    const decodedHeight = nullablePositiveInteger(item.decodedHeight, `media.assets[${index}].decodedHeight`)
    const decodedDurationMs = nullablePositiveInteger(item.decodedDurationMs, `media.assets[${index}].decodedDurationMs`)
    const decodedHasAlpha = item.decodedHasAlpha == null ? null : item.decodedHasAlpha
    if (decodedHasAlpha != null && typeof decodedHasAlpha !== 'boolean') fail(`media.assets[${index}].decodedHasAlpha 无效`)
    const decodedChannelCount = nullablePositiveInteger(item.decodedChannelCount, `media.assets[${index}].decodedChannelCount`)
    const decodedSampleRateHz = nullablePositiveInteger(item.decodedSampleRateHz, `media.assets[${index}].decodedSampleRateHz`)
    const integratedLufs = nullableFiniteNumber(item.integratedLufs, `media.assets[${index}].integratedLufs`)
    const truePeakDbtp = nullableFiniteNumber(item.truePeakDbtp, `media.assets[${index}].truePeakDbtp`)
    const loopSeamDbfs = nullableFiniteNumber(item.loopSeamDbfs, `media.assets[${index}].loopSeamDbfs`)
    const policyFailures = textArray(item.policyFailures, `media.assets[${index}].policyFailures`, 30).sort()
    const failureCode = item.failureCode == null ? null : boundedText(item.failureCode, `media.assets[${index}].failureCode`, 100)
    if (status === 'decoded' && (failureCode != null
      || mediaClass === 'unsupported'
      || mediaClass === 'image' && (decodedWidth == null || decodedHeight == null || decodedDurationMs != null
        || decodedHasAlpha == null || decodedChannelCount != null || decodedSampleRateHz != null
        || integratedLufs != null || truePeakDbtp != null || loopSeamDbfs != null)
      || mediaClass === 'audio' && (decodedDurationMs == null || decodedWidth != null || decodedHeight != null
        || decodedHasAlpha != null || decodedChannelCount == null || decodedSampleRateHz == null
        || integratedLufs == null || truePeakDbtp == null || loopSeamDbfs == null))) {
      fail(`media.assets[${index}] decoded 证据不闭合`)
    }
    if (status === 'failed' && (!failureCode || policyFailures.length > 0
      || decodedWidth != null || decodedHeight != null || decodedDurationMs != null || decodedHasAlpha != null
      || decodedChannelCount != null || decodedSampleRateHz != null || integratedLufs != null
      || truePeakDbtp != null || loopSeamDbfs != null)) {
      fail(`media.assets[${index}] failed 证据不闭合`)
    }
    return {
      assetKey: boundedText(item.assetKey, `media.assets[${index}].assetKey`, 500),
      contentHash: item.contentHash,
      mimeType: boundedText(item.mimeType, `media.assets[${index}].mimeType`, 200).toLowerCase(),
      mediaClass, status, decodedWidth, decodedHeight, decodedDurationMs, decodedHasAlpha,
      decodedChannelCount, decodedSampleRateHz, integratedLufs, truePeakDbtp, loopSeamDbfs,
      policyFailures, failureCode,
    }
  })
  if (new Set(assets.map(asset => asset.assetKey)).size !== assets.length
    || [...assets].sort((left, right) => left.assetKey.localeCompare(right.assetKey))
      .some((asset, index) => asset.assetKey !== assets[index].assetKey)) fail('媒资运行 evidence 必须按唯一 assetKey 排序')
  const passed = assets.every(asset => asset.status === 'decoded' && asset.policyFailures.length === 0)
  if (row.passed !== passed) fail('媒资运行 evidence passed 与逐项结果不一致')
  return {
    schema: 'storyforge.product-media-runtime-evidence', version: 2,
    packageHash: row.packageHash, previewHash: row.previewHash, briefHash: row.briefHash,
    qualityProfile: row.qualityProfile as ProductMediaRuntimeEvidenceV1['qualityProfile'],
    assets, environment: parsePlaythroughEnvironment(row.environment),
    measuredAt: positiveInteger(row.measuredAt, 'media.measuredAt'), passed,
  }
}

export function parseTextAdventureHumanVisualReviewEvidenceV1(
  value: string | unknown,
): TextAdventureHumanVisualReviewEvidenceV1 {
  let raw: unknown = value
  if (typeof value === 'string') {
    try { raw = JSON.parse(value) } catch { fail('文字冒险人工审图 measuredJson 不是合法 JSON') }
  }
  const row = record(raw, 'text adventure human visual review evidence')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'packageHash', 'previewHash', 'briefHash',
    'mediaAuditHash', 'visualReviewHash', 'assets', 'confirmedAt', 'passed',
  ], 'text adventure human visual review evidence')
  if (row.schema !== 'storyforge.text-adventure-human-visual-review-evidence' || row.version !== 1
    || !isSha256Hash(row.packageHash) || !isSha256Hash(row.previewHash) || !isSha256Hash(row.briefHash)
    || !isSha256Hash(row.mediaAuditHash) || !isSha256Hash(row.visualReviewHash)
    || !Array.isArray(row.assets) || row.assets.length < 1 || row.assets.length > 200
    || typeof row.passed !== 'boolean') fail('文字冒险人工审图 evidence 基础字段无效')
  const assets: TextAdventureHumanVisualReviewEvidenceV1['assets'] = row.assets.map((value, index) => {
    const item = record(value, `humanVisual.assets[${index}]`)
    exactKeys(item, [
      'assetKey', 'artifactKey', 'contentHash', 'blobContentHash', 'mimeType', 'decision', 'note',
    ], `humanVisual.assets[${index}]`)
    if (!isSha256Hash(item.contentHash) || !isSha256Hash(item.blobContentHash)
      || item.contentHash !== item.blobContentHash
      || !['approved', 'rejected'].includes(String(item.decision))
      || typeof item.note !== 'string' || item.note.length > 2_000) {
      fail(`humanVisual.assets[${index}] 无效`)
    }
    const note = item.note.trim().normalize('NFC')
    const decision = item.decision as 'approved' | 'rejected'
    if (decision === 'rejected' && !note) fail(`humanVisual.assets[${index}] 退回时必须说明原因`)
    const mimeType = boundedText(item.mimeType, `humanVisual.assets[${index}].mimeType`, 200).toLowerCase()
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
      fail(`humanVisual.assets[${index}].mimeType 不是可审查图片`)
    }
    return {
      assetKey: boundedText(item.assetKey, `humanVisual.assets[${index}].assetKey`, 500),
      artifactKey: boundedText(item.artifactKey, `humanVisual.assets[${index}].artifactKey`, 500),
      contentHash: item.contentHash,
      blobContentHash: item.blobContentHash,
      mimeType,
      decision,
      note,
    }
  })
  if (new Set(assets.map(asset => asset.assetKey)).size !== assets.length
    || new Set(assets.map(asset => asset.artifactKey)).size !== assets.length
    || [...assets].sort((left, right) => left.assetKey.localeCompare(right.assetKey))
      .some((asset, index) => canonicalProductProductionJsonV2(asset) !== canonicalProductProductionJsonV2(assets[index]))) {
    fail('文字冒险人工审图图片必须唯一并按 assetKey 排序')
  }
  const passed = assets.every(asset => asset.decision === 'approved')
  if (row.passed !== passed) fail('文字冒险人工审图 passed 不是由逐图决定派生')
  return {
    schema: 'storyforge.text-adventure-human-visual-review-evidence', version: 1,
    buildNumber: positiveInteger(row.buildNumber, 'humanVisual.buildNumber'),
    packageHash: row.packageHash, previewHash: row.previewHash, briefHash: row.briefHash,
    mediaAuditHash: row.mediaAuditHash, visualReviewHash: row.visualReviewHash,
    assets, confirmedAt: positiveInteger(row.confirmedAt, 'humanVisual.confirmedAt'), passed,
  }
}

function parseRouteEvents(value: unknown): ProductMainRouteEventEvidenceV1[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 10_000) fail('routeEvents 数量无效')
  const events = value.map((candidate, index) => {
    const row = record(candidate, `routeEvents[${index}]`)
    exactKeys(row, [
      'kind', 'sequence', 'nodeKey', 'fromNodeKey', 'choiceKey', 'toNodeKey',
      'endingKey', 'payloadHash', 'createdAt',
    ], `routeEvents[${index}]`)
    if (!['started', 'choice', 'ending'].includes(String(row.kind)) || !isSha256Hash(row.payloadHash)) {
      fail(`routeEvents[${index}] 基础字段无效`)
    }
    return {
      kind: row.kind as ProductMainRouteEventEvidenceV1['kind'],
      sequence: positiveInteger(row.sequence, `routeEvents[${index}].sequence`),
      nodeKey: nullableStableText(row.nodeKey, `routeEvents[${index}].nodeKey`),
      fromNodeKey: nullableStableText(row.fromNodeKey, `routeEvents[${index}].fromNodeKey`),
      choiceKey: nullableStableText(row.choiceKey, `routeEvents[${index}].choiceKey`),
      toNodeKey: nullableStableText(row.toNodeKey, `routeEvents[${index}].toNodeKey`),
      endingKey: nullableStableText(row.endingKey, `routeEvents[${index}].endingKey`),
      payloadHash: row.payloadHash,
      createdAt: positiveInteger(row.createdAt, `routeEvents[${index}].createdAt`),
    }
  })
  if (events.some((event, index) => index > 0 && event.sequence <= events[index - 1].sequence)) {
    fail('routeEvents sequence 必须严格递增')
  }
  if (events[0].kind !== 'started' || !events[0].nodeKey
    || events[0].fromNodeKey != null || events[0].choiceKey != null
    || events[0].toNodeKey != null || events[0].endingKey != null) fail('routeEvents 起点无效')
  const ending = events[events.length - 1]
  if (ending.kind !== 'ending' || !ending.endingKey
    || ending.nodeKey != null || ending.fromNodeKey != null || ending.choiceKey != null
    || ending.toNodeKey != null) fail('routeEvents 结局无效')
  let currentNodeKey = events[0].nodeKey
  for (const [index, event] of events.slice(1, -1).entries()) {
    if (event.kind !== 'choice' || event.nodeKey != null || event.endingKey != null
      || !event.fromNodeKey || !event.choiceKey || !event.toNodeKey
      || event.fromNodeKey !== currentNodeKey) fail(`routeEvents 选择链断裂:${index + 1}`)
    currentNodeKey = event.toNodeKey
  }
  if (ending.endingKey !== currentNodeKey) fail('routeEvents 结局与最后选择不一致')
  return events
}

function parsePlaythroughEvidence(value: string | unknown): ProductMainRoutePlaythroughEvidenceV1 {
  let raw: unknown = value
  if (typeof value === 'string') {
    try { raw = JSON.parse(value) } catch { fail('主路线 measuredJson 不是合法 JSON') }
  }
  const row = record(raw, 'playthrough evidence')
  exactKeys(row, [
    'schema', 'version', 'packageHash', 'previewHash', 'runtimeSourceHash', 'sessionKind',
    'routeEvents', 'eventStreamHash', 'choiceCount', 'endingKey', 'environment', 'confirmation',
  ], 'playthrough evidence')
  const sessionKinds = new Set<ProductRuntimeKind>(PRODUCT_RUNTIME_KINDS)
  if (row.schema !== 'storyforge.product-main-route-playthrough-evidence' || row.version !== 1
    || !isSha256Hash(row.packageHash) || !isSha256Hash(row.previewHash)
    || !isSha256Hash(row.runtimeSourceHash) || !isSha256Hash(row.eventStreamHash)
    || typeof row.sessionKind !== 'string'
    || !sessionKinds.has(row.sessionKind as ProductRuntimeKind)) fail('主路线 evidence 基础字段无效')
  const routeEvents = parseRouteEvents(row.routeEvents)
  const confirmation = record(row.confirmation, 'playthrough.confirmation')
  exactKeys(confirmation, ['kind', 'confirmedAt'], 'playthrough.confirmation')
  if (confirmation.kind !== 'author-confirmed-main-route') fail('主路线缺少作者明确确认')
  const choiceCount = positiveInteger(row.choiceCount, 'playthrough.choiceCount')
  if (choiceCount !== routeEvents.filter(event => event.kind === 'choice').length) fail('choiceCount 与路线事件不一致')
  const endingKey = boundedText(row.endingKey, 'playthrough.endingKey')
  if (routeEvents[routeEvents.length - 1].endingKey !== endingKey) fail('endingKey 与路线事件不一致')
  return {
    schema: 'storyforge.product-main-route-playthrough-evidence', version: 1,
    packageHash: row.packageHash, previewHash: row.previewHash,
    runtimeSourceHash: row.runtimeSourceHash, sessionKind: row.sessionKind as ProductRuntimeKind,
    routeEvents, eventStreamHash: row.eventStreamHash, choiceCount, endingKey,
    environment: parsePlaythroughEnvironment(row.environment),
    confirmation: {
      kind: 'author-confirmed-main-route',
      confirmedAt: positiveInteger(confirmation.confirmedAt, 'playthrough.confirmation.confirmedAt'),
    },
  }
}

function parseHumanPlaytestActionEvents(value: unknown): TextAdventureHumanPlaytestActionEvidenceV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) fail('human playtest actionEvents 无效')
  const kinds = new Set(['look', 'move', 'talk', 'take', 'give', 'use', 'inspect', 'attempt', 'rest', 'quest-action'])
  const outcomes = new Set(['success', 'costly-success', 'failure', 'not-attempted'])
  const actions = value.map((item, index) => {
    const row = record(item, `human playtest actionEvents[${index}]`)
    exactKeys(row, [
      'sequence', 'commandId', 'actionKey', 'kind', 'outcome', 'payloadHash', 'createdAt',
    ], `human playtest actionEvents[${index}]`)
    if (!kinds.has(String(row.kind)) || !outcomes.has(String(row.outcome)) || !isSha256Hash(row.payloadHash)) {
      fail(`human playtest actionEvents[${index}] 基础字段无效`)
    }
    return {
      sequence: positiveInteger(row.sequence, `human playtest actionEvents[${index}].sequence`),
      commandId: boundedText(row.commandId, `human playtest actionEvents[${index}].commandId`, 500),
      actionKey: boundedText(row.actionKey, `human playtest actionEvents[${index}].actionKey`, 500),
      kind: row.kind as TextAdventureHumanPlaytestActionEvidenceV1['kind'],
      outcome: row.outcome as TextAdventureHumanPlaytestActionEvidenceV1['outcome'],
      payloadHash: row.payloadHash as string,
      createdAt: positiveInteger(row.createdAt, `human playtest actionEvents[${index}].createdAt`),
    }
  })
  if (actions.some((action, index) => index > 0 && action.sequence <= actions[index - 1].sequence)) {
    fail('human playtest actionEvents sequence 必须严格递增')
  }
  return actions
}

function parseHumanPlaytestAssessment(value: unknown): TextAdventureHumanPlaytestAssessmentV1 {
  const row = record(value, 'human playtest assessment')
  exactKeys(row, ['ratings', 'blockingIssues', 'feedback', 'note'], 'human playtest assessment')
  const ratings = record(row.ratings, 'human playtest ratings')
  exactKeys(ratings, ['comprehension', 'pacing', 'agency', 'emotionalImpact'], 'human playtest ratings')
  const feedback = record(row.feedback, 'human playtest feedback')
  exactKeys(feedback, [
    'comprehensionObstacles', 'boringMoments', 'errors', 'choiceExperience', 'endingFeedback',
  ], 'human playtest feedback')
  return {
    ratings: {
      comprehension: boundedInteger(ratings.comprehension, 'ratings.comprehension', 1, 5),
      pacing: boundedInteger(ratings.pacing, 'ratings.pacing', 1, 5),
      agency: boundedInteger(ratings.agency, 'ratings.agency', 1, 5),
      emotionalImpact: boundedInteger(ratings.emotionalImpact, 'ratings.emotionalImpact', 1, 5),
    },
    blockingIssues: textArray(row.blockingIssues, 'human playtest blockingIssues', 50),
    feedback: {
      comprehensionObstacles: boundedText(feedback.comprehensionObstacles, 'feedback.comprehensionObstacles', 2_000),
      boringMoments: boundedText(feedback.boringMoments, 'feedback.boringMoments', 2_000),
      errors: boundedText(feedback.errors, 'feedback.errors', 2_000),
      choiceExperience: boundedText(feedback.choiceExperience, 'feedback.choiceExperience', 2_000),
      endingFeedback: boundedText(feedback.endingFeedback, 'feedback.endingFeedback', 2_000),
    },
    note: optionalBoundedText(row.note, 'human playtest note', 4_000),
  }
}

function humanPlaytestSessionPassed(
  session: Pick<TextAdventureHumanPlaytestSessionEvidenceV1,
    'elapsedMs' | 'choiceCount' | 'meaningfulActionCount' | 'thresholds' | 'assessment'>,
): boolean {
  return session.elapsedMs >= session.thresholds.minimumElapsedMs
    && session.elapsedMs <= session.thresholds.maximumElapsedMs
    && session.choiceCount >= session.thresholds.minimumChoiceCount
    && session.meaningfulActionCount >= session.thresholds.minimumActionCount
    && Object.values(session.assessment.ratings).every(score => score >= 3)
    && session.assessment.blockingIssues.length === 0
}

function parseHumanPlaytestSession(value: unknown, index: number): TextAdventureHumanPlaytestSessionEvidenceV1 {
  const label = `human playtest sessions[${index}]`
  const row = record(value, label)
  exactKeys(row, [
    'participantRole', 'participant', 'sessionKind', 'routeEvents', 'actionEvents', 'eventStreamHash', 'endingKey',
    'startedAt', 'completedAt', 'elapsedMs', 'choiceCount', 'actionCount', 'meaningfulActionCount', 'dialogueActionCount',
    'thresholds', 'environment', 'assessment', 'confirmedAt', 'passed', 'sessionEvidenceHash',
  ], label)
  if (!['author', 'independent-player'].includes(String(row.participantRole))
    || row.sessionKind !== 'text-adventure' || !isSha256Hash(row.eventStreamHash)
    || !isSha256Hash(row.sessionEvidenceHash) || typeof row.passed !== 'boolean') fail(`${label} 基础字段无效`)
  const routeEvents = parseRouteEvents(row.routeEvents)
  const actionEvents = parseHumanPlaytestActionEvents(row.actionEvents)
  const participantRow = record(row.participant, `${label}.participant`)
  exactKeys(participantRow, ['label', 'declaration'], `${label}.participant`)
  const participant = {
    label: boundedText(participantRow.label, `${label}.participant.label`, 200),
    declaration: participantRow.declaration as TextAdventureHumanPlaytestSessionEvidenceV1['participant']['declaration'],
  }
  if (participant.declaration !== (row.participantRole === 'author'
    ? 'author-self-attestation' : 'not-involved-in-production')) fail(`${label} 身份声明与角色不一致`)
  const thresholdsRow = record(row.thresholds, `${label}.thresholds`)
  exactKeys(thresholdsRow, [
    'targetPlayMinutes', 'minimumElapsedMs', 'maximumElapsedMs', 'minimumChoiceCount', 'minimumActionCount',
  ], `${label}.thresholds`)
  const thresholds = {
    targetPlayMinutes: boundedInteger(thresholdsRow.targetPlayMinutes, `${label}.targetPlayMinutes`, 1, 100_000),
    minimumElapsedMs: positiveInteger(thresholdsRow.minimumElapsedMs, `${label}.minimumElapsedMs`),
    maximumElapsedMs: positiveInteger(thresholdsRow.maximumElapsedMs, `${label}.maximumElapsedMs`),
    minimumChoiceCount: positiveInteger(thresholdsRow.minimumChoiceCount, `${label}.minimumChoiceCount`),
    minimumActionCount: positiveInteger(thresholdsRow.minimumActionCount, `${label}.minimumActionCount`),
  }
  if (thresholds.maximumElapsedMs < thresholds.minimumElapsedMs) fail(`${label} 时长阈值顺序无效`)
  const expectedThresholds = {
    targetPlayMinutes: thresholds.targetPlayMinutes,
    minimumElapsedMs: Math.max(60_000, Math.round(thresholds.targetPlayMinutes * 60_000 * 0.75)),
    maximumElapsedMs: Math.max(60_000, Math.round(thresholds.targetPlayMinutes * 60_000 * 1.25)),
    minimumChoiceCount: Math.max(2, Math.ceil(thresholds.targetPlayMinutes / 6)),
    minimumActionCount: Math.max(6, Math.ceil(thresholds.targetPlayMinutes / 4)),
  }
  if (canonicalProductProductionJsonV2(thresholds) !== canonicalProductProductionJsonV2(expectedThresholds)) {
    fail(`${label} 阈值不是策略确定性派生值`)
  }
  const startedAt = positiveInteger(row.startedAt, `${label}.startedAt`)
  const completedAt = positiveInteger(row.completedAt, `${label}.completedAt`)
  const elapsedMs = boundedInteger(row.elapsedMs, `${label}.elapsedMs`, 1, Number.MAX_SAFE_INTEGER)
  const choiceCount = positiveInteger(row.choiceCount, `${label}.choiceCount`)
  const actionCount = positiveInteger(row.actionCount, `${label}.actionCount`)
  const meaningfulActionCount = positiveInteger(row.meaningfulActionCount, `${label}.meaningfulActionCount`)
  const dialogueActionCount = boundedInteger(row.dialogueActionCount, `${label}.dialogueActionCount`, 0, 10_000)
  const endingKey = boundedText(row.endingKey, `${label}.endingKey`, 500)
  const assessment = parseHumanPlaytestAssessment(row.assessment)
  const session: TextAdventureHumanPlaytestSessionEvidenceV1 = {
    participantRole: row.participantRole as TextAdventureHumanPlaytestParticipantRoleV1,
    participant, sessionKind: 'text-adventure', routeEvents, actionEvents,
    eventStreamHash: row.eventStreamHash as string, endingKey,
    startedAt, completedAt, elapsedMs, choiceCount, actionCount, meaningfulActionCount, dialogueActionCount,
    thresholds, environment: parsePlaythroughEnvironment(row.environment), assessment,
    confirmedAt: positiveInteger(row.confirmedAt, `${label}.confirmedAt`),
    passed: row.passed as boolean, sessionEvidenceHash: row.sessionEvidenceHash as string,
  }
  if (completedAt <= startedAt || elapsedMs !== completedAt - startedAt || session.confirmedAt < completedAt
    || routeEvents[0].createdAt !== startedAt || routeEvents[routeEvents.length - 1].createdAt !== completedAt
    || routeEvents[routeEvents.length - 1].endingKey !== endingKey
    || choiceCount !== routeEvents.filter(event => event.kind === 'choice').length
    || actionCount !== actionEvents.length
    || meaningfulActionCount !== new Set(actionEvents.filter(event => event.outcome !== 'not-attempted')
      .map(event => event.actionKey)).size
    || dialogueActionCount !== actionEvents.filter(event => event.kind === 'talk').length
    || new Set([...routeEvents, ...actionEvents].map(event => event.sequence)).size !== routeEvents.length + actionEvents.length
    || [...routeEvents, ...actionEvents].some(event => event.createdAt < startedAt || event.createdAt > completedAt)
    || row.passed !== humanPlaytestSessionPassed(session)) fail(`${label} 计数、时序或通过判定不一致`)
  return session
}

function latestHumanSession(
  sessions: TextAdventureHumanPlaytestSessionEvidenceV1[],
  role: TextAdventureHumanPlaytestParticipantRoleV1,
): TextAdventureHumanPlaytestSessionEvidenceV1 | null {
  return [...sessions].filter(session => session.participantRole === role)
    .sort((left, right) => right.confirmedAt - left.confirmedAt
      || right.sessionEvidenceHash.localeCompare(left.sessionEvidenceHash))[0] ?? null
}

function humanCoverageStatus(evidence: TextAdventureHumanPlaytestCoverageEvidenceV1): ProductQualityGateReceiptStatusV1 {
  const author = latestHumanSession(evidence.sessions, 'author')
  const independent = latestHumanSession(evidence.sessions, 'independent-player')
  if (author?.passed && independent?.passed && author.eventStreamHash !== independent.eventStreamHash) return 'passed'
  if (author && !author.passed || independent && !independent.passed) return 'failed'
  return 'needs-human'
}

export function parseTextAdventureHumanPlaytestCoverageEvidenceV1(
  value: string | unknown,
): TextAdventureHumanPlaytestCoverageEvidenceV1 {
  let raw: unknown = value
  if (typeof value === 'string') {
    try { raw = JSON.parse(value) } catch { fail('真人试玩 measuredJson 不是合法 JSON') }
  }
  const row = record(raw, 'human playtest coverage evidence')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'packageHash', 'previewHash', 'briefHash', 'sessions',
    'authorSessionEvidenceHash', 'independentPlayerSessionEvidenceHash', 'passed',
  ], 'human playtest coverage evidence')
  if (row.schema !== 'storyforge.text-adventure-human-playtest-coverage-evidence' || row.version !== 1
    || !isSha256Hash(row.packageHash) || !isSha256Hash(row.previewHash) || !isSha256Hash(row.briefHash)
    || !Array.isArray(row.sessions) || row.sessions.length < 1 || row.sessions.length > 20
    || typeof row.passed !== 'boolean') fail('真人试玩 coverage 基础字段无效')
  const sessions = row.sessions.map(parseHumanPlaytestSession)
  if (new Set(sessions.map(session => session.sessionEvidenceHash)).size !== sessions.length
    || sessions.some((session, index) => index > 0 && (session.confirmedAt < sessions[index - 1].confirmedAt
      || session.confirmedAt === sessions[index - 1].confirmedAt
        && session.sessionEvidenceHash.localeCompare(sessions[index - 1].sessionEvidenceHash) <= 0))) {
    fail('真人试玩 sessions 必须按确认时间和 hash 唯一排序')
  }
  const author = latestHumanSession(sessions, 'author')
  const independent = latestHumanSession(sessions, 'independent-player')
  const authorHash = row.authorSessionEvidenceHash == null ? null : row.authorSessionEvidenceHash
  const independentHash = row.independentPlayerSessionEvidenceHash == null ? null : row.independentPlayerSessionEvidenceHash
  if ((authorHash != null && !isSha256Hash(authorHash)) || (independentHash != null && !isSha256Hash(independentHash))
    || authorHash !== (author?.sessionEvidenceHash ?? null)
    || independentHash !== (independent?.sessionEvidenceHash ?? null)) fail('真人试玩最新角色会话指针无效')
  const evidence: TextAdventureHumanPlaytestCoverageEvidenceV1 = {
    schema: 'storyforge.text-adventure-human-playtest-coverage-evidence', version: 1,
    buildNumber: positiveInteger(row.buildNumber, 'human playtest buildNumber'),
    packageHash: row.packageHash as string, previewHash: row.previewHash as string, briefHash: row.briefHash as string,
    sessions, authorSessionEvidenceHash: authorHash, independentPlayerSessionEvidenceHash: independentHash,
    passed: row.passed as boolean,
  }
  const expectedPassed = humanCoverageStatus(evidence) === 'passed'
  if (evidence.passed !== expectedPassed) fail('真人试玩 coverage passed 派生不一致')
  return evidence
}

export function parseProductQualityGateReceiptV1(value: string | unknown): ProductQualityGateReceiptV1 {
  let raw: unknown = value
  if (typeof value === 'string') {
    try { raw = JSON.parse(value) } catch { fail('receipt 不是合法 JSON') }
  }
  const row = record(raw, 'receipt')
  exactKeys(row, [
    'schema', 'version', 'gateId', 'gateVersion', 'verifierId', 'verifierVersion', 'verifierKind',
    'inputHashes', 'environmentHash', 'measuredJson', 'status', 'thresholdProfileId',
    'thresholdProfileVersion', 'evidenceRefs', 'receiptHash', 'createdAt',
  ], 'receipt')
  const verifierKinds = new Set(['deterministic', 'browser-runtime', 'provider-review', 'human-evidence'])
  const statuses = new Set(['passed', 'failed', 'needs-human', 'waived', 'skipped'])
  if (row.schema !== 'storyforge.product-quality-gate-receipt' || row.version !== 1
    || !verifierKinds.has(String(row.verifierKind)) || !statuses.has(String(row.status))
    || (row.environmentHash != null && (typeof row.environmentHash !== 'string' || !isSha256Hash(row.environmentHash)))
    || typeof row.measuredJson !== 'string' || row.measuredJson.length < 2 || row.measuredJson.length > 5_000_000
    || typeof row.receiptHash !== 'string' || !isSha256Hash(row.receiptHash)
    || !Number.isInteger(row.createdAt) || Number(row.createdAt) < 1) fail('receipt 基础字段无效')
  return {
    schema: 'storyforge.product-quality-gate-receipt', version: 1,
    gateId: boundedText(row.gateId, 'gateId'), gateVersion: boundedText(row.gateVersion, 'gateVersion'),
    verifierId: boundedText(row.verifierId, 'verifierId'), verifierVersion: boundedText(row.verifierVersion, 'verifierVersion'),
    verifierKind: row.verifierKind as ProductQualityGateReceiptV1['verifierKind'],
    inputHashes: hashArray(row.inputHashes, 'inputHashes'),
    environmentHash: row.environmentHash as string | null,
    measuredJson: row.measuredJson,
    status: row.status as ProductQualityGateReceiptStatusV1,
    thresholdProfileId: boundedText(row.thresholdProfileId, 'thresholdProfileId'),
    thresholdProfileVersion: boundedText(row.thresholdProfileVersion, 'thresholdProfileVersion'),
    evidenceRefs: textArray(row.evidenceRefs, 'evidenceRefs'),
    receiptHash: row.receiptHash,
    createdAt: Number(row.createdAt),
  }
}

async function verifyGateReceiptHash(receipt: ProductQualityGateReceiptV1): Promise<void> {
  const { receiptHash, ...body } = receipt
  if (await hashProductProductionValueV2(body) !== receiptHash) fail('receiptHash 校验失败')
}

/**
 * Replays the same verifier-specific checks used by local Build adoption, but
 * without Dexie ids. Community packages use this to prove their receipts in a
 * fresh browser before any import write occurs.
 */
export async function verifyPortableProductQualityGateReceiptV1(input: {
  receipt: string | unknown
  binding: PortableProductQualityGateBindingV1
}): Promise<VerifiedPortableProductQualityGateV1> {
  const gateReceipt = parseProductQualityGateReceiptV1(input.receipt)
  await verifyGateReceiptHash(gateReceipt)
  if (gateReceipt.status !== 'passed') fail(`候选包质量回执未通过:${gateReceipt.gateId}`)
  const row = {
    projectId: 0, worldId: 0, workId: 0, buildId: 0,
    gateId: gateReceipt.gateId, gateVersion: gateReceipt.gateVersion,
    verifierId: gateReceipt.verifierId, verifierVersion: gateReceipt.verifierVersion,
    status: gateReceipt.status, receiptJson: canonicalProductProductionJsonV2(gateReceipt),
    receiptHash: gateReceipt.receiptHash, createdAt: gateReceipt.createdAt,
  } satisfies ProductQualityGateReceiptRecordV1
  if (gateReceipt.gateId === PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1) {
    const verified = await verifyBrowserGateReceipt(row, {
      buildId: 0, packageHash: input.binding.packageHash, previewHash: input.binding.previewHash,
    })
    return { gateReceipt, evidence: verified.evidence }
  }
  if (gateReceipt.gateId === PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1) {
    const verified = await verifyPlaythroughGateReceipt(row, {
      buildId: 0, packageHash: input.binding.packageHash, previewHash: input.binding.previewHash,
    })
    return { gateReceipt, evidence: verified.evidence }
  }
  if (gateReceipt.gateId === TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1) {
    const evidence = parseTextAdventureHumanPlaytestCoverageEvidenceV1(gateReceipt.measuredJson)
    const verified = await verifyTextAdventureHumanPlaytestGateReceiptV1(row, {
      buildId: 0, buildNumber: input.binding.buildNumber,
      packageHash: input.binding.packageHash, previewHash: input.binding.previewHash,
      briefHash: input.binding.briefHash, targetPlayMinutes: input.binding.targetPlayMinutes,
    })
    if (!evidence.passed) fail('候选包文字冒险真人试玩覆盖未通过')
    return { gateReceipt, evidence: verified.evidence }
  }
  if (gateReceipt.gateId === PRODUCT_MEDIA_RUNTIME_GATE_ID_V1) {
    const verified = await verifyMediaRuntimeGateReceipt(row, {
      buildId: 0, packageHash: input.binding.packageHash,
      previewHash: input.binding.previewHash, briefHash: input.binding.briefHash,
    })
    return { gateReceipt, evidence: verified.evidence }
  }
  if (gateReceipt.gateId === TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1) {
    const visual = input.binding.humanVisual
    if (!visual) fail('候选包逐图人工回执缺少媒资审查绑定')
    const resolved: ResolvedTextAdventureHumanVisualInputsV1 = {
      build: { id: 0, buildNumber: input.binding.buildNumber } as ProductBuildRecordV1,
      briefHash: input.binding.briefHash,
      packageHash: input.binding.packageHash,
      previewHash: input.binding.previewHash,
      mediaAuditHash: visual.mediaAuditHash,
      visualReviewHash: visual.visualReviewHash,
      assets: visual.assets.map((asset, index) => ({
        ...asset, artifactId: index + 1, blobObjectId: index + 1,
      })),
    }
    const verified = await verifyTextAdventureHumanVisualReviewGateV1(row, resolved)
    return { gateReceipt, evidence: verified.evidence }
  }
  fail(`候选包包含未登记的 portable gate:${gateReceipt.gateId}`)
}

function parseBrowserEvidence(value: string): ProductBrowserPerformanceEvidenceV1 {
  let raw: unknown
  try { raw = JSON.parse(value) } catch { fail('浏览器性能 measuredJson 不是合法 JSON') }
  const row = record(raw, 'browser evidence')
  exactKeys(row, ['schema', 'version', 'measurement', 'receipt'], 'browser evidence')
  if (row.schema !== 'storyforge.product-browser-performance-evidence' || row.version !== 1) {
    fail('浏览器性能 evidence schema/version 无效')
  }
  return {
    schema: 'storyforge.product-browser-performance-evidence', version: 1,
    measurement: row.measurement as ProductBrowserPerformanceMeasurementV1,
    receipt: row.receipt as ProductBrowserPerformanceReceiptV1,
  }
}

async function verifyBrowserGateReceipt(
  row: ProductQualityGateReceiptRecordV1,
  expected: { buildId: number; packageHash: string; previewHash: string },
): Promise<VerifiedProductBrowserPerformanceGateV1> {
  const gateReceipt = parseProductQualityGateReceiptV1(row.receiptJson)
  await verifyGateReceiptHash(gateReceipt)
  if (row.buildId !== expected.buildId || row.gateId !== PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1
    || row.gateId !== gateReceipt.gateId || row.gateVersion !== gateReceipt.gateVersion
    || row.verifierId !== gateReceipt.verifierId || row.verifierVersion !== gateReceipt.verifierVersion
    || row.status !== gateReceipt.status || row.receiptHash !== gateReceipt.receiptHash
    || gateReceipt.verifierKind !== 'browser-runtime'
    || gateReceipt.thresholdProfileId !== PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.policyId
    || gateReceipt.thresholdProfileVersion !== '1'
    || canonicalProductProductionJsonV2(gateReceipt.inputHashes) !== canonicalProductProductionJsonV2([
      expected.packageHash, expected.previewHash,
    ])) fail('浏览器性能 gate 与 Build/索引绑定不一致')
  const evidence = parseBrowserEvidence(gateReceipt.measuredJson)
  const recreated = await createProductBrowserPerformanceReceiptV1(evidence.measurement)
  if (canonicalProductProductionJsonV2(recreated) !== canonicalProductProductionJsonV2(evidence.receipt)
    || recreated.packageHash !== expected.packageHash || recreated.previewHash !== expected.previewHash
    || gateReceipt.status !== (recreated.passed ? 'passed' : 'failed')
    || gateReceipt.environmentHash !== await hashProductProductionValueV2(recreated.environment)
    || canonicalProductProductionJsonV2(gateReceipt.evidenceRefs) !== canonicalProductProductionJsonV2([recreated.receiptHash])) {
    fail('浏览器性能原始测量、聚合回执与 gate receipt 不一致')
  }
  return { row, gateReceipt, evidence }
}

async function verifyMediaRuntimeGateReceipt(
  row: ProductQualityGateReceiptRecordV1,
  expected: { buildId: number; packageHash: string; previewHash: string; briefHash: string },
): Promise<VerifiedProductMediaRuntimeGateV1> {
  const gateReceipt = parseProductQualityGateReceiptV1(row.receiptJson)
  await verifyGateReceiptHash(gateReceipt)
  const evidence = parseMediaRuntimeEvidence(gateReceipt.measuredJson)
  const evidenceHashes = [...new Set(evidence.assets.map(asset => asset.contentHash))].sort()
  if (row.buildId !== expected.buildId || row.gateId !== PRODUCT_MEDIA_RUNTIME_GATE_ID_V1
    || row.gateId !== gateReceipt.gateId || row.gateVersion !== gateReceipt.gateVersion
    || row.verifierId !== gateReceipt.verifierId || row.verifierVersion !== gateReceipt.verifierVersion
    || row.status !== gateReceipt.status || row.receiptHash !== gateReceipt.receiptHash
    || gateReceipt.verifierKind !== 'browser-runtime'
    || gateReceipt.thresholdProfileId !== PRODUCT_MEDIA_RUNTIME_POLICY_ID_V1
    || gateReceipt.thresholdProfileVersion !== PRODUCT_COMMERCIAL_MEDIA_POLICY_V2.policyVersion
    || gateReceipt.gateVersion !== '2' || gateReceipt.verifierVersion !== '2'
    || evidence.packageHash !== expected.packageHash || evidence.previewHash !== expected.previewHash
    || evidence.briefHash !== expected.briefHash
    || gateReceipt.status !== (evidence.passed ? 'passed' : 'failed')
    || gateReceipt.environmentHash !== await hashProductProductionValueV2(evidence.environment)
    || canonicalProductProductionJsonV2(gateReceipt.inputHashes) !== canonicalProductProductionJsonV2([
      expected.packageHash, expected.previewHash, expected.briefHash, ...evidenceHashes,
    ])
    || canonicalProductProductionJsonV2(gateReceipt.evidenceRefs) !== canonicalProductProductionJsonV2(evidenceHashes)
    || gateReceipt.createdAt !== evidence.measuredAt) fail('媒资运行 gate 与 Build/原始测量绑定不一致')
  return { row, gateReceipt, evidence }
}

function eventPayload(event: ProductRuntimeEvent): Record<string, unknown> {
  try { return record(JSON.parse(event.payloadJson), `openWorldEvolution event ${event.sequence}`) }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('[product-quality-receipt]')) throw cause
    fail(`openWorldEvolution event ${event.sequence} payload 不是合法 JSON`)
  }
}

async function createRouteEvidence(events: ProductRuntimeEvent[]): Promise<ProductMainRouteEventEvidenceV1[]> {
  const routeEvents: ProductMainRouteEventEvidenceV1[] = []
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!['narrative.started', 'narrative.choice.committed', 'narrative.ending.reached'].includes(event.type)) continue
    const payload = eventPayload(event)
    const payloadHash = await hashProductProductionValueV2(payload)
    if (event.type === 'narrative.started') {
      routeEvents.push({
        kind: 'started', sequence: event.sequence,
        nodeKey: boundedText(payload.entryNodeKey, 'narrative.started.entryNodeKey'),
        fromNodeKey: null, choiceKey: null, toNodeKey: null, endingKey: null,
        payloadHash, createdAt: event.createdAt,
      })
    } else if (event.type === 'narrative.choice.committed') {
      routeEvents.push({
        kind: 'choice', sequence: event.sequence, nodeKey: null,
        fromNodeKey: boundedText(payload.fromNodeKey, 'narrative.choice.fromNodeKey'),
        choiceKey: boundedText(payload.choiceKey, 'narrative.choice.choiceKey'),
        toNodeKey: boundedText(payload.toNodeKey, 'narrative.choice.toNodeKey'),
        endingKey: null, payloadHash, createdAt: event.createdAt,
      })
    } else {
      routeEvents.push({
        kind: 'ending', sequence: event.sequence, nodeKey: null,
        fromNodeKey: null, choiceKey: null, toNodeKey: null,
        endingKey: boundedText(payload.endingKey, 'narrative.ending.endingKey'),
        payloadHash, createdAt: event.createdAt,
      })
    }
  }
  return parseRouteEvents(routeEvents)
}

async function createHumanPlaytestActionEvidence(
  events: ProductRuntimeEvent[],
): Promise<TextAdventureHumanPlaytestActionEvidenceV1[]> {
  const actions: TextAdventureHumanPlaytestActionEvidenceV1[] = []
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type !== 'adventure.action.committed') continue
    const payload = eventPayload(event)
    actions.push({
      sequence: event.sequence,
      commandId: boundedText(payload.commandId, 'adventure.action.commandId', 500),
      actionKey: boundedText(payload.actionKey, 'adventure.action.actionKey', 500),
      kind: boundedText(payload.kind, 'adventure.action.kind', 100) as TextAdventureHumanPlaytestActionEvidenceV1['kind'],
      outcome: boundedText(payload.outcome, 'adventure.action.outcome', 100) as TextAdventureHumanPlaytestActionEvidenceV1['outcome'],
      payloadHash: await hashProductProductionValueV2(payload),
      createdAt: event.createdAt,
    })
  }
  return parseHumanPlaytestActionEvents(actions)
}

async function verifyPlaythroughGateReceipt(
  row: ProductQualityGateReceiptRecordV1,
  expected: { buildId: number; packageHash: string; previewHash: string },
): Promise<VerifiedProductMainRoutePlaythroughGateV1> {
  const gateReceipt = parseProductQualityGateReceiptV1(row.receiptJson)
  await verifyGateReceiptHash(gateReceipt)
  if (row.buildId !== expected.buildId || row.gateId !== PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1
    || row.gateId !== gateReceipt.gateId || row.gateVersion !== gateReceipt.gateVersion
    || row.verifierId !== gateReceipt.verifierId || row.verifierVersion !== gateReceipt.verifierVersion
    || row.status !== 'passed' || gateReceipt.status !== 'passed' || row.receiptHash !== gateReceipt.receiptHash
    || gateReceipt.verifierKind !== 'human-evidence'
    || gateReceipt.thresholdProfileId !== PRODUCT_MAIN_ROUTE_PLAYTHROUGH_POLICY_ID_V1
    || gateReceipt.thresholdProfileVersion !== '1') fail('主路线 gate 与 Build/索引绑定不一致')
  const evidence = parsePlaythroughEvidence(gateReceipt.measuredJson)
  if (evidence.packageHash !== expected.packageHash || evidence.previewHash !== expected.previewHash
    || evidence.runtimeSourceHash !== expected.packageHash
    || evidence.eventStreamHash !== await hashProductProductionValueV2(evidence.routeEvents)
    || gateReceipt.environmentHash !== await hashProductProductionValueV2(evidence.environment)
    || canonicalProductProductionJsonV2(gateReceipt.inputHashes) !== canonicalProductProductionJsonV2([
      expected.packageHash, expected.previewHash, evidence.eventStreamHash,
    ])
    || canonicalProductProductionJsonV2(gateReceipt.evidenceRefs) !== canonicalProductProductionJsonV2([
      evidence.eventStreamHash,
    ])
    || gateReceipt.createdAt !== evidence.confirmation.confirmedAt) {
    fail('主路线原始事件、作者确认与 gate receipt 不一致')
  }
  return { row, gateReceipt, evidence }
}

function humanPlaytestEventStreamProjection(
  routeEvents: ProductMainRouteEventEvidenceV1[],
  actionEvents: TextAdventureHumanPlaytestActionEvidenceV1[],
): Array<{ stream: 'route' | 'action'; sequence: number; event: ProductMainRouteEventEvidenceV1 | TextAdventureHumanPlaytestActionEvidenceV1 }> {
  return [
    ...routeEvents.map(event => ({ stream: 'route' as const, sequence: event.sequence, event })),
    ...actionEvents.map(event => ({ stream: 'action' as const, sequence: event.sequence, event })),
  ].sort((left, right) => left.sequence - right.sequence || left.stream.localeCompare(right.stream))
}

async function humanPlaytestSessionEvidenceHash(
  session: Omit<TextAdventureHumanPlaytestSessionEvidenceV1, 'sessionEvidenceHash'>,
): Promise<string> {
  return hashProductProductionValueV2(session)
}

async function verifyTextAdventureHumanPlaytestGateReceiptV1(
  row: ProductQualityGateReceiptRecordV1,
  expected: {
    buildId: number
    buildNumber: number
    packageHash: string
    previewHash: string
    briefHash: string
    targetPlayMinutes: number
  },
): Promise<VerifiedTextAdventureHumanPlaytestGateV1> {
  const gateReceipt = parseProductQualityGateReceiptV1(row.receiptJson)
  await verifyGateReceiptHash(gateReceipt)
  if (row.buildId !== expected.buildId || row.gateId !== TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1
    || row.gateId !== gateReceipt.gateId || row.gateVersion !== gateReceipt.gateVersion
    || row.verifierId !== gateReceipt.verifierId || row.verifierVersion !== gateReceipt.verifierVersion
    || row.status !== gateReceipt.status || row.receiptHash !== gateReceipt.receiptHash
    || gateReceipt.verifierKind !== 'human-evidence'
    || gateReceipt.thresholdProfileId !== TEXT_ADVENTURE_HUMAN_PLAYTEST_POLICY_ID_V1
    || gateReceipt.thresholdProfileVersion !== '1') fail('文字冒险真人试玩 gate 与 Build/索引绑定不一致')
  const evidence = parseTextAdventureHumanPlaytestCoverageEvidenceV1(gateReceipt.measuredJson)
  const expectedStatus = humanCoverageStatus(evidence)
  if (evidence.buildNumber !== expected.buildNumber || evidence.packageHash !== expected.packageHash
    || evidence.previewHash !== expected.previewHash || evidence.briefHash !== expected.briefHash
    || evidence.sessions.some(session => session.thresholds.targetPlayMinutes !== expected.targetPlayMinutes)
    || gateReceipt.status !== expectedStatus) fail('文字冒险真人试玩 evidence 与 Build 或状态不一致')
  for (const session of evidence.sessions) {
    const expectedEventStreamHash = await hashProductProductionValueV2(
      humanPlaytestEventStreamProjection(session.routeEvents, session.actionEvents),
    )
    const { sessionEvidenceHash, ...sessionBody } = session
    if (session.eventStreamHash !== expectedEventStreamHash
      || sessionEvidenceHash !== await humanPlaytestSessionEvidenceHash(sessionBody)) {
      fail(`文字冒险真人试玩会话 hash 校验失败:${session.participantRole}`)
    }
  }
  const sessionHashes = evidence.sessions.map(session => session.sessionEvidenceHash)
  const expectedEnvironmentHash = await hashProductProductionValueV2(evidence.sessions.map(session => ({
    participantRole: session.participantRole,
    sessionEvidenceHash: session.sessionEvidenceHash,
    environment: session.environment,
  })))
  if (gateReceipt.environmentHash !== expectedEnvironmentHash
    || canonicalProductProductionJsonV2(gateReceipt.inputHashes) !== canonicalProductProductionJsonV2([
      expected.packageHash, expected.previewHash, expected.briefHash, ...sessionHashes,
    ])
    || canonicalProductProductionJsonV2(gateReceipt.evidenceRefs) !== canonicalProductProductionJsonV2(sessionHashes)
    || gateReceipt.createdAt !== Math.max(...evidence.sessions.map(session => session.confirmedAt))) {
    fail('文字冒险真人试玩原始会话、环境与 gate receipt 不一致')
  }
  return { row, gateReceipt, evidence }
}

export async function recordProductBrowserPerformanceMeasurementV1(input: {
  scope: WorkspaceScope
  productBuildId: number
  measurement: ProductBrowserPerformanceMeasurementV1
}): Promise<VerifiedProductBrowserPerformanceGateV1> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) fail('Build 尚未达到浏览器验收状态')
  if (input.measurement.packageHash !== build.packageHash || input.measurement.previewHash !== build.previewHash) {
    fail('测量输入 hash 与 Build Preview 不一致')
  }
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefHash !== build.briefHash) fail('Build 对应 Brief 不存在或 hash 不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (await hashProductProductionValueV2(brief) !== briefRow.briefHash) fail('Build 对应 Brief hash 校验失败')
  const now = Date.now()
  if (input.measurement.measuredAt < build.createdAt || input.measurement.measuredAt > now + 5 * 60 * 1000) {
    fail('测量时间早于 Build 或超出允许时钟偏差')
  }
  const browserReceipt = await createProductBrowserPerformanceReceiptV1(input.measurement)
  const verifierId = input.measurement.runtimeVerifier === 'in-app-browser-lab'
    ? 'storyforge.in-app-browser-performance-lab'
    : 'storyforge.playwright-browser-runtime'
  const evidence: ProductBrowserPerformanceEvidenceV1 = {
    schema: 'storyforge.product-browser-performance-evidence', version: 1,
    measurement: structuredClone(input.measurement), receipt: browserReceipt,
  }
  // The verifier's measuredAt is the immutable evidence time. Using it here
  // also makes re-submission of the exact same measurement idempotent.
  const createdAt = input.measurement.measuredAt
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1, gateVersion: '1',
    verifierId, verifierVersion: '1',
    verifierKind: 'browser-runtime' as const,
    inputHashes: [build.packageHash, build.previewHash],
    environmentHash: await hashProductProductionValueV2(browserReceipt.environment),
    measuredJson: canonicalProductProductionJsonV2(evidence),
    status: (browserReceipt.passed ? 'passed' : 'failed') as ProductQualityGateReceiptStatusV1,
    thresholdProfileId: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.policyId,
    thresholdProfileVersion: '1', evidenceRefs: [browserReceipt.receiptHash], createdAt,
  }
  const gateReceipt: ProductQualityGateReceiptV1 = {
    ...body, receiptHash: await hashProductProductionValueV2(body),
  }
  const pendingRow = stampNewRecord(scope, 'productQualityGateReceipts', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    buildId: build.id!, gateId: gateReceipt.gateId, gateVersion: gateReceipt.gateVersion,
    verifierId: gateReceipt.verifierId, verifierVersion: gateReceipt.verifierVersion,
    status: gateReceipt.status, receiptJson: canonicalProductProductionJsonV2(gateReceipt),
    receiptHash: gateReceipt.receiptHash, createdAt,
  } satisfies ProductQualityGateReceiptRecordV1, { owner: 'work' })
  const row = await db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productProductionBriefs, db.productQualityGateReceipts,
  ), async () => {
    const current = await db.productBuilds.get(build.id!)
    if (!current || current.packageHash !== build.packageHash || current.previewHash !== build.previewHash) {
      fail('Build 在写入性能回执前已变化')
    }
    const currentBrief = await db.productProductionBriefs
      .where('[productionId+revision]').equals([current.productionId, current.briefRevision]).first()
    if (!currentBrief || currentBrief.briefHash !== current.briefHash
      || currentBrief.briefHash !== briefRow.briefHash) fail('Build 对应 Brief 在写入回执前已变化')
    let stored = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([
        current.id!, gateReceipt.gateId, gateReceipt.receiptHash,
      ]).first()
    if (!stored) {
      const id = await db.productQualityGateReceipts.add(pendingRow) as number
      stored = { ...pendingRow, id }
    }
    return stored
  })
  const verified = await verifyBrowserGateReceipt(row, {
    buildId: build.id!, packageHash: build.packageHash, previewHash: build.previewHash,
  })
  await reconcileCommercialProductBuildReadinessV1({ scope, productBuildId: build.id! })
  return verified
}

export async function readLatestProductBrowserPerformanceGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedProductBrowserPerformanceGateV1 | null> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  const rows = await db.productQualityGateReceipts
    .where('[buildId+gateId]').equals([build.id!, PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1]).toArray()
  rows.sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
  const latest = rows[0]
  if (!latest) return null
  if (!await assertRecordInScope(scope, 'productQualityGateReceipts', latest, { owner: 'work' })) fail('质量回执跨 Work')
  return verifyBrowserGateReceipt(latest, {
    buildId: build.id!, packageHash: build.packageHash, previewHash: build.previewHash,
  })
}

/** Commercial publish hard gate: latest receipt must be a complete real-browser pass. */
export async function requirePassedProductBrowserPerformanceGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedProductBrowserPerformanceGateV1> {
  const latest = await readLatestProductBrowserPerformanceGateV1(input)
  if (!latest) fail('商业候选缺少真实浏览器性能回执')
  if (latest.gateReceipt.status !== 'passed' || !latest.evidence.receipt.passed) {
    fail(`商业候选浏览器性能未通过:${latest.evidence.receipt.failures.join(',') || 'unknown'}`)
  }
  return latest
}

export async function recordProductMediaRuntimeMeasurementV1(input: {
  scope: WorkspaceScope
  productBuildId: number
  measurement: ProductMediaRuntimeMeasurementV1
}): Promise<VerifiedProductMediaRuntimeGateV1> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) fail('Build 尚未达到媒资运行验收状态')
  const preview = await verifyProductBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.packageHash !== build.packageHash || preview.previewHash !== build.previewHash) {
    fail('Preview hash 与 Build 不一致')
  }
  const expectedAssets = [...(preview.runtimePackage.presentation?.assets ?? [])]
    .sort((left, right) => left.assetKey.localeCompare(right.assetKey))
  if (!expectedAssets.length) fail('当前 Build 没有需要浏览器验收的媒资')
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefHash !== build.briefHash) fail('Build 对应 Brief 不存在或 hash 不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (await hashProductProductionValueV2(brief) !== briefRow.briefHash) fail('Build 对应 Brief hash 校验失败')
  const now = Date.now()
  if (input.measurement.measuredAt < build.createdAt || input.measurement.measuredAt > now + 5 * 60 * 1000) {
    fail('媒资测量时间早于 Build 或超出允许时钟偏差')
  }
  const measuredAssets = structuredClone(input.measurement.assets).map(asset => ({
    ...asset,
    policyFailures: brief.qualityProfile === 'commercial-candidate'
      ? evaluateProductMediaCommercialPolicyV2({ runtimePackage: preview.runtimePackage, probe: asset })
      : [],
  }))
  const evidence = parseMediaRuntimeEvidence({
    schema: 'storyforge.product-media-runtime-evidence', version: 2,
    packageHash: build.packageHash, previewHash: build.previewHash,
    briefHash: build.briefHash, qualityProfile: brief.qualityProfile,
    assets: measuredAssets,
    environment: structuredClone(input.measurement.environment),
    measuredAt: input.measurement.measuredAt,
    passed: measuredAssets.every(asset => asset.status === 'decoded' && asset.policyFailures.length === 0),
  })
  if (evidence.assets.length !== expectedAssets.length) fail('媒资运行测量未完整覆盖 Preview 资产')
  for (const [index, expected] of expectedAssets.entries()) {
    const measured = evidence.assets[index]
    if (measured.assetKey !== expected.assetKey || measured.contentHash !== expected.blobContentHash
      || measured.mimeType !== expected.mimeType.toLowerCase()) fail(`媒资运行测量与 Preview 不一致:${expected.assetKey}`)
    if (measured.status !== 'decoded') continue
    if (measured.mediaClass === 'image'
      && (measured.decodedWidth !== expected.width || measured.decodedHeight !== expected.height)) {
      fail(`图片浏览器解码尺寸与冻结资产不一致:${expected.assetKey}`)
    }
    if (measured.mediaClass === 'audio' && expected.durationMs != null
      && Math.abs(measured.decodedDurationMs! - expected.durationMs) > Math.max(2_000, expected.durationMs * 0.2)) {
      fail(`音频浏览器解码时长与冻结资产偏差过大:${expected.assetKey}`)
    }
  }
  const evidenceHashes = [...new Set(evidence.assets.map(asset => asset.contentHash))].sort()
  const createdAt = evidence.measuredAt
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: PRODUCT_MEDIA_RUNTIME_GATE_ID_V1, gateVersion: '2',
    verifierId: 'storyforge.browser-media-runtime', verifierVersion: '2',
    verifierKind: 'browser-runtime' as const,
    inputHashes: [build.packageHash, build.previewHash, build.briefHash, ...evidenceHashes],
    environmentHash: await hashProductProductionValueV2(evidence.environment),
    measuredJson: canonicalProductProductionJsonV2(evidence),
    status: (evidence.passed ? 'passed' : 'failed') as ProductQualityGateReceiptStatusV1,
    thresholdProfileId: PRODUCT_MEDIA_RUNTIME_POLICY_ID_V1,
    thresholdProfileVersion: PRODUCT_COMMERCIAL_MEDIA_POLICY_V2.policyVersion,
    evidenceRefs: evidenceHashes, createdAt,
  }
  const gateReceipt: ProductQualityGateReceiptV1 = {
    ...body, receiptHash: await hashProductProductionValueV2(body),
  }
  const pendingRow = stampNewRecord(scope, 'productQualityGateReceipts', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    buildId: build.id!, gateId: gateReceipt.gateId, gateVersion: gateReceipt.gateVersion,
    verifierId: gateReceipt.verifierId, verifierVersion: gateReceipt.verifierVersion,
    status: gateReceipt.status, receiptJson: canonicalProductProductionJsonV2(gateReceipt),
    receiptHash: gateReceipt.receiptHash, createdAt,
  } satisfies ProductQualityGateReceiptRecordV1, { owner: 'work' })
  const row = await db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productProductionBriefs, db.productQualityGateReceipts,
  ), async () => {
    const current = await db.productBuilds.get(build.id!)
    if (!current || current.packageHash !== build.packageHash || current.previewHash !== build.previewHash) {
      fail('Build 在写入媒资运行回执前已变化')
    }
    const currentBrief = await db.productProductionBriefs
      .where('[productionId+revision]').equals([current.productionId, current.briefRevision]).first()
    if (!currentBrief || currentBrief.briefHash !== briefRow.briefHash) fail('Build 对应 Brief 在写入回执前已变化')
    let stored = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([
        current.id!, gateReceipt.gateId, gateReceipt.receiptHash,
      ]).first()
    if (!stored) {
      const id = await db.productQualityGateReceipts.add(pendingRow) as number
      stored = { ...pendingRow, id }
    }
    return stored
  })
  const verified = await verifyMediaRuntimeGateReceipt(row, {
    buildId: build.id!, packageHash: build.packageHash, previewHash: build.previewHash, briefHash: build.briefHash,
  })
  await reconcileCommercialProductBuildReadinessV1({ scope, productBuildId: build.id! })
  return verified
}

export async function readLatestProductMediaRuntimeGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedProductMediaRuntimeGateV1 | null> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  const rows = await db.productQualityGateReceipts
    .where('[buildId+gateId]').equals([build.id!, PRODUCT_MEDIA_RUNTIME_GATE_ID_V1]).toArray()
  const currentRows = rows.filter(row => row.gateVersion === '2')
  currentRows.sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
  const latest = currentRows[0]
  if (!latest) return null
  if (!await assertRecordInScope(scope, 'productQualityGateReceipts', latest, { owner: 'work' })) fail('质量回执跨 Work')
  return verifyMediaRuntimeGateReceipt(latest, {
    buildId: build.id!, packageHash: build.packageHash, previewHash: build.previewHash, briefHash: build.briefHash,
  })
}

/** Commercial publish hard gate: every frozen media byte must decode in the real preview browser. */
export async function requirePassedProductMediaRuntimeGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedProductMediaRuntimeGateV1> {
  const latest = await readLatestProductMediaRuntimeGateV1(input)
  if (!latest) fail('商业候选缺少真实浏览器媒资解码回执')
  if (latest.gateReceipt.status !== 'passed' || !latest.evidence.passed) {
    const failures = latest.evidence.assets.filter(asset => asset.status === 'failed' || asset.policyFailures.length > 0)
      .map(asset => `${asset.assetKey}:${asset.failureCode ?? (asset.policyFailures.join('+') || 'unknown')}`)
    fail(`商业候选媒资浏览器解码未通过:${failures.join(',') || 'unknown'}`)
  }
  return latest
}

interface ResolvedTextAdventureHumanVisualInputsV1 {
  build: ProductBuildRecordV1
  briefHash: string
  packageHash: string
  previewHash: string
  mediaAuditHash: string
  visualReviewHash: string
  assets: Array<{
    assetKey: string
    artifactKey: string
    contentHash: string
    blobContentHash: string
    mimeType: string
    byteSize: number
    artifactId: number
    blobObjectId: number
  }>
}

function parseArtifactPayload(row: ProductBuildArtifactRecordV1, label: string): unknown {
  try { return JSON.parse(row.payloadJson) as unknown }
  catch { fail(`${label} payload 不是合法 JSON`) }
}

async function assertJsonArtifactHash(row: ProductBuildArtifactRecordV1, label: string): Promise<unknown> {
  const payload = parseArtifactPayload(row, label)
  if (await hashProductProductionValueV2(payload) !== row.contentHash) fail(`${label} contentHash 不一致`)
  return payload
}

interface HumanVisualRequirementProjectionV1 {
  artifactKeys: string[]
}

interface HumanVisualMediaAuditProjectionV1 {
  assets: Array<{
    artifactKey: string
    status: 'fulfilled' | 'text-fallback'
    assetKey: string | null
    contentHash: string
    mimeType: string | null
  }>
}

interface HumanVisualQualityProjectionV1 {
  status: 'passed' | 'revision-required' | 'human-review-required'
  providerReviewCompleted: boolean
  reviews: Array<{
    artifactKey: string
    contentHash: string
    verdict: 'accept' | 'revise' | 'replace' | 'human-review' | 'not-applicable-text-fallback'
    reviewSource: 'multimodal-model' | 'deterministic-fallback'
  }>
}

function parseHumanVisualRequirementProjectionV1(
  value: unknown,
  expectedImageCount: number,
): HumanVisualRequirementProjectionV1 {
  const row = record(value, 'human visual media requirements')
  exactKeys(row, ['schema', 'version', 'visual', 'audio'], 'human visual media requirements')
  if (row.schema !== 'storyforge.product-media-requirements-artifact' || row.version !== 2
    || !Array.isArray(row.visual) || !Array.isArray(row.audio) || row.visual.length !== expectedImageCount) {
    fail('人工审图媒资需求合同无效')
  }
  const artifactKeys = row.visual.map((value, index) => {
    const item = record(value, `human visual requirement[${index}]`)
    exactKeys(item, [
      'artifactKey', 'mediaKind', 'sceneTag', 'beatKey', 'prompt', 'altText', 'width', 'height', 'palette',
      'characterAnchorRefs', 'hardConstraints',
    ], `human visual requirement[${index}]`)
    return boundedText(item.artifactKey, `human visual requirement[${index}].artifactKey`, 500)
  }).sort()
  const expected = Array.from({ length: expectedImageCount }, (_, index) => (
    `media.visual.${String(index + 1).padStart(3, '0')}`
  ))
  if (canonicalProductProductionJsonV2(artifactKeys) !== canonicalProductProductionJsonV2(expected)) {
    fail('人工审图媒资需求与 Brief 图片数量不一致')
  }
  return { artifactKeys }
}

function parseHumanVisualMediaAuditProjectionV1(input: {
  value: unknown
  buildNumber: number
  requirementsHash: string
  visualBibleHash: string
  artifactKeys: string[]
}): HumanVisualMediaAuditProjectionV1 {
  const row = record(input.value, 'human visual media audit')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'requirementsHash', 'visualBibleHash', 'assets', 'passed',
  ], 'human visual media audit')
  if (row.schema !== 'storyforge.text-adventure-media-audit-artifact' || row.version !== 1
    || row.buildNumber !== input.buildNumber || row.requirementsHash !== input.requirementsHash
    || row.visualBibleHash !== input.visualBibleHash || row.passed !== true
    || !Array.isArray(row.assets) || row.assets.length !== input.artifactKeys.length) {
    fail('人工审图 media.audit 与当前 Build 不一致')
  }
  const assets: HumanVisualMediaAuditProjectionV1['assets'] = row.assets.map((value, index) => {
    const item = record(value, `human visual media audit asset[${index}]`)
    const hasRequirementBinding = Object.prototype.hasOwnProperty.call(item, 'sourceRequirementHash')
      || Object.prototype.hasOwnProperty.call(item, 'requirementBinding')
    exactKeys(item, [
      'artifactKey', 'status', 'assetKey', 'requirementHash', 'contentHash', 'mimeType', 'width', 'height',
      'source', 'license', 'rightsComplete', 'fallbackReason',
      ...(hasRequirementBinding ? ['sourceRequirementHash', 'requirementBinding'] : []),
    ], `human visual media audit asset[${index}]`)
    const status = item.status === 'fulfilled' ? 'fulfilled' : item.status === 'text-fallback' ? 'text-fallback' : null
    if (!status || !isSha256Hash(item.requirementHash) || !isSha256Hash(item.contentHash)
      || item.rightsComplete !== true) fail(`人工审图 media.audit 图片无效:${index}`)
    const artifactKey = boundedText(item.artifactKey, `human visual media audit asset[${index}].artifactKey`, 500)
    if (status === 'fulfilled') {
      const sourceRequirementHash = hasRequirementBinding ? item.sourceRequirementHash : item.requirementHash
      const requirementBinding = hasRequirementBinding ? item.requirementBinding : 'generated-for-requirement'
      const assetKey = boundedText(item.assetKey, `${artifactKey}.assetKey`, 500)
      const mimeType = boundedText(item.mimeType, `${artifactKey}.mimeType`, 200).toLowerCase()
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)
        || !isSha256Hash(sourceRequirementHash)
        || !['generated-for-requirement', 'revalidated-reuse'].includes(String(requirementBinding))
        || (requirementBinding === 'generated-for-requirement') !== (sourceRequirementHash === item.requirementHash)
        || !Number.isInteger(item.width) || Number(item.width) < 1
        || !Number.isInteger(item.height) || Number(item.height) < 1
        || typeof item.source !== 'string' || !item.source.trim()
        || typeof item.license !== 'string' || !item.license.trim() || item.fallbackReason !== null) {
        fail(`人工审图 media.audit 图片合同无效:${artifactKey}`)
      }
      return { artifactKey, status, assetKey, contentHash: item.contentHash, mimeType }
    }
    if (hasRequirementBinding
      && (item.sourceRequirementHash !== null || item.requirementBinding !== 'text-fallback')) {
      fail(`人工审图 media.audit 纯文字降级需求绑定无效:${artifactKey}`)
    }
    if (item.assetKey !== null || item.mimeType !== null || item.width !== null || item.height !== null
      || item.source !== null || item.license !== null
      || typeof item.fallbackReason !== 'string' || !item.fallbackReason.trim()) {
      fail(`人工审图 media.audit 纯文字降级合同无效:${artifactKey}`)
    }
    return { artifactKey, status, assetKey: null, contentHash: item.contentHash, mimeType: null }
  })
  const keys = assets.map(asset => asset.artifactKey).sort()
  if (canonicalProductProductionJsonV2(keys) !== canonicalProductProductionJsonV2([...input.artifactKeys].sort())
    || new Set(assets.flatMap(asset => asset.assetKey ? [asset.assetKey] : [])).size
      !== assets.filter(asset => asset.assetKey).length) {
    fail('人工审图 media.audit 图片覆盖不完整或 assetKey 重复')
  }
  return { assets }
}

function parseHumanVisualQualityProjectionV1(input: {
  value: unknown
  buildNumber: number
  mediaAuditHash: string
  auditAssets: HumanVisualMediaAuditProjectionV1['assets']
}): HumanVisualQualityProjectionV1 {
  const row = record(input.value, 'human visual quality review')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'mediaAuditHash', 'status', 'reviews',
    'blockingIssueCount', 'providerReviewCompleted',
  ], 'human visual quality review')
  if (row.schema !== 'storyforge.text-adventure-visual-quality-review-artifact' || row.version !== 1
    || row.buildNumber !== input.buildNumber || row.mediaAuditHash !== input.mediaAuditHash
    || !['passed', 'revision-required', 'human-review-required'].includes(String(row.status))
    || !Array.isArray(row.reviews) || row.reviews.length !== input.auditAssets.length
    || !Number.isInteger(row.blockingIssueCount) || Number(row.blockingIssueCount) < 0
    || typeof row.providerReviewCompleted !== 'boolean') fail('人工审图 quality.visual-review 合同无效')
  let derivedBlockingIssues = 0
  const reviews: HumanVisualQualityProjectionV1['reviews'] = row.reviews.map((value, index) => {
    const item = record(value, `human visual quality review[${index}]`)
    exactKeys(item, [
      'artifactKey', 'contentHash', 'verdict', 'scores', 'issues', 'reviewSource',
    ], `human visual quality review[${index}]`)
    const verdicts = ['accept', 'revise', 'replace', 'human-review', 'not-applicable-text-fallback'] as const
    const verdict = verdicts.find(candidate => candidate === item.verdict)
    const reviewSource = item.reviewSource === 'multimodal-model'
      ? 'multimodal-model' : item.reviewSource === 'deterministic-fallback' ? 'deterministic-fallback' : null
    if (!verdict || !reviewSource || !isSha256Hash(item.contentHash) || !Array.isArray(item.issues)) {
      fail(`人工审图 quality.visual-review 图片无效:${index}`)
    }
    for (const [issueIndex, issueValue] of item.issues.entries()) {
      const issue = record(issueValue, `human visual issue[${index}][${issueIndex}]`)
      exactKeys(issue, ['severity', 'category', 'detail', 'recommendation'], `human visual issue[${index}][${issueIndex}]`)
      if (!['warning', 'blocking'].includes(String(issue.severity))
        || typeof issue.detail !== 'string' || !issue.detail.trim()
        || typeof issue.recommendation !== 'string' || !issue.recommendation.trim()) {
        fail(`人工审图 quality.visual-review 问题无效:${index}`)
      }
      if (issue.severity === 'blocking') derivedBlockingIssues += 1
    }
    if (reviewSource === 'multimodal-model') {
      const scores = record(item.scores, `human visual scores[${index}]`)
      exactKeys(scores, [
        'requirementFit', 'identityContinuity', 'styleContinuity', 'composition', 'technicalCleanliness',
      ], `human visual scores[${index}]`)
      if (Object.values(scores).some(score => !Number.isInteger(score) || Number(score) < 1 || Number(score) > 5)) {
        fail(`人工审图 quality.visual-review 评分无效:${index}`)
      }
    } else if (item.scores !== null) fail(`人工审图 quality.visual-review fallback 不应有评分:${index}`)
    return {
      artifactKey: boundedText(item.artifactKey, `human visual quality review[${index}].artifactKey`, 500),
      contentHash: item.contentHash, verdict, reviewSource,
    }
  })
  const expected = new Map(input.auditAssets.map(asset => [asset.artifactKey, asset]))
  if (new Set(reviews.map(review => review.artifactKey)).size !== reviews.length
    || reviews.some(review => {
      const audit = expected.get(review.artifactKey)
      return !audit || review.contentHash !== audit.contentHash
        || (audit.status === 'fulfilled' ? review.verdict !== 'accept' : review.verdict !== 'not-applicable-text-fallback')
    })) fail('人工审图 quality.visual-review 未逐项接受当前 audit 图片')
  const status = row.status as HumanVisualQualityProjectionV1['status']
  const derivedPassed = reviews.every(review => ['accept', 'not-applicable-text-fallback'].includes(review.verdict))
    && derivedBlockingIssues === 0
  if (Number(row.blockingIssueCount) !== derivedBlockingIssues
    || (status === 'passed') !== derivedPassed
    || row.providerReviewCompleted !== reviews.every(review => (
      review.reviewSource === 'multimodal-model' || review.verdict === 'not-applicable-text-fallback'
    ))) fail('人工审图 quality.visual-review 汇总结论无效')
  return { status, providerReviewCompleted: row.providerReviewCompleted, reviews }
}

async function resolveTextAdventureHumanVisualInputsV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1
}): Promise<ResolvedTextAdventureHumanVisualInputsV1> {
  const { scope, build } = input
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefHash !== build.briefHash) fail('人工审图对应 Brief 不存在或 hash 不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (brief.intent.productType !== 'text-adventure' || !brief.textAdventure
    || brief.qualityProfile !== 'commercial-candidate') {
    fail('逐图人工回执只用于商业候选文字冒险 Build')
  }
  if (await hashProductProductionValueV2(brief) !== briefRow.briefHash) fail('人工审图对应 Brief hash 校验失败')
  const preview = await verifyProductBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.productionKey === '' || preview.buildNumber !== build.buildNumber
    || preview.packageHash !== build.packageHash || preview.previewHash !== build.previewHash
    || preview.runtimePackage.productType !== 'text-adventure') fail('人工审图 Preview 与 Build 不一致')
  const runtimeImages = [...(preview.runtimePackage.presentation?.assets ?? [])]
    .filter(asset => asset.mimeType.startsWith('image/'))
    .sort((left, right) => left.assetKey.localeCompare(right.assetKey))
  if (!runtimeImages.length) fail('当前文字冒险 Build 没有需要逐图确认的图片')

  const rows = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.status === 'accepted' || row.status === 'carried-forward')
  if (rows.some(row => !artifactScopeMatches(row, scope))) fail('人工审图 Artifact 作用域不一致')
  const byKey = new Map<string, ProductBuildArtifactRecordV1>()
  for (const row of rows) {
    if (row.controlEpoch !== build.controlEpoch) fail(`人工审图 Artifact 来自旧 epoch:${row.artifactKey}`)
    if (byKey.has(row.artifactKey)) fail(`人工审图 Artifact key 重复:${row.artifactKey}`)
    byKey.set(row.artifactKey, row)
  }
  const requiredArtifact = (artifactKey: string) => {
    const row = byKey.get(artifactKey)
    if (!row) fail(`人工审图缺少 Artifact:${artifactKey}`)
    return row
  }
  const requirementsRow = requiredArtifact('media.requirements')
  const visualBibleRow = requiredArtifact('media.visual-bible')
  const auditRow = requiredArtifact('media.audit')
  const visualReviewRow = requiredArtifact('quality.visual-review')
  const requirements = parseHumanVisualRequirementProjectionV1(
    await assertJsonArtifactHash(requirementsRow, 'media.requirements'), brief.media.imageCount,
  )
  await assertJsonArtifactHash(visualBibleRow, 'media.visual-bible')
  const audit = parseHumanVisualMediaAuditProjectionV1({
    value: await assertJsonArtifactHash(auditRow, 'media.audit'),
    buildNumber: build.buildNumber, requirementsHash: requirementsRow.contentHash,
    visualBibleHash: visualBibleRow.contentHash, artifactKeys: requirements.artifactKeys,
  })
  const visualReview = parseHumanVisualQualityProjectionV1({
    value: await assertJsonArtifactHash(visualReviewRow, 'quality.visual-review'),
    buildNumber: build.buildNumber, mediaAuditHash: auditRow.contentHash, auditAssets: audit.assets,
  })
  if (visualReview.status !== 'passed' || !visualReview.providerReviewCompleted) {
    fail(`独立 Visual QA 尚未通过:${visualReview.status}`)
  }
  const auditByAssetKey = new Map(audit.assets.flatMap(item => item.assetKey ? [[item.assetKey, item] as const] : []))
  const reviewByArtifactKey = new Map(visualReview.reviews.map(item => [item.artifactKey, item]))
  const bindingByAssetKey = new Map(preview.mediaBindings.map(item => [item.assetKey, item]))
  const assets: ResolvedTextAdventureHumanVisualInputsV1['assets'] = []
  for (const runtimeAsset of runtimeImages) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(runtimeAsset.mimeType)) {
      fail(`人工审图不接受未受支持的图片格式:${runtimeAsset.assetKey}`)
    }
    const binding = bindingByAssetKey.get(runtimeAsset.assetKey)
    const auditAsset = auditByAssetKey.get(runtimeAsset.assetKey)
    const artifact = binding ? byKey.get(binding.artifactKey) : null
    const review = binding ? reviewByArtifactKey.get(binding.artifactKey) : null
    if (!binding || !auditAsset || auditAsset.status !== 'fulfilled' || !artifact || !review
      || review.verdict !== 'accept' || artifact.id == null || artifact.blobObjectId == null
      || artifact.kind !== 'image' || artifact.contentHash !== runtimeAsset.contentHash
      || runtimeAsset.contentHash !== runtimeAsset.blobContentHash
      || binding.blobContentHash !== runtimeAsset.blobContentHash
      || auditAsset.artifactKey !== artifact.artifactKey || auditAsset.contentHash !== artifact.contentHash
      || review.contentHash !== artifact.contentHash || artifact.mimeType !== runtimeAsset.mimeType
      || auditAsset.mimeType !== runtimeAsset.mimeType || artifact.byteSize !== runtimeAsset.byteSize) {
      fail(`人工审图图片未与 Audit/Visual QA/Runtime 闭合:${runtimeAsset.assetKey}`)
    }
    await readMediaBlobObjectData({
      scope, blobObjectId: artifact.blobObjectId,
      expected: {
        contentHash: artifact.contentHash,
        mimeType: artifact.mimeType,
        byteSize: artifact.byteSize,
      },
    })
    assets.push({
      assetKey: runtimeAsset.assetKey, artifactKey: artifact.artifactKey,
      contentHash: artifact.contentHash, blobContentHash: runtimeAsset.blobContentHash,
      mimeType: runtimeAsset.mimeType, byteSize: runtimeAsset.byteSize,
      artifactId: artifact.id, blobObjectId: artifact.blobObjectId,
    })
  }
  if (assets.length !== audit.assets.filter(item => item.status === 'fulfilled').length
    || assets.length !== visualReview.reviews.filter(item => item.verdict !== 'not-applicable-text-fallback').length) {
    fail('人工审图图片数量与 Audit/Visual QA 不闭合')
  }
  return {
    build, briefHash: build.briefHash, packageHash: build.packageHash, previewHash: build.previewHash,
    mediaAuditHash: auditRow.contentHash, visualReviewHash: visualReviewRow.contentHash, assets,
  }
}

function artifactScopeMatches(row: ProductBuildArtifactRecordV1, scope: WorkspaceScope): boolean {
  return row.projectId === scope.projectId && row.worldId === scope.worldId && row.workId === scope.workId
}

async function verifyTextAdventureHumanVisualReviewGateV1(
  row: ProductQualityGateReceiptRecordV1,
  resolved: ResolvedTextAdventureHumanVisualInputsV1,
): Promise<VerifiedTextAdventureHumanVisualReviewGateV1> {
  const gateReceipt = parseProductQualityGateReceiptV1(row.receiptJson)
  const evidence = parseTextAdventureHumanVisualReviewEvidenceV1(gateReceipt.measuredJson)
  const expectedAssets = resolved.assets.map(asset => ({
    assetKey: asset.assetKey, artifactKey: asset.artifactKey,
    contentHash: asset.contentHash, blobContentHash: asset.blobContentHash, mimeType: asset.mimeType,
  }))
  if (row.buildId !== resolved.build.id || row.gateId !== TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1
    || row.gateVersion !== '1' || row.verifierId !== 'storyforge.author-visual-confirmation'
    || row.verifierVersion !== '1' || row.status !== gateReceipt.status || row.receiptHash !== gateReceipt.receiptHash
    || gateReceipt.gateId !== TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1 || gateReceipt.gateVersion !== '1'
    || gateReceipt.verifierId !== 'storyforge.author-visual-confirmation' || gateReceipt.verifierVersion !== '1'
    || gateReceipt.verifierKind !== 'human-evidence' || gateReceipt.environmentHash !== null
    || gateReceipt.thresholdProfileId !== TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_POLICY_ID_V1
    || gateReceipt.thresholdProfileVersion !== '1'
    || canonicalProductProductionJsonV2(gateReceipt.inputHashes) !== canonicalProductProductionJsonV2([
      resolved.packageHash, resolved.previewHash, resolved.briefHash,
      resolved.mediaAuditHash, resolved.visualReviewHash,
      ...[...new Set(resolved.assets.map(asset => asset.contentHash))].sort(),
    ])
    || canonicalProductProductionJsonV2(gateReceipt.evidenceRefs) !== canonicalProductProductionJsonV2([
      resolved.mediaAuditHash, resolved.visualReviewHash,
      ...[...new Set(resolved.assets.map(asset => asset.contentHash))].sort(),
    ])
    || evidence.buildNumber !== resolved.build.buildNumber || evidence.packageHash !== resolved.packageHash
    || evidence.previewHash !== resolved.previewHash || evidence.briefHash !== resolved.briefHash
    || evidence.mediaAuditHash !== resolved.mediaAuditHash || evidence.visualReviewHash !== resolved.visualReviewHash
    || canonicalProductProductionJsonV2(evidence.assets.map(asset => ({
      assetKey: asset.assetKey, artifactKey: asset.artifactKey, contentHash: asset.contentHash,
      blobContentHash: asset.blobContentHash, mimeType: asset.mimeType,
    }))) !== canonicalProductProductionJsonV2(expectedAssets)
    || gateReceipt.createdAt !== evidence.confirmedAt
    || gateReceipt.status !== (evidence.passed ? 'passed' : 'failed')) {
    fail('文字冒险人工审图 evidence、Build 或 gate receipt 不一致')
  }
  return { row, gateReceipt, evidence }
}

export async function recordTextAdventureHumanVisualReviewV1(input: {
  scope: WorkspaceScope
  productBuildId: number
  decisions: TextAdventureHumanVisualDecisionV1[]
}): Promise<VerifiedTextAdventureHumanVisualReviewGateV1> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  if (!['preview-ready', 'release-ready'].includes(build.status)) fail('Build 尚未达到逐图人工审查状态')
  const resolved = await resolveTextAdventureHumanVisualInputsV1({ scope, build })
  if (!Array.isArray(input.decisions) || input.decisions.length !== resolved.assets.length) {
    fail('逐图决定未完整覆盖当前 Build 图片')
  }
  const decisions = input.decisions.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'assetKey,decision,note'
      || !['approved', 'rejected'].includes(value.decision)
      || typeof value.note !== 'string' || value.note.length > 2_000) fail(`逐图决定无效:${index}`)
    const assetKey = boundedText(value.assetKey, `decisions[${index}].assetKey`, 500)
    const note = value.note.trim().normalize('NFC')
    if (value.decision === 'rejected' && !note) fail(`逐图退回必须填写原因:${assetKey}`)
    return { assetKey, decision: value.decision, note }
  }).sort((left, right) => left.assetKey.localeCompare(right.assetKey))
  if (new Set(decisions.map(item => item.assetKey)).size !== decisions.length
    || decisions.some((item, index) => item.assetKey !== resolved.assets[index].assetKey)) {
    fail('逐图决定存在遗漏、重复或未知 assetKey')
  }
  const confirmedAt = Math.max(Date.now(), build.createdAt)
  const evidence = parseTextAdventureHumanVisualReviewEvidenceV1({
    schema: 'storyforge.text-adventure-human-visual-review-evidence', version: 1,
    buildNumber: build.buildNumber, packageHash: resolved.packageHash, previewHash: resolved.previewHash,
    briefHash: resolved.briefHash, mediaAuditHash: resolved.mediaAuditHash,
    visualReviewHash: resolved.visualReviewHash,
    assets: resolved.assets.map((asset, index) => ({
      assetKey: asset.assetKey, artifactKey: asset.artifactKey,
      contentHash: asset.contentHash, blobContentHash: asset.blobContentHash,
      mimeType: asset.mimeType, decision: decisions[index].decision, note: decisions[index].note,
    })),
    confirmedAt,
    passed: decisions.every(item => item.decision === 'approved'),
  })
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.author-visual-confirmation', verifierVersion: '1',
    verifierKind: 'human-evidence' as const,
    inputHashes: [
      resolved.packageHash, resolved.previewHash, resolved.briefHash,
      resolved.mediaAuditHash, resolved.visualReviewHash,
      ...[...new Set(resolved.assets.map(asset => asset.contentHash))].sort(),
    ],
    environmentHash: null,
    measuredJson: canonicalProductProductionJsonV2(evidence),
    status: (evidence.passed ? 'passed' : 'failed') as ProductQualityGateReceiptStatusV1,
    thresholdProfileId: TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_POLICY_ID_V1,
    thresholdProfileVersion: '1',
    evidenceRefs: [
      resolved.mediaAuditHash, resolved.visualReviewHash,
      ...[...new Set(resolved.assets.map(asset => asset.contentHash))].sort(),
    ],
    createdAt: confirmedAt,
  }
  const gateReceipt: ProductQualityGateReceiptV1 = {
    ...body, receiptHash: await hashProductProductionValueV2(body),
  }
  const pendingRow = stampNewRecord(scope, 'productQualityGateReceipts', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    buildId: build.id!, gateId: gateReceipt.gateId, gateVersion: gateReceipt.gateVersion,
    verifierId: gateReceipt.verifierId, verifierVersion: gateReceipt.verifierVersion,
    status: gateReceipt.status, receiptJson: canonicalProductProductionJsonV2(gateReceipt),
    receiptHash: gateReceipt.receiptHash, createdAt: confirmedAt,
  } satisfies ProductQualityGateReceiptRecordV1, { owner: 'work' })
  const row = await db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects, db.productQualityGateReceipts,
  ), async () => {
    const current = await db.productBuilds.get(build.id!)
    if (!current || current.buildNumber !== build.buildNumber || current.controlEpoch !== build.controlEpoch
      || current.packageHash !== resolved.packageHash || current.previewHash !== resolved.previewHash
      || current.briefHash !== resolved.briefHash) fail('Build 在写入人工审图回执前已变化')
    for (const expected of resolved.assets) {
      const [artifact, blob] = await Promise.all([
        db.productBuildArtifacts.get(expected.artifactId),
        db.mediaBlobObjects.get(expected.blobObjectId),
      ])
      if (!artifact || !artifactScopeMatches(artifact, scope)
        || !['accepted', 'carried-forward'].includes(artifact.status)
        || artifact.buildId !== build.id || artifact.controlEpoch !== build.controlEpoch
        || artifact.artifactKey !== expected.artifactKey || artifact.contentHash !== expected.contentHash
        || artifact.blobObjectId !== expected.blobObjectId || artifact.mimeType !== expected.mimeType
        || artifact.byteSize !== expected.byteSize
        || !blob || blob.projectId !== scope.projectId || blob.worldId !== scope.worldId || blob.workId !== scope.workId
        || blob.storageState !== 'ready' || blob.contentHash !== expected.blobContentHash
        || blob.mimeType !== expected.mimeType || blob.byteSize !== expected.byteSize) {
        fail(`图片在写入人工审图回执前已变化:${expected.assetKey}`)
      }
    }
    for (const [artifactKey, contentHash] of [
      ['media.audit', resolved.mediaAuditHash], ['quality.visual-review', resolved.visualReviewHash],
    ] as const) {
      const artifact = await db.productBuildArtifacts.where('[buildId+artifactKey]')
        .equals([build.id!, artifactKey]).filter(item => item.status === 'accepted' || item.status === 'carried-forward').first()
      if (!artifact || artifact.contentHash !== contentHash || artifact.controlEpoch !== build.controlEpoch) {
        fail(`${artifactKey} 在写入人工审图回执前已变化`)
      }
    }
    const latest = (await db.productQualityGateReceipts
      .where('[buildId+gateId]').equals([build.id!, TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1]).toArray())
      .filter(item => item.gateVersion === '1')
      .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))[0]
    if (latest) {
      if (!await assertRecordInScope(scope, 'productQualityGateReceipts', latest, { owner: 'work' })) {
        fail('人工审图回执跨 Work')
      }
      const verifiedLatest = await verifyTextAdventureHumanVisualReviewGateV1(latest, resolved)
      const latestDecisions = verifiedLatest.evidence.assets.map(asset => ({
        assetKey: asset.assetKey, decision: asset.decision, note: asset.note,
      }))
      if (canonicalProductProductionJsonV2(latestDecisions) === canonicalProductProductionJsonV2(decisions)) {
        return latest
      }
    }
    const existing = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([build.id!, gateReceipt.gateId, gateReceipt.receiptHash]).first()
    if (existing) return existing
    const id = await db.productQualityGateReceipts.add(pendingRow) as number
    return { ...pendingRow, id }
  })
  const verified = await verifyTextAdventureHumanVisualReviewGateV1(row, resolved)
  await reconcileCommercialProductBuildReadinessV1({ scope, productBuildId: build.id! })
  return verified
}

export async function readLatestTextAdventureHumanVisualReviewGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedTextAdventureHumanVisualReviewGateV1 | null> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  const rows = (await db.productQualityGateReceipts
    .where('[buildId+gateId]').equals([build.id!, TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1]).toArray())
    .filter(row => row.gateVersion === '1')
    .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
  const latest = rows[0]
  if (!latest) return null
  if (!await assertRecordInScope(scope, 'productQualityGateReceipts', latest, { owner: 'work' })) fail('人工审图回执跨 Work')
  const resolved = await resolveTextAdventureHumanVisualInputsV1({ scope, build })
  return verifyTextAdventureHumanVisualReviewGateV1(latest, resolved)
}

export async function requirePassedTextAdventureHumanVisualReviewGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedTextAdventureHumanVisualReviewGateV1> {
  const latest = await readLatestTextAdventureHumanVisualReviewGateV1(input)
  if (!latest) fail('商业候选缺少作者逐图确认回执')
  if (latest.gateReceipt.status !== 'passed' || !latest.evidence.passed) {
    const rejected = latest.evidence.assets.filter(asset => asset.decision === 'rejected')
      .map(asset => `${asset.assetKey}:${asset.note}`)
    fail(`商业候选逐图确认未通过:${rejected.join(',') || 'unknown'}`)
  }
  return latest
}

export async function listCompletedProductBuildPlaythroughsV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<CompletedProductBuildPlaythroughV1[]> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  const sessions = await db.productRuntimeSessions.where('productBuildId').equals(build.id!).toArray()
  const completed: CompletedProductBuildPlaythroughV1[] = []
  for (const session of sessions) {
    if (session.projectId !== scope.projectId || session.worldId !== scope.worldId || session.workId !== scope.workId
      || session.productReleaseId != null || session.runtimeSourceHash !== build.packageHash) continue
    const state = await readProductRuntimeState(session.id!)
    if (!state.narrative?.completed || !state.narrative.endingKey
      || state.narrative.contentHash !== build.packageHash) continue
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray()
    const routeEvents = await createRouteEvidence(events)
    const actionEvents = session.kind === 'text-adventure'
      ? await createHumanPlaytestActionEvidence(events) : []
    const ending = routeEvents[routeEvents.length - 1]
    const started = routeEvents[0]
    const committedActions = events.filter(event => event.type === 'adventure.action.committed')
    const dialogueActionCount = committedActions.filter(event => {
      const payload = eventPayload(event)
      return payload.kind === 'talk'
    }).length
    const meaningfulActionCount = new Set(committedActions.filter(event => {
      const payload = eventPayload(event)
      return payload.outcome !== 'not-attempted'
    }).map(event => boundedText(eventPayload(event).actionKey, 'adventure.action.actionKey', 500))).size
    completed.push({
      sessionId: session.id!, sessionKind: session.kind, endingKey: ending.endingKey!,
      choiceCount: routeEvents.filter(event => event.kind === 'choice').length,
      actionCount: committedActions.length, meaningfulActionCount, dialogueActionCount,
      startedAt: started.createdAt, completedAt: ending.createdAt,
      elapsedMs: Math.max(0, ending.createdAt - started.createdAt),
      eventStreamHash: await hashProductProductionValueV2(
        humanPlaytestEventStreamProjection(routeEvents, actionEvents),
      ),
    })
  }
  return completed.sort((left, right) => right.completedAt - left.completedAt || right.sessionId - left.sessionId)
}

export async function recordProductBuildMainRoutePlaythroughV1(input: {
  scope: WorkspaceScope
  productBuildId: number
  productRuntimeSessionId: number
  authorConfirmation: 'author-confirmed-main-route'
  environment: ProductPlaythroughBrowserEnvironmentV1
}): Promise<VerifiedProductMainRoutePlaythroughGateV1> {
  if (input.authorConfirmation !== 'author-confirmed-main-route') fail('必须由作者明确确认已完成主路线试玩')
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  if (!['preview-ready', 'release-ready'].includes(build.status)) fail('Build 尚未达到可试玩验收状态')
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefHash !== build.briefHash) fail('Build 对应 Brief 不存在或 hash 不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (await hashProductProductionValueV2(brief) !== briefRow.briefHash) fail('Build 对应 Brief hash 校验失败')
  if (brief.qualityProfile !== 'commercial-candidate') fail('主路线人工回执只用于商业候选 Build')
  const session = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
  const expectedSessionKind: ProductRuntimeKind = brief.intent.productType
  if (!session || session.projectId !== scope.projectId || session.worldId !== scope.worldId
    || session.workId !== scope.workId || session.productBuildId !== build.id || session.productReleaseId != null
    || session.runtimeSourceHash !== build.packageHash || session.kind !== expectedSessionKind) {
    fail('试玩会话未绑定当前 Build/packageHash/产品类型')
  }
  const [state, events] = await Promise.all([
    readProductRuntimeState(session.id!),
    db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray(),
  ])
  if (!state.narrative?.completed || !state.narrative.endingKey
    || state.narrative.contentHash !== build.packageHash) fail('试玩尚未到达当前 Build 的冻结叙事结局')
  for (const event of events) {
    if (event.projectId !== scope.projectId || event.sessionId !== session.id
      || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)) fail('试玩事件作用域不一致')
  }
  const routeEvents = await createRouteEvidence(events)
  const endingKey = routeEvents[routeEvents.length - 1].endingKey!
  if (endingKey !== state.narrative.endingKey) fail('事件路线与重放终态结局不一致')
  const environment = parsePlaythroughEnvironment(input.environment)
  const confirmedAt = Math.max(Date.now(), routeEvents[routeEvents.length - 1].createdAt)
  const eventStreamHash = await hashProductProductionValueV2(routeEvents)
  const evidence: ProductMainRoutePlaythroughEvidenceV1 = {
    schema: 'storyforge.product-main-route-playthrough-evidence', version: 1,
    packageHash: build.packageHash, previewHash: build.previewHash,
    runtimeSourceHash: session.runtimeSourceHash!, sessionKind: session.kind,
    routeEvents, eventStreamHash,
    choiceCount: routeEvents.filter(event => event.kind === 'choice').length,
    endingKey, environment,
    confirmation: { kind: 'author-confirmed-main-route', confirmedAt },
  }
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.author-main-route-confirmation', verifierVersion: '1',
    verifierKind: 'human-evidence' as const,
    inputHashes: [build.packageHash, build.previewHash, eventStreamHash],
    environmentHash: await hashProductProductionValueV2(environment),
    measuredJson: canonicalProductProductionJsonV2(evidence),
    status: 'passed' as const,
    thresholdProfileId: PRODUCT_MAIN_ROUTE_PLAYTHROUGH_POLICY_ID_V1,
    thresholdProfileVersion: '1', evidenceRefs: [eventStreamHash], createdAt: confirmedAt,
  }
  const gateReceipt: ProductQualityGateReceiptV1 = {
    ...body, receiptHash: await hashProductProductionValueV2(body),
  }
  const pendingRow = stampNewRecord(scope, 'productQualityGateReceipts', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    buildId: build.id!, gateId: gateReceipt.gateId, gateVersion: gateReceipt.gateVersion,
    verifierId: gateReceipt.verifierId, verifierVersion: gateReceipt.verifierVersion,
    status: gateReceipt.status, receiptJson: canonicalProductProductionJsonV2(gateReceipt),
    receiptHash: gateReceipt.receiptHash, createdAt: confirmedAt,
  } satisfies ProductQualityGateReceiptRecordV1, { owner: 'work' })
  const row = await db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productProductionBriefs, db.productRuntimeSessions,
    db.productRuntimeEvents, db.productQualityGateReceipts,
  ), async () => {
    const [currentBuild, currentBrief, currentSession] = await Promise.all([
      db.productBuilds.get(build.id!),
      db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first(),
      db.productRuntimeSessions.get(session.id!),
    ])
    if (!currentBuild || currentBuild.packageHash !== build.packageHash || currentBuild.previewHash !== build.previewHash
      || !currentBrief || currentBrief.briefHash !== briefRow.briefHash
      || !currentSession || currentSession.productBuildId !== build.id
      || currentSession.runtimeSourceHash !== build.packageHash) fail('Build/Brief/试玩会话在写入回执前已变化')
    const currentRouteEvents = (await db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray())
      .filter(event => ['narrative.started', 'narrative.choice.committed', 'narrative.ending.reached'].includes(event.type))
      .sort((left, right) => left.sequence - right.sequence)
    if (currentRouteEvents.length !== routeEvents.length
      || currentRouteEvents.some((event, index) => event.sequence !== routeEvents[index].sequence)) {
      fail('试玩路线在写入回执前已变化')
    }
    const existing = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([
        build.id!, gateReceipt.gateId, gateReceipt.receiptHash,
      ]).first()
    if (existing) return existing
    const id = await db.productQualityGateReceipts.add(pendingRow) as number
    return { ...pendingRow, id }
  })
  const verified = await verifyPlaythroughGateReceipt(row, {
    buildId: build.id!, packageHash: build.packageHash, previewHash: build.previewHash,
  })
  await reconcileCommercialProductBuildReadinessV1({ scope, productBuildId: build.id! })
  return verified
}

export async function readLatestProductBuildMainRouteGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedProductMainRoutePlaythroughGateV1 | null> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  const rows = await db.productQualityGateReceipts
    .where('[buildId+gateId]').equals([build.id!, PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1]).toArray()
  rows.sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
  const latest = rows[0]
  if (!latest) return null
  if (!await assertRecordInScope(scope, 'productQualityGateReceipts', latest, { owner: 'work' })) fail('质量回执跨 Work')
  return verifyPlaythroughGateReceipt(latest, {
    buildId: build.id!, packageHash: build.packageHash, previewHash: build.previewHash,
  })
}

export async function requirePassedProductBuildMainRouteGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedProductMainRoutePlaythroughGateV1> {
  const latest = await readLatestProductBuildMainRouteGateV1(input)
  if (!latest) fail('商业候选缺少作者确认的真实主路线试玩回执')
  if (latest.gateReceipt.status !== 'passed') fail('商业候选主路线试玩回执未通过')
  return latest
}

export async function recordTextAdventureHumanPlaytestV1(input: {
  scope: WorkspaceScope
  productBuildId: number
  productRuntimeSessionId: number
  participantRole: TextAdventureHumanPlaytestParticipantRoleV1
  participantLabel: string
  participantDeclaration: 'author-self-attestation' | 'not-involved-in-production'
  assessment: TextAdventureHumanPlaytestAssessmentV1
  environment: ProductPlaythroughBrowserEnvironmentV1
}): Promise<VerifiedTextAdventureHumanPlaytestGateV1> {
  if (!['author', 'independent-player'].includes(input.participantRole)) fail('真人试玩参与者角色无效')
  const participant = {
    label: boundedText(input.participantLabel, '真人试玩参与者标识', 200),
    declaration: input.participantDeclaration,
  }
  if (participant.declaration !== (input.participantRole === 'author'
    ? 'author-self-attestation' : 'not-involved-in-production')) fail('真人试玩身份声明与角色不一致')
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  if (!['preview-ready', 'release-ready'].includes(build.status)) fail('Build 尚未达到可试玩验收状态')
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefHash !== build.briefHash) fail('Build 对应 Brief 不存在或 hash 不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (await hashProductProductionValueV2(brief) !== briefRow.briefHash) fail('Build 对应 Brief hash 校验失败')
  if (brief.intent.productType !== 'text-adventure' || brief.qualityProfile !== 'commercial-candidate') {
    fail('双角色真人试玩回执只用于商业候选文字冒险 Build')
  }
  const session = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
  if (!session || session.projectId !== scope.projectId || session.worldId !== scope.worldId
    || session.workId !== scope.workId || session.productBuildId !== build.id || session.productReleaseId != null
    || session.runtimeSourceHash !== build.packageHash || session.kind !== 'text-adventure') {
    fail('真人试玩会话未绑定当前文字冒险 Build/packageHash')
  }
  const [state, events] = await Promise.all([
    readProductRuntimeState(session.id!),
    db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray(),
  ])
  if (!state.narrative?.completed || !state.narrative.endingKey
    || state.narrative.contentHash !== build.packageHash) fail('真人试玩尚未到达当前 Build 的冻结叙事结局')
  for (const event of events) {
    if (event.projectId !== scope.projectId || event.sessionId !== session.id
      || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)) fail('真人试玩事件作用域不一致')
  }
  const [routeEvents, actionEvents] = await Promise.all([
    createRouteEvidence(events), createHumanPlaytestActionEvidence(events),
  ])
  const preview = await verifyProductBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.previewHash !== build.previewHash || preview.packageHash !== build.packageHash
    || preview.runtimePackage.productType !== 'text-adventure' || preview.runtimePackage.adventure?.version !== 2) {
    fail('真人试玩 Build Preview 不是当前冻结 Adventure V2 包')
  }
  let routeNodeKey = preview.runtimePackage.narrative.entryNodeKey
  if (routeEvents[0].nodeKey !== routeNodeKey) fail('真人试玩起点与当前 Build 不一致')
  for (const event of routeEvents.slice(1, -1)) {
    const choice = preview.runtimePackage.narrative.choices.find(item => item.choiceKey === event.choiceKey)
    if (!choice || choice.sourceNodeKey !== routeNodeKey || event.fromNodeKey !== routeNodeKey
      || choice.targetNodeKey !== event.toNodeKey) fail(`真人试玩选择不属于当前 Build:${event.choiceKey ?? 'missing'}`)
    routeNodeKey = choice.targetNodeKey
  }
  if (routeNodeKey !== routeEvents[routeEvents.length - 1].endingKey
    || preview.runtimePackage.narrative.nodes.find(node => node.key === routeNodeKey)?.kind !== 'ending') {
    fail('真人试玩结局不属于当前 Build')
  }
  const buildActions = new Map(preview.runtimePackage.adventure.actions.map(action => [action.key, action.kind]))
  if (actionEvents.some(event => buildActions.get(event.actionKey) !== event.kind)) {
    fail('真人试玩包含不属于当前 Build 的行动')
  }
  const startedAt = routeEvents[0].createdAt
  const completedAt = routeEvents[routeEvents.length - 1].createdAt
  if (completedAt <= startedAt) fail('真人试玩缺少可计时的真实起止间隔')
  const endingKey = routeEvents[routeEvents.length - 1].endingKey!
  if (endingKey !== state.narrative.endingKey) fail('真人试玩路线与重放终态结局不一致')
  const targetPlayMinutes = Math.round(brief.scale.targetPlayMinutes)
  const thresholds = {
    targetPlayMinutes,
    minimumElapsedMs: Math.max(60_000, Math.round(targetPlayMinutes * 60_000 * 0.75)),
    maximumElapsedMs: Math.max(60_000, Math.round(targetPlayMinutes * 60_000 * 1.25)),
    minimumChoiceCount: Math.max(2, Math.ceil(targetPlayMinutes / 6)),
    minimumActionCount: Math.max(6, Math.ceil(targetPlayMinutes / 4)),
  }
  const environment = parsePlaythroughEnvironment(input.environment)
  const assessment = parseHumanPlaytestAssessment(input.assessment)
  const confirmedAt = Math.max(Date.now(), completedAt)
  const eventStreamHash = await hashProductProductionValueV2(
    humanPlaytestEventStreamProjection(routeEvents, actionEvents),
  )
  const sessionWithoutHash: Omit<TextAdventureHumanPlaytestSessionEvidenceV1, 'sessionEvidenceHash'> = {
    participantRole: input.participantRole, participant, sessionKind: 'text-adventure', routeEvents, actionEvents,
    eventStreamHash, endingKey, startedAt, completedAt, elapsedMs: completedAt - startedAt,
    choiceCount: routeEvents.filter(event => event.kind === 'choice').length,
    actionCount: actionEvents.length,
    meaningfulActionCount: new Set(actionEvents.filter(event => event.outcome !== 'not-attempted')
      .map(event => event.actionKey)).size,
    dialogueActionCount: actionEvents.filter(event => event.kind === 'talk').length,
    thresholds, environment, assessment, confirmedAt, passed: false,
  }
  sessionWithoutHash.passed = humanPlaytestSessionPassed(sessionWithoutHash)
  const candidateSession: TextAdventureHumanPlaytestSessionEvidenceV1 = {
    ...sessionWithoutHash,
    sessionEvidenceHash: await humanPlaytestSessionEvidenceHash(sessionWithoutHash),
  }
  const prior = await readLatestTextAdventureHumanPlaytestGateV1({ scope, productBuildId: build.id! })
  const priorSameStream = prior?.evidence.sessions.find(item => item.eventStreamHash === eventStreamHash) ?? null
  if (priorSameStream && priorSameStream.participantRole !== input.participantRole) {
    fail('同一个事件流不能同时冒充作者与独立玩家试玩')
  }
  if (priorSameStream && canonicalProductProductionJsonV2({
    ...priorSameStream, confirmedAt: 0, sessionEvidenceHash: '',
  }) === canonicalProductProductionJsonV2({
    ...candidateSession, confirmedAt: 0, sessionEvidenceHash: '',
  })) return prior!
  const sessions = [
    ...(prior?.evidence.sessions.filter(item => item.eventStreamHash !== eventStreamHash) ?? []),
    candidateSession,
  ].sort((left, right) => left.confirmedAt - right.confirmedAt
    || left.sessionEvidenceHash.localeCompare(right.sessionEvidenceHash))
  if (sessions.length > 20) fail('真人试玩回执最多保留 20 个完整会话；请生成新 Build 收口历史')
  const author = latestHumanSession(sessions, 'author')
  const independent = latestHumanSession(sessions, 'independent-player')
  const evidence: TextAdventureHumanPlaytestCoverageEvidenceV1 = {
    schema: 'storyforge.text-adventure-human-playtest-coverage-evidence', version: 1,
    buildNumber: build.buildNumber, packageHash: build.packageHash, previewHash: build.previewHash,
    briefHash: build.briefHash, sessions,
    authorSessionEvidenceHash: author?.sessionEvidenceHash ?? null,
    independentPlayerSessionEvidenceHash: independent?.sessionEvidenceHash ?? null,
    passed: Boolean(author?.passed && independent?.passed && author.eventStreamHash !== independent.eventStreamHash),
  }
  const status = humanCoverageStatus(evidence)
  const sessionHashes = sessions.map(item => item.sessionEvidenceHash)
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.text-adventure-human-playtest-coverage', verifierVersion: '1',
    verifierKind: 'human-evidence' as const,
    inputHashes: [build.packageHash, build.previewHash, build.briefHash, ...sessionHashes],
    environmentHash: await hashProductProductionValueV2(sessions.map(item => ({
      participantRole: item.participantRole,
      sessionEvidenceHash: item.sessionEvidenceHash,
      environment: item.environment,
    }))),
    measuredJson: canonicalProductProductionJsonV2(evidence), status,
    thresholdProfileId: TEXT_ADVENTURE_HUMAN_PLAYTEST_POLICY_ID_V1,
    thresholdProfileVersion: '1', evidenceRefs: sessionHashes,
    createdAt: Math.max(...sessions.map(item => item.confirmedAt)),
  }
  const gateReceipt: ProductQualityGateReceiptV1 = {
    ...body, receiptHash: await hashProductProductionValueV2(body),
  }
  const pendingRow = stampNewRecord(scope, 'productQualityGateReceipts', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    buildId: build.id!, gateId: gateReceipt.gateId, gateVersion: gateReceipt.gateVersion,
    verifierId: gateReceipt.verifierId, verifierVersion: gateReceipt.verifierVersion,
    status: gateReceipt.status, receiptJson: canonicalProductProductionJsonV2(gateReceipt),
    receiptHash: gateReceipt.receiptHash, createdAt: gateReceipt.createdAt,
  } satisfies ProductQualityGateReceiptRecordV1, { owner: 'work' })
  const relevantSequences = new Set([...routeEvents, ...actionEvents].map(event => event.sequence))
  const frozenRelevantEvents = events.filter(event => relevantSequences.has(event.sequence))
    .map(event => ({ sequence: event.sequence, type: event.type, payloadJson: event.payloadJson, createdAt: event.createdAt }))
    .sort((left, right) => left.sequence - right.sequence)
  const row = await db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productProductionBriefs, db.productRuntimeSessions,
    db.productRuntimeEvents, db.productQualityGateReceipts,
  ), async () => {
    const [currentBuild, currentBrief, currentSession] = await Promise.all([
      db.productBuilds.get(build.id!),
      db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first(),
      db.productRuntimeSessions.get(session.id!),
    ])
    if (!currentBuild || currentBuild.packageHash !== build.packageHash || currentBuild.previewHash !== build.previewHash
      || !currentBrief || currentBrief.briefHash !== briefRow.briefHash
      || !currentSession || currentSession.productBuildId !== build.id
      || currentSession.runtimeSourceHash !== build.packageHash) fail('Build/Brief/真人试玩会话在写入回执前已变化')
    const currentRelevantEvents = (await db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray())
      .filter(event => relevantSequences.has(event.sequence))
      .map(event => ({ sequence: event.sequence, type: event.type, payloadJson: event.payloadJson, createdAt: event.createdAt }))
      .sort((left, right) => left.sequence - right.sequence)
    if (canonicalProductProductionJsonV2(currentRelevantEvents) !== canonicalProductProductionJsonV2(frozenRelevantEvents)) {
      fail('真人试玩事件流在写入回执前已变化')
    }
    const existing = await db.productQualityGateReceipts
      .where('[buildId+gateId+receiptHash]').equals([build.id!, gateReceipt.gateId, gateReceipt.receiptHash]).first()
    if (existing) return existing
    const id = await db.productQualityGateReceipts.add(pendingRow) as number
    return { ...pendingRow, id }
  })
  const verified = await verifyTextAdventureHumanPlaytestGateReceiptV1(row, {
    buildId: build.id!, buildNumber: build.buildNumber, packageHash: build.packageHash,
    previewHash: build.previewHash, briefHash: build.briefHash, targetPlayMinutes,
  })
  await reconcileCommercialProductBuildReadinessV1({ scope, productBuildId: build.id! })
  return verified
}

export async function readLatestTextAdventureHumanPlaytestGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedTextAdventureHumanPlaytestGateV1 | null> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.briefHash !== build.briefHash) fail('Build 对应 Brief 不存在或 hash 不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (await hashProductProductionValueV2(brief) !== build.briefHash) fail('Build 对应 Brief hash 校验失败')
  const rows = await db.productQualityGateReceipts
    .where('[buildId+gateId]').equals([build.id!, TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1]).toArray()
  rows.sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
  const latest = rows[0]
  if (!latest) return null
  if (!await assertRecordInScope(scope, 'productQualityGateReceipts', latest, { owner: 'work' })) fail('质量回执跨 Work')
  return verifyTextAdventureHumanPlaytestGateReceiptV1(latest, {
    buildId: build.id!, buildNumber: build.buildNumber, packageHash: build.packageHash,
    previewHash: build.previewHash, briefHash: build.briefHash,
    targetPlayMinutes: Math.round(brief.scale.targetPlayMinutes),
  })
}

export async function requirePassedTextAdventureHumanPlaytestGateV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<VerifiedTextAdventureHumanPlaytestGateV1> {
  const latest = await readLatestTextAdventureHumanPlaytestGateV1(input)
  if (!latest) fail('商业文字冒险缺少作者与独立玩家双角色真人试玩回执')
  if (latest.gateReceipt.status !== 'passed' || !latest.evidence.passed) {
    fail('商业文字冒险真人试玩尚未由作者与独立玩家分别通过')
  }
  return latest
}

/**
 * Build.status is a recoverable projection of immutable commercial receipts.
 * It is promoted only when browser performance, author-confirmed main route,
 * exact-asset browser decoding and (for illustrated text adventures) the
 * independent author visual approval receipt all pass.
 * A newer failure in any required gate downgrades the recoverable projection.
 */
export async function reconcileCommercialProductBuildReadinessV1(input: {
  scope: WorkspaceScope
  productBuildId: number
}): Promise<'preview-ready' | 'release-ready' | 'released'> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) fail('Build 不存在或跨 Work')
  if (build.status === 'released') return 'released'
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || briefRow.briefHash !== build.briefHash) fail('Build 对应 Brief 不存在或 hash 不一致')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (await hashProductProductionValueV2(brief) !== briefRow.briefHash) fail('Build 对应 Brief hash 校验失败')
  if (brief.qualityProfile !== 'commercial-candidate') {
    return build.status === 'release-ready' ? 'release-ready' : 'preview-ready'
  }
  const mediaRequired = brief.media.requiredMediaKinds.length > 0
  const humanPlaytestRequired = brief.intent.productType === 'text-adventure'
  const humanVisualRequired = brief.intent.productType === 'text-adventure' && mediaRequired
  const [performance, playthrough, humanPlaytest, mediaRuntime, humanVisual] = await Promise.all([
    readLatestProductBrowserPerformanceGateV1({ scope, productBuildId: build.id! }),
    readLatestProductBuildMainRouteGateV1({ scope, productBuildId: build.id! }),
    humanPlaytestRequired
      ? readLatestTextAdventureHumanPlaytestGateV1({ scope, productBuildId: build.id! })
      : Promise.resolve(null),
    mediaRequired
      ? readLatestProductMediaRuntimeGateV1({ scope, productBuildId: build.id! })
      : Promise.resolve(null),
    humanVisualRequired
      ? readLatestTextAdventureHumanVisualReviewGateV1({ scope, productBuildId: build.id! })
      : Promise.resolve(null),
  ])
  const nextStatus = performance?.gateReceipt.status === 'passed'
    && performance.evidence.receipt.passed
    && playthrough?.gateReceipt.status === 'passed'
    && (!humanPlaytestRequired || humanPlaytest?.gateReceipt.status === 'passed' && humanPlaytest.evidence.passed)
    && (!mediaRequired || mediaRuntime?.gateReceipt.status === 'passed' && mediaRuntime.evidence.passed)
    && (!humanVisualRequired || humanVisual?.gateReceipt.status === 'passed' && humanVisual.evidence.passed)
    ? 'release-ready' as const : 'preview-ready' as const
  return db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productQualityGateReceipts), async () => {
    const current = await db.productBuilds.get(build.id!)
    if (!current || current.packageHash !== build.packageHash || current.previewHash !== build.previewHash) {
      fail('Build 在刷新商业门状态前已变化')
    }
    const latestFor = async (gateId: string, gateVersion?: string) => {
      let rows = await db.productQualityGateReceipts.where('[buildId+gateId]').equals([build.id!, gateId]).toArray()
      if (gateVersion) rows = rows.filter(row => row.gateVersion === gateVersion)
      rows.sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
      return rows[0] ?? null
    }
    const [currentPerformance, currentPlaythrough, currentHumanPlaytest, currentMediaRuntime, currentHumanVisual] = await Promise.all([
      latestFor(PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1),
      latestFor(PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1),
      humanPlaytestRequired
        ? latestFor(TEXT_ADVENTURE_HUMAN_PLAYTEST_GATE_ID_V1, '1')
        : Promise.resolve(null),
      mediaRequired ? latestFor(PRODUCT_MEDIA_RUNTIME_GATE_ID_V1, '2') : Promise.resolve(null),
      humanVisualRequired
        ? latestFor(TEXT_ADVENTURE_HUMAN_VISUAL_REVIEW_GATE_ID_V1, '1')
        : Promise.resolve(null),
    ])
    if ((currentPerformance?.receiptHash ?? null) !== (performance?.row.receiptHash ?? null)
      || (currentPlaythrough?.receiptHash ?? null) !== (playthrough?.row.receiptHash ?? null)
      || (currentHumanPlaytest?.receiptHash ?? null) !== (humanPlaytest?.row.receiptHash ?? null)
      || (currentMediaRuntime?.receiptHash ?? null) !== (mediaRuntime?.row.receiptHash ?? null)
      || (currentHumanVisual?.receiptHash ?? null) !== (humanVisual?.row.receiptHash ?? null)) {
      fail('质量回执在刷新 Build 状态前已变化')
    }
    if (current.status !== nextStatus) {
      await db.productBuilds.update(current.id!, {
        status: nextStatus, stateRevision: current.stateRevision + 1, updatedAt: Date.now(),
      })
    }
    return nextStatus
  })
}
