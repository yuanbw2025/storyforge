/** Real original Run/checkpoint recovery; synthetic speech only. No transport
 * or generic state edit stands in for the explicit product action. */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {setupVoiceCandidateFixtureV1} from '../helpers/open-voice-candidate'
import * as api from '../../src/lib/ttrpg/open-audio-service'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import {appendAgentRunEventV1,readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {readProductRuntimeState} from '../../src/lib/product/runtime-core'
import {readTtrpgOpenVoiceExecutionControlsForKernelV1} from '../../src/lib/ttrpg/open-voice-execution'
import {exportProjectJSON,importProjectJSON} from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN10 original voice review recovery',{timeout:120000},()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  async function fixture(){const f=await setupVoiceCandidateFixtureV1(),{candidate}=await api.prepareTtrpgOpenVoiceCandidateV1(f.review)
    return {...f,candidate,owner:{scope:f.input.scope,productRuntimeSessionId:f.input.sessionId,runId:candidate.runId},resume:{...f.input,candidateHash:candidate.candidateHash,decision:'resume-this-original-voice-review-without-inference' as const}}}
  async function pause(f:Awaited<ReturnType<typeof fixture>>){const s=await readInstanceAgentRunV1(f.input.scope,f.candidate.runId)
    await appendAgentRunEventV1({...f.owner,type:'run.paused',payload:{reason:'本人暂停原音频审阅',recoverable:true},expectedLastSequence:s.projection.lastSequence})}
  it('restores the same pending review, creates a real inference barrier and permits the original personal terminal without regenerating',async()=>{
    const f=await fixture(),before=await readProductRuntimeState(f.input.sessionId);await pause(f)
    const restored=await api.resumeTtrpgOpenVoiceCandidateReviewV1(f.resume)
    expect(restored).toMatchObject({runId:f.candidate.runId,runState:'awaiting_confirmation',futureInferenceBlocked:true,generationAllowed:false,adoptionAllowed:false,qualityDeclared:false})
    const controls=await readTtrpgOpenVoiceExecutionControlsForKernelV1({...f.owner,sessionId:f.input.sessionId,inputArtifactHash:f.prepared.inputArtifactHash})
    expect(controls.controls.map(c=>c.payload.action)).toEqual(['stop-original-job'])
    expect(await readProductRuntimeState(f.input.sessionId)).toEqual(before);expect(await db.productMediaAssets.count()).toBe(0)
    const read=await api.readTtrpgOpenVoiceCandidateV1(f.input);expect(read?.candidate).toEqual(f.candidate)
    expect(await api.readTtrpgOpenVoiceCandidateReviewV1({...f.input,candidateHash:f.candidate.candidateHash})).toBeNull()
    const accepted=await api.acceptTtrpgOpenVoiceCandidateReviewV1({...f.input,candidateHash:f.candidate.candidateHash,decision:'accept-this-original-voice-candidate-for-review',listening:'self-reported-original-listening',judgment:'acceptable-to-me'})
    expect(accepted?.complete).toBe(true);expect(await readProductRuntimeState(f.input.sessionId)).toEqual(before)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each(['beginAgentRunRecoveryV1','completeAgentRunRecoveryV1'] as const)('recovers a real committed %s after its return is lost, preserving one original checkpoint and decision',async boundary=>{
    const f=await fixture();await pause(f)
    const actual=checkpoints[boundary]
    const spy=vi.spyOn(checkpoints,boundary).mockImplementation(async(input:never)=>{await actual(input);throw Error('actual-recovery-return-lost')})
    await expect(api.resumeTtrpgOpenVoiceCandidateReviewV1(f.resume)).rejects.toThrow('actual-recovery-return-lost');spy.mockRestore()
    await api.resumeTtrpgOpenVoiceCandidateReviewV1(f.resume)
    const state=await readInstanceAgentRunV1(f.input.scope,f.candidate.runId)
    expect(state.projection.state).toBe('awaiting_confirmation')
    expect(state.events.filter(e=>e.type==='recovery.started')).toHaveLength(1);expect(state.events.filter(e=>e.type==='recovery.completed')).toHaveLength(1)
    expect(state.events.some(e=>e.type==='confirmation.recorded')).toBe(false)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('keeps the exact existing stop control and idempotently rereads a recovered original without further events',async()=>{
    const f=await fixture(),s=await readInstanceAgentRunV1(f.input.scope,f.candidate.runId)
    const marker={schema:'storyforge.ttrpg-open-voice-control',version:1,action:'stop-original-job',jobKey:`ttrpg.voice.${f.candidate.runId}.${f.prepared.inputArtifactHash}`,inputArtifactHash:f.prepared.inputArtifactHash}
    await checkpoints.createAgentRunCheckpointV1({...f.owner,expectedLastSequence:s.projection.lastSequence,resumePayload:marker});await pause(f)
    await api.resumeTtrpgOpenVoiceCandidateReviewV1(f.resume)
    const before=await readInstanceAgentRunV1(f.input.scope,f.candidate.runId);await api.resumeTtrpgOpenVoiceCandidateReviewV1(f.resume)
    expect(await readInstanceAgentRunV1(f.input.scope,f.candidate.runId)).toEqual(before)
    const controls=await readTtrpgOpenVoiceExecutionControlsForKernelV1({...f.owner,sessionId:f.input.sessionId,inputArtifactHash:f.prepared.inputArtifactHash})
    expect(controls.controls).toHaveLength(1);expect(controls.controls[0].payload).toEqual(marker)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each(['failed','cancelled','missing-checkpoint'] as const)('retains %s evidence without resuming or writing another event',async boundary=>{
    const f=await fixture(),s=await readInstanceAgentRunV1(f.input.scope,f.candidate.runId)
    if(boundary==='missing-checkpoint')await db.agentRunCheckpoints.where('runId').equals(f.candidate.runId).delete()
    else if(boundary==='failed')await appendAgentRunEventV1({...f.owner,type:'run.failed',payload:{code:'original-voice-failed',retryable:false},expectedLastSequence:s.projection.lastSequence})
    else await appendAgentRunEventV1({...f.owner,type:'run.cancelled',payload:{reason:'original cancelled'},expectedLastSequence:s.projection.lastSequence})
    const before=await db.agentRunEvents.toArray();await expect(api.resumeTtrpgOpenVoiceCandidateReviewV1(f.resume)).rejects.toThrow()
    expect(await db.agentRunEvents.toArray()).toEqual(before);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('denies a different viewer and a full imported original even with matching text/candidate, preserving native pending state',async()=>{
    const f=await fixture();await pause(f)
    await expect(api.resumeTtrpgOpenVoiceCandidateReviewV1({...f.resume,viewerKey:'viewer.human'})).rejects.toThrow()
    const copy=await importProjectJSON(await exportProjectJSON(f.input.scope.projectId)),session=(await db.productRuntimeSessions.where('projectId').equals(copy).toArray())[0]
    const events=await db.agentRunEvents.toArray()
    await expect(api.resumeTtrpgOpenVoiceCandidateReviewV1({...f.resume,scope:{projectId:copy,worldId:session.worldId,workId:session.workId},sessionId:session.id!})).rejects.toThrow()
    expect(await db.agentRunEvents.toArray()).toEqual(events)
    expect((await readInstanceAgentRunV1(f.input.scope,f.candidate.runId)).projection.state).toBe('paused')
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('restores only the actual saved positive declaration after its confirmation return is lost and the original Run is paused',async()=>{
    const f=await fixture(),ledger=await import('../../src/lib/agent/run/event-store'),actual=ledger.appendAgentRunEventV1
    const input={...f.input,candidateHash:f.candidate.candidateHash,decision:'accept-this-original-voice-candidate-for-review' as const,listening:'self-reported-original-listening' as const,judgment:'acceptable-to-me' as const}
    const lost=vi.spyOn(ledger,'appendAgentRunEventV1').mockImplementation(async input=>{const out=await actual(input);if(input.type==='confirmation.recorded')throw Error('actual-positive-confirmation-lost');return out})
    await expect(api.acceptTtrpgOpenVoiceCandidateReviewV1(input)).rejects.toThrow('actual-positive-confirmation-lost');lost.mockRestore()
    const saved=(await api.readTtrpgOpenVoiceCandidateReviewV1({...f.input,candidateHash:f.candidate.candidateHash}))!
    await pause(f);await api.resumeTtrpgOpenVoiceCandidateReviewV1(f.resume)
    const done=(await api.acceptTtrpgOpenVoiceCandidateReviewV1(input))!
    expect(done.complete).toBe(true);expect(done.review).toEqual(saved.review)
    expect((await readInstanceAgentRunV1(f.input.scope,f.candidate.runId)).events.filter(e=>e.type==='confirmation.recorded')).toHaveLength(1)
    expect(await db.productMediaAssets.count()).toBe(0);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
})
