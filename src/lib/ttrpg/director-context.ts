import { ttrpgCampaignNavigationV1 } from './campaign-navigation'
import { hashCanonicalValue } from '../agent/run/hash'
import type { AssembleContextInput } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import type { ProductRuntimeState, TtrpgCampaignContentV1, TtrpgSessionParticipantRecordV2, WorkspaceScope } from '../types'
import { loadTtrpgGmRuntimeViewV1 } from './gm-context'
import { loadTtrpgRuntimeContentV1 } from './runtime-content'
import { readProductRuntimeState } from './runtime-api'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { parseTtrpgDirectorPlanV1 } from './director-model'

export function ttrpgDirectorOptionsV1(state: ProductRuntimeState, campaign: TtrpgCampaignContentV1) {
  const product = state.ttrpg?.product, scene = campaign.scenes.find(item => item.sceneKey === state.ttrpg?.scene?.sceneKey)
  const action = product?.actionHistory[product.actionHistory.length - 1]
  if (!product?.sessionZero.completed || product.safety.status !== 'active' || product.ending || !scene || !action?.receipt
    || action.receipt.context.sceneKey !== scene.sceneKey) throw new Error('[ttrpg-director] 当前没有可主持的已结算行动')
  const isPlayer = campaign.characterTemplates.some(actor => actor.characterKey === action.actorKey && actor.role === 'player')
  const failed = action.outcome === 'failure' || action.outcome === 'critical-failure'
  const eligibleReveals = !isPlayer ? [] : campaign.clues.flatMap(clue => {
    if (clue.visibility === 'gm-only' || product.discoveredClues.some(item => item.clueKey === clue.clueKey)) return []
    const path = clue.discoveryPaths.find(path => path.sceneKey === scene.sceneKey && path.actionKey === action.actionKey)
    if (!path || !scene.clueKeys.includes(clue.clueKey) || (failed && !path.failForward.trim())) return []
    return [{ clueKey: clue.clueKey, title: clue.title, description: clue.description, pathKey: path.pathKey,
      actorKey: action.actorKey, visibility: 'party' as const, failForward: failed,
      consequence: failed ? path.failForward : '行动已满足冻结线索发现路径' }]
  })
  const navigation = ttrpgCampaignNavigationV1(state, campaign)
  return { sceneKey: scene.sceneKey, basisActionSequence: action.eventSequence, actorKey: action.actorKey,
    eligibleReveals, nextScenes: navigation.nextScenes, eligibleEndings: navigation.endings }
}
export function assertTtrpgDirectorAuthorityV1(participants: TtrpgSessionParticipantRecordV2[]) {
  const gm = participants.find(seat => seat.role === 'gm')
  if (!gm || !['ai', 'hybrid'].includes(gm.controller) || !gm.consent.aiIdentityDisclosed || !gm.consent.safetyBoundariesAccepted)
    throw new Error('[ttrpg-director] 尚未授权 AI KP 主持')
  return gm
}
export async function captureTtrpgDirectorViewV1(input: { scope: WorkspaceScope; productRuntimeSessionId: number }) {
  const [{ campaign }, state, participants, gmView] = await Promise.all([
    loadTtrpgRuntimeContentV1(input), readProductRuntimeState(input.productRuntimeSessionId),
    readTtrpgSessionParticipantsV2(input.productRuntimeSessionId), loadTtrpgGmRuntimeViewV1(input),
  ])
  const gm = assertTtrpgDirectorAuthorityV1(participants)
  const options = ttrpgDirectorOptionsV1(state, campaign)
  if (state.ttrpg?.product?.directorDecisions?.some(item => item.basisActionSequence === options.basisActionSequence))
    throw new Error('[ttrpg-director] 本次行动已经主持')
  const view = { schema: 'storyforge.ttrpg-director-view', version: 1, gmView, options,
    priorDecisions: state.ttrpg!.product!.directorDecisions ?? [] }
  return { view, worldGroupId: gmView.session.worldGroupId, releaseHash: gmView.session.releaseHash,
    visibilityHash: await hashCanonicalValue({ view, gm }), requiresHumanConfirmation: gm.controller !== 'ai' }
}
export function parseTtrpgDirectorOutputV1(output: string, view: Awaited<ReturnType<typeof captureTtrpgDirectorViewV1>>['view']) {
  const plan = parseTtrpgDirectorPlanV1(JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')))
  if (plan.revealClueKeys.some(key => !view.options.eligibleReveals.some(item => item.clueKey === key))
    || plan.recommendedSceneKeys.some(key => !view.options.nextScenes.some(item => item.sceneKey === key))
    || plan.recommendedEndingKeys.some(key => !view.options.eligibleEndings.some(item => item.endingKey === key)))
    throw new Error('[ttrpg-director] 决策超出冻结规则、线索或场景权限')
  if (plan.pacing === 'conclude' && !plan.recommendedEndingKeys.length) throw new Error('[ttrpg-director] 尚未满足结局条件')
  if (plan.pacing === 'move' && !plan.recommendedSceneKeys.length) throw new Error('[ttrpg-director] 缺少可选后继场景')
  return plan
}
export async function readTtrpgDirectorContextV1(input: AssembleContextInput): Promise<string> {
  if (input.productRuntimeSessionId == null) return ''
  const scope = input.scope ?? await resolveScope({ projectId: input.projectId })
  const boundary = await captureTtrpgDirectorViewV1({ scope, productRuntimeSessionId: input.productRuntimeSessionId })
  if (input.worldGroupId !== undefined && boundary.worldGroupId !== (input.worldGroupId ?? null)) return ''
  const { gmView, options, priorDecisions, schema, version } = boundary.view
  const action = gmView.latestAction
  return JSON.stringify({ schema, version, options, priorDecisions, gmView: {
    session: gmView.session, safety: gmView.safety, scene: gmView.scene, participants: gmView.participants,
    discoveredClues: gmView.discoveredClues, campaignProgress: gmView.campaignProgress, memory: gmView.memory,
    latestAction: action ? { eventSequence: action.eventSequence, actorKey: action.actorKey, actionKey: action.actionKey,
      outcome: action.outcome, intent: action.receipt?.context.declaredIntent, resourceChanges: action.resourceChanges, conditionChanges: action.conditionChanges } : null,
  } })
}
