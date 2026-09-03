import { describe, expect, it } from 'vitest'
import { currentPlayerReleases } from '../../src/lib/text-game/player-library'
import type { ProductRuntimePackageV1 } from '../../src/lib/types'

function item(input: { id: number; title: string; moduleExportId: number; createdAt: number }) {
  const manifest = {
    productType: 'avg',
    definition: { title: input.title, productKey: `game-${input.id}` },
    sourceWorld: { contentHash: `${input.moduleExportId}`.padStart(64, '0') },
  } as ProductRuntimePackageV1
  return {
    release: {
      id: input.id, projectId: 1, worldId: 1, workId: 1, worldReleaseId: input.id,
      productionKey: `game-${input.id}`, productType: 'avg',
      version: 1, label: input.title, manifestJson: '{}', contentHash: `${input.id}`.padStart(64, '0'), createdAt: input.createdAt,
    },
    manifest,
    error: '',
  }
}

describe('文字游戏玩家目录', () => {
  it('同名作品跨世界冻结和游戏投影只展示最新可玩版本', () => {
    const result = currentPlayerReleases([
      item({ id: 1, title: '雾港：失潮钟声（演示世界）', moduleExportId: 10, createdAt: 10 }),
      item({ id: 2, title: '雾港：失潮钟声（演示世界） · 游戏投影', moduleExportId: 20, createdAt: 20 }),
      item({ id: 3, title: '雾港：失潮钟声（演示世界）', moduleExportId: 30, createdAt: 30 }),
      item({ id: 4, title: '另一部故事', moduleExportId: 40, createdAt: 15 }),
    ])

    expect(result.map(value => value.release.id)).toEqual([3, 4])
  })
})
