import { db } from '../db/schema'
import {
  generateWorkspaceScopeCode,
  generateWorldCode,
  isPublicWorldCode,
} from '../product/world-identity'
import type {
  WorkspacePurpose,
  WorkspacePurposeDecision,
  WorldIdentityKind,
} from '../types'
import { effectiveWorkKind } from './work-kind'
import { ensureWorkspaceOwnership } from './ownership'

export interface WorkspaceIdentityClassificationReportV1 {
  version: 1
  projectId: number
  currentPurpose: WorkspacePurpose
  decision: WorkspacePurposeDecision
  readOnly: true
  evidence: {
    internalWorldCount: number
    workCount: number
    worldReleaseCount: number
    communityImport: boolean
    activeWorkKind: 'novel' | 'screenplay' | 'comic' | null
    legacyProjectWorldCode: string | null
  }
  allowedConfirmations: WorkspacePurpose[]
  explanation: string
}

/**
 * ARCH-01 legacy classification is deliberately read-only.  Merely opening a
 * catalog must never turn an old authored work into a public world product.
 */
export async function inspectWorkspaceIdentity(projectId: number): Promise<WorkspaceIdentityClassificationReportV1> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('[identity] 工作区不存在')
  const [worldCount, works, releaseCount] = await Promise.all([
    db.worlds.where('projectId').equals(projectId).count(),
    db.works.where('projectId').equals(projectId).toArray(),
    db.worldReleases.where('projectId').equals(projectId).count(),
  ])
  const active = works.find(work => work.id === project.activeWorkId) ?? works[0]
  const kind = active ? effectiveWorkKind(active) : null
  const allowedConfirmations: WorkspacePurpose[] = kind === 'screenplay' || kind === 'comic'
    ? ['independent-work']
    : ['independent-work', 'world-engine']
  return {
    version: 1,
    projectId,
    currentPurpose: project.workspacePurpose ?? 'independent-work',
    decision: project.workspacePurposeDecision ?? 'legacy-review-required',
    readOnly: true,
    evidence: {
      internalWorldCount: worldCount,
      workCount: works.length,
      worldReleaseCount: releaseCount,
      communityImport: Boolean(project.communityOrigin?.sourceWorldCode),
      activeWorkKind: kind,
      legacyProjectWorldCode: project.worldCode ?? null,
    },
    allowedConfirmations,
    explanation: project.workspacePurposeDecision === 'legacy-review-required'
      ? '旧版本曾自动分配世界编号；系统默认保留为独立作品，只有作者确认后才获得世界身份。'
      : '该工作区的产品身份已经明确。',
  }
}

async function allocatePublicCode(projectId: number, candidates: Array<string | undefined>): Promise<string> {
  for (const candidate of [...candidates, ...Array.from({ length: 8 }, () => generateWorldCode())]) {
    if (!isPublicWorldCode(candidate)) continue
    const collision = await db.worlds.where('code').equals(candidate).first()
    if (!collision || collision.projectId === projectId) return candidate
  }
  throw new Error('[identity] 无法分配唯一世界编号')
}

/** Explicit author decision; this is the only legacy promotion path. */
export async function confirmWorkspacePurpose(
  projectId: number,
  purpose: WorkspacePurpose,
  options: { decision?: WorkspacePurposeDecision } = {},
): Promise<void> {
  const ownership = await ensureWorkspaceOwnership(projectId)
  const report = await inspectWorkspaceIdentity(projectId)
  if (!report.allowedConfirmations.includes(purpose)) {
    throw new Error('[identity] 剧本和漫画保持独立，不能直接确认成世界引擎')
  }
  const publicCode = purpose === 'world-engine'
    ? await allocatePublicCode(projectId, [ownership.world.code, ownership.project.worldCode])
    : null
  const internalCode = purpose === 'independent-work' && isPublicWorldCode(ownership.world.code)
    ? generateWorkspaceScopeCode()
    : ownership.world.code

  await db.transaction('rw', db.projects, db.worlds, db.worldReleases, async () => {
    const [project, world] = await Promise.all([
      db.projects.get(projectId),
      db.worlds.get(ownership.scope.worldId),
    ])
    if (!project || !world || world.projectId !== projectId) {
      throw new Error('[identity] 确认期间工作区作用域发生变化')
    }
    const releases = await db.worldReleases.where('worldId').equals(world.id!).toArray()
    const version = Math.max(0, ...releases.map(release => release.version))
    const identityKind: WorldIdentityKind = purpose === 'world-engine' ? 'world-draft' : 'workspace-scope'
    const updatedAt = Date.now()
    await db.worlds.update(world.id!, {
      identityKind,
      code: publicCode ?? internalCode,
      currentVersion: purpose === 'world-engine' ? version : world.currentVersion,
      updatedAt,
    })
    await db.projects.update(projectId, {
      workspacePurpose: purpose,
      workspacePurposeDecision: options.decision ?? 'legacy-confirmed',
      worldCode: publicCode ?? undefined,
      worldVersion: publicCode ? version : undefined,
      updatedAt,
    })
  })
}
