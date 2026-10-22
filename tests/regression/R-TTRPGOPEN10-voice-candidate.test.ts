import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { db } from '../../src/lib/db/schema'
import { setupLocalVoiceExecutionV1 } from '../helpers/open-local-voice'
import { prepareTtrpgOpenLocalVoiceExecutionV1, prepareTtrpgOpenVoiceCandidateV1, readTtrpgOpenVoiceCandidateV1, recoverTtrpgOpenLocalVoiceRawV1 } from '../../src/lib/ttrpg/open-audio-service'
import { dispatchTtrpgOpenLocalVoiceForKernelV1 } from '../../src/lib/ttrpg/open-voice-execution'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import * as ledger from '../../src/lib/agent/run/event-store'
import * as artifacts from '../../src/lib/memory/artifact-store'
import { readProductRuntimeState,branchProductRuntimeSession,deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import * as output from '../../src/lib/ttrpg/open-voice-result'
import { configureTtrpgSessionParticipantV2,readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'

// Real isolated owner/Run commands with synthetic PCM/protocol metadata. No
// weights, actual inference, audition or independent-human evidence.
async function fixture(valid = true) {
  const f=await setupLocalVoiceExecutionV1(), prepared=await prepareTtrpgOpenLocalVoiceExecutionV1(f.input)
  const execute=vi.fn(async (packet: unknown) => valid ? execFileSync(process.execPath,['--input-type=module','-e',`
import {readFileSync} from 'node:fs';import {syntheticResult} from './tests/helpers/local-voice-product-fixture.mjs';
const input=JSON.parse(readFileSync(0,'utf8')),{bytes,result}=syntheticResult(input);
console.log(JSON.stringify({schema:'storyforge.ttrpg-local-tts-product-raw-response',version:1,result,workerExecutionKind:'pinned-offline-worker',completionEvidence:'observed-child-close',cancellationRequested:false,audio:{encoding:'base64',data:bytes.toString('base64')},candidateAccepted:false,adoptionAllowed:false}));
`],{input:JSON.stringify(packet),encoding:'utf8'}) : 'original invalid audio retained verbatim')
  await dispatchTtrpgOpenLocalVoiceForKernelV1({ ...f.input,decision:'dispatch-this-original-local-voice-execution',transport:{kind:'local-offline-speech-v1',profileHash:prepared.profileHash,execute} })
  const fetcher=vi.fn(async () => { throw new Error('candidate-must-not-fetch') });vi.stubGlobal('fetch',fetcher)
  return { ...f,prepared,execute,fetcher,review:{...f.input,decision:'review-this-original-local-voice-result' as const} }
}
describe('R-TTRPGOPEN10 retained original voice review candidate', {timeout:60000}, () => {
  beforeEach(async () => {await db.delete();await db.open()})
  afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  it('persists a ready unadopted candidate with truthful sample clocks and physical usage, surviving reload without any new request or media write', async () => {
    const f=await fixture(),before=await readProductRuntimeState(f.owner.sessionId)
    expect(await readTtrpgOpenVoiceCandidateV1(f.input)).toBeNull()
    const result=await prepareTtrpgOpenVoiceCandidateV1(f.review),candidate=result.candidate
    expect(candidate.artifact).toMatchObject({status:'ready',humanListening:'unproven',adoptionAllowed:false})
    expect(candidate.validation).toMatchObject({timeline:{kind:'normalized-reading-segments',wordAlignmentProvided:false,samples:4410},usage:{speechCallsStarted:1,textEncoderCallsStarted:1}})
    const snapshot=await ledger.readInstanceAgentRunV1(f.owner.scope,f.prepared.runId)
    expect(snapshot.projection.state).toBe('awaiting_confirmation')
    expect(snapshot.events.filter(e=>e.type==='candidate.persisted')).toHaveLength(1)
    expect(await db.agentRunCheckpoints.count()).toBe(1)
    db.close();await db.open()
    expect(await readTtrpgOpenVoiceCandidateV1(f.input)).toMatchObject({candidate,complete:true,generationAllowed:false,adoptionAllowed:false})
    expect(await prepareTtrpgOpenVoiceCandidateV1(f.review)).toEqual(result)
    const count=await db.agentRunEvents.count()
    expect(await recoverTtrpgOpenLocalVoiceRawV1({...f.input,decision:'recover-this-original-local-voice-raw-without-resending'})).toMatchObject({runState:'awaiting_confirmation',retrievedFromLocalJob:false})
    expect(await db.agentRunEvents.count()).toBe(count)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
    expect(await db.agentRuns.count()).toBe(2);expect(await db.productMediaAssets.count()).toBe(0)
    expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before)
  })
  it('retains invalid raw as a blocked candidate without fabricating audio, token usage, listening or a retry', async () => {
    const f=await fixture(false), result=await prepareTtrpgOpenVoiceCandidateV1(f.review)
    expect(result.candidate.artifact).toMatchObject({status:'blocked',audio:null,humanListening:'unproven',adoptionAllowed:false})
    expect(result.candidate.validation).toBeNull();expect(result.candidate.artifact.issues[0].disposition).toBe('blocking')
    expect(await artifacts.readAgentRunArtifactExactV1({projectId:f.owner.scope.projectId,artifactKind:'raw-response',contentHash:result.candidate.artifact.evidence.rawResponseArtifactHash})).toBe('original invalid audio retained verbatim')
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('cannot turn an unsent original child into a request, raw return or candidate', async () => {
    const f=await setupLocalVoiceExecutionV1();await prepareTtrpgOpenLocalVoiceExecutionV1(f.input)
    await expect(prepareTtrpgOpenVoiceCandidateV1({...f.input,decision:'review-this-original-local-voice-result'})).rejects.toThrow(/记账派发/)
    expect((await db.agentRunEvents.toArray()).filter(e=>e.type==='model.requested'||e.type==='candidate.persisted')).toHaveLength(0)
    expect(await db.agentRuns.count()).toBe(2);expect(await db.agentRunCheckpoints.count()).toBe(0)
  })
  it('revoked recipient consent during asynchronous physical verification cannot publish or persist a private candidate', async () => {
    const f=await fixture(), verify=output.verifyTtrpgOpenVoiceRawResultForKernelV1
    vi.spyOn(output,'verifyTtrpgOpenVoiceRawResultForKernelV1').mockImplementationOnce(async (...args)=>{
      const result=await verify(...args),seat=(await readTtrpgSessionParticipantsV2(f.owner.sessionId)).find(s=>s.viewerKey===f.owner.viewerKey)!
      await configureTtrpgSessionParticipantV2({sessionId:f.owner.sessionId,seatKey:seat.seatKey,expectedRevision:seat.revision,
        commandId:'audio.candidate.revoke',requestedByViewerKey:f.owner.viewerKey,consent:{publicSharingAllowed:false}})
      return result
    })
    await expect(prepareTtrpgOpenVoiceCandidateV1(f.review)).rejects.toThrow()
    expect((await db.agentRunEvents.toArray()).filter(e=>e.type==='candidate.persisted')).toHaveLength(0)
    expect(await db.agentRunCheckpoints.count()).toBe(0);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each(['artifact','candidate-event','checkpoint'] as const)('recovers the exact candidate after a committed %s return is lost', async boundary => {
    const f=await fixture()
    if(boundary==='artifact') { const original=artifacts.recordAgentRunArtifactV1;vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockImplementationOnce(async input=>{await original(input);throw new Error('lost-candidate-return')}) }
    if(boundary==='candidate-event') { const original=ledger.appendAgentRunEventV1;vi.spyOn(ledger,'appendAgentRunEventV1').mockImplementationOnce(async input=>{await original(input);throw new Error('lost-candidate-return')}) }
    if(boundary==='checkpoint') { const original=checkpoints.createAgentRunCheckpointV1;vi.spyOn(checkpoints,'createAgentRunCheckpointV1').mockImplementationOnce(async input=>{await original(input);throw new Error('lost-candidate-return')}) }
    await expect(prepareTtrpgOpenVoiceCandidateV1(f.review)).rejects.toThrow('lost-candidate-return')
    const result=await prepareTtrpgOpenVoiceCandidateV1(f.review)
    expect(await readTtrpgOpenVoiceCandidateV1(f.input)).toMatchObject({complete:true,candidate:result.candidate})
    expect((await ledger.readInstanceAgentRunV1(f.owner.scope,f.prepared.runId)).events.filter(e=>e.type==='candidate.persisted')).toHaveLength(1)
    expect(await db.agentRunCheckpoints.count()).toBe(1);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('concurrent explicit reviews keep one candidate and one bound checkpoint', async () => {
    const f=await fixture(),results=await Promise.all([prepareTtrpgOpenVoiceCandidateV1(f.review),prepareTtrpgOpenVoiceCandidateV1(f.review)])
    expect(results[0].candidate.candidateHash).toBe(results[1].candidate.candidateHash)
    expect(await db.agentRunCheckpoints.count()).toBe(1)
    expect((await ledger.readInstanceAgentRunV1(f.owner.scope,f.prepared.runId)).events.filter(e=>e.type==='candidate.persisted')).toHaveLength(1)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('an unrelated later checkpoint cannot stand in for the missing original candidate checkpoint; reading never fills it', async () => {
    const f=await fixture(), create=checkpoints.createAgentRunCheckpointV1
    vi.spyOn(checkpoints,'createAgentRunCheckpointV1').mockRejectedValueOnce(new Error('before-original-review-checkpoint'))
    await expect(prepareTtrpgOpenVoiceCandidateV1(f.review)).rejects.toThrow('before-original-review-checkpoint')
    await create({scope:f.owner.scope,productRuntimeSessionId:f.owner.sessionId,runId:f.prepared.runId,resumePayload:{note:'unrelated generic checkpoint'}})
    const count=await db.agentRunEvents.count()
    expect(await readTtrpgOpenVoiceCandidateV1(f.input)).toMatchObject({complete:false})
    expect(await db.agentRunEvents.count()).toBe(count)
    await prepareTtrpgOpenVoiceCandidateV1(f.review)
    expect(await readTtrpgOpenVoiceCandidateV1(f.input)).toMatchObject({complete:true})
    expect(await db.agentRunCheckpoints.count()).toBe(2);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('never overwrites or revives corrupted witnessed candidate bytes', async () => {
    const f=await fixture();await prepareTtrpgOpenVoiceCandidateV1(f.review)
    const snapshot=await ledger.readInstanceAgentRunV1(f.owner.scope,f.prepared.runId)
    const event=snapshot.events.find(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='source-snapshot'&&e.payload.contentHash!==f.prepared.inputArtifactHash)
    if(event?.type!=='evidence.artifact.recorded')throw new Error('fixture candidate missing')
    const row=await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.owner.scope.projectId,'source-snapshot',event.payload.contentHash]).first()
    await db.agentRunArtifacts.update(row!.id!,{content:'{}'})
    await expect(readTtrpgOpenVoiceCandidateV1(f.input)).rejects.toThrow()
    await expect(prepareTtrpgOpenVoiceCandidateV1(f.review)).rejects.toThrow()
    expect((await db.agentRunArtifacts.get(row!.id!))!.content).toBe('{}')
    expect((await ledger.readInstanceAgentRunV1(f.owner.scope,f.prepared.runId)).events).toEqual(snapshot.events)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('preserves exact candidate history through import/branch without granting review execution, and deletes only original-owner checkpoints', async () => {
    const f=await fixture(), result=await prepareTtrpgOpenVoiceCandidateV1(f.review)
    const content=canonicalStringify(result.candidate),projectId=await importProjectJSON(await exportProjectJSON(f.owner.scope.projectId))
    const imported=(await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const locator={...f.review,scope:{projectId,worldId:imported.worldId,workId:imported.workId},sessionId:imported.id!}
    const saved=(await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()).find(row=>row.content?.includes(result.candidate.candidateHash))
    expect(JSON.parse(saved!.content!).candidateHash).toBe(result.candidate.candidateHash)
    await expect(prepareTtrpgOpenVoiceCandidateV1(locator)).rejects.toThrow()
    const branch=await branchProductRuntimeSession({parentSessionId:f.owner.sessionId,throughSequence:(await readProductRuntimeState(f.owner.sessionId)).lastSequence,title:'retained-audio-candidate'})
    await expect(readTtrpgOpenVoiceCandidateV1({...f.input,sessionId:branch.id!})).rejects.toThrow()
    await deleteProductRuntimeSession(f.owner.sessionId)
    expect(await db.agentRunCheckpoints.where('runId').equals(f.prepared.runId).count()).toBe(0)
    expect(await db.agentRunCheckpoints.where('projectId').equals(projectId).count()).toBe(1)
    expect(saved!.content).toBe(content)
    expect(f.fetcher).not.toHaveBeenCalled()
  })
})
