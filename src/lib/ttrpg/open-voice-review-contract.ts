/** A person's declaration about one original candidate. This is neither a
 * rights declaration, independent listening evidence nor a runtime adoption. */
import * as p from './open-contract-parse'

export const TTRPG_OPEN_VOICE_REVIEW_DECISION_V1 = 'accept-this-original-voice-candidate-for-review' as const
export const TTRPG_OPEN_VOICE_REVIEW_SCHEMA_V1 = 'storyforge.ttrpg-open-voice-quality-review' as const
export function parseTtrpgOpenVoiceQualityReviewV1(value: unknown) {
  const r = p.record(value, ['schema','version','decision','candidateHash','sourceEvidenceArtifactHash','runId','contractHash',
    'reviewer','audioContentHash','sourceTextHash','normalizedTextSha256','listening','judgment','independentListening',
    'runtimeReadEvidence','reviewedAt'], 'original voice quality review')
  const reviewer = p.record(r.reviewer, ['viewerKey','seatKey'], 'original voice reviewer')
  const e = p.record(r.runtimeReadEvidence, ['sessionKey','runtimeSourceHash','sequence','stateHash'], 'voice review runtime evidence')
  return {
    schema: p.literal(r.schema, TTRPG_OPEN_VOICE_REVIEW_SCHEMA_V1, 'voice quality review schema'),
    version: p.literal(r.version, 1, 'voice quality review version'),
    decision: p.literal(r.decision, TTRPG_OPEN_VOICE_REVIEW_DECISION_V1, 'explicit original voice quality review'),
    candidateHash: p.hash(r.candidateHash, 'reviewed original candidate'),
    sourceEvidenceArtifactHash: p.hash(r.sourceEvidenceArtifactHash, 'original source evidence'),
    runId: p.integer(r.runId, 'original reviewed Run', 1, Number.MAX_SAFE_INTEGER), contractHash: p.hash(r.contractHash, 'original reviewed contract'),
    reviewer: { viewerKey: p.key(reviewer.viewerKey, 'original reviewer'), seatKey: p.key(reviewer.seatKey, 'original reviewer seat') },
    audioContentHash: p.hash(r.audioContentHash, 'reviewed original audio'), sourceTextHash: p.hash(r.sourceTextHash, 'reviewed original source'),
    normalizedTextSha256: p.hash(r.normalizedTextSha256, 'reviewed original reading'),
    listening: p.literal(r.listening, 'self-reported-original-listening', 'personal listening declaration'),
    judgment: p.literal(r.judgment, 'acceptable-to-me', 'personal quality judgment'),
    independentListening: p.literal(r.independentListening, 'unproven', 'independent listening remains unproven'),
    runtimeReadEvidence: { sessionKey: p.key(e.sessionKey, 'review runtime session'), runtimeSourceHash: p.hash(e.runtimeSourceHash, 'review runtime source'),
      sequence: p.integer(e.sequence, 'review runtime sequence', 0), stateHash: p.hash(e.stateHash, 'review read-only runtime hash') },
    reviewedAt: p.integer(r.reviewedAt, 'personal review time', 0, Number.MAX_SAFE_INTEGER),
  }
}
export type TtrpgOpenVoiceQualityReviewV1 = ReturnType<typeof parseTtrpgOpenVoiceQualityReviewV1>
