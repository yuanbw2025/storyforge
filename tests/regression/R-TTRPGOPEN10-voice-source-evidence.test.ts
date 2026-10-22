/** Actual isolated source/Run/backup commands with synthetic PCM. These prove
 * historical integrity only, never listening, E16 adoption or a real model. */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupVoiceCandidateFixtureV1 } from '../helpers/open-voice-candidate'
import { prepareTtrpgOpenVoiceCandidateV1,readTtrpgOpenVoiceCandidateV1,freezeTtrpgOpenVoiceSourceEvidenceV1,readTtrpgOpenAudioDeskV1 } from '../../src/lib/ttrpg/open-audio-service'
import { readTtrpgOpenVoiceSourceEvidenceForKernelV1 } from '../../src/lib/ttrpg/open-voice-source-evidence'
import { readTtrpgOpenVoiceAuditionBasisForKernelV1 } from '../../src/lib/ttrpg/open-voice-candidate'
import { importProductRuntimeMediaAssetV1 } from '../../src/lib/product/runtime-media-library'
import { deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as physical from '../../src/lib/ttrpg/open-voice-result'

describe('R-TTRPGOPEN10 independent original voice source capsule',{timeout:120000},()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  async function fixture(valid=true){const f=await setupVoiceCandidateFixtureV1(valid),{candidate}=await prepareTtrpgOpenVoiceCandidateV1(f.review)
    return {...f,candidate,preserve:{...f.input,candidateHash:candidate.candidateHash,decision:'freeze-this-original-voice-source-evidence' as const}}}
  async function locator(f:Awaited<ReturnType<typeof fixture>>,evidenceArtifactHash:string){const row=(await readTtrpgOpenVoiceCandidateV1(f.input))!
    const state=await readProductRuntimeState(f.owner.sessionId),runtime=parseTtrpgRuntimeStateV2(state.ttrpg)!
    return {projectId:f.owner.scope.projectId,evidenceArtifactHash,candidateHash:row.candidate.candidateHash,requestKey:f.input.requestKey,sessionKey:runtime.sessionKey,runtimeSourceHash:(await db.productRuntimeSessions.get(f.owner.sessionId))!.runtimeSourceHash}}
  it('records one separate no-step capsule without changing the raw candidate, dispatch, quota, media or runtime',async()=>{
    const f=await fixture(),before=await readProductRuntimeState(f.owner.sessionId),bodyBefore=canonicalStringify(f.candidate),scan=vi.spyOn(physical,'verifyTtrpgOpenVoiceRawResultForKernelV1')
    const eventCount=await db.agentRunEvents.count(),artifactCount=await db.agentRunArtifacts.count(),checkpointCount=await db.agentRunCheckpoints.count()
    const saved=await freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve)
    expect(saved).toMatchObject({candidateHash:f.candidate.candidateHash,archiveOnly:true,generationAllowed:false,adoptionAllowed:false,humanListening:'unproven',physicalAudioRechecked:false})
    expect(scan).toHaveBeenCalledTimes(1)
    expect(await db.agentRunEvents.count()).toBe(eventCount+1);expect(await db.agentRunArtifacts.count()).toBe(artifactCount+1);expect(await db.agentRunCheckpoints.count()).toBe(checkpointCount)
    expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before);expect(await db.productMediaAssets.count()).toBe(0)
    expect((await readTtrpgOpenVoiceCandidateV1(f.input))!.complete).toBe(true);expect(canonicalStringify((await readTtrpgOpenVoiceCandidateV1(f.input))!.candidate)).toBe(bodyBefore)
    const again=await freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve);expect(again.evidenceArtifactHash).toBe(saved.evidenceArtifactHash)
    expect(await db.agentRunArtifacts.count()).toBe(artifactCount+1);expect(await db.agentRunEvents.count()).toBe(eventCount+1)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('serializes concurrent preservation by original ledger CAS and keeps a single immutable prefix',async()=>{
    const f=await fixture(),both=await Promise.all([freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve),freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve)])
    expect(both[0].evidenceArtifactHash).toBe(both[1].evidenceArtifactHash)
    const sources=(await db.agentRunEvents.where('runId').equals(f.prepared.runId).toArray()).filter(e=>e.type==='evidence.artifact.recorded'&&JSON.parse(e.payloadJson).stepId==null)
    expect(sources).toHaveLength(1);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('recovers the same preserved source after an actual committed artifact return is lost',async()=>{
    const f=await fixture(),actual=artifacts.recordAgentRunArtifactV1;let lost=false
    vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockImplementation(async input=>{const value=await actual(input)
      if(!lost&&input.stepId==null&&input.artifactKind==='source-snapshot'&&JSON.parse(input.content).schema==='storyforge.ttrpg-open-voice-source-evidence'){lost=true;throw Error('committed-source-return-lost')}return value})
    await expect(freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve)).rejects.toThrow('committed-source-return-lost')
    const saved=await freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve),again=await freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve)
    expect(saved.evidenceArtifactHash).toBe(again.evidenceArtifactHash);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('does not treat a changed historical parent timestamp as the saved original prefix, while preserving the archived body',async()=>{
    const f=await fixture(),saved=await freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve),count=await db.agentRunArtifacts.count()
    const parent=(await db.agentRuns.get(f.prepared.runId))!.parentRunId!,event=(await db.agentRunEvents.where('runId').equals(parent).toArray()).find(e=>e.type==='step.started')!
    await db.agentRunEvents.update(event.id!,{createdAt:event.createdAt-1})
    // A timestamp does not change the checkpoint projection or original audio;
    // establish that this is specifically the archived-prefix comparison.
    expect((await readTtrpgOpenVoiceCandidateV1(f.input))!.candidate.candidateHash).toBe(f.candidate.candidateHash)
    await expect(freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve)).rejects.toThrow(/父子事件前缀/)
    expect(await db.agentRunArtifacts.count()).toBe(count)
    await db.agentRunEvents.update(event.id!,{createdAt:event.createdAt})
    expect((await freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve)).evidenceArtifactHash).toBe(saved.evidenceArtifactHash)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('refuses blocked output, another candidate or a deleted original checkpoint before recording a source claim',async()=>{
    const f=await fixture(false),count=await db.agentRunArtifacts.count()
    await expect(freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve)).rejects.toThrow()
    await expect(freezeTtrpgOpenVoiceSourceEvidenceV1({...f.preserve,candidateHash:'0'.repeat(64)})).rejects.toThrow()
    await db.agentRunCheckpoints.where('runId').equals(f.prepared.runId).delete()
    await expect(freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve)).rejects.toThrow()
    expect(await db.agentRunArtifacts.count()).toBe(count);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('keeps a hash-and-lineage archive readable after both Runs are deleted and through full backup; the media is still unadopted',async()=>{
    const f=await fixture(),saved=await freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve),input=await locator(f,saved.evidenceArtifactHash)
    const ready=await readTtrpgOpenVoiceAuditionBasisForKernelV1({...f.input,candidateHash:f.candidate.candidateHash})
    const asset=await importProductRuntimeMediaAssetV1({scope:f.owner.scope,productRuntimeSessionId:f.owner.sessionId,assetKey:'voice.capsule.fixture',kind:'voice',name:'fixture; not adopted',blob:new Blob([ready.data],{type:'audio/wav'}),source:'synthetic capsule lifecycle fixture',license:'fixture only; no listening or adoption',durationMs:saved.audio.durationMs,exactArtifactRefs:saved.artifactRefs})
    const parent=(await db.agentRuns.get(f.prepared.runId))!.parentRunId!
    await deleteAgentRunV1(f.owner.scope,f.prepared.runId);await deleteAgentRunV1(f.owner.scope,parent)
    await artifacts.markAndSweepAgentRunArtifactsV1(f.owner.scope.projectId)
    await expect(artifacts.pruneAgentRunArtifactsExplicitlyV1({projectId:f.owner.scope.projectId,targets:saved.artifactRefs})).rejects.toThrow(/已确认产物/)
    const archived=await readTtrpgOpenVoiceSourceEvidenceForKernelV1(input)
    const {evidenceArtifactHash:_hash,...savedArchive}=saved
    expect(archived).toEqual(savedArchive)
    expect(archived).toMatchObject({archiveOnly:true,generationAllowed:false,adoptionAllowed:false,humanListening:'unproven',physicalAudioRechecked:false})
    const copy=await importProjectJSON(await exportProjectJSON(f.owner.scope.projectId)),cloned=await db.productMediaAssets.where('projectId').equals(copy).first()
    expect(cloned!.exactArtifactRefsJson).toBe(asset.exactArtifactRefsJson)
    expect(await readTtrpgOpenVoiceSourceEvidenceForKernelV1({...input,projectId:copy})).toEqual(archived)
    expect((await readTtrpgOpenAudioDeskV1(f.owner)).tracks).toHaveLength(0)
    expect((await readProductRuntimeState(f.owner.sessionId)).ttrpg!.openRun!.audioReceipts??[]).toHaveLength(0)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each(['roots','checkpoint','generation','extra'] as const)('rejects rehashed corrupted %s capsules as history, without invoking inference',async kind=>{
    const f=await fixture(),saved=await freezeTtrpgOpenVoiceSourceEvidenceV1(f.preserve),input=await locator(f,saved.evidenceArtifactHash)
    const content=await artifacts.readAgentRunArtifactExactV1({projectId:f.owner.scope.projectId,artifactKind:'source-snapshot',contentHash:saved.evidenceArtifactHash}),body=JSON.parse(content)
    if(kind==='roots')body.artifactRefs=[]
    if(kind==='checkpoint')body.checkpoint.hashBody.projectionHash='0'.repeat(64)
    if(kind==='generation')body.execution.events[1].generation=2
    if(kind==='extra')body.adoptionAllowed=true
    const record=await artifacts.recordAgentRunArtifactV1({scope:f.owner.scope,productRuntimeSessionId:f.owner.sessionId,runId:f.prepared.runId,artifactKind:'source-snapshot',content:canonicalStringify(body)})
    await expect(readTtrpgOpenVoiceSourceEvidenceForKernelV1({...input,evidenceArtifactHash:record.artifact.contentHash})).rejects.toThrow()
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
})
