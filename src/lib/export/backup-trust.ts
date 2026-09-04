/**
 * 便携备份预检（PRODUCT-1）。
 *
 * 这是导入边界的只读检查：表清单来自 PROJECT_TABLES，不复制一套导出枚举，也不访问
 * IndexedDB。只接受与当前架构完全一致的备份，不执行升级或缺表补空。
 */
import { PROJECT_TABLES } from '../registry/project-tables'
import { isCurrentWorldCode } from '../workspace/identity'

export const CURRENT_BACKUP_VERSION = 10

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
    .filter(spec => spec.exportable && spec.name !== 'projects')
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
  if (version !== CURRENT_BACKUP_VERSION) {
    errors.push(`只接受当前备份版本 v${CURRENT_BACKUP_VERSION}。`)
  }

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
      } else if ((row.kind !== 'screenplay' && row.kind !== 'comic') || row.novelProfile !== null) {
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
