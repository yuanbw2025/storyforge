import { db } from '../db/schema'
import { importCommunityProductDistributionV1, verifyProductDistributionBundleV2, type ProductDistributionBundleV2 } from '../product-platform/distribution-bundle'
import { createWorkspace } from '../workspace/create-workspace'
import { createProductRuntimeInstance } from '../product/runtime-instances'
import { resolveScope } from '../workspace/scope'

export interface CommunityTtrpgGameV1 {
  key: string; title: string; tagline: string; description: string; coverPath: string | null;
  bundlePath: string; bundleHash: string; minutes: number; playerCount: string; version: string;
}
export function parseCommunityTtrpgCatalogV1(value: unknown): CommunityTtrpgGameV1[] {
  const row = value as { schema?: string; version?: number; games?: CommunityTtrpgGameV1[] }
  if (!row || row.schema !== 'storyforge.community-ttrpg-catalog' || row.version !== 1 || !Array.isArray(row.games) || row.games.length > 100)
    throw new Error('社区游戏目录无效')
  const keys = new Set<string>()
  for (const game of row.games) {
    if (!/^[a-z0-9][a-z0-9.-]{0,99}$/.test(game.key) || keys.has(game.key) || !/^[a-f0-9]{64}$/.test(game.bundleHash)
      || !/^games\/[a-z0-9./-]+\.json$/.test(game.bundlePath) || game.bundlePath.includes('..')
      || (game.coverPath !== null && (!/^games\/[a-z0-9./-]+\.(png|webp|jpg)$/.test(game.coverPath) || game.coverPath.includes('..')))
      || !Number.isSafeInteger(game.minutes) || game.minutes < 5 || game.minutes > 1000
      || [game.title, game.tagline, game.description, game.playerCount, game.version].some(value => typeof value !== 'string' || !value.trim() || value.length > 4000))
      throw new Error('社区游戏的版本、地址或说明无效')
    keys.add(game.key)
  }
  return structuredClone(row.games)
}
export async function readCommunityTtrpgCatalogV1(signal?: AbortSignal) {
  const response = await fetch(`${import.meta.env.BASE_URL}games/catalog.json`, { signal })
  if (!response.ok) throw new Error('暂时无法读取社区游戏目录')
  const raw = await response.text()
  if (raw.length > 500_000) throw new Error('社区游戏目录超出大小限制')
  return parseCommunityTtrpgCatalogV1(JSON.parse(raw))
}
export async function readCommunityTtrpgBundleV1(game: CommunityTtrpgGameV1, signal?: AbortSignal): Promise<ProductDistributionBundleV2> {
  const response = await fetch(`${import.meta.env.BASE_URL}${game.bundlePath}`, { signal })
  if (!response.ok) throw new Error('游戏内容暂时不可用，请稍后重试')
  const raw = await response.text()
  if (raw.length > 64_000_000) throw new Error('社区游戏超过当前入口的 64MB 限制')
  const bundle = await verifyProductDistributionBundleV2(JSON.parse(raw))
  if (bundle.bundleHash !== game.bundleHash || bundle.productRelease.manifest.productType !== 'ttrpg') throw new Error('游戏内容与目录中的冻结版本不一致')
  return bundle
}
const starts = new Map<string, Promise<number>>()
/** The click creates a product-owned local copy and a separate runtime; no authored world is imported. */
export async function startCommunityTtrpgGameV1(game: CommunityTtrpgGameV1, bundle: ProductDistributionBundleV2): Promise<number> {
  if (starts.has(game.key)) return starts.get(game.key)!
  const start = async () => {
    const verified = await verifyProductDistributionBundleV2(bundle)
    if (verified.bundleHash !== game.bundleHash || verified.productRelease.manifest.productType !== 'ttrpg') throw new Error('社区游戏版本不匹配')
    let release = await db.productReleases.where('contentHash').equals(bundle.productRelease.contentHash)
      .filter(row => row.distributionProvenance?.source === 'community-bundle').first()
    const scope = release ? await resolveScope({ scope: { projectId: release.projectId, workId: release.workId, worldId: release.worldId } })
      : (await createWorkspace({ name: `游玩 · ${game.title}`, description: '社区游戏的本地副本与独立存档。', genres: ['interactive-fiction'],
        status: 'drafting', targetWordCount: 1 }, { purpose: 'independent-work' })).scope
    release ??= await importCommunityProductDistributionV1({ scope, bundle: verified, catalogKey: game.key,
      license: { licenseId: 'MIT', licenseVersion: '1', allowOfflineExport: true, allowRemix: true, commercialReuse: true,
        requiresAttribution: true, termsUrl: 'https://github.com/yuanbw2025/storyforge/blob/main/LICENSE' }, attribution: ['StoryForge 社区原创游戏'] })
    const session = await createProductRuntimeInstance({ scope, kind: 'ttrpg', title: `${game.title} · ${new Date().toLocaleDateString('zh-CN')}`,
      productSource: { kind: 'release', productReleaseId: release.id! } })
    return session.id!
  }
  const promise = (async () => typeof navigator !== 'undefined' && navigator.locks?.request
    ? await navigator.locks.request(`storyforge-community-start-${game.key}`, start) : await start())()
  starts.set(game.key, promise)
  try { return await promise } finally { starts.delete(game.key) }
}
