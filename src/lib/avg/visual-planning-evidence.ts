import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../types'
import { AVG_VISUAL_PLANNING_ROLES_V5 } from './visual-planning-roles-v5'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { sha256MediaData } from '../product-production/media-blob-store'
import { avgHash, avgKey, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { prepareAvgProfessionalArtifactV1 } from './artifact-contract'
import { readAvgVisualReuseEvidenceV4 } from './visual-planning-reuse'
import type { AvgVisualProposalReuseSourceV4, AvgVisualReusePathV4 } from './visual-planning-reuse-contract'

export type AvgVisualProposalEvidenceV4 = {
  rawText:string;requestText:string;request:Record<string,unknown>;quality:Record<string,unknown>
  snapshot:Awaited<ReturnType<typeof readAgentRunV1>>;modelRun:Awaited<ReturnType<typeof readAgentRunV1>>
  modelRequest:Record<string,unknown>;modelRequestText:string
  binding:{requirementKey:string;adapterId:string;bindingHash:string;provider?:string;model?:string}
} & ({reused:false}|{reused:true;source:AvgVisualProposalReuseSourceV4})

export const hashAvgVisualExactTextV1 = (text: string) => sha256MediaData(new TextEncoder().encode(text).buffer)

/** Original model input/output are exact Run artifacts, never a payload
 * supplied by the author or a second prose copy with invented provenance. */
export async function readAvgVisualProposalEvidenceV4(scope: WorkspaceScope, row: Pick<ProductBuildArtifactRecordV1, 'producerRunId' | 'qualityJson' | 'payloadJson'>,path:AvgVisualReusePathV4=[]):Promise<AvgVisualProposalEvidenceV4> {
  if (row.producerRunId === null) throw new Error('[avg-visual-plan] 原始方案没有实际 producer')
  if(JSON.parse(row.qualityJson)?.schema==='storyforge.avg.visual-proposal-reuse-evidence')return readAvgVisualReuseEvidenceV4(scope,{...row,producerRunId:row.producerRunId},path)
  return readAvgVisualFreshProposalEvidence(scope,row,1)
}

/** Shared exact event/input/raw-response verification, without a version conversion. */
async function readAvgVisualFreshProposalEvidence(scope:WorkspaceScope,row:Pick<ProductBuildArtifactRecordV1,'producerRunId'|'qualityJson'|'payloadJson'>,version:1|2):Promise<Extract<AvgVisualProposalEvidenceV4,{reused:false}>>{
  if(row.producerRunId===null)throw new Error('[avg-visual-plan] 原始方案没有实际 producer')
  const q = avgRecord(avgProtocolBody(row.qualityJson), ['schema', 'version', 'requestSnapshotHash', 'rawResponseHash', 'scopeHash', 'capabilityBindingHash'], 'visual proposal evidence')
  if (q.schema !== 'storyforge.avg.visual-proposal-evidence' || q.version !== version) throw new Error('[avg-visual-plan] 原始方案证据版本无效')
  const snapshot = await readAgentRunV1(scope, row.producerRunId), taskKey = snapshot.contract.scope.productProduction?.taskKey
  if (!taskKey) throw new Error('[avg-visual-plan] 原始方案没有准确任务合同')
  const exact = async (kind: 'source-snapshot' | 'raw-response', value: unknown) => {
    const hash = avgHash(value, kind)
    const events = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === kind
      && e.payload.contentHash === hash && e.payload.stepId === taskKey && e.payload.attempt === 1)
    if (events.length !== 1) throw new Error('[avg-visual-plan] 原始方案缺少准确输入/解析前响应事件')
    const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: kind, contentHash: hash })
    if (await hashAvgVisualExactTextV1(text) !== hash) throw new Error('[avg-visual-plan] 原始输入或响应字节已损坏')
    return text
  }
  const requestText = await exact('source-snapshot', q.requestSnapshotHash), rawText = await exact('raw-response', q.rawResponseHash)
  const request = avgRecord(JSON.parse(requestText), ['schema', 'version', 'taskKey', 'targetArtifactKey', 'scopeHash', 'sourceInputHash',
    'systemPrompt', 'contextText', 'category', 'maximumOutputTokens', 'binding', 'promptVersion'], 'visual model input')
  const hasIdentity = Object.prototype.hasOwnProperty.call(request.binding ?? {}, 'provider') || Object.prototype.hasOwnProperty.call(request.binding ?? {}, 'model')
  const binding = avgRecord(request.binding, ['requirementKey', 'adapterId', 'bindingHash', ...(hasIdentity ? ['provider', 'model'] : [])], 'visual model binding')
  if ((binding.provider === undefined) !== (binding.model === undefined)) throw new Error('[avg-visual-plan] 原始路由身份必须成对冻结')
  const actualBinding = { requirementKey: avgKey(binding.requirementKey, 'requirementKey'), adapterId: avgKey(binding.adapterId, 'adapterId'), bindingHash: avgHash(binding.bindingHash, 'bindingHash'),
    ...(binding.provider === undefined ? {} : { provider: avgText(binding.provider, 'provider', 200), model: avgText(binding.model, 'model', 200) }) }
  const proposal = JSON.parse(row.payloadJson) as { targetArtifactKey?: string; scopeHash?: string; payload?: unknown }
  if (request.schema !== 'storyforge.avg.visual-model-input' || request.version !== version || request.taskKey !== taskKey
    || request.category !== 'product-production' || !Number.isSafeInteger(request.maximumOutputTokens) || Number(request.maximumOutputTokens) <= 0
    || request.targetArtifactKey !== proposal.targetArtifactKey || request.scopeHash !== proposal.scopeHash || q.scopeHash !== proposal.scopeHash
    || actualBinding.requirementKey !== 'avg.visual.planning.text' || actualBinding.bindingHash !== q.capabilityBindingHash
    || snapshot.contract.executionBindings?.length !== 1 || request.promptVersion !== snapshot.contract.executionBindings[0].promptVersion
    || typeof request.systemPrompt !== 'string' || !request.systemPrompt.trim() || typeof request.contextText !== 'string' || !request.contextText.trim()
    || canonicalProductProductionJsonV2(prepareAvgProfessionalArtifactV1({ artifactKey: String(proposal.targetArtifactKey), kind: 'narrative',
      payload: parseProductionModelJsonObjectV1(rawText, taskKey), allowedOutputKeys: [String(proposal.targetArtifactKey)] }).payload) !== canonicalProductProductionJsonV2(proposal.payload)) throw new Error('[avg-visual-plan] 原始响应、真实输入或方案内容不闭合')
  return { reused:false,rawText, requestText, request, quality: q, snapshot,modelRun:snapshot,modelRequest:request,modelRequestText:requestText, binding: actualBinding }
}

/** New evidence is explicit @2 and actual role proposal @3. Old V4 readers
 * remain strict; only current version-aware consumers use this dispatcher. */
export async function readAvgVisualProposalEvidenceV5(scope:WorkspaceScope,row:Pick<ProductBuildArtifactRecordV1,'producerRunId'|'qualityJson'|'payloadJson'>){
  const proposal=avgRecord(avgProtocolBody(row.payloadJson),['schema','version','targetArtifactKey','scopeHash','payload'],'V5 original proposal')
  if(proposal.schema!=='storyforge.avg.visual-role-proposal'||proposal.version!==3)throw new Error('[avg-visual-plan] 新证据必须来自明确新版原始方案')
  const proof=await readAvgVisualFreshProposalEvidence(scope,row,2),binding=proof.snapshot.contract.executionBindings?.[0]
  if(!binding||!AVG_VISUAL_PLANNING_ROLES_V5.some(r=>r.skillId===binding.skillId))throw new Error('[avg-visual-plan] 新原始方案没有实际新版 Skill 快照')
  return proof
}
export function readAvgVisualProposalEvidence(scope:WorkspaceScope,row:Pick<ProductBuildArtifactRecordV1,'producerRunId'|'qualityJson'|'payloadJson'>){
  const q=avgProtocolBody(row.qualityJson) as {schema?:unknown;version?:unknown}|null
  return q?.schema==='storyforge.avg.visual-proposal-evidence'&&q.version===2?readAvgVisualProposalEvidenceV5(scope,row):readAvgVisualProposalEvidenceV4(scope,row)
}
