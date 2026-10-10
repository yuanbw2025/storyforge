import { PROJECT_TABLES } from '../registry/project-tables'
import { parseManifest } from './package'
import { isObject, validateData } from './schema'

/** Pure-data validation only: restoring an archive never imports plugin code. */
export function validateExtensionBackup(backup: Record<string, unknown>): void {
  const tables = PROJECT_TABLES.filter(spec => spec.exportable && spec.name.startsWith('extension')).map(spec => spec.name)
  const rows = Object.fromEntries(tables.map(name => {
    const data = backup[name]
    if (!Array.isArray(data) || data.some(row => !isObject(row))) throw new Error(`插件备份 ${name} 无效`)
    return [name, data as Record<string, unknown>[]]
  })) as Record<string, Record<string, unknown>[]>
  const profiles = new Map(rows.extensionProfiles.map(profile => [profile._exportId, profile]))
  if (profiles.size !== rows.extensionProfiles.length) throw new Error('插件配置身份重复')
  const contracts = new Map<string, ReturnType<typeof parseManifest>>()
  function sameOwner(row: Record<string, unknown>, profile: Record<string, unknown>) {
    if (row._worldExportId !== profile._worldExportId || row._workExportId !== profile._workExportId || row.ownerKey !== profile.ownerKey) throw new Error('插件记录跨作用域')
  }
  for (const row of rows.extensionContracts) {
    const profile = profiles.get(row._profileExportId)
    if (!profile) throw new Error('插件契约缺少配置')
    sameOwner(row, profile)
    if (!Number.isFinite(row.createdAt) || Number(row.createdAt) < 0) throw new Error('插件契约时间无效')
    const manifest = parseManifest(row.manifest)
    if (manifest.id !== profile.pluginId || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest)) throw new Error('插件契约身份不一致')
    const key = `${row._profileExportId}/${row.digest}`
    if (contracts.has(key)) throw new Error('插件契约重复')
    contracts.set(key, manifest)
  }
  for (const profile of profiles.values()) {
    if (!Number.isInteger(profile._exportId) || typeof profile.enabled !== 'boolean' || !Number.isInteger(profile.generation) || Number(profile.generation) < 1 || !Number.isInteger(profile.revision) || Number(profile.revision) < 1) throw new Error('插件配置状态无效')
    if (!Number.isFinite(profile.updatedAt) || Number(profile.updatedAt) < 0 || typeof profile.ownerKey !== 'string') throw new Error('插件配置元数据无效')
    const manifest = contracts.get(`${profile._exportId}/${profile.digest}`)
    if (!manifest || manifest.version !== profile.version || (manifest.owner === 'world' ? profile._worldExportId == null || profile._workExportId != null : profile._workExportId == null || profile._worldExportId != null)) throw new Error('插件配置缺少匹配版本契约或 owner')
  }
  const identities = new Set<string>()
  for (const row of rows.extensionRecords) {
    const profile = profiles.get(row._profileExportId)
    if (!profile) throw new Error('插件记录缺少配置')
    sameOwner(row, profile)
    if (row.pluginId !== profile.pluginId || typeof row.key !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.key) || !Number.isInteger(row.revision) || Number(row.revision) < 1 || !Number.isInteger(row.generation) || Number(row.generation) < 1 || Number(row.generation) > Number(profile.generation)) throw new Error('插件记录身份、版本或数据代无效')
    if (!Number.isFinite(row.updatedAt) || Number(row.updatedAt) < 0) throw new Error('插件记录时间无效')
    const key = `${row._profileExportId}/${row.generation}/${row.key}`
    if (identities.has(key)) throw new Error('插件记录身份重复')
    identities.add(key)
    const schemas = [...contracts.entries()].filter(([key]) => key.startsWith(`${row._profileExportId}/`)).map(([, manifest]) => manifest.schemas[String(row.schemaId)]).filter(schema => schema?.version === row.schemaVersion)
    if (!schemas.length) throw new Error('插件数据缺少声明的 schema 版本')
    // Schema semantics for a given namespace/schema/version cannot drift between package versions.
    if (schemas.some(schema => JSON.stringify(schema.schema) !== JSON.stringify(schemas[0].schema))) throw new Error('同一 schema 版本定义冲突')
    validateData(schemas[0].schema, row.payload)
    if (row._chapterExportId != null && profile._workExportId == null) throw new Error('世界插件不能携带作品章节引用')
    if (row._historyEventExportId != null && profile._worldExportId == null) throw new Error('作品插件不能携带世界历史引用')
  }
  for (const row of rows.extensionOperations) {
    const profile = profiles.get(row._profileExportId)
    if (!profile || !['enable','disable','migrate','restore-generation'].includes(String(row.kind))) throw new Error('插件操作回执无效')
    sameOwner(row, profile)
    if (!Number.isFinite(row.createdAt) || Number(row.createdAt) < 0 || typeof row.detail !== 'string' || row.detail.length > 8000) throw new Error('插件操作回执元数据无效')
    for (const field of ['fromGeneration', 'toGeneration']) if (!Number.isInteger(row[field]) || Number(row[field]) < 1 || Number(row[field]) > Number(profile.generation)) throw new Error('插件回执数据代无效')
    for (const field of ['fromDigest', 'toDigest']) if (typeof row[field] !== 'string' || !contracts.has(`${row._profileExportId}/${row[field]}`)) throw new Error('插件回执版本契约缺失')
  }
}
