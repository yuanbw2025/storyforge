import { rejectTtrpgOpenIntentCandidateCommandV1 } from './runtime-commands'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
/** Explicit human rejection keeps raw evidence and counted provider cost; it never re-sends. */
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { readTtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import { verifyTtrpgOpenRuntimeCandidateEvidenceV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { appendAgentRunEventV1, readInstanceAgentRunV1, AgentRunStoreError } from '../agent/run/event-store'
export async function rejectTtrpgOpenIntentCandidateV1(input: TtrpgOpenCandidateReadV1 & { candidateHash: string }) {
  const candidate = await readTtrpgOpenIntentCandidateV1(input)
  if (!candidate || candidate.candidateHash !== input.candidateHash) throw new Error('不能拒绝不存在或已被替换的行动候选')
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg), call = runtime?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey)
  if (!call || runtime!.openRun!.operations.some(o => o.intentEvidence?.runContractHash === call.runContractHash)) throw new Error('已进入规则确认的行动，请通过当前行动进行拒绝或撤销')
  const version = await readProductRuntimeStateVersion(input.sessionId)
  await rejectTtrpgOpenIntentCandidateCommandV1({ ...input, commandId: 'intent-rejection', baseSequence: version.sequence, baseStateHash: version.stateHash })
  await verifyTtrpgOpenRuntimeCandidateEvidenceV1(input)
  for (let attempt = 0; attempt < 12; attempt++) {
    const snapshot = await readInstanceAgentRunV1(input.scope, input.runId), step = snapshot.projection.steps[call.stepId]
    if (!step || step.candidateHash !== input.candidateHash || step.confirmation === 'adopt') throw new Error('候选已被确认或运行证据不一致')
    if (step.confirmation === 'reject' && snapshot.projection.state === 'failed') return
    try {
      if (!step.confirmation) await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId, type: 'confirmation.recorded',
        payload: { stepId: call.stepId, candidateHash: input.candidateHash, decision: 'reject' }, expectedLastSequence: snapshot.projection.lastSequence })
      else await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId, type: 'run.failed',
        payload: { code: 'human-rejected-open-intent', retryable: false }, expectedLastSequence: snapshot.projection.lastSequence })
    } catch (error) { if (!(error instanceof AgentRunStoreError && error.code === 'sequence_conflict')) throw error }
  }
  throw new Error('拒绝回执遇到持续竞争，请重新读取原候选')
}
