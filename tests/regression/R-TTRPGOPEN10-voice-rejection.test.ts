/** Real original decision/Run barriers and CAS. Synthetic PCM and declarations
 * only; these tests never represent independent human listening. */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {setupVoiceCandidateFixtureV1} from '../helpers/open-voice-candidate'
import * as api from '../../src/lib/ttrpg/open-audio-service'
import * as ledger from '../../src/lib/agent/run/event-store'
import * as artifacts from '../../src/lib/memory/artifact-store'
import {readProductRuntimeState} from '../../src/lib/product/runtime-core'
import {dispatchTtrpgOpenLocalVoiceForKernelV1} from '../../src/lib/ttrpg/open-voice-execution'
import {parseTtrpgOpenVoiceQualityRejectionV1} from '../../src/lib/ttrpg/open-voice-rejection-contract'
import {parseTtrpgOpenVoiceQualityReviewV1} from '../../src/lib/ttrpg/open-voice-review-contract'
import {loadTtrpgOpenPlayerContextV1} from '../../src/lib/ttrpg/open-player-context'
import {loadTtrpgOpenBriefContextV1} from '../../src/lib/ttrpg/open-brief-context'

describe('R-TTRPGOPEN10 durable original voice rejection',{timeout:120000},()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  async function fixture(humanGm=true){const f=await setupVoiceCandidateFixtureV1(true,humanGm),{candidate}=await api.prepareTtrpgOpenVoiceCandidateV1(f.review)
    return {...f,candidate,reject:{...f.input,candidateHash:candidate.candidateHash,decision:'reject-this-original-voice-candidate-for-session-use' as const,
      listening:'self-reported-original-listening' as const,judgment:'not-acceptable-to-me' as const,reason:'读法清楚，但音色不适合本桌'}}}
  it('retains one real negative declaration and nonretryable original failure, never media/acceptance, and rereads it without another dispatch',async()=>{
    const f=await fixture(false),before=await readProductRuntimeState(f.input.sessionId),raw=(await db.agentRunArtifacts.toArray()).filter(r=>r.artifactKind==='raw-response')
    const context={scope:f.input.scope,sessionId:f.input.sessionId},actorBefore=await loadTtrpgOpenPlayerContextV1({...context,actorKey:'hero'}),briefBefore=await loadTtrpgOpenBriefContextV1({...context,actorKey:'gm'})
    const rejected=await api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject)
    expect(rejected).toMatchObject({complete:true,runState:'failed',runId:f.candidate.runId,futureInferenceBlocked:true,generationAllowed:false,adoptionAllowed:false})
    expect(rejected?.rejection.reason).toBe(f.reject.reason)
    expect(await api.readTtrpgOpenVoiceCandidateRejectionV1(f.input)).toEqual(rejected)
    expect(await api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject)).toEqual(rejected)
    await expect(api.rejectTtrpgOpenVoiceCandidateReviewV1({...f.reject,reason:'改写历史原因'})).rejects.toThrow(/原因/)
    await expect(api.acceptTtrpgOpenVoiceCandidateReviewV1({...f.input,candidateHash:f.candidate.candidateHash,decision:'accept-this-original-voice-candidate-for-review',listening:'self-reported-original-listening',judgment:'acceptable-to-me'})).rejects.toThrow(/拒绝/)
    const dispatchEvents=await db.agentRunEvents.toArray()
    expect(await dispatchTtrpgOpenLocalVoiceForKernelV1({...f.input,decision:'dispatch-this-original-local-voice-execution',transport:{kind:'local-offline-speech-v1',profileHash:f.prepared.profileHash,execute:f.execute}})).toMatchObject({status:'dispatch-already-recorded',automaticRetryAllowed:false})
    expect(await db.agentRunEvents.toArray()).toEqual(dispatchEvents)
    const snapshot=await ledger.readInstanceAgentRunV1(f.input.scope,f.candidate.runId)
    expect(snapshot.events.filter(e=>e.type==='confirmation.recorded')).toHaveLength(1)
    expect(snapshot.events.filter(e=>e.type==='run.failed')).toHaveLength(1)
    expect(snapshot.events.some(e=>['verification.started','verification.accepted','adoption.started','adoption.committed','runtime.candidate.adopted'].includes(e.type))).toBe(false)
    expect(await api.readTtrpgOpenVoiceCandidateReviewV1({...f.input,candidateHash:f.candidate.candidateHash})).toBeNull()
    expect(await readProductRuntimeState(f.input.sessionId)).toEqual(before);expect(await db.productMediaAssets.count()).toBe(0)
    expect((await db.agentRunArtifacts.toArray()).filter(r=>r.artifactKind==='raw-response')).toEqual(raw)
    expect((await loadTtrpgOpenPlayerContextV1({...context,actorKey:'hero'})).view).toEqual(actorBefore.view)
    expect((await loadTtrpgOpenBriefContextV1({...context,actorKey:'gm'})).resources).toEqual(briefBefore.resources)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('keeps the negative contract closed and refuses absent personal listening, another viewer and a different candidate',async()=>{
    const f=await fixture(),before=await db.agentRunEvents.toArray()
    for(const change of [{listening:undefined},{viewerKey:'viewer.human'},{candidateHash:'a'.repeat(64)}])await expect(api.rejectTtrpgOpenVoiceCandidateReviewV1({...f.reject,...change} as never)).rejects.toThrow()
    expect(await db.agentRunEvents.toArray()).toEqual(before)
    const rejected=(await api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject))!
    expect(()=>parseTtrpgOpenVoiceQualityReviewV1(rejected.rejection)).toThrow()
    for(const change of [{version:2},{judgment:'acceptable-to-me'},{adoptionAllowed:true}])expect(()=>parseTtrpgOpenVoiceQualityRejectionV1({...rejected.rejection,...change})).toThrow()
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('permits only one original quality decision when accept and reject race, retaining one declaration and confirmation',async()=>{
    const f=await fixture()
    const results=await Promise.allSettled([api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject),api.acceptTtrpgOpenVoiceCandidateReviewV1({...f.input,candidateHash:f.candidate.candidateHash,decision:'accept-this-original-voice-candidate-for-review',listening:'self-reported-original-listening',judgment:'acceptable-to-me'})])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
    const bodies=(await db.agentRunArtifacts.toArray()).filter(r=>r.artifactKind==='source-snapshot').map(r=>JSON.parse(r.content)).filter(r=>['storyforge.ttrpg-open-voice-quality-review','storyforge.ttrpg-open-voice-quality-rejection'].includes(r.schema))
    expect(bodies).toHaveLength(1)
    expect((await ledger.readInstanceAgentRunV1(f.input.scope,f.candidate.runId)).events.filter(e=>e.type==='confirmation.recorded')).toHaveLength(1)
    expect(await db.productMediaAssets.count()).toBe(0);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('recovers an actual rejected confirmation after its return is lost and that same original Run is paused, preserving the original declaration',async()=>{
    const f=await fixture(),actual=ledger.appendAgentRunEventV1
    const lost=vi.spyOn(ledger,'appendAgentRunEventV1').mockImplementation(async input=>{const out=await actual(input);if(input.type==='confirmation.recorded'&&input.payload.decision==='reject')throw Error('actual-rejection-confirmation-lost');return out})
    await expect(api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject)).rejects.toThrow('actual-rejection-confirmation-lost');lost.mockRestore()
    const pending=(await api.readTtrpgOpenVoiceCandidateRejectionV1(f.input))!,snapshot=await ledger.readInstanceAgentRunV1(f.input.scope,f.candidate.runId)
    expect(pending.complete).toBe(false)
    await ledger.appendAgentRunEventV1({scope:f.input.scope,productRuntimeSessionId:f.input.sessionId,runId:f.candidate.runId,type:'run.paused',payload:{reason:'拒绝后暂停收尾',recoverable:true},expectedLastSequence:snapshot.projection.lastSequence})
    await expect(api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject)).rejects.toThrow(/暂停/)
    await api.resumeTtrpgOpenVoiceCandidateReviewV1({...f.input,candidateHash:f.candidate.candidateHash,decision:'resume-this-original-voice-review-without-inference'})
    const done=(await api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject))!
    expect(done.complete).toBe(true);expect(done.rejection).toEqual(pending.rejection)
    const end=await ledger.readInstanceAgentRunV1(f.input.scope,f.candidate.runId)
    expect(end.events.filter(e=>e.type==='confirmation.recorded')).toHaveLength(1);expect(end.events.filter(e=>e.type==='run.failed')).toHaveLength(1)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each(['artifact','failure'] as const)('reads and finishes the real original rejection after committed %s loses its return, without a second declaration',async boundary=>{
    const f=await fixture(),record=artifacts.recordAgentRunArtifactV1,append=ledger.appendAgentRunEventV1
    const restore=boundary==='artifact'?vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockImplementation(async input=>{const out=await record(input);if(input.content.includes('storyforge.ttrpg-open-voice-quality-rejection'))throw Error('actual-rejection-return-lost');return out})
      :vi.spyOn(ledger,'appendAgentRunEventV1').mockImplementation(async input=>{const out=await append(input);if(input.type==='run.failed')throw Error('actual-rejection-return-lost');return out})
    await expect(api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject)).rejects.toThrow('actual-rejection-return-lost');restore.mockRestore()
    const saved=(await api.readTtrpgOpenVoiceCandidateRejectionV1(f.input))!,before=await db.agentRunEvents.toArray()
    expect(await db.agentRunEvents.toArray()).toEqual(before)
    const complete=(await api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject))!;expect(complete.complete).toBe(true);expect(complete.rejection).toEqual(saved.rejection)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('preserves a saved rejection when its real stop checkpoint is removed, refusing to recreate history or grant a new review',async()=>{
    const f=await fixture();await api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject)
    const rows=await db.agentRunCheckpoints.where('runId').equals(f.candidate.runId).toArray(),barrier=rows.find(r=>r.resumePayloadJson?.includes('stop-original-job'))!
    await db.agentRunCheckpoints.delete(barrier.id!);const before=await db.agentRunEvents.toArray()
    await expect(api.readTtrpgOpenVoiceCandidateRejectionV1(f.input)).rejects.toThrow(/检查点/)
    await expect(api.rejectTtrpgOpenVoiceCandidateReviewV1(f.reject)).rejects.toThrow(/检查点/)
    expect(await db.agentRunEvents.toArray()).toEqual(before);expect(f.execute).toHaveBeenCalledTimes(1)
  })
})
