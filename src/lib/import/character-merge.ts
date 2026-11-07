import { db } from '../db/schema'
import { ImportSessionAuthorityError, ImportSessionUnavailableError } from '../../stores/import-session'
import { useImportStatusStore } from '../../stores/import-status'

interface RunCharacterMergeArgs {
  sessionId: number
  projectId: number
  isFinal: boolean
  signal?: AbortSignal
  isPaused?: () => boolean
}

/** Distinct existing identities require an explicit author decision. The old
 * model-only alias path did not have one and may no longer dispatch or write. */
export async function runCharacterMerge(args: RunCharacterMergeArgs): Promise<void> {
  if (args.signal?.aborted || args.isPaused?.()) return
  const session = await db.importSessions.get(args.sessionId)
  if (!session) throw new ImportSessionUnavailableError()
  if (session.projectId !== args.projectId) throw new ImportSessionAuthorityError('不能操作其他工作区的导入会话。')
  if (session.importTarget !== 'project' || !args.isFinal) return
  useImportStatusStore.getState().pushActivity('info', '未执行跨块角色自动合并；原有角色保留，请由作者核对异名角色。')
}
