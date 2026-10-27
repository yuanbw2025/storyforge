import type { FrozenRuntimeMediaAssetV2, ProductBuildArtifactRecordV1, ProviderCapabilityRequirementV1 } from '../types'
import { canonicalStringify } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { avgEnum, avgHash, avgKey, avgNumber, avgRecord } from './protocol-validation'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { assertAvgVoiceAssemblyRequestsV3, assertAvgVoiceCapabilityDeclarationV1, avgRawVoiceArtifactKeyV1, type AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { parseAvgVoiceProductionBatchV1, type AvgVoicePresetV1, type AvgVoiceRequirementV1 } from './voice-production-contract'
import type { AvgVoiceSpeechRequestV1 } from './voice-request-contract'
import { AVG_VOICE_DECODER_V1, type AvgVoiceByteMeasurementV1 } from './voice-wave'
import { decodeAvgVoiceExactStorageV1, encodeAvgVoiceExactStorageV1 } from './voice-exact-storage'

export interface AvgRawVoicePayloadV1 {
  schema: 'storyforge.avg.raw-voice'
  version: 1
  sourceInputHash: string
  requirement: AvgVoiceRequirementV1
  preset: AvgVoicePresetV1
  request: AvgVoiceSpeechRequestV1
  measurement: AvgVoiceByteMeasurementV1
  capabilityBindingHash: string
  provider: { providerRequestId: string | null; executionLocation: 'browser-direct'; costUsd: number | null; usage: unknown }
  rights: { origin: 'generated'; basis: 'provider-preset'; presetKey: string; presetRevision: number;
    declaration: string; reference: string; rightsPolicyVersion: string; requiresProviderTermsReview: true; commercialUse: null }
}

export type AvgVoiceRightsReceiptV1 = Omit<AvgRawVoicePayloadV1['rights'], 'declaration' | 'reference'> & {
  schema: 'storyforge.avg.voice-rights-receipt'
  version: 1
  declarationHash: string
  referenceHash: string
}

/** Exact declarations live once inside the voice packet. The ordinary
 * rights column carries portable hashes and unchanged review restrictions,
 * so its existing NFC serializer cannot rewrite a spoken/preset input. */
export async function avgVoiceRightsReceiptV1(rights: AvgRawVoicePayloadV1['rights']): Promise<AvgVoiceRightsReceiptV1> {
  const { declaration, reference, ...rest } = rights
  return { schema: 'storyforge.avg.voice-rights-receipt', version: 1, ...rest,
    declarationHash: await sha256Text(declaration), referenceHash: await sha256Text(reference) }
}

export function encodeAvgRawVoicePayloadV1(payload: AvgRawVoicePayloadV1) {
  return encodeAvgVoiceExactStorageV1('raw-voice', payload)
}

const same = (left: unknown, right: unknown) => canonicalStringify(left) === canonicalStringify(right)

export function parseAvgVoiceByteMeasurementV1(value: unknown): AvgVoiceByteMeasurementV1 {
  const r = avgRecord(value, ['decoder', 'contentHash', 'mimeType', 'byteSize', 'durationMs', 'channelCount',
    'sourceSampleRateHz', 'decodedSampleRateHz', 'sampleCount', 'integratedLufs', 'truePeakDbtp'], 'voice byte measurement')
  const result: AvgVoiceByteMeasurementV1 = {
    decoder: avgEnum(r.decoder, [AVG_VOICE_DECODER_V1], 'voice decoder'),
    contentHash: avgHash(r.contentHash, 'voice measurement hash'), mimeType: avgEnum(r.mimeType, ['audio/wav'], 'voice measurement MIME'),
    byteSize: avgNumber(r.byteSize, 'voice byte size', 44, 32 * 1024 * 1024), durationMs: avgNumber(r.durationMs, 'voice duration', 1, 120_000),
    channelCount: avgNumber(r.channelCount, 'voice channels', 1, 2),
    sourceSampleRateHz: avgNumber(r.sourceSampleRateHz, 'voice source sample rate', 8000, 48_000),
    decodedSampleRateHz: avgNumber(r.decodedSampleRateHz, 'voice decoded sample rate', 8000, 384_000),
    sampleCount: avgNumber(r.sampleCount, 'voice PCM frames', 2, 48_000 * 120),
    integratedLufs: avgNumber(r.integratedLufs, 'voice LUFS', -300, 100, false),
    truePeakDbtp: avgNumber(r.truePeakDbtp, 'voice true peak', -300, 100, false),
  }
  if (result.byteSize < 44 + result.sampleCount * result.channelCount * 2 || result.truePeakDbtp <= -100
    || Math.abs(result.durationMs - Math.max(1, Math.round(result.sampleCount / result.sourceSampleRateHz * 1000))) > 1) {
    throw new Error('[avg-voice] 配音测量的帧数、时长、字节或声音不一致')
  }
  return result
}

/** Structural/identity proof only. The sealed producer and downstream author
 * service must separately verify current Work/Build/epoch, actual response
 * evidence, Blob bytes and author audition/adoption. Never grants art/rights.
 */
export async function assertAvgRawVoiceArtifactV1(input: {
  assembly: AvgAssemblyBriefV3
  capability: ProviderCapabilityRequirementV1
  row: Pick<ProductBuildArtifactRecordV1,
    'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize'>
}): Promise<{ payload: AvgRawVoicePayloadV1; asset: FrozenRuntimeMediaAssetV2 }> {
  const { assembly, requests } = await assertAvgVoiceAssemblyRequestsV3(input.assembly)
  const capability = input.capability, row = input.row
  assertAvgVoiceCapabilityDeclarationV1(assembly, capability)
  const decoded = await decodeAvgVoiceExactStorageV1(row.payloadJson, 'raw-voice')
  const r = avgRecord(decoded.payload, ['schema', 'version', 'sourceInputHash', 'requirement', 'preset',
    'request', 'measurement', 'capabilityBindingHash', 'provider', 'rights'], 'raw voice')
  if (r.schema !== 'storyforge.avg.raw-voice' || r.version !== 1) throw new Error('[avg-voice] 原始配音版本无效')
  const single = parseAvgVoiceProductionBatchV1({ schema: 'storyforge.avg.voice-production-batch', version: 1,
    sourceInputHash: r.sourceInputHash, outputFormat: 'wav', presets: [r.preset], requirements: [r.requirement] })
  const requirement = single.requirements[0]!, preset = single.presets[0]!
  const frozen = assembly.voice.batch.requirements.find(item => item.requirementKey === requirement.requirementKey)
  const frozenPreset = assembly.voice.batch.presets.find(item => item.presetKey === preset.presetKey)
  if (single.sourceInputHash !== assembly.voice.batch.sourceInputHash || !same(requirement, frozen) || !same(preset, frozenPreset)
    || r.capabilityBindingHash !== assembly.voice.binding.bindingHash || row.artifactKey !== avgRawVoiceArtifactKeyV1(requirement.requirementKey)
    || row.kind !== 'audio' || row.mediaKind !== 'voice' || row.mimeType !== 'audio/wav') throw new Error('[avg-voice] 配音候选与冻结需求、版本或输出域不一致')
  const request = requests.find(item => item.requirementKey === requirement.requirementKey)!
  if (!same(r.request, request)) throw new Error('[avg-voice] 原始配音没有绑定准确台词、音色、演法与实际请求体')
  const measurement = parseAvgVoiceByteMeasurementV1(r.measurement)
  if (measurement.contentHash !== row.contentHash || measurement.byteSize !== row.byteSize
    || measurement.durationMs > requirement.maximumDurationMs
    || measurement.sampleCount * 1000 > requirement.maximumDurationMs * measurement.sourceSampleRateHz) throw new Error('[avg-voice] 配音实际时长、字节或 hash 超出准确候选')
  const provider = avgRecord(r.provider, ['providerRequestId', 'executionLocation', 'costUsd', 'usage'], 'voice provider receipt')
  assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: provider })
  const costUsd = provider.costUsd === null ? null : avgNumber(provider.costUsd, 'voice actual cost', 0, Number.MAX_SAFE_INTEGER, false)
  const providerRequestId = provider.providerRequestId === null ? null : avgKey(provider.providerRequestId, 'voice provider request ID')
  if (provider.executionLocation !== 'browser-direct' || capability.maximumRequestCost !== null
    && (costUsd === null || costUsd > capability.maximumRequestCost)) {
    throw new Error('[avg-voice] 配音回执的实际执行位置或费用越界')
  }
  const rights: AvgRawVoicePayloadV1['rights'] = { origin: 'generated', basis: 'provider-preset', presetKey: preset.presetKey,
    presetRevision: preset.revision, declaration: preset.rights.declaration, reference: preset.rights.reference,
    rightsPolicyVersion: capability.rightsPolicyVersion, requiresProviderTermsReview: true, commercialUse: null }
  if (!same(r.rights, rights) || !same(JSON.parse(row.rightsJson), await avgVoiceRightsReceiptV1(rights))) throw new Error('[avg-voice] 配音权利声明不属于冻结预设，或擅自签发商用通过')
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [JSON.parse(row.metadataJson)] }).assets[0]!
  const expected: FrozenRuntimeMediaAssetV2 = { assetKey: requirement.assetKey, version: 1, kind: 'voice',
    name: `配音 · ${requirement.lineKey}`, altText: `配音 · ${requirement.lineKey}`, mimeType: 'audio/wav', byteSize: measurement.byteSize,
    contentHash: measurement.contentHash, blobContentHash: measurement.contentHash, width: null, height: null,
    durationMs: measurement.durationMs, source: request.provider + ':' + assembly.voice.protocol.adapterId,
    license: `rights-policy:${capability.rightsPolicyVersion}`, characterTag: requirement.speakerKey ?? '', sceneTag: requirement.sceneKey }
  if (!same(asset, expected)) throw new Error('[avg-voice] 配音媒资元数据与准确说话人、场景或原始字节不一致')
  return { asset, payload: { schema: r.schema, version: 1, sourceInputHash: single.sourceInputHash, requirement, preset, request, measurement,
    capabilityBindingHash: avgHash(r.capabilityBindingHash, 'voice capability binding hash'), rights,
    provider: { providerRequestId, executionLocation: 'browser-direct', costUsd, usage: provider.usage } } }
}
