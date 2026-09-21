import { describe, expect, it } from 'vitest'
import {
  assertProductFirstInteractiveMeasurementV1,
  createProductFirstInteractiveResourcePlanV1,
  createProductProgressiveMediaRequestLedgerV1,
  textAdventureSceneMediaAssetKeysV1,
} from '../../src/lib/product-production/first-interactive-resources'
import {
  createProductBrowserPerformanceReceiptV1,
  PRODUCT_BROWSER_PERFORMANCE_POLICY_V1,
} from '../../src/lib/product-production/browser-performance'
import type { FrozenRuntimeMediaAssetV2, ProductRuntimePackageV1 } from '../../src/lib/types'

function asset(index: number, input?: Partial<FrozenRuntimeMediaAssetV2>): FrozenRuntimeMediaAssetV2 {
  const contentHash = index.toString(16).padStart(64, '0')
  return {
    assetKey: `image.${index}`, version: 1, kind: 'cg', name: `插图 ${index}`,
    mimeType: 'image/png', byteSize: 2 * 1024 * 1024, width: 1280, height: 720,
    durationMs: null, contentHash, blobContentHash: contentHash,
    source: 'fixture', license: 'fixture', altText: `插图 ${index}`,
    characterTag: '', sceneTag: `scene-${index}`,
    ...input,
  }
}

function runtime(productType: ProductRuntimePackageV1['productType'] = 'text-adventure'): ProductRuntimePackageV1 {
  const assets = Array.from({ length: 12 }, (_, index) => asset(index + 1))
  return {
    schema: 'storyforge.product-runtime-package', version: 1, productType,
    definition: {
      productKey: 'first-interactive-fixture', title: '首交互夹具', description: 'fixture',
      enabledCapabilities: ['presentation'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: 'f'.repeat(64), selection: {
        schema: 'storyforge.product-world-source-selection', version: 1, productType,
        worldReferenceHash: 'e'.repeat(64), resourceKeys: [], roleBindings: {},
      },
    },
    narrative: {
      moduleKind: 'main', moduleTitle: '首交互夹具', entryNodeKey: 'entry',
      nodes: [
        { key: 'entry', kind: 'entry', title: '入口', summary: '', conditionJson: '{}', effectsJson: '[]', successorKeys: ['later'] },
        { key: 'later', kind: 'scene', title: '后续', summary: '', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [
        { beatKey: 'beat.entry', nodeKey: 'entry', kind: 'narration', speakerKey: null, text: '入口。', order: 0 },
        { beatKey: 'beat.later', nodeKey: 'later', kind: 'narration', speakerKey: null, text: '后续。', order: 0 },
      ],
      choices: [],
    },
    presentation: {
      version: 1,
      assets,
      cues: [
        { cueKey: 'cue.entry', beatKey: 'beat.entry', phase: 'before', type: 'show-cg', assetKey: 'image.1', durationMs: 0, easing: 'linear', order: 0 },
        { cueKey: 'cue.later', beatKey: 'beat.later', phase: 'before', type: 'show-cg', assetKey: 'image.12', durationMs: 0, easing: 'linear', order: 1 },
      ],
    },
  }
}

function healthyMeasurement(firstInteractiveBytes: number) {
  return {
    runtimeVerifier: 'in-app-browser-lab' as const,
    browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
    viewport: { width: 1440, height: 900 }, packageHash: 'a'.repeat(64), previewHash: 'b'.repeat(64),
    firstInteractiveBytes, firstInteractiveAssetKeys: ['image.1'],
    cachedSceneLatenciesMs: Array.from({ length: 20 }, () => 40),
    choiceInputLatenciesMs: Array.from({ length: 20 }, () => 20),
    memorySamples: [
      { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs, usedHeapBytes: 100 * 1024 * 1024 },
      { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs, usedHeapBytes: 105 * 1024 * 1024 },
    ],
    measuredAt: 1,
  }
}

describe('R-PRODUCTPROD-1I · 首次可交互资源计划', () => {
  it('文字冒险只计完整 Preview JSON 与入口实际显示插图，不把后续 11 图冒充首屏', () => {
    const packageValue = runtime()
    const previewManifestJson = JSON.stringify({ runtimePackage: packageValue, proof: '中文字节' })
    const plan = createProductFirstInteractiveResourcePlanV1({ previewManifestJson, runtimePackage: packageValue })
    expect(plan).toMatchObject({
      strategy: 'text-adventure-entry-scene', assetKeys: ['image.1'], mediaBytes: 2 * 1024 * 1024,
      manifestBytes: new TextEncoder().encode(previewManifestJson).byteLength,
    })
    expect(plan.totalBytes).toBe(plan.manifestBytes + plan.mediaBytes)
    expect(plan.totalBytes).toBeLessThan(
      plan.manifestBytes + packageValue.presentation!.assets.reduce((sum, item) => sum + item.byteSize, 0),
    )
  })

  it('无入口 cue 时使用玩家真实的首张 background/CG 降级，不把角色面板立绘算入首屏', () => {
    const packageValue = runtime()
    packageValue.presentation!.cues = []
    packageValue.presentation!.assets = [
      asset(20, { kind: 'character-pose', assetKey: 'portrait.hero' }),
      asset(21, { kind: 'background', assetKey: 'background.fallback' }),
    ]
    expect(textAdventureSceneMediaAssetKeysV1(packageValue, 'entry')).toEqual(['background.fallback'])
  })

  it('登记 verifier 必须提交同一有序资源集合；入口图自身过大仍触发 12 MiB 硬门', async () => {
    const packageValue = runtime()
    packageValue.presentation!.assets[0].byteSize = 13 * 1024 * 1024
    const previewManifestJson = JSON.stringify({ runtimePackage: packageValue })
    const plan = createProductFirstInteractiveResourcePlanV1({ previewManifestJson, runtimePackage: packageValue })
    expect(() => assertProductFirstInteractiveMeasurementV1({
      firstInteractiveBytes: plan.totalBytes - 1,
      firstInteractiveAssetKeys: plan.assetKeys,
      expected: plan,
    })).toThrow(/首次可交互资源测量与当前 Build 不一致/)
    expect(() => assertProductFirstInteractiveMeasurementV1({
      firstInteractiveBytes: plan.totalBytes,
      firstInteractiveAssetKeys: ['image.2'],
      expected: plan,
    })).toThrow(/首次可交互资源测量与当前 Build 不一致/)
    expect(() => assertProductFirstInteractiveMeasurementV1({
      firstInteractiveBytes: plan.totalBytes,
      firstInteractiveAssetKeys: plan.assetKeys,
      expected: plan,
    })).not.toThrow()
    const receipt = await createProductBrowserPerformanceReceiptV1(healthyMeasurement(plan.totalBytes))
    expect(receipt.failures).toContain('first-interactive-bytes')
  })

  it('没有已证明按需策略的其他产品继续保守计全部冻结媒资', () => {
    const packageValue = runtime('avg')
    const previewManifestJson = JSON.stringify({ runtimePackage: packageValue })
    const plan = createProductFirstInteractiveResourcePlanV1({ previewManifestJson, runtimePackage: packageValue })
    expect(plan.strategy).toBe('conservative-all-media')
    expect(plan.assetKeys).toHaveLength(12)
    expect(plan.mediaBytes).toBe(24 * 1024 * 1024)
  })

  it('切场不丢同一会话的晚到图片；换来源后忽略旧请求且失败 key 可重试', () => {
    const ledger = createProductProgressiveMediaRequestLedgerV1()
    ledger.reset()
    const firstScene = ledger.begin(['image.1'])
    const secondScene = ledger.begin(['image.2'])
    // 先切到第二场再返回第一场时，不重复发起并行读取；晚到的第一场
    // 结果仍属于同一冻结来源，可以安全进入 URL cache。
    expect(ledger.begin(['image.1']).assetKeys).toEqual([])
    expect(ledger.settle(firstScene)).toBe(true)
    expect(ledger.settle(secondScene, ['image.2'])).toBe(true)
    expect(ledger.begin(['image.2']).assetKeys).toEqual(['image.2'])

    const oldSource = ledger.begin(['image.3'])
    ledger.reset()
    const newSource = ledger.begin(['image.3'])
    expect(ledger.settle(oldSource)).toBe(false)
    // 旧来源晚到不能清除新来源同 key 的 pending claim。
    expect(ledger.begin(['image.3']).assetKeys).toEqual([])
    expect(ledger.settle(newSource)).toBe(true)
  })
})
