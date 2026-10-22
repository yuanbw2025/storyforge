/** Closed formal-purpose map; callers cannot supply arbitrary Skill, source permission or POV. */
import type { WorkspaceScope } from '../types'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { assertTtrpgOpenModelFactApproverV1 } from './open-fact-ledger'

import { ttrpgOpenModelPurposeForSkillV1 } from './open-model-purpose-contract'
export { TTRPG_OPEN_MODEL_PURPOSES_V1, ttrpgOpenModelPurposeForSkillV1, type TtrpgOpenModelPurposeV1 } from './open-model-purpose-contract'
export function assertTtrpgOpenModelActorV1(authorization: TtrpgOpenAuthorizationV1, skillId: string, actorKey: string,viewerKey: string): void {
  const definition = ttrpgOpenModelPurposeForSkillV1(skillId)
  const requester = authorization.seats.find(seat => seat.viewerKey === viewerKey)
  if (!requester || requester.controller === 'ai' || requester.assignmentState !== 'claimed') throw new Error('[ttrpg-open-call] 模型请求需要本人已认领真人席位')
  if (definition.actorRole === 'player') {
    if (definition.purpose === 'companion' && !authorization.seats.some(s => s.actorKey === actorKey && ['ai', 'hybrid'].includes(s.controller) && s.consent.aiAdviceAllowed)) throw new Error('[ttrpg-companion] 只能为当前允许 AI 建议的 AI/hybrid 队友请求候选')
    if (!authorization.selectedActorKeys.includes(actorKey)) throw new Error('[ttrpg-open-call] 模型角色不在活动玩家中')
    const actor = authorization.seats.find(seat => seat.actorKey === actorKey)
    if (requester.actorKey !== actorKey && (!actor || actor.controller === 'human' || !actor.consent.aiAdviceAllowed
      || !authorization.approvalBindings.some(binding => binding.companionActorKey === actorKey && binding.approverSeatKeys.includes(requester.seatKey)))) throw new Error('[ttrpg-open-call] 不可读取或请求其他真人角色的私域候选')
  } else {
    assertTtrpgOpenModelFactApproverV1(authorization,viewerKey)
    if (definition.purpose === 'common-oracle-interpret') assertTtrpgOpenHumanHostV1(authorization, viewerKey)
    if (definition.purpose === 'entity-proposal') assertTtrpgOpenHumanHostV1(authorization, viewerKey)
    if (definition.purpose === 'stage-brief' || definition.purpose === 'situation-proposal' || definition.purpose === 'public-situation-proposal') {
      assertTtrpgOpenHumanHostV1(authorization, viewerKey)
      if (authorization.seats.some(seat => !seat.consent.sessionLoggingAllowed)) throw new Error('[ttrpg-brief] 复盘需要当前全桌记录同意')
    }
    const gm = authorization.seats.find(seat => seat.role === 'gm')
    if (actorKey !== 'gm' || !gm?.consent.aiAdviceAllowed || !gm.consent.aiIdentityDisclosed) throw new Error('[ttrpg-open-call] GM 解释未获桌面授权')
  }
}
export async function loadTtrpgOpenModelContextV1(input: { scope: WorkspaceScope; sessionId: number; actorKey: string; skillId: string }) {
  const purpose = ttrpgOpenModelPurposeForSkillV1(input.skillId)
  if (purpose.purpose === 'common-oracle-interpret') return (await import('./open-common-oracle-context')).loadTtrpgOpenCommonOracleContextV1(input)
  if (purpose.purpose === 'entity-proposal') return (await import('./open-entity-context')).loadTtrpgOpenEntityContextV1(input)
  if (purpose.purpose === 'public-situation-proposal') return (await import('./open-public-situation-context')).loadTtrpgOpenPublicSituationContextV1(input)
  if (purpose.purpose === 'situation-proposal') return (await import('./open-generated-situation-context')).loadTtrpgOpenSituationContextV1(input)
  if (purpose.purpose === 'stage-brief') return (await import('./open-brief-context')).loadTtrpgOpenBriefContextV1(input)
  if (purpose.purpose === 'kp-narration') return (await import('./open-kp-context')).loadTtrpgOpenKpContextV1(input)
  return purpose.actorRole === 'gm'
    ? (await import('./open-gm-oracle-context')).loadTtrpgOpenGmOracleContextV1(input) : (await import('./open-player-context')).loadTtrpgOpenPlayerContextV1(input)
}
