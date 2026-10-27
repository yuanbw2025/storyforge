import type { WorkspaceScope } from '../types'

const active = new Set<string>()

/** Same execution-owner pattern as node authoring: a reload may claim an idle
 * request, never race a still-running tab. This is separate from the Run store's
 * non-reentrant per-event lock; every durable write still uses its sequence CAS. */
export async function withTtrpgOpenDesignOwnerV1<T>(scope: WorkspaceScope, operation: () => Promise<T>, externalRecovery = false): Promise<T> {
  const key = `storyforge:ttrpg-open-design:${scope.projectId}:${scope.worldId}:${scope.workId}`
  const busy = () => new Error('另一份设计请求仍在本机页面执行或恢复，请先在原页面停止等待并保留原记录')
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(key, { ifAvailable: true }, lock => {
      if (!lock) throw busy()
      return operation()
    })
  }
  if (active.has(key)) throw busy()
  if (externalRecovery && typeof window !== 'undefined') throw new Error('当前浏览器不能确认其他页面是否仍在执行，请使用支持安全恢复的本机浏览器；原记录保留')
  active.add(key)
  try { return await operation() } finally { active.delete(key) }
}
