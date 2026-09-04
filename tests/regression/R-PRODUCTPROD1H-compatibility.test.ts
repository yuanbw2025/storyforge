import { describe, expect, it } from 'vitest'
import { createProductBuildCompatibilityReportV1 } from '../../src/lib/product-production/compatibility'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductRuntimePackageV1 } from '../../src/lib/types'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'

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
})
