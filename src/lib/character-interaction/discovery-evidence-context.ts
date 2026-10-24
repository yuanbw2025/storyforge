import type {CharacterInteractionRuntimeState} from '../types'
import type {AgentRunSnapshotV1} from '../agent/run/event-store'

export function supportsChatDiscoveryEvidenceProducerV1(version: string | undefined): boolean {
  return ['chat-situation-construction-v11', 'chat-situation-construction-v12', 'chat-situation-construction-v13', 'chat-situation-construction-v14', 'chat-situation-construction-v15', 'chat-situation-construction-v16', 'chat-situation-construction-v17', 'chat-situation-construction-v18', 'chat-situation-construction-v19', 'chat-situation-construction-v20', 'chat-situation-construction-v21'].includes(version ?? '')
}
export function supportsChatDiscoveryEvidenceReviewerV1(version: string | undefined): boolean {
  return ['chat-situation-review-v10', 'chat-situation-review-v11', 'chat-situation-review-v12', 'chat-situation-review-v13', 'chat-situation-review-v14', 'chat-situation-review-v15', 'chat-situation-review-v16', 'chat-situation-review-v17', 'chat-situation-review-v18', 'chat-situation-review-v19'].includes(version ?? '')
}

/** This is an index into already committed facts, not a finding or permission.
 * The runtime still validates every submitted reference and discovery rule. */
export function chatDiscoveryEvidenceContextV1(state: CharacterInteractionRuntimeState) {
  const story = state.chatNarrative, pending = story?.pendingSituation, scene = state.activeScene
  if (!story || !pending || !scene || !story.permissions.maxDiscoveriesPerSituation
    || !scene.activeParticipantKeys.includes(pending.actorKey)) return null
  const message = state.messages.find(m => m.role === 'character' && m.speakerKey === pending.actorKey
    && m.eventSequence === pending.sourceEventSequence && m.supersededBySequence == null)
  if (!message) return null
  const known = story.situation.facts.filter(f => f.audienceKeys.includes(pending.actorKey))
  const actionEvidenceFactKeys = known.filter(f => f.origin === 'runtime-consequence'
    && f.sourceEventSequence === pending.sourceEventSequence && message.text.includes(f.text)).map(f => f.factKey)
  if (!actionEvidenceFactKeys.length) return null
  const allowedEvidenceFactKeys = known.map(f => f.factKey)
  const targets = story.situation.facts.filter(f => f.discovery?.sceneKey === scene.sceneKey
    && f.discovery.actorKeys.includes(pending.actorKey) && !f.audienceKeys.includes(pending.actorKey)
    && f.discovery.prerequisiteFactKeys.every(key => allowedEvidenceFactKeys.includes(key))
    && !story.discoveryHistory?.some(h => h.factKey === f.factKey && h.actionSequence === pending.sourceEventSequence))
    .map(f => ({factKey: f.factKey, requiredEvidenceFactKeys: [...f.discovery!.prerequisiteFactKeys]}))
  return {schema: 'storyforge.chat-discovery-evidence', version: 1, actorKey: pending.actorKey,
    actionSequence: pending.sourceEventSequence, allowedEvidenceFactKeys, actionEvidenceFactKeys, targets}
}

export function usesChatDiscoveryEvidenceContextV1(snapshot: AgentRunSnapshotV1): boolean {
  return snapshot.contract.executionBindings?.some(b => b.stepId === 'interaction:runtime-candidate'
    && b.skillId === 'character.chat-situation-construction' && supportsChatDiscoveryEvidenceProducerV1(b.promptVersion)) ?? false
}

export function chatDiscoveryEvidenceGenerationRulesV1(version: string | undefined): string[] {
  if (!supportsChatDiscoveryEvidenceProducerV1(version)) return []
  return [
    'discoveryEvidence 是系统从本次已提交状态计算的引用清单，不是观察结果或发现结论。discoveries 中的 evidenceFactKeys 只能取自 allowedEvidenceFactKeys，必须包含目标的 requiredEvidenceFactKeys，并至少包含一项 actionEvidenceFactKeys；actionSequence/actorKey 使用清单中的当前调查身份，摘录仍须对应真实已完成动作。',
    '本次 newFacts 尚未审查和采纳，不能作为本次 discoveries 的证据；也不能引用待发现事实本身、其它未知材料或只在候选中出现的编号。不要通过复制真相为新事实、改编号或删除必要前提绕过。新观察结果可与发现判定同时作为候选接受审查，但其新编号不是已有证据。',
    'targets 只表示可接受判定的对象，不表示已经发现或满足语义条件。逐项结合原 discovery.condition 与实际动作判定 discovered/not-discovered/inconclusive；不要为了进展强行发现。discoveryEvidence 为 null 或 targets 为空时不输出 discoveries；实际询问仍按 inquiryResult 的独立原合同处理。',
  ]
}

export function chatDiscoveryEvidenceReviewRulesV1(version: string | undefined): string[] {
  if (!supportsChatDiscoveryEvidenceReviewerV1(version)) return []
  return ['discoveryEvidence 只核对已提交证据的结构可用性，不证明发现条件满足。候选 newFacts 及本次其它发现不能反过来证明自身；逐项按原条件与真实动作审查，不把出现在 targets 当作应当 discovered，也不替生成器补造依据、静默删引用或放宽条件。']
}
