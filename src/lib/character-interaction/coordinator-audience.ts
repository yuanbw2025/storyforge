import {chatTurnAudienceGuidanceV2} from './narrative-audience'
import type {CharacterInteractionRuntimeState} from '../types'

type Contract = {executionBindings?: ReadonlyArray<{stepId: string; skillId: string; promptVersion: string}>}

/** Frozen execution bindings, never current defaults or candidate prose, select
 * the coordinator interpretation. Historical contracts retain their bytes. */
export function chatCoordinatorAudienceVersionV1(contract: Contract): 1 | 2 {
  const pairs = [
    ['interaction:action-review', 'character.chat-narrative-action-review', 'chat-narrative-action-review-v42'],
    ['interaction:action-review', 'character.chat-narrative-options-review', 'chat-narrative-options-review-v30'],
    ['interaction:runtime-candidate', 'character.chat-situation-construction', 'chat-situation-construction-v20'],
    ['interaction:runtime-candidate', 'character.chat-situation-construction', 'chat-situation-construction-v21'],
    ['interaction:action-review', 'character.chat-narrative-action-review', 'chat-narrative-action-review-v41'],
    ['interaction:runtime-candidate', 'character.chat-situation-construction', 'chat-situation-construction-v17'],
    ['interaction:runtime-candidate', 'character.chat-situation-construction', 'chat-situation-construction-v18'],
    ['interaction:runtime-candidate', 'character.chat-situation-construction', 'chat-situation-construction-v19'],
    ['interaction:action-review', 'character.chat-narrative-action-review', 'chat-narrative-action-review-v38'],
    // V40's historical binding used v1; do not alter saved run reconstruction.
    ['interaction:action-review', 'character.chat-narrative-action-review', 'chat-narrative-action-review-v39'],
    ['interaction:action-review', 'character.chat-narrative-options-review', 'chat-narrative-options-review-v28'],
    ['interaction:action-review', 'character.chat-narrative-options-review', 'chat-narrative-options-review-v29'],
  ]
  return pairs.some(([step, skill, version]) => contract.executionBindings?.some(b =>
    b.stepId === step && b.skillId === skill && b.promptVersion === version)) ? 2 : 1
}

/** The roster is a knowledge ledger for principal roles, not a complete list
 * of people in the scene. This adds no participant or knowledge mutation. */
export function chatCoordinatorScenePersonGuidanceV1(state: CharacterInteractionRuntimeState) {
  const direction = state.chatNarrative?.triggers.slice(-1)[0]?.direction
  if (direction?.conversationMode !== 'present') return {}
  return {...chatTurnAudienceGuidanceV2(direction), scenePersonCommunication: {
    version: 1,
    instruction: '对已证实在场且可接触的场景人物，实际问话或告知可以是合法表达；主角色名单没有此人本身不是越权依据。audienceKeys 和 disclosures.toParticipantKeys 只登记主角色及玩家的知情变化，不能要求为场景人物编造身份或填入非法键。已有事实的 audienceKeys 表示当前登记知情者，不单凭缺少场景人物就推定禁止谈及；须核对信息来源、原保密约束、私聊、拒绝、角色真实所知和交谈依据。角色可以准确报告自己已知且可公开的调查结果；不能借此泄露原私有背景、未获知秘密或把猜测说成真相。向场景人物说出一句话只登记实际表达，不自动证明对方听懂、相信、接受或获得整个角色知识库。后续答复仍须 inquiryResult、原问题及接触事实和独立审查，陈述内容不自动成为真相。主角色或玩家新获知既有事实仍必须有完整 disclosures；本规则不豁免任何主角色知情更新、私聊隔离或候选预览保护。',
  }}
}
