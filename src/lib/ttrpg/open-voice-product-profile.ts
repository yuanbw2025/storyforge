/** Closed product profiles. A browser preference is only a proposal when an
 * explicit new execution is prepared, never authority to rewrite an old Run. */
import melo from '../../../scripts/ttrpg-local-tts/product-profile.json'
import male from '../../../scripts/ttrpg-local-tts/product-qwen-uncle_fu-v1.json'
import female from '../../../scripts/ttrpg-local-tts/product-qwen-serena-v1.json'
import { canonicalStringify } from '../agent/run/hash'
import type { TtrpgNarratorVoiceV1 } from './narration-listening-preferences'
import * as p from './open-contract-parse'

export type TtrpgOpenVoiceProductProfileV1 = typeof melo | typeof male | typeof female
export function ttrpgOpenOriginalVoiceLabelV1(profileId: unknown): string {
  if (profileId === male.profileId) return '沉稳男声 · Uncle_Fu'
  if (profileId === female.profileId) return '柔和女声 · Serena'
  if (profileId === melo.profileId) return '基础中文旁白 · Melo'
  return '历史旁白声线'
}
export function currentTtrpgOpenVoiceProductProfileV1(voice?: TtrpgNarratorVoiceV1): TtrpgOpenVoiceProductProfileV1 {
  if (voice === undefined || voice === 'melo.zh') return structuredClone(melo)
  if (voice === 'qwen.uncle_fu') return structuredClone(male)
  if (voice === 'qwen.serena') return structuredClone(female)
  return p.fail('未知旁白声线，不能选择任意模型或人声')
}
export function parseTtrpgOpenOriginalVoiceProfileV1(value: unknown): TtrpgOpenVoiceProductProfileV1 {
  const row = p.object(value, 'original product voice profile'), { implementation, ...core } = row
  const supported = [melo, male, female].find(profile => profile.profileId === row.profileId)
  if (!supported) p.fail('原旁白版本不受支持，保留原请求')
  const { implementation: expectedImplementation, ...expectedCore } = supported
  const impl = p.record(implementation, ['version', 'sources'], 'original voice implementation')
  const sources = p.list(impl.sources, 'original voice sources', (value, label) => {
    const source = p.record(value, ['path', 'sha256'], label)
    return { path: p.text(source.path, label, 300), sha256: p.hash(source.sha256, label) }
  }, expectedImplementation.sources.length, expectedImplementation.sources.length)
  if (canonicalStringify(core) !== canonicalStringify(expectedCore) || impl.version !== expectedImplementation.version
    || canonicalStringify(sources.map(s => s.path)) !== canonicalStringify(expectedImplementation.sources.map(s => s.path))) p.fail('原声线或物理合同已变化，不能升级旧任务')
  return structuredClone(row) as TtrpgOpenVoiceProductProfileV1
}
