import { avgProtocolBody, avgRecord } from './protocol-validation'
import { assertAvgVoiceAssemblyRequestsV3, parseAvgAssemblyBriefV3, type AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { decodeAvgVoiceExactStorageV1, encodeAvgVoiceExactStorageV1, parseAvgVoiceExactStorageV1, type AvgVoiceExactStorageV1 } from './voice-exact-storage'

/** Shared Brief read representation. Only the voice value is opaque ASCII;
 * image V2, title, scene/media domains and lineage retain existing semantics.
 * New V3 production remains refused by commands until its full slice closes.
 */
export interface AvgStoredAssemblyBriefV3 extends Omit<AvgAssemblyBriefV3, 'voice'> {
  voice: AvgVoiceExactStorageV1
}

export async function encodeAvgStoredAssemblyBriefV3(value: unknown): Promise<AvgStoredAssemblyBriefV3> {
  const { assembly } = await assertAvgVoiceAssemblyRequestsV3(value)
  return { ...assembly, voice: await encodeAvgVoiceExactStorageV1('assembly-voice', {
    schema: 'storyforge.avg.assembly-voice', version: 1, ...assembly.voice,
  }) }
}

export function parseAvgStoredAssemblyBriefV3(value: unknown) {
  const row = avgRecord(avgProtocolBody(value), ['schema', 'version', 'title', 'sceneKeys', 'mediaAssetKeys',
    'basePackageHash', 'image', 'voice'], 'stored AVG voice assembly')
  const { packet, payload } = parseAvgVoiceExactStorageV1(row.voice, 'assembly-voice')
  const hasRecovery = !!payload && Object.prototype.hasOwnProperty.call(payload, 'recovery')
  const v = avgRecord(payload, ['schema', 'version', 'batch', 'protocol', 'binding', ...(hasRecovery ? ['recovery'] : [])], 'stored assembly voice')
  const assembly = parseAvgAssemblyBriefV3({ ...row, voice: { batch: v.batch, protocol: v.protocol, binding: v.binding,
    ...(hasRecovery ? { recovery: v.recovery } : {}) } })
  return { stored: { ...assembly, voice: packet } satisfies AvgStoredAssemblyBriefV3, assembly }
}

/** Full stored identity check, then decode for deterministic operational use.
 * Producer authority/hash must bind the original stored Brief, not a made-up
 * V1/V2 projection of this resolved value.
 */
export async function assertAvgStoredAssemblyBriefV3(value: unknown) {
  const parsed = parseAvgStoredAssemblyBriefV3(value)
  await decodeAvgVoiceExactStorageV1(parsed.stored.voice, 'assembly-voice')
  const { requests } = await assertAvgVoiceAssemblyRequestsV3(parsed.assembly)
  return { ...parsed, requests }
}
