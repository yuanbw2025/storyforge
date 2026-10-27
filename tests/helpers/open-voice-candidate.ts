/** Real isolated Run/source/recipient commands. Synthetic PCM, never a model
 * invocation, real hearing or production adoption. */
import { execFileSync } from 'node:child_process'
import { vi } from 'vitest'
import { setupLocalVoiceExecutionV1 } from './open-local-voice'
import { prepareTtrpgOpenLocalVoiceExecutionV1 } from '../../src/lib/ttrpg/open-audio-service'
import { dispatchTtrpgOpenLocalVoiceForKernelV1 } from '../../src/lib/ttrpg/open-voice-execution'
import type { TtrpgNarratorVoiceV1 } from '../../src/lib/ttrpg/narration-listening-preferences'

export async function setupVoiceCandidateFixtureV1(valid = true, humanGm = true, voice?: TtrpgNarratorVoiceV1) {
  const f=await setupLocalVoiceExecutionV1(true,humanGm), prepared=await prepareTtrpgOpenLocalVoiceExecutionV1({...f.input,voice})
  const execute=vi.fn(async (packet: unknown) => valid ? execFileSync(process.execPath,['--input-type=module','-e',`
import {readFileSync} from 'node:fs';import {syntheticResult} from './tests/helpers/local-voice-product-fixture.mjs';
const input=JSON.parse(readFileSync(0,'utf8')),{bytes,result}=syntheticResult(input);
console.log(JSON.stringify({schema:'storyforge.ttrpg-local-tts-product-raw-response',version:1,result,workerExecutionKind:'pinned-offline-worker',completionEvidence:'observed-child-close',cancellationRequested:false,audio:{encoding:'base64',data:bytes.toString('base64')},candidateAccepted:false,adoptionAllowed:false}));
`],{input:JSON.stringify(packet),encoding:'utf8'}) : 'original invalid audio retained verbatim')
  await dispatchTtrpgOpenLocalVoiceForKernelV1({ ...f.input,decision:'dispatch-this-original-local-voice-execution',transport:{kind:'local-offline-speech-v1',profileHash:prepared.profileHash,execute} })
  const fetcher=vi.fn(async () => { throw new Error('candidate-must-not-fetch') });vi.stubGlobal('fetch',fetcher)
  return { ...f,prepared,execute,fetcher,review:{...f.input,decision:'review-this-original-local-voice-result' as const} }
}
