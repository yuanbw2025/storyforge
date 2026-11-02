import { WORLD_PACKAGE_USES, type CommunityWorldLicense, type WorldPackageManifest } from '../types/world-sharing'

const LICENSES = new Set<CommunityWorldLicense>([
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'ALL-RIGHTS-RESERVED',
])
const WORLD_PACKAGE_MANIFEST_KEYS = new Set([
  'packageId', 'sourceWorldCode', 'sourceWorldVersion', 'name', 'description',
  'authorName', 'attribution', 'license', 'allowedUses', 'contentWarnings',
  'publishedAt', 'releaseHash',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** v3/v4/v5 share this exact metadata contract; transport changes do not
 * change the declaration. Creation and inspection must use the same gate. */
export function inspectWorldPackageMetadata(rawManifest: unknown, packageVersion: unknown): { manifest: WorldPackageManifest | null; errors: string[] } {
  const errors: string[] = []
  if (![3, 4, 5].includes(packageVersion as number)) errors.push('不支持的世界分享包元数据版本。')
  if (!isRecord(rawManifest)) return { manifest: null, errors: [...errors, '分享包缺少发布信息。'] }
  const allowedUses = rawManifest.allowedUses
  const allowedUseKeys = isRecord(allowedUses) ? Object.keys(allowedUses) : []
  const validUses = isRecord(allowedUses)
    && allowedUseKeys.length === WORLD_PACKAGE_USES.length
    && WORLD_PACKAGE_USES.every(key => typeof allowedUses[key] === 'boolean')
    && Object.values(allowedUses).some(value => value === true)
  const unknownKeys = Object.keys(rawManifest).filter(key => !WORLD_PACKAGE_MANIFEST_KEYS.has(key))
  if (unknownKeys.length > 0) errors.push(`世界发布信息包含未知字段：${unknownKeys.join('、')}。`)
  if (typeof rawManifest.packageId !== 'string' || typeof rawManifest.sourceWorldCode !== 'string' || typeof rawManifest.name !== 'string' || !rawManifest.name.trim()) errors.push('发布信息缺少世界编号或名称。')
  if (typeof rawManifest.sourceWorldVersion !== 'number' || !Number.isInteger(rawManifest.sourceWorldVersion) || rawManifest.sourceWorldVersion < 1) errors.push('世界版本无效。')
  if (rawManifest.packageId !== `${String(rawManifest.sourceWorldCode)}@v${String(rawManifest.sourceWorldVersion)}`) errors.push('世界分享包编号与来源版本不一致。')
  if (typeof rawManifest.description !== 'string' || rawManifest.description.length > 2_000) errors.push('世界分享说明无效，最多 2000 字。')
  if (typeof rawManifest.authorName !== 'string' || !rawManifest.authorName.trim()) errors.push('分享包缺少作者署名。')
  if (typeof rawManifest.attribution !== 'string' || !rawManifest.attribution.trim() || rawManifest.attribution.length > 500) errors.push('世界分享包署名说明无效，最多 500 字。')
  if (!LICENSES.has(rawManifest.license as CommunityWorldLicense)) errors.push('分享包许可无效。')
  if (!validUses) errors.push('分享包没有与当前产品目录完全一致的二创用途声明。')
  if (!Array.isArray(rawManifest.contentWarnings) || rawManifest.contentWarnings.length > 12 || rawManifest.contentWarnings.some(value => typeof value !== 'string' || value.length > 200)) errors.push('内容警告格式无效，最多 12 条，每条最多 200 字。')
  if (typeof rawManifest.publishedAt !== 'number' || !Number.isFinite(rawManifest.publishedAt) || rawManifest.publishedAt <= 0) errors.push('世界发布时间无效。')
  if (typeof rawManifest.releaseHash !== 'string' || !/^[a-f0-9]{64}$/.test(rawManifest.releaseHash)) errors.push('分享包缺少有效发布哈希。')
  return { manifest: errors.length ? null : rawManifest as unknown as WorldPackageManifest, errors }
}
