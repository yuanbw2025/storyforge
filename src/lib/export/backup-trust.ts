/**
 * 便携备份预检（PRODUCT-1）。
 *
 * 这是导入边界的只读检查：表清单来自 PROJECT_TABLES，不复制一套导出枚举，也不访问
 * IndexedDB。v14/v15 和分支定义不同的 v16 经严格校验进入 v17；
 * 仅按表注册元数据补缺失的新增空表，不臆造注释、作者确认或运行记忆。
 */
import { PROJECT_TABLES } from '../registry/project-tables'
import { isCurrentWorldCode } from '../workspace/identity'
import { NARRATIVE_DOMAIN_FIELDS_V1, parseNarrativeDomainFieldV1 } from '../narrative-domain/codec'
import { assertNarrativeDomainReferenceRowsV1 } from '../narrative-domain/integrity'

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

  if ((version === 16 || version === CURRENT_BACKUP_VERSION) && errors.length === 0) {
    try {
      assertNarrativeDomainReferenceRowsV1(new Map(PROJECT_TABLES.filter(spec => spec.exportable && spec.name !== 'projects')
        .map(spec => [spec.name, input[spec.name] as Record<string, unknown>[]])), 'portable')
    } catch (error) { errors.push(String(error)) }
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
