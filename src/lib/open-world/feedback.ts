import { db } from '../db/schema'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { hashProductRuntimeStateV1, readProductRuntimeState } from '../product/runtime-core'
import type {
  CreateTextOpenWorldPreflightFeedbackInputV1,
  ProductRuntimeEvent,
  TextOpenWorldDegradationV1,
  TextOpenWorldEffectChangeV1,
  TextOpenWorldFeedbackReceiptV1,
  TextOpenWorldFeedbackStatusV1,
  TextOpenWorldRandomEvidenceV1,
} from '../types'
import { parseTextOpenWorldCommandEventPayloadV1 } from './command-contract'
import {
  parseTextOpenWorldEffectsAppliedEventPayloadV1,
  parseTextOpenWorldRandomResolvedEventPayloadV1,
  replayTextOpenWorldEventProtocolV1,
} from './event-contract'
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  assertTextOpenWorldVNextProjectionBindingV1,
  verifyTextOpenWorldVNextSessionBindingV1,
} from './session-binding'

type Row = Record<string, unknown>
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const TERMINAL: TextOpenWorldFeedbackStatusV1[] = ['succeeded', 'failed', 'degraded']

function fail(message: string): never { throw new Error(`[text-open-world-feedback] ${message}`) }
function row(value: unknown, label: string): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`); return value as Row }
function exact(value: Row, fields: readonly string[], label: string) { const expected = [...fields].sort(); const actual = Object.keys(value).sort(); if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) fail(`${label}字段不符合合同:${actual.join(',')}`) }
function integer(value: unknown, label: string, minimum = 0): number { if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`${label}无效`); return Number(value) }
function nullableInteger(value: unknown, label: string): number | null { return value == null ? null : integer(value, label) }
function token(value: unknown, label: string): string { if (typeof value !== 'string' || !TOKEN.test(value)) fail(`${label}无效`); return value }
function nullableToken(value: unknown, label: string): string | null { return value == null ? null : token(value, label) }
function text(value: unknown, label: string, maximum = 2_000): string { if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label}无效`); return value.trim().normalize('NFC') }
function eventPayload(event: ProductRuntimeEvent): unknown { try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence}不是合法JSON`) } }

async function seal(value: Omit<TextOpenWorldFeedbackReceiptV1, 'receiptHash'>): Promise<TextOpenWorldFeedbackReceiptV1> {
  return verifyTextOpenWorldFeedbackReceiptV1({ ...value, receiptHash: await hashProductProductionValueV2(value) })
}

function presentation(status: TextOpenWorldFeedbackStatusV1, actionLabel: string, details: string[], reason: { code: string; message: string } | null, degradation: TextOpenWorldDegradationV1 | null) {
  const headline = status === 'succeeded' ? `${actionLabel}已完成`
    : status === 'failed' ? `${actionLabel}失败`
      : status === 'degraded' ? `${actionLabel}已结算（降级表现）`
        : status === 'pending' ? `${actionLabel}正在结算`
          : reason?.message ?? `${actionLabel}当前不可执行`
  const supplemental = degradation ? [`降级原因：${degradation.message}`, `替代表现：${degradation.fallback}`] : []
  return { headline, details: [...details, ...supplemental], mayNarrateSuccess: status === 'succeeded' || status === 'degraded' }
}

/** Creates a non-terminal UI/AI receipt only for an actual rejection or missing confirmation. */
export async function createTextOpenWorldPreflightFeedbackV1(input: CreateTextOpenWorldPreflightFeedbackInputV1): Promise<TextOpenWorldFeedbackReceiptV1> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const actionKey = input.availability.action.key
  let status: 'rejected' | 'confirmation-required'; let reason: { code: string; message: string }
  if (!input.availability.available) {
    const first = input.availability.unavailableReasons[0] ?? fail('不可用Action缺少公开原因')
    status = 'rejected'; reason = { code: first.code, message: first.message }
  } else if (input.availability.confirmationRequired && !input.confirmed) {
    status = 'confirmation-required'; reason = { code: 'confirmation-required', message: '此行动需要再次确认。' }
  } else fail('可直接执行的Action不能生成preflight拒绝回执')
  const result = {
    schema: 'storyforge.text-open-world.feedback-receipt' as const, version: 1 as const, phase: 'preflight' as const,
    status, sessionId: input.sessionId, commandId: null, actionKey, targetKey: input.targetKey,
    baseSequence: integer(input.baseSequence, 'baseSequence'), outcomeCommitted: false,
    commandSequence: null, resultingSequence: null, resultingStateHash: null, outcomeFingerprint: null,
    gameplayStateChanged: false, changes: [], randomEvidence: [], reason, degradation: null,
    presentation: presentation(status, input.availability.action.label, [], reason, null),
    evidenceEventIds: [], evidenceEventSequences: [],
  }
  return seal(result)
}

/**
 * Derives the only player-facing result from canonical events. A committed
 * command without its terminal Effect event returns `pending`, never success.
 */
export async function readTextOpenWorldFeedbackV1(input: { sessionId: number; commandId: string }): Promise<TextOpenWorldFeedbackReceiptV1> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const commandId = token(input.commandId, 'commandId')
  const session = await db.productRuntimeSessions.get(input.sessionId)
  if (!session || session.kind !== 'text-open-world') fail('文字开放世界Session不存在')
  const binding = await verifyTextOpenWorldVNextSessionBindingV1(session)
  const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
  await replayTextOpenWorldEventProtocolV1(events, session.seed)
  const commandEvent = events.find(event => event.type === 'text-open-world.command.committed' && event.commandId === commandId)
    ?? fail('命令不存在')
  if (commandEvent.id == null) fail('命令事件缺少持久化ID')
  const command = parseTextOpenWorldCommandEventPayloadV1(eventPayload(commandEvent))
  const commandState = await readProductRuntimeState(input.sessionId, commandEvent.sequence)
  const projection = commandState.textOpenWorld ?? fail('命令没有vNext Session投影')
  assertTextOpenWorldVNextProjectionBindingV1(projection, binding)
  const action = parseTextOpenWorldModulesV1(projection.runtimePackage).actions.actions.find(item => item.key === command.envelope.actionKey)
    ?? fail(`命令Action不存在:${command.envelope.actionKey}`)
  const targetKey = typeof command.envelope.payload.targetKey === 'string' ? command.envelope.payload.targetKey : null
  const terminalEvent = events.find(event => event.type === 'text-open-world.effects.applied'
    && parseTextOpenWorldEffectsAppliedEventPayloadV1(eventPayload(event)).commandId === commandId)
  if (!terminalEvent) {
    const stateHash = await hashProductRuntimeStateV1(commandState)
    if (stateHash !== command.resultingStateHash) fail('pending命令的状态Hash不一致')
    return seal({
      schema: 'storyforge.text-open-world.feedback-receipt', version: 1, phase: 'pending', status: 'pending',
      sessionId: input.sessionId, commandId, actionKey: action.key, targetKey, baseSequence: command.envelope.baseSequence,
      outcomeCommitted: false, commandSequence: commandEvent.sequence, resultingSequence: commandEvent.sequence,
      resultingStateHash: stateHash, outcomeFingerprint: null, gameplayStateChanged: false,
      changes: [], randomEvidence: [], reason: null, degradation: null,
      presentation: presentation('pending', action.label, [], null, null),
      evidenceEventIds: [commandEvent.id], evidenceEventSequences: [commandEvent.sequence],
    })
  }
  if (terminalEvent.id == null) fail('终态事件缺少持久化ID')
  const terminal = parseTextOpenWorldEffectsAppliedEventPayloadV1(eventPayload(terminalEvent))
  const randomEvents = terminal.randomEventSequences.map(sequence => events.find(event => event.sequence === sequence) ?? fail(`随机证据事件不存在:${sequence}`))
  if (randomEvents.some(event => event.id == null)) fail('随机证据事件缺少持久化ID')
  const randomEvidence = randomEvents.map(event => parseTextOpenWorldRandomResolvedEventPayloadV1(eventPayload(event)).evidence)
  const finalState = await readProductRuntimeState(input.sessionId, terminalEvent.sequence)
  const resultingStateHash = await hashProductRuntimeStateV1(finalState)
  const status: TextOpenWorldFeedbackStatusV1 = terminal.outcome === 'success' ? 'succeeded' : terminal.outcome === 'failure' ? 'failed' : 'degraded'
  const reason = terminal.reason
  return seal({
    schema: 'storyforge.text-open-world.feedback-receipt', version: 1, phase: 'terminal', status,
    sessionId: input.sessionId, commandId, actionKey: action.key, targetKey, baseSequence: command.envelope.baseSequence,
    outcomeCommitted: true, commandSequence: commandEvent.sequence, resultingSequence: terminalEvent.sequence,
    resultingStateHash, outcomeFingerprint: terminal.outcomeFingerprint,
    gameplayStateChanged: terminal.receipt.baseStateHash !== terminal.receipt.resultingStateHash,
    changes: structuredClone(terminal.receipt.changes), randomEvidence, reason, degradation: terminal.degradation,
    presentation: presentation(status, action.label, terminal.receipt.changes.map(change => change.summary), reason, terminal.degradation),
    evidenceEventIds: [commandEvent.id, ...randomEvents.map(event => event.id!), terminalEvent.id],
    evidenceEventSequences: [commandEvent.sequence, ...terminal.randomEventSequences, terminalEvent.sequence],
  })
}

/** Verifies feedback received from cache/UI before it is used for narration. */
export async function verifyTextOpenWorldFeedbackReceiptV1(value: unknown): Promise<TextOpenWorldFeedbackReceiptV1> {
  const parsed = row(value, 'receipt')
  exact(parsed, ['schema', 'version', 'phase', 'status', 'sessionId', 'commandId', 'actionKey', 'targetKey', 'baseSequence', 'outcomeCommitted', 'commandSequence', 'resultingSequence', 'resultingStateHash', 'outcomeFingerprint', 'gameplayStateChanged', 'changes', 'randomEvidence', 'reason', 'degradation', 'presentation', 'evidenceEventIds', 'evidenceEventSequences', 'receiptHash'], 'receipt')
  if (parsed.schema !== 'storyforge.text-open-world.feedback-receipt' || parsed.version !== 1) fail('receipt schema/version无效')
  if (parsed.phase !== 'preflight' && parsed.phase !== 'pending' && parsed.phase !== 'terminal') fail('phase无效')
  const status = parsed.status as TextOpenWorldFeedbackStatusV1
  if (!['rejected', 'confirmation-required', 'pending', ...TERMINAL].includes(status)) fail('status无效')
  const commandId = nullableToken(parsed.commandId, 'commandId'); const commandSequence = nullableInteger(parsed.commandSequence, 'commandSequence'); const resultingSequence = nullableInteger(parsed.resultingSequence, 'resultingSequence')
  const resultingStateHash = parsed.resultingStateHash == null ? null : isSha256Hash(parsed.resultingStateHash) ? parsed.resultingStateHash : fail('resultingStateHash无效')
  const outcomeFingerprint = parsed.outcomeFingerprint == null ? null : isSha256Hash(parsed.outcomeFingerprint) ? parsed.outcomeFingerprint : fail('outcomeFingerprint无效')
  if (typeof parsed.outcomeCommitted !== 'boolean' || typeof parsed.gameplayStateChanged !== 'boolean') fail('boolean字段无效')
  if (!Array.isArray(parsed.changes) || !Array.isArray(parsed.randomEvidence) || !Array.isArray(parsed.evidenceEventIds) || !Array.isArray(parsed.evidenceEventSequences)) fail('数组字段无效')
  const changes = structuredClone(parsed.changes) as TextOpenWorldEffectChangeV1[]; const randomEvidence = structuredClone(parsed.randomEvidence) as TextOpenWorldRandomEvidenceV1[]
  canonicalProductProductionJsonV2(changes); canonicalProductProductionJsonV2(randomEvidence)
  const reason = parsed.reason == null ? null : row(parsed.reason, 'reason'); if (reason) exact(reason, ['code', 'message'], 'reason')
  const parsedReason = reason ? { code: token(reason.code, 'reason.code'), message: text(reason.message, 'reason.message') } : null
  const degradation = parsed.degradation == null ? null : row(parsed.degradation, 'degradation'); if (degradation) exact(degradation, ['code', 'message', 'unavailableCapability', 'fallback'], 'degradation')
  const parsedDegradation = degradation ? { code: token(degradation.code, 'degradation.code'), message: text(degradation.message, 'degradation.message'), unavailableCapability: token(degradation.unavailableCapability, 'degradation.unavailableCapability'), fallback: text(degradation.fallback, 'degradation.fallback') } : null
  const view = row(parsed.presentation, 'presentation'); exact(view, ['headline', 'details', 'mayNarrateSuccess'], 'presentation')
  if (!Array.isArray(view.details) || typeof view.mayNarrateSuccess !== 'boolean') fail('presentation无效')
  const normalized: TextOpenWorldFeedbackReceiptV1 = {
    schema: 'storyforge.text-open-world.feedback-receipt', version: 1, phase: parsed.phase, status,
    sessionId: integer(parsed.sessionId, 'sessionId', 1), commandId, actionKey: token(parsed.actionKey, 'actionKey'), targetKey: nullableToken(parsed.targetKey, 'targetKey'), baseSequence: integer(parsed.baseSequence, 'baseSequence'),
    outcomeCommitted: parsed.outcomeCommitted, commandSequence, resultingSequence, resultingStateHash, outcomeFingerprint,
    gameplayStateChanged: parsed.gameplayStateChanged, changes, randomEvidence, reason: parsedReason, degradation: parsedDegradation,
    presentation: { headline: text(view.headline, 'presentation.headline'), details: view.details.map((item, index) => text(item, `presentation.details[${index}]`, 10_000)), mayNarrateSuccess: view.mayNarrateSuccess },
    evidenceEventIds: parsed.evidenceEventIds.map((item, index) => integer(item, `evidenceEventIds[${index}]`, 1)),
    evidenceEventSequences: parsed.evidenceEventSequences.map((item, index) => integer(item, `evidenceEventSequences[${index}]`, 1)),
    receiptHash: isSha256Hash(parsed.receiptHash) ? parsed.receiptHash : fail('receiptHash无效'),
  }
  if (normalized.phase === 'terminal' ? !TERMINAL.includes(status) || !normalized.outcomeCommitted : normalized.phase === 'pending' ? status !== 'pending' || normalized.outcomeCommitted : (status !== 'rejected' && status !== 'confirmation-required') || normalized.outcomeCommitted) fail('phase/status/outcomeCommitted不一致')
  if (normalized.presentation.mayNarrateSuccess !== (status === 'succeeded' || status === 'degraded')) fail('mayNarrateSuccess与正式结果不一致')
  if (normalized.phase === 'preflight' && (!normalized.reason || normalized.commandId != null || normalized.evidenceEventIds.length || normalized.evidenceEventSequences.length)) fail('preflight回执证据或原因无效')
  if (normalized.phase !== 'preflight' && (!normalized.commandId || normalized.commandSequence == null || normalized.resultingSequence == null || !normalized.resultingStateHash)) fail('事件派生回执缺少命令或状态证据')
  if (normalized.phase === 'pending' && (normalized.outcomeFingerprint != null || normalized.reason != null || normalized.gameplayStateChanged || normalized.changes.length || normalized.randomEvidence.length)) fail('pending回执提前宣称终态结果')
  if (normalized.phase === 'terminal' && (!normalized.outcomeFingerprint || normalized.evidenceEventSequences[normalized.evidenceEventSequences.length - 1] !== normalized.resultingSequence)) fail('终态回执缺少结果指纹或终态事件')
  if (normalized.commandSequence != null && normalized.resultingSequence != null && normalized.resultingSequence < normalized.commandSequence) fail('结果序号早于命令序号')
  if (new Set(normalized.evidenceEventIds).size !== normalized.evidenceEventIds.length || new Set(normalized.evidenceEventSequences).size !== normalized.evidenceEventSequences.length) fail('证据事件不能重复')
  if (normalized.evidenceEventSequences.some((sequence, index, values) => index > 0 && sequence <= values[index - 1])) fail('证据事件序号必须严格递增')
  if (status === 'failed' && !normalized.reason) fail('失败回执缺少原因')
  if (status === 'degraded' && !normalized.degradation) fail('降级回执缺少降级说明')
  if (status !== 'degraded' && normalized.degradation) fail('非降级回执不能带降级说明')
  if (normalized.phase !== 'terminal' && normalized.changes.length) fail('非终态回执不能宣称状态变化')
  const { receiptHash, ...unsigned } = normalized
  if (await hashProductProductionValueV2(unsigned) !== receiptHash) fail('receiptHash不匹配')
  return normalized
}
