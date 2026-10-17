import { ttrpgOpenDeliveredKpSourceKeysV1 } from './open-kp-delivered-sources'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import { parseTtrpgOpenKpNarrationV1, type TtrpgOpenKpNarrationV1 } from './open-kp-narration'
export { parseTtrpgOpenKpNarrationV1, type TtrpgOpenKpNarrationV1 } from './open-kp-narration'
/** Citation-bound narrative candidate; it has no mechanical/fact/knowledge write permission. */
import type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import type { TtrpgOpenNarrationBindingV1 } from './open-kp-binding'
import { readTtrpgOpenRuntimeCandidateV1, verifyTtrpgOpenRuntimeCandidateEvidenceV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
export interface TtrpgOpenKpCandidateV1 extends Omit<TtrpgOpenIntentCandidateV1, 'schema' | 'intent'> {
  schema: 'storyforge.ttrpg-open-kp-candidate'; binding: TtrpgOpenNarrationBindingV1; narration: TtrpgOpenKpNarrationV1 | null
}
export async function readTtrpgOpenKpCandidateV1(input: TtrpgOpenCandidateReadV1): Promise<TtrpgOpenKpCandidateV1 | null> {
  const candidate = await readTtrpgOpenRuntimeCandidateV1(input, 'kp-narration')
  return candidate?.schema === 'storyforge.ttrpg-open-kp-candidate' ? candidate : null
}
export async function verifyTtrpgOpenKpCandidateProofV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  const candidate = await readTtrpgOpenKpCandidateV1(input)
  if (!candidate || candidate.candidateHash !== input.candidateHash || !candidate.narration || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) throw new Error('[ttrpg-kp] 本次叙述候选需修订/已受阻或不是明确确认的版本')
  const evidence = await verifyTtrpgOpenRuntimeCandidateEvidenceV1(input)
  const frozen = evidence.artifacts.map(row => { try { return JSON.parse(row.content ?? 'null') as Partial<TtrpgOpenInputEvidenceV1> } catch { return null } })
    .find(value => value?.schema === 'storyforge.ttrpg-open-input-evidence' && value.manifest?.manifestHash === candidate.inputManifestHash)
  if (!frozen?.preflight) throw new Error('[ttrpg-kp] 缺少原始交付引用证据')
  const values = frozen.preflight.artifacts.filter(ref => ref.role === 'source-snapshot').map(ref => {
    const retained = evidence.artifacts.find(row => row.artifactKind === ref.artifactKind && row.contentHash === ref.contentHash)
    if (!retained) throw new Error('[ttrpg-kp] 引用条目没有准确保留的读取工件')
    const wrapper = JSON.parse(retained.content ?? 'null') as { content: string }
    return JSON.parse(wrapper.content) as unknown
  })
  const deliveredSourceKeys = ttrpgOpenDeliveredKpSourceKeysV1(values)
  parseTtrpgOpenKpNarrationV1(candidate.narration, deliveredSourceKeys)
  return { candidate, evidence, deliveredSourceKeys }
}
