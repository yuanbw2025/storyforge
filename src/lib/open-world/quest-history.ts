import type {
  ProductRuntimeEvent,
  TextOpenWorldQuestDeadlineProjectionV1,
  TextOpenWorldQuestHistoryEntryV1,
  TextOpenWorldQuestHistoryKindV1,
  TextOpenWorldQuestInstanceV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldEffectsAppliedEventPayloadV1 } from './event-contract'
import { parseTextOpenWorldModulesV1 } from './modules'

function fail(message: string): never { throw new Error(`[text-open-world-quest-history] ${message}`) }
function payload(event: ProductRuntimeEvent): unknown {
  try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence}不是合法JSON`) }
}

const INTENT_KIND: Partial<Record<string, TextOpenWorldQuestHistoryKindV1>> = {
  accept: 'accepted', activate: 'activated', suspend: 'suspended', resume: 'resumed',
  'advance-stage': 'stage-advanced', complete: 'completed', fail: 'failed', abandon: 'abandoned',
  expire: 'expired', withdraw: 'withdrawn', reoffer: 'reoffered',
}

/** Read-only task ledger rebuilt from canonical Effect events; it owns no duplicate persistence. */
export function projectTextOpenWorldQuestHistoryV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown
  events: readonly ProductRuntimeEvent[]
  instanceKey?: string | null
}): TextOpenWorldQuestHistoryEntryV1[] {
  const modules = parseTextOpenWorldModulesV1(input.runtimePackage)
  const definitions = new Map(modules.quests.quests.map(definition => [definition.key, definition]))
  const stages = new Map(modules.quests.stages.map(stage => [stage.key, stage]))
  const objectives = new Map(modules.quests.objectives.map(objective => [objective.key, objective]))
  const ordered = [...input.events].sort((left, right) => left.sequence - right.sequence)
  if (new Set(ordered.map(event => event.sequence)).size !== ordered.length) fail('事件序号不能重复')
  const history: TextOpenWorldQuestHistoryEntryV1[] = []
  const append = (entry: TextOpenWorldQuestHistoryEntryV1) => {
    if (!input.instanceKey || input.instanceKey === entry.instanceKey) history.push(entry)
  }
  for (const event of ordered) {
    if (event.type !== 'text-open-world.effects.applied') continue
    const applied = parseTextOpenWorldEffectsAppliedEventPayloadV1(payload(event))
    const authorization = applied.plan.authorization
    if (authorization?.kind === 'quest-transition') {
      const definition = definitions.get(authorization.definitionKey) ?? fail(`历史引用未知任务定义:${authorization.definitionKey}`)
      authorization.transitions.forEach(step => {
        const kind = INTENT_KIND[step.intent]
        if (!kind) return
        const stageTitle = step.stageKey ? stages.get(step.stageKey)?.title : null
        append({
          sequence: event.sequence, commandId: applied.commandId, instanceKey: authorization.instanceKey,
          definitionKey: authorization.definitionKey, kind, worldMinute: authorization.worldMinute,
          stageKey: step.stageKey, objectiveKey: null, trackingSlot: null,
          summary: kind === 'stage-advanced' && stageTitle ? `${definition.title}推进至“${stageTitle}”` : `${definition.title}：${kind}`,
        })
      })
    } else if (authorization?.kind === 'quest-objective') {
      const definition = definitions.get(authorization.definitionKey) ?? fail(`历史引用未知任务定义:${authorization.definitionKey}`)
      const objective = objectives.get(authorization.objectiveKey) ?? fail(`历史引用未知Objective:${authorization.objectiveKey}`)
      append({
        sequence: event.sequence, commandId: applied.commandId, instanceKey: authorization.instanceKey,
        definitionKey: authorization.definitionKey, kind: 'objective-completed', worldMinute: authorization.worldMinute,
        stageKey: authorization.stageKey, objectiveKey: authorization.objectiveKey, trackingSlot: null,
        summary: `${definition.title}：完成“${objective.title}”`,
      })
    } else if (authorization?.kind === 'quest-tracking') {
      const definition = definitions.get(authorization.definitionKey) ?? fail(`历史引用未知任务定义:${authorization.definitionKey}`)
      append({
        sequence: event.sequence, commandId: applied.commandId, instanceKey: authorization.instanceKey,
        definitionKey: authorization.definitionKey, kind: authorization.operation === 'track' ? 'tracked' : 'untracked',
        worldMinute: authorization.worldMinute, stageKey: null, objectiveKey: null, trackingSlot: authorization.slot,
        summary: `${authorization.operation === 'track' ? '追踪' : '取消追踪'}${authorization.slot === 'primary' ? '主任务' : 'HUD任务'}：${definition.title}`,
      })
    } else if (authorization?.kind === 'reward') {
      const marker = applied.plan.effects.find(effect => effect.operation === 'claim-quest-reward')
      if (marker?.operation !== 'claim-quest-reward') continue
      const definition = definitions.get(marker.payload.questKey) ?? fail(`历史引用未知奖励任务:${marker.payload.questKey}`)
      append({
        sequence: event.sequence, commandId: applied.commandId, instanceKey: authorization.sourceInstanceKey,
        definitionKey: definition.key, kind: 'reward-claimed',
        worldMinute: null,
        stageKey: null, objectiveKey: null, trackingSlot: null, summary: `${definition.title}：奖励已领取`,
      })
    }
  }
  return history
}

export function projectTextOpenWorldQuestDeadlineV1(
  instance: Pick<TextOpenWorldQuestInstanceV1, 'deadlineWorldMinute'>,
  worldMinute: number,
): TextOpenWorldQuestDeadlineProjectionV1 {
  if (!Number.isSafeInteger(worldMinute) || worldMinute < 0) fail('worldMinute无效')
  if (instance.deadlineWorldMinute == null) return { deadlineWorldMinute: null, remainingMinutes: null, expired: false, label: null }
  const remainingMinutes = Math.max(0, instance.deadlineWorldMinute - worldMinute)
  const expired = worldMinute >= instance.deadlineWorldMinute
  if (expired) return { deadlineWorldMinute: instance.deadlineWorldMinute, remainingMinutes: 0, expired: true, label: '已到期' }
  const days = Math.floor(remainingMinutes / 1440)
  const hours = Math.floor((remainingMinutes % 1440) / 60)
  const minutes = remainingMinutes % 60
  const label = days > 0 ? `剩余${days}天${hours ? `${hours}小时` : ''}` : hours > 0 ? `剩余${hours}小时${minutes ? `${minutes}分钟` : ''}` : `剩余${minutes}分钟`
  return { deadlineWorldMinute: instance.deadlineWorldMinute, remainingMinutes, expired: false, label }
}
