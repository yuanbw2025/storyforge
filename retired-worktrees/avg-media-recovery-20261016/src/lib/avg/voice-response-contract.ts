import { canonicalStringify } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import { sha256MediaData } from '../product-production/media-blob-store'
import { avgRecord } from './protocol-validation'
import type { AvgRawVoicePayloadV1 } from './voice-raw-contract'
import { inspectAvgVoiceWaveV1 } from './voice-wave'

const MAX_EVIDENCE_BYTES = 48 * 1024 * 1024
const fail = (): never => { throw new Error('[avg-voice] 原始配音响应与准确请求、音频或费用证据不一致') }

/** Validates the actual saved wire body; flags such as decoderVerified are
 * insufficient. This pure check grants no Run, adoption or voice rights. */
export async function assertAvgVoiceResponseEvidenceV1(input: { evidence: string; raw: AvgRawVoicePayloadV1 }) {
  const { evidence, raw } = input
  if (typeof evidence !== 'string' || evidence.length > MAX_EVIDENCE_BYTES
    || new TextEncoder().encode(evidence).byteLength > MAX_EVIDENCE_BYTES) fail()
  assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: evidence })
  const value: unknown = JSON.parse(evidence)
  assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: value })
  const r = avgRecord(value, ['schema', 'version', 'requestIdentityHash', 'requestBodyHash', 'endpointRouteHash',
    'status', 'contentType', 'providerRequestId', 'usage', 'costUsd', 'omissions', 'bodyComplete', 'observedBytes',
    'bodyHash', 'hashScope', 'bodyBase64', 'bodyOmitted'], 'voice response evidence')
  if (canonicalStringify(r) !== evidence || r.schema !== 'storyforge.avg.voice-provider-response' || r.version !== 1
    || r.requestIdentityHash !== raw.request.identityHash || r.requestBodyHash !== raw.request.requestBodyHash
    || r.endpointRouteHash !== raw.request.endpointRouteHash || !Number.isSafeInteger(r.status) || Number(r.status) < 200 || Number(r.status) > 299
    || !['audio/wav', 'audio/x-wav'].includes(String(r.contentType)) || r.bodyComplete !== true || r.hashScope !== 'full-body'
    || r.bodyOmitted !== null || !Array.isArray(r.omissions) || r.omissions.length
    || r.providerRequestId !== raw.provider.providerRequestId || r.costUsd !== raw.provider.costUsd
    || canonicalStringify(r.usage) !== canonicalStringify(raw.provider.usage)
    || r.bodyHash !== raw.measurement.contentHash || r.observedBytes !== raw.measurement.byteSize
    || raw.measurement.byteSize < 44 || raw.measurement.byteSize > 32 * 1024 * 1024
    || typeof r.bodyBase64 !== 'string' || r.bodyBase64.length !== 4 * Math.ceil(raw.measurement.byteSize / 3)) fail()
  // Decode and re-encode for canonical Base64. A repeating-group regexp over
  // a 32 MiB body can exhaust a browser regexp stack before validation.
  const binary = atob(r.bodyBase64 as string)
  if (binary.length !== raw.measurement.byteSize || btoa(binary) !== r.bodyBase64) fail()
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)), data = bytes.buffer
  // Check decoded content too: a Base64 envelope cannot hide forbidden text.
  const bodyText = new TextDecoder().decode(bytes)
  assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: bodyText })
  if (bodyText.trimStart().startsWith('{') || bodyText.trimStart().startsWith('[')) {
    let body: unknown
    try { body = JSON.parse(bodyText) } catch { fail() }
    assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body })
  }
  if (await sha256MediaData(data) !== raw.measurement.contentHash) fail()
  const wave = inspectAvgVoiceWaveV1(data, raw.requirement.maximumDurationMs), m = raw.measurement
  if (wave.channelCount !== m.channelCount || wave.sampleRateHz !== m.sourceSampleRateHz
    || wave.sampleCount !== m.sampleCount || Math.abs(wave.durationMs - m.durationMs) > 1) fail()
  return { responseEvidenceHash: await sha256Text(evidence), data }
}

