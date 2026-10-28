import type { ProviderCapabilityRequirementV1 } from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { AVG_ASSEMBLY_GATE_IDS_V1, avgMediaAssemblyGateIdsV2, parseAvgAssemblyBriefV1, parseAvgAssemblyBriefV2,
  type AvgAssemblyBriefV1, type AvgAssemblyBriefV2 } from './assembly-contract'
import { avgHash, avgKey, avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgVoiceProductionBatchV1, type AvgVoiceProductionBatchV1 } from './voice-production-contract'
import { compileAvgVoiceSpeechRequestV1, parseAvgSpeechProtocolV1, type AvgSpeechProtocolV1 } from './voice-request-contract'
import { parseAvgVoiceRecovery, type AvgVoiceRecovery } from './voice-local-repair-contract'

export const AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1 = 'avg.media.voice' as const

export type AvgAssemblyImageProductionV2 = Pick<AvgAssemblyBriefV2,
  'mediaBatch' | 'imageBinding' | 'imageRecovery' | 'imageProcessing'>

/** Operational V3 shape, read from an exact stored packet. New production
 * stays closed until shared execution and author adoption are wired together.
 * Speech catalog/options are declarations, not account or rights acceptance.
 */
export interface AvgAssemblyBriefV3 extends Omit<AvgAssemblyBriefV1, 'version'> {
  version: 3
  image: AvgAssemblyImageProductionV2 | null
  voice: {
    batch: AvgVoiceProductionBatchV1
    protocol: AvgSpeechProtocolV1
    binding: { requirementKey: typeof AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1
      adapterId: 'storyforge.avg.compatible-speech.v1'; bindingHash: string; endpointRouteHash: string }
    recovery?: AvgVoiceRecovery
  }
}

export type AvgVoiceProductionDeclarationV1 = Omit<AvgAssemblyBriefV3['voice'], 'recovery'>

/** The same declaration is edited in an inert Work draft and then frozen in
 * its complete production Brief. Neither representation asserts Work/start,
 * account capability, generated audio or an accepted author choice.
 */
export function parseAvgVoiceProductionDeclarationV1(value: unknown): AvgVoiceProductionDeclarationV1 {
  const v = avgRecord(avgProtocolBody(value), ['batch', 'protocol', 'binding'], 'AVG voice production')
  const batch = parseAvgVoiceProductionBatchV1(v.batch), protocol = parseAvgSpeechProtocolV1(v.protocol)
  const binding = avgRecord(v.binding, ['requirementKey', 'adapterId', 'bindingHash', 'endpointRouteHash'], 'AVG voice binding')
  if (binding.requirementKey !== AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1 || binding.adapterId !== protocol.adapterId
    || binding.endpointRouteHash !== protocol.endpointRouteHash
    || batch.presets.some(p => p.adapterId !== protocol.adapterId || p.provider !== protocol.provider || p.model !== protocol.model
      || p.endpointRouteHash !== protocol.endpointRouteHash)) throw new Error('[avg-voice] 配音预设与准确服务路由不一致')
  return { batch, protocol, binding: { requirementKey: AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1,
    adapterId: protocol.adapterId, bindingHash: avgHash(binding.bindingHash, 'voice binding hash'),
    endpointRouteHash: protocol.endpointRouteHash } }
}

export async function assertAvgVoiceDeclarationRequestsV1(value: unknown) {
  const voice = parseAvgVoiceProductionDeclarationV1(value)
  const requests = await Promise.all(voice.batch.requirements.map(r =>
    compileAvgVoiceSpeechRequestV1(voice.batch, r.requirementKey, voice.protocol)))
  const binding = voice.binding
  if (binding.bindingHash !== await avgVoiceRouteBindingHashV1({ requirementKey: binding.requirementKey,
    adapterId: binding.adapterId, capabilityHash: requests[0]!.capabilityHash, endpointRouteHash: binding.endpointRouteHash })) {
    throw new Error('[avg-voice] 配音组装缺少准确的能力和路由绑定 hash')
  }
  return { voice, requests }
}

export function avgRawVoiceArtifactKeyV1(key: string) { return avgKey(`avg.voice.raw.${avgKey(key, 'voice requirement')}`, 'voice raw artifact') }
export function avgVoiceReviewArtifactKeyV1(key: string) { return avgKey(`avg.review.audio.${avgKey(key, 'voice requirement')}`, 'voice review artifact') }
export function avgVoiceChoiceArtifactKeyV1(key: string) { return avgKey(`avg.voice.choice.${avgKey(key, 'voice requirement')}`, 'voice choice artifact') }

export function avgVoiceAssemblyGateIdsV3(assembly: AvgAssemblyBriefV3): string[] {
  return [...(assembly.image ? avgMediaAssemblyGateIdsV2(assembly.image.mediaBatch, assembly.image.imageProcessing) : AVG_ASSEMBLY_GATE_IDS_V1),
    ...assembly.voice.batch.requirements.flatMap(r => [
      `avg.voice.raw.received.${r.requirementKey}`, `avg.voice.review.recorded.${r.requirementKey}`, `avg.voice.choice.confirmed.${r.requirementKey}`,
    ])].map(id => avgKey(id, 'voice acceptance gate'))
}

export function parseAvgAssemblyBriefV3(value: unknown): AvgAssemblyBriefV3 {
  const row = avgRecord(avgProtocolBody(value), ['schema', 'version', 'title', 'sceneKeys', 'mediaAssetKeys',
    'basePackageHash', 'image', 'voice'], 'AVG voice assembly')
  if (row.version !== 3) throw new Error('[avg-voice] 配音组装 Brief 版本无效')
  const { image: imageInput, voice: voiceInput, ...baseInput } = row
  const base = parseAvgAssemblyBriefV1({ ...baseInput, version: 1 })
  for (const sceneKey of base.sceneKeys) avgKey(`avg.content.scene-script.${sceneKey}`, 'voice scene input artifact')
  let image: AvgAssemblyImageProductionV2 | null = null
  if (imageInput !== null) {
    const raw = imageInput && typeof imageInput === 'object' ? imageInput as Record<string, unknown> : {}
    const hasRecovery = Object.prototype.hasOwnProperty.call(raw, 'imageRecovery')
    const hasProcessing = Object.prototype.hasOwnProperty.call(raw, 'imageProcessing')
    const declaration = avgRecord(imageInput, ['mediaBatch', 'imageBinding', ...(hasRecovery ? ['imageRecovery'] : []),
      ...(hasProcessing ? ['imageProcessing'] : [])], 'AVG V3 image production')
    const parsed = parseAvgAssemblyBriefV2({ ...base, version: 2, ...declaration })
    image = { mediaBatch: parsed.mediaBatch, imageBinding: parsed.imageBinding,
      ...(parsed.imageRecovery ? { imageRecovery: parsed.imageRecovery } : {}),
      ...(parsed.imageProcessing ? { imageProcessing: parsed.imageProcessing } : {}) }
  }
  const rawVoice = voiceInput && typeof voiceInput === 'object' ? voiceInput as Record<string, unknown> : {}
  const hasRecovery = Object.prototype.hasOwnProperty.call(rawVoice, 'recovery')
  const { recovery: recoveryInput, ...voiceDeclaration } = avgRecord(voiceInput,
    ['batch', 'protocol', 'binding', ...(hasRecovery ? ['recovery'] : [])], 'AVG assembly voice')
  const declaration = parseAvgVoiceProductionDeclarationV1(voiceDeclaration), batch = declaration.batch
  const voice = { ...declaration, ...(hasRecovery ? { recovery: parseAvgVoiceRecovery(recoveryInput, batch) } : {}) }
  for (const r of batch.requirements) {
    avgRawVoiceArtifactKeyV1(r.requirementKey); avgVoiceReviewArtifactKeyV1(r.requirementKey); avgVoiceChoiceArtifactKeyV1(r.requirementKey)
    avgKey(`avg.author.voice-review.${r.requirementKey}`, 'voice review task')
    avgKey(`avg.author.voice-choice.${r.requirementKey}`, 'voice choice task')
    avgKey(`voice.${r.presetKey}`, 'voice subject lock')
    avgKey(r.script.artifactKey, 'voice script artifact')
    if (!base.sceneKeys.includes(r.sceneKey) || !base.mediaAssetKeys.includes(r.assetKey)) throw new Error('[avg-voice] 配音句或音频不在冻结场景/消费目录中')
    if (image?.mediaBatch.requirements.some(i => i.assetKey === r.assetKey)) throw new Error('[avg-voice] 图片与配音不能占用同一媒资身份')
  }
  const imageTaskCount = image ? (image.mediaBatch.visualReviewPolicy ? 3 : 2) * image.mediaBatch.requirements.length
    + (image.imageProcessing?.entries.length ?? 0) : 0
  if (base.sceneKeys.length + 4 + imageTaskCount + 3 * batch.requirements.length > 100) {
    throw new Error('[avg-voice] 图片、配音、审听、选择及组装超过共享 100 任务上限')
  }
  const parsed: AvgAssemblyBriefV3 = { ...base, version: 3, image, voice }
  avgVoiceAssemblyGateIdsV3(parsed)
  return parsed
}

/** Async identity/options checks are mandatory in addition to the inert
 * parser. Still no Work/source authority, dispatch, DB or author adoption. */
export async function assertAvgVoiceAssemblyRequestsV3(value: unknown) {
  const assembly = parseAvgAssemblyBriefV3(value)
  const { recovery: _recovery, ...voice } = assembly.voice
  const { requests } = await assertAvgVoiceDeclarationRequestsV1(voice)
  return { assembly, requests }
}

export async function avgVoiceRouteBindingHashV1(input: {
  requirementKey: string; adapterId: string; capabilityHash: string; endpointRouteHash: string
}) {
  return hashProductProductionValueV2({ schema: 'storyforge.avg.voice-route-binding', version: 1, ...input })
}

/** A route declaration alone must not let a malformed capability gain a
 * provider reservation. Full Brief policy adds budgets, external data/gates. */
export function assertAvgVoiceCapabilityDeclarationV1(assembly: AvgAssemblyBriefV3, capability: ProviderCapabilityRequirementV1) {
  const { protocol, binding, batch } = assembly.voice
  avgKey(capability.rightsPolicyVersion, 'voice rights policy version')
  avgHash(capability.capabilityHash, 'voice capability hash')
  if (capability.requirementKey !== binding.requirementKey || capability.mediaClass !== 'voice' || capability.operation !== 'speech'
    || capability.adapterFamily !== protocol.adapterId || capability.minimumCapabilityVersion !== '1' || !capability.required
    || capability.allowedDataClasses.length !== 1 || capability.allowedDataClasses[0] !== 'voice-script'
    || batch.presets.some(p => p.capabilityHash !== capability.capabilityHash) || !capability.rightsPolicyVersion.trim()) {
    throw new Error('[avg-voice] 配音能力、外发类别或权利版本与冻结预设不一致')
  }
}
