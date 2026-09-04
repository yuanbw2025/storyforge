import { db } from '../db/schema'
import type {
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

export const PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1 = 'browser.performance.desktop'
export const PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1 = 'playthrough.main-route'
export const PRODUCT_MAIN_ROUTE_PLAYTHROUGH_POLICY_ID_V1 = 'storyforge.product-main-route-playthrough.v1'
export const PRODUCT_MEDIA_RUNTIME_GATE_ID_V1 = 'media.runtime.decode'
export const PRODUCT_MEDIA_RUNTIME_POLICY_ID_V1 = 'storyforge.product-media-runtime.v2'

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

export interface CompletedProductBuildPlaythroughV1 {
  sessionId: number
  sessionKind: ProductRuntimeKind
  endingKey: string
  choiceCount: number
  completedAt: number
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
    const ending = routeEvents[routeEvents.length - 1]
    completed.push({
      sessionId: session.id!, sessionKind: session.kind, endingKey: ending.endingKey!,
      choiceCount: routeEvents.filter(event => event.kind === 'choice').length,
      completedAt: ending.createdAt,
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

/**
 * Build.status is a recoverable projection of immutable commercial receipts.
 * It is promoted only when browser performance, author-confirmed main route,
 * and (when the Brief requests media) exact-asset browser decoding all pass.
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
  const [performance, playthrough, mediaRuntime] = await Promise.all([
    readLatestProductBrowserPerformanceGateV1({ scope, productBuildId: build.id! }),
    readLatestProductBuildMainRouteGateV1({ scope, productBuildId: build.id! }),
    mediaRequired
      ? readLatestProductMediaRuntimeGateV1({ scope, productBuildId: build.id! })
      : Promise.resolve(null),
  ])
  const nextStatus = performance?.gateReceipt.status === 'passed'
    && performance.evidence.receipt.passed
    && playthrough?.gateReceipt.status === 'passed'
    && (!mediaRequired || mediaRuntime?.gateReceipt.status === 'passed' && mediaRuntime.evidence.passed)
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
    const [currentPerformance, currentPlaythrough, currentMediaRuntime] = await Promise.all([
      latestFor(PRODUCT_BROWSER_PERFORMANCE_GATE_ID_V1),
      latestFor(PRODUCT_MAIN_ROUTE_PLAYTHROUGH_GATE_ID_V1),
      mediaRequired ? latestFor(PRODUCT_MEDIA_RUNTIME_GATE_ID_V1, '2') : Promise.resolve(null),
    ])
    if ((currentPerformance?.receiptHash ?? null) !== (performance?.row.receiptHash ?? null)
      || (currentPlaythrough?.receiptHash ?? null) !== (playthrough?.row.receiptHash ?? null)
      || (currentMediaRuntime?.receiptHash ?? null) !== (mediaRuntime?.row.receiptHash ?? null)) {
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
