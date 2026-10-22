/** Actual isolated native generator ledger plus synthetic PCM. These cases
 * prove historical retention, not adopted E16, real TTS or human listening. */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupVoiceCandidateFixtureV1 } from '../helpers/open-voice-candidate'
import { prepareTtrpgOpenVoiceCandidateV1,acceptTtrpgOpenVoiceCandidateReviewV1,captureTtrpgOpenVoiceCompletionV1,
  readTtrpgOpenAudioDeskV1 } from '../../src/lib/ttrpg/open-audio-service'
import { readTtrpgOpenVoiceCompletionForKernelV1 } from '../../src/lib/ttrpg/open-voice-completion-evidence'
import { parseTtrpgOpenVoiceCompletionV1 } from '../../src/lib/ttrpg/open-voice-completion-contract'
import { canonicalStringify as stable,hashCanonicalValue as hash } from '../../src/lib/agent/run/hash'
import { deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenVoiceAuditionBasisForKernelV1 } from '../../src/lib/ttrpg/open-voice-candidate'
import { importProductRuntimeMediaAssetV1 } from '../../src/lib/product/runtime-media-library'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as physical from '../../src/lib/ttrpg/open-voice-result'

describe('R-TTRPGOPEN10 observed original completion history',{timeout:120000},()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  async function fixture(complete=true) {
    const f=await setupVoiceCandidateFixtureV1(),{candidate}=await prepareTtrpgOpenVoiceCandidateV1(f.review)
    const input={...f.input,candidateHash:candidate.candidateHash}
    if(complete)await acceptTtrpgOpenVoiceCandidateReviewV1({...input,decision:'accept-this-original-voice-candidate-for-review',
      listening:'self-reported-original-listening',judgment:'acceptable-to-me'})
    return {...f,candidate,input}
  }
  async function observe(f:Awaited<ReturnType<typeof fixture>>) {
    return {events:await db.agentRunEvents.toArray(),runs:await db.agentRuns.toArray(),artifacts:await db.agentRunArtifacts.toArray(),
      media:await db.productMediaAssets.toArray(),runtime:await readProductRuntimeState(f.owner.sessionId)}
  }
  async function archived(f:Awaited<ReturnType<typeof fixture>>,saved:Awaited<ReturnType<typeof captureTtrpgOpenVoiceCompletionV1>>) {
    return {projectId:f.owner.scope.projectId,requestKey:f.input.requestKey,sessionKey:saved.request.script.sessionKey,
      runtimeSourceHash:saved.request.script.runtimeSourceHash,completion:saved.completion}
  }
  it('captures only actual terminal facts through the mandatory memory settlement; repeated reads have no side effects',async()=>{
    const f=await fixture(),before=await observe(f),scan=vi.spyOn(physical,'verifyTtrpgOpenVoiceRawResultForKernelV1')
    const saved=await captureTtrpgOpenVoiceCompletionV1(f.input),again=await captureTtrpgOpenVoiceCompletionV1(f.input)
    expect(stable(again)).toBe(stable(saved));expect(await observe(f)).toEqual(before);expect(scan).not.toHaveBeenCalled()
    const tail=JSON.parse(saved.completion.completionEventsJson)
    expect(tail.at(-2).type).toBe('verification.accepted');expect(tail.at(-1).type).toBe('memory.settlement.recorded')
    expect(saved.artifactRefs.length).toBeLessThanOrEqual(64)
    expect(saved.artifactRefs).toContainEqual({artifactKind:'source-snapshot',contentHash:saved.completion.reviewArtifactHash})
    expect(saved.artifactRefs).toContainEqual({artifactKind:'source-snapshot',contentHash:saved.completion.verificationArtifactHash})
    expect(saved).toMatchObject({archiveOnly:true,generationAllowed:false,adoptionAllowed:false,independentListening:'unproven',physicalAudioRechecked:false,runtimePostStateReplayed:false})
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('requires a native completed original and exact current owner; reading cannot finish an unreviewed task',async()=>{
    const f=await fixture(false),before=await observe(f)
    await expect(captureTtrpgOpenVoiceCompletionV1(f.input)).rejects.toThrow(/本人审阅/)
    await expect(captureTtrpgOpenVoiceCompletionV1({...f.input,viewerKey:'viewer.other'})).rejects.toThrow()
    expect(await observe(f)).toEqual(before);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('rejects truncated, reordered, forged and extended completion histories, including rehashed memory payloads',async()=>{
    const f=await fixture(),saved=await captureTtrpgOpenVoiceCompletionV1(f.input),input=await archived(f,saved),before=await observe(f)
    const mutate=(change:(tail:any[])=>void)=>{const tail=JSON.parse(saved.completion.completionEventsJson);change(tail);return {...saved.completion,completionEventsJson:stable(tail)}}
    for(const completion of [
      mutate(t=>t.pop()),mutate(t=>t.reverse()),mutate(t=>{t[0].sequence+=1}),mutate(t=>{t.at(-1).payload.receiptHash='0'.repeat(64)}),
      mutate(t=>{t.at(-1).createdAt+=1}),mutate(t=>t.push({...t.at(-1),sequence:t.at(-1).sequence+1})),
      mutate(t=>{t.find(e=>e.type==='confirmation.recorded').payload.decision='reject'}),
      {...saved.completion,candidateHash:'0'.repeat(64)}, {...saved.completion,receiptHash:'0'.repeat(64)},
    ])await expect(readTtrpgOpenVoiceCompletionForKernelV1({...input,completion})).rejects.toThrow()
    expect(await observe(f)).toEqual(before);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('checks rehashed stored verification semantics, not only the new artifact hash',async()=>{
    const f=await fixture(),saved=await captureTtrpgOpenVoiceCompletionV1(f.input),input=await archived(f,saved)
    const row=(await db.agentRunArtifacts.where('projectId').equals(f.owner.scope.projectId).toArray()).find(r=>r.contentHash===saved.completion.verificationArtifactHash)!
    const body=JSON.parse(row.content!);body.receipt.adoptionEventIds=[123]
    const content=stable(body),contentHash=await hash(body)
    // Explicit isolated corrupt-storage fixture, never a product write path.
    await db.agentRunArtifacts.add({...row,id:undefined,contentHash,content,byteLength:new TextEncoder().encode(content).length})
    const tail=JSON.parse(saved.completion.completionEventsJson),event=tail.find((e:any)=>e.type==='evidence.artifact.recorded'&&e.payload.contentHash===row.contentHash)
    event.payload.contentHash=contentHash;event.payload.byteLength=new TextEncoder().encode(content).length
    await expect(readTtrpgOpenVoiceCompletionForKernelV1({...input,completion:{...saved.completion,verificationArtifactHash:contentHash,completionEventsJson:stable(tail)}})).rejects.toThrow(/终验正文/)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('retains complete history after both original Runs are deleted and through full backup, without adopting the fixture media',async()=>{
    const f=await fixture(),saved=await captureTtrpgOpenVoiceCompletionV1(f.input),input=await archived(f,saved)
    const ready=await readTtrpgOpenVoiceAuditionBasisForKernelV1(f.input)
    const asset=await importProductRuntimeMediaAssetV1({scope:f.owner.scope,productRuntimeSessionId:f.owner.sessionId,assetKey:'voice.completion.fixture',kind:'voice',name:'completion lifecycle fixture; unadopted',blob:new Blob([ready.data],{type:'audio/wav'}),source:'synthetic engineering fixture',license:'fixture only; not listening or adoption',durationMs:saved.audio.durationMs,exactArtifactRefs:saved.artifactRefs})
    const parent=(await db.agentRuns.get(f.prepared.runId))!.parentRunId!
    await deleteAgentRunV1(f.owner.scope,f.prepared.runId);await deleteAgentRunV1(f.owner.scope,parent)
    await artifacts.markAndSweepAgentRunArtifactsV1(f.owner.scope.projectId)
    await expect(artifacts.pruneAgentRunArtifactsExplicitlyV1({projectId:f.owner.scope.projectId,targets:saved.artifactRefs})).rejects.toThrow(/已确认产物/)
    expect(await readTtrpgOpenVoiceCompletionForKernelV1(input)).toEqual(saved)
    await expect(captureTtrpgOpenVoiceCompletionV1(f.input)).rejects.toThrow()
    const copy=await importProjectJSON(await exportProjectJSON(f.owner.scope.projectId)),cloned=await db.productMediaAssets.where('projectId').equals(copy).first()
    expect(cloned!.exactArtifactRefsJson).toBe(asset.exactArtifactRefsJson)
    expect(await readTtrpgOpenVoiceCompletionForKernelV1({...input,projectId:copy,completion:JSON.parse(stable(saved.completion))})).toEqual(saved)
    expect((await readTtrpgOpenAudioDeskV1(f.owner)).tracks).toHaveLength(0)
    expect((await readProductRuntimeState(f.owner.sessionId)).ttrpg!.openRun!.audioReceipts??[]).toHaveLength(0)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('keeps the wire closed and canonical without importing replay/execution authority',()=>{
    const base={schema:'storyforge.ttrpg-open-voice-generation-completion',version:1,sourceEvidenceArtifactHash:'a'.repeat(64),candidateHash:'b'.repeat(64),reviewArtifactHash:'c'.repeat(64),verificationArtifactHash:'d'.repeat(64),receiptHash:'e'.repeat(64),completionEventsJson:'[{"type":"data-only"}]'}
    expect(parseTtrpgOpenVoiceCompletionV1(base)).toEqual(base)
    for(const bad of [{...base,version:2},{...base,adoptionAllowed:true},{...base,completionEventsJson:'[]'},
      {...base,completionEventsJson:'[ {"type":"data-only"}]'},{...base,completionEventsJson:' '.repeat(262145)}])expect(()=>parseTtrpgOpenVoiceCompletionV1(bad)).toThrow()
  })
})
