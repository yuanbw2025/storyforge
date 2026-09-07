import { describe, expect, it } from 'vitest'
import { createProductBuildCompatibilityReportV1 } from '../../src/lib/product-production/compatibility'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductRuntimePackageV1 } from '../../src/lib/types'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'
import { createTextOpenWorldProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function avgPackage(choiceEffectsJson = '[]'): ProductRuntimePackageV1 {
  const hash = 'a'.repeat(64)
  return parseProductRuntimePackageV1({
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'avg',
    definition: {
      productKey: 'compat.avg', title: '兼容测试', description: '',
      enabledCapabilities: ['narrative', 'presentation'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: hash,
      selection: currentProductSelection('avg', {
        story: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
      }),
    },
    narrative: {
      moduleKind: 'main', moduleTitle: '兼容测试', entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', kind: 'entry', title: '开始', summary: '', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending'] },
        { key: 'ending', kind: 'ending', title: '结束', summary: '', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '开始。', order: 0 },
        { beatKey: 'beat.ending', nodeKey: 'ending', kind: 'narration', speakerKey: null, text: '结束。', order: 0 },
      ],
      choices: [{
        choiceKey: 'choice.finish', sourceNodeKey: 'opening', text: '结束', description: '', unavailableReason: '',
        targetNodeKey: 'ending', displayConditionJson: '{}', availableConditionJson: '{}',
        effectsJson: choiceEffectsJson, tags: [], order: 0,
      }],
    },
    presentation: { version: 1, cues: [], assets: [] },
  })
}

describe('R-PRODUCTPROD-1H · deterministic save compatibility', () => {
  it('首个 Build 和同包演化生成可验证 identity 报告', async () => {
    const pkg = avgPackage()
    const packageHash = await hashProductProductionValueV2(pkg)
    const initial = await createProductBuildCompatibilityReportV1({
      previous: null, current: { buildNumber: 1, packageHash, runtimePackage: pkg },
    })
    expect(initial).toMatchObject({ level: 'compatible', migrationPolicy: 'initial-session' })
    expect(initial.reportHash).toMatch(/^[a-f0-9]{64}$/)
    const identity = await createProductBuildCompatibilityReportV1({
      previous: { buildNumber: 1, packageHash, runtimePackage: pkg },
      current: { buildNumber: 2, packageHash, runtimePackage: pkg },
    })
    expect(identity).toMatchObject({
      level: 'compatible', migrationPolicy: 'identity', removedStableKeys: [], changedStableKeys: [],
    })
  })

  it('改变既有选择 effect 时 fail closed 为 breaking 并固定旧存档', async () => {
    const previous = avgPackage()
    const current = avgPackage('[{"op":"set","path":"trust","value":-1}]')
    const report = await createProductBuildCompatibilityReportV1({
      previous: {
        buildNumber: 1, packageHash: await hashProductProductionValueV2(previous), runtimePackage: previous,
      },
      current: {
        buildNumber: 2, packageHash: await hashProductProductionValueV2(current), runtimePackage: current,
      },
    })
    expect(report).toMatchObject({ level: 'breaking', migrationPolicy: 'pin-old-save' })
    expect(report.changedStableKeys).toContain('narrative.choice:choice.finish')
    expect(report.reasons.join('')).toContain('旧存档')
  })

  it('把vNext全部模块envelope纳入稳定键，并识别schema、hash和依赖变化', async () => {
    const previousVNext = createTextOpenWorldVNextFixture()
    const previous = createTextOpenWorldProductRuntimePackageFixtureV1(previousVNext)
    const initial = await createProductBuildCompatibilityReportV1({
      previous: null,
      current: {
        buildNumber: 1,
        packageHash: await hashProductProductionValueV2(previous),
        runtimePackage: previous,
      },
    })
    expect(initial.addedStableKeys.filter(key => key.startsWith('text-open-world.module:')))
      .toHaveLength(15)

    const variants = (['schemaVersion', 'contentHash', 'dependencies'] as const).map(field => {
      const next = structuredClone(previousVNext)
      if (field === 'schemaVersion') {
        next.modules.presentation.schemaVersion = 1
        ;(next.modules.presentation.payload as { version: number; mapLayout?: unknown }).version = 1
        delete (next.modules.presentation.payload as { mapLayout?: unknown }).mapLayout
      }
      if (field === 'contentHash') next.modules.world.contentHash = 'c'.repeat(64)
      if (field === 'dependencies') next.modules.world.dependencies = []
      return {
        changedKey: field === 'schemaVersion'
          ? 'text-open-world.module:presentation'
          : 'text-open-world.module:world',
        runtimePackage: createTextOpenWorldProductRuntimePackageFixtureV1(next),
      }
    })
    for (const { changedKey, runtimePackage: current } of variants) {
      const report = await createProductBuildCompatibilityReportV1({
        previous: {
          buildNumber: 1,
          packageHash: await hashProductProductionValueV2(previous),
          runtimePackage: previous,
        },
        current: {
          buildNumber: 2,
          packageHash: await hashProductProductionValueV2(current),
          runtimePackage: current,
        },
      })
      expect(report).toMatchObject({ level: 'breaking', migrationPolicy: 'pin-old-save' })
      expect(report.changedStableKeys).toContain(changedKey)
    }
  })
})
