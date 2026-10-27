import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { verifyTtrpgOpenVoiceRawResultForKernelV1, TtrpgOpenVoiceResultErrorV1 } from '../../src/lib/ttrpg/open-voice-result'

// Synthetic PCM and explicit protocol metadata, not an actual worker/model or
// human listening receipt. The Node verifier is an independent runtime oracle.
function fixture(historical = false) {
  return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`
import {syntheticJob,syntheticResult} from './tests/helpers/local-voice-product-fixture.mjs';
import {digest,stable} from './scripts/ttrpg-local-tts/product-contract.mjs';
const packet=syntheticJob();
if (${historical}) {packet.execution.profile.implementation.sources[0].sha256='0'.repeat(64);packet.execution.profileHash=digest(stable(packet.execution.profile));packet.inputArtifactHash=digest(stable(packet.execution));packet.jobKey='ttrpg.voice.1.'+packet.inputArtifactHash;}
const {bytes,result}=syntheticResult(packet),e=packet.execution;
const raw={schema:'storyforge.ttrpg-local-tts-product-raw-response',version:1,result,workerExecutionKind:'pinned-offline-worker',completionEvidence:'observed-child-close',cancellationRequested:false,audio:{encoding:'base64',data:bytes.toString('base64')},candidateAccepted:false,adoptionAllowed:false};
const identity={jobKey:packet.jobKey,inputArtifactHash:packet.inputArtifactHash,profileHash:e.profileHash,profile:e.profile,sourceTextHash:e.source.textHash,originalPart:e.source.part,normalizedText:e.reading.normalizedText,normalizedTextSha256:e.reading.normalizedTextSha256,previewHash:e.reading.previewHash};
console.log(JSON.stringify({packet,raw,identity}));`],{encoding:'utf8'}))
}
function nodeAccepts(input: ReturnType<typeof fixture>) {
  return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`
import {readFileSync} from 'node:fs';import {verifyProductResult} from './scripts/ttrpg-local-tts/product-contract.mjs';
const {packet,raw}=JSON.parse(readFileSync(0,'utf8'));let accepted=false;try{verifyProductResult(raw.result,Buffer.from(raw.audio.data,'base64'),packet);accepted=true;}catch{}console.log(JSON.stringify(accepted));
`],{input:JSON.stringify(input),encoding:'utf8'}))
}
describe('R-TTRPGOPEN10 browser original-result physical validation', () => {
  it.each([false,true])('matches the Node physical verifier for a complete original%s profile without trusting today’s implementation hash', async historical => {
    const f=fixture(historical), before=JSON.stringify(f)
    expect(nodeAccepts(f)).toBe(true)
    const result=await verifyTtrpgOpenVoiceRawResultForKernelV1(JSON.stringify(f.raw),f.identity)
    expect(result.audio).toMatchObject({contentHash:f.raw.result.audio.sha256,byteLength:f.raw.result.audio.byteSize,durationMs:100})
    expect(result.timeline).toMatchObject({kind:'normalized-reading-segments',wordAlignmentProvided:false,samples:4410})
    expect(result.timeline.segments).toEqual(f.raw.result.alignment.segments)
    expect(result.usage).toEqual(f.raw.result.usage);expect(result.metrics).toEqual(f.raw.result.metrics)
    expect(result.bytes.byteLength).toBe(f.raw.result.audio.byteSize);expect(JSON.stringify(f)).toBe(before)
  })
  it.each(['input','source','reading','implementation','size','sha','samples','duration','segment-offset','segment-samples','segment-hash','usage','rms','peak','extra','pcm-silent','pcm-header'] as const)('both runtimes reject corrupted %s proof', async field => {
    const f=fixture(), r=f.raw.result
    if(field==='input')r.inputArtifactHash='0'.repeat(64)
    if(field==='source')r.sourceTextHash='0'.repeat(64)
    if(field==='reading')r.normalizedTextSha256='0'.repeat(64)
    if(field==='implementation')r.implementationHash='0'.repeat(64)
    if(field==='size')r.audio.byteSize++
    if(field==='sha')r.audio.sha256='0'.repeat(64)
    if(field==='samples')r.audio.samples++
    if(field==='duration')r.audio.durationMs++
    if(field==='segment-offset')r.alignment.segments[0].sampleOffset++
    if(field==='segment-samples')r.alignment.segments[0].sampleCount--
    if(field==='segment-hash')r.alignment.segments[0].textSha256='0'.repeat(64)
    if(field==='usage')r.usage.speechCallsCompleted=0
    if(field==='rms')r.metrics.rms=0
    if(field==='peak')r.metrics.peak=1
    if(field==='extra')r.extraAuthority=true
    if(field==='pcm-silent'||field==='pcm-header') {
      const bytes=Buffer.from(f.raw.audio.data,'base64')
      if(field==='pcm-silent')bytes.fill(0,44)
      else bytes[8]=0
      r.audio.sha256=createHash('sha256').update(bytes).digest('hex');f.raw.audio.data=bytes.toString('base64')
    }
    expect(nodeAccepts(f)).toBe(false)
    await expect(verifyTtrpgOpenVoiceRawResultForKernelV1(JSON.stringify(f.raw),f.identity)).rejects.toBeInstanceOf(TtrpgOpenVoiceResultErrorV1)
  })
  it.each(['injected','missing-completion','base64-whitespace','base64-padding','false-adoption','invalid-json'] as const)('rejects invalid envelope %s before making it a product candidate', async kind => {
    const f=fixture()
    if(kind==='injected')f.raw.workerExecutionKind='injected-test-worker'
    if(kind==='missing-completion')delete f.raw.completionEvidence
    if(kind==='base64-whitespace')f.raw.audio.data+='\n'
    if(kind==='base64-padding')f.raw.audio.data=f.raw.audio.data.slice(0,-2)+'B='
    if(kind==='false-adoption')f.raw.adoptionAllowed=true
    const raw=kind==='invalid-json'?'\uFEFF not audio JSON':JSON.stringify(f.raw)
    await expect(verifyTtrpgOpenVoiceRawResultForKernelV1(raw,f.identity)).rejects.toBeInstanceOf(TtrpgOpenVoiceResultErrorV1)
  })
})
