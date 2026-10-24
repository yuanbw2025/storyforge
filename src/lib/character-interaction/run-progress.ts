import {readInstanceAgentRunV1} from '../agent/run/event-store'
import {db} from '../db/schema'
import {assertInstanceBinding} from '../product/runtime-instances'
import type {WorkspaceScope} from '../types'

// Persisted Harness identifiers. This reader does not inspect prompts, raw
// responses, candidate bodies or reviewer reasons, including on failed runs.
const GENERATION_STEP = 'interaction:runtime-candidate'
const LABELS: Record<string, string> = {
  'character.interaction-reply': '角色回复',
  'character.chat-narrative-action': '角色行动',
  'character.chat-action-revision': '行动后果修订',
  'character.chat-narrative-options': '行动候选',
  'character.chat-situation-construction': '局面补充',
  'prose.interaction-scene-director': '角色接续安排',
  'character.interaction-memory-curator': '记忆候选',
}

/** A display-only projection of verified durable events, never a liveness or
 * retry decision. The caller must distinguish a local operation from history. */
export async function readChatRunProgressV1(scope: WorkspaceScope, sessionId: number, runId: number) {
  // Establish the reactive dependency before ownership verification crosses
  // WebCrypto boundaries. Every Harness event updates this materialized row;
  // its contents are never displayed without the verified replay below.
  const observed = await db.agentRuns.get(runId)
  if (!observed || observed.productRuntimeSessionId !== sessionId) throw new Error('无法核对当前聊天的运行阶段。')
  const owner = await assertInstanceBinding(sessionId, scope)
  const snapshot = await readInstanceAgentRunV1(scope, runId)
  const binding = snapshot.contract.executionBindings?.find(b => b.stepId === GENERATION_STEP)
  if (owner.kind !== 'character-interaction' || snapshot.run.productRuntimeSessionId !== sessionId
    || snapshot.contract.scope.runtime?.releaseHash !== owner.runtimeSourceHash || !binding || !LABELS[binding.skillId]) {
    throw new Error('无法核对当前聊天的运行阶段。')
  }
  const events = snapshot.events, state = snapshot.projection.state
  const result = (phase: string, label: string, detail: string, since = events[events.length - 1]?.createdAt ?? snapshot.run.createdAt) =>
    ({phase, label, detail, since})
  if (state === 'cancelled') return result('cancelled', '已停止本次处理', '已发出的请求可能仍会计费；不会自动重发。')
  if (state === 'failed') return result('failed', '本次处理未完成', '请查看失败或恢复提示；已保存的故事与调用记录会保留，不会自动重发。')
  if (state === 'completed') return result('completed', '本次处理已完成', '结果已保存。')
  if (['paused', 'recovering', 'recovery_required'].includes(state)
    || events[events.length - 1]?.type === 'verification.staled'
    || Object.values(snapshot.projection.steps).some(step => step.status === 'stale')) {
    return result('attention', '运行需要处理', '请按恢复提示核对原运行；不会自动生成新结果。')
  }
  if (events.some(event => event.type === 'runtime.candidate.adopted')) {
    return result('applied', '结果已应用，正在核对保存记录', '已经发生的故事不会因停止等待而撤销。')
  }
  if (state === 'awaiting_confirmation') return result('choice', '候选已保存，等待选择', '选定前不会应用候选的行动后果。')
  const review = snapshot.contract.executionBindings?.find(b => ['interaction:action-review', 'interaction:situation-review', 'interaction:memory-review'].includes(b.stepId))
  const reviewing = review && snapshot.projection.steps[review.stepId]
  if (reviewing?.status === 'succeeded') return result('ready', '检查已通过，等待保存结果', '保存完成后才会更新故事。')
  const choosing = snapshot.projection.steps['interaction:action-choice']
  if (choosing && !reviewing && !events.some(event => event.type === 'model.requested' && event.payload.stepId === GENERATION_STEP)) {
    if (choosing.status === 'succeeded') return result('preparing', '行动进度已保存，等待继续表达', '尚未改变故事；继续后仍需完成回复和检查。')
    const response = events.find(event => event.type === 'model.responded' && event.payload.stepId === 'interaction:action-choice')
    if (response) return result('response', '正在核对行动方向', '回复和后果尚未生效。', response.createdAt)
    const request = events.find(event => event.type === 'model.requested' && event.payload.stepId === 'interaction:action-choice')
    if (request) return result('generation', '正在选择角色的下一步行动', '依据角色已知的情况准备下一步；尚未改变故事。', request.createdAt)
  }
  const stepId = reviewing ? review!.stepId : GENERATION_STEP
  const requested = [...events].reverse().find(event => event.type === 'model.requested' && event.payload.stepId === stepId)
  const responded = [...events].reverse().find(event => event.type === 'model.responded' && event.payload.stepId === stepId)
  if (responded && (!requested || responded.sequence > requested.sequence)) {
    return result(reviewing ? 'review-result' : 'response', reviewing ? '正在验证检查结果' : `已收到${LABELS[binding.skillId]}，正在检查格式`,
      '完整检查通过并保存后才会更新故事。', responded.createdAt)
  }
  if (requested) return result(reviewing ? 'review' : 'generation', reviewing ? '正在核对候选与故事后果' : `等待${LABELS[binding.skillId]}`,
    reviewing ? '候选尚未应用；正在核对人物、已知事实和玩家选择。' : '正在等待完整回复；收到并检查后才会应用。', requested.createdAt)
  return result('preparing', reviewing ? '正在准备候选检查' : `正在准备${LABELS[binding.skillId]}`, '正在读取本次处理所需的已有资料。')
}

export type ChatRunProgressV1 = Awaited<ReturnType<typeof readChatRunProgressV1>>
