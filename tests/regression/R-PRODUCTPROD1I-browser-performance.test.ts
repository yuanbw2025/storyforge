import { describe, expect, it } from 'vitest'
import {
  createProductBrowserPerformanceReceiptV1,
  PRODUCT_BROWSER_PERFORMANCE_POLICY_V1,
  type ProductBrowserPerformanceMeasurementV1,
} from '../../src/lib/product-production/browser-performance'

function measurement(): ProductBrowserPerformanceMeasurementV1 {
  return {
    browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
    viewport: { width: 1440, height: 900 }, packageHash: 'a'.repeat(64), previewHash: 'b'.repeat(64),
    firstInteractiveBytes: 2 * 1024 * 1024,
    cachedSceneLatenciesMs: Array.from({ length: 20 }, (_, index) => 40 + index),
    choiceInputLatenciesMs: Array.from({ length: 20 }, (_, index) => 20 + index),
    memorySamples: [
      { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs, usedHeapBytes: 100 * 1024 * 1024 },
      { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs, usedHeapBytes: 108 * 1024 * 1024 },
    ],
    measuredAt: 1,
  }
}

describe('R-PRODUCTPROD-1I · browser performance receipt', () => {
  it('只在包体、双 p95、峰值内存和 30 分钟增长全部满足时签发通过 receipt', async () => {
    const receipt = await createProductBrowserPerformanceReceiptV1(measurement())
    expect(receipt).toMatchObject({
      schema: 'storyforge.product-browser-performance-receipt', version: 1, passed: true, failures: [],
      metrics: { cachedSceneP95Ms: 58, choiceInputP95Ms: 38, longRunGrowthRatio: 0.08 },
    })
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('接受已登记的应用内浏览器实验室 verifier，并拒绝未知 verifier', async () => {
    const input = measurement()
    input.runtimeVerifier = 'in-app-browser-lab'
    await expect(createProductBrowserPerformanceReceiptV1(input)).resolves.toMatchObject({ passed: true })
    ;(input as { runtimeVerifier?: string }).runtimeVerifier = 'forged-runner'
    await expect(createProductBrowserPerformanceReceiptV1(input)).rejects.toThrow('runtimeVerifier 无效')
  })

  it('样本不足、长跑不足和阈值超限均 fail closed，不能用 smoke 冒充商业证据', async () => {
    const input = measurement()
    input.firstInteractiveBytes = 13 * 1024 * 1024
    input.cachedSceneLatenciesMs = [300]
    input.choiceInputLatenciesMs = [120]
    input.memorySamples = [{ elapsedMs: 1_000, usedHeapBytes: 360 * 1024 * 1024 }]
    const receipt = await createProductBrowserPerformanceReceiptV1(input)
    expect(receipt.passed).toBe(false)
    expect(receipt.failures).toEqual(expect.arrayContaining([
      'first-interactive-bytes', 'scene-sample-count', 'input-sample-count',
      'desktop-heap-peak', 'long-run-incomplete',
    ]))
  })
})
