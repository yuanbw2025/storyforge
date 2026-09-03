/**
 * 便携备份预检（PRODUCT-1）。
 *
 * 这是导入边界的只读检查：表清单来自 PROJECT_TABLES，不复制一套导出枚举，也不访问
 * IndexedDB。旧版本可以缺少后来新增的表，但不能携带错误的根结构或错误的表类型。
 */
import { PROJECT_TABLES } from '../registry/project-tables'

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
  if (version == null || version < 1) errors.push('缺少有效的备份版本号。')
  if (version != null && version > CURRENT_BACKUP_VERSION) {
    errors.push(`备份版本 v${version} 高于当前支持的 v${CURRENT_BACKUP_VERSION}，请先升级 StoryForge。`)
  }

  const project = input.project
  const projectName = isRecord(project) && typeof project.name === 'string' && project.name.trim()
    ? project.name.trim()
    : null
  if (!projectName) errors.push('备份缺少项目名称，无法安全恢复。')

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

  if (version != null && version >= 6) {
    for (const tableName of ['adaptationProjects', 'adaptationSourceUnits']) {
      if (!Array.isArray(input[tableName])) errors.push(`v${version} 备份缺少必需表「${tableName}」。`)
    }
  }
  if (version != null && version >= 7 && !Array.isArray(input.screenplayScenes)) {
    errors.push(`v${version} 备份缺少必需表「screenplayScenes」。`)
  }
  if (version != null && version >= 8) {
    for (const tableName of ['comicPages', 'comicPanels', 'comicVisualSubjects']) {
      if (!Array.isArray(input[tableName])) errors.push(`v${version} 备份缺少必需表「${tableName}」。`)
    }
  }
  if (version != null && version >= 9) {
    for (const tableName of ['comicMediaAssets', 'mediaBlobObjects']) {
      if (!Array.isArray(input[tableName])) errors.push(`v${version} 备份缺少必需表「${tableName}」。`)
    }
  }
  if (version != null && version >= 10) {
    for (const tableName of [
      'productProductions', 'productProductionBriefs', 'productProductionCommands',
      'productBuilds', 'productBuildArtifacts', 'productQualityGateReceipts',
      'productReleases', 'productMediaAssets', 'productMediaBlobs',
      'productRuntimeSessions', 'productRuntimeEvents', 'productRuntimeCheckpoints',
    ]) {
      if (!Array.isArray(input[tableName])) errors.push(`v${version} 备份缺少必需表「${tableName}」。`)
    }
  }

  if (missingTables.length > 0) {
    warnings.push(`这是旧格式或精简备份，缺少 ${missingTables.length} 张后来新增的表；缺失表将按空表兼容导入。`)
  }
  if (version != null && version < CURRENT_BACKUP_VERSION) {
    warnings.push(`备份版本 v${version} 将按兼容规则导入，并升级为当前项目格式。`)
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
