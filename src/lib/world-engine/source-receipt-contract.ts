/** Pure registered row checks. Full wire verification is asynchronous and
 * runs outside the import/export transaction via the registered portable kind. */
export const WORLD_SOURCE_WIRE_MAX_BYTES = 32 * 1024 * 1024
const HASH = /^[a-f0-9]{64}$/
const COMMON = ['receiptVersion', 'wireJson', 'packageDigest', 'declarationHash', 'releaseUid', 'importedAt']
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function fail(message: string): never { throw Error(`[world-source-receipt] ${message}`) }
function integer(value: unknown, minimum: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}
export function assertWorldSourceReceiptBindingV1(value: unknown): void {
  if (!record(value) || Object.keys(value).length !== 2 || value.version !== 1
    || typeof value.declarationHash !== 'string' || !HASH.test(value.declarationHash)
    || !Object.prototype.hasOwnProperty.call(value, 'version') || !Object.prototype.hasOwnProperty.call(value, 'declarationHash')) fail('编辑来源绑定无效')
}
export function assertWorldSourceReceiptRowV1(value: unknown, coordinate: 'local' | 'portable' = 'portable'): void {
  if (!record(value)) fail('回执必须为对象')
  const local = coordinate === 'local'
  const keys = [...COMMON, ...(local ? ['id', 'projectId', 'worldId', 'worldReleaseId']
    : ['_exportId', '_worldExportId', '_worldOwnerExportId', '_worldReleaseExportId'])]
  const unknown = Object.keys(value).filter(key => !keys.includes(key))
  const missing = COMMON.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (unknown.length || missing.length) fail(`回执字段不完整或含未知字段；未知=${unknown.join(',')}；缺失=${missing.join(',')}`)
  if (value.receiptVersion !== 1) fail('回执版本不支持')
  if (typeof value.wireJson !== 'string' || !value.wireJson.length
    || new TextEncoder().encode(value.wireJson).byteLength > WORLD_SOURCE_WIRE_MAX_BYTES) fail('原 wire 缺失或超出包预算')
  for (const key of ['packageDigest', 'declarationHash']) {
    if (typeof value[key] !== 'string' || !HASH.test(value[key])) fail(`${key} 无效`)
  }
  if (typeof value.releaseUid !== 'string' || !value.releaseUid.length || value.releaseUid.length > 512) fail('R 身份无效')
  if (typeof value.importedAt !== 'number' || !Number.isFinite(value.importedAt) || value.importedAt <= 0) fail('捕获时间无效')
  if (local) {
    if (!integer(value.projectId, 1) || !integer(value.worldId, 1)
      || (value.id !== undefined && !integer(value.id, 1))
      || (value.worldReleaseId !== null && !integer(value.worldReleaseId, 1))) fail('本机 owner/locator 无效')
  } else if (!integer(value._exportId, 0) || !integer(value._worldExportId, 0)
    || value._worldOwnerExportId !== value._worldExportId
    || (value._worldReleaseExportId != null && !integer(value._worldReleaseExportId, 0))) fail('便携 owner/locator 无效')
}
