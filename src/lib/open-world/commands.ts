import { db } from '../db/schema'
import {
  applyProductRuntimeEvent,
  assertFormalRuntimeSourceUnchangedV1,
  hashProductRuntimeStateV1,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../product/runtime-core'
import type {
  ProductRuntimeEvent,
  TextOpenWorldCommandEventPayloadV1,
  TextOpenWorldCommandLookupV1,
  TextOpenWorldCommandReceiptV1,
} from '../types'
import {
  fingerprintTextOpenWorldCommandV1,
  parseTextOpenWorldCommandEnvelopeV1,
  parseTextOpenWorldCommandEventPayloadV1,
  parseTextOpenWorldCommandLookupKeyV1,
} from './command-contract'
import { replayTextOpenWorldEventProtocolV1 } from './event-contract'
import {
  assertTextOpenWorldVNextProjectionBindingV1,
  verifyTextOpenWorldVNextSessionBindingV1,
} from './session-binding'

function fail(message: string): never { throw new Error(`[text-open-world-command] ${message}`) }

function parseEvent(event: ProductRuntimeEvent): TextOpenWorldCommandEventPayloadV1 {
  if (event.type !== 'textworld.command.committed') fail('commandId已被非vNext命令占用')
  let raw: unknown
  try { raw = JSON.parse(event.payloadJson) } catch { fail('正式命令事件不是合法JSON') }
  const payload = parseTextOpenWorldCommandEventPayloadV1(raw)
  if (event.commandId !== payload.envelope.commandId
    || event.sessionId !== payload.envelope.sessionId
    || event.actorKey !== payload.envelope.actorKey
    || event.baseSequence !== payload.envelope.baseSequence
    || event.baseStateHash !== payload.envelope.baseStateHash
    || event.sequence !== payload.resultingSequence) {
    fail('正式命令事件包络与索引字段不一致')
  }
  return payload
}

async function receiptFromEvent(event: ProductRuntimeEvent, replayed: boolean): Promise<TextOpenWorldCommandReceiptV1> {
  const payload = parseEvent(event)
  const projected = await readProductRuntimeState(event.sessionId, payload.resultingSequence)
  if (await hashProductRuntimeStateV1(projected) !== payload.resultingStateHash) fail('正式命令事件结果Hash与重放状态不一致')
  if (event.id == null) fail('正式命令事件缺少持久化ID')
  return {
    schema: 'storyforge.text-open-world.command-receipt',
    version: 1,
    status: 'committed',
    commandId: payload.envelope.commandId,
    requestFingerprint: payload.requestFingerprint,
    eventId: event.id,
    eventSequence: event.sequence,
    resultingSequence: payload.resultingSequence,
    resultingStateHash: payload.resultingStateHash,
    committedAt: event.createdAt,
    replayed,
  }
}

async function findCommandEvent(sessionId: number, commandId: string): Promise<ProductRuntimeEvent | undefined> {
  return db.productRuntimeEvents.where('[sessionId+commandId]').equals([sessionId, commandId]).first()
}

/** Queries the canonical event log after a client observes an unknown transport result. */
export async function getTextOpenWorldCommandStatusV1(input: {
  sessionId: number
  commandId: string
}): Promise<TextOpenWorldCommandLookupV1> {
  const probe = parseTextOpenWorldCommandLookupKeyV1(input)
  const session = await db.productRuntimeSessions.get(probe.sessionId)
  if (!session || session.kind !== 'text-open-world') fail('文字开放世界Session不存在')
  await verifyTextOpenWorldVNextSessionBindingV1(session)
  const event = await findCommandEvent(probe.sessionId, probe.commandId)
  if (!event) return { status: 'not-found', sessionId: probe.sessionId, commandId: probe.commandId }
  const payload = parseEvent(event)
  return { status: 'committed', envelope: payload.envelope, receipt: await receiptFromEvent(event, true) }
}

/**
 * Establishes the vNext authoritative command boundary. G1-04/G1-06 expand
 * this same transaction with Action resolution and Effect events; callers
 * cannot append the governed marker directly.
 */
export async function commitTextOpenWorldCommandV1(value: unknown): Promise<TextOpenWorldCommandReceiptV1> {
  const envelope = parseTextOpenWorldCommandEnvelopeV1(value)
  const requestFingerprint = await fingerprintTextOpenWorldCommandV1(envelope)
  const previewSession = await db.productRuntimeSessions.get(envelope.sessionId)
  if (!previewSession || previewSession.kind !== 'text-open-world') fail('文字开放世界Session不存在')
  const binding = await verifyTextOpenWorldVNextSessionBindingV1(previewSession)
  return db.transaction('rw', [
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    db.productReleases,
    db.productBuilds,
    db.productProductions,
    db.productProductionBriefs,
  ],
    async () => {
    const session = await db.productRuntimeSessions.get(envelope.sessionId)
    if (!session || session.kind !== 'text-open-world') fail('文字开放世界Session不存在')
    await assertFormalRuntimeSourceUnchangedV1({
      previewSession,
      session,
      frozen: binding.formal,
    })
    const existing = await findCommandEvent(envelope.sessionId, envelope.commandId)
    if (existing) {
      const payload = parseEvent(existing)
      if (payload.requestFingerprint !== requestFingerprint) fail('相同commandId的命令内容不同')
      return receiptFromEvent(existing, true)
    }
    if (session.status !== 'active') fail('只有active Session可以提交命令')

    const current = await readProductRuntimeState(envelope.sessionId)
    assertTextOpenWorldVNextProjectionBindingV1(current.textOpenWorld, binding)
    const currentVersion = await readProductRuntimeStateVersion(envelope.sessionId)
    if (current.lastSequence !== envelope.baseSequence || currentVersion.stateHash !== envelope.baseStateHash) {
      fail('Session状态已变化，请查询命令状态并刷新后重试')
    }
    const events = await db.productRuntimeEvents.where('sessionId').equals(envelope.sessionId).sortBy('sequence')
    const protocol = await replayTextOpenWorldEventProtocolV1(events, session.seed)
    if (protocol.pendingCommandId) fail(`上一命令尚未生成结果批次:${protocol.pendingCommandId}`)
    const resultingSequence = current.lastSequence + 1
    const payload: TextOpenWorldCommandEventPayloadV1 = {
      schema: 'storyforge.text-open-world.command-event', version: 1,
      envelope, requestFingerprint, resultingSequence, resultingStateHash: '0'.repeat(64),
    }
    const createdAt = Date.now()
    const event: ProductRuntimeEvent = {
      projectId: session.projectId,
      worldGroupId: session.worldGroupId ?? null,
      sessionId: envelope.sessionId,
      sequence: resultingSequence,
      type: 'textworld.command.committed',
      actorKey: envelope.actorKey,
      targetKey: null,
      commandId: envelope.commandId,
      baseSequence: envelope.baseSequence,
      baseStateHash: envelope.baseStateHash,
      payloadJson: JSON.stringify(payload),
      createdAt,
    }
    const preview = applyProductRuntimeEvent(current, event)
    const resultingStateHash = await hashProductRuntimeStateV1(preview)
    payload.resultingStateHash = resultingStateHash
    event.payloadJson = JSON.stringify(payload)
    const replayed = applyProductRuntimeEvent(current, event)
    if (await hashProductRuntimeStateV1(replayed) !== resultingStateHash) fail('命令结果预演Hash不一致')
    event.id = (await db.productRuntimeEvents.add(event)) as number
    const stateJson = JSON.stringify(replayed)
    await db.productRuntimeSessions.update(envelope.sessionId, {
      runtimeHeadSequence: resultingSequence,
      runtimeHeadStateJson: stateJson,
      runtimeHeadStateHash: resultingStateHash,
      updatedAt: createdAt,
    })
    return receiptFromEvent(event, false)
  })
}
