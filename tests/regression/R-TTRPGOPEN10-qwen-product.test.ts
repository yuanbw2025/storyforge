/** Isolated governed inputs and synthetic PCM. No neural calls/listening proof. */
import { beforeEach, afterEach, expect, it, vi, describe } from 'vitest'
import { execFileSync } from 'node:child_process'
import { db } from '../../src/lib/db/schema'
import { setupLocalVoiceExecutionV1 } from '../helpers/open-local-voice'
import { prepareTtrpgOpenLocalVoiceExecutionV1, readTtrpgOpenLocalVoicePreparationV1 } from '../../src/lib/ttrpg/open-voice-execution'
import * as runs from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { verifyTtrpgOpenVoiceRawResultForKernelV1 } from '../../src/lib/ttrpg/open-voice-result'
import { parseTtrpgOpenVoiceSampleClockV1, verifyTtrpgOpenGeneratedVoiceTimeline } from '../../src/lib/ttrpg/open-voice-timeline-contract'
import { saveTtrpgNarratorVoiceV1 } from '../../src/lib/ttrpg/narration-listening-preferences'
import { currentTtrpgOpenVoiceProductProfileV1 } from '../../src/lib/ttrpg/open-voice-product-profile'

describe('Qwen durable product binding and synthetic physical evidence', { timeout: 60000 }, () => {
beforeEach(async () => { localStorage.clear(); await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); db.close() })
async function prepared(voice: 'qwen.uncle_fu' | 'qwen.serena' = 'qwen.uncle_fu') {
  const f = await setupLocalVoiceExecutionV1(), ready = await prepareTtrpgOpenLocalVoiceExecutionV1({ ...f.input, voice })
  const content = await readAgentRunArtifactExactV1({ projectId: f.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: ready.inputArtifactHash })
  const packet = { jobKey: `ttrpg.voice.${ready.runId}.${ready.inputArtifactHash}`, inputArtifactHash: ready.inputArtifactHash, execution: JSON.parse(content) }
  return { f, ready, packet }
}
function raw(packet: unknown) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import {readFileSync} from 'node:fs';import {syntheticResult} from './tests/helpers/local-voice-product-fixture.mjs';
import {validateProductJob,verifyProductResult} from './scripts/ttrpg-local-tts/product-contract.mjs';
const input=validateProductJob(JSON.parse(readFileSync(0,'utf8'))),{bytes,result}=syntheticResult(input);
verifyProductResult(result,bytes,input);
console.log(JSON.stringify({schema:'storyforge.ttrpg-local-tts-product-raw-response',version:1,result,
workerExecutionKind:'pinned-offline-worker',completionEvidence:'observed-child-close',cancellationRequested:false,
audio:{encoding:'base64',data:bytes.toString('base64')},candidateAccepted:false,adoptionAllowed:false}));
`], { input: JSON.stringify(packet), encoding: 'utf8' }))
}
function identity(packet: Awaited<ReturnType<typeof prepared>>['packet']) {
  const e = packet.execution
  return { ...packet, profile: e.profile, profileHash: e.profileHash, sourceTextHash: e.source.textHash, originalPart: e.source.part,
    normalizedText: e.reading.normalizedText, normalizedTextSha256: e.reading.normalizedTextSha256, previewHash: e.reading.previewHash }
}
it('freezes the explicitly selected speaker once; changed browser or prepare preferences cannot rewrite the same child', async () => {
  const { f, ready, packet } = await prepared()
  expect(packet.execution.profile).toMatchObject({ version: 3, speaker: 'uncle_fu', sampleRate: 24000, maxTextEncoderCalls: 0 })
  saveTtrpgNarratorVoiceV1('qwen.serena')
  expect(await readTtrpgOpenLocalVoicePreparationV1(f.input)).toEqual(ready)
  expect(await prepareTtrpgOpenLocalVoiceExecutionV1({ ...f.input, voice: 'qwen.serena' })).toEqual(ready)
  expect(await db.agentRuns.count()).toBe(2)
  expect((await db.agentRunEvents.toArray()).some(e => e.type === 'model.requested')).toBe(false)
  expect(await db.productMediaAssets.count()).toBe(0)
})
it('recovers a created-but-unreturned original child by its committed input hash, even after the voice preference changes', async () => {
  const f = await setupLocalVoiceExecutionV1(), create = runs.createAgentRunV1
  vi.spyOn(runs, 'createAgentRunV1').mockImplementationOnce(async input => { await create(input); throw Error('lost-original-create') })
  await expect(prepareTtrpgOpenLocalVoiceExecutionV1({ ...f.input, voice: 'qwen.uncle_fu' })).rejects.toThrow('lost-original-create')
  vi.restoreAllMocks()
  const ready = await prepareTtrpgOpenLocalVoiceExecutionV1({ ...f.input, voice: 'qwen.serena' })
  const content = await readAgentRunArtifactExactV1({ projectId: f.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: ready.inputArtifactHash })
  expect(JSON.parse(content).profile.speaker).toBe('uncle_fu'); expect(await db.agentRuns.count()).toBe(2)
})
it('accepts complete native 24k PCM through Node and browser, preserving explicit V2 timing while V1 stays 44.1k only', async () => {
  const { packet } = await prepared('qwen.serena'), envelope = raw(packet)
  const value = await verifyTtrpgOpenVoiceRawResultForKernelV1(JSON.stringify(envelope), identity(packet))
  expect(value.timeline.sampleRate).toBe(24000); expect(value.usage.textEncoderCallsCompleted).toBe(0)
  expect(() => parseTtrpgOpenVoiceSampleClockV1(value.timeline, packet.execution.reading.normalizedText)).toThrow()
  const timeline = await verifyTtrpgOpenGeneratedVoiceTimeline({ schema: 'storyforge.ttrpg-open-generated-voice-timeline', version: 2,
    sourceTextHash: packet.execution.source.textHash, sourceTextLengthUtf16: packet.execution.source.text.length,
    normalizedText: packet.execution.reading.normalizedText, normalizedTextSha256: packet.execution.reading.normalizedTextSha256, clock: value.timeline },
  packet.execution.source.text, { mimeType: 'audio/wav', byteSize: value.audio.byteLength, durationMs: value.audio.durationMs })
  expect(timeline.version).toBe(2); expect(timeline.clock.samples).toBe(3840)
})
it('rejects the wrong native speaker, false EOS, missing frame, old over-budget peak and invented encoder calls', async () => {
  const { packet } = await prepared(), valid = raw(packet)
  for (const change of [
    (r: any) => { r.native.speaker = 'serena' }, (r: any) => { r.native.segments[0].eosObserved = false },
    (r: any) => { r.native.segments[0].codecTokens++ }, (r: any) => { r.native.peakMetalBytes = 7296809999 },
    (r: any) => { r.native.memoryChecks = 0 }, (r: any) => { r.usage.textEncoderCallsCompleted = 1 },
  ]) {
    const envelope = structuredClone(valid); change(envelope.result)
    await expect(verifyTtrpgOpenVoiceRawResultForKernelV1(JSON.stringify(envelope), identity(packet))).rejects.toThrow()
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', `
import {readFileSync} from 'node:fs';import {verifyProductResult} from './scripts/ttrpg-local-tts/product-contract.mjs';
const v=JSON.parse(readFileSync(0,'utf8'));try{verifyProductResult(v.envelope.result,Buffer.from(v.envelope.audio.data,'base64'),v.packet);console.log('accepted')}catch{console.log('rejected')}
`], { input: JSON.stringify({ envelope, packet }), encoding: 'utf8' }).trim()).toBe('rejected')
  }
})
it('does not turn arbitrary person/model names into a profile, and retains the old basic voice as an explicit option', () => {
  expect(() => currentTtrpgOpenVoiceProductProfileV1('person.cloned' as any)).toThrow()
  expect(currentTtrpgOpenVoiceProductProfileV1('melo.zh')).toMatchObject({ version: 2, speaker: 'ZH', sampleRate: 44100 })
})

})
