import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { prepareAvgCharacterFamilyProposalV1,saveAvgCharacterFamilyBatchDraftV1 } from '../../src/lib/avg/character-family-service'
import { setAvgCharacterFamilyReservedBackdropV1,hasAvgCharacterFamilyReservedBackdropV1,buildAvgCharacterFamilyForegroundProcessingPlanV1 } from '../../src/lib/avg/character-family-foreground'
import { composeAvgCharacterFamilyRequirementsV1,parseAvgCharacterFamilyPlanV1 } from '../../src/lib/avg/character-family-contract'
import { validateAvgVisualProductionBatchSourceV1 } from '../../src/lib/avg/media-source'
import { prepareAvgAssemblyBriefV1,saveAvgImageProcessingDraftV1 } from '../../src/lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import { AVG_RESERVED_MAGENTA_INVARIANT_V1,AVG_RESERVED_MAGENTA_FORBIDDEN_V1 } from '../../src/lib/avg/image-foreground-contract'

import { avgFamilyForegroundFixture as fixture,AVG_FAMILY_FOREGROUND_DECLARATION_FIXTURE as declaration } from '../helpers/avg-family-foreground-fixture'

const portable=(value:Awaited<ReturnType<typeof exportProjectJSON>>)=>({...value,exportedAt:0})
beforeEach(async()=>{await db.delete();await db.open();vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1')
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Family draft preparation cannot dispatch')}))
 useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://family.fixture.invalid/v1',apiKey:'test-only-no-network',model:'agnes-2.5-flash'})})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})

const approval=(proposalHash:string)=>({proposalHash,providerInputAllowed:true,derivativeUseAllowed:true,declaration:'仅批准准确家族提案的工程基准外发与衍生，非艺术或商业验收'})

describe('AVG author family foreground declarations and atomic recipe proposal',()=>{
 it('prepares every exact variant without editing the original family or manufacturing baseline approval',async()=>{
  const s=await fixture(),before=structuredClone(s.plan),reserved=setAvgCharacterFamilyReservedBackdropV1(s.plan,true)
  expect(s.plan).toEqual(before);expect(hasAvgCharacterFamilyReservedBackdropV1(reserved)).toBe(true)
  expect(setAvgCharacterFamilyReservedBackdropV1(reserved,true)).toEqual(reserved)
  expect(setAvgCharacterFamilyReservedBackdropV1(reserved,false)).toEqual(s.plan)
  expect(reserved.baseline).toEqual(s.plan.baseline)
  const processing=buildAvgCharacterFamilyForegroundProcessingPlanV1(reserved,declaration),requirements=composeAvgCharacterFamilyRequirementsV1(reserved)
  expect(processing.entries.map(e=>e.requirementKey)).toEqual(requirements.map(r=>r.requirementKey))
  expect(processing.entries).toHaveLength(2)
  for(const entry of processing.entries)expect(entry.recipe).toMatchObject({version:2,width:576,height:768,background:null,declaration,foreground:{declaration}})
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
 it('rejects missing declarations, an opaque family, an empty processing note and oversized output before any save',async()=>{
  const s=await fixture(),reserved=setAvgCharacterFamilyReservedBackdropV1(s.plan,true),before=portable(await exportProjectJSON(s.owner.scope.projectId))
  expect(()=>buildAvgCharacterFamilyForegroundProcessingPlanV1(s.plan,declaration)).toThrow(/冻结/)
  expect(()=>setAvgCharacterFamilyReservedBackdropV1({...s.plan,alpha:'not-required'},true)).toThrow(/透明/)
  expect(()=>buildAvgCharacterFamilyForegroundProcessingPlanV1(reserved,'')).toThrow()
  expect(()=>buildAvgCharacterFamilyForegroundProcessingPlanV1({...reserved,width:8192},declaration)).toThrow()
  expect(portable(await exportProjectJSON(s.owner.scope.projectId))).toEqual(before);expect(fetch).not.toHaveBeenCalled()
 })
 it('saves an explicitly approved family and all local recipes in the same ordinary Work draft revision, then freezes the actual V2 Brief',async()=>{
  const s=await fixture(),reserved=setAvgCharacterFamilyReservedBackdropV1(s.plan,true)
  const proposal=await prepareAvgCharacterFamilyProposalV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,plan:reserved})
  const imageProcessing=buildAvgCharacterFamilyForegroundProcessingPlanV1(proposal.plan,declaration),blobCount=await db.mediaBlobObjects.count()
  const saved=await saveAvgCharacterFamilyBatchDraftV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,proposal,approval:approval(proposal.proposalHash),imageProcessing})
  expect(saved.revision).toBe(s.draft.revision+1)
  const workspace=parseAvgAuthorWorkspaceV1(saved.editorJson),batch=workspace.mediaBatch!
  expect(batch.characterFamily!.proposal).toEqual(proposal);expect(workspace.imageProcessing).toEqual(imageProcessing)
  await expect(validateAvgVisualProductionBatchSourceV1(batch,workspace)).resolves.toEqual(batch)
  for(const r of batch.requirements){expect(r.invariants).toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1);expect(r.forbiddenDepictions).toContain(AVG_RESERVED_MAGENTA_FORBIDDEN_V1);expect(r.references[0].contentHash).toBe(s.plan.baseline.contentHash)}
  const prepared=await prepareAvgAssemblyBriefV1({scope:s.owner.scope,expectedDraftRevision:saved.revision}),brief=parseProductProductionBriefV3(prepared.brief!.briefJson)
  expect(brief.avgAssembly!.version).toBe(2)
  if(brief.avgAssembly!.version!==2)throw new Error('Expected actual image assembly definition')
  expect(brief.avgAssembly.imageProcessing).toEqual(imageProcessing)
  expect(brief.productionBudget.maximumMediaCalls).toBe(2)
  expect(await db.mediaBlobObjects.count()).toBe(blobCount);expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
 it('cannot use a previous approval for a changed reservation or add processing to a family that never declared it',async()=>{
  const s=await fixture(),original=await prepareAvgCharacterFamilyProposalV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,plan:s.plan})
  const reserved=setAvgCharacterFamilyReservedBackdropV1(s.plan,true),next=await prepareAvgCharacterFamilyProposalV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,plan:reserved})
  const imageProcessing=buildAvgCharacterFamilyForegroundProcessingPlanV1(next.plan,declaration),before=portable(await exportProjectJSON(s.owner.scope.projectId))
  expect(next.proposalHash).not.toBe(original.proposalHash)
  await expect(saveAvgCharacterFamilyBatchDraftV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,proposal:next,approval:approval(original.proposalHash),imageProcessing})).rejects.toThrow(/授权/)
  await expect(saveAvgCharacterFamilyBatchDraftV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,proposal:original,approval:approval(original.proposalHash),imageProcessing})).rejects.toThrow(/冻结/)
  expect(portable(await exportProjectJSON(s.owner.scope.projectId))).toEqual(before);expect(fetch).not.toHaveBeenCalled()
 })
 it('rejects a foreign recipe or stale draft before mutation and supports explicitly clearing only the processing field',async()=>{
  const s=await fixture(),reserved=setAvgCharacterFamilyReservedBackdropV1(s.plan,true),proposal=await prepareAvgCharacterFamilyProposalV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,plan:reserved})
  const imageProcessing=buildAvgCharacterFamilyForegroundProcessingPlanV1(proposal.plan,declaration),before=portable(await exportProjectJSON(s.owner.scope.projectId))
  await expect(saveAvgCharacterFamilyBatchDraftV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,proposal,approval:approval(proposal.proposalHash),imageProcessing:{...imageProcessing,entries:[{...imageProcessing.entries[0],requirementKey:'foreign.recipe'}]}})).rejects.toThrow(/需求/)
  expect(portable(await exportProjectJSON(s.owner.scope.projectId))).toEqual(before)
  const saved=await saveAvgCharacterFamilyBatchDraftV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,proposal,approval:approval(proposal.proposalHash),imageProcessing})
  await expect(saveAvgCharacterFamilyBatchDraftV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,proposal,approval:approval(proposal.proposalHash),imageProcessing:null})).rejects.toThrow(/草稿已变化/)
  expect(await readAvgDraftV1(s.owner.scope)).toEqual(saved)
  const w=parseAvgAuthorWorkspaceV1(saved.editorJson),cleared=await saveAvgImageProcessingDraftV1({scope:s.owner.scope,expectedDraftRevision:saved.revision,plan:null})
  const after=parseAvgAuthorWorkspaceV1(cleared.editorJson)
  expect(after.imageProcessing).toBeUndefined();expect(after.mediaBatch!.characterFamily).toEqual(w.mediaBatch!.characterFamily)
  expect(parseAvgCharacterFamilyPlanV1(after.mediaBatch!.characterFamily!.proposal.plan)).toEqual(proposal.plan)
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
})
