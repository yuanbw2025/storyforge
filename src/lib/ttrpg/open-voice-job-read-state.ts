/** Original local execution identity only; never prepares, launches or reserves.
 * Historical input is read from its exact artifact, independent of today profile. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { assertFormalAIEntrySnapshotIntegrityV1 } from '../agent/formal-ai-entry'
import { projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import { finishTtrpgOpenVoiceIntentForKernelV1 } from './open-voice-intent-receipt'
import { TTRPG_OPEN_VOICE_EXECUTION_RELATION_V1 as relation, TTRPG_OPEN_VOICE_EXECUTION_STEP_V1 as stepId,
  TTRPG_OPEN_VOICE_EXECUTION_DECISION_V1 as decision } from './open-voice-execution-input'
import * as p from './open-contract-parse'

export interface TtrpgOpenVoiceJobLocatorV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string; requestKey: string }
export interface TtrpgOpenVoiceJobIdentityV1 { jobKey: string; inputArtifactHash: string; profileHash: string }
export async function loadTtrpgOpenVoiceJobReadStateForKernelV1(request: TtrpgOpenVoiceJobLocatorV1, sourceRequired = true) {
  const input = structuredClone(request)
  const original = await finishTtrpgOpenVoiceIntentForKernelV1(input, true)
  const rows = await db.agentRuns.where('[parentRunId+parentRelation]').equals([original.snapshot.run.id, relation]).toArray()
  if (rows.length !== 1) p.fail('请先准备唯一原语音子任务；查询与停止不会创建它')
  const snapshot = await readInstanceAgentRunV1(input.scope, rows[0].id!)
  const run = snapshot.run, contract = snapshot.contract
  if (run.portableRuntimeOriginJson !== undefined || run.productRuntimeSessionId !== input.sessionId
    || run.parentRunId !== original.snapshot.run.id || run.parentRelation !== relation
    || run.parentReceiptHash !== original.receipt.receiptHash || run.parentArtifactHash !== original.artifactHash
    || contract.version !== 3 || contract.executionBoundary !== 'product-runtime'
    || contract.objective !== 'ttrpg.open.local-voice:' + input.requestKey
    || contract.permissions.contextSourceKeys.join(',') !== 'ttrpgOpenVoiceText' || contract.permissions.writeTargets.length
    || contract.budget.maxToolCalls !== 0 || contract.budget.maxAttemptsPerStep !== 1
    || canonicalStringify(contract.lineage) !== canonicalStringify({ parent: { runId: original.snapshot.run.id,
      receiptHash: original.receipt.receiptHash, artifactHash: original.artifactHash, relation } })) p.fail('不是本人本机原语音任务；导入或祖先历史不能取得控制权')
  const binding = contract.executionBindings?.find(row => row.stepId === stepId)
  if (contract.executionBindings?.length !== 1 || binding?.version !== 2 || !binding.formalEntry
    || binding.formalEntry.entryId !== 'ttrpg.open.local-voice') p.fail('原执行不是准确冻结的只读音频入口')
  const skill = projectFrozenAgentSkillDefinitionV1(binding)
  const entry = await assertFormalAIEntrySnapshotIntegrityV1(binding.formalEntry, new Map([[skill.id, skill]]))
  if (entry.outputModality !== 'audio' || entry.executionBoundary !== 'product-runtime' || entry.adoptAllowed
    || entry.adoptionTargets.length) p.fail('原执行缺少冻结的只读音频权限')
  const inputArtifactHash = p.hash(contract.runtimeBindingHash, 'original voice execution input')
  const jobKey = `ttrpg.voice.${run.id}.${inputArtifactHash}`
  // A control-only locator grants no raw retrieval even if the input exists.
  // It may identify a partial, unsent child without recreating missing input.
  if (!sourceRequired) {
    await original.owner.assertCurrent()
    return { input, original, snapshot, jobKey, inputArtifactHash, identity: null, sourceContent: null }
  }
  const recorded = snapshot.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot'
    && e.payload.stepId === stepId && e.payload.attempt === 1 && e.payload.contentHash === inputArtifactHash)
  if (!recorded) p.fail('原准确输入尚未持久保存；查询不会重新拼装或修复')
  const sourceContent = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: inputArtifactHash })
  if (new TextEncoder().encode(sourceContent).byteLength > 65536) p.fail('原语音输入超出物理封装预算')
  const body = p.record(p.json(sourceContent), ['schema','version','requestKey','decision','intent','source','reading','profile','profileHash'], 'original frozen voice input')
  const row = original.request, source = { text: row.script.text.slice(row.part.textOffset, row.part.textOffset + row.part.textLength), textHash: row.part.textHash,
    scriptHash: row.scriptHash, part: row.part, narrationSourceRef: row.script.narrationSourceRef, reservationSourceRef: row.sourceRef, scope: row.script.scope }
  if (body.schema !== 'storyforge.ttrpg-open-voice-execution-input' || body.version !== 1 || body.requestKey !== input.requestKey || body.decision !== decision
    || canonicalStringify(body) !== sourceContent || canonicalStringify(body.source) !== canonicalStringify(source)
    || !row.reading || canonicalStringify(body.reading) !== canonicalStringify(row.reading)
    || canonicalStringify(body.intent) !== canonicalStringify({ inputArtifactHash: row.inputArtifactHash, receiptHash: original.receipt.receiptHash, verificationArtifactHash: original.artifactHash })
    || await hashCanonicalValue(body.profile) !== body.profileHash) p.fail('原准确来源、读法、版本或父意图证明已经变化')
  // Retrieval must retain the original issuer tuple. A viewer key or a generic
  // human-host flag alone is not an audience proof after a seat handoff.
  const seat = original.owner.seat
  if (!seat || !row.script.scope.recipients.some(r => r.seatKey === row.script.scope.issuerSeatKey
    && r.viewerKey === input.viewerKey && r.seatKey === seat.seatKey && r.viewerKey === seat.viewerKey
    && r.actorKey === seat.actorKey && r.role === seat.role && r.controller === seat.controller)) p.fail('原准确接收身份已交接，不能取回私有音频')
  const identity: TtrpgOpenVoiceJobIdentityV1 = { jobKey, inputArtifactHash, profileHash: p.hash(body.profileHash, 'original voice product profile') }
  await original.owner.assertCurrent()
  return { input, original, snapshot, jobKey, inputArtifactHash, identity, sourceContent }
}
