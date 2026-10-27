/** A closed negative quality declaration. Positive V1 remains byte/meaning
 * compatible; rejection is never a successful verification or media licence. */
import * as p from './open-contract-parse'
export const TTRPG_OPEN_VOICE_REJECTION_SCHEMA_V1='storyforge.ttrpg-open-voice-quality-rejection' as const
export const TTRPG_OPEN_VOICE_REJECTION_DECISION_V1='reject-this-original-voice-candidate-for-session-use' as const
export function parseTtrpgOpenVoiceQualityRejectionV1(value:unknown){
  const r=p.record(value,['schema','version','decision','candidateHash','sourceEvidenceArtifactHash','runId','contractHash','reviewer',
    'audioContentHash','sourceTextHash','normalizedTextSha256','listening','judgment','independentListening','runtimeReadEvidence','reviewedAt','reason'],'original voice quality rejection')
  const reviewer=p.record(r.reviewer,['viewerKey','seatKey'],'original rejecting reviewer'),e=p.record(r.runtimeReadEvidence,['sessionKey','runtimeSourceHash','sequence','stateHash'],'rejection runtime evidence')
  return {schema:p.literal(r.schema,TTRPG_OPEN_VOICE_REJECTION_SCHEMA_V1,'negative voice review schema'),version:p.literal(r.version,1,'negative voice review version'),
    decision:p.literal(r.decision,TTRPG_OPEN_VOICE_REJECTION_DECISION_V1,'explicit original rejection'),
    candidateHash:p.hash(r.candidateHash,'rejected candidate'),sourceEvidenceArtifactHash:p.hash(r.sourceEvidenceArtifactHash,'rejected original source'),
    runId:p.integer(r.runId,'rejected original Run',1,Number.MAX_SAFE_INTEGER),contractHash:p.hash(r.contractHash,'rejected original contract'),
    reviewer:{viewerKey:p.key(reviewer.viewerKey,'rejecting viewer'),seatKey:p.key(reviewer.seatKey,'rejecting seat')},
    audioContentHash:p.hash(r.audioContentHash,'rejected actual audio'),sourceTextHash:p.hash(r.sourceTextHash,'rejected source text'),normalizedTextSha256:p.hash(r.normalizedTextSha256,'rejected exact reading'),
    listening:p.literal(r.listening,'self-reported-original-listening','personal original listening'),judgment:p.literal(r.judgment,'not-acceptable-to-me','negative personal quality judgment'),
    independentListening:p.literal(r.independentListening,'unproven','independent listening remains unproven'),
    runtimeReadEvidence:{sessionKey:p.key(e.sessionKey,'rejection session'),runtimeSourceHash:p.hash(e.runtimeSourceHash,'rejection frozen source'),sequence:p.integer(e.sequence,'rejection runtime sequence',0),stateHash:p.hash(e.stateHash,'rejection read-only state')},
    reviewedAt:p.integer(r.reviewedAt,'original rejection time',0,Number.MAX_SAFE_INTEGER),reason:p.text(r.reason,'personal rejection reason',2000)}
}
export type TtrpgOpenVoiceQualityRejectionV1=ReturnType<typeof parseTtrpgOpenVoiceQualityRejectionV1>
