import Dexie, { type Transaction } from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'

/** Existing Work-owned Harness admission. Never borrow a Work for a World-only entry. */
export function assertLongformHistoryScopeV1(scope: WorkspaceScope, worldGroupId: number | null, transaction?: Transaction) {
  const projects = transaction ? transaction.table(db.projects.name) : db.projects
  const works = transaction ? transaction.table(db.works.name) : db.works
  return Dexie.Promise.all([projects.get(scope.projectId), works.get(scope.workId)]).then(([project, work]) => {
    if (project?.enableMultiWorld && worldGroupId === null) throw new Error('请选择具体历史分区后生成。')
    if (!project || project.workspacePurpose === 'world-engine' || project.activeWorldId !== scope.worldId || project.activeWorkId !== scope.workId
      || work?.kind !== 'novel' || work.novelProfile !== 'long' || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('请回到原长篇作品核对历史生成目标。')
  })
}
