import { db } from '../db/schema'
import { importProjectJSON } from '../export/json-export'
import { hashCanonicalValue } from '../agent/run/hash'
import { isWorkCode, isWorkspaceUid } from '../memory/identity'
import {
  captureWorkspaceContentRevisionV1,
  verifyWorkspaceContentRevisionV1,
  type WorkspaceContentRevisionVectorV1,
} from '../authoring/content-revision'
import { cascadeDeleteProject } from '../registry/lifecycle'
import type {
  WorldDerivationV1,
  WorldRelease,
  WorldRevision,
  WorkspaceScope,
} from '../types'
import { promoteNovelWorkspaceToWorldEngine } from './promotion'
import {
  buildIndependentWorkWorldSnapshot,
  createWorldRevision,
  publishWorldRevision,
  stableJson,
} from './releases'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { effectiveNovelProfile, effectiveWorkKind } from '../workspace/work-kind'
import { materializeWorldReleaseBackupV1 } from './semantic-snapshot'

export type WorldDerivationRangeV1 =
  | { kind: 'all-confirmed-canon' }
  | { kind: 'registered-tables'; tables: string[] }

export interface DeriveNovelToWorldInput {
  sourceScope: WorkspaceScope
  targetName?: string
  selectedTables?: string[]
  /** A draft always receives revision 1; publish additionally seals release 1. */
  publish?: boolean
  /** Explicit development preview; v3 remains the released default. */
  formatVersion?: 3 | 4
  /** Optional author-reviewed source preview. Omitted by existing derivation
   * callers; supplied by flows that must reject edits since their preview. */
  expectedSourceRevision?: WorkspaceContentRevisionVectorV1
}

export interface DerivedNovelWorldResult {
  sourceScope: WorkspaceScope
  targetScope: WorkspaceScope
  targetProjectId: number
  revision: WorldRevision
  release: WorldRelease | null
  derivation: WorldDerivationV1
}

/** Shared metadata seam for a newly-created derived World. Never rename the
 * independent source, and keep Work metadata on its existing Work owner. */
export async function nameDerivedWorldV1(scope: WorkspaceScope, name: string, description: string): Promise<void> {
  scope = { ...scope }
  await db.transaction('rw', scopeTransactionTables(), async () => {
    const resolved = await resolveScope({ scope })
    if ((await db.projects.get(resolved.projectId))?.workspacePurpose !== 'world-engine') throw Error('[derivation] 目标不是独立世界草稿')
    const updatedAt = Date.now()
    await db.projects.update(resolved.projectId, { name, updatedAt })
    await db.worlds.update(resolved.worldId, { name, description, updatedAt })
    await db.works.update(resolved.workId, { title: name, description, updatedAt })
  })
}

/**
 * ARCH-01 / D-WORLD-03.
 *
 * Explicitly copies the registered semantic Canon of an independent long/short
 * novel into a new world-owned workspace. The source remains untouched and the
 * copy never follows later source edits. A failure after import removes only the
 * newly-created target workspace through the registered lifecycle.
 */
export async function deriveNovelToWorld(
  input: DeriveNovelToWorldInput,
): Promise<DerivedNovelWorldResult> {
  const expectedSourceRevision = input.expectedSourceRevision && structuredClone(input.expectedSourceRevision)
  if (input.formatVersion !== undefined && input.formatVersion !== 3 && input.formatVersion !== 4) throw Error('[derivation] 未知派生封存格式')
  if (input.formatVersion === 4) return (await import('./narrative-derivation')).deriveNarrativeNovelToWorldV4(input)
  const sourceScope = await resolveScope({ scope: input.sourceScope })
  const [sourceProject, sourceWork] = await Promise.all([
    db.projects.get(sourceScope.projectId),
    db.works.get(sourceScope.workId),
  ])
  if (!sourceProject || !sourceWork) throw new Error('[derivation] 源作品不存在')
  if (sourceProject.workspacePurpose === 'world-engine') {
    throw new Error('[derivation] 世界引擎不能再次作为独立作品派生')
  }
  if (effectiveWorkKind(sourceWork) !== 'novel') {
    throw new Error('[derivation] 只有长篇或短篇小说可以派生世界')
  }
  if (!isWorkspaceUid(sourceProject.workspaceUid) || !isWorkCode(sourceWork.code)) {
    throw new Error('[derivation] 源作品缺少当前架构的稳定工作区或作品身份')
  }

  const sourceRevision = await captureWorkspaceContentRevisionV1({
    scope: sourceScope,
    worldGroupId: null,
  })
  if (expectedSourceRevision) {
    const expected = await verifyWorkspaceContentRevisionV1(expectedSourceRevision, { scope: sourceScope, worldGroupId: null })
    if (!expected.fresh || expected.current.vectorHash !== sourceRevision.vectorHash) {
      throw new Error('[derivation] 作者预览后源作品已变化，请重新检查来源再派生世界草稿')
    }
  }
  const snapshot = await buildIndependentWorkWorldSnapshot({
    scope: sourceScope,
    selectedTables: input.selectedTables,
  })
  const freshness = await verifyWorkspaceContentRevisionV1(sourceRevision, {
    scope: sourceScope,
    worldGroupId: null,
  })
  if (!freshness.fresh) {
    throw new Error(`[derivation] 捕获期间源作品发生变化：${freshness.changedTables.join('、') || '未知表'}`)
  }

  let targetProjectId: number | null = null
  try {
    // Import first as an independent workspace because the frozen source still
    // carries an internal workspace-scope World. The explicit promotion below
    // atomically creates the public world-draft identity.
    targetProjectId = await importProjectJSON(materializeWorldReleaseBackupV1(snapshot, {
      workspacePurpose: 'independent-work',
    }))
    await promoteNovelWorkspaceToWorldEngine(targetProjectId)
    const targetScope = await resolveScope({ projectId: targetProjectId })
    const targetName = input.targetName?.trim() || `${sourceWork.title} · 世界`
    const targetDescription = sourceWork.description?.trim()
      || `由作品《${sourceWork.title}》的已确认语义内容显式派生。`
    await nameDerivedWorldV1(targetScope, targetName, targetDescription)

    const revision = await createWorldRevision({
      scope: targetScope,
      label: `源自《${sourceWork.title}》的初始世界快照`,
      selectedTables: input.selectedTables,
    })
    const release = input.publish ? await publishWorldRevision(revision.id!) : null
    const selectedResourceIds = snapshot.sourceManifest?.selectedResourceIds ?? []
    const sourceRange: WorldDerivationRangeV1 = input.selectedTables
      ? { kind: 'registered-tables', tables: [...new Set(input.selectedTables)].sort() }
      : { kind: 'all-confirmed-canon' }
    const row: WorldDerivationV1 = {
      projectId: targetProjectId,
      worldId: targetScope.worldId,
      sourceWorkspaceUid: sourceProject.workspaceUid,
      sourceWorkCode: sourceWork.code,
      sourceWorkRevision: sourceWork.updatedAt,
      sourceRevisionVectorJson: stableJson(sourceRevision),
      sourceKind: effectiveNovelProfile(sourceWork) === 'short' ? 'short-novel' : 'long-novel',
      sourceRangeJson: stableJson(sourceRange),
      selectedResourceIdsJson: stableJson(selectedResourceIds),
      sourceContentHash: await hashCanonicalValue(snapshot),
      targetRevisionId: revision.id!,
      targetReleaseId: release?.id ?? null,
      createdAt: Date.now(),
    }
    const derivationId = await db.worldDerivations.add(row) as number
    return {
      sourceScope,
      targetScope,
      targetProjectId,
      revision,
      release,
      derivation: { ...row, id: derivationId },
    }
  } catch (cause) {
    if (targetProjectId != null && await db.projects.get(targetProjectId)) {
      try {
        await cascadeDeleteProject(targetProjectId)
      } catch (cleanupCause) {
        const primary = cause instanceof Error ? cause.message : String(cause)
        const cleanup = cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause)
        throw new Error(`[derivation] 派生失败，且新目标工作区回滚失败：${primary}；回滚：${cleanup}`)
      }
    }
    throw cause
  }
}
