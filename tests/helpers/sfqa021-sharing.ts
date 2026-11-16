import type { WorldPackageManifest } from '../../src/lib/types/world-sharing'

export const sfqa021Manifest: WorldPackageManifest = {
  packageId: 'W-sfqa021-source@v7', sourceWorldCode: 'W-sfqa021-source', sourceWorldVersion: 7,
  name: '雾港', description: '元数据说明', authorName: '  作者 🌊  ',
  attribution: '  原作者 · 雾港\n逐字署名  ', license: 'CC-BY-4.0',
  allowedUses: { 'world-remix': false, ttrpg: true, 'character-interaction': false, 'ai-town': false,
    'text-adventure': false, avg: false, 'text-open-world': false },
  contentWarnings: [' 战争 ', '雪\n暴风', ' 战争 '], publishedAt: 1_700_000_000_000, releaseHash: 'a'.repeat(64),
}
