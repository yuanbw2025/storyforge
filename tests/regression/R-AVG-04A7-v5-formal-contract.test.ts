import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { buildAvgVisualPlanningPlanV4 } from '../../src/lib/avg/visual-planning-plan'
import { avgV5FormalFixture } from '../helpers/avg-v5-formal-fixture'
import { parseAvgVisualPlanningBriefV4 } from '../../src/lib/avg/visual-planning-brief'
import { avgVisualPlanningExecutionReadyV5 } from '../../src/lib/avg/visual-planning-brief-v5'
import * as readinessV5 from '../../src/lib/avg/visual-planning-brief-v5'
import { buildAvgVisualPlanningPlanV5,AVG_COMPILED_IMAGE_SKILL_V5 } from '../../src/lib/avg/visual-planning-plan-v5'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { createProductProductionPlanV3,parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { avgVisualPlanningBudgetV5,avgVisualPlanningGateIdsV5 } from '../../src/lib/avg/visual-planning-policy-v5'
import { avgVisualPlanningBudgetV4 } from '../../src/lib/avg/visual-planning-policy'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { avgImageProcessingRecipeFixture } from '../helpers/avg-image-processing-fixture'
import { assertAvgVisualPlanningDraftMatchesV4,resolveAvgVisualPlanningExecutionV4 } from '../../src/lib/avg/visual-planning-workspace'
import { readAvgDraftReferenceBytesV2 } from '../../src/lib/avg/editor-service'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { createAvgVisualPlanningExecutorV4 } from '../../src/lib/avg/visual-planning-executor'

beforeEach(async()=>{await db.delete();await db.open();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('V5 foundation cannot make a network request')}))})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})
describe('AVG V5 formal contract and strict legacy boundary',()=>{
  it('preserves the V4 private Brief and exact plan hashes recorded before sharing topology',async()=>{
    const s=await avgVisualPlanningFixtureV4(),plan=buildAvgVisualPlanningPlanV4({brief:{...s.brief,avgVisualPlanning:s.planning},briefHash:'a'.repeat(64),buildNumber:1,controlEpoch:0})
    expect(plan.productType).toBe('avg')
    expect({briefHash:await hashProductProductionValueV2(s.planning),planHash:await hashProductProductionValueV2(plan)}).toEqual({briefHash:'297796b370e9840505ff60f1bbca5b9d2f1c4eb7f80ab03a349fedbb6e41427b',planHash:'7034e779e7959a809415ad7c3cd94f714beabfd7f7d2667b2c8cd0a706b94837'})
  })

  it('parses a real isolated author draft into exact V5 metadata and a finite canonical new-role plan',async()=>{
    const {brief,planning}=await avgV5FormalFixture(),before=structuredClone(brief),briefHash=await hashProductProductionValueV2(brief)
    expect(parseProductProductionBriefV3(JSON.stringify(brief))).toEqual(brief)
    const plan=await createProductProductionPlanV3({brief,briefHash,buildNumber:1,controlEpoch:0})
    expect(brief).toEqual(before);expect(parseProductProductionPlanV3(plan,brief,briefHash)).toEqual(plan)
    expect(plan).toEqual(buildAvgVisualPlanningPlanV5({brief,briefHash,buildNumber:1,controlEpoch:0}))
    const models=plan.tasks.filter(t=>t.executionMode==='model'),images=plan.tasks.filter(t=>t.executionMode==='media-provider')
    expect(models).toHaveLength(4);expect(models.every(t=>t.kind.startsWith('avg-v5-')&&t.skillId?.endsWith('.v2')&&t.maxAttempts===1)).toBe(true)
    expect(images).toHaveLength(5);expect(images.every(t=>t.skillId===AVG_COMPILED_IMAGE_SKILL_V5&&t.maxAttempts===1&&t.dependsOn.includes('avg.visual.compile.requirements'))).toBe(true)
    expect(plan.tasks.find(t=>t.kind==='avg-v5-visual-requirements-compile')).toMatchObject({executionMode:'deterministic',contextProfile:'avg-visual-planning-v5',skillId:null,capabilityRequirementKeys:[]})
    expect(brief.productionBudget).toEqual(avgVisualPlanningBudgetV5(brief));expect(brief.productionBudget.maximumModelCalls).toBe(4);expect(brief.productionBudget.maximumMediaCalls).toBe(5)
    expect(brief.completionContract.requiredGateIds).toEqual(avgVisualPlanningGateIdsV5(brief))
    expect(planning.scope.referenceCatalog[0].reference.contentPolicy.excludedFeatures).toContain('蜡封信件')
    expect(()=>parseAvgVisualPlanningBriefV4(planning)).toThrow();expect(()=>avgVisualPlanningBudgetV4(brief)).toThrow()
  })
  it.each(['old-scope','old-reference','false-consent','raw-reuse','proposal-reuse','wrong-product','assembly-mix','class-mismatch','waiver','budget','gate','voice','unknown-version'] as const)('refuses V5 %s without dispatch',async mode=>{
    const {brief}=await avgV5FormalFixture(),v=brief.avgVisualPlanning
    if(mode==='old-scope')(v.scope as {version:number}).version=1
    if(mode==='old-reference'){
      const ref=v.scope.referenceCatalog[0].reference,{schema:_s,version:_v,contentPolicy:_p,...old}=ref
      ;(v.scope.referenceCatalog[0] as {reference:unknown}).reference=old
    }
    if(mode==='false-consent')(v.scope.referenceCatalog[0].reference as {providerInputAllowed:boolean}).providerInputAllowed=false
    if(mode==='raw-reuse')(v as unknown as Record<string,unknown>).rawReuse=[]
    if(mode==='proposal-reuse')(v as unknown as Record<string,unknown>).proposalReuse=[]
    if(mode==='wrong-product')brief.intent.productType='character-chat'
    if(mode==='assembly-mix')brief.avgAssembly=v.assembly
    if(mode==='class-mismatch')brief.capabilityRequirements[0].allowedDataClasses=['avg-visual-planning-text']
    if(mode==='waiver')brief.completionContract.allowSoftWaivers=true
    if(mode==='budget')brief.productionBudget.maximumMediaCalls++
    if(mode==='gate')brief.completionContract.requiredGateIds.pop()
    if(mode==='voice')brief.media.voiceLineCount=1
    if(mode==='unknown-version')(v as {version:number}).version=6
    expect(()=>parseProductProductionBriefV3(brief)).toThrow()
  })
  it.each(['old-kind','old-skill','old-context','no-compiler-dependency','extra-attempt','model-context'] as const)('rejects a rehashed plan with %s',async mode=>{
    const {brief}=await avgV5FormalFixture(),briefHash=await hashProductProductionValueV2(brief)
    const plan=await createProductProductionPlanV3({brief,briefHash,buildNumber:1,controlEpoch:0}),changed=structuredClone(plan)
    const model=changed.tasks.find(t=>t.executionMode==='model')!,image=changed.tasks.find(t=>t.executionMode==='media-provider')!,compile=changed.tasks.find(t=>t.kind==='avg-v5-visual-requirements-compile')!
    if(mode==='old-kind')model.kind='avg-v4-visual-direction-proposal'
    if(mode==='old-skill')model.skillId='avg.visual-bible.v1'
    if(mode==='old-context')compile.contextProfile='avg-visual-planning-v4'
    if(mode==='no-compiler-dependency'){image.dependsOn=image.dependsOn.filter(t=>t!==compile.taskKey);image.requiredReceipts=image.requiredReceipts.filter(r=>r.taskKey!==compile.taskKey)}
    if(mode==='extra-attempt')image.maxAttempts++
    if(mode==='model-context')model.contextProfile='avg-visual-planning-v5'
    expect(()=>parseProductProductionPlanV3(changed,brief,briefHash)).toThrow()
  })
  it('keeps V5 save closed with the visual experiment off before any new Brief, Build, Run, media or author-draft writes',async()=>{
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','0')
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    const {owner,brief}=await avgV5FormalFixture(),tables=[db.productProductions,db.productProductionBriefs,db.productBuilds,db.agentRuns,db.agentRunEvents,db.agentRunArtifacts,db.agentRunCheckpoints,db.mediaBlobObjects,db.avgAuthoringDrafts,db.avgDraftMedia]
    const snapshot=()=>Promise.all(tables.map(t=>t.toArray())),before=await snapshot()
    expect(avgVisualPlanningExecutionReadyV5()).toBe(false)
    const result=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'save-brief-revision',commandId:'v5.closed.save',expectedStateRevision:owner.details.production.stateRevision,parentRevision:owner.details.brief!.revision,brief}})
    expect(result).toMatchObject({ok:false,errorCode:'brief-not-authorized'})
    expect(await snapshot()).toEqual(before);expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps author-start closed for an actually saved prospective V5 draft without creating any Build or Run',async()=>{
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
    const {owner,brief}=await avgV5FormalFixture(),gate=vi.spyOn(readinessV5,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const saved=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'save-brief-revision',commandId:'v5.test.prepare-only',expectedStateRevision:owner.details.production.stateRevision,parentRevision:owner.details.brief!.revision,brief}})
    expect(saved.ok).toBe(true);gate.mockRestore();vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','0');expect(avgVisualPlanningExecutionReadyV5()).toBe(false)
    const details=await readProductProductionDetailsV1(owner.scope,owner.productionId,['avg']),tables=[db.productProductions,db.productProductionBriefs,db.productBuilds,db.agentRuns,db.agentRunEvents,db.agentRunArtifacts,db.agentRunCheckpoints,db.mediaBlobObjects,db.avgAuthoringDrafts,db.avgDraftMedia]
    const snapshot=()=>Promise.all(tables.map(t=>t.toArray())),before=await snapshot(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    const started=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'authorize-start',commandId:'v5.closed.start',expectedStateRevision:details.production.stateRevision,briefRevision:details.brief!.revision,briefHash:details.brief!.briefHash,authorizationNonce:'explicit-controlled-author-start'}})
    expect(started).toMatchObject({ok:false,errorCode:'brief-not-authorized'});expect(await snapshot()).toEqual(before);expect(fetcher).not.toHaveBeenCalled()
    expect(await db.productProductionCommands.where('productionId').equals(owner.productionId).filter(row=>row.commandId==='v5.closed.start').first()).toMatchObject({status:'failed',errorCode:'brief-not-authorized'})
  })

  it('keeps configured V5 dispatch gated and rejects the old executor family',async()=>{
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','0')
    const {owner,brief}=await avgV5FormalFixture(),snapshot=()=>Promise.all(db.tables.map(t=>t.toArray())),before=await snapshot()
    const runText=vi.fn(async()=>{throw new Error('V5 cannot use the old model runner')}),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    expect(()=>createConfiguredProductProductionExecutorV1({production:owner.details.production,brief,runText})).toThrow('方案版本')
    expect(()=>createAvgVisualPlanningExecutorV4({brief,runText})).toThrow('方案版本')
    expect(await snapshot()).toEqual(before);expect(runText).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([false,true])('retains an unstarted V5 draft references=%s through full backup/remap and removes only the copied owner',async withReferences=>{
    const {owner,brief}=await avgV5FormalFixture()
    // Original-concept preparation needs no reference Blob. The separate
    // reference cases above check exact V2 policy metadata, not invented bytes.
    if(!withReferences){
      brief.avgVisualPlanning.scope.referenceCatalog=[]
      for(const t of brief.avgVisualPlanning.scope.templates){t.allowedReferenceKeys=[];t.requiredReferenceKeys=[]}
      brief.capabilityRequirements.find(c=>c.mediaClass==='image')!.allowedDataClasses=['image-prompt']
      brief.externalDataPolicy.allowReferenceImages=false
    }
    const parsed=parseProductProductionBriefV3(brief),gate=vi.spyOn(readinessV5,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const saved=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'save-brief-revision',commandId:'v5.lifecycle.draft',expectedStateRevision:owner.details.production.stateRevision,parentRevision:owner.details.brief!.revision,brief:parsed}})
    expect(saved.ok).toBe(true);gate.mockRestore()
    const exported=await exportProjectJSON(owner.scope.projectId),projectId=await importProjectJSON(exported)
    const production=(await db.productProductions.where('projectId').equals(projectId).first())!
    const copyScope={projectId,workId:production.workId!,worldId:production.worldId!}
    const copy=await readProductProductionDetailsV1(copyScope,production.id!,['avg'])
    const body=parseProductProductionBriefV3(copy.brief!.briefJson)
    expect(body.avgVisualPlanning).toEqual(parsed.avgVisualPlanning);expect(copy.brief!.briefHash).toBe(await hashProductProductionValueV2(body))
    if(withReferences){
      if(body.avgVisualPlanning?.version!==5)throw new Error('Expected saved V5 metadata')
      const reference=body.avgVisualPlanning.scope.referenceCatalog[0].reference,copyBefore=await exportProjectJSON(projectId)
      expect(reference.contentPolicy.excludedFeatures).toContain('蜡封信件')
      await expect(readAvgDraftReferenceBytesV2(copyScope,reference,body.avgVisualPlanning.scope.templates[0].parameters.family)).rejects.toThrow()
      expect({...await exportProjectJSON(projectId),exportedAt:0}).toEqual({...copyBefore,exportedAt:0})
    }
    expect(copy.build).toBeNull();expect(await db.agentRuns.where('workId').equals(copyScope.workId).count()).toBe(0)
    expect(projectId).not.toBe(owner.scope.projectId);expect(copyScope.workId).not.toBe(owner.scope.workId);expect(production.id).not.toBe(owner.productionId)
    expect((await db.worldReleases.get(body.source.worldReleaseId))?.contentHash).toBe(body.source.worldContentHash)
    await deleteWork(copyScope.workId)
    expect(await db.productProductionBriefs.where('productionId').equals(production.id!).count()).toBe(0)
    const original=await readProductProductionDetailsV1(owner.scope,owner.productionId,['avg'])
    expect(parseProductProductionBriefV3(original.brief!.briefJson)).toEqual(parsed)
    const after=await exportProjectJSON(owner.scope.projectId);expect({...after,exportedAt:0}).toEqual({...exported,exportedAt:0})
  })

  it('derives zero-call local processing from the actual V5 template without an old image request',async()=>{
    const {brief}=await avgV5FormalFixture(),requirementKey=brief.avgVisualPlanning.scope.templates[0].parameters.requirementKey
    brief.avgVisualPlanning.imageProcessing={schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey,recipe:avgImageProcessingRecipeFixture()}]}
    brief.productionBudget=avgVisualPlanningBudgetV5(brief);brief.completionContract.requiredGateIds=avgVisualPlanningGateIdsV5(brief)
    const parsed=parseProductProductionBriefV3(brief),briefHash=await hashProductProductionValueV2(parsed)
    const plan=await createProductProductionPlanV3({brief:parsed,briefHash,buildNumber:1,controlEpoch:0})
    const process=plan.tasks.find(t=>t.taskKey===`avg.media.process.${requirementKey}`)!
    expect(process).toMatchObject({kind:'avg-media-image-process',executionMode:'deterministic',contextProfile:'avg-visual-planning-v5',skillId:null,
      budgetReservation:{modelCalls:0,mediaCalls:0,maximumCostUsd:0}})
    expect(process.inputArtifactKeys).toContain('avg.media.compiled-visual-requirements');expect(process.dependsOn).toContain('avg.visual.compile.requirements')
    expect(parsed.productionBudget.maximumMediaCalls).toBe(5);expect(parseProductProductionPlanV3(plan,parsed,briefHash)).toEqual(plan)
  })
  it('refuses V5 through the old V4 draft and execution readers before provider or owner mutation',async()=>{
    const {brief,owner,author}=await avgV5FormalFixture(),snapshot=()=>Promise.all(db.tables.map(t=>t.toArray())),before=await snapshot()
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    await expect(assertAvgVisualPlanningDraftMatchesV4(owner.scope,author.source,brief)).rejects.toThrow()
    await expect(resolveAvgVisualPlanningExecutionV4(brief)).rejects.toThrow()
    expect(await snapshot()).toEqual(before);expect(fetcher).not.toHaveBeenCalled()
  })
})
