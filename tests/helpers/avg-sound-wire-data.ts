import { createHash } from 'node:crypto'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { readFileSync } from 'node:fs'
// Node/Vitest/Playwright share pinned source metadata without requiring a
// browser module loader or JSON import attributes in the test runner.
const catalogue = JSON.parse(readFileSync('scripts/avg-local-music/library-source.json', 'utf8')) as typeof import('../../scripts/avg-local-music/library-source.json').default
const modelSource = JSON.parse(readFileSync('scripts/avg-local-music/model-source.json', 'utf8')) as typeof import('../../scripts/avg-local-music/model-source.json').default
const AVG_LOCAL_MUSIC_MODEL_V1 = `${modelSource.repository}@${modelSource.revision}`
const AVG_LOCAL_MUSIC_CODE_REVISION_V1 = modelSource.codeRevision
const AVG_LOCAL_MUSIC_PROFILE_V1 = 'storyforge.avg.instrumental-evaluation-v1'

/** Original engineering PCM plus one verbatim CC0 OGG. Protocol fixtures,
 * never actual neural inference, browser hearing or author adoption proof. */
export const avgSoundCapabilityFixtureV1 = () => ({ schema: 'storyforge.avg.local-music-capability', version: 2 as const, journalId: 'b'.repeat(64),
  adapterId: 'storyforge.avg.local-music.v1', model: AVG_LOCAL_MUSIC_MODEL_V1, runtimeCodeRevision: AVG_LOCAL_MUSIC_CODE_REVISION_V1,
  profile: AVG_LOCAL_MUSIC_PROFILE_V1, bridgeHash: 'a'.repeat(64), executionLocation: 'loopback-local', device: 'cpu',
  minimumSeconds: 10, maximumSeconds: 30, sampleRateHz: 48000, channels: 2, pcmBits: 16, maximumModelCalls: 1, automaticRetries: 0,
  maximumDeadlineSeconds: 900, supplierCostUsd: 0, chargeScope: 'local inference; device, power and labor excluded',
  modelLoadObservation: 'not-asserted-by-capability', hearing: 'unobserved', deadlineSeconds: 900 })
export function avgSoundPcmFixtureV1(seconds = 12) {
  const frames = 48000 * seconds, bytes = new Uint8Array(44 + frames * 4), v = new DataView(bytes.buffer)
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i)
  v.setUint32(4, bytes.length - 8, true); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true)
  v.setUint32(24, 48000, true); v.setUint32(28, 192000, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); v.setUint32(40, frames * 4, true)
  for (let i = 0; i < frames; i++) { const sample = Math.round(Math.sin(i / 10) * 8000); v.setInt16(44 + i * 4, sample, true); v.setInt16(46 + i * 4, sample, true) }
  return bytes.buffer
}
export const avgSoundLibraryFixtureV1 = () => {
  const archive = catalogue.archives[0], member = archive.members.find(m => m.memberPath === 'Audio/click_001.ogg')!
  const bytes = readFileSync('tests/fixtures/avg-audio/kenney-click_001.ogg')
  return { archive, member, data: Uint8Array.from(bytes).buffer,
    source: { sourceKey: 'fixture.click', publisherPage: archive.publisherPage, license: 'CC0-1.0' as const,
      archiveHash: archive.archiveHash, memberPath: member.memberPath, memberHash: member.memberHash },
    result: { schema: 'storyforge.avg.licensed-audio-result', version: 1, publisherPage: archive.publisherPage, license: catalogue.license,
      archiveHash: archive.archiveHash, archiveBytes: archive.archiveBytes, licenseMember: archive.licenseMember, licenseHash: archive.licenseHash,
      licenseText: archive.licenseText, ...member, inferenceCalls: 0, supplierCostUsd: 0, originalBytes: true, transcoded: false, hearing: 'unobserved', authorAdopted: false } }
}

/** Original engineering response DTO from the exact observed request and
 * original test PCM. No Run, author adoption, inference or hearing is seeded. */
export async function avgSoundMusicResultFixtureV1(input: {
  capability: ReturnType<typeof avgSoundCapabilityFixtureV1>; data: ArrayBuffer; body: { durationSeconds: number }; idempotencyKey: string; wrongHash?: boolean
}) {
  const c = input.capability, digest = (value: string | ArrayBuffer) => createHash('sha256').update(typeof value === 'string' ? value : new Uint8Array(value)).digest('hex')
  const jobId = digest(input.idempotencyKey)
  return { schema: 'storyforge.avg.local-music-result', version: 2, jobId, journalId: c.journalId,
    requestHash: await hashProductProductionValueV2(input.body), bridgeHash: c.bridgeHash,
    model: c.model, runtimeCodeRevision: c.runtimeCodeRevision, profile: c.profile, device: 'cpu', modelCalls: 1,
    supplierCostUsd: 0, chargeScope: c.chargeScope, audio: { sha256: input.wrongHash ? 'f'.repeat(64) : digest(input.data),
      bytes: input.data.byteLength, durationMs: input.body.durationSeconds * 1000, sampleRateHz: 48000, channels: 2, pcmBits: 16,
      sampleFrames: input.body.durationSeconds * 48000 }, floatSHA256: '1'.repeat(64), sourceHash: '2'.repeat(64), modelHash: '3'.repeat(64),
    waveletBackend: 'storyforge.haar-dcw-v1', waveletSteps: 8, inferenceSeconds: .1, peakAmplitude: .244, rmsAmplitude: .173,
    hearing: 'unobserved', rightsReview: 'unreviewed', authorAdopted: false }
}
