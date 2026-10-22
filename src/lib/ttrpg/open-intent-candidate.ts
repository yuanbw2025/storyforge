import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenModelPurposeForSkillV1 } from './open-model-purpose'
/** Player intent candidate ownership and admissibility. */
import type { CreativeArtifactV1 } from '../agent/creative-reliability'
import type { TtrpgOpenIntentV1 } from './open-intent'
import { readTtrpgOpenRuntimeCandidateV1, verifyTtrpgOpenRuntimeCandidateEvidenceV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
export interface TtrpgOpenIntentCandidateV1 {
  schema: 'storyforge.ttrpg-open-intent-candidate'; version: 1; portable: false
  runId: number; productRuntimeSessionId: number; requestKey: string; epochKey: string
  actorKey: string; viewerKey: string; admissionStateHash: string; visibilityHash: string; runtimeSourceHash: string
  inputManifestHash: string; rawResponseHash: string
  intent: TtrpgOpenIntentV1 | null; artifact: CreativeArtifactV1; candidateHash: string
}
export async function readTtrpgOpenIntentCandidateV1(input: TtrpgOpenCandidateReadV1): Promise<TtrpgOpenIntentCandidateV1 | null> {
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg), call = runtime?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey)
  const purpose = call ? ttrpgOpenModelPurposeForSkillV1(call.skillId).purpose : 'intent'
  if (purpose !== 'intent' && purpose !== 'companion') throw new Error('[ttrpg-open-intent] 该请求不是角色/队友意图')
  const candidate = await readTtrpgOpenRuntimeCandidateV1(input, purpose)
  return candidate?.schema === 'storyforge.ttrpg-open-intent-candidate' ? candidate : null
}
export async function verifyTtrpgOpenIntentCandidateProofV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  const candidate = await readTtrpgOpenIntentCandidateV1(input)
  if (!candidate || candidate.candidateHash !== input.candidateHash || !candidate.intent
    || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) {
    throw new Error('[ttrpg-open-intent] 候选需要修订、已受阻或不是本次确认的版本')
  }
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  if (runtime?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey)?.intentRejection) throw new Error('[ttrpg-open-intent] 此候选已由真人拒绝，不可执行')
  const run = await readInstanceAgentRunV1(input.scope, input.runId)
  if (Object.values(run.projection.steps).some(step => step.candidateHash === input.candidateHash && step.confirmation === 'reject')) throw new Error('[ttrpg-open-intent] 此候选已由真人拒绝，不可执行')
  return { candidate, evidence: await verifyTtrpgOpenRuntimeCandidateEvidenceV1(input) }
}
