/** Isolated actual F13, observation and human narration. No real provider or author-production acceptance. */
import { setupOpenEntityPlanningV1 } from './open-entity-runtime'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from './open-ttrpg-session'
import { approve, operationInput, rt } from './open-ttrpg-branch-recovery'
import { readTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1, confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { changeTtrpgSituationV1, startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, recordTtrpgOpenHumanNarrationV1, consultTtrpgOracleV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

export async function identityKnowledgeWindowV1(sessionId: number, viewerKey: string, rawInput = '核对本人观察或明确转述') {
  const run = rt(await readProductRuntimeState(sessionId)).openRun!, active = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  if (active) await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, crypto.randomUUID()), viewerKey: active.viewerKey, epochKey: active.epochKey, reason: '显式结束本次窗口' })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, crypto.randomUUID()), viewerKey, triggerKind: viewerKey === 'viewer.gm' ? 'continue-host' : 'submit-action', rawInput })
}
export async function setupIdentityKnowledgeRuntimeV1(lateCreation = false, modelReadEnabled = false, discoveryAudience: 'private' | 'party' = 'private') {
  const s = await setupOpenEntityPlanningV1(pkg => {
    const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content
    c.gmMode = 'human'; c.dynamicEntityTemplates[0].audience = 'gm-only'
    if (modelReadEnabled) { c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000 }
    c.characterTemplates.find(row => row.characterKey === 'companion.2')!.controller = 'hybrid'
    rule.actions[0].effects = []; rule.timePolicy.existingAction = 1; rule.timePolicy.actionOverrides = []
    for (const template of c.situationTemplates) {
      template.consequences = []; template.obstacles = template.obstacles.map(row => ({ ...row, predicate: { op: 'world-turn-at-least', value: 20 } }))
      template.noInterventionOutcome.afterWorldTurns = 20
      for (const evidence of template.evidence) { evidence.discoveryPolicy.allowedAudience = discoveryAudience; evidence.discoveryPolicy.recipientActorKeys = discoveryAudience === 'private' ? ['hero'] : ['hero', 'companion.1', 'companion.2']; evidence.discoveryPolicy.requiresPlayerConfirmation = true }
    }
  }, 'viewer.gm')
  const owner = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
  async function create(oracleSourceRef = s.input.oracleSourceRef) {
    await proposeTtrpgOpenEntityDeskV1({ ...owner, submissionKey: 'knowledge.original.npc', oracleSourceRef, proposals: [s.proposals[0]] })
    const pending = (await readTtrpgOpenEntityDeskV1(owner))!.pending!
    for (const a of pending.approvals) await confirmTtrpgOpenEntityDeskV1({ ...owner, operationKey: pending.operationKey, planHash: pending.planHash, actorKey: a.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
    await materializeTtrpgOpenEntityDeskV1({ ...owner, operationKey: pending.operationKey, planHash: pending.planHash, decision: 'create-this-confirmed-plan' })
  }
  if (!lateCreation) await create()
  const f = s.f, template = f.campaign.situationTemplates[0], action = f.runtimePackage.ttrpg!.rulePack.content.actions[0]
  await identityKnowledgeWindowV1(f.sessionId, OPEN_HUMAN_VIEWER)
  await changeTtrpgSituationV1({ ...await openEnvelopeV1(f.sessionId, 'knowledge.opening'), templateKey: template.templateKey, activationReason: 'opening', mode: 'activated' })
  const started = rt(await readProductRuntimeState(f.sessionId))
  await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.sessionId, 'knowledge.observe'), viewerKey: OPEN_HUMAN_VIEWER,
    request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key,
      targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper', effectBindings: {},
      discovery: { situationKey: started.openRun!.situations.active[0].situationKey, evidenceRef: template.evidence[0].clueRef,
        interventionPointKey: template.interventionPoints[0].pointKey, effectBindings: {} } } })
  const operation = rt(await readProductRuntimeState(f.sessionId)).openRun!.operations[0]
  if (discoveryAudience === 'private') await approve(f.sessionId, operation.operationKey)
  else for (const approval of operation.plan.requiredApprovals) {
    const seat = rt(await readProductRuntimeState(f.sessionId)).authorization!.seats.find(row => row.actorKey === approval.actorKey)
    const viewerKey = seat && seat.controller !== 'ai' && seat.assignmentState === 'claimed' ? seat.viewerKey : OPEN_HUMAN_VIEWER
    await confirmTtrpgOpenOperationV1({ ...await operationInput(f.sessionId, operation.operationKey, `approval.${approval.actorKey}`), viewerKey,
      actorKey: approval.actorKey, riskHash: operation.riskHash, decision: 'approve' })
  }
  const command = { sessionId: f.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
  if ((await resumeTtrpgOpenPlayV1(command)).status !== 'awaiting-narration') throw new Error('Expected actual narration boundary')
  await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.sessionId, operation.operationKey, 'narration'), viewerKey: 'viewer.gm', text: '你实际观察了门口的线索。', reason: 'host-authored' })
  if ((await resumeTtrpgOpenPlayV1(command)).status !== 'completed') throw new Error('Expected completed actual discovery operation')
  await identityKnowledgeWindowV1(f.sessionId, 'viewer.gm')
  if (lateCreation) {
    const event = await consultTtrpgOracleV1({ ...await openEnvelopeV1(f.sessionId, 'late.oracle'), viewerKey: 'viewer.gm', askedBy: 'gm',
      oracleKey: f.runtimePackage.ttrpg!.rulePack.content.oracles[0].oracleKey, question: '在新时点引入新的实例' })
    await create({ sessionKey: rt(await readProductRuntimeState(f.sessionId)).sessionKey, sequence: event.sequence })
  }
  const runtime = rt(await readProductRuntimeState(f.sessionId)), root = runtime.openRun!.knowledge[0], entityRef = runtime.openRun!.entityOperations![0].plan.items[0].entityKey
  const request = { mode: 'observation' as const, actorKey: null, sourceKnowledgeKey: root.knowledgeKey, entityRefs: [entityRef], audience: 'private' as const, recipientActorKeys: ['hero'] }
  return { f, owner, root, entityRef, request }
}
