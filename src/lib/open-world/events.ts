import { db } from '../db/schema'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import {
  applyProductRuntimeEvent,
  assertFormalRuntimeSourceUnchangedV1,
  hashProductRuntimeStateV1,
  replayProductRuntimeEvents,
} from '../product/runtime-core'
import type {
  ProductRuntimeEvent,
  TextOpenWorldEffectPlanV1,
  TextOpenWorldEffectReceiptV1,
  TextOpenWorldOutcomeBatchReceiptV1,
  TextOpenWorldRandomRequestV1,
  TextOpenWorldRulesetStampV1,
} from '../types'
import { parseTextOpenWorldCommandEventPayloadV1 } from './command-contract'
import { createTextOpenWorldEffectCatalogV1 } from './effect-dsl'
import {
  createTextOpenWorldOutcomeFingerprintV1,
  parseTextOpenWorldEffectsAppliedEventPayloadV1,
  parseTextOpenWorldRandomRequestV1,
  replayTextOpenWorldEventProtocolV1,
  resolveTextOpenWorldRandomEvidenceV1,
} from './event-contract'
import {
  assertTextOpenWorldVNextProjectionBindingV1,
  verifyTextOpenWorldVNextSessionBindingV1,
} from './session-binding'

function fail(message: string): never { throw new Error(`[text-open-world-event] ${message}`) }
function payload(event: ProductRuntimeEvent): unknown { try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence} payload不是合法JSON`) } }

function priorReceipt(input: {
  commandId: string
  commandSequence: number
  outcomeFingerprint: string
  events: ProductRuntimeEvent[]
  replayed: boolean
}): TextOpenWorldOutcomeBatchReceiptV1 {
  const effectEvent = input.events.find(event => event.type === 'textworld.effects.applied' && parseTextOpenWorldEffectsAppliedEventPayloadV1(payload(event)).commandId === input.commandId)
  if (!effectEvent?.id) fail('已提交Effect事件缺少持久化ID')
  const effectPayload = parseTextOpenWorldEffectsAppliedEventPayloadV1(payload(effectEvent))
  if (effectPayload.outcomeFingerprint !== input.outcomeFingerprint || effectPayload.commandSequence !== input.commandSequence) fail('相同commandId的结果批次内容不同')
  const randomEvents = effectPayload.randomEventSequences.map(sequence => input.events.find(event => event.sequence === sequence) ?? fail(`随机事件不存在:${sequence}`))
  if (randomEvents.some(event => !event.id)) fail('已提交随机事件缺少持久化ID')
  return {
    schema: 'storyforge.text-open-world.outcome-batch-receipt', version: 1, status: 'committed',
    commandId: input.commandId, commandSequence: input.commandSequence,
    randomEventIds: randomEvents.map(event => event.id!), randomEventSequences: [...effectPayload.randomEventSequences],
    effectsEventId: effectEvent.id, effectsEventSequence: effectEvent.sequence, resultingSequence: effectEvent.sequence,
    outcomeFingerprint: input.outcomeFingerprint, replayed: input.replayed,
  }
}

/**
 * Appends the deterministic outcome of an already accepted command as one
 * atomic event batch. Random draws are derived from the frozen Session seed;
 * callers can request ranges but cannot supply outcomes.
 */
export async function commitTextOpenWorldOutcomeBatchV1(input: {
  sessionId: number
  commandId: string
  ruleset: TextOpenWorldRulesetStampV1
  randomRequests: TextOpenWorldRandomRequestV1[]
  plan: TextOpenWorldEffectPlanV1
  receipt: TextOpenWorldEffectReceiptV1
}): Promise<TextOpenWorldOutcomeBatchReceiptV1> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  if (!Array.isArray(input.randomRequests) || input.randomRequests.length > 128) fail('randomRequests最多128项')
  const randomRequests = input.randomRequests.map((request, index) => parseTextOpenWorldRandomRequestV1(request, `randomRequests[${index}]`))
  const previewSession = await db.productRuntimeSessions.get(input.sessionId)
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
    const session = await db.productRuntimeSessions.get(input.sessionId)
    if (!session || session.kind !== 'text-open-world') fail('文字开放世界Session不存在')
    const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
    await assertFormalRuntimeSourceUnchangedV1({
      previewSession,
      session,
      frozen: binding.formal,
    })
    const commandEvent = events.find(event => event.commandId === input.commandId)
    if (!commandEvent || commandEvent.type !== 'textworld.command.committed') fail('对应命令尚未提交')
    const command = parseTextOpenWorldCommandEventPayloadV1(payload(commandEvent))
    if (command.envelope.commandId !== input.commandId) fail('命令索引与payload不一致')
    const outcomeFingerprint = await createTextOpenWorldOutcomeFingerprintV1({
      commandId: input.commandId, commandSequence: commandEvent.sequence, ruleset: input.ruleset,
      randomRequests, plan: input.plan, receipt: input.receipt,
    })
    const projection = await replayTextOpenWorldEventProtocolV1(events, session.seed)
    const existing = projection.batches.find(batch => batch.commandId === input.commandId)
    if (existing) return priorReceipt({ commandId: input.commandId, commandSequence: commandEvent.sequence, outcomeFingerprint, events, replayed: true })
    if (session.status !== 'active') fail('只有active Session可以提交结果批次')
    if (session.rulesetVersion !== input.ruleset.version) fail('结果批次rulesetVersion与Session不一致')
    if (projection.pendingCommandId !== input.commandId || projection.lastSequence !== commandEvent.sequence) fail('对应命令不是当前待处理命令')

    const now = Date.now(); let currentState = replayProductRuntimeEvents(JSON.parse(session.initialStateJson), events); let sequence = projection.lastSequence
    assertTextOpenWorldVNextProjectionBindingV1(currentState.textOpenWorld, binding)
    if (currentState.textOpenWorld) {
      const verified = await createTextOpenWorldEffectCatalogV1(currentState.textOpenWorld.runtimePackage).apply({ plan: input.plan, state: currentState.textOpenWorld.state })
      if (canonicalProductProductionJsonV2(verified.receipt) !== canonicalProductProductionJsonV2(input.receipt)) fail('Effect回执与当前Session投影不一致')
    }
    const appended: ProductRuntimeEvent[] = []
    for (let index = 0; index < randomRequests.length; index += 1) {
      sequence += 1
      const evidence = await resolveTextOpenWorldRandomEvidenceV1({ seed: session.seed, commandId: input.commandId, commandSequence: commandEvent.sequence, drawIndex: index, request: randomRequests[index] })
      const event: ProductRuntimeEvent = {
        projectId: session.projectId, worldGroupId: session.worldGroupId ?? null, sessionId: input.sessionId, sequence,
        type: 'textworld.random.resolved', actorKey: command.envelope.actorKey, targetKey: null,
        commandId: null, baseSequence: null, baseStateHash: null,
        payloadJson: JSON.stringify({
          schema: 'storyforge.text-open-world.random-resolved-event', version: 1,
          commandId: input.commandId, commandSequence: commandEvent.sequence, ruleset: input.ruleset, evidence,
        }), createdAt: now,
      }
      currentState = applyProductRuntimeEvent(currentState, event); appended.push(event)
    }
    sequence += 1
    const effectPayload = parseTextOpenWorldEffectsAppliedEventPayloadV1({
      schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
      commandId: input.commandId, commandSequence: commandEvent.sequence, ruleset: input.ruleset,
      randomEventSequences: appended.map(event => event.sequence), plan: input.plan, receipt: input.receipt, outcomeFingerprint,
    })
    const effectEvent: ProductRuntimeEvent = {
      projectId: session.projectId, worldGroupId: session.worldGroupId ?? null, sessionId: input.sessionId, sequence,
      type: 'textworld.effects.applied', actorKey: command.envelope.actorKey, targetKey: null,
      commandId: null, baseSequence: null, baseStateHash: null, payloadJson: JSON.stringify(effectPayload), createdAt: now,
    }
    currentState = applyProductRuntimeEvent(currentState, effectEvent); appended.push(effectEvent)
    await replayTextOpenWorldEventProtocolV1([...events, ...appended], session.seed)
    for (const event of appended) event.id = await db.productRuntimeEvents.add(event) as number
    const stateJson = JSON.stringify(currentState)
    const stateHash = await hashProductRuntimeStateV1(currentState)
    await db.productRuntimeSessions.update(input.sessionId, {
      runtimeHeadSequence: sequence, runtimeHeadStateJson: stateJson, runtimeHeadStateHash: stateHash, updatedAt: now,
    })
    return priorReceipt({ commandId: input.commandId, commandSequence: commandEvent.sequence, outcomeFingerprint, events: [...events, ...appended], replayed: false })
  })
}
