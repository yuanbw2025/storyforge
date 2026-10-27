/** Actual isolated generator Runs with synthetic PCM. A test declaration is
 * not independent listening evidence and never adopts a runtime audio cue. */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupVoiceCandidateFixtureV1 } from '../helpers/open-voice-candidate'
import { prepareTtrpgOpenVoiceCandidateV1,readTtrpgOpenVoiceCandidateV1,acceptTtrpgOpenVoiceCandidateReviewV1,
  readTtrpgOpenVoiceCandidateReviewV1 } from '../../src/lib/ttrpg/open-audio-service'
import { parseTtrpgOpenVoiceQualityReviewV1 } from '../../src/lib/ttrpg/open-voice-review-contract'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { verifyVerificationReceiptIntegrityV1 } from '../../src/lib/agent/run/verification-receipt'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as events from '../../src/lib/agent/run/event-store'
import * as physical from '../../src/lib/ttrpg/open-voice-result'

describe('R-TTRPGOPEN10 explicit original audio review and read-only generator terminal',{timeout:120000},()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
  async function fixture(valid=true) {
    const f=await setupVoiceCandidateFixtureV1(valid),{candidate}=await prepareTtrpgOpenVoiceCandidateV1(f.review)
    const accept={...f.input,candidateHash:candidate.candidateHash,decision:'accept-this-original-voice-candidate-for-review' as const,
      listening:'self-reported-original-listening' as const,judgment:'acceptable-to-me' as const}
    return {...f,candidate,accept}
  }
  async function rows(f:Awaited<ReturnType<typeof fixture>>) {return db.agentRunEvents.where('runId').equals(f.candidate.runId).sortBy('sequence')}
  async function verification(f:Awaited<ReturnType<typeof fixture>>) {
    const row=await readTtrpgOpenVoiceCandidateReviewV1(f.accept)
    return JSON.parse(await artifacts.readAgentRunArtifactExactV1({projectId:f.owner.scope.projectId,artifactKind:'source-snapshot',contentHash:row!.verificationArtifactHash!}))
  }
  it('finishes the actual original generator with one personal declaration and a regular receipt, preserving runtime and candidate bytes',async()=>{
    const f=await fixture(),before=await readProductRuntimeState(f.owner.sessionId),body=canonicalStringify(f.candidate)
    const result=await acceptTtrpgOpenVoiceCandidateReviewV1(f.accept),proof=await verification(f),log=await rows(f)
    expect(result).toMatchObject({complete:true,runState:'completed',generationAllowed:false,adoptionAllowed:false,independentListening:'unproven'})
    expect(result!.review).toMatchObject({candidateHash:f.candidate.candidateHash,listening:'self-reported-original-listening',judgment:'acceptable-to-me',independentListening:'unproven'})
    expect(await verifyVerificationReceiptIntegrityV1(proof.receipt)).toBe(true)
    expect(proof.receipt).toMatchObject({runId:f.candidate.runId,contractHash:f.candidate.runContractHash,candidateHashes:[f.candidate.candidateHash],adoptionEventIds:[],verifierSetVersion:'ttrpg.open.local-voice-v1'})
    expect(proof.receipt.zeroModelCommit).toBeUndefined()
    expect(proof.receipt.contextManifestHashes).toEqual([f.candidate.artifact.evidence.contextManifestHash])
    expect(log.filter(e=>e.type==='confirmation.recorded')).toHaveLength(1)
    expect(log.filter(e=>e.type==='verification.accepted')).toHaveLength(1)
    expect(log.filter(e=>['adoption.started','adoption.committed','runtime.candidate.adopted'].includes(e.type))).toEqual([])
    expect(canonicalStringify((await readTtrpgOpenVoiceCandidateV1(f.input))!.candidate)).toBe(body)
    expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before)
    expect(await db.productMediaAssets.count()).toBe(0);expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('does not create a review or terminal when merely reading an unreviewed candidate',async()=>{
    const f=await fixture(),before=await rows(f),count=await db.agentRunArtifacts.count()
    expect(await readTtrpgOpenVoiceCandidateReviewV1(f.accept)).toBeNull()
    expect(await rows(f)).toEqual(before);expect(await db.agentRunArtifacts.count()).toBe(count)
  })
  it('refuses blocked original audio, wrong candidate, absent listening and a different viewer without a review artifact',async()=>{
    const f=await fixture(),before=await rows(f)
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1({...f.accept,candidateHash:'f'.repeat(64)})).rejects.toThrow()
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1({...f.accept,listening:undefined as never})).rejects.toThrow()
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1({...f.accept,viewerKey:'viewer.other'})).rejects.toThrow()
    expect(await rows(f)).toEqual(before)
    const blocked=await fixture(false)
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1(blocked.accept)).rejects.toThrow()
    expect(await readTtrpgOpenVoiceCandidateReviewV1(blocked.accept)).toBeNull()
  })
  it('concurrent exact confirmations converge to one review and one original terminal without another generation',async()=>{
    const f=await fixture(),results=await Promise.all([acceptTtrpgOpenVoiceCandidateReviewV1(f.accept),acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)])
    expect(results[0]).toEqual(results[1]);expect((await rows(f)).filter(e=>e.type==='confirmation.recorded')).toHaveLength(1)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('recovers a committed review after a lost return while paused, without rescanning PCM or claiming a new listening decision',async()=>{
    const f=await fixture(),actual=artifacts.recordAgentRunArtifactV1;let lost=false
    vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockImplementation(async input=>{
      const result=await actual(input)
      if (!lost && JSON.parse(input.content).schema==='storyforge.ttrpg-open-voice-quality-review') {lost=true;throw new Error('review-return-lost')}
      return result
    })
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)).rejects.toThrow('review-return-lost')
    const saved=await readTtrpgOpenVoiceCandidateReviewV1(f.accept);expect(saved?.complete).toBe(false)
    await changeTtrpgSafetyStatus({...await openEnvelopeV1(f.owner.sessionId,'quality.review.pause'),viewerKey:f.owner.viewerKey,changedBy:f.owner.viewerKey,status:'paused',reason:'暂时停止音频'})
    const before=await readProductRuntimeState(f.owner.sessionId),scan=vi.spyOn(physical,'verifyTtrpgOpenVoiceRawResultForKernelV1')
    const result=await acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)
    expect(result?.complete).toBe(true);expect(result?.review).toEqual(saved?.review);expect(scan).not.toHaveBeenCalled()
    expect(await readProductRuntimeState(f.owner.sessionId)).toEqual(before);expect(await db.productMediaAssets.count()).toBe(0)
  })
  it.each(['confirmation.recorded','step.succeeded','verification.started','verification.accepted'] as const)('recovers the original terminal after committed %s loses its return',async boundary=>{
    const f=await fixture(),actual=events.appendAgentRunEventV1;let lost=false
    vi.spyOn(events,'appendAgentRunEventV1').mockImplementation(async input=>{
      const result=await actual(input)
      if (!lost && input.runId===f.candidate.runId && input.type===boundary) {lost=true;throw new Error('terminal-return-lost:'+boundary)}
      return result
    })
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)).rejects.toThrow('terminal-return-lost')
    const result=await acceptTtrpgOpenVoiceCandidateReviewV1(f.accept),log=await rows(f)
    expect(result?.complete).toBe(true);expect(log.filter(e=>e.type===boundary)).toHaveLength(1)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(await db.productMediaAssets.count()).toBe(0)
  })
  it('recovers a committed no-step verification artifact after lost return, then reads the same completed receipt without appending',async()=>{
    const f=await fixture(),actual=artifacts.recordAgentRunArtifactV1;let lost=false
    vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockImplementation(async input=>{
      const result=await actual(input)
      if (!lost && JSON.parse(input.content).schema==='storyforge.ttrpg-open-voice-generation-verification') {lost=true;throw new Error('verification-return-lost')}
      return result
    })
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)).rejects.toThrow('verification-return-lost')
    const result=await acceptTtrpgOpenVoiceCandidateReviewV1(f.accept),before=await rows(f)
    expect(result?.complete).toBe(true);expect(await acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)).toEqual(result)
    expect(await rows(f)).toEqual(before);expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('keeps first review disabled during a safety pause and never auto-confirms a saved candidate',async()=>{
    const f=await fixture()
    await changeTtrpgSafetyStatus({...await openEnvelopeV1(f.owner.sessionId,'quality.first.pause'),viewerKey:f.owner.viewerKey,changedBy:f.owner.viewerKey,status:'paused',reason:'先暂停'})
    const before=await rows(f)
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)).rejects.toThrow()
    expect(await rows(f)).toEqual(before);expect(await readTtrpgOpenVoiceCandidateReviewV1(f.accept)).toBeNull()
  })
  it('rejects changed original parent history after review instead of completing or replacing the saved decision',async()=>{
    const f=await fixture(),actual=artifacts.recordAgentRunArtifactV1;let lost=false
    vi.spyOn(artifacts,'recordAgentRunArtifactV1').mockImplementation(async input=>{const result=await actual(input)
      if (!lost && JSON.parse(input.content).schema==='storyforge.ttrpg-open-voice-quality-review') {lost=true;throw new Error('review-return-lost')};return result})
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)).rejects.toThrow('review-return-lost')
    const parent=(await db.agentRuns.get(f.candidate.runId))!.parentRunId!,row=(await db.agentRunEvents.where('runId').equals(parent).toArray()).find(e=>e.type==='step.started')!
    await db.agentRunEvents.update(row.id!,{createdAt:row.createdAt-1})
    const before=await rows(f)
    await expect(acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)).rejects.toThrow('父子事件前缀')
    expect(await rows(f)).toEqual(before)
    await db.agentRunEvents.update(row.id!,{createdAt:row.createdAt})
    expect((await acceptTtrpgOpenVoiceCandidateReviewV1(f.accept))?.complete).toBe(true)
  })
  it('keeps the declaration closed and independent from rights, automatic adoption or a human acceptance verdict',async()=>{
    const f=await fixture(),result=await acceptTtrpgOpenVoiceCandidateReviewV1(f.accept),review=result!.review
    expect(parseTtrpgOpenVoiceQualityReviewV1(review)).toEqual(review)
    for (const extra of [{adoptionAllowed:true},{rights:'licensed'},{independentListening:'passed'},{listening:'inferred-from-play'}]) {
      expect(()=>parseTtrpgOpenVoiceQualityReviewV1({...review,...extra})).toThrow()
    }
  })
  it('keeps separately retained raw diagnostics without substituting them for the actual original model response',async()=>{
    const f=await fixture(),content='Auxiliary voice control diagnostic 8575'
    const diagnostic=await artifacts.recordAgentRunArtifactV1({scope:f.owner.scope,productRuntimeSessionId:f.owner.sessionId,
      runId:f.candidate.runId,artifactKind:'raw-response',content})
    await acceptTtrpgOpenVoiceCandidateReviewV1(f.accept)
    const proof=await verification(f),refs=proof.receipt.criteria[0].evidenceRefs
    expect(refs).toContain('raw:'+f.candidate.artifact.evidence.rawResponseArtifactHash)
    expect(refs).not.toContain('raw:'+diagnostic.artifact.contentHash)
    expect(await artifacts.readAgentRunArtifactExactV1({projectId:f.owner.scope.projectId,artifactKind:'raw-response',contentHash:diagnostic.artifact.contentHash})).toBe(content)
    expect(f.execute).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled();expect(await db.productMediaAssets.count()).toBe(0)
  })
})
