/** Explicit original-review recovery only. Preserve every inference barrier;
 * never query a worker, send, generate, declare listening or adopt audio. */
import { AgentRunStoreError } from '../agent/run/event-store'
import { createAgentRunCheckpointV1, beginAgentRunRecoveryV1, completeAgentRunRecoveryV1 } from '../agent/run/checkpoint'
import { readTtrpgOpenVoiceCandidateV1, readTtrpgOpenVoiceCandidateRetentionForKernelV1 } from './open-voice-candidate'
import { readTtrpgOpenVoiceCandidateReviewV1, readTtrpgOpenVoiceCandidateRejectionV1 } from './open-voice-review-service'
import { TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1, type TtrpgOpenVoiceControlV1 } from './open-voice-execution'
import { TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId } from './open-voice-execution-input'
import type { TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import * as p from './open-contract-parse'

export async function resumeTtrpgOpenVoiceCandidateReviewV1(request: TtrpgOpenVoiceJobLocatorV1 & {
  candidateHash: string; decision: 'resume-this-original-voice-review-without-inference'
}) {
  const input=structuredClone(request)
  p.literal(input.decision,'resume-this-original-voice-review-without-inference','explicit original review recovery')
  p.hash(input.candidateHash,'exact original review candidate')
  // One physical candidate read precedes ledger-only CAS recovery. Imported,
  // failed, cancelled or corrupt originals cannot enter this path.
  const first=await readTtrpgOpenVoiceCandidateV1(input)
  if(!first?.complete||first.candidate.candidateHash!==input.candidateHash||!['ready','usable-with-warnings'].includes(first.candidate.artifact.status))p.fail('恢复需要完整可核对的原配音候选')
  for(let attempt=0;attempt<12;attempt++){
    const b=await readTtrpgOpenVoiceCandidateRetentionForKernelV1(input,first.candidate),state=b.snapshot.projection.state,step=b.snapshot.projection.steps[stepId]
    if(b.original.owner.runtime.product.safety.status!=='active'||!step||step.candidateHash!==input.candidateHash||step.attempt!==1
      ||!['paused','recovering','running','awaiting_confirmation'].includes(state))p.fail('原审阅不在当前本人可恢复状态；失败、完成和历史任务不复活')
    if(step.status!=='awaiting_confirmation'){
      const rejected=await readTtrpgOpenVoiceCandidateRejectionV1(input),saved=rejected?null:await readTtrpgOpenVoiceCandidateReviewV1(input)
      const negative=!!rejected&&!rejected.complete&&step.status==='failed'&&step.confirmation==='reject'
      const positive=!!saved&&!saved.complete&&['running','succeeded'].includes(step.status)&&step.confirmation==='adopt'
      if(!negative&&!positive)p.fail('只能恢复原候选审阅或实际已保存的本人决定收尾')
    }
    if(b.controls.some(c=>c.payload.action==='recover-original-raw-only'&&c.payload.expectedRawResponseHash!==b.raw?.hash))p.fail('原审阅的取回屏障绑定了不同正文')
    const latest=b.controls.find(c=>c.checkpointHash===b.snapshot.projection.lastCheckpointHash)
    await b.original.owner.assertCurrent()
    const owner={scope:input.scope,productRuntimeSessionId:input.sessionId,runId:b.snapshot.run.id},expectedLastSequence=b.snapshot.projection.lastSequence
    try{
      if(!latest){
        if(state==='recovering')p.fail('恢复中的最新检查点不是准确语音控制，保留原状')
        const marker:TtrpgOpenVoiceControlV1={schema:TTRPG_OPEN_VOICE_CONTROL_SCHEMA_V1,version:1,action:'stop-original-job',jobKey:b.jobKey,inputArtifactHash:b.inputArtifactHash}
        await createAgentRunCheckpointV1({...owner,expectedLastSequence,resumePayload:marker});continue
      }
      if(state==='paused'||state==='recovering'){
        const plan=await beginAgentRunRecoveryV1({...owner,expectedLastSequence})
        if(plan.checkpointHash!==latest.checkpointHash)p.fail('原审阅恢复检查点已变化')
        await b.original.owner.assertCurrent()
        await completeAgentRunRecoveryV1({...owner,checkpointHash:plan.checkpointHash,expectedLastSequence:plan.snapshot.projection.lastSequence});continue
      }
      await b.original.owner.assertCurrent()
      return {candidateHash:input.candidateHash,runId:b.snapshot.run.id,runState:state,
        futureInferenceBlocked:true as const,generationAllowed:false as const,adoptionAllowed:false as const,qualityDeclared:false as const}
    }catch(error){
      if(error instanceof AgentRunStoreError&&['sequence_conflict','checkpoint_stale'].includes(error.code))continue
      throw error
    }
  }
  p.fail('原审阅恢复持续竞争，请核对同一记录；没有重发、试听确认或音轨采用')
}
