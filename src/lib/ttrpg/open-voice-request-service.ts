/** Human request lifecycle only. No transport or model implementation lives in
 * this module, and a stored reservation never restores an in-memory grant. */
import { db } from '../db/schema'
import { loadTtrpgOpenAudioReadStateV1, type TtrpgOpenAudioReadInputV1 } from './open-audio-read-state'
import { readTtrpgOpenReviewedVoiceScriptV1, type TtrpgOpenVoiceScriptReviewV1 } from './open-voice-script-service'
import { TTRPG_OPEN_VOICE_RESERVE_DECISION_V1, TTRPG_OPEN_VOICE_CANCEL_DECISION_V1, TTRPG_OPEN_VOICE_REQUEST_STEP_V1,
  parseTtrpgOpenVoiceRequestV1, parseTtrpgOpenVoicePartV1, assertTtrpgOpenVoiceReservationV1, ttrpgOpenVoiceRequestInputV1,
  ttrpgOpenVoiceBudgetV1 } from './open-voice-request-contract'
import { ttrpgOpenVoiceIntentContractV1, ttrpgOpenVoiceIntentObjectiveV1 } from './open-voice-request-run'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import { createAgentRunV1, appendAgentRunEventV1, readInstanceAgentRunV1 } from '../agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { canonicalStringify } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { reserveTtrpgOpenVoiceRequestForKernelV1, cancelTtrpgOpenVoiceRequestForKernelV1 } from './runtime-commands'
import * as p from './open-contract-parse'

const snapshotInput = (input: TtrpgOpenAudioReadInputV1) => ({ scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey })
export async function reserveTtrpgOpenVoiceRequestV1(request: TtrpgOpenAudioReadInputV1 & {
  review: TtrpgOpenVoiceScriptReviewV1; submissionKey: string; part: { textOffset: number; textLength: number }
  decision: typeof TTRPG_OPEN_VOICE_RESERVE_DECISION_V1
}) {
  p.literal(request.decision, TTRPG_OPEN_VOICE_RESERVE_DECISION_V1, 'voice explicit reservation')
  const input = snapshotInput(request), review = request.review, submissionKey = p.key(request.submissionKey, 'voice submission'), selection = structuredClone(request.part)
  const reviewed = await readTtrpgOpenReviewedVoiceScriptV1({ ...input, review }), loaded = await loadTtrpgOpenAudioReadStateV1(input)
  const partText = reviewed.script.text.slice(selection.textOffset, selection.textOffset + selection.textLength)
  const part = parseTtrpgOpenVoicePartV1({ ...selection, textHash: await sha256Text(partText) }, reviewed.script.text)
  const requestKey = await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'voice-request-id', [input.viewerKey, submissionKey])
  const row = parseTtrpgOpenVoiceRequestV1({ schema: 'storyforge.ttrpg-open-voice-request', version: 1,
    sourceRef: { sessionKey: loaded.runtime.sessionKey, sequence: loaded.state.lastSequence + 1 }, requestKey, submissionKey, preparationKey: crypto.randomUUID(),
    worldTurn: loaded.runtime.openRun!.worldTime.worldTurn, readEvidence: { sequence: loaded.state.lastSequence, stateHash: loaded.stateHash },
    script: reviewed.script, scriptHash: reviewed.scriptHash, textHash: reviewed.textHash, part, runContractHash: '0'.repeat(64), inputArtifactHash: '0'.repeat(64), artifactRefs: [{ artifactKind: 'source-snapshot', contentHash: '0'.repeat(64) }], cancelledRef: null })
  assertTtrpgOpenVoiceReservationV1(loaded.runtime, row)
  row.inputArtifactHash = await sha256Text(canonicalStringify(ttrpgOpenVoiceRequestInputV1(row)))
  row.artifactRefs[0].contentHash = row.inputArtifactHash
  const objective = ttrpgOpenVoiceIntentObjectiveV1(requestKey)
  const original = (await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()).filter(r => JSON.parse(r.contractJson).objective === objective)
  // A lost preparation return is inspected through the original desk. Never
  // create another parent, silently rebind stale input, or retry a dispatch.
  if (original.length) p.fail('原配音意图已存在；请查看原记录，不能借同一提交重建')
  await loaded.assertCurrent()
  let run = await createAgentRunV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, worldGroupId: null, contract: ttrpgOpenVoiceIntentContractV1({ ...input, row }) })
  try {
    run = await appendAgentRunEventV1({ ...input, productRuntimeSessionId: input.sessionId, runId: run.run.id, type: 'step.scheduled',
      payload: { stepId: TTRPG_OPEN_VOICE_REQUEST_STEP_V1 }, expectedLastSequence: run.projection.lastSequence })
    run = await appendAgentRunEventV1({ ...input, productRuntimeSessionId: input.sessionId, runId: run.run.id, type: 'step.started',
      payload: { stepId: TTRPG_OPEN_VOICE_REQUEST_STEP_V1, attempt: 1 }, expectedLastSequence: run.projection.lastSequence })
    run = (await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: run.run.id,
      stepId: TTRPG_OPEN_VOICE_REQUEST_STEP_V1, attempt: 1, artifactKind: 'source-snapshot', content: canonicalStringify(ttrpgOpenVoiceRequestInputV1(row)), expectedLastSequence: run.projection.lastSequence })).snapshot
    row.runContractHash = run.run.contractHash
    await loaded.assertCurrent()
    const event = await reserveTtrpgOpenVoiceRequestForKernelV1({ ...input, baseSequence: loaded.state.lastSequence, baseStateHash: loaded.stateHash,
      commandId: await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'voice-request', [input.viewerKey, submissionKey]), request: row })
    return { requestKey, sequence: event.sequence, generationAllowed: false as const, adoptionAllowed: false as const }
  } catch (error) {
    const committed = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId,
      await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'voice-request', [input.viewerKey, submissionKey])]).first()
    if (!committed || JSON.parse(committed.payloadJson).request?.runContractHash !== run.run.contractHash) {
      const current = await readInstanceAgentRunV1(input.scope, run.run.id)
      if (!['completed', 'failed', 'cancelled'].includes(current.projection.state)) await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId,
        runId: run.run.id, type: 'run.failed', payload: { code: 'voice-intent-not-committed', retryable: false }, expectedLastSequence: current.projection.lastSequence })
    }
    throw error
  }
}

export async function cancelTtrpgOpenVoiceRequestV1(request: TtrpgOpenAudioReadInputV1 & { requestKey: string; decision: typeof TTRPG_OPEN_VOICE_CANCEL_DECISION_V1 }) {
  p.literal(request.decision, TTRPG_OPEN_VOICE_CANCEL_DECISION_V1, 'voice explicit cancellation')
  const input = snapshotInput(request), requestKey = p.key(request.requestKey, 'voice cancellation request'), loaded = await loadTtrpgOpenAudioReadStateV1(input)
  const row = loaded.runtime.openRun!.voiceRequests?.find(r => r.requestKey === requestKey)
  if (!row || row.sourceRef.sessionKey !== loaded.runtime.sessionKey || row.script.scope.issuerViewerKey !== input.viewerKey || !loaded.humanHost) p.fail('只能取消本人的原本团配音请求')
  const original = (await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()).filter(r => JSON.parse(r.contractJson).objective === ttrpgOpenVoiceIntentObjectiveV1(requestKey))
  if (original.length !== 1 || original[0].portableRuntimeOriginJson !== undefined) p.fail('导入或缺失的原配音 Run 只能保留历史，不能重新执行取消')
  if (!row.cancelledRef) await cancelTtrpgOpenVoiceRequestForKernelV1({ ...input, requestKey, baseSequence: loaded.state.lastSequence, baseStateHash: loaded.stateHash,
    commandId: await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'voice-cancel', [input.viewerKey, requestKey]) })
  const run = await readInstanceAgentRunV1(input.scope, original[0].id!)
  if (!['completed', 'failed', 'cancelled'].includes(run.projection.state)) await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: run.run.id,
    type: 'run.cancelled', payload: { reason: '本人明确取消；原任务尚未发送，累计预留不返还。' }, expectedLastSequence: run.projection.lastSequence })
  const current = await loadTtrpgOpenAudioReadStateV1(input)
  return { requestKey, sequence: current.runtime.openRun!.voiceRequests!.find(r => r.requestKey === requestKey)!.cancelledRef!.sequence }
}

export async function readTtrpgOpenVoiceRequestDeskV1(request: TtrpgOpenAudioReadInputV1) {
  const input = snapshotInput(request), loaded = await loadTtrpgOpenAudioReadStateV1(input)
  const requests = loaded.humanHost ? (loaded.runtime.openRun!.voiceRequests ?? []).filter(r => r.script.scope.issuerViewerKey === input.viewerKey && r.script.scope.recipients.some(recipient => recipient.viewerKey === loaded.seat?.viewerKey && recipient.seatKey === loaded.seat.seatKey && recipient.role === loaded.seat.role && recipient.actorKey === loaded.seat.actorKey && recipient.controller === loaded.seat.controller)).map(r => ({
    requestKey: r.requestKey, sourceRef: r.sourceRef, worldTurn: r.worldTurn, script: structuredClone(r.script), part: structuredClone(r.part),
    status: r.cancelledRef ? 'cancelled-before-send' as const : 'reserved-without-dispatch' as const,
    generationAllowed: false as const, adoptionAllowed: false as const })) : []
  await loaded.assertCurrent()
  return { requests, budget: loaded.humanHost ? ttrpgOpenVoiceBudgetV1(loaded.runtime, loaded.runtime.openRun!.worldTime.worldTurn) : null, generationAllowed: false as const, adoptionAllowed: false as const }
}
