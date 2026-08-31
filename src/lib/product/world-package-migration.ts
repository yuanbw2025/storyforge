import { hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import { importProjectJSON, type ProjectExportData } from '../export/json-export'
import { cascadeDeleteProject } from '../registry/lifecycle'
import type { WorldReleaseMigrationV1 } from '../types'
import { confirmWorkspacePurpose } from '../world-engine/identity-classification'
import { createWorldRevision, publishWorldRevision, stableJson } from '../world-engine/releases'
import { WORLD_SEMANTIC_TABLE_NAMES } from '../world-engine/release-classification'
import { resolveWorkspaceScope } from '../world-engine/ownership'
import {
  inspectWorldPackage,
  WORLD_PACKAGE_V2_VERSION,
  type WorldPackageTrustReport,
} from './world-package'

export interface LegacyWorldPackageMigrationResultV1 {
  report: WorldPackageTrustReport
  semanticProjectId: number
  semanticReleaseId: number
  productRecoveryProjectId: number | null
  receipt: WorldReleaseMigrationV1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function packagePortableProject(input: Record<string, unknown>): ProjectExportData | null {
  if (input.packageVersion === WORLD_PACKAGE_V2_VERSION && isRecord(input.release)) {
    const manifest = isRecord(input.release.manifest) ? input.release.manifest : null
    return manifest && isRecord(manifest.portableProject)
      ? manifest.portableProject as unknown as ProjectExportData
      : null
  }
  return isRecord(input.portableProject) ? input.portableProject as unknown as ProjectExportData : null
}

function sanitizeRootPurpose(portable: ProjectExportData): ProjectExportData {
  const copy = clone(portable) as unknown as Record<string, unknown>
  const project = isRecord(copy.project) ? { ...copy.project } : {}
  project.workspacePurpose = 'independent-work'
  project.workspacePurposeDecision = 'legacy-review-required'
  delete project.worldCode
  delete project.worldVersion
  copy.project = project
  if (Array.isArray(copy.worlds)) {
    copy.worlds = copy.worlds.map(value => isRecord(value)
      ? { ...value, identityKind: 'workspace-scope' }
      : value)
  }
  if (Array.isArray(copy.works)) {
    copy.works = copy.works.map(value => isRecord(value)
      ? { ...value, kind: 'novel', novelProfile: 'long', targetWordCount: 0, currentWordCount: 0 }
      : value)
  }
  return copy as unknown as ProjectExportData
}

function semanticPortableProject(portable: ProjectExportData): ProjectExportData {
  const copy = sanitizeRootPurpose(portable) as unknown as Record<string, unknown>
  const allowed = new Set(['worlds', 'works', ...WORLD_SEMANTIC_TABLE_NAMES])
  for (const [key, value] of Object.entries(copy)) {
    // Current strict backups require the complete registered table skeleton.
    // Emptying a non-semantic table proves no row crossed the boundary while
    // preserving import/lifecycle schema completeness.
    if (Array.isArray(value) && !allowed.has(key)) copy[key] = []
  }
  return copy as unknown as ProjectExportData
}

async function renameMigrationWorkspace(projectId: number, name: string): Promise<void> {
  const scope = await resolveWorkspaceScope(projectId)
  const now = Date.now()
  await db.transaction('rw', db.projects, db.worlds, db.works, async () => {
    await Promise.all([
      db.projects.update(projectId, { name, updatedAt: now }),
      db.worlds.update(scope.worldId, { name, updatedAt: now }),
      db.works.update(scope.workId, { title: name, updatedAt: now }),
    ])
  })
}

/**
 * ARCH-02 compatibility migration. The semantic half becomes a clean new
 * WorldRelease. Any known product/media/runtime rows are retained in a separate
 * independent recovery workspace. Unknown non-empty tables fail closed so the
 * original package remains the recovery source rather than being silently lost.
 */
export async function migrateLegacyWorldPackageV1(
  input: unknown,
): Promise<LegacyWorldPackageMigrationResultV1> {
  const report = await inspectWorldPackage(input)
  if (!report.valid || !report.manifest || !report.migrationRequired || !isRecord(input)) {
    throw new Error('只有通过完整性预检且需要迁移的历史世界包可以执行分类迁移。')
  }
  const unknownRows = report.classification?.tables
    .filter(table => table.role === 'unknown' && table.rowCount > 0) ?? []
  if (unknownRows.length > 0) {
    throw new Error(`历史包含当前版本无法识别的表：${unknownRows.map(table => table.table).join('、')}；已停止迁移且未写入数据。`)
  }
  const portable = packagePortableProject(input)
  if (!portable) throw new Error('历史世界包缺少可恢复的便携项目。')
  const hasProductRecovery = Boolean(report.classification?.tables.some(table => (
    table.rowCount > 0 && ['product-content', 'product-media', 'runtime'].includes(table.role)
  )))

  let semanticProjectId: number | null = null
  let recoveryProjectId: number | null = null
  try {
    semanticProjectId = await importProjectJSON(semanticPortableProject(portable))
    await confirmWorkspacePurpose(semanticProjectId, 'world-engine', { decision: 'explicit' })
    await renameMigrationWorkspace(semanticProjectId, `${report.manifest.name}（纯语义迁移）`)
    const semanticScope = await resolveWorkspaceScope(semanticProjectId)
    const revision = await createWorldRevision({
      scope: semanticScope,
      label: `由历史包 ${report.manifest.packageId} 分类迁移`,
      selectedTables: WORLD_SEMANTIC_TABLE_NAMES,
    })
    const release = await publishWorldRevision(revision.id!, `迁移自 ${report.manifest.packageId}`)

    let recoveryWorkspaceUid: string | null = null
    let recoveryContentHash: string | null = null
    if (hasProductRecovery) {
      const recoveryPortable = sanitizeRootPurpose(portable)
      recoveryProjectId = await importProjectJSON(recoveryPortable)
      await confirmWorkspacePurpose(recoveryProjectId, 'independent-work', { decision: 'legacy-confirmed' })
      await renameMigrationWorkspace(recoveryProjectId, `${report.manifest.name}（旧产品内容恢复）`)
      recoveryWorkspaceUid = (await db.projects.get(recoveryProjectId))?.workspaceUid ?? null
      recoveryContentHash = await hashCanonicalValue(recoveryPortable)
    }

    const row: WorldReleaseMigrationV1 = {
      projectId: semanticProjectId,
      worldId: semanticScope.worldId,
      sourcePackageId: report.manifest.packageId,
      sourceWorldCode: report.manifest.sourceWorldCode,
      sourceWorldVersion: report.manifest.sourceWorldVersion,
      classificationJson: stableJson(report.classification),
      semanticReleaseId: release.id!,
      semanticContentHash: release.contentHash,
      productRecoveryWorkspaceUid: recoveryWorkspaceUid,
      productRecoveryContentHash: recoveryContentHash,
      createdAt: Date.now(),
    }
    const id = await db.worldReleaseMigrations.add(row) as number
    return {
      report,
      semanticProjectId,
      semanticReleaseId: release.id!,
      productRecoveryProjectId: recoveryProjectId,
      receipt: { ...row, id },
    }
  } catch (cause) {
    for (const projectId of [semanticProjectId, recoveryProjectId]) {
      if (projectId != null && await db.projects.get(projectId)) await cascadeDeleteProject(projectId)
    }
    throw cause
  }
}
