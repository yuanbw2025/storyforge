// Synthetic protocol/PCM only. No weights/dependencies are copied and no model
// is called. The manager marks every injected worker result as test evidence.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { base, stable, digest, productProfile } from '../../scripts/ttrpg-local-tts/product-contract.mjs'

export function syntheticJob(id = 1, selectedProfile = productProfile) {
  const text = '门口的灯还亮着。', normalized = '门口的灯还亮着.', readingProfile = JSON.parse(readFileSync(path.join(base, 'reading-profile.json'), 'utf8'))
  const ref = { sessionKey: 'session.synthetic', sequence: 1 }, part = { textOffset: 0, textLength: text.length, textHash: digest(text) }
  const preview = { schema: 'storyforge.ttrpg-local-tts-reading-preview', version: 1, profileHash: digest(stable(readingProfile)), normalizerSha256: readingProfile.normalizerSha256,
    status: 'ready-for-reading-review', sourceText: text, sourceTextSha256: digest(text), overrides: [], readingText: text, normalizedText: normalized, normalizedTextSha256: digest(normalized), issues: [], issueCount: 0,
    issueOffsetsReferTo: 'readingText-utf16', modelCalled: false, generationAllowed: false, adoptionAllowed: false, network: 'disabled' }
  const execution = { schema: 'storyforge.ttrpg-open-voice-execution-input', version: 1, requestKey: 'synthetic.voice.' + id, decision: 'prepare-this-confirmed-local-voice-execution',
    intent: { inputArtifactHash: 'a'.repeat(64), receiptHash: 'b'.repeat(64), verificationArtifactHash: 'c'.repeat(64) },
    source: { text, textHash: part.textHash, scriptHash: 'd'.repeat(64), part, narrationSourceRef: ref, reservationSourceRef: { ...ref, sequence: 2 },
      scope: { schema: 'storyforge.ttrpg-open-audio-scope', version: 1, authorizationRef: ref, issuerSeatKey: 'seat.gm', issuerViewerKey: 'viewer.gm', audience: 'party', privateActorKey: null,
        recipients: [{ seatKey: 'seat.gm', viewerKey: 'viewer.gm', actorKey: null, role: 'gm', controller: 'human' }] } },
    reading: { schema: 'storyforge.ttrpg-open-confirmed-voice-reading', version: 1, decision: 'confirm-this-exact-local-voice-reading', sourceTextHash: part.textHash,
      profile: readingProfile, profileHash: preview.profileHash, normalizerSha256: preview.normalizerSha256, overrides: [], normalizedText: normalized, normalizedTextSha256: digest(normalized), previewHash: digest(stable(preview)) },
    profile: JSON.parse(stable(selectedProfile)), profileHash: digest(stable(selectedProfile)) }
  const inputArtifactHash = digest(stable(execution))
  return { jobKey: `ttrpg.voice.${id}.${inputArtifactHash}`, inputArtifactHash, execution }
}
export function syntheticRuntime() {
  const parent = process.env.STORYFORGE_TTRPG_TTS_TEST_ARTIFACT_DIR || tmpdir(); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(path.join(parent, 'local-voice-protocol-'))
  const bytes = readFileSync(path.join(base, 'runtime-profile.json'))
  writeFileSync(path.join(dir, 'runtime-profile.json'), bytes)
  writeFileSync(path.join(dir, 'owner.json'), stable({ profileId: productProfile.assetProfileId, profileHash: productProfile.assetProfileSha256, fixtureOnly: true }))
  writeFileSync(path.join(dir, 'setup-receipt.json'), stable({ profileHash: productProfile.assetProfileSha256, status: 'passed', fixtureOnly: true }))
  return dir
}
export function fakeChild() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.signals = []; child.kill = signal => { child.signals.push(signal); return true }; return child
}
export function syntheticResult(input, samples = input.execution.profile.version === 3 ? 3840 : 4410) {
  const p = input.execution.profile, qwen = p.version === 3
  const bytes = Buffer.alloc(44 + samples * 2), sr = p.sampleRate
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sr, 24); bytes.writeUInt32LE(sr * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  let sum = 0, peak = 0
  for (let i = 0; i < samples; i++) { const sample = Math.round(Math.sin(i * .1) * 6000); bytes.writeInt16LE(sample, 44 + i * 2); const value = sample / 32767; sum += value * value; peak = Math.max(peak, Math.abs(value)) }
  const result = { schema: 'storyforge.ttrpg-local-tts-product-result', version: qwen ? 2 : 1, status: 'generated', jobKey: input.jobKey, inputArtifactHash: input.inputArtifactHash,
    profileHash: input.execution.profileHash, implementationHash: digest(stable(input.execution.profile.implementation)), sourceTextHash: input.execution.source.textHash,
    normalizedTextSha256: input.execution.reading.normalizedTextSha256, previewHash: input.execution.reading.previewHash,
    audio: { mimeType: 'audio/wav', byteSize: bytes.length, sha256: digest(bytes), sampleRate: sr, channels: 1, sampleFormat: 's16le', samples, durationMs: Math.round(samples * 1000 / sr) },
    alignment: { kind: 'normalized-reading-segments', wordAlignmentProvided: false, originalPart: input.execution.source.part,
      segments: [{ index: 0, readingOffsetUtf16: 0, readingLengthUtf16: input.execution.reading.normalizedText.length, textSha256: input.execution.reading.normalizedTextSha256, sampleOffset: 0, sampleCount: samples, gain: 1 }] },
    usage: { textEncoderCallsStarted: qwen ? 0 : 1, textEncoderCallsCompleted: qwen ? 0 : 1, speechCallsStarted: 1, speechCallsCompleted: 1 }, metrics: { wallMs: 1, cpuMs: 1, maxRssBytes: 1, rms: Math.sqrt(sum / samples), peak },
    network: 'disabled', candidateAccepted: false, adoptionAllowed: false, humanListening: 'unproven' }
  if (qwen) result.native = { kind: 'qwen3-tts-native-v1', speaker: p.speaker, assetProfileSha256: p.nativeAssetProfileSha256,
    memoryGuidelineBytes: p.gpuMemoryLimitBytes, peakMetalBytes: 4000000000, memoryChecks: samples / 1920 + 2,
    segments: [{ index: 0, codecTokens: samples / 1920, eosObserved: true }] }
  return { bytes, result }
}
export function writeSyntheticResult(dir, input) { const r = syntheticResult(input); writeFileSync(path.join(dir, 'audio.wav'), r.bytes); writeFileSync(path.join(dir, 'result.json'), stable(r.result)); return r }
