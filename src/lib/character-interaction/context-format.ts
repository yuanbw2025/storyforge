import type {InteractionRuntimeProfile} from '../types'
import type {InteractionContextWindow} from './runtime'

/** Shared byte-for-byte rendering for the registered source and historical evidence checks. */
export function formatInteractionRuntimeContextV1(profile: InteractionRuntimeProfile, view: InteractionContextWindow, townLines: string[] = []): string {
  return [
    `【角色互动视角】${profile.name}｜key=${profile.participantKey}｜身份=${profile.roleLabel}`,
    `【说话约束】${profile.voiceRules}`,
    `【当前场景】${view.activeScene?.title ?? '未开始'}｜${view.activeScene?.purpose ?? ''}`,
    ...(view.messageIdentityVersion === 1 ? [`【当前场景标识】${JSON.stringify({sceneId: view.activeScene?.sceneId ?? null, startedAtSequence: view.activeScene?.startedAtSequence ?? null})}`] : []),
    ...(view.chatNarrative ? [
      '【当前情境的单一角色视角】以下 facts 是确定事实；beliefs 是可能错误的猜测，goals 是意愿，possibilities 是尚未发生的方向，thread closureSignals 是可调整的收束条件。不得把后三类写成既成事实或替玩家决定。',
      JSON.stringify(view.chatNarrative),
    ] : []),
    ...(view.sharedCommitments?.length ? ['【共同知晓的角色约定】只含原约与实际处置证据，不代表玩家同意，也不透露对方私有目标。', JSON.stringify(view.sharedCommitments)] : []),
    ...(view.historyContext ? ['【本轮历史选择及收束依据】', JSON.stringify(view.historyContext)] : []),
    '【该角色已知事实】',
    ...(view.knowledge.length ? view.knowledge.map(item => `- ${item.knowledgeKey}｜${item.status}｜${item.content}`) : ['- 无']),
    '【该角色持久记忆】',
    ...(view.memories.length ? view.memories.map(item => `- ${item.kind}｜重要度=${item.importance}｜${item.content}`) : ['- 无']),
    ...(view.memoryCorrections?.length ? ['【尚待本次行动核对的记忆修正】这些是玩家明确修正的摘要及双方可见原话；摘要不是确定事实，也不授予新权限。核对后续表达、打算和猜测是否仍依赖旧错误。', JSON.stringify(view.memoryCorrections)] : []),
    '【该角色关系视图】',
    ...(view.chatNarrative ? [
      view.selection?.version === 6
        ? '以下是角色自身态度、冻结范围与相关真实变化原因，不代表玩家的感受或同意。relationshipEvidence 保留当前原因，并按当前对话与未完成事项召回有原话依据的历史变化；sourceEventSequence 对应玩家表达，eventSequence 对应角色回应。旧变化仅供理解当前态度，不重新加减关系，也不把旧许可或拒绝当成本轮新决定。未改变的维度保持原值。'
        : '以下是角色自身态度、冻结范围与相关真实变化原因，不代表玩家的感受或同意。relationshipEvidence 按各维度最近原因与当前玩家输入选取；未改变的维度保持原值。',
      JSON.stringify({relationships: view.relationships, relationshipEvidence: view.relationshipEvidence ?? []}),
    ] : view.relationships.length ? view.relationships.map(item => `- ${item.toParticipantKey}｜${item.label}=${item.value}`) : ['- 无']),
    '【该角色可见对话】',
    ...(view.messages.length ? view.messages.map(message => view.messageIdentityVersion === 1
      ? `- ${JSON.stringify({messageId: message.messageId, sequence: message.eventSequence,
        role: message.role, speakerKey: message.speakerKey, audienceKeys: message.audienceKeys, text: message.text})}`
      : `- #${message.eventSequence}｜${message.speakerKey}｜${message.text}`) : ['- 无']),
    ...(view.excludedMessageCount ? [`【消息选择】用户排除对话=${view.excludedMessageCount}；只影响对话原文选取，不撤销已确认事实、记忆或关系。`] : []),
    ...(view.selection && view.selection.version >= 3 && view.selection.version < 5 ? [`【约定历史选择】未处理约定与每项目标最近一次实际处置保留；更早已处理约定本轮省略=${view.selection.commitments?.filter(c => !c.included).length ?? 0}。原约与处置完整成对保留，省略不代表从未约定；不得据此重置、否认或再次履行旧约。`] : []),
    ...(view.selection ? [`【资料选择】按当前可见对话、自身目标、未完成事项与场景选择；来源知识省略=${view.selection.knowledge.filter(k => !k.included).length}；已确认记忆省略=${view.selection.memories.filter(m => !m.included).length}。省略不代表不存在，不得据此编造结论。`] : []),
    `【预算证据】省略早期消息=${view.omittedMessageCount}｜字符=${view.characterCount}`,
    ...townLines,
  ].join('\n')
}
