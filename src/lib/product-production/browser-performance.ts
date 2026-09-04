import { hashProductProductionValueV2 } from './hash'

export const PRODUCT_BROWSER_PERFORMANCE_POLICY_V1 = {
  policyId: 'storyforge.product-browser-performance.v1',
  maximumFirstInteractiveBytes: 12 * 1024 * 1024,
  maximumCachedSceneP95Ms: 250,
  maximumChoiceInputP95Ms: 100,
  maximumDesktopHeapBytes: 350 * 1024 * 1024,
  maximumLongRunGrowthRatio: 0.1,
  minimumLatencySamples: 20,
  minimumLongRunDurationMs: 30 * 60 * 1000,
  warmupDurationMs: 5 * 60 * 1000,
  maximumLatencySamples: 10_000,
  maximumMemorySamples: 10_000,
} as const

export interface ProductBrowserPerformanceMeasurementV1 {
  runtimeVerifier?: 'playwright-cdp' | 'in-app-browser-lab'
  browserName: string
  browserVersion: string
  platform: string
  viewport: { width: number; height: number }
  packageHash: string
  previewHash: string
  firstInteractiveBytes: number
  cachedSceneLatenciesMs: number[]
  choiceInputLatenciesMs: number[]
  memorySamples: Array<{ elapsedMs: number; usedHeapBytes: number }>
  measuredAt: number
}

export interface ProductBrowserPerformanceReceiptV1 {
  schema: 'storyforge.product-browser-performance-receipt'
  version: 1
  policyId: typeof PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.policyId
  packageHash: string
  previewHash: string
  environment: Pick<ProductBrowserPerformanceMeasurementV1, 'browserName' | 'browserVersion' | 'platform' | 'viewport'>
  metrics: {
    firstInteractiveBytes: number
    cachedSceneP95Ms: number | null
    choiceInputP95Ms: number | null
    peakUsedHeapBytes: number | null
    longRunDurationMs: number
    longRunGrowthRatio: number | null
    sceneSamples: number
    inputSamples: number
    memorySamples: number
  }
  failures: string[]
  passed: boolean
  measuredAt: number
  receiptHash: string
}

function validHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}

function validNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function p95(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}

export async function createProductBrowserPerformanceReceiptV1(
  measurement: ProductBrowserPerformanceMeasurementV1,
): Promise<ProductBrowserPerformanceReceiptV1> {
  if (!validHash(measurement.packageHash) || !validHash(measurement.previewHash)) {
    throw new Error('[product-browser-performance] packageHash/previewHash 无效')
  }
  if (measurement.runtimeVerifier != null
    && !['playwright-cdp', 'in-app-browser-lab'].includes(measurement.runtimeVerifier)) {
    throw new Error('[product-browser-performance] runtimeVerifier 无效')
  }
  if (!measurement.browserName.trim() || !measurement.browserVersion.trim() || !measurement.platform.trim()
    || measurement.browserName.length > 200 || measurement.browserVersion.length > 200 || measurement.platform.length > 200
    || !Number.isInteger(measurement.viewport.width) || measurement.viewport.width < 1
    || !Number.isInteger(measurement.viewport.height) || measurement.viewport.height < 1
    || !Number.isInteger(measurement.measuredAt) || measurement.measuredAt < 1
    || !validNumber(measurement.firstInteractiveBytes)
    || measurement.cachedSceneLatenciesMs.length > PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumLatencySamples
    || measurement.choiceInputLatenciesMs.length > PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumLatencySamples
    || measurement.memorySamples.length > PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumMemorySamples
    || measurement.cachedSceneLatenciesMs.some(value => !validNumber(value))
    || measurement.choiceInputLatenciesMs.some(value => !validNumber(value))
    || measurement.memorySamples.some(sample => !validNumber(sample.elapsedMs) || !validNumber(sample.usedHeapBytes))) {
    throw new Error('[product-browser-performance] measurement 无效')
  }
  const memorySamples = [...measurement.memorySamples].sort((left, right) => left.elapsedMs - right.elapsedMs)
  const lastMemorySample = memorySamples[memorySamples.length - 1] ?? null
  const longRunDurationMs = lastMemorySample?.elapsedMs ?? 0
  const warmup = memorySamples.find(sample => sample.elapsedMs >= PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs)
  const final = longRunDurationMs >= PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs
    ? lastMemorySample : null
  const longRunGrowthRatio = warmup && final
    ? warmup.usedHeapBytes === 0 ? final.usedHeapBytes === 0 ? 0 : null
      : (final.usedHeapBytes - warmup.usedHeapBytes) / warmup.usedHeapBytes
    : null
  const cachedSceneP95Ms = p95(measurement.cachedSceneLatenciesMs)
  const choiceInputP95Ms = p95(measurement.choiceInputLatenciesMs)
  const peakUsedHeapBytes = memorySamples.length
    ? Math.max(...memorySamples.map(sample => sample.usedHeapBytes)) : null
  const failures: string[] = []
  if (measurement.firstInteractiveBytes > PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumFirstInteractiveBytes) failures.push('first-interactive-bytes')
  if (measurement.cachedSceneLatenciesMs.length < PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLatencySamples) failures.push('scene-sample-count')
  else if (cachedSceneP95Ms == null || cachedSceneP95Ms > PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumCachedSceneP95Ms) failures.push('cached-scene-p95')
  if (measurement.choiceInputLatenciesMs.length < PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLatencySamples) failures.push('input-sample-count')
  else if (choiceInputP95Ms == null || choiceInputP95Ms > PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumChoiceInputP95Ms) failures.push('choice-input-p95')
  if (peakUsedHeapBytes == null) failures.push('heap-measurement-missing')
  else if (peakUsedHeapBytes > PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumDesktopHeapBytes) failures.push('desktop-heap-peak')
  if (longRunDurationMs < PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs || longRunGrowthRatio == null) failures.push('long-run-incomplete')
  else if (longRunGrowthRatio > PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumLongRunGrowthRatio) failures.push('long-run-memory-growth')
  const body = {
    schema: 'storyforge.product-browser-performance-receipt' as const,
    version: 1 as const,
    policyId: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.policyId,
    packageHash: measurement.packageHash,
    previewHash: measurement.previewHash,
    environment: {
      browserName: measurement.browserName.trim(), browserVersion: measurement.browserVersion.trim(),
      platform: measurement.platform.trim(), viewport: measurement.viewport,
    },
    metrics: {
      firstInteractiveBytes: measurement.firstInteractiveBytes,
      cachedSceneP95Ms, choiceInputP95Ms, peakUsedHeapBytes, longRunDurationMs, longRunGrowthRatio,
      sceneSamples: measurement.cachedSceneLatenciesMs.length,
      inputSamples: measurement.choiceInputLatenciesMs.length,
      memorySamples: memorySamples.length,
    },
    failures: [...new Set(failures)], passed: failures.length === 0,
    measuredAt: measurement.measuredAt,
  }
  return { ...body, receiptHash: await hashProductProductionValueV2(body) }
}
