import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { prepareNativeAvgAssembly, startNativeAvgAssembly, confirmNativeAvgInputs } from '../helpers/avg-production-assembly-fixture'
import { runAvgAssemblyV1, prepareAvgAssemblyBriefV1, restartAvgAssemblyFromDraftV1, stageAvgWorkspaceInputV1, readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import { readProductProductionDetailsV1, startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { runProductProductionUntilBlockedV1, runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets'

describe('AVG-05A real author assembly production', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(()=>db.close())

  it('prepares an explicit zero-provider Brief, waits for author inputs and freezes a real V2 Preview/root receipt', async () => {
    const prepared = await prepareNativeAvgAssembly()
    expect(prepared.details.production.status).toBe('brief-ready')
    expect(prepared.details.build).toBeNull()
    expect(await db.agentRuns.count()).toBe(0)
    const s = await startNativeAvgAssembly(prepared)
    expect(s.details.build).toMatchObject({status:'building',planRevision:1,previewHash:''})
    expect(JSON.parse(s.details.build!.planJson).tasks).toHaveLength(7)
    expect(JSON.parse(s.details.build!.budgetLedgerJson).tasks).toEqual({})
    await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    expect(await db.agentRuns.count()).toBe(1)
    await confirmNativeAvgInputs(s)
    const projected = await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const details = await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
    expect(projected.buildStatus,details.build!.failureJson).toBe('preview-ready')
    expect(details.build!.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    const preview = await verifyStoredProductBuildPreview(details.build!)
    expect(preview).toMatchObject({version:2,runtimePackage:{version:2,productType:'avg'}})
    expect(preview!.runtimePackage.narrative.beats[0].text).toBe('封口仍在。')
    expect(JSON.parse(details.build!.qualityReportJson)).toMatchObject({playable:true,releaseReady:false})
    const ledger = JSON.parse(details.build!.budgetLedgerJson)
    expect(Object.values(ledger.tasks)).toHaveLength(7)
    expect(Object.values(ledger.tasks).every((entry:any)=>entry.status==='settled'&&entry.usage.modelCalls===0&&entry.usage.mediaCalls===0)).toBe(true)
    const started = await startProductProductionPreviewV1({scope:s.scope,productionId:s.productionId,
      expectedBuildId:s.buildId,expectedPreviewHash:preview!.previewHash})
    expect(started.productType).toBe('avg')
    expect(await db.productRuntimeSessions.get(started.sessionId)).toBeDefined()
  })

  it('creates a fresh child Build Brief for text revisions and keeps the frozen parent bytes', async () => {
    const s = await startNativeAvgAssembly(await prepareNativeAvgAssembly())
    await confirmNativeAvgInputs(s)
    await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const before = (await db.productBuilds.get(s.buildId))!
    expect(before.previewHash).not.toBe('')
    const draft = await readAvgDraftV1(s.scope), workspace = avgAuthorWorkspaceFixture()
    workspace.basePreviewHash = before.previewHash
    workspace.scripts[0].lines[0].text = '请先看一眼封口。'
    const saved = await saveAvgAuthorWorkspaceV1(s.scope,draft.revision,workspace)
    const next = await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:saved.revision})
    expect(next.production.status).toBe('brief-ready')
    expect(next.brief!.revision).toBeGreaterThan(before.briefRevision)
    expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(before.previewManifestJson)
    const child = await startNativeAvgAssembly({...s,details:next})
    expect(child.buildId).not.toBe(s.buildId)
    expect(child.details.build!.parentBuildNumber).toBe(before.buildNumber)
    await confirmNativeAvgInputs(child)
    expect((await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).buildStatus).toBe('preview-ready')
    const after = (await db.productBuilds.get(child.buildId))!
    const preview = await verifyStoredProductBuildPreview(after)
    expect(preview!.runtimePackage.narrative.beats[0].text).toBe('请先看一眼封口。')
    expect(after.packageHash).not.toBe(before.packageHash)
    expect(JSON.parse(after.compatibilityJson)).toMatchObject({level:'breaking',migrationPolicy:'pin-old-save',fromPackageHash:before.packageHash})
    expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(before.previewManifestJson)
  })

  it('restores actual native root/child receipts and Preview session after backup remapping', async () => {
    const s = await startNativeAvgAssembly(await prepareNativeAvgAssembly())
    await confirmNativeAvgInputs(s)
    await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const before = (await db.productBuilds.get(s.buildId))!
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = {projectId,worldId:build.worldId,workId:build.workId}
    expect(build.previewManifestJson).toBe(before.previewManifestJson)
    expect(build.id).not.toBe(before.id)
    const details = await readProductProductionDetailsV1(scope,build.productionId,['avg'])
    expect(details.build!.previewHash).toBe(before.previewHash)
    const session = await startProductProductionPreviewV1({scope,productionId:build.productionId,
      expectedBuildId:build.id,expectedPreviewHash:build.previewHash})
    expect((await db.productRuntimeSessions.get(session.sessionId))!.workId).toBe(scope.workId)
    expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(before.previewManifestJson)
  })

  it('rejects paid/native hybrid Briefs and alternative DAG/output owners', async () => {
    const s = await startNativeAvgAssembly(await prepareNativeAvgAssembly())
    const brief = parseProductProductionBriefV3(s.details.brief!.briefJson)
    expect(()=>parseProductProductionBriefV3({...brief,productionBudget:{...brief.productionBudget,maximumModelCalls:1}})).toThrow(/零 Provider/)
    expect(()=>parseProductProductionBriefV3({...brief,qualityProfile:'commercial-candidate'})).toThrow(/质量边界/)
    const plan = JSON.parse(s.details.build!.planJson)
    plan.tasks[0].outputArtifactKeys=['avg.content.story-bible']
    plan.tasks[1].inputArtifactKeys=['avg.content.story-bible']
    expect(()=>parseProductProductionPlanV3(plan,brief,s.details.brief!.briefHash)).toThrow()
  })

  it('preserves a failed attempt and author input bytes while explicitly restarting a new zero-provider Build',async()=>{
    const s=await startNativeAvgAssembly(await prepareNativeAvgAssembly())
    await confirmNativeAvgInputs(s)
    // Deliberately injected deterministic failure verifies the actual durable
    // failure/restart protocol; it is not provider or media-quality evidence.
    const failed=await runProductProductionUntilBlockedV1({scope:s.scope,productionId:s.productionId,executor:async()=>{throw new Error('原创校准故障：执行器中断')}})
    expect(failed.buildStatus).toBe('recovery-required')
    const before=(await db.productBuilds.get(s.buildId))!,rows=await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()
    const draft=await readAvgDraftV1(s.scope)
    const prepared=await restartAvgAssemblyFromDraftV1({scope:s.scope,productionId:s.productionId,expectedBuildId:s.buildId,expectedDraftRevision:draft.revision})
    const stopped=(await db.productBuilds.get(s.buildId))!
    expect(stopped.status).toBe('cancelled')
    expect(JSON.parse(stopped.failureJson).priorFailureJson).toBe(before.failureJson)
    expect((await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()).map(row=>row.payloadJson)).toEqual(rows.map(row=>row.payloadJson))
    const child=await startNativeAvgAssembly({...s,details:prepared})
    expect(child.details.build!.parentBuildNumber).toBe(before.buildNumber)
    await confirmNativeAvgInputs(child)
    expect((await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).buildStatus).toBe('preview-ready')
    expect((await db.productBuilds.get(s.buildId))!.status).toBe('cancelled')
  })

  it('refuses start after the saved scene domain changes, and prepares an explicit replacement Brief without creating a hidden Build',async()=>{
    const s=await prepareNativeAvgAssembly(),draft=await readAvgDraftV1(s.scope)
    const saved=await saveAvgAuthorWorkspaceV1(s.scope,draft.revision,createAvgAuthoringPresetV1('linear'))
    await expect(startNativeAvgAssembly(s)).rejects.toThrow(/清单已变化/)
    expect(await db.productBuilds.count()).toBe(0)
    const details=await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:saved.revision})
    const current=await startNativeAvgAssembly({...s,details})
    expect(current.details.executionBrief!.avgAssembly!.sceneKeys).toEqual(['dark','light'])
  })

  it('fences author writes before the first execution receipt and resumes the remaining join after closing and reopening storage',async()=>{
    const s=await startNativeAvgAssembly(await prepareNativeAvgAssembly())
    await confirmNativeAvgInputs(s)
    let fenced=false
    const details=await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
    const cycle=await runProductProductionSchedulerCycleV1({scope:s.scope,productionId:s.productionId,
      executor:createConfiguredProductProductionExecutorV1({production:details.production,brief:details.executionBrief!}),
      onDurableBoundary:async boundary=>{
        if(boundary!=='artifact.accepted'||fenced)return
        fenced=true
        const draft=await readAvgDraftV1(s.scope)
        await expect(stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:draft.revision,
          artifactKey:'avg.system.plan',declaration:'并发编辑探针'})).rejects.toThrow(/不可采用|开始执行/)
      }})
    expect(fenced).toBe(true)
    expect(cycle.buildStatus).toBe('integrating')
    expect((await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()).filter(row=>row.artifactKey==='runtime.package')).toHaveLength(1)
    db.close();await db.open()
    expect((await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).buildStatus).toBe('preview-ready')
    expect((await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()).filter(row=>row.artifactKey==='runtime.package')).toHaveLength(1)
  })

  it('pins old sessions and preserves source bytes when switching to the independent linear configuration',async()=>{
    const s=await startNativeAvgAssembly(await prepareNativeAvgAssembly(createAvgAuthoringPresetV1('evidence')))
    await confirmNativeAvgInputs(s);await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const parent=(await db.productBuilds.get(s.buildId))!,session=await startProductProductionPreviewV1({scope:s.scope,productionId:s.productionId})
    const draft=await readAvgDraftV1(s.scope),linear=createAvgAuthoringPresetV1('linear');linear.basePreviewHash=parent.previewHash
    const saved=await saveAvgAuthorWorkspaceV1(s.scope,draft.revision,linear)
    const details=await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:saved.revision})
    const review=await readAvgAssemblyWorkspaceV1(s.scope,s.productionId)
    expect(review.details!.production.status).toBe('brief-ready')
    expect(review.details!.build!.previewManifestJson).toBe(parent.previewManifestJson)
    expect(review.artifacts.some(row=>row.artifactKey==='avg.author.stage')).toBe(true)
    const child=await startNativeAvgAssembly({...s,details})
    await confirmNativeAvgInputs(child);await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const next=(await db.productBuilds.get(child.buildId))!,preview=await verifyStoredProductBuildPreview(next)
    expect(preview!.runtimePackage.definition.enabledCapabilities).not.toContain('avg.inventory')
    expect((await db.productRuntimeSessions.get(session.sessionId))!.productBuildId).toBe(s.buildId)
    expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(parent.previewManifestJson)
  })
})
