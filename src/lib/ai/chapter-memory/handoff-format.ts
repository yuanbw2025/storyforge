import type { ChapterContinuityHandoff } from '../../types'

/**
 * 把结构化 handoff 序列化为提示词行。纯函数、无 DB 依赖：
 * 生产上下文装配（continuity-context.ts）与 NS-0/NS-1 评测器（evals/long-consistency）
 * 共用同一份序列化，保证"评测里喂给模型的 handoff"与"线上真正喂的 handoff"逐字一致。
 */
export function formatHandoff(handoff: ChapterContinuityHandoff): string[] {
  const lines: string[] = []
  const scene = handoff.finalScene
  if (scene.location) lines.push(`结尾地点：${scene.location}`)
  if (scene.storyTime) lines.push(`结尾时间：${scene.storyTime}`)
  if (scene.activeCharacters.length) lines.push(`现场角色：${scene.activeCharacters.join('、')}`)
  if (scene.lastAction) lines.push(`最后动作：${scene.lastAction}`)
  if (handoff.stateChanges.length) lines.push(`状态变化：${handoff.stateChanges.join('；')}`)
  if (handoff.knowledgeChanges.length) lines.push(`认知变化：${handoff.knowledgeChanges.join('；')}`)
  if (handoff.commitments.length) lines.push(`承诺/硬约束：${handoff.commitments.join('；')}`)
  if (handoff.openLoops.length) lines.push(`未闭环：${handoff.openLoops.join('；')}`)
  if (handoff.immediateNextIntent) lines.push(`下一步意图：${handoff.immediateNextIntent}`)
  if (handoff.evidenceQuotes.length) {
    lines.push(`证据引文：${handoff.evidenceQuotes.map(item => `“${item.quote}”`).join('；')}`)
  }
  return lines
}
