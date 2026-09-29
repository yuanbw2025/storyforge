import type { FrozenProductMediaAsset } from '../types'

/** Runtime QA accepts uploaded art only with its hash-bound, receipt-frozen declaration. */
export function hasFrozenAuthorUploadRightsV1(
  asset: Pick<FrozenProductMediaAsset, 'assetKey' | 'contentHash' | 'source' | 'license'>,
  packageRights: unknown,
): boolean {
  if (asset.source !== 'author-upload' || !asset.license.trim()
    || !packageRights || typeof packageRights !== 'object') return false
  const entries = (packageRights as { mediaLicenses?: unknown }).mediaLicenses
  if (!Array.isArray(entries)) return false
  const matches = entries.filter(entry => entry?.assetKey === asset.assetKey)
  if (matches.length !== 1) return false
  const entry = matches[0]
  const rights = entry.declaration
  return entry.contentHash === asset.contentHash && entry.source === asset.source && entry.license === asset.license
    && rights?.origin === 'author-upload' && rights.license === asset.license
    && rights.commercialUse === true && rights.redistribution === true
    && typeof rights.declaration === 'string' && rights.declaration.trim().length > 0
}
