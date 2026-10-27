/** Real isolated deterministic Run, no model or product adoption. The frozen
 * projector must reproduce the original settlement without current DB rows. */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createAgentRunV1,appendAgentRunEventV1,verifyRecordedMemorySettlementV1 } from '../../src/lib/agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { createVerificationReceiptV1 } from '../../src/lib/agent/run/verification-receipt'
import { canonicalStringify,hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { buildMemorySettlementReceiptFromSnapshotV1,buildMemorySettlementReceiptFromFrozenLedgerV1,
  type FrozenMemorySettlementLedgerV1 } from '../../src/lib/memory/settlement-core'

describe('MEMORY-8 frozen original ledger identity uses the same settlement authority',()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{vi.restoreAllMocks();db.close()})
  async function fixture(){
    const {scope}=await seedCurrentWorkspace('冻结的原结算'),createdAt=Date.now()
    let snapshot=await createAgentRunV1({scope,now:createdAt,contract:{version:1,objective:'只读验证现有作品标题的稳定hash',workflowKind:'direct-generation',
      scope:{projectId:scope.projectId,worldGroupId:null},runtimeBindingHash:await hashCanonicalValue({purpose:'readonly-memory-fixture'}),
      permissions:{contextSourceKeys:[],writeTargets:[]},budget:{maxModelCalls:0,maxToolCalls:1,maxInputTokens:0,maxOutputTokens:0,maxAttemptsPerStep:1},
      acceptance:[{id:'readonly.hash',kind:'deterministic-check',required:true}],verificationPlan:[{id:'readonly.terminal',kind:'terminal',verifier:'memory-frozen-fixture-v1',criterionIds:['readonly.hash']}],
      failurePolicy:{onProtocolError:'fail',onVerificationFailure:'fail',onStaleInput:'pause-for-author'}}})
    const input=await recordAgentRunArtifactV1({scope,runId:snapshot.run.id,artifactKind:'source-snapshot',content:canonicalStringify({schema:'storyforge.memory-frozen-projection-fixture',version:1,purpose:'readonly-memory-fixture'})})
    snapshot=input.snapshot
    const append=async(type:'step.scheduled'|'step.started'|'step.succeeded'|'verification.started'|'verification.accepted',payload:unknown)=>{
      snapshot=await appendAgentRunEventV1({scope,runId:snapshot.run.id,type,payload,expectedLastSequence:snapshot.projection.lastSequence} as Parameters<typeof appendAgentRunEventV1>[0])
    }
    await append('step.scheduled',{stepId:'readonly'});await append('step.started',{stepId:'readonly',attempt:1})
    const work=(await db.works.get(scope.workId))!,world=(await db.worlds.get(scope.worldId))!,postStateHash=await hashCanonicalValue({title:work.title})
    await append('step.succeeded',{stepId:'readonly',attempt:1,outputHash:postStateHash});await append('verification.started',{verifierSetVersion:'memory-frozen-fixture-v1'})
    const receipt=await createVerificationReceiptV1({version:1,runId:snapshot.run.id,generation:1,contractHash:snapshot.run.contractHash,
      contextManifestHashes:[],candidateHashes:[],adoptionEventIds:[],postStateHash,verifierSetVersion:'memory-frozen-fixture-v1',acceptedAt:Date.now(),
      zeroModelCommit:{contractJson:snapshot.run.contractJson,inputArtifactHashes:[input.artifact.contentHash]},criteria:[{id:'readonly.hash',status:'passed',evidenceRefs:['input:'+input.artifact.contentHash]}]})
    snapshot=(await recordAgentRunArtifactV1({scope,runId:snapshot.run.id,artifactKind:'source-snapshot',content:canonicalStringify({schema:'storyforge.memory-frozen-verification-fixture',version:1,receipt}),expectedLastSequence:snapshot.projection.lastSequence})).snapshot
    await append('verification.accepted',{receiptHash:receipt.receiptHash})
    const settlement=await verifyRecordedMemorySettlementV1({scope,snapshot})
    const frozen:FrozenMemorySettlementLedgerV1={run:{id:snapshot.run.id,createdAt:snapshot.run.createdAt,contractHash:snapshot.run.contractHash},contract:snapshot.contract,events:snapshot.events,projection:snapshot.projection}
    return {scope,snapshot,settlement,input:{snapshot:frozen,identity:{worldCode:world.code,workCode:work.code},workspaceDirty:settlement.event.payload.workspaceDirty,evaluatedAt:settlement.event.createdAt}}
  }
  it('reproduces original receipt fields, artifact ids and canonical bytes, including the mandatory terminal settlement',async()=>{
    const f=await fixture(),live=await buildMemorySettlementReceiptFromSnapshotV1({...f.input,snapshot:f.snapshot,scope:f.scope})
    const frozen=await buildMemorySettlementReceiptFromFrozenLedgerV1(f.input)
    expect(frozen).toEqual(live);expect(canonicalStringify(frozen)).toBe(canonicalStringify(f.settlement.receipt))
    expect(frozen.state).toBe('settled');expect(frozen.artifactRefs.length).toBeGreaterThan(0)
    expect(f.snapshot.events.at(-1)?.type).toBe('memory.settlement.recorded')
  })
  it('does not consult current World/Work rows or reopen the database when projecting a frozen receipt',async()=>{
    const f=await fixture(),workRead=vi.spyOn(db.works,'get'),worldRead=vi.spyOn(db.worlds,'get')
    db.close()
    expect(await buildMemorySettlementReceiptFromFrozenLedgerV1(f.input)).toEqual(f.settlement.receipt)
    expect(workRead).not.toHaveBeenCalled();expect(worldRead).not.toHaveBeenCalled();expect(db.isOpen()).toBe(false)
  })
  it('fixes all historical input before its first asynchronous hash instead of mixing a later identity or ledger',async()=>{
    const f=await fixture(),input=structuredClone(f.input),pending=buildMemorySettlementReceiptFromFrozenLedgerV1(input)
    input.identity.workCode='later-work';input.snapshot.run.createdAt+=1;input.snapshot.events.length=0
    expect(await pending).toEqual(f.settlement.receipt)
  })
  it('keeps the same registry checks for frozen data rather than granting unregistered context or writes',async()=>{
    const f=await fixture(),bad=structuredClone(f.input)
    bad.snapshot.contract.permissions.contextSourceKeys=['not-a-registered-source']
    await expect(buildMemorySettlementReceiptFromFrozenLedgerV1(bad)).rejects.toThrow('未登记 Context source')
    const badWrite=structuredClone(f.input)
    badWrite.snapshot.contract.permissions.writeTargets=[{table:'chapters',fields:['unregistered-field'],mode:'author-confirmed'}]
    await expect(buildMemorySettlementReceiptFromFrozenLedgerV1(badWrite)).rejects.toThrow('存在未登记字段')
    expect((await buildMemorySettlementReceiptFromFrozenLedgerV1(f.input)).receiptHash).toBe(f.settlement.receipt.receiptHash)
  })
})
