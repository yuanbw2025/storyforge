import { db } from '../db/schema'
import { importProjectJSON } from '../export/json-export'
import { hashCanonicalValue } from '../agent/run/hash'
import { isWorkCode, isWorkspaceUid } from '../memory/identity'
import {
  captureWorkspaceContentRevisionV1,
  verifyWorkspaceContentRevisionV1,
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

export type WorldDerivationRangeV1 =
  | { kind: 'all-confirmed-canon' }
  | { kind: 'registered-tables'; tables: string[] }

export interface DeriveNovelToWorldInput {
  sourceScope: WorkspaceScope
  targetName?: string
  selectedTables?: string[]
  /** A draft always receives revision 1; publish additionally seals release 1. */
  publish?: boolean
}

export interface DerivedNovelWorldResult {
  sourceScope: WorkspaceScope
  targetScope: WorkspaceScope
  targetProjectId: number
  revision: WorldRevision
  release: WorldRelease | null
  derivation: WorldDerivationV1
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
    targetProjectId = await importProjectJSON(snapshot.portableProject as any)
    await promoteNovelWorkspaceToWorldEngine(targetProjectId)
    const targetScope = await resolveScope({ projectId: targetProjectId })
    const targetName = input.targetName?.trim() || `${sourceWork.title} · 世界`
    const targetDescription = sourceWork.description?.trim()
      || `由作品《${sourceWork.title}》的已确认语义内容显式派生。`
    const renamedAt = Date.now()
    await db.transaction('rw', scopeTransactionTables(db.worldDerivations), async () => {
      await Promise.all([
        db.projects.update(targetProjectId!, { name: targetName, description: targetDescription, updatedAt: renamedAt }),
        db.worlds.update(targetScope.worldId, { name: targetName, description: targetDescription, updatedAt: renamedAt }),
        db.works.update(targetScope.workId, { title: targetName, description: targetDescription, updatedAt: renamedAt }),
      ])
    })

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
