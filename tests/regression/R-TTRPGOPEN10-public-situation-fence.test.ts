import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupPublicSituationAdoptionV1 } from '../helpers/open-public-situation-adoption'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER, configureOpenSeatsV1 } from '../helpers/open-ttrpg-session'
import { acceptTtrpgOpenPublicSituationV1, activateTtrpgOpenSessionSituationV1, completeTtrpgOpenSessionZeroV1, startTtrpgOpenEpochV1,
  startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, ttrpgOpenOperationCommandIdV1, shareTtrpgOpenKnowledgeV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { finishTtrpgOpenPublicSituationDraftV1 } from '../../src/lib/ttrpg/open-public-situation-stop'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { readTtrpgOpenTableV1, readTtrpgOpenManualActionCatalogV1 } from '../../src/lib/ttrpg/open-table-service'
import { createTtrpgOpenDiscoveryPlanV1 } from '../../src/lib/ttrpg/open-knowledge-discovery'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { hashTtrpgOpenKnowledgeShareConfirmationV1 } from '../../src/lib/ttrpg/open-knowledge-share'

const HINT = 'ORIGINAL-PARTY-ONLY-HINT', CLUE = 'ORIGINAL-PARTY-ONLY-CLUE'
describe('R-TTRPGOPEN10 original common request recipient fence', { timeout: 180000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('blocks a later seat from direct hints and discovery, caps public discovery, and permits a later explicit attributed share', async () => {
    const s = await setupPublicSituationAdoptionV1('adopt-this-one-candidate', false, pkg => {
      const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content
      c.playerCount.maximum = 4
      const late = structuredClone(c.characterTemplates.find(a => a.characterKey === 'hero')!)
      late.characterKey = 'late'; late.seatKey = 'seat.late'; late.name = '后来者'
      late.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: late, rulePack: rule }); c.characterTemplates.push(late)
      c.entityBindings.push({ ...structuredClone(c.entityBindings.find(b => b.bindingKey === 'hero')!), bindingKey: 'late', templateKey: 'late' })
      rule.actions[0].effects = []; rule.timePolicy.existingAction = 1; rule.timePolicy.actionOverrides = []
    }, value => {
      value.template.interventionPoints.forEach(p => { p.affordanceHint = HINT; p.visibleTo = 'public' })
      value.template.evidence.forEach(e => { e.description = CLUE; e.discoveryPolicy.allowedAudience = 'public'; e.discoveryPolicy.recipientActorKeys = [] })
    })
    const event = await acceptTtrpgOpenPublicSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.fence.accept'), ...s.adoption })
    const template = JSON.parse(event.payloadJson).receipt.template as NonNullable<typeof s.candidate.review>['proposal']['template']
    await finishTtrpgOpenPublicSituationDraftV1({ ...s.read, epochKey: s.auth.epochKey })
    await activateTtrpgOpenSessionSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.fence.admit'), viewerKey: s.read.viewerKey, templateKey: template.templateKey })
    const head = await readProductRuntimeState(s.read.sessionId), child = await branchProductRuntimeSession({ parentSessionId: s.read.sessionId, throughSequence: head.lastSequence, title: 'Later public guest' })
    await configureOpenSeatsV1(child.id!)
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'public.fence.zero'), viewerKey: s.read.viewerKey,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2', 'late'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    const input = { ...s.read, sessionId: child.id! }, lateInput = { ...input, viewerKey: 'viewer.seat.late' }
    const heroTable = await readTtrpgOpenTableV1(input), lateTable = await readTtrpgOpenTableV1(lateInput)
    expect(heroTable.player!.affordances.some(a => a.hint === HINT)).toBe(true)
    expect(JSON.stringify(lateTable)).not.toContain(HINT); expect(JSON.stringify(lateTable)).not.toContain(CLUE)
    expect(JSON.stringify(await readTtrpgOpenManualActionCatalogV1(lateInput))).not.toContain(HINT)
    const current = await readProductRuntimeState(child.id!), instance = current.ttrpg!.openRun!.situations.active.find(i => i.templateKey === template.templateKey)!
    const action = s.kernel.basis.rule.actions[0], request = { situationKey: instance.situationKey, evidenceRef: template.evidence[0].clueRef, interventionPointKey: template.interventionPoints[0].pointKey, effectBindings: {} }
    await expect(createTtrpgOpenDiscoveryPlanV1({ state: current, content: s.f.runtimePackage.ttrpg!, request, actorKey: 'late', route: 'existing-action', ruleKey: action.key })).rejects.toThrow(/扩大|路径/)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!, 'public.fence.action'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '调查可见线索' })
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(child.id!, 'public.fence.operation'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key, targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper', effectBindings: {}, discovery: request } })
    const operation = (await readProductRuntimeState(child.id!)).ttrpg!.openRun!.operations[0]
    for (const required of operation.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({ ...await openEnvelopeV1(child.id!, await ttrpgOpenOperationCommandIdV1(operation.startedRef.sessionKey, operation.operationKey, 'approval.' + required.actorKey)),
      viewerKey: OPEN_HUMAN_VIEWER, actorKey: required.actorKey, riskHash: operation.riskHash, decision: 'approve', operationKey: operation.operationKey, frozenPlanHash: operation.planHash })
    const command = { sessionId: child.id!, viewerKey: OPEN_HUMAN_VIEWER, operationKey: operation.operationKey, frozenPlanHash: operation.planHash }
    for (let i = 0; i < 16; i++) {
      const op = (await readProductRuntimeState(child.id!)).ttrpg!.openRun!.operations[0], next = nextTtrpgOpenOperationStepV1(op)
      if (!next || ['terminal', 'gates', 'narration', 'handoff'].includes(next.kind)) break
      if (next.kind === 'pressure') await resumeTtrpgOpenPressureV1(command)
      else if (next.kind === 'situations') await resumeTtrpgOpenSituationsV1(command)
      else await resumeTtrpgOpenOperationV1(command)
    }
    const settled = await readProductRuntimeState(child.id!), knowledge = settled.ttrpg!.openRun!.knowledge.find(k => k.evidenceRef === request.evidenceRef)!
    expect(knowledge).toMatchObject({ audience: 'party', recipientActorKeys: ['companion.1', 'companion.2', 'hero'], reliability: 'observed' })
    expect((await loadTtrpgOpenPlayerContextV1({ ...lateInput, actorKey: 'late' })).view.knowledge).toEqual([])
    expect((await loadTtrpgOpenPlayerContextV1({ ...input, actorKey: 'hero' })).view.knowledge).toContainEqual(expect.objectContaining({ description: CLUE }))
    const share = { actorKey: 'hero', sourceKnowledgeKey: knowledge.knowledgeKey, audience: 'party' as const, recipientActorKeys: ['hero', 'companion.1', 'companion.2', 'late'], publicFieldsHash: knowledge.publicFieldsHash }
    const envelope = await openEnvelopeV1(child.id!, 'public.fence.explicit.share')
    const confirmationHash = await hashTtrpgOpenKnowledgeShareConfirmationV1({ request: share, viewerKey: OPEN_HUMAN_VIEWER, baseStateHash: envelope.baseStateHash, runtimeSourceHash: s.f.session.runtimeSourceHash })
    await shareTtrpgOpenKnowledgeV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER, request: share, confirmationHash })
    const revealed = await loadTtrpgOpenPlayerContextV1({ ...lateInput, actorKey: 'late' })
    expect(revealed.view.knowledge).toContainEqual(expect.objectContaining({ description: CLUE, reliability: 'hearsay' }))
    expect((await readTtrpgOpenTableV1(lateInput)).player!.affordances.some(a => a.hint === HINT)).toBe(false)
    expect(s.sends()).toBe(1)
  })
})
