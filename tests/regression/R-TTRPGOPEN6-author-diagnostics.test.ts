import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { listTtrpgOpenAuthorPlaytestsV1, readTtrpgOpenAuthorDiagnosticsV1, exportTtrpgOpenAuthorDiagnosticsV1, draftTtrpgOpenAuthorRevisionV1 } from '../../src/lib/ttrpg/open-author-diagnostics'
import { setupGateHintFixtureV1 } from '../helpers/open-ttrpg-gate-recovery'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, configureOpenSeatsV1 } from '../helpers/open-ttrpg-session'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { recoverTtrpgOpenOperationGatesV1, changeTtrpgSafetyStatus, completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1 } from '../../src/lib/ttrpg/runtime-commands'
import { chooseTtrpgOpenGateRecoveryV1 } from '../../src/lib/ttrpg/open-gate-recovery'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { forkAndStart, approve, operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'

const locator = (f: Awaited<ReturnType<typeof readyOpenTtrpgSessionV1>>) => ({ scope: f.scope,productionId: f.productionId,sessionId: f.sessionId })
describe('R-TTRPGOPEN6 actual author playtest diagnostics and explicit revision handoff', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it('projects real blockers and stopped recovery without inputs, private observations, profiles or state mutation', async () => {
    const f = await setupGateHintFixtureV1({ unavailable: true });await resumeTtrpgOpenChecksV1(f.command)
    const state = await readProductRuntimeState(f.command.sessionId), selected = chooseTtrpgOpenGateRecoveryV1(state,f.command.operationKey)!
    await recoverTtrpgOpenOperationGatesV1({ ...await operationInput(f.command.sessionId,f.command.operationKey,'gates.recovery'),evaluationRef: selected.evaluation.sourceRef,evaluationBasisHash: selected.evaluation.result.evaluationBasisHash!,gateKey: selected.gateKey,actorKey: selected.evaluation.actorKey })
    await resumeTtrpgOpenChecksV1(f.command)
    const before = await readProductRuntimeState(f.command.sessionId), eventCount = await db.productRuntimeEvents.count(), build = await db.productBuilds.get(f.f.buildId)
    const input = locator(f.f), sessions = await listTtrpgOpenAuthorPlaytestsV1(input)
    expect(sessions.map(s => s.sessionId)).toEqual([f.command.sessionId])
    const result = await readTtrpgOpenAuthorDiagnosticsV1(input)
    expect(result.report.latestEvaluations[0].gates.find(g => g.key === 'hypothesis-formable')).toMatchObject({ passed: false,consecutiveFailures: 1 })
    expect(result.report.recoveries).toMatchObject([{ result: 'unavailable',stoppedRef: expect.any(Object) }])
    expect(result.report.pendingOperations).toMatchObject([{ operationKey: f.command.operationKey,nextStep: { kind: 'gates' } }])
    const exported = await exportTtrpgOpenAuthorDiagnosticsV1({ ...input,expectedReceipt: result.receipt })
    expect(JSON.parse(exported.content)).toEqual(result.report)
    expect(exported.content).not.toMatch(/evaluationBasisJson|rawInput|publicFieldsJson|RECOVERY-PRIVATE-OBSERVATION|open.foundation.seed|initialStateJson|providerConfig|apiKey/)
    const draft = await draftTtrpgOpenAuthorRevisionV1({ ...input,expectedReceipt: result.receipt })
    expect(draft).toContain('线索能够形成假设未通过');expect(draft).toContain(result.report.source.packageHash)
    expect(draft.length).toBeLessThanOrEqual(10000)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before)
    expect(await db.productRuntimeEvents.count()).toBe(eventCount);expect(await db.productBuilds.get(f.f.buildId)).toEqual(build)
  })
  it('rejects another Work, a different production, non-TTRPG product and a damaged immutable build', async () => {
    const f = await readyOpenTtrpgSessionV1(), other = await readyOpenTtrpgSessionV1('other owner')
    const input = locator(f)
    expect(await listTtrpgOpenAuthorPlaytestsV1(input)).toHaveLength(1)
    await expect(readTtrpgOpenAuthorDiagnosticsV1({ ...input,sessionId: other.sessionId })).rejects.toThrow(/Work|World/)
    await expect(readTtrpgOpenAuthorDiagnosticsV1({ ...input,productionId: other.productionId })).rejects.toThrow()
    await db.productProductions.update(f.productionId,{ productType: 'text-adventure' })
    await expect(readTtrpgOpenAuthorDiagnosticsV1(input)).rejects.toThrow(/产品入口/)
    await db.productProductions.update(f.productionId,{ productType: 'ttrpg' })
    await db.productBuilds.update(f.buildId,{ packageHash: 'f'.repeat(64) })
    await expect(readTtrpgOpenAuthorDiagnosticsV1(input)).rejects.toThrow(/hash|来源/)
  })
  it('refuses export and revision when the displayed report is stale after a real safety event', async () => {
    const f = await readyOpenTtrpgSessionV1(), input = locator(f), report = await readTtrpgOpenAuthorDiagnosticsV1(input)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.sessionId,'pause'),status: 'paused',reason: '暂停',changedBy: 'hero',viewerKey: 'viewer.seat.hero' })
    for (const action of [exportTtrpgOpenAuthorDiagnosticsV1,draftTtrpgOpenAuthorRevisionV1]) await expect(action({ ...input,expectedReceipt: report.receipt })).rejects.toThrow(/过期/)
    expect((await readTtrpgOpenAuthorDiagnosticsV1(input)).report.safetyStatus).toBe('paused')
  })
  it('reports no invented gate success before the first actual check', async () => {
    const f = await readyOpenTtrpgSessionV1(), input = locator(f), result = await readTtrpgOpenAuthorDiagnosticsV1(input)
    expect(result.report.latestEvaluations).toEqual([])
    expect(await draftTtrpgOpenAuthorRevisionV1({ ...input,expectedReceipt: result.receipt })).toContain('不得据此声称真实玩家或长局验收完成')
  })
  it('keeps qualified ancestor evidence and selects the child latest check by append order', async () => {
    const f = await setupGateHintFixtureV1();await resumeTtrpgOpenChecksV1(f.command)
    const parent = await readTtrpgOpenAuthorDiagnosticsV1(locator(f.f))
    const child = await forkAndStart(f.command.sessionId);await approve(child.sessionId,child.op.operationKey)
    const command = { ...f.command,sessionId: child.sessionId,operationKey: child.op.operationKey,frozenPlanHash: child.op.planHash }
    await resumeTtrpgOpenChecksV1(command)
    const result = await readTtrpgOpenAuthorDiagnosticsV1({ ...locator(f.f),sessionId: child.sessionId })
    expect(result.report.evaluations.some(e => e.inherited && e.sourceRef.sessionKey === parent.report.sessionKey)).toBe(true)
    expect(result.report.latestEvaluations.every(e => !e.inherited && e.sourceRef.sessionKey === result.report.sessionKey)).toBe(true)
    expect(result.report.evaluations.length).toBeGreaterThan(parent.report.evaluations.length)
  })
  it('allows actual locally released build lineage and denies the same release when marked as an installed copy', async () => {
    const f = await readyOpenTtrpgSessionV1(), production = (await db.productProductions.get(f.productionId))!
    const manifestJson = JSON.stringify({ schema: 'storyforge.test-build-manifest',version: 1,productionKey: production.productionKey,buildNumber: 2 })
    const manifestHash = await hashProductProductionValueV2(JSON.parse(manifestJson)), rootTerminalReceiptHash = 'c'.repeat(64)
    const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage: f.runtimePackage,productionKey: production.productionKey,
      productionProvenance: { productionKey: production.productionKey,buildNumber: 2,buildManifestHash: manifestHash,rootTerminalReceiptHash } },{ ttrpgProtocol: 2 })
    const releaseId = await db.productReleases.add({ ...f.scope,productionKey: production.productionKey,productType: 'ttrpg',worldReleaseId: null,version: 1,label: 'local author release',manifestJson: JSON.stringify(manifest),contentHash: await hashProductProductionValueV2(manifest),createdAt: Date.now() }) as number
    // The release fixture normalizes its WorldReference: freeze that exact package as a separate author build.
    const { id: _oldId,...originalBuild } = (await db.productBuilds.get(f.buildId))!
    const preview = await createProductBuildPreviewManifestV1({ productionKey: production.productionKey,buildNumber: 2,buildManifestHash: manifestHash,runtimePackage: manifest.runtimePackage },{ ttrpgProtocol: 2 })
    const releasedBuildId = await db.productBuilds.add({ ...originalBuild,buildNumber: 2,status: 'released',rootTerminalReceiptHash,manifestJson,manifestHash,previewManifestJson: JSON.stringify(preview),previewHash: preview.previewHash,packageHash: preview.packageHash,releasedProductReleaseId: releaseId }) as number
    const session = await createProductRuntimeInstanceFromSource({ scope: f.scope,source: { kind: 'release',productReleaseId: releaseId },title: 'release playtest',seed: 'local.release' })
    expect((await listTtrpgOpenAuthorPlaytestsV1(locator(f))).map(s => s.sessionId)).toContain(session.id)
    await configureOpenSeatsV1(session.id!)
    const initial = await readProductRuntimeState(session.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(session.id!,'release.zero'),acceptedItemKeys: initial.ttrpg!.product.sessionZero.requiredItemKeys,selectedCharacterKeys: ['hero','companion.1','companion.2'],viewerKey: 'viewer.seat.hero' })
    await startTtrpgOpenRunV1({ ...await openEnvelopeV1(session.id!,'release.start'),viewerKey: 'viewer.seat.hero' })
    expect((await readTtrpgOpenAuthorDiagnosticsV1({ ...locator(f),sessionId: session.id! })).report.source).toMatchObject({ sourceKind: 'release',buildNumber: 2,packageHash: preview.packageHash })
    await db.productBuilds.update(releasedBuildId,{ rootTerminalReceiptHash: 'd'.repeat(64) })
    expect((await listTtrpgOpenAuthorPlaytestsV1(locator(f))).map(s => s.sessionId)).not.toContain(session.id)
    await db.productBuilds.update(releasedBuildId,{ rootTerminalReceiptHash })
    // Even a claimed GM seat or matching productionKey does not confer original-author access.
    await db.productReleases.update(releaseId,{ distributionProvenance: { source: 'local-file',candidatePackageHash: 'a'.repeat(64),originalReleaseHash: 'b'.repeat(64),candidateStatus: 'eligible-for-community-submission',remoteCreatorIdentityVerified: false,localCopyPreserved: true,importedAt: Date.now() } })
    expect((await listTtrpgOpenAuthorPlaytestsV1(locator(f))).map(s => s.sessionId)).not.toContain(session.id)
    await expect(readTtrpgOpenAuthorDiagnosticsV1({ ...locator(f),sessionId: session.id! })).rejects.toThrow(/导入副本/)
  })
})
