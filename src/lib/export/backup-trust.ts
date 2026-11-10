/**
 * 便携备份预检（PRODUCT-1）。
 *
 * 这是导入边界的只读检查：表清单来自 PROJECT_TABLES，不复制一套导出枚举，也不访问
 * IndexedDB。v14/v15 和分支定义不同的 v16 经严格校验进入 v17；
 * 仅按表注册元数据补缺失的新增空表，不臆造注释、作者确认或运行记忆。
 */
import type { TableSpec } from '../registry/types'
import { PROJECT_TABLES } from '../registry/project-tables'
import { isCurrentWorldCode } from '../workspace/identity'
import { NARRATIVE_DOMAIN_FIELDS_V1, parseNarrativeDomainFieldV1 } from '../narrative-domain/codec'
import { assertNarrativeDomainReferenceRowsV1 } from '../narrative-domain/integrity'
import { inspectPortableRequiredReferencesV1, inspectPortableTableStructure, readPortableOwnerShadowV1 } from './portable-table-structure'

export const CURRENT_BACKUP_VERSION = 17

export interface BackupTrustReport {
  valid: boolean
  version: number | null
  projectName: string | null
  presentTables: number
  recordCount: number
  missingTables: string[]
  warnings: string[]
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const BACKUP_REFERENCE_REVIEW_TITLE = '备份恢复：待确认关联'

interface BackupReferenceIssue {
  table: string
  rowIndex: number
  rowKey: number
  resourceUid?: string
  path: string
  value: unknown
  reason: string
  sampleId?: unknown
}

type ReviewOwner = { kind: 'world' | 'work' | 'instance'; exportId: number }

export function referenceReviewScopeMatchesV1(
  rule: string | undefined, holder: ReviewOwner | null, target: ReviewOwner | null,
  worldOf: (owner: ReviewOwner) => number | null,
): boolean {
  if (!holder || !target || holder.kind === 'instance') return false
  if (rule === 'same-owner' || (rule === 'chapter' && holder.kind === 'work'))
    return holder.kind === target.kind && holder.exportId === target.exportId
  const world = worldOf(holder)
  return world != null && world === worldOf(target) && (rule === 'chapter' ? target.kind === 'work' : target.kind === 'world')
}

/** Prepare a detached patch. Old physical IDs are evidence, never fallback
 * coordinates. Only a registered portable locator within scope can reconnect. */
export function reviewPortableLocalReferencesV1(backup: Record<string, unknown>, prepare = true) {
  const issues: BackupReferenceIssue[] = []
  const patches = new Map<string, Map<number, Record<string, unknown>>>()
  const specs = new Map<string, TableSpec>(PROJECT_TABLES.map(spec => [spec.name, spec]))
  const indexes = new Map<string, Map<number, Record<string, unknown>>>()
  const isKey = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  function index(name: string) {
    const cached = indexes.get(name)
    if (cached) return cached
    const indexed = new Map<number, Record<string, unknown>>()
    const rows = backup[name]
    if (Array.isArray(rows)) rows.forEach((row, position) => {
      if (!isRecord(row)) return
      const key = specs.get(name)?.exportIdField ? row._exportId : position
      if (isKey(key)) indexed.set(key, row)
    })
    indexes.set(name, indexed)
    return indexed
  }
  type Owner = ReturnType<typeof readPortableOwnerShadowV1>
  function owner(spec: TableSpec, row: Record<string, unknown>): Owner {
    try { return readPortableOwnerShadowV1(spec, row) } catch { return null }
  }
  function worldOf(value: ReviewOwner): number | null {
    if (value.kind === 'instance') return null
    if (value.kind === 'world') return value.exportId
    const world = index('works').get(value.exportId)?._worldExportId
    return isKey(world) ? world : null
  }
  function valid(ref: { remapVia: string; reviewLocal?: string }, holder: Owner, value: unknown) {
    if (!holder || !isKey(value)) return false
    const spec = specs.get(ref.remapVia)
    const row = index(ref.remapVia).get(value)
    const target = spec && row ? owner(spec, row) : null
    return referenceReviewScopeMatchesV1(ref.reviewLocal, holder, target, worldOf)
  }
  const decode = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) as unknown } catch { return undefined }
  }
  for (const spec of specs.values()) {
    const scalars = (spec.exportRemap ?? []).filter(ref => ref.reviewLocal)
    const arrays = (spec.exportRefRemap ?? []).filter(ref =>
      (ref.kind === 'id-array' || ref.kind === 'object-array-id') && ref.reviewLocal)
    const rows = backup[spec.name]
    if ((!scalars.length && !arrays.length) || !Array.isArray(rows)) continue
    rows.forEach((row, rowIndex) => {
      if (!isRecord(row)) return
      const holder = owner(spec, row)
      const resourceUid = spec.resourceIdentity ? row[spec.resourceIdentity.field] : undefined
      const rowKey = spec.exportIdField && isKey(row._exportId) ? row._exportId : rowIndex
      const patch: Record<string, unknown> = {}
      const report = (path: string, value: unknown, reason: string, sampleId?: unknown) => {
        issues.push({ table: spec.name, rowIndex, rowKey,
          ...(typeof resourceUid === 'string' ? { resourceUid } : {}),
          path, value, reason, ...(sampleId == null ? {} : { sampleId }) })
      }
      for (const ref of scalars) {
        const matches = !ref.when || row[ref.when.field] === ref.when.equals
        if (row[ref.field] != null) report(ref.field, row[ref.field], '旧库坐标无法确认')
        if (row[ref.exportAs] != null && (!matches || !valid(ref, holder, row[ref.exportAs]))) {
          report(ref.exportAs, row[ref.exportAs], '便携坐标无有效同域目标')
          patch[ref.exportAs] = null
        }
      }
      for (const ref of arrays) {
        if (ref.kind !== 'id-array' && ref.kind !== 'object-array-id') continue
        const raw = row[ref.field]
        const original = decode(raw)
        const wire = row[ref.exportAs]
        if (ref.kind === 'id-array') {
          if (raw != null && (!Array.isArray(original) || original.length > 0)) {
            report(ref.field, raw, '旧库数组坐标无法确认')
            patch[ref.field] = ref.storage === 'json-string' ? '[]' : []
          }
        } else if (Array.isArray(original)) {
          let changed = false
          const clean = original.map((item, index) => {
            if (!isRecord(item) || item[ref.itemField] == null) return item
            report(`${ref.field}[${index}].${ref.itemField}`, item[ref.itemField], '旧库坐标无法确认', item.id)
            changed = true
            return { ...item, [ref.itemField]: null }
          })
          if (changed) patch[ref.field] = ref.storage === 'json-string' ? JSON.stringify(clean) : clean
        } else if (raw != null) {
          report(ref.field, raw, '原字段不可解析')
          patch[ref.field] = ref.storage === 'json-string' ? '[]' : []
        }
        if (wire == null) continue
        if (!Array.isArray(wire)) {
          report(ref.exportAs, wire, '便携坐标数组不可解析')
          patch[ref.exportAs] = []
          continue
        }
        const clean = wire.map((value, i) => {
          if (ref.kind === 'object-array-id' && value === null) return null
          const hasItem = ref.kind !== 'object-array-id' || (Array.isArray(original) && isRecord(original[i]))
          if (hasItem && valid(ref, holder, value)) return value
          report(`${ref.exportAs}[${i}]`, value, '便携坐标无有效同域目标或样本')
          return null
        })
        if (clean.some((value, i) => value !== wire[i]))
          patch[ref.exportAs] = ref.kind === 'id-array' ? clean.filter(value => value !== null) : clean
      }
      if (prepare && Object.keys(patch).length > 0) {
        if (!patches.has(spec.name)) patches.set(spec.name, new Map())
        patches.get(spec.name)!.set(rowIndex, patch)
      }
    })
  }
  return { issues, patches }
}

const CURRENT_PROJECT_EXPORT_KEYS = new Set([
  'workspaceUid', 'workspacePurpose', 'name', 'enableMultiWorld',
  'productPlatformOptIns', 'createdAt', 'updatedAt',
  '_activeWorldExportId', '_activeWorkExportId',
])

const CURRENT_WORK_EXPORT_KEYS = new Set([
  '_exportId', '_worldExportId', '_activeCharacterDrivenPlanExportId',
  '_activeNarrativeModuleExportId', 'code', 'kind', 'novelProfile', 'title',
  'description', 'genres', 'customGenre', 'status', 'targetWordCount',
  'currentWordCount', 'coverImage', 'writingStyleId', 'methodologyId',
  'includeCultivationProgressInAI', 'postAdoptionPolicy',
  'postAdoptionTaskTypes', 'postAdoptionBudget', 'createdAt', 'updatedAt',
])

const CURRENT_WORLD_EXPORT_KEYS = new Set([
  '_exportId', 'identityKind', 'code', 'name', 'description', 'currentVersion',
  'communityOrigin', 'createdAt', 'updatedAt',
])

const REQUIRED_PROJECT_EXPORT_KEYS = [
  'workspaceUid', 'workspacePurpose', 'name', 'createdAt', 'updatedAt',
] as const

const REQUIRED_WORK_EXPORT_KEYS = [
  '_exportId', '_worldExportId', 'code', 'kind', 'novelProfile', 'title',
  'description', 'genres', 'status', 'targetWordCount', 'currentWordCount',
  'includeCultivationProgressInAI', 'postAdoptionPolicy',
  'postAdoptionTaskTypes', 'postAdoptionBudget', 'createdAt', 'updatedAt',
] as const

const REQUIRED_WORLD_EXPORT_KEYS = [
  '_exportId', 'identityKind', 'code', 'name', 'description', 'currentVersion',
  'createdAt', 'updatedAt',
] as const

function inspectExactKeys(
  record: Record<string, unknown>,
  label: string,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  errors: string[],
): void {
  const unknown = Object.keys(record).filter(key => !allowed.has(key))
  if (unknown.length) errors.push(`${label} 含非当前字段：${unknown.join('、')}。`)
  const missing = required.filter(key => !(key in record))
  if (missing.length) errors.push(`${label} 缺少当前必需字段：${missing.join('、')}。`)
}

/** 对外部 JSON 做结构预检；不会修改输入，也不会写入数据库。 */
export function inspectProjectBackup(input: unknown): BackupTrustReport {
  const errors: string[] = []
  const warnings: string[] = []
  // 根项目记录在便携格式里使用 `project` 单独承载，其余表才是数组键。
  const exportableTables = PROJECT_TABLES
    .filter(spec => spec.exportable && spec.name !== 'projects' && (!isRecord(input)
      || ![14, 15, 16].includes(input.version as number)
      || ((spec.introducedBackupVersion ?? 1) <= (input.version as number)
        && (!(spec.optionalInBackupVersions ?? []).includes(input.version as number) || spec.name in input))))
    .map(spec => spec.name)

  if (!isRecord(input)) {
    return {
      valid: false,
      version: null,
      projectName: null,
      presentTables: 0,
      recordCount: 0,
      missingTables: exportableTables,
      warnings,
      errors: ['备份必须是 JSON 对象。'],
    }
  }

  const version = typeof input.version === 'number' && Number.isInteger(input.version)
    ? input.version
    : null
  if (version !== CURRENT_BACKUP_VERSION && version !== 14 && version !== 15 && version !== 16) {
    errors.push(`只接受 v14、v15、v16 或当前备份版本 v${CURRENT_BACKUP_VERSION}。`)
  }

  if (version === 14 || version === 15 || version === 16) {
    for (const spec of PROJECT_TABLES.filter(spec => spec.exportable && (spec.introducedBackupVersion ?? 1) > version)) {
      if (spec.name in input) errors.push(`v${version} 不允许携带 v${spec.introducedBackupVersion} 新增表 ${spec.name}。`)
    }
    warnings.push(`已验证的 v${version} 备份将在导入时转换为 v${CURRENT_BACKUP_VERSION}；只增加新表空数组，不运行插件。`)
  }
  if (version === 14 || version === 15 || version === 16) warnings.push('旧备份缺失的叙事注释保持缺失，不能自动视为已确认语义。')
  const project = input.project
  const projectName = isRecord(project) && typeof project.name === 'string' && project.name.trim()
    ? project.name.trim()
    : null
  if (!projectName) errors.push('备份缺少项目名称，无法安全恢复。')
  if (isRecord(project)) {
    inspectExactKeys(
      project,
      '工作区根 project',
      CURRENT_PROJECT_EXPORT_KEYS,
      REQUIRED_PROJECT_EXPORT_KEYS,
      errors,
    )
    if (project.workspacePurpose !== 'independent-work' && project.workspacePurpose !== 'world-engine') {
      errors.push('工作区根 project.workspacePurpose 无效。')
    }
  }

  const ownership = input.ownership
  if (!isRecord(ownership)
    || ownership.contractVersion !== 1
    || !Number.isInteger(ownership.worldExportId)
    || !Number.isInteger(ownership.workExportId)) {
    errors.push('备份缺少当前 ownership 根契约。')
  }

  const missingTables: string[] = []
  let presentTables = 0
  let recordCount = 0
  for (const tableName of exportableTables) {
    if (!(tableName in input)) {
      missingTables.push(tableName)
      continue
    }
    const rows = input[tableName]
    if (!Array.isArray(rows)) {
      errors.push(`表「${tableName}」不是数组，备份可能已损坏。`)
      continue
    }
    presentTables += 1
    recordCount += rows.length
    const spec = PROJECT_TABLES.find(table => table.name === tableName)!
    errors.push(...inspectPortableTableStructure(spec, rows))
    const annotations = spec.worldSemantic?.projector?.annotationFields ?? []
    rows.forEach((row, index) => {
      if (!isRecord(row)) return
      for (const field of NARRATIVE_DOMAIN_FIELDS_V1) {
        const portable = `_${field}Portable`
        if (field in row) errors.push(`${tableName}[${index}].${field} 不允许携带本地叙事坐标。`)
        if (!(portable in row)) continue
        if ((version !== 16 && version !== CURRENT_BACKUP_VERSION) || !annotations.includes(field)) {
          errors.push(`${tableName}[${index}].${portable} 未在此备份版本/来源登记。`)
          continue
        }
        try { parseNarrativeDomainFieldV1(field, row[portable], 'portable') }
        catch (error) { errors.push(`${tableName}[${index}].${portable}: ${String(error)}`) }
      }
    })
  }

  if (missingTables.length > 0) {
    errors.push(`备份缺少 ${missingTables.length} 张当前必需表：${missingTables.join('、')}。`)
  }

  if (Array.isArray(input.works)) {
    input.works.forEach((row, index) => {
      if (!isRecord(row)) {
        errors.push(`works[${index}] 不是对象。`)
        return
      }
      inspectExactKeys(row, `works[${index}]`, CURRENT_WORK_EXPORT_KEYS, REQUIRED_WORK_EXPORT_KEYS, errors)
      if (!Array.isArray(row.genres) || !row.genres.every(value => typeof value === 'string')) {
        errors.push(`works[${index}].genres 必须是字符串数组。`)
      }
      if (typeof row.includeCultivationProgressInAI !== 'boolean') {
        errors.push(`works[${index}].includeCultivationProgressInAI 必须是布尔值。`)
      }
      if (row.kind === 'novel') {
        if (row.novelProfile !== 'short' && row.novelProfile !== 'long') {
          errors.push(`works[${index}] 的小说流程配置无效。`)
        }
      } else if ((row.kind !== 'screenplay' && row.kind !== 'comic' && row.kind !== 'motion-drama' && row.kind !== 'avg' && row.kind !== 'ttrpg' && row.kind !== 'ai-town' && row.kind !== 'character-interaction') || row.novelProfile !== null) {
        errors.push(`works[${index}] 的作品类型或流程配置无效。`)
      }
    })
  }

  if (Array.isArray(input.worlds)) {
    input.worlds.forEach((row, index) => {
      if (!isRecord(row)) {
        errors.push(`worlds[${index}] 不是对象。`)
        return
      }
      inspectExactKeys(row, `worlds[${index}]`, CURRENT_WORLD_EXPORT_KEYS, REQUIRED_WORLD_EXPORT_KEYS, errors)
      if ((row.identityKind !== 'workspace-scope' && row.identityKind !== 'world-draft')
        || !isCurrentWorldCode(row.identityKind, row.code)) {
        errors.push(`worlds[${index}] 的世界身份或稳定编号无效。`)
      }
    })
  }

  if (version === CURRENT_BACKUP_VERSION || version === 14 || version === 15 || version === 16) {
    const present = new Set(['projects', ...exportableTables])
    errors.push(...inspectPortableRequiredReferencesV1(PROJECT_TABLES.filter(spec => present.has(spec.name)), input))
  }

  if ((version === 16 || version === CURRENT_BACKUP_VERSION) && errors.length === 0) {
    try {
      assertNarrativeDomainReferenceRowsV1(new Map(PROJECT_TABLES.filter(spec => spec.exportable && spec.name !== 'projects')
        .map(spec => [spec.name, input[spec.name] as Record<string, unknown>[]])), 'portable')
    } catch (error) { errors.push(String(error)) }
  }
  if (errors.length === 0) {
    const { issues } = reviewPortableLocalReferencesV1(input, false)
    if (issues.length > 0) warnings.push(
      `有 ${issues.length} 项关联待确认。可确认内容会恢复；其余原值会保存到当前作品置顶便签「${BACKUP_REFERENCE_REVIEW_TITLE}」。`,
    )
  }
  return {
    valid: errors.length === 0,
    version,
    projectName,
    presentTables,
    recordCount,
    missingTables,
    warnings,
    errors,
  }
}

/** 在任何写库动作前调用；错误信息保持面向用户且可定位。 */
export function assertTrustedProjectBackup(input: unknown): asserts input is Record<string, unknown> {
  const report = inspectProjectBackup(input)
  if (!report.valid) throw new Error(`备份预检失败：${report.errors.join('；')}`)
}

/** Validate the exact legacy contract before adding registry-declared missing tables. */
export function normalizeProjectBackup<T extends { version: number }>(input: T): T {
  assertTrustedProjectBackup(input)
  if (input.version === CURRENT_BACKUP_VERSION) return input
  const next = { ...input, version: CURRENT_BACKUP_VERSION } as T & Record<string, unknown>
  for (const spec of PROJECT_TABLES) if (spec.exportable && !(spec.name in next)
    && ((spec.introducedBackupVersion ?? 1) > input.version
      || (spec.optionalInBackupVersions ?? []).includes(input.version))) {
    Object.defineProperty(next, spec.name, { value: [], enumerable: true, writable: true, configurable: true })
  }
  assertTrustedProjectBackup(next)
  return next
}
