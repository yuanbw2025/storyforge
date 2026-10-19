import catalogue from '../../../scripts/avg-local-music/library-source.json'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { sha256MediaData } from '../product-production/media-blob-store'
import { avgHash, avgNumber, avgRecord } from './protocol-validation'
import { AVG_LOCAL_MUSIC_MODEL_V1, AVG_LOCAL_MUSIC_CODE_REVISION_V1, AVG_LOCAL_MUSIC_PROFILE_V1, compileAvgSoundRequirementsV1 } from './sound-requirements'
import { inspectAvgVoiceWaveV1 } from './voice-wave'
import type { AvgSoundLibrarySourceV1 } from './sound-scope-contract'

export const AVG_LOCAL_SOUND_BASE_URL_V1 = 'http://127.0.0.1:5298/v1'
export const AVG_LOCAL_MUSIC_ADAPTER_V1 = 'storyforge.avg.local-music.v1'
export type AvgCompiledSoundRequirementV1 = Awaited<ReturnType<typeof compileAvgSoundRequirementsV1>>['requirements'][number]
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
export const hashAvgSoundBytesV1 = (data: ArrayBuffer) => sha256MediaData(data)

/** Provider identity is not a loaded-model, licence, hearing or author pass. */
export function parseAvgLocalMusicCapabilityV1(value: unknown) {
  const version = (value as { version?: unknown } | null)?.version
  const r = avgRecord(value, ['schema', 'version', 'adapterId', 'model', 'runtimeCodeRevision', 'profile', 'bridgeHash', 'executionLocation', 'device',
    'minimumSeconds', 'maximumSeconds', 'sampleRateHz', 'channels', 'pcmBits', 'maximumModelCalls', 'automaticRetries',
    'maximumDeadlineSeconds', 'supplierCostUsd', 'chargeScope', 'modelLoadObservation', 'hearing', 'deadlineSeconds', ...(version === 2 ? ['journalId'] : [])], 'local music capability')
  if (version !== 1 && version !== 2) throw new Error('[avg-sound] 本机音乐协议版本无效')
  const fixed = { schema: 'storyforge.avg.local-music-capability', version, adapterId: AVG_LOCAL_MUSIC_ADAPTER_V1,
    model: AVG_LOCAL_MUSIC_MODEL_V1, runtimeCodeRevision: AVG_LOCAL_MUSIC_CODE_REVISION_V1, profile: AVG_LOCAL_MUSIC_PROFILE_V1,
    executionLocation: 'loopback-local', device: 'cpu', minimumSeconds: 10, maximumSeconds: 30, sampleRateHz: 48000, channels: 2,
    pcmBits: 16, maximumModelCalls: 1, automaticRetries: 0, maximumDeadlineSeconds: 900, supplierCostUsd: 0,
    chargeScope: 'local inference; device, power and labor excluded', modelLoadObservation: 'not-asserted-by-capability', hearing: 'unobserved' }
  if (Object.entries(fixed).some(([key, v]) => r[key] !== v)) throw new Error('[avg-sound] 本机音乐服务不是准确冻结模型/CPU/单次协议')
  return { ...fixed, ...(version === 2 ? { journalId: avgHash(r.journalId, 'original music journal') } : {}),
    bridgeHash: avgHash(r.bridgeHash, 'music bridge source hash'), deadlineSeconds: avgNumber(r.deadlineSeconds, 'music deadline', 30, 900) }
}
export async function avgLocalMusicRouteV1(capability: ReturnType<typeof parseAvgLocalMusicCapabilityV1>) {
  const endpointRouteHash = await hashProductProductionValueV2({ schema: 'storyforge.avg.local-music-route', version: 1,
    method: 'POST', endpoint: `${AVG_LOCAL_SOUND_BASE_URL_V1}/audio/music`, model: AVG_LOCAL_MUSIC_MODEL_V1 })
  return { endpointRouteHash, bindingHash: await hashProductProductionValueV2({ schema: 'storyforge.avg.local-music-binding', version: 1,
    endpointRouteHash, capability }) }
}

/** Original pinned CC0 source metadata. This comparison never proves audio
 * bytes or decodability and never converts a catalogue entry into adoption. */
export function assertAvgSoundLibraryMetadataV1(s: AvgSoundLibrarySourceV1) {
  const archive = catalogue.archives.find(a => a.archiveHash === s.archiveHash)
  const member = archive?.members.find(m => m.memberPath === s.memberPath && m.memberHash === s.memberHash)
  if (!archive || !member || s.publisherPage !== archive.publisherPage || s.license !== catalogue.license) throw new Error('[avg-sound] 来源不在已核验原发布者CC0目录中')
  return { archive, member }
}
export function assertAvgLicensedSoundSourceV1(requirement: AvgCompiledSoundRequirementV1) {
  if (requirement.dispatch.operation !== 'import-licensed-audio') throw new Error('[avg-sound] 不是准确原音效导入')
  return assertAvgSoundLibraryMetadataV1(requirement.dispatch.source)
}

/** Metadata choices only. The raw producer still verifies archive, licence,
 * exact original member bytes and decoder before any review or selection. */
export function listAvgSoundLibraryMetadataV1(): AvgSoundLibrarySourceV1[] {
  return catalogue.archives.flatMap(archive => archive.members.map((member, index) => ({
    sourceKey: `kenney.${archive.key}.${index}`, publisherPage: archive.publisherPage, license: 'CC0-1.0' as const,
    archiveHash: archive.archiveHash, memberPath: member.memberPath, memberHash: member.memberHash,
  })))
}

/** Called against exact original HTTP bytes again during sealed admission. */
export async function validateAvgSoundProviderResultV1(input: { requirement: AvgCompiledSoundRequirementV1; data: ArrayBuffer;
  result: unknown; jobId: string | null; bridgeHash: string | null; providerJournalId?: string | null }) {
  const { requirement: req, data } = input, hash = await hashAvgSoundBytesV1(data)
  if (req.dispatch.operation === 'generate-music') {
    const version = input.providerJournalId ? 2 : 1
    const r = avgRecord(input.result, ['schema', 'version', 'jobId', ...(version === 2 ? ['journalId'] : []), 'requestHash', 'bridgeHash', 'model', 'runtimeCodeRevision', 'profile', 'device',
      'modelCalls', 'supplierCostUsd', 'chargeScope', 'audio', 'floatSHA256', 'sourceHash', 'modelHash', 'waveletBackend', 'waveletSteps',
      'inferenceSeconds', 'peakAmplitude', 'rmsAmplitude', 'hearing', 'rightsReview', 'authorAdopted'], 'original local music result')
    if (r.schema !== 'storyforge.avg.local-music-result' || r.version !== version || version === 2 && r.journalId !== input.providerJournalId
      || r.jobId !== input.jobId || r.bridgeHash !== input.bridgeHash
      || r.model !== AVG_LOCAL_MUSIC_MODEL_V1 || r.runtimeCodeRevision !== AVG_LOCAL_MUSIC_CODE_REVISION_V1 || r.profile !== AVG_LOCAL_MUSIC_PROFILE_V1
      || r.device !== 'cpu' || r.modelCalls !== 1 || r.supplierCostUsd !== 0 || r.chargeScope !== 'local inference; device, power and labor excluded'
      || r.hearing !== 'unobserved' || r.rightsReview !== 'unreviewed' || r.authorAdopted !== false
      || r.waveletBackend !== 'storyforge.haar-dcw-v1'
      || r.requestHash !== await hashProductProductionValueV2(req.dispatch.body)) throw new Error('[avg-sound] 原音乐身份/请求/调用或观察状态不闭合')
    avgHash(r.jobId, 'original music job'); avgHash(r.bridgeHash, 'original music bridge')
    for (const key of ['floatSHA256', 'sourceHash', 'modelHash']) avgHash(r[key], key)
    avgNumber(r.waveletSteps, 'actual wavelet steps', 1, 100)
    avgNumber(r.inferenceSeconds, 'actual inference seconds', 0, 900, false)
    avgNumber(r.peakAmplitude, 'original music peak', .00001, 1.00001, false)
    avgNumber(r.rmsAmplitude, 'original music RMS', .00001, 1.00001, false)
    const wave = inspectAvgVoiceWaveV1(data, 30_500)
    const audio = { sha256: hash, bytes: data.byteLength, durationMs: wave.durationMs, sampleRateHz: wave.sampleRateHz,
      channels: wave.channelCount, pcmBits: 16, sampleFrames: wave.sampleCount }
    if (wave.sampleRateHz !== 48000 || wave.channelCount !== 2 || Math.abs(wave.durationMs - req.dispatch.body.durationSeconds * 1000) > 500
      || !same(r.audio, audio)) throw new Error('[avg-sound] 原音乐WAV真实字节/声道/时长与回执不一致')
    return { mimeType: 'audio/wav' as const, contentHash: hash, result: r }
  }
  const { archive, member } = assertAvgLicensedSoundSourceV1(req)
  const expected = { schema: 'storyforge.avg.licensed-audio-result', version: 1,
    publisherPage: archive.publisherPage, license: catalogue.license, archiveHash: archive.archiveHash, archiveBytes: archive.archiveBytes,
    licenseMember: archive.licenseMember, licenseHash: archive.licenseHash, licenseText: archive.licenseText,
    ...member, inferenceCalls: 0, supplierCostUsd: 0, originalBytes: true, transcoded: false, hearing: 'unobserved', authorAdopted: false }
  if (!same(input.result, expected) || data.byteLength !== member.bytes || hash !== member.memberHash
    || String.fromCharCode(...new Uint8Array(data).subarray(0, 4)) !== 'OggS') throw new Error('[avg-sound] 原库音频、包内许可或成员字节不一致')
  return { mimeType: 'audio/ogg' as const, contentHash: hash, result: expected }
}
