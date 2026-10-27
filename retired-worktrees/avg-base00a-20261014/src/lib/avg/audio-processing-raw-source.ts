import Dexie from 'dexie'
import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import type { AvgAudioProcessingDomainV1 } from './audio-production-contract'
import { avgEnum } from './protocol-validation'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1 } from './voice-assembly-contract'
import { readAvgRawVoiceSourceV1 } from './voice-choice-validation'
import { readAvgRawSoundSourceV1 } from './sound-choice-validation'

/** The same current, sealed original reader for execution and admission.
 * No historical-read override, new request, author choice or adoption. */
export async function readAvgAudioProcessingRawSourceV1(input: {
  scope: WorkspaceScope; buildId: number; brief: ProductProductionBriefV3
  domain: AvgAudioProcessingDomainV1
  raw: { artifactKey: string; version: number; contentHash: string }
}) {
  const frozen = structuredClone(input)
  const domain = avgEnum(frozen.domain, ['voice', 'sound'] as const, 'processing original domain')
  if (!frozen.raw.artifactKey.startsWith('avg.' + domain + '.raw.')) {
    throw new Error('[avg-audio-process] 加工原件不属于准确配音或声音域')
  }
  if (domain === 'voice') {
    if (frozen.brief.avgAssembly?.version !== 3) throw new Error('[avg-audio-process] 配音加工缺少准确逐句Brief')
    const stored = frozen.brief.avgAssembly
    const parse = () => assertAvgStoredAssemblyBriefV3(stored)
    // Exact voice storage verifies external WebCrypto hashes. Keep the real
    // sealed RW transaction alive while that pure frozen-value work runs;
    // actual current DB/producer reads below remain in the original transaction.
    const resolved = Dexie.currentTransaction
      ? await Dexie.waitFor(Dexie.ignoreTransaction(parse), 20_000) : await parse()
    const capability = frozen.brief.capabilityRequirements.find(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)
    if (!capability) throw new Error('[avg-audio-process] 配音原请求缺少冻结能力')
    const source = await readAvgRawVoiceSourceV1({ scope: frozen.scope, buildId: frozen.buildId,
      assembly: resolved.assembly, capability, raw: frozen.raw })
    return { row: source.raw, asset: source.asset, requestIdentityHash: source.payload.request.identityHash }
  }
  const source = await readAvgRawSoundSourceV1({ scope: frozen.scope, buildId: frozen.buildId, raw: frozen.raw })
  return { row: source.raw, asset: source.asset, requestIdentityHash: source.payload.requirement.identityHash }
}
