import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { sha256MediaData } from '../product-production/media-blob-store'
import { avgHash } from './protocol-validation'

/** The original HTTP evidence belongs to its actual producer, never a reuse Run. */
export async function assertAvgOriginalImageResponseV1(scope: WorkspaceScope, runId: number, taskKey: string, quality: Record<string,unknown>) {
  const hash=avgHash(quality.responseEvidenceHash,'responseEvidenceHash')
  const events=await db.agentRunEvents.where('runId').equals(runId).toArray()
  if (!events.some(event=>{
    if(event.type!=='evidence.artifact.recorded')return false
    const p=JSON.parse(event.payloadJson) as {artifactKind?:string;contentHash?:string;stepId?:string;attempt?:number}
    return p.artifactKind==='raw-response'&&p.contentHash===hash&&p.stepId===taskKey&&p.attempt===1
  }))throw new Error('[avg-media] 原图缺少准确图片任务的解析前回执事件')
  const evidence=await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([scope.projectId,'raw-response',hash]).first()
  if(!evidence||evidence.retentionState!=='available'||evidence.content===null
    ||await sha256MediaData(new TextEncoder().encode(evidence.content).buffer)!==hash
    ||new TextEncoder().encode(evidence.content).byteLength!==evidence.byteLength)throw new Error('[avg-media] 原始响应回执缺失或损坏')
}
