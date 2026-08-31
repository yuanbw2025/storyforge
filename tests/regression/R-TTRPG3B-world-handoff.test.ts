import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWorldGameProductionHandoffV2 } from '../../src/lib/game-production/handoff'

describe('TTRPG-3B · WorldRelease to TTRPG production handoff', () => {
  it('交接冻结产品类型、release ID 与 hash，拒绝字段注入和损坏 hash', () => {
    const valid = {
      schema: 'storyforge.world-game-production-handoff', version: 2,
      productType: 'ttrpg', worldReleaseId: 17, worldContentHash: 'a'.repeat(64),
    } as const
    expect(parseWorldGameProductionHandoffV2(valid)).toEqual(valid)
    expect(() => parseWorldGameProductionHandoffV2({ ...valid, worldContentHash: 'changed' })).toThrow('无效')
    expect(() => parseWorldGameProductionHandoffV2({ ...valid, fallbackProduct: 'storygame' })).toThrow('字段不精确')
  })

  it('世界引擎正式按钮进入跑团制作页，不再跳到 storygame 或丢失 release', () => {
    const source = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')
    const releasePanel = source('src/components/world-engine/WorldNarrativeReleasePanel.tsx')
    expect(releasePanel).toContain('交给跑团')
    expect(releasePanel).toContain("onClick={() => handoff('ttrpg')}")
    expect(releasePanel).toContain('productType,')
    expect(releasePanel).toContain('worldReleaseId: selectedRelease.id')
    expect(releasePanel).toContain('worldContentHash: selectedRelease.contentHash')
    const productHub = source('src/pages/ProductHubPage.tsx')
    expect(productHub).toContain('const parsed = parseWorldGameProductionHandoffV2(handoff)')
    expect(productHub).toContain("if (parsed.productType === 'ttrpg')")
    expect(productHub).toContain('setTtrpgProductionHandoff(parsed)')
    expect(productHub).toContain("setActiveTab('ttrpg')")
    expect(productHub).not.toContain("onOpenGameProduction={() => { setGameProduct('storygame')")
  })
})
