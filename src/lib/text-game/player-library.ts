import type { ProductRelease, ProductRuntimePackageV1 } from '../types'

interface PlayerLibraryRelease {
  release: ProductRelease
  manifest: ProductRuntimePackageV1 | null
}

function normalizedTitle(title: string): string {
  return title
    .trim()
    .replace(/\s*[·・]\s*游戏投影\s*$/u, '')
    .replace(/\s+/gu, '')
    .toLocaleLowerCase('zh-CN')
}

function releaseOrder(item: PlayerLibraryRelease): readonly [number, number, number] {
  return [item.release.createdAt, item.release.version, item.release.id ?? 0]
}

function isNewer(left: PlayerLibraryRelease, right: PlayerLibraryRelease): boolean {
  const leftOrder = releaseOrder(left)
  const rightOrder = releaseOrder(right)
  return leftOrder[0] > rightOrder[0]
    || (leftOrder[0] === rightOrder[0] && leftOrder[1] > rightOrder[1])
    || (leftOrder[0] === rightOrder[0] && leftOrder[1] === rightOrder[1] && leftOrder[2] > rightOrder[2])
}

/**
 * Player shelves expose one current game per product + player-facing title.
 * Older immutable releases remain available to version history, existing saves and exports;
 * they are only collapsed in the player-facing catalog.
 */
export function currentPlayerReleases<T extends PlayerLibraryRelease>(items: readonly T[]): T[] {
  const current = new Map<string, T>()
  for (const item of items) {
    const titleKey = item.manifest ? normalizedTitle(item.manifest.definition.title) : ''
    const key = item.manifest
      ? titleKey
        ? `${item.manifest.productType}:title:${titleKey}`
        : `${item.manifest.productType}:game:${item.manifest.definition.productKey}:world:${item.manifest.sourceWorld.contentHash}`
      : `unreadable:${item.release.id ?? item.release.contentHash}`
    const existing = current.get(key)
    if (!existing || isNewer(item, existing)) current.set(key, item)
  }
  return [...current.values()].sort((left, right) => isNewer(left, right) ? -1 : isNewer(right, left) ? 1 : 0)
}
