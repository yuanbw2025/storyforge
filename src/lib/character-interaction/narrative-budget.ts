import {getAgentSkillV1} from '../agent/skill-registry'
import type {CharacterInteractionRuntimeState} from '../types'
import {chatActionModelCallAllowanceV1, supportsChatActionChoiceV1} from './action-choice-contract'
import {requestChatNarrativeTriggerV1} from './narrative-actions'
import {chatHasPendingTurnSettlementV1, chatSituationConstructionRequestV1} from './narrative-progression'

/** A background may add a goal or change the scheduled actor. Reserve the
 * maximum next-action allowance before starting it; adoption still charges
 * only the actual frozen recipe. This is not an estimate of provider charges. */
export function chatSituationAndActionAllowanceV1(compare = false): 4 | 5 {
  const skillId = compare ? 'character.chat-narrative-options' : 'character.chat-narrative-action'
  return supportsChatActionChoiceV1(skillId, getAgentSkillV1(skillId).promptVersion) ? 5 : 4
}

/** Shared by execution and controls. A final background settlement has no
 * additional role action. Until an actor is selected, two is only a lower
 * bound; the command always checks the resolved actor before writing. */
export function chatPreparedTurnAllowanceV1(state: CharacterInteractionRuntimeState, actorKey?: string | null, compare = false): 2 | 3 | 4 | 5 {
  if (chatHasPendingTurnSettlementV1(state)) return 2
  if (chatSituationConstructionRequestV1(state, actorKey ?? undefined)) return chatSituationAndActionAllowanceV1(compare)
  if (!actorKey) return 2
  const skillId = compare ? 'character.chat-narrative-options' : 'character.chat-narrative-action'
  return chatActionModelCallAllowanceV1({state, actorKey, skillId, promptVersion: getAgentSkillV1(skillId).promptVersion})
}

/** Preview the same deterministic trigger reducer as the real command. It
 * neither writes an event nor authorizes a call; this avoids treating a prior
 * waiting/closed trigger as the next explicit player's ready trigger. */
export function chatNewTurnAllowanceV1(state: CharacterInteractionRuntimeState,
  trigger: Parameters<typeof requestChatNarrativeTriggerV1>[1], actorKey: string, compare = false): 2 | 3 | 4 | 5 {
  return chatPreparedTurnAllowanceV1(requestChatNarrativeTriggerV1(state, trigger), actorKey, compare)
}
