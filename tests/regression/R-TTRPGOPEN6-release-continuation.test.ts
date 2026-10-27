import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
/** Frozen release contracts exercise real DB/APIs; no normal production or provider claim. */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupClosedStageOpeningV1 } from '../helpers/open-ttrpg-stage-opening'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { seedOpenFixtureReleaseV1 } from '../helpers/open-ttrpg-release'
import { configureOpenSeatsV1, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { readProductRuntimeState, hashProductRuntimeStateV1, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { previewTtrpgOpenContinuationV1, createTtrpgOpenContinuationFromPlanV1 } from '../../src/lib/ttrpg/continuity'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { verifyTtrpgOpenReleaseContinuationRuntimeV1 } from '../../src/lib/ttrpg/open-release-continuation-proof'
import { readTtrpgOpenTableV1 } from '../../src/lib/ttrpg/open-table-service'
import { seedTtrpgWorldPatchReviewV1 } from '../helpers/open-ttrpg-world-patch'
import { verifyProductRuntimeSessionSourceV1, verifyProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { isTtrpgRuntimeContentV2 } from '../../src/lib/ttrpg/content-version'
import { continueTtrpgOpenFactLedger, createTtrpgOpenFactBasisV1, verifyTtrpgOpenFactLedger, parseTtrpgOpenFactLedgerV1,
  parseTtrpgOpenFactLedger, ttrpgOpenSessionFactsV1, projectTtrpgOpenSessionFactsForActorV1 } from '../../src/lib/ttrpg/open-fact-ledger'

describe('R-TTRPGOPEN6 compatible immutable release continuation', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  async function versions() {
    const f = await setupClosedStageOpeningV1(true)
    const pkg = structuredClone(f.f.f.runtimePackage)
    pkg.ttrpg!.campaign.stageClosurePolicy.triggers[0].summaryPrompt = '新发布明确保留阶段后续。'
    const target = await seedOpenFixtureReleaseV1(f.f.f.scope, pkg, f.f.f.published!)
    return { ...f, target, pkg }
  }
  it('creates one reviewed child, preserves original business and seed, then requires fresh seats and a new opening', async () => {
    const f = await versions(), parentId = f.f.command.sessionId, before = await readProductRuntimeState(parentId)
    const originalRow = (await db.productRuntimeSessions.get(parentId))!
    const preview = await previewTtrpgOpenContinuationV1({ scope: f.f.f.scope, parentSessionId: parentId, targetProductReleaseId: f.target.id,
      transitionKey: 'release.continue.1', approvedBy: f.input.viewerKey, reason: '确认保留原团局并承接新的阶段安排', openingTemplateKeys: f.input.templateKeys })
    const command = { scope: f.f.f.scope, preview, title: '新发布续团' }
    const [child, duplicate] = await Promise.all([createTtrpgOpenContinuationFromPlanV1(command), createTtrpgOpenContinuationFromPlanV1(command)])
    expect(duplicate.id).toBe(child.id)
    expect(child.productReleaseId).toBe(f.target.id); expect(child.seed).toBe(originalRow.seed)
    expect(child.parentSessionId).toBe(parentId); expect(await readProductRuntimeState(parentId)).toEqual(before)
    let state = await readProductRuntimeState(child.id!), runtime = rt(state)
    expect(runtime.authorization).toBeNull(); expect(runtime.product.sessionZero.completed).toBe(false)
    expect(runtime.openRun!.worldTime.worldTurn).toBe(rt(before).openRun!.worldTime.worldTurn)
    expect(state.entities).toEqual(before.entities)
    await verifyTtrpgOpenReleaseContinuationRuntimeV1({ runtime, runtimeSourceHash: child.runtimeSourceHash, seed: child.seed, initialState: parseProductRuntimeState(child.initialStateJson) })
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!, 'premature'), viewerKey: f.input.viewerKey, triggerKind: 'continue-host', rawInput: '不得提前运行' })).rejects.toThrow()
    await configureOpenSeatsV1(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'continued.zero'), viewerKey: f.input.viewerKey,
      acceptedItemKeys: runtime.product.sessionZero.requiredItemKeys, selectedCharacterKeys: preview.plan.selectedActorKeys })
    state = await readProductRuntimeState(child.id!); runtime = rt(state)
    expect(runtime.openRun!.releaseContinuation!.confirmedRef?.sessionKey).toBe(runtime.sessionKey)
    expect(runtime.openRun!.stage.status).toBe('open'); expect(state.entities).toEqual(before.entities)
    expect(runtime.openRun!.clocks).toEqual(rt(before).openRun!.clocks)
    expect(runtime.openRun!.knowledge).toEqual(rt(before).openRun!.knowledge)
    expect(runtime.campaign.roster).toEqual(rt(before).campaign.roster)
    const view = await readTtrpgOpenTableV1({ scope: f.f.f.scope, sessionId: child.id!, viewerKey: f.input.viewerKey })
    expect(view.started).toBe(true); expect(view.player?.stageStatus).toBe('open')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(child.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(child.id!).sortBy('sequence'))).toEqual(state)
    const branch = await branchProductRuntimeSession({ parentSessionId: child.id!, throughSequence: state.lastSequence, title: '续团后的独立分支' })
    await configureOpenSeatsV1(branch.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(branch.id!, 'branch.zero'), viewerKey: f.input.viewerKey,
      acceptedItemKeys: runtime.product.sessionZero.requiredItemKeys, selectedCharacterKeys: preview.plan.selectedActorKeys })
    const branchState = await readProductRuntimeState(branch.id!)
    expect(rt(branchState).openRun!.releaseContinuation).toEqual(runtime.openRun!.releaseContinuation)
    const backup = await exportProjectJSON(f.f.f.scope.projectId)
    const imported = await importProjectJSON(backup)
    const importedChild = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => JSON.parse(s.initialStateJson).ttrpg?.sessionKey === runtime.sessionKey)!
    expect(rt(await readProductRuntimeState(importedChild.id!)).openRun).toEqual(runtime.openRun)
    const changedState = structuredClone(backup)
    const changedChild = changedState.productRuntimeSessions.find(e => JSON.parse(e.initialStateJson).ttrpg?.sessionKey === runtime.sessionKey)!
    const forged = JSON.parse(changedChild.initialStateJson), forgedReceipt = forged.ttrpg.openRun.releaseContinuation
    forged.ttrpg.openRun.worldTime.worldTurn += 1
    delete forged.ttrpg.openRun.releaseContinuation
    forgedReceipt.plan.migratedStateHash = await hashProductProductionValueV2(forged)
    const { planHash: oldHash, ...forgedBody } = forgedReceipt.plan
    void oldHash
    forgedReceipt.plan.planHash = await hashProductProductionValueV2(forgedBody)
    forged.ttrpg.openRun.releaseContinuation = forgedReceipt; changedChild.initialStateJson = JSON.stringify(forged)
    await expect(importProjectJSON(changedState)).rejects.toThrow(/续团不得改写原资源/)
    const altered = structuredClone(backup), row = altered.productRuntimeEvents.find(e =>
      e.type === 'ttrpg.session-zero.completed' && JSON.parse(e._portablePayloadJson ?? e.payloadJson).continuationOpening)
    const payload = JSON.parse(row._portablePayloadJson ?? row.payloadJson); payload.continuationOpening.gateBasisHash = 'c'.repeat(64)
    if (typeof row._portablePayloadJson === 'string') row._portablePayloadJson = JSON.stringify(payload)
    else row.payloadJson = JSON.stringify(payload)
    const count = await db.projects.count()
    await expect(importProjectJSON(altered)).rejects.toThrow(/续团开局预览与原真实前态不一致/)
    expect(await db.projects.count()).toBe(count)
    await deleteProductRuntimeSession(parentId)
    expect(rt(await readProductRuntimeState(child.id!)).openRun).toEqual(runtime.openRun)
    const afterDelete = await importProjectJSON(await exportProjectJSON(f.f.f.scope.projectId))
    expect((await db.productRuntimeSessions.where('projectId').equals(afterDelete).toArray()).some(s => JSON.parse(s.initialStateJson).ttrpg?.sessionKey === runtime.sessionKey)).toBe(true)

  })

  it('retains the interrupted narration suffix instead of rewriting the original operation as complete', async () => {
    const f = await setupChecksFixtureV1({ released: true, ai: true })
    await resumeTtrpgOpenChecksV1(f.command)
    const before = await readProductRuntimeState(f.command.sessionId), original = rt(before).openRun!.operations[0]
    expect(original.status).toBe('executing')
    const pkg = structuredClone(f.f.runtimePackage); pkg.ttrpg!.campaign.stageClosurePolicy.triggers[0].summaryPrompt = '续团阶段'
    const target = await seedOpenFixtureReleaseV1(f.f.scope, pkg, f.f.published!)
    const current = await readProductRuntimeState(f.command.sessionId)
    const preview = await previewTtrpgOpenContinuationV1({ scope: f.f.scope, parentSessionId: f.command.sessionId, targetProductReleaseId: target.id,
      transitionKey: 'interrupt.continue', approvedBy: f.command.viewerKey, reason: '明确中断剩余叙述并保留原行动记录', openingTemplateKeys: [rt(current).openRun!.situations.active[0].templateKey] })
    const child = await createTtrpgOpenContinuationFromPlanV1({ scope: f.f.scope, preview, title: '中断续团' })
    const state = rt(await readProductRuntimeState(child.id!))
    expect(state.branchLineage!.recoveryTasks[0]).toMatchObject({ status: 'withdrawn', remainingStepKeys: ['narration', 'handoff'] })
    expect(state.branchLineage!.recoveryTasks[0].operation).toEqual(original)
    expect((await readProductRuntimeState(f.command.sessionId)).ttrpg).toEqual(current.ttrpg)
    expect(preview.plan.interrupted).toHaveLength(1)
  })

  it('rejects cap increases, changed seats and stale cutpoints without creating a child', async () => {
    const f = await versions(), parentId = f.f.command.sessionId
    const input = { scope: f.f.f.scope, parentSessionId: parentId, targetProductReleaseId: f.target.id, transitionKey: 'stale.continue',
      approvedBy: f.input.viewerKey, reason: '原切点核对', openingTemplateKeys: f.input.templateKeys }
    await expect(previewTtrpgOpenContinuationV1({ ...input, approvedBy: 'visitor' })).rejects.toThrow()
    const preview = await previewTtrpgOpenContinuationV1(input), count = await db.productRuntimeSessions.count()
    preview.parentStateHash = await hashProductRuntimeStateV1({ ...f.input.state, lastSequence: f.input.state.lastSequence - 1 })
    await expect(createTtrpgOpenContinuationFromPlanV1({ scope: f.f.f.scope, preview, title: '过时续团' })).rejects.toThrow(/变化/)
    expect(await db.productRuntimeSessions.count()).toBe(count)
    f.pkg.ttrpg!.campaign.stageClosurePolicy.maximumWorldTurns += 1
    const incompatible = await seedOpenFixtureReleaseV1(f.f.f.scope, f.pkg, f.target)
    await expect(previewTtrpgOpenContinuationV1({ ...input, targetProductReleaseId: incompatible.id })).rejects.toThrow(/兼容|上限/)
  })

  it('retains original fact confirmations, retirement and private audiences under an explicit new source basis', async () => {
    const f = await seedTtrpgWorldPatchReviewV1(), session = f.session
    const state = await readProductRuntimeState(session.id!), runtime = rt(state), original = structuredClone(runtime.openRun!.factLedger!)
    const from = await verifyProductRuntimeSessionSourceV1({ scope: f.scope, session, ttrpgProtocol: 2 })
    const pkg = structuredClone(from.runtimePackage)
    if (!pkg.ttrpg || !isTtrpgRuntimeContentV2(pkg.ttrpg)) throw Error('requires frozen open fixture')
    pkg.ttrpg.campaign.stageClosurePolicy.triggers[0].summaryPrompt += ' 新版阶段说明。'
    const target = await seedOpenFixtureReleaseV1(f.scope, pkg)
    const source = await verifyProductRuntimeSource({ scope: f.scope, source: { kind: 'release', productReleaseId: target.id }, ttrpgProtocol: 2 })
    const content = source.runtimePackage.ttrpg!
    if (!isTtrpgRuntimeContentV2(content)) throw Error('requires protocol 2')
    const continued = continueTtrpgOpenFactLedger(original, await createTtrpgOpenFactBasisV1(content, source.runtimeSourceHash))
    expect(continued.version).toBe(2)
    expect(continued.entries.map(e => e.candidateHash)).toEqual(original.entries.map(e => e.candidateHash))
    expect(continued.entries.map(e => e.confirmationStateHash)).toEqual(original.entries.map(e => e.confirmationStateHash))
    expect(continued.retirements).toEqual(original.retirements)
    expect(ttrpgOpenSessionFactsV1(continued)).toEqual(ttrpgOpenSessionFactsV1(original))
    expect(projectTtrpgOpenSessionFactsForActorV1(continued, 'hero')).toEqual(projectTtrpgOpenSessionFactsForActorV1(original, 'hero'))
    await verifyTtrpgOpenFactLedger({ ledger: continued, content, runtimeSourceHash: source.runtimeSourceHash,
      oracleReceipts: runtime.openRun!.oracleReceipts!, storyFacts: runtime.product.effectLedger.storyFacts })
    expect(() => parseTtrpgOpenFactLedgerV1(continued)).toThrow()
    continued.entries[0].originBasisHash = continued.basis.basisHash
    expect(() => parseTtrpgOpenFactLedger(continued)).toThrow()
    expect(runtime.openRun!.factLedger).toEqual(original)
    const preview = await previewTtrpgOpenContinuationV1({ scope: f.scope, parentSessionId: session.id!, targetProductReleaseId: target.id,
      transitionKey: 'facts.continue', approvedBy: f.host.viewerKey, reason: '带着原事实与记忆续团', openingTemplateKeys: content.campaign.openingSituationKeys })
    const child = await createTtrpgOpenContinuationFromPlanV1({ scope: f.scope, preview, title: '事实与记忆续团' })
    await configureOpenSeatsV1(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'facts.zero'), viewerKey: f.host.viewerKey,
      acceptedItemKeys: runtime.product.sessionZero.requiredItemKeys, selectedCharacterKeys: preview.plan.selectedActorKeys })
    const childRuntime = rt(await readProductRuntimeState(child.id!))
    expect(childRuntime.openRun!.factLedger!.version).toBe(2)
    expect(childRuntime.openRun!.memoryReceipts).toEqual(runtime.openRun!.memoryReceipts)
    await readTtrpgOpenTableV1({ scope: f.scope, sessionId: child.id!, viewerKey: f.other.viewerKey })
    const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const importedChild = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(row => JSON.parse(row.initialStateJson).ttrpg?.sessionKey === childRuntime.sessionKey)!
    expect(rt(await readProductRuntimeState(importedChild.id!)).openRun!.factLedger).toEqual(childRuntime.openRun!.factLedger)

  })
})
