import { describe, expect, it } from 'vitest'
import {
  currentTextOpenWorldReleasesV1,
  textOpenWorldReleaseVersionsV1,
} from '../../src/lib/open-world/player-library'
import type { ProductRelease } from '../../src/lib/types'

interface CatalogItem {
  release: ProductRelease
  marker: string
}

function item(input: {
  id: number
  productionKey: string
  version: number
  createdAt: number
  marker: string
  label?: string
}): CatalogItem {
  return {
    marker: input.marker,
    release: {
      id: input.id,
      projectId: 1,
      worldId: 2,
      workId: 3,
      productionKey: input.productionKey,
      productType: 'text-open-world',
      worldReleaseId: 4,
      version: input.version,
      label: input.label ?? '同名开放世界',
      manifestJson: '{}',
      contentHash: `release-${input.id}`,
      createdAt: input.createdAt,
    },
  }
}

describe('Text Open World G4 · 玩家库 Release 选版规则', () => {
  it('同名作品使用 productionKey 辨识产品实例，不会被合并成一张标题卡', () => {
    const alpha = item({ id: 1, productionKey: 'game.alpha', version: 1, createdAt: 100, marker: 'alpha' })
    const beta = item({ id: 2, productionKey: 'game.beta', version: 1, createdAt: 200, marker: 'beta' })

    const current = currentTextOpenWorldReleasesV1([alpha, beta])

    expect(current).toHaveLength(2)
    expect(current.map(entry => entry.release.productionKey)).toEqual(['game.beta', 'game.alpha'])
  })

  it('同一 productionKey 以不可变 version 为选版权威，不会让晚导入的旧版覆盖新版', () => {
    const version1ImportedLater = item({
      id: 11,
      productionKey: 'game.salt-ridge',
      version: 1,
      createdAt: 9_999,
      marker: 'old-import',
    })
    const version2PublishedEarlier = item({
      id: 12,
      productionKey: 'game.salt-ridge',
      version: 2,
      createdAt: 100,
      marker: 'new-release',
    })

    const current = currentTextOpenWorldReleasesV1([version1ImportedLater, version2PublishedEarlier])

    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ marker: 'new-release', release: { id: 12, version: 2 } })
  })

  it('某个产品的不可变版本列表始终按 version 降序，同版本才使用时间和 id 破平', () => {
    const versions = [
      item({ id: 21, productionKey: 'game.salt-ridge', version: 1, createdAt: 5_000, marker: 'v1' }),
      item({ id: 22, productionKey: 'game.salt-ridge', version: 3, createdAt: 100, marker: 'v3-old-copy' }),
      item({ id: 23, productionKey: 'game.salt-ridge', version: 2, createdAt: 9_000, marker: 'v2' }),
      item({ id: 24, productionKey: 'game.other', version: 9, createdAt: 99_999, marker: 'foreign' }),
      item({ id: 25, productionKey: 'game.salt-ridge', version: 3, createdAt: 200, marker: 'v3-new-copy' }),
    ]

    const result = textOpenWorldReleaseVersionsV1(versions, 'game.salt-ridge')

    expect(result.map(entry => entry.marker)).toEqual(['v3-new-copy', 'v3-old-copy', 'v2', 'v1'])
    expect(result.map(entry => entry.release.version)).toEqual([3, 3, 2, 1])
  })
})
