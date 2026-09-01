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
  parsePureWorldReleaseManifestV3,
  verifyPureWorldReleaseManifestV3,
} from '../world-engine/release-codec'

export const WORLD_PACKAGE_FORMAT = 'storyforge.world-package'
export const WORLD_PACKAGE_VERSION = 2

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
  releaseHash: string
  narrativeModules: []
}

export interface WorldPackage {
  format: typeof WORLD_PACKAGE_FORMAT
  packageVersion: typeof WORLD_PACKAGE_VERSION
  manifest: WorldPackageManifest
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
  importable: boolean
  manifest: WorldPackageManifest | null
  errors: string[]
  warnings: string[]
}

const LICENSES = new Set<CommunityWorldLicense>([
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'ALL-RIGHTS-RESERVED',
])
const ROOT_TABLES = new Set(['worlds', 'works'])
const WORLD_SEMANTIC_TABLES = new Set(
  PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.name),
)
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function payloadForIntegrity(pkg: Omit<WorldPackage, 'integrity'>) {
  return {
    format: pkg.format,
    packageVersion: pkg.packageVersion,
    manifest: pkg.manifest,
    release: pkg.release,
  }
}

export async function createWorldPackage(
  releaseId: number,
  options: {
    authorName: string
    attribution?: string
    license: CommunityWorldLicense
    allowedUses: Record<WorldPackageUse, boolean>
    contentWarnings?: string[]
  },
): Promise<WorldPackage> {
  await assertReleaseUnchanged(releaseId)
  const release = await db.worldReleases.get(releaseId)
  if (!release) throw new Error('发布版本不存在。')
  const releaseManifest = await verifyPureWorldReleaseManifestV3({
    manifest: release.manifestJson,
    expectedContentHash: release.contentHash,
    expectedWorldCode: release.sourceWorldCode,
  })
  if (!options.authorName.trim()) throw new Error('请填写作者署名。')
  if (!LICENSES.has(options.license)) throw new Error('许可选项无效。')
  if (!Object.values(options.allowedUses).some(Boolean)) throw new Error('至少选择一种允许的使用方式。')
  const manifest: WorldPackageManifest = {
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
  const withoutIntegrity: Omit<WorldPackage, 'integrity'> = {
    format: WORLD_PACKAGE_FORMAT,
    packageVersion: WORLD_PACKAGE_VERSION,
    manifest,
    release: {
      label: release.label,
      version: release.version,
      contentHash: release.contentHash,
      manifest: cloneJson(releaseManifest),
    },
  }
  const pkg: WorldPackage = {
    ...withoutIntegrity,
    integrity: { algorithm: 'SHA-256', digest: await sha256(canonicalStringify(payloadForIntegrity(withoutIntegrity))) },
  }
  if (new TextEncoder().encode(canonicalStringify(pkg)).byteLength > WORLD_PACKAGE_MAX_BYTES) {
    throw new Error(`世界分享包超过 ${WORLD_PACKAGE_MAX_BYTES / 1024 / 1024} MiB 纯语义包预算。`)
  }
  return pkg
}

/** Read-only validation of the sole supported, pure-semantic package protocol. */
export async function inspectWorldPackage(input: unknown): Promise<WorldPackageTrustReport> {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(input)) {
    return { valid: false, importable: false, manifest: null, errors: ['分享包必须是 JSON 对象。'], warnings }
  }
  if (input.format !== WORLD_PACKAGE_FORMAT) errors.push('这不是 StoryForge 世界分享包。')
  if (input.packageVersion !== WORLD_PACKAGE_VERSION) {
    errors.push(`不支持的世界分享包版本：${String(input.packageVersion)}。`)
  }

  let manifest: WorldPackageManifest | null = null
  const rawManifest = input.manifest
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
    if (typeof rawManifest.releaseHash !== 'string') errors.push('分享包缺少发布哈希。')
    if (!Array.isArray(rawManifest.narrativeModules) || rawManifest.narrativeModules.length !== 0) errors.push('世界分享包不得包含产品叙事模块。')
    if (errors.length === 0) manifest = rawManifest as unknown as WorldPackageManifest
  }

  const release = isRecord(input.release) ? input.release : null
  let releaseManifest: ReturnType<typeof parsePureWorldReleaseManifestV3> | null = null
  if (!release || typeof release.contentHash !== 'string' || typeof release.version !== 'number') {
    errors.push('世界分享包缺少冻结发布。')
  } else {
    try {
      releaseManifest = await verifyPureWorldReleaseManifestV3({
        manifest: release.manifest,
        expectedContentHash: release.contentHash,
        expectedWorldCode: manifest?.sourceWorldCode,
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '冻结世界发布无效。')
    }
  }

  if (manifest && release && releaseManifest) {
    if (manifest.releaseHash !== release.contentHash
      || manifest.sourceWorldVersion !== release.version
      || manifest.name !== releaseManifest.worldName) {
      errors.push('世界分享包的发布身份不一致。')
    }
    const portable = releaseManifest.portableProject as unknown as ProjectExportData
    const backupReport = inspectProjectBackup(portable)
    if (!backupReport.valid) errors.push(...backupReport.errors)
    warnings.push(...backupReport.warnings)
    const selected = new Set(releaseManifest.selectedTables)
    for (const [tableName, rows] of Object.entries(portable)) {
      if (!Array.isArray(rows) || rows.length === 0 || ROOT_TABLES.has(tableName)) continue
      if (!WORLD_SEMANTIC_TABLES.has(tableName) || !selected.has(tableName)) {
        errors.push(`纯语义世界包包含未冻结的资源「${tableName}」。`)
      } else if (canonicalStringify(rows) !== canonicalStringify(releaseManifest.records[tableName])) {
        errors.push(`便携数据与冻结资源「${tableName}」不一致。`)
      }
    }
  }

  const integrity = input.integrity
  if (!isRecord(integrity) || integrity.algorithm !== 'SHA-256' || typeof integrity.digest !== 'string') {
    errors.push('分享包缺少完整性校验。')
  } else if (manifest && release) {
    const payload = {
      format: WORLD_PACKAGE_FORMAT,
      packageVersion: WORLD_PACKAGE_VERSION,
      manifest,
      release,
    } as Omit<WorldPackage, 'integrity'>
    if (await sha256(canonicalStringify(payloadForIntegrity(payload))) !== integrity.digest) {
      errors.push('分享包完整性校验失败，文件可能已被修改。')
    }
  }

  const valid = errors.length === 0
  return { valid, importable: valid, manifest, errors, warnings }
}

export async function importWorldPackage(input: unknown): Promise<number> {
  const report = await inspectWorldPackage(input)
  if (!report.valid || !report.importable || !report.manifest || !isRecord(input) || !isRecord(input.release)) {
    throw new Error(`世界分享包预检失败：${report.errors.join('；')}`)
  }
  const release = input.release
  const releaseManifest = parsePureWorldReleaseManifestV3(release.manifest)
  const packageData = releaseManifest.portableProject as unknown as ProjectExportData
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
  const importedProjectId = await importProjectJSON({ ...packageData, project } as ProjectExportData)
  try {
    const importedProject = await db.projects.get(importedProjectId)
    if (!importedProject?.activeWorldId || !importedProject.worldCode) {
      throw new Error('世界包导入后缺少当前 World 指针。')
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

export function downloadWorldPackage(pkg: WorldPackage, filename: string) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const WORLD_PACKAGE_SHAREABLE_TABLES = [
  'worlds',
  'works',
  ...PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.name),
]
