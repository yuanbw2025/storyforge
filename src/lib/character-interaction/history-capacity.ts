import type {ChatSituationV1} from '../types/chat-narrative'

/** Storage bounds are separate from frozen authoring and active-story limits.
 * History stays in the existing instance; retrieval never deletes it. These
 * are safety ceilings, not a claim of tested conversation length. */
export const CHAT_HISTORY_CAPACITY_V1 = Object.freeze({
  facts: 4096,
  goals: 1024,
  threads: 1024,
  commitmentsPerGoal: 1024,
  totalCommitments: 4096,
  situationCharacters: 8_000_000,
  unfinishedGoals: 32,
})

export function assertChatHistoryCapacityV1(situation: ChatSituationV1): void {
  const limits = CHAT_HISTORY_CAPACITY_V1
  if (situation.goals.filter(g => g.status === 'active' || g.status === 'paused').length > limits.unfinishedGoals) {
    throw new Error('[chat-history] 未完成或暂停目标超出上限；结束的历史不占用活跃额度。')
  }
  if (situation.goals.reduce((sum, g) => sum + (g.commitments?.length ?? 0), 0) > limits.totalCommitments
    || JSON.stringify(situation).length > limits.situationCharacters) {
    throw new Error('[chat-history] 完整故事历史已达存储容量，已停止；原事实、目标、剧情线和约定保留，请先导出存档。')
  }
}
