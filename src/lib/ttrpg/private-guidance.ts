import { hashCanonicalValue } from '../agent/run/hash'
import type { AssembleContextInput } from '../registry/types'
import type { WorkspaceScope } from '../types'
import { resolveScope } from '../workspace/scope'
import { createTtrpgViewerProjectionV1 } from './viewer-projection'
import { loadTtrpgRuntimeContentV1 } from './runtime-content'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { readProductRuntimeState, commitTtrpgPrivateGuidanceFromHarnessV1 } from './runtime-api'
import { generateTtrpgDecisionV1, adoptTtrpgDecisionV1, type TtrpgDecisionInputV1, type TtrpgDecisionProtocolV1 } from './decision-harness'

import { parseTtrpgPrivateGuidanceV1, type TtrpgPrivateGuidanceV1 } from './private-guidance-model'
import { projectTtrpgObservedActionsV1 } from './prompt-context'
export async function captureTtrpgPrivateGuidanceViewV1(input: { scope: WorkspaceScope; productRuntimeSessionId: number; actorKey?: string }) {
  const [{ session, campaign, rulePack }, state, seats] = await Promise.all([loadTtrpgRuntimeContentV1(input),
    readProductRuntimeState(input.productRuntimeSessionId), readTtrpgSessionParticipantsV2(input.productRuntimeSessionId)])
  const seat = seats.find(seat => seat.role === 'player' && seat.actorKey === input.actorKey)
  const product = state.ttrpg?.product
  if (!seat || !['human', 'hybrid'].includes(seat.controller) || !seat.consent.aiAdviceAllowed || !product?.sessionZero.completed
    || product.safety.status !== 'active' || product.ending) throw new Error('[ttrpg-private] 本角色未授权私密指引或会话已暂停')
  const projection = createTtrpgViewerProjectionV1({ state, campaign, rulePack, role: 'player', actorKey: seat.actorKey,
    participantControllers: Object.fromEntries(seats.flatMap(seat => seat.actorKey ? [[seat.actorKey, seat.controller]] : [])) })
  const self = projection.actors.find(actor => actor.actorKey === seat.actorKey)
  if (!self) throw new Error('[ttrpg-private] 本角色不在当前场景')
  const view = { schema: 'storyforge.ttrpg-private-guidance-view', version: 1,
    actorKey: seat.actorKey!, self: { name: self.name, profile: self.privateProfile, attributes: self.attributes, resources: self.resources },
    scene: projection.scenes.filter(scene => scene.status === 'current').map(scene => ({ title: scene.title, description: scene.description })),
    visibleClues: projection.visibleClues, availableActions: projection.availableActions, ruleReference: projection.ruleReference,
    observations: projectTtrpgObservedActionsV1(projection.recentActions), publicNarrations: projection.recentNarrations.map(item => ({ text: item.text })),
    priorGuidance: product.privateGuidance?.filter(item => item.actorKey === seat.actorKey) ?? [],
  }
  return { view, worldGroupId: session.worldGroupId ?? null, releaseHash: session.runtimeSourceHash!,
    visibilityHash: await hashCanonicalValue({ view, seat }), requiresHumanConfirmation: false }
}
export function parseTtrpgPrivateGuidanceOutputV1(output: string, view: Awaited<ReturnType<typeof captureTtrpgPrivateGuidanceViewV1>>['view']) {
  const advice = parseTtrpgPrivateGuidanceV1(JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')))
  if (advice.actorKey !== view.actorKey || (advice.suggestedActionKey != null && !view.availableActions.some(action => action.actionKey === advice.suggestedActionKey)))
    throw new Error('[ttrpg-private] 指引越过角色或可用行动边界')
  return advice
}
export async function readTtrpgPrivateGuidanceContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.ttrpgPlayerActorKey || input.productRuntimeSessionId == null) return ''
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  const boundary = await captureTtrpgPrivateGuidanceViewV1({ scope, productRuntimeSessionId: input.productRuntimeSessionId, actorKey: input.ttrpgPlayerActorKey })
  if (input.worldGroupId !== undefined && boundary.worldGroupId !== (input.worldGroupId ?? null)) return ''
  return JSON.stringify(boundary.view)
}
const protocol: TtrpgDecisionProtocolV1<TtrpgPrivateGuidanceV1, Awaited<ReturnType<typeof captureTtrpgPrivateGuidanceViewV1>>['view']> = {
  kind: 'private-guidance', skillId: 'prose.ttrpg-private-guidance', sourceKey: 'ttrpgPrivateGuidance',
  systemPrompt: '你是跑团角色的私密顾问，只能使用这个角色已知的事实和私人目标。回应玩家的问题，用简洁中文提供两个可选思路，提醒信息不足之处；不推断为真、不透露其他人的秘密、不替玩家行动、不改变骰点或资源、不承诺尚未获得的线索。只输出严格 JSON：{"actorKey":"逐字复制角色 key","advice":"只给本角色看的指引","suggestedActionKey":null}。suggestedActionKey 只能来自 availableActions，无合适行动时为 null。',
  capture: captureTtrpgPrivateGuidanceViewV1, parse: parseTtrpgPrivateGuidanceOutputV1,
  commit: ({ scope, candidate }) => commitTtrpgPrivateGuidanceFromHarnessV1({ scope, runId: candidate.runId, candidateHash: candidate.candidateHash }),
}
export const generateTtrpgPrivateGuidanceV1 = (input: TtrpgDecisionInputV1) => generateTtrpgDecisionV1(protocol, input)
export const adoptTtrpgPrivateGuidanceV1 = (input: Parameters<typeof adoptTtrpgDecisionV1>[1]) => adoptTtrpgDecisionV1(protocol, input)
