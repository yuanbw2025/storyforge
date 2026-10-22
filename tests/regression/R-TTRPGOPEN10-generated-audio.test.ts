/** Actual isolated generator/media/E16 commands with synthetic PCM. These
 * prove engineering paths, never real speech quality or independent listening. */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupVoiceCandidateFixtureV1 } from '../helpers/open-voice-candidate'
import * as api from '../../src/lib/ttrpg/open-audio-service'
import { TTRPG_GENERATED_AUDIO_RIGHTS_V1 } from '../../src/lib/ttrpg/open-generated-audio-contract'
import { parseTtrpgOpenAudioReceiptV1 } from '../../src/lib/ttrpg/open-audio-contract'
import { parseTtrpgOpenAudioReceipt,parseTtrpgOpenAudioRequest } from '../../src/lib/ttrpg/open-audio-receipt'
import { verifyTtrpgOpenGeneratedAudioOriginV1 } from '../../src/lib/ttrpg/open-generated-audio-evidence'
import { readProductRuntimeState,branchProductRuntimeSession,deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { applyTtrpgOpenAudioCueV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import * as media from '../../src/lib/ttrpg/open-audio-media'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { markAndSweepAgentRunArtifactsV1,pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'
import { configureTtrpgSessionParticipantV2,readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { loadTtrpgOpenBriefContextV1 } from '../../src/lib/ttrpg/open-brief-context'
import type { TtrpgNarratorVoiceV1 } from '../../src/lib/ttrpg/narration-listening-preferences'

describe('R-TTRPGOPEN10 explicit generated voice E16',{timeout:120000},()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  async function fixture(humanGm=true,voice?:TtrpgNarratorVoiceV1){
    const f=await setupVoiceCandidateFixtureV1(true,humanGm,voice),{candidate}=await api.prepareTtrpgOpenVoiceCandidateV1(f.review)
    await api.acceptTtrpgOpenVoiceCandidateReviewV1({...f.input,candidateHash:candidate.candidateHash,decision:'accept-this-original-voice-candidate-for-review',
      listening:'self-reported-original-listening',judgment:'acceptable-to-me'})
    const prepare={...f.input,candidateHash:candidate.candidateHash,name:'调查配音',source:'合成PCM工程fixture',license:'仅用于隔离工程验证',
      rightsDeclaration:TTRPG_GENERATED_AUDIO_RIGHTS_V1,decision:'prepare-this-original-generated-voice-for-session-use' as const}
    return {...f,candidate,prepare}
  }
  async function prepared(f:Awaited<ReturnType<typeof fixture>>){
    const result=await api.prepareTtrpgOpenGeneratedAudioV1(f.prepare)
    if(result.status!=='review')throw Error('Expected fresh explicit generated review')
    return result.review
  }
  const confirm=(f:Awaited<ReturnType<typeof fixture>>,review:api.TtrpgOpenAudioReviewV1)=>api.confirmTtrpgOpenAudioReviewV1({...f.owner,review,decision:'confirm-this-audio-and-audience'})
  it.each([undefined,'qwen.serena'] as const)('prepares real source-bound bytes without adopting, then commits one V2 E16 and reads truthful timing: %s',async voice=>{
    const f=await fixture(false,voice),before=await readProductRuntimeState(f.owner.sessionId)
    const input={scope:f.owner.scope,sessionId:f.owner.sessionId},actorBefore=await loadTtrpgOpenPlayerContextV1({...input,actorKey:'hero'}),briefBefore=await loadTtrpgOpenBriefContextV1({...input,actorKey:'gm'})
    const review=await prepared(f)
    expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before)
    expect(await db.productMediaAssets.count()).toBe(1);expect((await api.readTtrpgOpenAudioDeskV1(f.owner)).tracks).toHaveLength(0)
    const committed=await confirm(f,review),again=await confirm(f,review),state=await readProductRuntimeState(f.owner.sessionId)
    expect(again).toEqual(committed);expect(state.entities).toEqual(before.entities);expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    const receipts=state.ttrpg!.openRun!.audioReceipts!;expect(receipts).toHaveLength(1);expect(receipts[0].version).toBe(2)
    expect(()=>parseTtrpgOpenAudioReceiptV1(receipts[0])).toThrow()
    const receipt=receipts[0];if(receipt.version!==2)throw Error('Expected explicit generated V2')
    expect(parseTtrpgOpenAudioReceipt(receipt)).toEqual(receipt)
    for(const bad of [{...receipt,version:3},{...receipt,extra:true},
      {...receipt,request:{...receipt.request,voiceTimeline:{granularity:'word',marks:[]}}},
      {...receipt,envelope:{...receipt.envelope,generatedTimeline:{...receipt.generated.timeline,clock:{...receipt.generated.timeline.clock,wordAlignmentProvided:true}}}}])expect(()=>parseTtrpgOpenAudioReceipt(bad)).toThrow()
    expect(()=>parseTtrpgOpenAudioRequest({...receipt.request,version:3})).toThrow()
    const essential=new Set([receipt.generated.completion.sourceEvidenceArtifactHash,receipt.generated.completion.reviewArtifactHash,receipt.generated.completion.verificationArtifactHash])
    await expect(verifyTtrpgOpenGeneratedAudioOriginV1({projectId:f.owner.scope.projectId,receipt:{...receipt,generated:{...receipt.generated,artifactRefs:receipt.generated.artifactRefs.filter(ref=>essential.has(ref.contentHash))}}})).rejects.toThrow(/完整完成来源/)
    const actorAfter=await loadTtrpgOpenPlayerContextV1({...input,actorKey:'hero'}),briefAfter=await loadTtrpgOpenBriefContextV1({...input,actorKey:'gm'})
    expect(actorAfter.view).toEqual(actorBefore.view);expect(briefAfter.resources).toEqual(briefBefore.resources)
    expect(receipt.request.voiceTimeline).toBeNull();expect(receipt.envelope.event.voiceTimeline).toBeNull()
    expect(receipt.envelope.generatedTimeline.clock).toMatchObject({kind:'normalized-reading-segments',wordAlignmentProvided:false})
    expect(JSON.parse((await db.productMediaAssets.toCollection().first())!.exactArtifactRefsJson!)).toEqual(receipt.generated.artifactRefs)
    const desk=await api.readTtrpgOpenAudioDeskV1(f.owner);expect(desk.tracks).toHaveLength(1);expect(desk.tracks[0].voiceMarks).toBeNull()
    expect(desk.tracks[0].generatedTimeline).toEqual(receipt.generated.timeline)
    expect(receipt.generated.timeline.version).toBe(voice?2:1)
    expect(receipt.generated.timeline.clock.sampleRate).toBe(voice?24000:44100)
    expect((await api.readTtrpgOpenAudioClipV1({...f.owner,sourceRef:desk.tracks[0].sourceRef,expectedClipKey:desk.tracks[0].clipKey})).blob.size).toBe(receipt.asset.byteSize)
    expect((await api.readTtrpgOpenGeneratedAudioAdoptionV1(f.input))?.choiceKey).toBe(receipt.generated.choiceKey)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('reopens the same prepared file only with new explicit rights, and copied reviews or receipt data never become upload/generated tickets',async()=>{
    const f=await fixture(),before=await readProductRuntimeState(f.owner.sessionId)
    await expect(api.prepareTtrpgOpenGeneratedAudioV1({...f.prepare,rightsDeclaration:undefined as never})).rejects.toThrow()
    const first=await prepared(f),second=await prepared(f)
    expect(second.asset).toEqual(first.asset);expect(await db.productMediaAssets.count()).toBe(1)
    const read=await api.readTtrpgOpenPreparedGeneratedAudioV1({...f.input,candidateHash:f.candidate.candidateHash})
    expect(read.choices).toHaveLength(1);expect(read.adopted).toBeNull()
    await expect(confirm(f,JSON.parse(JSON.stringify(first)))).rejects.toThrow(/重新核对/)
    await expect(applyTtrpgOpenAudioCueV1({...await openEnvelopeV1(f.owner.sessionId,'forged.generated'),viewerKey:f.owner.viewerKey,
      submissionKey:'forged.generated',request:first.request,decision:'confirm-this-audio-and-audience'})).rejects.toThrow(/使用权/)
    expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('keeps a prepared file unadopted when its original generator is deleted before confirmation',async()=>{
    const f=await fixture(),review=await prepared(f),before=await readProductRuntimeState(f.owner.sessionId)
    await deleteAgentRunV1(f.owner.scope,f.candidate.runId)
    await expect(confirm(f,review)).rejects.toThrow()
    expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before);expect(await db.productMediaAssets.count()).toBe(1)
    expect(await api.readTtrpgOpenGeneratedAudioAdoptionV1(f.input)).toBeNull()
    expect((await api.readTtrpgOpenAudioDeskV1(f.owner)).tracks).toHaveLength(0);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('reconciles a real committed E16 after its return is lost and the game is paused and original Runs deleted, then stops and replays retained V2',async()=>{
    const f=await fixture(),review=await prepared(f),actual=commands.applyTtrpgOpenAudioCueV1
    const lost=vi.spyOn(commands,'applyTtrpgOpenAudioCueV1').mockImplementation(async input=>{await actual(input);throw Error('actual-E16-return-lost')})
    await expect(confirm(f,review)).rejects.toThrow('actual-E16-return-lost');lost.mockRestore()
    await commands.changeTtrpgSafetyStatus({...await openEnvelopeV1(f.owner.sessionId,'generated.pause'),viewerKey:f.owner.viewerKey,changedBy:f.owner.viewerKey,status:'paused',reason:'声音确认后暂停'})
    const parent=(await db.agentRuns.get(f.candidate.runId))!.parentRunId!
    await deleteAgentRunV1(f.owner.scope,f.candidate.runId);await deleteAgentRunV1(f.owner.scope,parent)
    const before=await readProductRuntimeState(f.owner.sessionId),adopted=await api.readTtrpgOpenGeneratedAudioAdoptionV1(f.input)
    expect(adopted?.candidateHash).toBe(f.candidate.candidateHash)
    expect((await api.prepareTtrpgOpenGeneratedAudioV1(f.prepare)).status).toBe('already-adopted')
    await expect(api.prepareTtrpgOpenGeneratedAudioV1({...f.prepare,license:'不同许可选择'})).rejects.toThrow(/另一名称、来源或许可/)
    expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before);expect(await db.productMediaAssets.count()).toBe(1)
    const stopped=await api.prepareTtrpgOpenRetainedAudioV1({...f.owner,sourceRef:adopted!.sourceRef,submissionKey:'generated.stop.paused',action:'stop'})
    await confirm(f,stopped);expect((await api.readTtrpgOpenAudioDeskV1(f.owner)).tracks).toHaveLength(0)
    await commands.changeTtrpgSafetyStatus({...await openEnvelopeV1(f.owner.sessionId,'generated.resume'),viewerKey:f.owner.viewerKey,changedBy:f.owner.viewerKey,status:'active',reason:'继续核对'})
    const replay=await api.prepareTtrpgOpenRetainedAudioV1({...f.owner,sourceRef:adopted!.sourceRef,submissionKey:'generated.retained.play',action:'play'})
    expect('version' in replay.request&&replay.request.version).toBe(2);await confirm(f,replay)
    const desk=await api.readTtrpgOpenAudioDeskV1(f.owner),track=desk.tracks[0]
    expect(track.generatedTimeline).toEqual(review.generated!.timeline)
    expect((await api.readTtrpgOpenAudioClipV1({...f.owner,sourceRef:track.sourceRef,expectedClipKey:track.clipKey})).blob.size).toBe(review.asset!.byteSize)
    const receipts=(await readProductRuntimeState(f.owner.sessionId)).ttrpg!.openRun!.audioReceipts!
    expect(receipts.map(r=>r.version)).toEqual([2,1,2]);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it.each([undefined,'qwen.serena'] as const)('preserves adopted bytes and complete evidence through child consent, parent deletion, collection and backup/import: %s',async voice=>{
    const f=await fixture(true,voice),review=await prepared(f);await confirm(f,review)
    const state=await readProductRuntimeState(f.owner.sessionId),child=await branchProductRuntimeSession({parentSessionId:f.owner.sessionId,throughSequence:state.lastSequence,title:'生成音频续团'})
    const childOwner={...f.owner,sessionId:child.id!},before=await readProductRuntimeState(child.id!)
    await expect(api.readTtrpgOpenAudioDeskV1(childOwner)).rejects.toThrow()
    const transferred=(await readTtrpgSessionParticipantsV2(child.id!)).find(row=>row.actorKey==='companion.1')!
    await configureTtrpgSessionParticipantV2({sessionId:child.id!,seatKey:transferred.seatKey,expectedRevision:transferred.revision,commandId:'generated.child.new-human',requestedByViewerKey:transferred.viewerKey,controller:'hybrid',assignmentState:'claimed'})
    await commands.completeTtrpgOpenSessionZeroV1({...await openEnvelopeV1(child.id!,'generated.child.zero'),viewerKey:f.owner.viewerKey,
      acceptedItemKeys:before.ttrpg!.product.sessionZero.requiredItemKeys,selectedCharacterKeys:['hero','companion.1','companion.2']})
    await deleteProductRuntimeSession(f.owner.sessionId);await markAndSweepAgentRunArtifactsV1(f.owner.scope.projectId)
    await expect(pruneAgentRunArtifactsExplicitlyV1({projectId:f.owner.scope.projectId,targets:review.generated!.artifactRefs})).rejects.toThrow(/已确认产物/)
    const desk=await api.readTtrpgOpenAudioDeskV1(childOwner),track=desk.tracks[0]
    expect((await api.readTtrpgOpenAudioDeskV1({...childOwner,viewerKey:transferred.viewerKey})).tracks).toHaveLength(0)
    await expect(api.prepareTtrpgOpenRetainedAudioV1({...childOwner,sourceRef:track.sourceRef,submissionKey:'generated.no-expanded-listeners',action:'play'})).rejects.toThrow(/接收者/)
    expect((await api.readTtrpgOpenAudioClipV1({...childOwner,sourceRef:track.sourceRef,expectedClipKey:track.clipKey})).blob.size).toBe(review.asset!.byteSize)
    const copy=await importProjectJSON(await exportProjectJSON(f.owner.scope.projectId)),copied=(await db.productRuntimeSessions.where('projectId').equals(copy).toArray())[0]
    const copyOwner={scope:{projectId:copy,worldId:copied.worldId,workId:copied.workId},sessionId:copied.id!,viewerKey:f.owner.viewerKey}
    const restored=await api.readTtrpgOpenAudioDeskV1(copyOwner),clip=restored.tracks[0]
    expect(clip.generatedTimeline).toEqual(review.generated!.timeline)
    expect((await api.readTtrpgOpenAudioClipV1({...copyOwner,sourceRef:clip.sourceRef,expectedClipKey:clip.clipKey})).blob.size).toBe(review.asset!.byteSize)
    await expect(api.confirmTtrpgOpenAudioReviewV1({...copyOwner,review,decision:'confirm-this-audio-and-audience'})).rejects.toThrow(/重新核对/)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('allows only one actual candidate/recipient adoption winner across two explicit metadata choices, retaining the losing prepared file',async()=>{
    const f=await fixture(),a=await prepared(f),other=await api.prepareTtrpgOpenGeneratedAudioV1({...f.prepare,name:'另一名称'})
    if(other.status!=='review')throw Error('Expected second unadopted choice')
    expect(await db.productMediaAssets.count()).toBe(2);expect(await db.mediaBlobObjects.count()).toBe(1)
    const results=await Promise.allSettled([confirm(f,a),confirm(f,other.review)])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
    expect((await readProductRuntimeState(f.owner.sessionId)).ttrpg!.openRun!.audioReceipts).toHaveLength(1)
    expect(await db.productMediaAssets.count()).toBe(2);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it.each(['run','checkpoint','consent'] as const)('refuses a real %s change after preflight physical/native proof and before the formal commit',async boundary=>{
    const f=await fixture(),review=await prepared(f),actual=media.readTtrpgOpenAudioMediaWitnessV1;let changed=false
    vi.spyOn(media,'readTtrpgOpenAudioMediaWitnessV1').mockImplementation(async input=>{
      const result=await actual(input)
      if(!changed&&input.exactArtifactRefs){changed=true
        if(boundary==='run')await deleteAgentRunV1(f.owner.scope,f.candidate.runId)
        else if(boundary==='checkpoint')await db.agentRunCheckpoints.where('runId').equals(f.candidate.runId).delete()
        else {const seat=(await readTtrpgSessionParticipantsV2(f.owner.sessionId)).find(s=>s.viewerKey===f.owner.viewerKey)!
          await configureTtrpgSessionParticipantV2({sessionId:f.owner.sessionId,seatKey:seat.seatKey,expectedRevision:seat.revision,requestedByViewerKey:f.owner.viewerKey,commandId:'generated.consent.withdraw',consent:{sessionLoggingAllowed:false}})}
      }return result
    })
    await expect(confirm(f,review)).rejects.toThrow();expect(changed).toBe(true)
    expect((await readProductRuntimeState(f.owner.sessionId)).ttrpg!.openRun!.audioReceipts??[]).toHaveLength(0)
    expect(await db.productMediaAssets.count()).toBe(1);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('does not accept matching WAV bytes after the prepared media exact roots are replaced',async()=>{
    const f=await fixture(),review=await prepared(f),asset=(await db.productMediaAssets.toCollection().first())!
    await db.productMediaAssets.update(asset.id!,{exactArtifactRefsJson:'[]'})
    await expect(confirm(f,review)).rejects.toThrow(/证据根/)
    expect((await readProductRuntimeState(f.owner.sessionId)).ttrpg!.openRun!.audioReceipts??[]).toHaveLength(0);expect(f.execute).toHaveBeenCalledTimes(1)
  })
})
