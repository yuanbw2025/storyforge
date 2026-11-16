import { hashCanonicalValue } from '../agent/run/hash'
import {
  captureWorkspaceContentRevisionV1,
  verifyWorkspaceContentRevisionV1,
  type WorkspaceContentRevisionVectorV1,
} from '../authoring/content-revision'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { deriveNovelToWorld, type DerivedNovelWorldResult } from '../world-engine/derivation'
import { resolveScope } from '../workspace/scope'
import { effectiveWorkKind } from '../workspace/work-kind'

export interface TextOpenWorldNovelWorldDraftPreviewV1 {
  sourceScope: WorkspaceScope
  workCode: string
  workTitle: string
  range: 'all-confirmed-canon'
  sourceRevision: WorkspaceContentRevisionVectorV1
  previewHash: string
}

async function sourceWork(scope: WorkspaceScope) {
  const [project, work] = await Promise.all([db.projects.get(scope.projectId), db.works.get(scope.workId)])
  if (!project || !work || work.projectId !== scope.projectId || work.worldId !== scope.worldId
    || project.workspacePurpose !== 'independent-work' || effectiveWorkKind(work) !== 'novel') {
    throw new Error('请从一部独立长篇或短篇小说派生世界草稿。')
  }
  return work
}

/** S1 preparation only: no model, ProductProduction, media or runtime owner. */
export async function previewTextOpenWorldNovelWorldDraftV1(
  scopeInput: WorkspaceScope,
): Promise<TextOpenWorldNovelWorldDraftPreviewV1> {
  const sourceScope = await resolveScope({ scope: { ...scopeInput } })
  const work = await sourceWork(sourceScope)
  const sourceRevision = await captureWorkspaceContentRevisionV1({ scope: sourceScope, worldGroupId: null })
  const current = await sourceWork(sourceScope)
  if (current.code !== work.code || current.title !== work.title || current.updatedAt !== work.updatedAt) {
    throw new Error('预览期间源作品已变化，请重新检查。')
  }
  const body = {
    sourceScope, workCode: work.code, workTitle: work.title,
    range: 'all-confirmed-canon' as const, sourceRevision,
  }
  return { ...body, previewHash: await hashCanonicalValue(body) }
}

/** The author explicitly creates a separate draft, then inspects and seals it
 * in the World product. A novel preview never fabricates a WorldReference or
 * carries old production/start/media authorization into a new lineage. */
export async function deriveTextOpenWorldNovelWorldDraftV1(
  input: TextOpenWorldNovelWorldDraftPreviewV1,
): Promise<DerivedNovelWorldResult> {
  const preview = structuredClone(input)
  const { previewHash, ...body } = preview
  if (preview.range !== 'all-confirmed-canon' || await hashCanonicalValue(body) !== previewHash) {
    throw new Error('派生预览或范围已变化，请重新检查全部已确认语义；当前不支持按卷或章节范围派生。')
  }
  const sourceScope = await resolveScope({ scope: preview.sourceScope })
  const work = await sourceWork(sourceScope)
  const checked = await verifyWorkspaceContentRevisionV1(preview.sourceRevision, { scope: sourceScope, worldGroupId: null })
  if (work.code !== preview.workCode || work.title !== preview.workTitle || !checked.fresh) {
    throw new Error('作者预览后源作品已变化，请重新检查后再派生世界草稿。')
  }
  return deriveNovelToWorld({
    sourceScope, publish: false, expectedSourceRevision: preview.sourceRevision,
  })
}
