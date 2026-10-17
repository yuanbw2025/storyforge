import type { ExactRunArtifactIdentityV1 } from '../types'
/** Persistent human intent and cumulative reservations. This journal grants no
 * model invocation, candidate adoption, playback, or mechanical game action. */
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenVoiceScriptV1, type TtrpgOpenVoiceScriptV1 } from './open-voice-script-contract'
import { createTtrpgOpenVoiceScriptV1, ttrpgOpenAudioNarrationV1 } from './open-audio-contract'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1, TTRPG_AUDIO_MAX_REQUESTS_PER_WORLD_TURN_V1,
  TTRPG_AUDIO_MAX_VOICE_CHARACTERS_PER_WORLD_TURN_V1 } from './open-audio-runtime'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_VOICE_RESERVE_DECISION_V1 = 'reserve-this-original-voice-part' as const
export const TTRPG_OPEN_VOICE_CANCEL_DECISION_V1 = 'cancel-this-unsent-voice-request' as const
export const TTRPG_OPEN_VOICE_REQUEST_STEP_V1 = 'ttrpg.open.voice-request' as const
export interface TtrpgOpenVoiceRequestV1 {
  schema: 'storyforge.ttrpg-open-voice-request'; version: 1
  sourceRef: TtrpgOpenSourceRefV1; requestKey: string; submissionKey: string; preparationKey: string; worldTurn: number
  readEvidence: { sequence: number; stateHash: string }
  script: TtrpgOpenVoiceScriptV1; scriptHash: string; textHash: string
  part: { textOffset: number; textLength: number; textHash: string }
  runContractHash: string; inputArtifactHash: string; artifactRefs: ExactRunArtifactIdentityV1[]; cancelledRef: TtrpgOpenSourceRefV1 | null
}
export function parseTtrpgOpenVoicePartV1(value: unknown, text: string): TtrpgOpenVoiceRequestV1['part'] {
  const r = p.record(value, ['textOffset', 'textLength', 'textHash'], 'voice exact part')
  const part = { textOffset: p.integer(r.textOffset, 'voice offset', 0, text.length),
    textLength: p.integer(r.textLength, 'voice length', 1, TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1), textHash: p.hash(r.textHash, 'voice part hash') }
  const end = part.textOffset + part.textLength
  const bisectsSurrogate = (offset: number) => offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])
  if (end > text.length || bisectsSurrogate(part.textOffset) || bisectsSurrogate(end) || !text.slice(part.textOffset, end).trim()) p.fail('朗读片段须是完整原文范围，不能越界、拆开 UTF-16 字符或只含空白')
  return part
}
export function parseTtrpgOpenVoiceRequestV1(value: unknown): TtrpgOpenVoiceRequestV1 {
  const r = p.record(value, ['schema', 'version', 'sourceRef', 'requestKey', 'submissionKey', 'preparationKey', 'worldTurn', 'readEvidence', 'script', 'scriptHash', 'textHash', 'part', 'runContractHash', 'inputArtifactHash', 'artifactRefs', 'cancelledRef'], 'voice request')
  const script = parseTtrpgOpenVoiceScriptV1(r.script), sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef)
  const e = p.record(r.readEvidence, ['sequence', 'stateHash'], 'voice read evidence')
  const readEvidence = { sequence: p.integer(e.sequence, 'voice read sequence', 0), stateHash: p.hash(e.stateHash, 'voice read hash') }
  const artifactRefs = p.list(r.artifactRefs, 'voice input roots', value => {
    const a = p.record(value, ['artifactKind', 'contentHash'], 'voice input root')
    return { artifactKind: p.literal(a.artifactKind, 'source-snapshot', 'voice input kind'), contentHash: p.hash(a.contentHash, 'voice input root hash') }
  }, 1, 1)
  if (artifactRefs[0].contentHash !== r.inputArtifactHash) p.fail('配音输入工件与保留引用不一致')
  const cancelledRef = p.nullable(r.cancelledRef, parseTtrpgOpenSourceRefV1, 'voice cancellation ref')
  if (sourceRef.sessionKey !== script.sessionKey || sourceRef.sequence !== readEvidence.sequence + 1
    || cancelledRef && (cancelledRef.sessionKey !== sourceRef.sessionKey || cancelledRef.sequence <= sourceRef.sequence)) p.fail('配音请求或取消缺少原准确事件位置')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-voice-request', 'voice request schema'), version: p.literal(r.version, 1, 'voice request version'),
    sourceRef, requestKey: p.key(r.requestKey, 'voice request key'), submissionKey: p.key(r.submissionKey, 'voice submission'), preparationKey: p.key(r.preparationKey, 'voice original preparation'),
    worldTurn: p.integer(r.worldTurn, 'voice request world turn', 0), readEvidence, script,
    scriptHash: p.hash(r.scriptHash, 'voice script hash'), textHash: p.hash(r.textHash, 'voice text hash'), part: parseTtrpgOpenVoicePartV1(r.part, script.text),
    runContractHash: p.hash(r.runContractHash, 'voice original run hash'), inputArtifactHash: p.hash(r.inputArtifactHash, 'voice input artifact hash'), artifactRefs, cancelledRef }
}
export function ttrpgOpenVoiceRequestInputV1(row: TtrpgOpenVoiceRequestV1) {
  return { schema: 'storyforge.ttrpg-open-voice-intent', version: 1, requestKey: row.requestKey, submissionKey: row.submissionKey, preparationKey: row.preparationKey,
    worldTurn: row.worldTurn, readEvidence: row.readEvidence, script: row.script, scriptHash: row.scriptHash, textHash: row.textHash, part: row.part }
}
export function ttrpgOpenVoiceReservationPayloadV1(raw: TtrpgOpenVoiceRequestV1) {
  const request = { ...raw, cancelledRef: null }
  return { request, intent: { viewerKey: request.script.scope.issuerViewerKey, submissionKey: request.submissionKey,
    requestKey: request.requestKey, runContractHash: request.runContractHash, inputArtifactHash: request.inputArtifactHash, decision: TTRPG_OPEN_VOICE_RESERVE_DECISION_V1 } }
}
export function ttrpgOpenVoiceCancellationPayloadV1(row: TtrpgOpenVoiceRequestV1, viewerKey: string) {
  return { requestRef: row.sourceRef, cancellationRef: row.cancelledRef,
    intent: { viewerKey, requestKey: row.requestKey, decision: TTRPG_OPEN_VOICE_CANCEL_DECISION_V1 } }
}
/** Every reservation consumes the original turn budget, including cancelled
 * intent. Refresh, a new Run, or a branch cannot reset that history. */
export function ttrpgOpenVoiceBudgetV1(runtime: TtrpgRuntimeStateV2, worldTurn: number) {
  const rows = (runtime.openRun?.voiceRequests ?? []).filter(row => row.worldTurn === worldTurn)
  return { requests: rows.length, characters: rows.reduce((n, row) => n + row.part.textLength, 0),
    maximumRequests: TTRPG_AUDIO_MAX_REQUESTS_PER_WORLD_TURN_V1, maximumCharacters: TTRPG_AUDIO_MAX_VOICE_CHARACTERS_PER_WORLD_TURN_V1 }
}
export function assertTtrpgOpenVoiceReservationV1(runtime: TtrpgRuntimeStateV2, row: TtrpgOpenVoiceRequestV1) {
  if (!runtime.openRun || row.sourceRef.sessionKey !== runtime.sessionKey || row.cancelledRef !== null
    || row.worldTurn !== runtime.openRun.worldTime.worldTurn) p.fail('配音预留必须属于本团当前轮次')
  const current = createTtrpgOpenVoiceScriptV1({ runtime, runtimeSourceHash: row.script.runtimeSourceHash, viewerKey: row.script.scope.issuerViewerKey,
    narrationSourceRef: row.script.narrationSourceRef, audience: row.script.scope.audience, privateActorKey: row.script.scope.privateActorKey })
  if (stable(current) !== stable(row.script) || runtime.openRun.voiceRequests?.some(old => old.requestKey === row.requestKey
    || old.sourceRef.sessionKey === row.sourceRef.sessionKey && old.submissionKey === row.submissionKey)) p.fail('原文字、接收者已变化，或原配音请求已存在')
  const budget = ttrpgOpenVoiceBudgetV1(runtime, row.worldTurn)
  if (budget.requests >= budget.maximumRequests || budget.characters + row.part.textLength > budget.maximumCharacters) p.fail('本世界轮配音累计预算已用尽；取消或重建不能返还额度')
}
export function assertTtrpgOpenVoiceCancellationV1(runtime: TtrpgRuntimeStateV2, requestKey: string, viewerKey: string) {
  if (!runtime.authorization) p.fail('配音取消需要当前真人主持')
  assertTtrpgOpenHumanHostV1(runtime.authorization, viewerKey)
  const row = runtime.openRun?.voiceRequests?.find(row => row.requestKey === requestKey)
  if (!row || row.sourceRef.sessionKey !== runtime.sessionKey || row.script.scope.issuerViewerKey !== viewerKey || row.cancelledRef) p.fail('只能取消本人尚未发送的原本团请求；祖先或导入历史不授予执行权')
  return row
}
export function assertTtrpgOpenVoiceJournalV1(runtime: TtrpgRuntimeStateV2) {
  const seen = new Set<string>(), sources = new Set<string>(), budgets = new Map<number, { requests: number; characters: number }>()
  for (const row of runtime.openRun?.voiceRequests ?? []) {
    const ref = row.sourceRef
    if (seen.has(row.requestKey) || sources.has(stable(ref)) || row.worldTurn > runtime.openRun!.worldTime.worldTurn) p.fail('配音请求身份、事件或轮次不一致')
    seen.add(row.requestKey); sources.add(stable(ref))
    const narration = ttrpgOpenAudioNarrationV1(runtime, row.script.narrationSourceRef)
    if (row.script.text !== narration.narration.paragraphs.map(p => p.text).join('\n\n') || stable(row.script.narrationBinding) !== stable(narration.binding)) p.fail('配音历史必须保留原已确认全文')
    if (ref.sessionKey !== runtime.sessionKey && !runtime.branchLineage?.ancestors.some(a => a.sessionKey === ref.sessionKey && a.throughSequence >= (row.cancelledRef?.sequence ?? ref.sequence)
      && a.snapshot.openRun?.voiceRequests?.some(old => stable(old) === stable(row)))) p.fail('配音请求缺少准确祖先切点')
    const budget = budgets.get(row.worldTurn) ?? { requests: 0, characters: 0 }
    budget.requests++; budget.characters += row.part.textLength; budgets.set(row.worldTurn, budget)
    if (budget.requests > TTRPG_AUDIO_MAX_REQUESTS_PER_WORLD_TURN_V1 || budget.characters > TTRPG_AUDIO_MAX_VOICE_CHARACTERS_PER_WORLD_TURN_V1) p.fail('配音累计预留超过原世界轮预算')
  }
}
