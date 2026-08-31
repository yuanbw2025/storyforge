import { importProjectJSON, type ProjectExportData } from '../export/json-export'
import { inspectProjectBackup } from '../export/backup-trust'
import { PROJECT_TABLES } from '../registry/project-tables'
import { db } from '../db/schema'
import { cascadeDeleteProject } from '../registry/lifecycle'
import type { CommunityWorldLicense, WorldReleaseManifestV2 } from '../types'
import { generateWorldCode } from './world-identity'
import { assertReleaseUnchanged, stableJson } from '../world-engine/releases'
import { resolveWorkspaceScope } from '../world-engine/ownership'
import {
  classifyWorldReleasePayloadV1,
  WORLD_SEMANTIC_TABLE_NAMES,
  type WorldReleaseClassificationV1,
} from '../world-engine/release-classification'

export const WORLD_PACKAGE_FORMAT = 'storyforge.world-package'
export const WORLD_PACKAGE_VERSION = 1
export const WORLD_PACKAGE_V2_VERSION = 2

export type WorldPackageUse = 'writing' | 'ttrpg' | 'characterChat' | 'textGame'

export interface WorldPackageManifest {
  packageId: string
  sourceWorldCode: string
  sourceWorldVersion: number
  name: string
  description: string
  authorName: string
  attribution: string
  license: CommunityWorldLicense
  allowedUses: Record<WorldPackageUse, boolean>
  contentWarnings: string[]
  publishedAt: number
}

export interface WorldPackage {
  format: typeof WORLD_PACKAGE_FORMAT
  packageVersion: typeof WORLD_PACKAGE_VERSION
  manifest: WorldPackageManifest
  portableProject: ProjectExportData
  integrity: { algorithm: 'SHA-256'; digest: string }
}

export interface WorldPackageV2Manifest extends WorldPackageManifest {
  releaseHash: string
  narrativeModules: WorldReleaseManifestV2['selectedNarrativeModules']
}

export interface WorldPackageV2 {
  format: typeof WORLD_PACKAGE_FORMAT
  packageVersion: typeof WORLD_PACKAGE_V2_VERSION
  manifest: WorldPackageV2Manifest
  release: {
    label: string
    version: number
    contentHash: string
    manifest: WorldReleaseManifestV2
  }
  integrity: { algorithm: 'SHA-256'; digest: string }
}

export interface WorldPackageTrustReport {
  valid: boolean
  /** Pure semantic packages are importable; legacy packages require split migration. */
  importable: boolean
  migrationRequired: boolean
  manifest: WorldPackageManifest | null
  backupReport: ReturnType<typeof inspectProjectBackup> | null
  classification: WorldReleaseClassificationV1 | null
  errors: string[]
  warnings: string[]
}

const LICENSES = new Set<CommunityWorldLicense>([
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'ALL-RIGHTS-RESERVED',
])

const ROOT_TABLES = ['worlds', 'works'] as const
// Frozen at PLATFORM-1 v1 (commit 60df0b4). Later world-engine tables are
// optional when importing an existing v1 package, even if current v1 exports include them.
const V1_REQUIRED_SHAREABLE_TABLES = [
  'worldviews',
  'powerSystems',
  'cultivationSystems',
  'geographies',
  'histories',
  'worldNodes',
  'historicalTimelineEvents',
  'historicalKeywords',
  'importantLocations',
  'worldRulesProfiles',
  'characters',
  'characterRelations',
  'codexCategories',
  'codexEntries',
  'worldGroups',
  'worldGroupLinks',
] as const

const LEGACY_V1_WORLD_TABLES = PROJECT_TABLES
  .filter(spec => spec.legacyWorldPackageV1 === 'world'
    && spec.name !== 'projects'
    && spec.name !== 'worldReleases')
  .map(spec => spec.name)

const LEGACY_V1_PRIVATE_TABLES = PROJECT_TABLES
  .filter(spec => spec.exportable && spec.legacyWorldPackageV1 !== 'world'
    && spec.name !== 'projects' && !ROOT_TABLES.includes(spec.name as typeof ROOT_TABLES[number]))
  .map(spec => spec.name)

const WORLD_SEMANTIC_SET = new Set(WORLD_SEMANTIC_TABLE_NAMES)
const WORLD_PACKAGE_MAX_BYTES = 32 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前环境不支持分享包完整性校验。')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function payloadForIntegrity(pkg: Omit<WorldPackage, 'integrity'> | Omit<WorldPackageV2, 'integrity'>) {
  return pkg.packageVersion === WORLD_PACKAGE_VERSION
    ? { format: pkg.format, packageVersion: pkg.packageVersion, manifest: pkg.manifest, portableProject: pkg.portableProject }
    : { format: pkg.format, packageVersion: pkg.packageVersion, manifest: pkg.manifest, release: pkg.release }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export async function createWorldPackage(
  projectId: number,
  options: {
    authorName: string
    attribution?: string
    license: CommunityWorldLicense
    allowedUses: Record<WorldPackageUse, boolean>
    contentWarnings?: string[]
  },
): Promise<WorldPackage> {
  void projectId
  void options
  throw new Error('世界包 v1 仅供历史读取与迁移；请先封存纯语义 WorldRelease，再生成 v2 分享包。')
}

export async function createWorldPackageV2(
  releaseId: number,
  options: {
    authorName: string
    attribution?: string
    license: CommunityWorldLicense
    allowedUses: Record<WorldPackageUse, boolean>
    contentWarnings?: string[]
  },
): Promise<WorldPackageV2> {
  await assertReleaseUnchanged(releaseId)
  const release = await db.worldReleases.get(releaseId)
  if (!release) throw new Error('发布版本不存在。')
  const releaseManifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV2
  if (releaseManifest.schema !== WORLD_PACKAGE_FORMAT || releaseManifest.version !== 2
    || releaseManifest.semanticContract !== 3) {
    throw new Error('该发布不是纯语义 WorldRelease；旧发布必须先执行分类迁移。')
  }
  if (releaseManifest.selectedNarrativeModules.length > 0
    || releaseManifest.selectedTables.some(table => !WORLD_SEMANTIC_SET.has(table))) {
    throw new Error('WorldRelease 含上层产品内容，不能生成世界分享包。')
  }
  if (!options.authorName.trim()) throw new Error('请填写作者署名。')
  if (!LICENSES.has(options.license)) throw new Error('许可选项无效。')
  if (!Object.values(options.allowedUses).some(Boolean)) throw new Error('至少选择一种允许的使用方式。')
  const manifest: WorldPackageV2Manifest = {
    packageId: `${release.sourceWorldCode}@v${release.version}`,
    sourceWorldCode: release.sourceWorldCode,
    sourceWorldVersion: release.version,
    name: releaseManifest.worldName,
    description: release.label,
    authorName: options.authorName.trim(),
    attribution: options.attribution?.trim() || `${options.authorName.trim()} · ${releaseManifest.worldName}`,
    license: options.license,
    allowedUses: { ...options.allowedUses },
    contentWarnings: (options.contentWarnings ?? []).map(item => item.trim()).filter(Boolean).slice(0, 12),
    publishedAt: release.createdAt,
    releaseHash: release.contentHash,
    narrativeModules: [],
  }
  const withoutIntegrity: Omit<WorldPackageV2, 'integrity'> = {
    format: WORLD_PACKAGE_FORMAT,
    packageVersion: WORLD_PACKAGE_V2_VERSION,
    manifest,
    release: {
      label: release.label,
      version: release.version,
      contentHash: release.contentHash,
      manifest: cloneJson(releaseManifest),
    },
  }
  const pkg: WorldPackageV2 = {
    ...withoutIntegrity,
    integrity: { algorithm: 'SHA-256', digest: await sha256(canonicalStringify(withoutIntegrity)) },
  }
  if (new TextEncoder().encode(canonicalStringify(pkg)).byteLength > WORLD_PACKAGE_MAX_BYTES) {
    throw new Error(`世界分享包超过 ${WORLD_PACKAGE_MAX_BYTES / 1024 / 1024} MiB 纯语义包预算。`)
  }
  return pkg
}

/** 只读验证包格式、分享范围和完整性；不写入 IndexedDB。 */
export async function inspectWorldPackage(input: unknown): Promise<WorldPackageTrustReport> {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(input)) return { valid: false, importable: false, migrationRequired: false, manifest: null, backupReport: null, classification: null, errors: ['分享包必须是 JSON 对象。'], warnings }
  if (input.format !== WORLD_PACKAGE_FORMAT) errors.push('这不是 StoryForge 世界分享包。')
  if (input.packageVersion !== WORLD_PACKAGE_VERSION && input.packageVersion !== WORLD_PACKAGE_V2_VERSION) {
    errors.push(`不支持的世界分享包版本：${String(input.packageVersion)}。`)
  }

  const rawManifest = input.manifest
  let manifest: WorldPackageManifest | null = null
  if (!isRecord(rawManifest)) {
    errors.push('分享包缺少发布信息。')
  } else {
    const allowedUses = rawManifest.allowedUses
    const validUses = isRecord(allowedUses)
      && ['writing', 'ttrpg', 'characterChat', 'textGame'].every(key => typeof allowedUses[key] === 'boolean')
      && Object.values(allowedUses).some(value => value === true)
    if (typeof rawManifest.packageId !== 'string' || typeof rawManifest.sourceWorldCode !== 'string' || typeof rawManifest.name !== 'string') errors.push('发布信息缺少世界编号或名称。')
    if (typeof rawManifest.sourceWorldVersion !== 'number' || !Number.isInteger(rawManifest.sourceWorldVersion)) errors.push('世界版本无效。')
    if (typeof rawManifest.authorName !== 'string' || !rawManifest.authorName.trim()) errors.push('分享包缺少作者署名。')
    if (!LICENSES.has(rawManifest.license as CommunityWorldLicense)) errors.push('分享包许可无效。')
    if (!validUses) errors.push('分享包没有有效的二创用途声明。')
    if (!Array.isArray(rawManifest.contentWarnings) || rawManifest.contentWarnings.some(value => typeof value !== 'string')) errors.push('内容警告格式无效。')
    if (errors.length === 0) manifest = rawManifest as unknown as WorldPackageManifest
  }

  const v2Release = input.packageVersion === WORLD_PACKAGE_V2_VERSION && isRecord(input.release) ? input.release : null
  const v2Manifest = v2Release && isRecord(v2Release.manifest) ? v2Release.manifest : null
  const portableInput = input.packageVersion === WORLD_PACKAGE_V2_VERSION
    ? v2Manifest?.portableProject
    : input.portableProject
  const backupReport = isRecord(portableInput) ? inspectProjectBackup(portableInput) : null
  const classification = await classifyWorldReleasePayloadV1({
    manifest: v2Manifest as WorldReleaseManifestV2 | null,
    portableProject: isRecord(portableInput) ? portableInput : null,
  })
  const semanticV2 = input.packageVersion === WORLD_PACKAGE_V2_VERSION
    && v2Manifest?.semanticContract === 3
    && classification.contract === 'semantic-v3'
  if (!backupReport) errors.push('分享包缺少可导入的世界数据。')
  else if (!backupReport.valid) errors.push(...backupReport.errors)

  const portable = portableInput
  if (isRecord(portable)) {
    const rawV2SelectedTables = v2Manifest && Array.isArray(v2Manifest.selectedTables)
      ? v2Manifest.selectedTables
      : []
    const v2SelectedTables = rawV2SelectedTables.filter((name): name is string => typeof name === 'string')
    const allowedSelectedTables = semanticV2 ? WORLD_SEMANTIC_TABLE_NAMES : LEGACY_V1_WORLD_TABLES
    if (input.packageVersion === WORLD_PACKAGE_V2_VERSION
      && (!v2Manifest
        || v2SelectedTables.length !== rawV2SelectedTables.length
        || new Set(v2SelectedTables).size !== v2SelectedTables.length
        || v2SelectedTables.some(name => !allowedSelectedTables.includes(name)))) {
      errors.push('世界包 v2 的模块表清单无效。')
    }
    const expectedShareableTables = input.packageVersion === WORLD_PACKAGE_V2_VERSION && v2Manifest
      ? [...new Set([...ROOT_TABLES, ...v2SelectedTables])]
      : V1_REQUIRED_SHAREABLE_TABLES
    for (const tableName of expectedShareableTables) {
      if (!Array.isArray(portable[tableName])) errors.push(`分享包缺少世界表「${tableName}」。`)
    }
    if (input.packageVersion === WORLD_PACKAGE_V2_VERSION && v2Manifest) {
      const selected = new Set(v2SelectedTables)
      for (const tableName of allowedSelectedTables) {
        if (!selected.has(tableName) && Array.isArray(portable[tableName]) && portable[tableName].length > 0) {
          errors.push(`世界包 v2 含有未在清单选择的表「${tableName}」。`)
        }
      }
      if (!isRecord(v2Manifest.records)) {
        errors.push('世界包 v2 缺少逐表冻结记录。')
      } else {
        const recordNames = Object.keys(v2Manifest.records)
        if (recordNames.length !== v2SelectedTables.length
          || recordNames.some(name => !selected.has(name))) {
          errors.push('世界包 v2 的冻结记录与模块表清单不一致。')
        }
        for (const tableName of v2SelectedTables) {
          if (!Array.isArray(v2Manifest.records[tableName])) {
            errors.push(`世界包 v2 缺少冻结记录「${tableName}」。`)
          } else if (!Array.isArray(portable[tableName])
            || canonicalStringify(v2Manifest.records[tableName]) !== canonicalStringify(portable[tableName])) {
            errors.push(`世界包 v2 的便携数据与冻结记录「${tableName}」不一致。`)
          }
        }
      }
      if (!Array.isArray(v2Manifest.dependencies)
        || v2Manifest.dependencies.length !== v2SelectedTables.length
        || new Set(v2Manifest.dependencies.map(item => item?.table)).size !== v2Manifest.dependencies.length) {
        errors.push('世界包 v2 的依赖锁清单无效。')
      } else if (isRecord(v2Manifest.records)) {
        for (const dependency of v2Manifest.dependencies) {
          const rows = v2Manifest.records[dependency.table]
          if (!selected.has(dependency.table)
            || !Array.isArray(rows)
            || dependency.rowCount !== rows.length
            || !/^[0-9a-f]{64}$/.test(dependency.contentHash)
            || await sha256(canonicalStringify(rows)) !== dependency.contentHash) {
            errors.push(`世界包 v2 的依赖锁「${dependency.table}」无效。`)
          }
        }
      }
    }
    if (semanticV2) {
      for (const [tableName, value] of Object.entries(portable)) {
        if (!Array.isArray(value) || value.length === 0 || ROOT_TABLES.includes(tableName as typeof ROOT_TABLES[number])) continue
        if (!WORLD_SEMANTIC_SET.has(tableName)) {
          errors.push(`纯语义世界包包含非世界资源「${tableName}」，已拒绝导入。`)
        }
      }
    } else if (input.packageVersion === WORLD_PACKAGE_VERSION) {
      for (const tableName of LEGACY_V1_PRIVATE_TABLES) {
        if (Array.isArray(portable[tableName]) && portable[tableName].length > 0) {
          errors.push(`历史分享包包含当时未授权的私有表「${tableName}」，已拒绝读取。`)
        }
      }
    }
  }

  const integrity = input.integrity
  if (!isRecord(integrity) || integrity.algorithm !== 'SHA-256' || typeof integrity.digest !== 'string') {
    errors.push('分享包缺少完整性校验。')
  } else if (manifest) {
    if (input.packageVersion === WORLD_PACKAGE_V2_VERSION) {
      if (!v2Release || !v2Manifest || v2Manifest.schema !== WORLD_PACKAGE_FORMAT || v2Manifest.version !== 2) {
        errors.push('世界包 v2 缺少有效的冻结发布清单。')
      } else {
        // Release hashes use the exact canonical serializer that froze the
        // release. Package integrity has its own serializer, but the two must
        // never be mixed as table-key growth can expose ordering differences.
        const releaseHash = await sha256(stableJson(v2Manifest))
        if (releaseHash !== v2Release.contentHash || releaseHash !== (manifest as WorldPackageV2Manifest).releaseHash) {
          errors.push('世界包 v2 的发布哈希不一致。')
        }
        const payload = {
          format: WORLD_PACKAGE_FORMAT,
          packageVersion: WORLD_PACKAGE_V2_VERSION,
          manifest: manifest as WorldPackageV2Manifest,
          release: v2Release,
        } as WorldPackageV2
        if (await sha256(canonicalStringify(payloadForIntegrity(payload))) !== integrity.digest) {
          errors.push('分享包完整性校验失败，文件可能已被修改。')
        }
      }
    } else if (isRecord(input.portableProject)) {
      const payload = {
        format: WORLD_PACKAGE_FORMAT,
        packageVersion: WORLD_PACKAGE_VERSION,
        manifest,
        portableProject: input.portableProject as unknown as ProjectExportData,
      } as WorldPackage
      if (await sha256(canonicalStringify(payloadForIntegrity(payload))) !== integrity.digest) errors.push('分享包完整性校验失败，文件可能已被修改。')
    }
  }

  if (backupReport?.warnings.length) warnings.push(...backupReport.warnings)
  if (classification.migrationRequired && errors.length === 0) {
    warnings.push('该历史世界包混有产品内容、媒资或旧边界数据；可读取，但必须先分类迁移，不能直接导入为新世界。')
  }
  const valid = errors.length === 0
  return {
    valid,
    importable: valid && semanticV2,
    migrationRequired: valid && classification.migrationRequired,
    manifest,
    backupReport,
    classification,
    errors,
    warnings,
  }
}

export async function importWorldPackage(input: unknown): Promise<number> {
  const report = await inspectWorldPackage(input)
  if (!report.valid || !report.manifest || !isRecord(input)) throw new Error(`世界分享包预检失败：${report.errors.join('；')}`)
  if (!report.importable) {
    throw new Error('该历史世界包需要先执行分类迁移；系统不会把产品内容或媒资直接写入新世界。')
  }
  const isV2 = input.packageVersion === WORLD_PACKAGE_V2_VERSION
  const release = isV2 && isRecord(input.release) ? input.release : null
  const releaseManifest = release && isRecord(release.manifest)
    ? release.manifest as unknown as WorldReleaseManifestV2
    : null
  const packageData = (isV2 ? releaseManifest?.portableProject : input.portableProject) as unknown as ProjectExportData
  const project = { ...(packageData.project as Record<string, unknown>) }
  project.worldCode = generateWorldCode()
  project.worldVersion = report.manifest.sourceWorldVersion
  project.workspacePurpose = 'world-engine'
  project.workspacePurposeDecision = 'explicit'
  project.communityOrigin = {
    packageId: report.manifest.packageId,
    sourceWorldCode: report.manifest.sourceWorldCode,
    sourceWorldVersion: report.manifest.sourceWorldVersion,
    authorName: report.manifest.authorName,
    license: report.manifest.license,
    importedAt: Date.now(),
  }
  project.status = 'drafting'
  project.targetWordCount = 0
  project.currentWordCount = 0
  const portable = { ...packageData, project } as ProjectExportData
  const importedProjectId = await importProjectJSON(portable)
  if (!isV2 || !release || !releaseManifest) return importedProjectId
  try {
    const importedProject = await db.projects.get(importedProjectId)
    if (!importedProject?.activeWorldId || !importedProject.worldCode) {
      throw new Error('世界包 v2 导入后缺少当前 World 指针')
    }
    await db.worlds.update(importedProject.activeWorldId, {
      identityKind: 'world-draft',
      code: importedProject.worldCode,
      currentVersion: report.manifest.sourceWorldVersion,
      communityOrigin: importedProject.communityOrigin,
      updatedAt: Date.now(),
    })
    const scope = await resolveWorkspaceScope(importedProjectId)
    const now = Date.now()
    const revisionId = await db.worldRevisions.add({
      projectId: importedProjectId,
      worldId: scope.worldId,
      parentRevisionId: null,
      revision: Number(release.version),
      label: String(release.label),
      manifestJson: stableJson(releaseManifest),
      contentHash: String(release.contentHash),
      createdAt: now,
      updatedAt: now,
    }) as number
    await db.worldReleases.add({
      projectId: importedProjectId,
      worldId: scope.worldId,
      revisionId,
      version: Number(release.version),
      label: String(release.label),
      manifestJson: stableJson(releaseManifest),
      contentHash: String(release.contentHash),
      sourceWorldCode: report.manifest.sourceWorldCode,
      createdAt: now,
    })
    await db.worlds.update(scope.worldId, { currentVersion: Number(release.version), updatedAt: now })
    await db.projects.update(importedProjectId, { worldVersion: Number(release.version), updatedAt: now })
    return importedProjectId
  } catch (cause) {
    await cascadeDeleteProject(importedProjectId)
    throw cause
  }
}

export function downloadWorldPackage(pkg: WorldPackage | WorldPackageV2, filename: string) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const WORLD_PACKAGE_SHAREABLE_TABLES = [...ROOT_TABLES, ...WORLD_SEMANTIC_TABLE_NAMES]
export const WORLD_PACKAGE_V1_REQUIRED_TABLES = [...V1_REQUIRED_SHAREABLE_TABLES]
