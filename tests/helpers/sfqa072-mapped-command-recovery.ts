import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { getTextOpenWorldCommandStatusV1 } from '../../src/lib/open-world/commands'
import {
  generateTextOpenWorldRuntimeIntentV1,
  projectTextOpenWorldRuntimeIntentEvidenceV1,
} from '../../src/lib/open-world/runtime-intent'
import type { ProductRuntimeEvent } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from './text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from './text-open-world-vnext-fixture'

export async function createMappedCommandRecoveryFixtureV1(label: string, selection: 'action' | 'choice' = 'choice') {
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `SFQA072-${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
    runtimeShape: 'vnext-only',
    title: `SFQA072 ${label}`,
    seed: `sfqa072-${label}`,
  })
  const calls = { mapping: 0 }
  const resolution = await generateTextOpenWorldRuntimeIntentV1({
    scope: created.scope,
    productRuntimeSessionId: created.session.id!,
    selectedSceneKey: 'scene.offer.main',
    utterance: '我愿意帮她调查盐渠断流。',
    runAI: async () => {
      calls.mapping += 1
      return JSON.stringify({
        kind: selection === 'action' ? 'mapped-action' : 'mapped-choice', confidence: 0.98,
        actionKeys: selection === 'action' ? ['action.accept-main'] : [],
        choiceKeys: selection === 'choice' ? ['choice.accept-main'] : [],
        extractedArguments: { targetKey: null },
        rationale: '选择当前场景已有的受治理选项。',
        requiresConfirmation: false, boundaryExplanation: null, replyText: '',
      })
    },
  })
  const option = resolution.options[0]
  if (resolution.status !== 'mapped' || !option) throw new Error('SFQA072 缺少真实映射授权')
  const projected = await projectTextOpenWorldRuntimeIntentEvidenceV1(option.authorization)
  const request = {
    sessionId: created.session.id!,
    actionKey: option.actionKey,
    targetKey: option.targetKey,
    source: 'mapped-intent' as const,
    expectedBaseSequence: resolution.baseSequence,
    runtimeIntentAuthorization: option.authorization,
    commandId: `command.sfqa072.${crypto.randomUUID()}`,
    requestedAt: 2_000,
  }
  return { ...created, calls, resolution, request, evidence: projected.evidence }
}

/** Interrupt only the outcome transaction, after the public executor has
 * durably committed and authorized the original command. No command is forged. */
export function interruptMappedOutcomeV1(target: string | { sessionId: number }) {
  let commandId = typeof target === 'string' ? target : null
  let interruptions = 0
  const sentinel = 'SFQA072-interrupt-outcome'
  const hook = (_key: unknown, event: ProductRuntimeEvent) => {
    if (typeof target !== 'string' && event.sessionId !== target.sessionId) return
    if (event.type === 'text-open-world.command.committed' && commandId === null) {
      const payload = JSON.parse(event.payloadJson) as { envelope?: { source?: unknown; commandId?: unknown } }
      if (payload.envelope?.source === 'mapped-intent' && typeof payload.envelope.commandId === 'string') {
        commandId = payload.envelope.commandId
      }
    }
    if (event.type !== 'text-open-world.effects.applied') return
    const payload = JSON.parse(event.payloadJson) as { commandId?: unknown }
    if (payload.commandId !== commandId) return
    interruptions += 1
    throw new Error(sentinel)
  }
  db.productRuntimeEvents.hook('creating', hook)
  return {
    sentinel,
    get commandId() { return commandId },
    get interruptions() { return interruptions },
    stop: () => db.productRuntimeEvents.hook('creating').unsubscribe(hook),
  }
}

export async function commitInterruptedMappedCommandV1(label: string, selection: 'action' | 'choice' = 'choice') {
  const created = await createMappedCommandRecoveryFixtureV1(label, selection)
  const interrupted = interruptMappedOutcomeV1(created.request.commandId)
  let error: unknown
  try {
    await executeTextOpenWorldActionV1(created.request)
  } catch (caught) {
    error = caught
  } finally {
    interrupted.stop()
  }
  if (interrupted.interruptions !== 1 || !(error instanceof Error)
    || !error.message.includes(interrupted.sentinel)) {
    throw new Error(`SFQA072 未到达真实命令提交后的中断边界:${String(error)}`)
  }
  const status = await getTextOpenWorldCommandStatusV1({
    sessionId: created.session.id!, commandId: created.request.commandId,
  })
  if (status.status !== 'committed') throw new Error('SFQA072 原规范命令未持久化')
  return { ...created, envelope: status.envelope, commandReceipt: status.receipt }
}

export async function readMappedCommandEventsV1(sessionId: number, commandId: string) {
  const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
  return events.filter(event => {
    if (event.type === 'text-open-world.command.committed') return event.commandId === commandId
    if (event.type !== 'text-open-world.effects.applied' && event.type !== 'text-open-world.random.resolved') return false
    return (JSON.parse(event.payloadJson) as { commandId?: unknown }).commandId === commandId
  })
}
