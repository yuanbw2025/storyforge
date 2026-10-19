import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../types'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { sha256MediaData } from '../product-production/media-blob-store'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { avgHash, avgKey, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { parseAvgSoundPlanV1 } from './sound-plan-contract'
import { AVG_SOUND_PLAN_KEY_V1 } from './sound-production-plan'
import { AVG_SOUND_TEXT_CAPABILITY_V1 } from './sound-production-brief'

export const hashAvgSoundExactTextV1 = (text: string) => sha256MediaData(new TextEncoder().encode(text).buffer)
/** Exact original source snapshot and parsing-before raw response from the
 * real Run. Author edits stay in a separate candidate; no prose-copy proof. */
export async function readAvgSoundProposalEvidenceV1(scope: WorkspaceScope, row: Pick<ProductBuildArtifactRecordV1, 'producerRunId' | 'qualityJson' | 'payloadJson'>) {
  if (row.producerRunId === null) throw new Error('[avg-sound-plan] 原始方案没有实际producer')
  const q = avgRecord(avgProtocolBody(row.qualityJson), ['schema', 'version', 'requestSnapshotHash', 'rawResponseHash', 'scopeHash', 'capabilityBindingHash'], 'sound proposal evidence')
  if (q.schema !== 'storyforge.avg.sound-proposal-evidence' || q.version !== 1) throw new Error('[avg-sound-plan] 原始方案证据版本无效')
  const snapshot = await readAgentRunV1(scope, row.producerRunId), taskKey = snapshot.contract.scope.productProduction?.taskKey
  const skill = snapshot.contract.executionBindings?.[0]
  if (!taskKey || snapshot.contract.executionBindings?.length !== 1 || skill?.skillId !== 'avg.sound-plan.v1') throw new Error('[avg-sound-plan] 原始方案没有准确声音Skill快照')
  const exact = async (kind: 'source-snapshot' | 'raw-response', value: unknown) => {
    const hash = avgHash(value, kind)
    const events = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === kind
      && e.payload.contentHash === hash && e.payload.stepId === taskKey && e.payload.attempt === 1)
    if (events.length !== 1) throw new Error('[avg-sound-plan] 原始输入/解析前响应事件不唯一或已遗失')
    const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: kind, contentHash: hash })
    if (await hashAvgSoundExactTextV1(text) !== hash) throw new Error('[avg-sound-plan] 原始输入/响应字节已损坏')
    return text
  }
  const requestText = await exact('source-snapshot', q.requestSnapshotHash), rawText = await exact('raw-response', q.rawResponseHash)
  const request = avgRecord(JSON.parse(requestText), ['schema', 'version', 'taskKey', 'targetArtifactKey', 'scopeHash', 'sourceInputHash',
    'systemPrompt', 'contextText', 'category', 'maximumOutputTokens', 'binding', 'promptVersion'], 'sound actual model input')
  const b = avgRecord(request.binding, ['requirementKey', 'adapterId', 'bindingHash', 'provider', 'model'], 'sound actual text binding')
  const binding = { requirementKey: avgKey(b.requirementKey, 'sound text requirement'), adapterId: avgKey(b.adapterId, 'sound text adapter'),
    bindingHash: avgHash(b.bindingHash, 'sound binding hash'), provider: avgText(b.provider, 'sound text provider', 200), model: avgText(b.model, 'sound text model', 200) }
  const proposal = avgRecord(avgProtocolBody(row.payloadJson), ['schema', 'version', 'targetArtifactKey', 'scopeHash', 'payload'], 'sound proposal')
  if (proposal.schema !== 'storyforge.avg.sound-role-proposal' || proposal.version !== 1 || proposal.targetArtifactKey !== AVG_SOUND_PLAN_KEY_V1
    || request.schema !== 'storyforge.avg.sound-model-input' || request.version !== 1 || request.taskKey !== taskKey
    || request.targetArtifactKey !== proposal.targetArtifactKey || request.scopeHash !== proposal.scopeHash || q.scopeHash !== proposal.scopeHash
    || request.category !== 'product-production' || request.promptVersion !== skill.promptVersion
    || !Number.isSafeInteger(request.maximumOutputTokens) || Number(request.maximumOutputTokens) <= 0
    || binding.requirementKey !== AVG_SOUND_TEXT_CAPABILITY_V1 || binding.bindingHash !== q.capabilityBindingHash
    || typeof request.systemPrompt !== 'string' || !request.systemPrompt.trim() || typeof request.contextText !== 'string' || !request.contextText.trim()
    || canonicalProductProductionJsonV2(parseAvgSoundPlanV1(parseProductionModelJsonObjectV1(rawText, taskKey))) !== canonicalProductProductionJsonV2(proposal.payload)) {
    throw new Error('[avg-sound-plan] 原始模型输入/响应/方案内容不闭合')
  }
  return { requestText, rawText, request, quality: q, snapshot, binding }
}
