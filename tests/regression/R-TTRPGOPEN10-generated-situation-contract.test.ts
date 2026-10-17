import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedGeneratedSituationProposalV1, generatedSituationProposalFixtureV1 } from '../helpers/open-generated-situation-proposal'
import { preflightTtrpgOpenGeneratedSituationV1, loadTtrpgOpenSituationProposalBasisV1 } from '../../src/lib/ttrpg/open-generated-situation-basis'
import { parseTtrpgOpenGeneratedSituationProposalV1 } from '../../src/lib/ttrpg/open-generated-situation-contract'
import { validateOpenContentReferences } from '../../src/lib/ttrpg/open-content-references'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { changeTtrpgSituationV1, completeTtrpgOpenSessionZeroV1, retireTtrpgOpenSessionFactV1, recordTtrpgOpenHumanNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1, readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { hashProductProductionValueV2 as hash } from '../../src/lib/product-production/hash'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'

describe('R-TTRPGOPEN10 strict session situation proposal preflight only', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('preflights a source-bound proposal with an actual player identity and confirmed fact without granting or writing anything', async () => {
    const { f, input, loaded, value } = await seedGeneratedSituationProposalV1()
    const before = { state: await readProductRuntimeState(input.sessionId), world: await db.worldReleases.toArray(), releases: await db.productReleases.toArray(), runs: await db.agentRuns.count(), events: await db.productRuntimeEvents.count() }
    const result = await preflightTtrpgOpenGeneratedSituationV1({ ...input, value })
    expect(result.evaluation.accepted).toBe(true); expect(result.grantsAcceptance).toBe(false); expect(result.outputIsCandidate).toBe(true)
    expect(result.proposal.template.templateKey).toBe(loaded.basis.assignedTemplateKey)
    expect(result.proposalHash).toBe(await hash(result.proposal)); expect(result.basisHash).toBe(await hash(loaded.basis))
    expect(result.personalizationEvidence[0].kind).toBe('identity'); expect(result.personalizationEvidence[0].actorKeys).toEqual(['hero'])
    expect(result.runtimeSourceHash).toBe(f.session.runtimeSourceHash)
    expect(await readProductRuntimeState(input.sessionId)).toEqual(before.state); expect(await db.worldReleases.toArray()).toEqual(before.world)
    expect(await db.productReleases.toArray()).toEqual(before.releases); expect(await db.agentRuns.count()).toBe(before.runs); expect(await db.productRuntimeEvents.count()).toBe(before.events)
    db.close(); await db.open()
    expect((await loadTtrpgOpenSituationProposalBasisV1(input)).basis).toEqual(loaded.basis)
  })
  it('keeps frozen campaign validation closed to session references while checking them explicitly in the session-only preflight', async () => {
    const { input, loaded, value } = await seedGeneratedSituationProposalV1(), basis = loaded.basis
    const result = await preflightTtrpgOpenGeneratedSituationV1({ ...input, value })
    expect(() => validateOpenContentReferences({ ...basis.campaign, situationTemplates: [...basis.campaign.situationTemplates, result.proposal.template] }, basis.rule)).toThrow()
    const bad = structuredClone(value); bad.template.whyNowRefs[0] = 'session:fact.unconfirmed'
    await expect(preflightTtrpgOpenGeneratedSituationV1({ ...input, value: bad })).rejects.toThrow()
    const privateFact = basis.sessionFacts.find(f => f.audience === 'gm-only')!
    bad.template.whyNowRefs[0] = value.template.whyNowRefs[0]; bad.template.evidence[0].sourceFactRefs = [privateFact.factKey]
    await expect(preflightTtrpgOpenGeneratedSituationV1({ ...input, value: bad })).rejects.toThrow(/密级|private/)
  })
  it('rejects generator-owned identities, proof/approval aliases, unknown fields, unbound personalization and arbitrary rule references', async () => {
    const { input, loaded, value } = await seedGeneratedSituationProposalV1()
    for (const bad of [ { ...value, accepted: true }, { ...value, personalizationRefs: [] }, { ...value, version: 2 },
      { ...value, template: { ...value.template, templateKey: loaded.basis.assignedTemplateKey } }, { ...value, personalizationSourceKeys: ['fact.harbor'] } ]) {
      await expect(preflightTtrpgOpenGeneratedSituationV1({ ...input, value: bad })).rejects.toThrow()
    }
    const bad = structuredClone(value); bad.template.evidence[0].clueRef = 'another.session.evidence'
    expect(() => parseTtrpgOpenGeneratedSituationProposalV1(bad, loaded.basis.assignedTemplateKey)).toThrow(/命名空间/)
    bad.template.evidence[0].clueRef = value.template.evidence[0].clueRef; bad.template.noInterventionOutcome.effectPlanRef = 'plan.model-invented'
    await expect(preflightTtrpgOpenGeneratedSituationV1({ ...input, value: bad })).rejects.toThrow()
    bad.template.noInterventionOutcome.effectPlanRef = value.template.noInterventionOutcome.effectPlanRef
    bad.template.driverBinding = { kind: 'player-commitment', factRef: loaded.basis.personalizationSources[0].sourceKey }
    await expect(preflightTtrpgOpenGeneratedSituationV1({ ...input, value: bad })).rejects.toThrow(/真实已确认承诺/)
  })
  it('checks the real DAG and reference scope, never allowing a player to become a model-controlled NPC driver', async () => {
    const { input, value } = await seedGeneratedSituationProposalV1(), bad = structuredClone(value)
    bad.template.obstacles[0].dependsOn = [bad.template.obstacles[1].obstacleKey]
    await expect(preflightTtrpgOpenGeneratedSituationV1({ ...input, value: bad })).rejects.toThrow(/环/)
    bad.template.obstacles = value.template.obstacles; bad.template.driverBinding = { kind: 'npc', characterKey: 'hero' }
    await expect(preflightTtrpgOpenGeneratedSituationV1({ ...input, value: bad })).rejects.toThrow(/NPC|npc/)
    bad.template.driverBinding = value.template.driverBinding; bad.template.obstacles[0].predicate = { op: 'resource-at-least', actorKey: 'actor.unknown', resourceKey: 'hp', value: 1 }
    await expect(preflightTtrpgOpenGeneratedSituationV1({ ...input, value: bad })).rejects.toThrow()
  })
  it('requires the actual human GM rather than a player/fallback host or a foreign project', async () => {
    const { f, input } = await seedGeneratedSituationProposalV1()
    await expect(loadTtrpgOpenSituationProposalBasisV1({ ...input, viewerKey: f.other.viewerKey })).rejects.toThrow(/真人 GM/)
    await expect(loadTtrpgOpenSituationProposalBasisV1({ ...input, viewerKey: 'viewer.not-seated' })).rejects.toThrow()
    const other = await readyOpenTtrpgSessionV1('isolated P9 project')
    await expect(loadTtrpgOpenSituationProposalBasisV1({ ...input, scope: other.scope })).rejects.toThrow()
    await expect(loadTtrpgOpenSituationProposalBasisV1({ ...input, scope: other.scope, sessionId: other.sessionId, viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/真人 GM/)
  })
  it('detects actual source progress after reading instead of treating a preflight result as an acceptance receipt', async () => {
    const { input, loaded } = await seedGeneratedSituationProposalV1(), fact = loaded.basis.sessionFacts[0]
    await retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(input.sessionId, 'P9.source.changed'), viewerKey: input.viewerKey, factKey: fact.factKey, reason: '原来源已被明确撤回' })
    await expect(loaded.assertCurrent()).rejects.toThrow(/变化/)
    const next = await loadTtrpgOpenSituationProposalBasisV1(input)
    expect(next.basis.sessionFacts.some(f => f.factKey === fact.factKey)).toBe(false)
    expect(await hash(next.basis)).not.toBe(await hash(loaded.basis))
  })
  it('includes a prior player choice only after its real approval and completed action, preserving the exact original receipt', async () => {
    const f = await setupChecksFixtureV1({ humanGm: true }); await resumeTtrpgOpenPlayV1(f.command)
    const input = { scope: f.f.scope, sessionId: f.command.sessionId, viewerKey: 'viewer.gm', proposalKey: 'prior.player.choice' }
    expect((await loadTtrpgOpenSituationProposalBasisV1(input)).basis.personalizationSources.some(s => s.kind === 'choice')).toBe(false)
    await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(input.sessionId, f.command.operationKey, 'narration'), viewerKey: input.viewerKey, text: '真人主持确认本次调查已经完成。', reason: 'host-authored' })
    expect((await resumeTtrpgOpenPlayV1(f.command)).status).toBe('completed')
    const state = await readProductRuntimeState(input.sessionId), operation = state.ttrpg!.openRun!.operations[0], approval = operation.approvals.find(a => a.actorKey === 'hero' && a.decision === 'approve')!
    const source = (await loadTtrpgOpenSituationProposalBasisV1(input)).basis.personalizationSources.find(s => s.kind === 'choice')!
    expect(source.actorKeys).toEqual(['hero']); expect(source.sourceRef).toEqual(approval.sourceRef)
    expect(source.contentHash).toBe(await hash({ sourceRef: approval.sourceRef, actorKey: 'hero', planHash: operation.planHash, riskHash: operation.riskHash, decision: approval.decision }))
  })
  it('compares real activation history across parent deletion with session-qualified original coordinates', async () => {
    const { input, loaded } = await seedGeneratedSituationProposalV1(), originalKey = loaded.basis.campaign.openingSituationKeys[0]
    await changeTtrpgSituationV1({ ...await openEnvelopeV1(input.sessionId, 'P9.opening'), viewerKey: input.viewerKey, templateKey: originalKey, activationReason: 'opening', mode: 'auto' })
    const parent = await readProductRuntimeState(input.sessionId), current = await loadTtrpgOpenSituationProposalBasisV1(input)
    const result = await preflightTtrpgOpenGeneratedSituationV1({ ...input, value: generatedSituationProposalFixtureV1(current.basis) })
    expect(result.evaluation.rejections.some(r => r.code === 'A1' && r.comparison?.comparedTemplateKey === originalKey)).toBe(true)
    const child = await branchProductRuntimeSession({ parentSessionId: input.sessionId, throughSequence: parent.lastSequence, title: 'P9 history child', seed: 'P9.history.child' })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'P9.child.zero'), viewerKey: input.viewerKey, acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await deleteProductRuntimeSession(input.sessionId)
    const inherited = await loadTtrpgOpenSituationProposalBasisV1({ ...input, sessionId: child.id! })
    expect(inherited.basis.history[0].sourceRef.sessionKey).toBe(parent.ttrpg!.sessionKey)
    expect(inherited.basis.history[0].sourceRef.sequence).toBe(current.basis.history[0].sourceRef.sequence)
    expect(inherited.basis.history[0].sourceRef.sessionKey).not.toBe(inherited.basis.sessionKey)
  })
})
