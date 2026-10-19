import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import * as capabilities from '../../src/lib/product-production/capabilities'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { avgInventoryMediaFixture } from '../helpers/avg-inventory-media-fixture'
import { avgV5WorkbenchPreparationFixture } from '../helpers/avg-v5-workbench-preparation-fixture'
import { prepareAvgVisualPlanningSourceDraftV4,prepareAvgVisualPlanningSourceDraftV5 } from '../../src/lib/avg/visual-planning-scope-draft'
import { prepareAvgMediaConsumerDeclarationsV1,prepareAvgMediaConsumerDeclarationsV2 } from '../../src/lib/avg/media-configuration'
import { avgVisualPlanningTemplateRequirementsV2,parseAvgVisualPlanningScopeV2 } from '../../src/lib/avg/visual-planning-contract-v2'
import { prepareAvgVisualPlanningConfigurationV5,completeAvgVisualPlanningBriefV5,assertAvgVisualPlanningDraftMatchesV5,
  assertAvgVisualPlanningDraftMatchesV4 } from '../../src/lib/avg/visual-planning-workspace'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { prepareAvgAssemblyBriefV1,startAvgAssemblyV1,readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1,readAvgDraftReferenceImageV2,readAvgDraftReferenceBytesV2 } from '../../src/lib/avg/editor-service'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { prepareAvgVisualImageRouteV4,prepareAvgVisualImageRouteV5 } from '../../src/lib/avg/visual-image-route-workspace'
import { prepareAvgVisualImageProcessingV4,prepareAvgVisualImageProcessingV5 } from '../../src/lib/avg/visual-processing-workspace'
import { avgImageProcessingRecipeFixture } from '../helpers/avg-image-processing-fixture'
import { avgV5RegisteredProposalsFixture,adoptAvgV5Sources,cycleAvgV5Until,avgV5Accepted } from '../helpers/avg-v5-registered-proposals-fixture'
import { stageAvgVisualPlanningAuthorInputV4,stageAvgVisualPlanningAuthorInputV5,refuseAvgVisualPlanningBatchV5 } from '../../src/lib/avg/visual-planning-workspace'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { parseAvgVisualPlanningBriefV4 } from '../../src/lib/avg/visual-planning-brief'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-preparation.fixture.invalid/v1',apiKey:'test-only-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Preparation must never contact a provider')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})

function nextPlanning(){
  const f=avgVersionedPlanningFixture(),planning=structuredClone(f.versioned)
  planning.batchKey='next.versioned.batch'
  for(const t of planning.templates)t.parameters.assetKey='next.'+t.parameters.assetKey
  return planning
}
describe('AVG V5 explicit workbench preparation, no provider or adoption authority',()=>{
  it('declares only prospective existing icon/detail slots and preserves exact V2 policies without mutating author intent',async()=>{
    const f=avgVersionedPlanningFixture()
    if(f.source.systemPlan.version!==2)throw new Error('Expected native inventory')
    f.source.systemPlan.inventory.items[0].iconAssetKey=null;f.source.systemPlan.inventory.items[0].detailAssetKey=null
    const before=structuredClone(f.source)
    const result=await prepareAvgVisualPlanningSourceDraftV5({workspace:f.source,planning:f.versioned})
    expect(f.source).toEqual(before);expect(result.scope.referenceCatalog).toEqual(f.versioned.referenceCatalog)
    expect(result.scope.version).toBe(2);expect(result.workspace.mediaBatch).toBeUndefined();expect(result.workspace.presentation.stage.assets).toEqual([])
    const repaired=structuredClone(result.workspace)
    if(repaired.systemPlan.version!==2)throw new Error('Expected native inventory')
    expect(repaired.systemPlan.inventory.items[0].iconAssetKey).toBe('planned.versioned.letter.icon')
    expect(repaired.systemPlan.inventory.items[0].detailAssetKey).toBe('planned.versioned.letter.detail')
    repaired.systemPlan.inventory.items[0].iconAssetKey=null;repaired.systemPlan.inventory.items[0].detailAssetKey=null
    expect(repaired).toEqual(before)
    const requirements=avgVisualPlanningTemplateRequirementsV2(result.scope)
    expect(prepareAvgMediaConsumerDeclarationsV2(f.source,requirements)).toEqual(result.workspace)
    expect(()=>prepareAvgMediaConsumerDeclarationsV1(f.source,requirements as never)).toThrow()
  })
  it('keeps old scope parsing strict instead of dropping new reference policy fields',async()=>{
    const f=avgVersionedPlanningFixture()
    await expect(prepareAvgVisualPlanningSourceDraftV4({workspace:f.source,planning:f.versioned as never})).rejects.toThrow()
    await expect(prepareAvgVisualPlanningSourceDraftV5({workspace:f.source,planning:f.legacy as never})).rejects.toThrow()
    const broken=structuredClone(f.versioned);broken.referenceCatalog[0].reference.contentPolicy.permittedFeatures=[]
    await expect(prepareAvgVisualPlanningSourceDraftV5({workspace:f.source,planning:broken})).rejects.toThrow()
  })
  it('replaces only exact unused proposals while preserving unrelated authored item bindings',async()=>{
    const f=avgVersionedPlanningFixture(),old=await prepareAvgVisualPlanningSourceDraftV5({workspace:f.source,planning:f.versioned})
    if(old.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    old.workspace.systemPlan.inventory.items[0].variants[0].iconAssetKey='author.unrelated.icon'
    const next=await prepareAvgVisualPlanningSourceDraftV5({workspace:old.workspace,planning:nextPlanning(),previous:old.scope})
    if(next.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    expect(next.workspace.systemPlan.inventory.items[0].iconAssetKey).toBe('next.planned.versioned.letter.icon')
    expect(next.workspace.systemPlan.inventory.items[0].variants[0].iconAssetKey).toBe('author.unrelated.icon')
  })
  it.each(['selected','author-changed'] as const)('preserves a %s old slot instead of clearing it to make a new batch fit',async mode=>{
    const f=avgVersionedPlanningFixture(),old=await prepareAvgVisualPlanningSourceDraftV5({workspace:f.source,planning:f.versioned})
    if(old.workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
    if(mode==='selected')old.workspace.presentation.stage.assets.push({...((await avgInventoryMediaFixture())[0].asset),assetKey:f.versioned.templates[3].parameters.assetKey})
    else old.workspace.systemPlan.inventory.items[0].iconAssetKey='author.changed.icon'
    const before=structuredClone(old.workspace)
    await expect(prepareAvgVisualPlanningSourceDraftV5({workspace:old.workspace,planning:nextPlanning(),previous:old.scope})).rejects.toThrow(/绑定其他图片/)
    expect(old.workspace).toEqual(before)
  })
  it('rejects an undeclared item before creating any source proposal',async()=>{
    const f=avgVersionedPlanningFixture(),snapshot=structuredClone(f.source)
    f.versioned.templates[3].parameters.consumer.subjectKey='not-an-authored-item'
    await expect(prepareAvgVisualPlanningSourceDraftV5({workspace:f.source,planning:f.versioned})).rejects.toThrow()
    expect(f.source).toEqual(snapshot)
  })
  it('keeps V5 preparation closed when its original visual experiment is disabled before resolving a route or changing records',async()=>{
    vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','0')
    const f=await avgV5WorkbenchPreparationFixture(),resolve=vi.spyOn(capabilities,'resolveConfiguredTextCapabilityV1')
    expect(readiness.avgVisualPlanningExecutionReadyV5()).toBe(false)
    await expect(prepareAvgVisualPlanningConfigurationV5(f.owner.scope,f.workspace,f.planning)).rejects.toThrow(/尚未启用/)
    expect(resolve).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(await db.agentRuns.count()).toBe(0);expect(await db.productBuilds.count()).toBe(0)
  })
  it('prepares a genuine V5 Brief with exact reference2/target identities and zero writes or requests',async()=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const f=await avgV5WorkbenchPreparationFixture(),base=parseProductProductionBriefV3(f.owner.details.brief!.briefJson)
    const before=await db.productProductionBriefs.toArray(),drafts=await db.avgAuthoringDrafts.toArray(),config=await prepareAvgVisualPlanningConfigurationV5(f.owner.scope,f.workspace,f.planning,'agnes.image-2.5-flash.v1')
    const brief=parseProductProductionBriefV3(completeAvgVisualPlanningBriefV5(base,config))
    expect(brief.avgVisualPlanning?.version).toBe(5);expect(brief.avgAssembly).toBeUndefined()
    expect(brief.avgVisualPlanning?.scope).toEqual(parseAvgVisualPlanningScopeV2(f.scope));expect(brief.avgVisualPlanning?.imageBinding.adapterId).toBe('agnes.image-2.5-flash.v1')
    expect(brief.externalDataPolicy.allowedDataClasses).toContain('avg-visual-planning-text-v5')
    expect(brief.productionBudget).toMatchObject({maximumModelCalls:4,maximumMediaCalls:5})
    await expect(assertAvgVisualPlanningDraftMatchesV5(f.owner.scope,f.workspace,brief)).resolves.toBeUndefined()
    await expect(assertAvgVisualPlanningDraftMatchesV4(f.owner.scope,f.workspace,brief)).rejects.toThrow()
    expect(()=>parseAvgVisualPlanningBriefV4(brief.avgVisualPlanning)).toThrow()
    expect(await db.productProductionBriefs.toArray()).toEqual(before);expect(await db.avgAuthoringDrafts.toArray()).toEqual(drafts)
    expect(await db.agentRuns.count()).toBe(0);expect(await db.productBuilds.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects changed original reference consent before resolving either model route',async()=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const f=await avgV5WorkbenchPreparationFixture(),resolve=vi.spyOn(capabilities,'resolveConfiguredTextCapabilityV1')
    f.planning.referenceCatalog[0].reference.license='not the stored original consent'
    await expect(prepareAvgVisualPlanningConfigurationV5(f.owner.scope,f.workspace,f.planning)).rejects.toThrow(/授权|stale/)
    expect(resolve).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(await db.agentRuns.count()).toBe(0)
  })
  it('refuses changed author text at explicit start matching without silently restamping the scope',async()=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const f=await avgV5WorkbenchPreparationFixture(),config=await prepareAvgVisualPlanningConfigurationV5(f.owner.scope,f.workspace,f.planning)
    const brief=parseProductProductionBriefV3(completeAvgVisualPlanningBriefV5(parseProductProductionBriefV3(f.owner.details.brief!.briefJson),config))
    const workspace=structuredClone(f.workspace);workspace.scripts[0].lines[0].text+=' changed author text'
    await expect(assertAvgVisualPlanningDraftMatchesV5(f.owner.scope,workspace,brief)).rejects.toThrow(/已变化|stale/)
    expect(fetch).not.toHaveBeenCalled();expect(await db.agentRuns.count()).toBe(0)
  })
  it('prepares through the actual public service then requires a separate start to freeze V5 without dispatching any model',async()=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const f=await avgV5WorkbenchPreparationFixture(),draft=await readAvgDraftV1(f.owner.scope)
    const prepared=await prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:draft.revision,visualPlanning:f.planning})
    expect(parseProductProductionBriefV3(prepared.brief!.briefJson).avgVisualPlanning?.version).toBe(5)
    expect(prepared.brief!.authorizedAt).toBeNull();expect(prepared.build).toBeNull()
    expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
    const started=await startAvgAssemblyV1({scope:f.owner.scope,productionId:prepared.production.id!,expectedBriefHash:prepared.brief!.briefHash})
    expect(started.build?.status).toBe('building')
    const brief=parseProductProductionBriefV3(started.brief!.briefJson),plan=parseProductProductionPlanV3(started.build!.planJson,brief,started.build!.briefHash)
    expect(plan.tasks.filter(t=>t.executionMode==='model')).toHaveLength(4)
    expect(plan.tasks.find(t=>t.kind==='avg-v5-visual-requirements-compile')?.contextProfile).toBe('avg-visual-planning-v5')
    expect(plan.tasks.filter(t=>t.kind==='avg-media-image-generate').every(t=>t.skillId==='avg.compiled-image-request.v2')).toBe(true)
    const view=await readAvgAssemblyWorkspaceV1(f.owner.scope)
    expect(view.details!.build!.id).toBe(started.build!.id);expect(view.imageDefinition).toBeNull()
    expect(await db.agentRuns.count()).toBeGreaterThan(0);expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects changed draft revision and a disabled visual experiment without persisting a V5 proposal or Run',async()=>{
    vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','0')
    const f=await avgV5WorkbenchPreparationFixture(),draft=await readAvgDraftV1(f.owner.scope),before=await db.productProductionBriefs.toArray()
    await expect(prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:draft.revision-1,visualPlanning:f.planning})).rejects.toThrow(/草稿已变化/)
    await expect(prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:draft.revision,visualPlanning:f.planning})).rejects.toThrow(/尚未启用/)
    expect(await db.productProductionBriefs.toArray()).toEqual(before)
    expect(await db.agentRuns.count()).toBe(0);expect(await db.productBuilds.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['draft','route'] as const)('rejects changed %s before public start and retains the saved reviewable Brief',async mode=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const f=await avgV5WorkbenchPreparationFixture(),draft=await readAvgDraftV1(f.owner.scope)
    const prepared=await prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:draft.revision,visualPlanning:f.planning})
    if(mode==='route')useAIConfigStore.getState().setConfig({baseUrl:'https://changed-preparation.fixture.invalid/v1'})
    else{
      const current=await readAvgDraftV1(f.owner.scope),workspace=structuredClone(f.workspace)
      workspace.scripts[0].lines[0].text+=' explicitly changed by author'
      await saveAvgAuthorWorkspaceV1(f.owner.scope,current.revision,workspace)
    }
    await expect(startAvgAssemblyV1({scope:f.owner.scope,productionId:prepared.production.id!,expectedBriefHash:prepared.brief!.briefHash})).rejects.toThrow()
    const after=await readProductProductionDetailsV1(f.owner.scope,prepared.production.id!,['avg'])
    expect(after.brief!.briefHash).toBe(prepared.brief!.briefHash);expect(after.brief!.authorizedAt).toBeNull()
    expect(after.build).toBeNull();expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  })
  it('refuses implicit downgrade of a saved V5 proposal through an old scope',async()=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const f=await avgV5WorkbenchPreparationFixture(),draft=await readAvgDraftV1(f.owner.scope)
    const prepared=await prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:draft.revision,visualPlanning:f.planning})
    await expect(prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:(await readAvgDraftV1(f.owner.scope)).revision,
      visualPlanning:f.author.legacy})).rejects.toThrow(/版本不同/)
    expect((await readProductProductionDetailsV1(f.owner.scope,prepared.production.id!,['avg'])).brief!.briefHash).toBe(prepared.brief!.briefHash)
    expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  })

  it('changes an unstarted actual V5 image route and freezes local processing without legacy interpretation or provider calls',async()=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const f=await avgV5WorkbenchPreparationFixture(),draft=await readAvgDraftV1(f.owner.scope)
    const prepared=await prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:draft.revision,visualPlanning:f.planning})
    const selection={scope:f.owner.scope,productionId:prepared.production.id!,expectedBriefHash:prepared.brief!.briefHash,
      expectedDraftRevision:(await readAvgDraftV1(f.owner.scope)).revision,expectedBuild:null}
    await expect(prepareAvgVisualImageRouteV4({...selection,adapterId:'agnes.image-2.5-flash.v1'})).rejects.toThrow()
    const routed=await prepareAvgVisualImageRouteV5({...selection,adapterId:'agnes.image-2.5-flash.v1'})
    const next=parseProductProductionBriefV3(routed.brief!.briefJson)
    expect(next.avgVisualPlanning?.version).toBe(5);expect(next.avgVisualPlanning?.imageBinding.adapterId).toBe('agnes.image-2.5-flash.v1')
    const requirement=f.scope.templates.find(t=>t.subjectKind==='environment')!.parameters
    const plan={schema:'storyforge.avg.image-processing-plan' as const,version:1 as const,entries:[{requirementKey:requirement.requirementKey,recipe:avgImageProcessingRecipeFixture()}]}
    const exact={...selection,expectedBriefHash:routed.brief!.briefHash,plan}
    await expect(prepareAvgVisualImageProcessingV4(exact)).rejects.toThrow()
    const processed=await prepareAvgVisualImageProcessingV5(exact),brief=parseProductProductionBriefV3(processed.brief!.briefJson)
    expect(brief.avgVisualPlanning?.version).toBe(5);expect(brief.avgVisualPlanning?.imageProcessing).toEqual(plan)
    expect(brief.productionBudget).toMatchObject({maximumModelCalls:4,maximumMediaCalls:5})
    expect(processed.build).toBeNull();expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
    const after=await startAvgAssemblyV1({scope:f.owner.scope,productionId:processed.production.id!,expectedBriefHash:processed.brief!.briefHash})
    await expect(prepareAvgVisualImageProcessingV5({...exact,expectedBriefHash:processed.brief!.briefHash,
      expectedBuild:{id:after.build!.id!,revision:after.build!.stateRevision}})).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['brief','draft','build'] as const)('rejects stale %s while editing an unstarted V5 route or recipe',async mode=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    const f=await avgV5WorkbenchPreparationFixture(),draft=await readAvgDraftV1(f.owner.scope)
    const prepared=await prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:draft.revision,visualPlanning:f.planning})
    const selection={scope:f.owner.scope,productionId:prepared.production.id!,expectedBriefHash:mode==='brief'?'a'.repeat(64):prepared.brief!.briefHash,
      expectedDraftRevision:(await readAvgDraftV1(f.owner.scope)).revision+(mode==='draft'?1:0),expectedBuild:mode==='build'?{id:999,revision:1}:null}
    await expect(prepareAvgVisualImageRouteV5({...selection,adapterId:'agnes.image-2.5-flash.v1'})).rejects.toThrow(/已变化/)
    await expect(prepareAvgVisualImageProcessingV5({...selection,plan:null})).rejects.toThrow(/已变化/)
    expect((await readProductProductionDetailsV1(f.owner.scope,prepared.production.id!,['avg'])).brief!.briefHash).toBe(prepared.brief!.briefHash)
    expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  })
  it('displays an exact imported reference2 with the same verified bytes used for provider preparation',async()=>{
    const f=await avgV5WorkbenchPreparationFixture(),reference=f.scope.referenceCatalog[0].reference
    const image=await readAvgDraftReferenceImageV2(f.owner.scope,reference)
    expect(image.asset.contentHash).toBe(reference.contentHash)
    expect(image.data).toEqual(await readAvgDraftReferenceBytesV2(f.owner.scope,reference))
    await expect(readAvgDraftReferenceImageV2(f.owner.scope,{...reference,license:'not the original license'})).rejects.toThrow(/stale|授权/)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['candidate','refuse'] as const)('uses the actual V5 model proposal for an explicit author %s and keeps V4 strict',async mode=>{
    vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
    useAIConfigStore.getState().setConfig({baseUrl:'https://v5-proposal.fixture.invalid/v1'})
    const s=await avgV5RegisteredProposalsFixture();await adoptAvgV5Sources(s);await cycleAvgV5Until(s,'avg.proposal.visual-bible')
    const proposal=(await avgV5Accepted(s,'avg.proposal.visual-bible'))!,build=(await db.productBuilds.get(s.buildId))!
    const selection={scope:s.scope,productionId:s.productionId,expectedBuildId:s.buildId,expectedBuildRevision:build.stateRevision,
      artifactKey:'avg.media.visual-bible',proposal:{artifactKey:proposal.artifactKey,version:proposal.version,contentHash:proposal.contentHash}}
    const original=JSON.parse(proposal.payloadJson).payload,declaration='准确模拟作者工程核对，不签实际艺术或商业质量'
    await expect(stageAvgVisualPlanningAuthorInputV4({...selection,payload:original,declaration})).rejects.toThrow()
    if(mode==='candidate'){
      const candidate=await stageAvgVisualPlanningAuthorInputV5({...selection,payload:original,declaration})
      expect(candidate.status).toBe('pending');expect(await avgV5Accepted(s,'avg.media.visual-bible')).toBeUndefined()
    }else{
      await refuseAvgVisualPlanningBatchV5({...selection,reason:'本次原创工程视觉方向不合适；保留原模型结果与用量'})
      expect((await db.productBuilds.get(s.buildId))!.status).toBe('cancelled')
      expect(await db.productBuildArtifacts.get(proposal.id!)).toEqual(proposal)
      db.close();await db.open()
      expect((await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).build!.status).toBe('cancelled')
    }
    expect(s.calls).toHaveLength(1);expect(s.imageCalls).toHaveLength(0)
  },60_000)

})
