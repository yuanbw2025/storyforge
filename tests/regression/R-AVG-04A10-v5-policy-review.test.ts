import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { avgV5MediaReviewFixture,avgV5ReviewReport } from '../helpers/avg-v5-media-review-fixture'
import { avgV5Accepted,confirmAvgV5PendingCandidate } from '../helpers/avg-v5-registered-proposals-fixture'
import { compileAvgVisualPlanningProposalV2,freezeAvgVisualPlanningScopeV2 } from '../../src/lib/avg/media-source-v2'
import { parseAvgAuthorVisualReviewV2,assertAvgReferencePolicyReviewV2,assertAvgVisualReviewRevisionV2 } from '../../src/lib/avg/visual-review-contract-v2'
import { parseAvgAuthorVisualReviewV1 } from '../../src/lib/avg/visual-review'
import { assertAvgVisualReviewSelectableV2 } from '../../src/lib/avg/visual-review-v2'
import { stageAvgVisualReviewV2,stageAvgMediaChoiceV5 } from '../../src/lib/avg/visual-review-service-v5'
import { parseAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { readAvgImageConsumptionDefinitionV5 } from '../../src/lib/avg/image-consumption-v5'
import { readAvgChosenMediaSourceV5 } from '../../src/lib/avg/media-choice-validation-v5'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { parseAvgRawImagePayloadV2 } from '../../src/lib/avg/media-raw-contract-v2'
import { stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering network forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})
async function pureRequirement(){
  const f=avgVersionedPlanningFixture(),scope=await freezeAvgVisualPlanningScopeV2(f.versioned,f.source)
  const result=await compileAvgVisualPlanningProposalV2({scope,source:f.source,visualBible:f.visualBible,mediaBriefs:f.mediaBriefs})
  return result.batch.requirements.find(r=>r.references.length===2)!
}
describe('AVG V5 explicit reference policy review and original author choice',()=>{
  it('keeps new review grammar explicit and legacy codecs strict',async()=>{
    const r=await pureRequirement(),report=await avgV5ReviewReport(r,'c'.repeat(64),'pass')
    expect(parseAvgAuthorVisualReviewV2(JSON.stringify(report))).toEqual(report)
    expect(()=>parseAvgProfessionalArtifactV1(report)).toThrow();expect(()=>parseAvgAuthorVisualReviewV1(report)).toThrow()
    for(const value of [{...report,version:1},{...report,audioEvidence:{}},{...report,referencePolicy:undefined},
      {...report,referencePolicy:{...report.referencePolicy,checks:[...report.referencePolicy.checks,report.referencePolicy.checks[0]]}}]){
      expect(()=>parseAvgAuthorVisualReviewV2(value)).toThrow()
    }
    await expect(assertAvgVisualReviewSelectableV2(report,r,'c'.repeat(64))).resolves.toEqual(report)
  })
  it.each(['requirement','policy','content','order','missing','unobserved-pass','failure-unowned'] as const)('rejects %s policy scope without treating transmission as compliance',async mode=>{
    const r=await pureRequirement(),report=await avgV5ReviewReport(r,'c'.repeat(64),'pass')
    if(mode==='requirement')report.referencePolicy.requirementHash='a'.repeat(64)
    if(mode==='policy')report.referencePolicy.checks[0].policyHash='b'.repeat(64)
    if(mode==='content')report.referencePolicy.checks[0].contentHash='f'.repeat(64)
    if(mode==='order')report.referencePolicy.checks.reverse()
    if(mode==='missing')report.referencePolicy.checks.pop()
    if(mode==='unobserved-pass')report.visualEvidence.referenceHashes=[]
    if(mode==='failure-unowned')report.referencePolicy.checks[0].excludedFeatures='fail'
    await expect(assertAvgReferencePolicyReviewV2(report,r)).rejects.toThrow()
  })
  it.each(['unknown','fail'] as const)('can retain %s author evidence but refuses selection',async mode=>{
    const r=await pureRequirement(),report=await avgV5ReviewReport(r,'c'.repeat(64),mode)
    expect(parseAvgAuthorVisualReviewV2(report).version).toBe(2)
    await expect(assertAvgReferencePolicyReviewV2(report,r)).resolves.toBeUndefined()
    await expect(assertAvgVisualReviewSelectableV2(report,r,'c'.repeat(64))).rejects.toThrow()
  })
  it('requires new visual and per-reference reasons when resolving unknown or blocking answers',async()=>{
    const r=await pureRequirement(),old=await avgV5ReviewReport(r,'c'.repeat(64),'unknown'),next=await avgV5ReviewReport(r,'c'.repeat(64),'pass')
    const noReferenceReasons=structuredClone(next);noReferenceReasons.referencePolicy.checks.forEach((c,i)=>{c.note=old.referencePolicy.checks[i].note})
    expect(()=>assertAvgVisualReviewRevisionV2(old,noReferenceReasons)).toThrow()
    const noVisualReason=structuredClone(next);noVisualReason.visualEvidence.note=old.visualEvidence.note
    expect(()=>assertAvgVisualReviewRevisionV2(old,noVisualReason)).toThrow()
    expect(()=>assertAvgVisualReviewRevisionV2(old,next)).not.toThrow()
    const partial=structuredClone(old);partial.referencePolicy.checks[0].permittedFeatures='pass'
    expect(()=>assertAvgVisualReviewRevisionV2(old,partial)).toThrow()
  })
  it('stages/adopts actual unknown and blocking reports, then requires explicit passing review and a separate exact choice',async()=>{
    const started=performance.now(),progress=(phase:string)=>console.info('[avg-v5-review-phase]',phase,Math.round(performance.now()-started))
    const s=await avgV5MediaReviewFixture(progress),raw=s.rows.find(r=>r.mediaKind==='background')!,r=s.compiled.definition.mediaBatch.requirements.find(r=>raw.artifactKey===`avg.media.raw.${r.requirementKey}`)!
    useAIConfigStore.getState().setConfig({...useAIConfigStore.getState().config,apiKey:''})
    const base={scope:s.scope,productionId:s.productionId,requirementKey:r.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,
      declaration:'明确模拟作者工程审查；只证明候选/采用/选用边界，不签真实艺术或商业质量'}
    const {referencePolicy:_policy,...oldFields}=await avgV5ReviewReport(r,raw.contentHash,'pass'),legacy={...oldFields,version:1 as const}
    expect(parseAvgProfessionalArtifactV1(legacy).version).toBe(1)
    const current=(await db.productBuilds.get(s.buildId))!
    await expect(stageAvgAuthorArtifactV1({scope:s.scope,buildId:s.buildId,expectedBuildRevision:current.stateRevision,controlEpoch:current.controlEpoch,
      taskKey:`avg.author.visual-review.${r.requirementKey}`,artifactKey:`avg.review.visual.${r.requirementKey}`,kind:'quality-report',payload:legacy,
      declaration:base.declaration})).rejects.toThrow(/版本|字段/)
    const unknown=await stageAvgVisualReviewV2({...base,report:await avgV5ReviewReport(r,raw.contentHash,'unknown')})
    expect(unknown.status).toBe('pending');expect(await avgV5Accepted(s,unknown.artifactKey)).toBeUndefined()
    await expect(stageAvgMediaChoiceV5(base)).rejects.toThrow()
    await confirmAvgV5PendingCandidate(s,unknown)
    await expect(stageAvgMediaChoiceV5(base)).rejects.toThrow(/未观察|blocking|参考/)
    const blocked=await stageAvgVisualReviewV2({...base,report:await avgV5ReviewReport(r,raw.contentHash,'fail')})
    await confirmAvgV5PendingCandidate(s,blocked)
    await expect(stageAvgMediaChoiceV5(base)).rejects.toThrow(/blocking|参考/)
    const passed=await stageAvgVisualReviewV2({...base,report:await avgV5ReviewReport(r,raw.contentHash,'pass')})
    expect((await avgV5Accepted(s,blocked.artifactKey))!.version).toBe(blocked.version)
    await confirmAvgV5PendingCandidate(s,passed)
    const choice=await stageAvgMediaChoiceV5(base)
    expect(choice.status).toBe('pending');expect(await avgV5Accepted(s,choice.artifactKey)).toBeUndefined()
    const original=await parseAvgRawImagePayloadV2(raw.payloadJson)
    expect(JSON.parse(choice.payloadJson)).toMatchObject({version:1,raw:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
    expect(original.version).toBe(2)
    await confirmAvgV5PendingCandidate(s,choice)
    const accepted=(await avgV5Accepted(s,choice.artifactKey))!,payload=JSON.parse(accepted.payloadJson)
    const selected=await readAvgChosenMediaSourceV5({scope:s.scope,buildId:s.buildId,brief:s.brief,choice:payload})
    expect(selected.validation.rawReceiptHash).toBe(raw.producerReceiptHash)
    const metadata=JSON.parse(accepted.metadataJson)
    expect(metadata.candidate.version).toBe(4)
    expect(metadata.candidate.inputs).toContainEqual({artifactKey:passed.artifactKey,version:passed.version,contentHash:passed.contentHash})
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
    expect((await db.productBuilds.get(s.buildId))!.packageHash).toBe('')
    const backup=await exportProjectJSON(s.scope.projectId),copyProjectId=await importProjectJSON(backup),copyBuild=(await db.productBuilds.where('projectId').equals(copyProjectId).first())!
    const copyScope={projectId:copyProjectId,workId:copyBuild.workId!,worldId:copyBuild.worldId!}
    const copyReview=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([copyBuild.id!,passed.artifactKey]).filter(row=>row.status==='accepted').first())!
    expect(parseAvgAuthorVisualReviewV2(copyReview.payloadJson)).toEqual(parseAvgAuthorVisualReviewV2(passed.payloadJson))
    expect(copyReview.workId).toBe(copyScope.workId);expect(copyReview.workId).not.toBe(s.scope.workId)
    const receipt=JSON.parse(copyReview.metadataJson),command=await db.productProductionCommands.where('[productionId+commandId]').equals([copyBuild.productionId,receipt.commandId]).first()
    expect(command).toMatchObject({status:'succeeded',type:'adopt-avg-artifact',workId:copyScope.workId})
    expect(JSON.parse(command!.resultJson)).toMatchObject({authorReceiptHash:receipt.receiptHash,artifactKey:copyReview.artifactKey,version:copyReview.version,contentHash:copyReview.contentHash})
    await expect(readAvgImageConsumptionDefinitionV5({scope:copyScope,buildId:copyBuild.id!,brief:s.brief})).rejects.toThrow()
    await deleteWork(copyScope.workId)
    expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...backup,exportedAt:0})
    expect(s.imageCalls).toHaveLength(5)
  },60_000)
  it('rechecks actual consent at adoption and preserves the pending report when a reference changes',async()=>{
    const s=await avgV5MediaReviewFixture(),raw=s.rows.find(r=>r.mediaKind==='background')!,r=s.compiled.definition.mediaBatch.requirements.find(r=>raw.artifactKey===`avg.media.raw.${r.requirementKey}`)!
    const candidate=await stageAvgVisualReviewV2({scope:s.scope,productionId:s.productionId,requirementKey:r.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,
      report:await avgV5ReviewReport(r,raw.contentHash,'pass'),declaration:'仅工程作者候选；验证采用时再次核对准确参考许可'})
    const reference=(await db.avgDraftMedia.where('workId').equals(s.scope.workId).first())!
    await db.avgDraftMedia.update(reference.id!,{assetJson:JSON.stringify({...JSON.parse(reference.assetJson),license:'Changed consent after candidate staging'})})
    await expect(confirmAvgV5PendingCandidate(s,candidate)).rejects.toThrow()
    expect(await avgV5Accepted(s,candidate.artifactKey)).toBeUndefined()
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('pending')
    expect(s.imageCalls).toHaveLength(5);expect(s.calls).toHaveLength(4)
  },60_000)
  it('adopts all five original families only after their exact policy reviews, including pose/expression identity and icon/detail targets',async()=>{
    const s=await avgV5MediaReviewFixture()
    useAIConfigStore.getState().setConfig({...useAIConfigStore.getState().config,apiKey:''})
    const slots=[]
    for(const raw of s.rows){
      const r=s.compiled.definition.mediaBatch.requirements.find(r=>raw.artifactKey===`avg.media.raw.${r.requirementKey}`)!
      const base={scope:s.scope,productionId:s.productionId,requirementKey:r.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,
        declaration:'模拟作者逐项复核五图；只签工程流程，解码观察为受控替身，不签实际美术'}
      const review=await stageAvgVisualReviewV2({...base,report:await avgV5ReviewReport(r,raw.contentHash,'pass')})
      await confirmAvgV5PendingCandidate(s,review)
      const choice=await stageAvgMediaChoiceV5(base);await confirmAvgV5PendingCandidate(s,choice)
      const current=(await avgV5Accepted(s,choice.artifactKey))!,payload=JSON.parse(current.payloadJson)
      const proved=await readAvgChosenMediaSourceV5({scope:s.scope,buildId:s.buildId,brief:s.brief,choice:payload})
      expect(proved.requirement).toEqual(r);expect(proved.validation.rawReceiptHash).toBe(raw.producerReceiptHash)
      expect(JSON.parse(current.metadataJson).candidate.inputs).toContainEqual({artifactKey:review.artifactKey,version:review.version,contentHash:review.contentHash})
      slots.push(`${r.consumer.domain}:${r.consumer.slot}:${r.family.variantKey}`)
    }
    expect(slots.sort()).toEqual(['evidence:detail:detail','inventory:icon:icon','stage:actor:expression','stage:actor:pose','stage:background:background'])
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
    expect((await db.productBuilds.get(s.buildId))!.packageHash).toBe('')
  },60_000)
})
