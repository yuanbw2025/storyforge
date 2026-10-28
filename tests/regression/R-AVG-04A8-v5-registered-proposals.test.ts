import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { AVG_VISUAL_PLANNING_ROLES_V5,AVG_VISUAL_PLANNING_CONTEXT_V5,avgVisualPlanningMethodV5 } from '../../src/lib/avg/visual-planning-roles-v5'
import { AVG_VISUAL_PLANNING_ROLES_V1,AVG_VISUAL_PLANNING_CONTEXT_V1 } from '../../src/lib/avg/visual-planning-roles'
import { projectAvgVisualPlanningTaskV5,readAvgVisualPlanningContextV5 } from '../../src/lib/avg/visual-planning-context-v5'
import { readAvgVisualPlanningContextV4 } from '../../src/lib/avg/visual-planning-context'
import { avgV5FormalFixture } from '../helpers/avg-v5-formal-fixture'
import { buildAvgVisualPlanningPlanV5 } from '../../src/lib/avg/visual-planning-plan-v5'
import { avgV5RegisteredProposalsFixture,adoptAvgV5Artifact,adoptAvgV5Sources,avgV5Accepted,cycleAvgV5Until,absentAvgV5GeneratedProof } from '../helpers/avg-v5-registered-proposals-fixture'
import { readAvgVisualProposalEvidenceV4,readAvgVisualProposalEvidenceV5 } from '../../src/lib/avg/visual-planning-evidence'
import { runProductProductionUntilBlockedV1,runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { readAvgConfirmedVisualArtifactsV5 } from '../../src/lib/avg/author-artifacts'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { verifyAcceptedProductBuildArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering request is forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})
const openEngineeringFence=()=>vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
describe('AVG V5 registered proposals and explicit author compilation',()=>{
  it('registers distinct new snapshots without changing original V4 agent defaults',()=>{
    expect(readiness.avgVisualPlanningExecutionReadyV5()).toBe(true)
    expect(CONTEXT_SOURCE_BY_KEY.get(AVG_VISUAL_PLANNING_CONTEXT_V5)).toMatchObject({ownerFrom:'work',layer:'L0',protectedFromTrim:true,budgetTokens:24000})
    for(const [i,role] of AVG_VISUAL_PLANNING_ROLES_V5.entries()){
      const skill=getAgentSkillV1(role.skillId),old=getAgentSkillV1(AVG_VISUAL_PLANNING_ROLES_V1[i].skillId)
      expect(skill).toMatchObject({defaultForAgent:false,executionMode:'product-production',contextSourceKeys:[AVG_VISUAL_PLANNING_CONTEXT_V5],optionalContextSourceKeys:[]})
      expect(old).toMatchObject({defaultForAgent:true,contextSourceKeys:[AVG_VISUAL_PLANNING_CONTEXT_V1]})
      expect(skill.promptVersion).not.toBe(old.promptVersion);expect(avgVisualPlanningMethodV5(role.subjectKind)).toContain('excludedFeatures')
    }
  })
  it('projects only required public target and policy metadata, excluding raw story, bytes and portable proofs',async()=>{
    const {brief,author}=await avgV5FormalFixture(),plan=buildAvgVisualPlanningPlanV5({brief,briefHash:'a'.repeat(64),buildNumber:1,controlEpoch:0})
    brief.avgVisualPlanning.scope.referenceCatalog[0].reference.generatedSource=absentAvgV5GeneratedProof(brief.avgVisualPlanning.scope.referenceCatalog[0].reference.contentHash)
    const task=plan.tasks.find(t=>t.kind==='avg-v5-visual-direction-proposal')!
    const packet=projectAvgVisualPlanningTaskV5({planning:brief.avgVisualPlanning,task,source:author.source}),json=JSON.stringify(packet)
    expect(packet.version).toBe(5);expect(packet.requirements).toHaveLength(5);expect(packet.requirements.every(r=>r.family.variantKey)).toBe(true)
    expect(packet.references[0]).toMatchObject({permittedFeatures:['冷暖配色与绘制笔触'],excludedFeatures:['蜡封信件','发光按钮']})
    expect(packet.references.every(r=>Object.keys(r).sort().join(',')==='allowedChange,excludedFeatures,observation,permittedFeatures,purpose,referenceKey')).toBe(true)
    expect(json).not.toContain(author.source.scripts[0].lines[0].text)
    for(const key of ['generatedSource','blobObjectId','rawResponse','license','providerInputAllowed','data:image/'])expect(json).not.toContain(key)
    const old={...task,skillId:'avg.visual-bible.v1',kind:'avg-v4-visual-direction-proposal'}
    expect(()=>projectAvgVisualPlanningTaskV5({planning:brief.avgVisualPlanning,task:old,source:author.source})).toThrow()
  })
  it('runs all four actual HTTP roles, adopts author edits and compiles exact new requirements with portable raw evidence',async()=>{
    openEngineeringFence();const s=await avgV5RegisteredProposalsFixture()
    expect(s.calls).toHaveLength(0);await adoptAvgV5Sources(s)
    await cycleAvgV5Until(s,'avg.proposal.visual-bible');expect(s.calls).toHaveLength(1)
    expect(await avgV5Accepted(s,'avg.media.visual-bible')).toBeUndefined();expect(await avgV5Accepted(s,'avg.media.compiled-visual-requirements')).toBeUndefined()
    const original=(await avgV5Accepted(s,'avg.proposal.visual-bible'))!,proof=await readAvgVisualProposalEvidenceV5(s.scope,original)
    expect(JSON.parse(original.payloadJson).version).toBe(3);expect(proof.request.version).toBe(2);expect(proof.quality.version).toBe(2)
    await expect(readAvgVisualProposalEvidenceV4(s.scope,original)).rejects.toThrow()
    const bible=structuredClone(s.author.visualBible);bible.style.composition='作者修改：固定下方完整对白安全区'
    const candidate=await adoptAvgV5Artifact(s,'avg.media.visual-bible',bible)
    expect(JSON.parse(candidate.metadataJson)).toMatchObject({version:6,origin:'model-proposal',visualProposalValidation:{authorEdited:true,proposal:{contentHash:original.contentHash}}})
    const targets=s.plan.tasks.filter(t=>t.kind==='avg-v5-subject-visual-proposal').map(t=>t.outputArtifactKeys[0])
    await cycleAvgV5Until(s,targets[targets.length-1]);expect(s.calls).toHaveLength(4)
    for(const key of targets){const row=(await avgV5Accepted(s,key))!,p=JSON.parse(row.payloadJson);await adoptAvgV5Artifact(s,p.targetArtifactKey,p.payload)}
    await cycleAvgV5Until(s,'avg.media.compiled-visual-requirements')
    const compiled=(await avgV5Accepted(s,'avg.media.compiled-visual-requirements'))!,payload=JSON.parse(compiled.payloadJson)
    expect(payload).toMatchObject({version:2,batch:{version:2}});expect(payload.batch.requirements).toHaveLength(5)
    expect(payload.batch.requirements.every((r:{references:Array<{version:number;contentPolicy:{excludedFeatures:string[]}}>})=>r.references.every(ref=>ref.version===2&&ref.contentPolicy.excludedFeatures.includes('蜡封信件')))).toBe(true)
    expect(JSON.parse(compiled.qualityJson).version).toBe(2);expect(s.calls).toHaveLength(4)
    for(const call of s.calls){
      expect(call.packet.version).toBe(5);expect(JSON.stringify(call.packet)).not.toContain(s.author.source.scripts[0].lines[0].text)
      expect(JSON.stringify(call.packet)).not.toContain('generatedSource');expect(call.body.messages[0].content).toContain('permittedFeatures')
    }
    const build=(await db.productBuilds.get(s.buildId))!,ledger=JSON.parse(build.budgetLedgerJson)
    expect(Object.values(ledger.tasks).reduce((n,t:any)=>n+Number(t.usage?.modelCalls??0),0)).toBe(4)
    expect((await db.agentRuns.where('productBuildId').equals(s.buildId).toArray()).some(r=>r.parentRelation?.startsWith('task:avg.media.generate.'))).toBe(false)
    const context={projectId:s.scope.projectId,scope:s.scope,productProductionId:s.productionId,productBuildId:s.buildId,productProductionTaskKey:'avg.visual.propose.direction',productArtifactKeys:s.plan.tasks.find(t=>t.taskKey==='avg.visual.propose.direction')!.inputArtifactKeys}
    expect(JSON.parse(await readAvgVisualPlanningContextV5(context)).version).toBe(5);await expect(readAvgVisualPlanningContextV4(context)).rejects.toThrow()
    const adopted=await readAvgConfirmedVisualArtifactsV5({scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,artifactKeys:['avg.media.visual-bible']})
    expect(adopted[0].payload).toEqual(bible)
    const backup=await exportProjectJSON(s.scope.projectId),copyProjectId=await importProjectJSON(backup),copyBuild=(await db.productBuilds.where('projectId').equals(copyProjectId).first())!
    const copyScope={projectId:copyProjectId,workId:copyBuild.workId!,worldId:copyBuild.worldId!},copyRaw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([copyBuild.id!,original.artifactKey]).first())!
    expect((await readAvgVisualProposalEvidenceV5(copyScope,copyRaw)).rawText).toBe(proof.rawText)
    const copyBrief=(await db.productProductionBriefs.where('productionId').equals(copyBuild.productionId).filter(r=>r.briefHash===copyBuild.briefHash).first())!
    expect(parseProductProductionBriefV3(copyBrief.briefJson).avgVisualPlanning?.version).toBe(5)
    await expect(readAvgConfirmedVisualArtifactsV5({scope:copyScope,buildId:copyBuild.id!,expectedBuildRevision:copyBuild.stateRevision,controlEpoch:copyBuild.controlEpoch,artifactKeys:['avg.media.visual-bible']})).rejects.toThrow()
    await deleteWork(copyScope.workId);expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...backup,exportedAt:0})
    expect((await verifyAcceptedProductBuildArtifactV1({scope:s.scope,buildId:s.buildId,artifactKey:compiled.artifactKey,version:compiled.version,contentHash:compiled.contentHash})).contentHash).toBe(compiled.contentHash)
    expect(s.calls).toHaveLength(4)
  },60_000)
  it.each(['missing','tampered','license'] as const)('blocks %s reference before any model HTTP request',async mode=>{
    openEngineeringFence();const s=await avgV5RegisteredProposalsFixture();await adoptAvgV5Sources(s)
    const ref=(await db.avgDraftMedia.where('workId').equals(s.scope.workId).first())!
    if(mode==='missing')await db.avgDraftMedia.delete(ref.id!)
    if(mode==='license')await db.avgDraftMedia.update(ref.id!,{assetJson:JSON.stringify({...JSON.parse(ref.assetJson),license:'Changed after frozen author consent'})})
    if(mode==='tampered'){const blob=(await db.mediaBlobObjects.get(ref.blobObjectId))!,bytes=new Uint8Array((blob.data as ArrayBuffer).slice(0));bytes[bytes.length-1]^=1;await db.mediaBlobObjects.update(blob.id!,{data:bytes.buffer})}
    await runProductProductionUntilBlockedV1(s);expect(s.calls).toHaveLength(0);expect(await avgV5Accepted(s,'avg.proposal.visual-bible')).toBeUndefined()
  },30_000)
  it('retains malformed raw bytes and known one-call usage without adopting or replaying after reopen',async()=>{
    openEngineeringFence();const s=await avgV5RegisteredProposalsFixture({malformed:true});await adoptAvgV5Sources(s);await runProductProductionUntilBlockedV1(s)
    expect(s.calls).toHaveLength(1);expect(await avgV5Accepted(s,'avg.proposal.visual-bible')).toBeUndefined()
    expect(await avgV5Accepted(s,'avg.media.visual-bible')).toBeUndefined()
    const runs=await db.agentRuns.where('productBuildId').equals(s.buildId).toArray(),role=runs.find(r=>r.parentRelation==='task:avg.visual.propose.direction')!
    const {events}=await readAgentRunV1(s.scope,role.id!);expect(events.some(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response')).toBe(true)
    const ledger=JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson);expect(ledger.tasks['avg.visual.propose.direction']).toMatchObject({status:'failed',usage:{modelCalls:1,mediaCalls:0,costUsd:null}})
    expect(ledger.attempts.find((a:{taskKey:string})=>a.taskKey==='avg.visual.propose.direction').usageKnown).toBe(true)
    db.close();await db.open();await runProductProductionSchedulerCycleV1(s);expect(s.calls).toHaveLength(1)
  },30_000)
  it('retains an actual response but blocks admission when the reference license changes during HTTP',async()=>{
    openEngineeringFence()
    const s=await avgV5RegisteredProposalsFixture({onResponse:async()=>{
      const ref=(await db.avgDraftMedia.toArray())[0]
      await db.avgDraftMedia.update(ref.id!,{assetJson:JSON.stringify({...JSON.parse(ref.assetJson),license:'Changed while the model was answering'})})
    }})
    await adoptAvgV5Sources(s);await runProductProductionUntilBlockedV1(s)
    expect(s.calls).toHaveLength(1);expect(await avgV5Accepted(s,'avg.proposal.visual-bible')).toBeUndefined()
    const role=(await db.agentRuns.where('productBuildId').equals(s.buildId).toArray()).find(r=>r.parentRelation==='task:avg.visual.propose.direction')!
    const {events}=await readAgentRunV1(s.scope,role.id!)
    expect(events.some(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response')).toBe(true)
    expect(JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.visual.propose.direction'].usage).toMatchObject({modelCalls:1,mediaCalls:0,costUsd:null})
    db.close();await db.open();await runProductProductionSchedulerCycleV1(s);expect(s.calls).toHaveLength(1)
  },30_000)
  it('does not use a received direction route to dispatch pending subjects after the model configuration changes',async()=>{
    openEngineeringFence();const s=await avgV5RegisteredProposalsFixture();await adoptAvgV5Sources(s)
    await cycleAvgV5Until(s,'avg.proposal.visual-bible');await adoptAvgV5Artifact(s,'avg.media.visual-bible',s.author.visualBible)
    useAIConfigStore.getState().setConfig({...useAIConfigStore.getState().config,baseUrl:'https://changed-v5-proposal.fixture.invalid/v1'})
    await runProductProductionUntilBlockedV1(s)
    expect(s.calls).toHaveLength(1)
    for(const t of s.plan.tasks.filter(t=>t.kind==='avg-v5-subject-visual-proposal'))expect(await avgV5Accepted(s,t.outputArtifactKeys[0])).toBeUndefined()
  },30_000)
  it('refuses invented generated-source metadata even when the same imported asset key and real bytes exist',async()=>{
    openEngineeringFence();const s=await avgV5RegisteredProposalsFixture({missingGeneratedProof:true});await adoptAvgV5Sources(s)
    expect(await db.avgDraftMedia.where('workId').equals(s.scope.workId).count()).toBe(2)
    await runProductProductionUntilBlockedV1(s);expect(s.calls).toHaveLength(0);expect(await avgV5Accepted(s,'avg.proposal.visual-bible')).toBeUndefined()
  },30_000)
  it.each(['context','route','old-skill'] as const)('rejects caller-substituted %s against the actual frozen child claim before HTTP',async mode=>{
    openEngineeringFence();const s=await avgV5RegisteredProposalsFixture();await adoptAvgV5Sources(s)
    const executor:typeof s.executor=input=>s.executor(mode==='context'?{...input,contextText:input.contextText+'\nUnregistered instructions'}
      :mode==='route'?{...input,capabilityBindings:input.capabilityBindings.map(b=>({...b,bindingHash:'e'.repeat(64)}))}
        :{...input,task:{...input.task,skillId:'avg.visual-bible.v1'}})
    await runProductProductionUntilBlockedV1({...s,executor})
    expect(s.calls).toHaveLength(0);expect(await avgV5Accepted(s,'avg.proposal.visual-bible')).toBeUndefined()
    expect(JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.visual.propose.direction'].usage).toMatchObject({modelCalls:0,mediaCalls:0,costUsd:0})
  },30_000)
})
