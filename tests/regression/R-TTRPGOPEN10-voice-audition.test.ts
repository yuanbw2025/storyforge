import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupVoiceCandidateFixtureV1 } from '../helpers/open-voice-candidate'
import { prepareTtrpgOpenVoiceCandidateV1,prepareTtrpgOpenVoiceAuditionV1,observeTtrpgOpenVoiceAuditionV1 } from '../../src/lib/ttrpg/open-audio-service'
import { readProductRuntimeState,deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { changeTtrpgSafetyStatus,postTtrpgOpenTableMessageV1 } from '../../src/lib/ttrpg/runtime-commands'
import { configureTtrpgSessionParticipantV2,readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import * as physical from '../../src/lib/ttrpg/open-voice-result'

describe('R-TTRPGOPEN10 exact original memory-only audition and revocation', {timeout:60000}, () => {
  const observers: {dispose:()=>void}[]=[]
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{observers.splice(0).forEach(o=>o.dispose());vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  async function fixture(valid=true){const f=await setupVoiceCandidateFixtureV1(valid),{candidate}=await prepareTtrpgOpenVoiceCandidateV1(f.review)
    return {...f,candidate,audition:{...f.input,candidateHash:candidate.candidateHash,decision:'prepare-audition-for-this-original-voice-candidate' as const}}}
  async function watch(f:Awaited<ReturnType<typeof fixture>>){const value=await prepareTtrpgOpenVoiceAuditionV1(f.audition),revoke=vi.fn()
    const observer=observeTtrpgOpenVoiceAuditionV1(value,revoke);observers.push(observer);await observer.ready;return {value,revoke,observer}}
  it('returns only the verified original WAV, source and truthful segment clock without model, network, quota or database writes',async()=>{
    const f=await fixture(),before=await readProductRuntimeState(f.owner.sessionId)
    const counts=await Promise.all(db.tables.map(t=>t.count())),verify=vi.spyOn(physical,'verifyTtrpgOpenVoiceRawResultForKernelV1')
    const {value,revoke}=await watch(f)
    expect(value).toMatchObject({candidateHash:f.candidate.candidateHash,originalText:'编号001。',readingText:'编号零零一.',generationAllowed:false,adoptionAllowed:false,humanListening:'unproven',timeline:{kind:'normalized-reading-segments',wordAlignmentProvided:false,sampleRate:44100,samples:4410}})
    expect(value.sourceText).toBe(f.text)
    expect(value.generatedTimeline).toMatchObject({schema:'storyforge.ttrpg-open-generated-voice-timeline',version:1,sourceTextLengthUtf16:f.text.length,normalizedText:value.readingText,clock:value.timeline})
    expect(value.generatedTimeline.sourceTextHash).toBe(f.candidate.validation!.timeline.originalPart.textHash)
    expect(value.blob.type).toBe('audio/wav');expect(value.blob.size).toBe(f.candidate.artifact.audio!.byteLength)
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await value.blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('')
    expect(hash).toBe(f.candidate.artifact.audio!.contentHash)
    expect(verify).toHaveBeenCalledTimes(1);expect(revoke).not.toHaveBeenCalled()
    expect(await Promise.all(db.tables.map(t=>t.count()))).toEqual(counts);expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled();expect(await db.productMediaAssets.count()).toBe(0)
  })
  it('refuses a blocked result, false candidate hash or missing dedicated checkpoint without restoring any evidence',async()=>{
    const f=await fixture(false)
    await expect(prepareTtrpgOpenVoiceAuditionV1(f.audition)).rejects.toThrow()
    await expect(prepareTtrpgOpenVoiceAuditionV1({...f.audition,candidateHash:'0'.repeat(64)})).rejects.toThrow()
    await db.agentRunCheckpoints.where('runId').equals(f.prepared.runId).delete()
    await expect(prepareTtrpgOpenVoiceAuditionV1(f.audition)).rejects.toThrow()
    expect(await db.agentRunCheckpoints.count()).toBe(0);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('does not accept copied or mutated capabilities, reuse a disposed preview, or subscribe twice',async()=>{
    const f=await fixture(),value=await prepareTtrpgOpenVoiceAuditionV1(f.audition),revoke=vi.fn()
    expect(()=>observeTtrpgOpenVoiceAuditionV1({...value},revoke)).toThrow()
    const text=value.readingText;value.readingText='替换的私有文本';expect(()=>observeTtrpgOpenVoiceAuditionV1(value,revoke)).toThrow();value.readingText=text
    const count=value.generatedTimeline.clock.samples;value.generatedTimeline.clock.samples++;expect(()=>observeTtrpgOpenVoiceAuditionV1(value,revoke)).toThrow();value.generatedTimeline.clock.samples=count
    const observer=observeTtrpgOpenVoiceAuditionV1(value,revoke);observers.push(observer);await observer.ready
    expect(()=>observeTtrpgOpenVoiceAuditionV1(value,revoke)).toThrow();observer.dispose();observer.dispose()
    expect(()=>observeTtrpgOpenVoiceAuditionV1(value,revoke)).toThrow();expect(revoke).not.toHaveBeenCalled()
  })
  it('closes the gap between preparation and observer installation by rechecking original raw evidence without another PCM decode',async()=>{
    const f=await fixture(),verify=vi.spyOn(physical,'verifyTtrpgOpenVoiceRawResultForKernelV1'),value=await prepareTtrpgOpenVoiceAuditionV1(f.audition)
    const row=await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.owner.scope.projectId,'raw-response',f.candidate.artifact.evidence.rawResponseArtifactHash]).first()
    await db.agentRunArtifacts.update(row!.id!,{content:'corrupt-after-prepare'})
    const revoke=vi.fn(),observer=observeTtrpgOpenVoiceAuditionV1(value,revoke);observers.push(observer)
    await expect(observer.ready).rejects.toThrow();expect(revoke).toHaveBeenCalledTimes(1);expect(verify).toHaveBeenCalledTimes(1)
    expect((await db.agentRunArtifacts.get(row!.id!))!.content).toBe('corrupt-after-prepare');expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each(['artifact','event','source-event','checkpoint','run'] as const)('revokes once when an original %s is actually removed, including direct corruption without a new game event',async kind=>{
    const f=await fixture(),{value,revoke,observer}=await watch(f)
    if(kind==='artifact')await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.owner.scope.projectId,'raw-response',f.candidate.artifact.evidence.rawResponseArtifactHash]).delete()
    if(kind==='event'){const event=await db.agentRunEvents.where('runId').equals(f.prepared.runId).first();await db.agentRunEvents.delete(event!.id!)}
    if(kind==='source-event')await db.productRuntimeEvents.where('[sessionId+sequence]').equals([f.owner.sessionId,f.narrationSourceRef.sequence]).delete()
    if(kind==='checkpoint')await db.agentRunCheckpoints.where('runId').equals(f.prepared.runId).delete()
    if(kind==='run')await db.agentRuns.delete(f.prepared.runId)
    await vi.waitFor(()=>expect(revoke).toHaveBeenCalledTimes(1));observer.dispose()
    expect(()=>observeTtrpgOpenVoiceAuditionV1(value,revoke)).toThrow();expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('keeps an observed original audition through harmless game discussion and releases all observers when disposed',async()=>{
    const f=await fixture(),{revoke,observer}=await watch(f)
    await postTtrpgOpenTableMessageV1({...await openEnvelopeV1(f.owner.sessionId,'audition.discussion'),viewerKey:OPEN_HUMAN_VIEWER,
      submissionKey:'audition.discussion',request:{kind:'out-of-character',text:'等我核对读法。',audience:'party'}})
    await new Promise(resolve=>setTimeout(resolve,50));expect(revoke).not.toHaveBeenCalled()
    observer.dispose();await db.agentRunCheckpoints.where('runId').equals(f.prepared.runId).delete()
    await new Promise(resolve=>setTimeout(resolve,30));expect(revoke).not.toHaveBeenCalled()
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('keeps a denied live consent edit harmless, but revokes actual participant-row drift and refuses a new preview',async()=>{
    const f=await fixture(),{revoke,value}=await watch(f),seat=(await readTtrpgSessionParticipantsV2(f.owner.sessionId)).find(s=>s.viewerKey===f.owner.viewerKey)!
    await expect(configureTtrpgSessionParticipantV2({sessionId:f.owner.sessionId,seatKey:seat.seatKey,expectedRevision:seat.revision,
      commandId:'audition.revoke',requestedByViewerKey:f.owner.viewerKey,consent:{publicSharingAllowed:false}})).rejects.toThrow(/Session Zero/)
    expect(revoke).not.toHaveBeenCalled()
    const row=await db.ttrpgSessionParticipants.where('[sessionId+seatKey]').equals([f.owner.sessionId,seat.seatKey]).first()
    await db.ttrpgSessionParticipants.update(row!.id!,{consent:{...row!.consent,publicSharingAllowed:false}})
    await vi.waitFor(()=>expect(revoke).toHaveBeenCalledTimes(1));expect(()=>observeTtrpgOpenVoiceAuditionV1(value,revoke)).toThrow()
    await expect(prepareTtrpgOpenVoiceAuditionV1(f.audition)).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('revokes on an actual safety pause and refuses a new preview while paused',async()=>{
    const f=await fixture(),{revoke}=await watch(f)
    await changeTtrpgSafetyStatus({...await openEnvelopeV1(f.owner.sessionId,'audition.pause'),viewerKey:f.owner.viewerKey,changedBy:f.owner.viewerKey,status:'paused',reason:'暂停试听'})
    await vi.waitFor(()=>expect(revoke).toHaveBeenCalledTimes(1));await expect(prepareTtrpgOpenVoiceAuditionV1(f.audition)).rejects.toThrow()
  })
  it('revokes on original owner deletion instead of treating retained bytes as independent playback authority',async()=>{
    const f=await fixture(),{revoke}=await watch(f);await deleteProductRuntimeSession(f.owner.sessionId)
    await vi.waitFor(()=>expect(revoke).toHaveBeenCalledTimes(1));expect(f.fetcher).not.toHaveBeenCalled()
  })
})
