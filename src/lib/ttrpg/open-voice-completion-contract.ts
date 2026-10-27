/** Portable data about an observed original terminal. The bounded canonical
 * event string keeps runtime parsing independent of the Harness replay code;
 * consumers must also verify the exact retained bodies and actual event log. */
import { canonicalStringify } from '../agent/run/hash'
import * as p from './open-contract-parse'

export function parseTtrpgOpenVoiceCompletionV1(value: unknown) {
  const r = p.record(value, ['schema','version','sourceEvidenceArtifactHash','candidateHash','reviewArtifactHash',
    'verificationArtifactHash','receiptHash','completionEventsJson'], 'original voice completion')
  if (typeof r.completionEventsJson !== 'string' || new TextEncoder().encode(r.completionEventsJson).length > 262144) p.fail('原配音完成事件字节超限')
  const events = p.list(p.json(r.completionEventsJson), 'original completion events', e => p.object(e, 'original completion event'), 128, 1)
  if (canonicalStringify(events) !== r.completionEventsJson) p.fail('原配音完成事件不是规范 JSON')
  return {
    schema: p.literal(r.schema, 'storyforge.ttrpg-open-voice-generation-completion', 'voice completion schema'),
    version: p.literal(r.version, 1, 'voice completion version'),
    sourceEvidenceArtifactHash: p.hash(r.sourceEvidenceArtifactHash, 'completed source capsule'),
    candidateHash: p.hash(r.candidateHash, 'completed original candidate'),
    reviewArtifactHash: p.hash(r.reviewArtifactHash, 'completed personal review'),
    verificationArtifactHash: p.hash(r.verificationArtifactHash, 'completed original verification'),
    receiptHash: p.hash(r.receiptHash, 'completed original receipt'),
    completionEventsJson: r.completionEventsJson,
  }
}
export type TtrpgOpenVoiceCompletionV1 = ReturnType<typeof parseTtrpgOpenVoiceCompletionV1>
