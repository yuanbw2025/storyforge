import { db } from '../db/schema'
import type { ProductRuntimeCommandEnvelopeV1 } from '../product/runtime-command-id'
import {
  applyProductRuntimeEvent,
  hashStateJson,
  normalizeCommandId,
  parseEventPayload,
  parseProductRuntimeState,
  readSessionEvents,
  replayProductRuntimeEvents,
  stableJson,
  type JsonObject,
} from '../product/runtime-core'
import type { AiTownMajorChangeKindV1, AiTownRuntimeStateV1, ProductRuntimeEvent, ProductRuntimeEventType } from '../types'
import { isAiTownLocationReachableV1, nextAiTownSlotV1 } from './runtime'

export type AiTownPlayerActionKindV1 = 'talk' | 'help' | 'work' | 'gift' | 'cook' | 'care' | 'observe'

async function appendAiTownCommand(
  input: ProductRuntimeCommandEnvelopeV1 & {
    type: Extract<ProductRuntimeEventType, `town.${string}`>
    actorKey?: string | null
    targetKey?: string | null
    buildPayload(state: AiTownRuntimeStateV1, sequence: number): JsonObject
  },
): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId)
  const baseStateHash = input.baseStateHash.trim()
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0) throw new Error('[ai-town] baseSequence 无效')
  if (!/^[a-f0-9]{64}$/.test(baseStateHash)) throw new Error('[ai-town] baseStateHash 无效')
  const previewSession = await db.productRuntimeSessions.get(input.sessionId)
  if (!previewSession || previewSession.kind !== 'ai-town') throw new Error('[ai-town] 正式 AI 小镇会话不存在')
  const previewEvents = await readSessionEvents(previewSession)
  const previewState = replayProductRuntimeEvents(parseProductRuntimeState(previewSession.initialStateJson), previewEvents)
  const previewStateHash = await hashStateJson(JSON.stringify(previewState))
  return db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, async () => {
    const session = await db.productRuntimeSessions.get(input.sessionId)
    if (!session || session.kind !== 'ai-town') throw new Error('[ai-town] 正式 AI 小镇会话不存在')
    const events = await readSessionEvents(session)
    const prior = events.find(event => event.commandId === commandId)
    const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)
    if (!state.town) throw new Error('[ai-town] 会话缺少冻结小镇状态')
    if (prior) {
      const baseState = replayProductRuntimeEvents(
        parseProductRuntimeState(session.initialStateJson),
        events.filter(event => event.sequence <= input.baseSequence),
      )
      if (!baseState.town) throw new Error('[ai-town] 幂等命令缺少冻结小镇状态')
      const expectedPayload = {
        ...input.buildPayload(baseState.town, prior.sequence),
        commandId,
        baseSequence: input.baseSequence,
        baseStateHash,
      }
      if (prior.type !== input.type
        || prior.baseSequence !== input.baseSequence
        || prior.baseStateHash !== baseStateHash
        || stableJson(parseEventPayload(prior)) !== stableJson(expectedPayload)) {
        throw new Error('[ai-town] commandId 已被不同命令使用')
      }
      return prior
    }
    const payload = {
      ...input.buildPayload(state.town, state.lastSequence + 1),
      commandId,
      baseSequence: input.baseSequence,
      baseStateHash,
    }
    if (session.status !== 'active') throw new Error('[ai-town] 只有 active 会话可以提交命令')
    if (state.lastSequence !== input.baseSequence || previewState.lastSequence !== state.lastSequence || previewStateHash !== baseStateHash) {
      throw new Error('[ai-town] 状态已变化，请刷新后重试')
    }
    const event: ProductRuntimeEvent = {
      projectId: session.projectId,
      worldGroupId: session.worldGroupId ?? null,
      sessionId: input.sessionId,
      sequence: state.lastSequence + 1,
      type: input.type,
      actorKey: input.actorKey ?? null,
      targetKey: input.targetKey ?? null,
      commandId,
      baseSequence: input.baseSequence,
      baseStateHash,
      payloadJson: JSON.stringify(payload),
      createdAt: Date.now(),
    }
    applyProductRuntimeEvent(state, event)
    event.id = await db.productRuntimeEvents.add(event) as number
    await db.productRuntimeSessions.update(input.sessionId, {
      updatedAt: event.createdAt,
    })
    return event
  })
}

function publicDigest(state: AiTownRuntimeStateV1, day = state.day) {
  return {
    day,
    publicSummary: state.latestPublicEvents.slice(-6),
    publicKnowledgeChanges: Object.values(state.knowledge)
      .filter(fact => fact.visibility === 'public')
      .slice(-4)
      .map(fact => fact.statement),
    observableRelationshipChanges: Object.values(state.relationships)
      .filter(relationship => relationship.evidenceSequences.length > 0)
      .slice(-4)
      .map(relationship => `${relationship.fromResidentKey} 对 ${relationship.toResidentKey} 的关系留下了新的可观察变化。`),
    tomorrowHints: state.content.lifeThreads
      .filter(thread => state.lifeThreads[thread.key]?.stage === 'active')
      .slice(0, 3)
      .map(thread => thread.title),
  }
}

export async function moveAiTownPlayerV1(
  input: ProductRuntimeCommandEnvelopeV1 & { locationKey: string },
): Promise<ProductRuntimeEvent> {
  const locationKey = input.locationKey.trim()
  return appendAiTownCommand({
    ...input,
    type: 'town.player.moved',
    actorKey: 'player',
    targetKey: locationKey,
    buildPayload: state => {
      const location = state.content.map.locations.find(item => item.key === locationKey)
      if (!location) throw new Error('[ai-town] 目标地点不存在')
      if (locationKey === state.player.locationKey) throw new Error('[ai-town] 玩家已经在目标地点')
      if (!location.openSlots.includes(state.slot)) throw new Error('[ai-town] 目标地点当前未开放')
      if (!isAiTownLocationReachableV1(state.content, state.player.locationKey, locationKey)) throw new Error('[ai-town] 目标地点当前不可达')
      const residentsAtTarget = Object.values(state.residents).filter(resident => resident.residencyStatus === 'resident' && resident.locationKey === locationKey).length
      if (residentsAtTarget + 1 > location.capacity) throw new Error('[ai-town] 目标地点容量已满')
      return { locationKey, summary: `你来到${location.title}。` }
    },
  })
}

const ACTION_COSTS: Record<AiTownPlayerActionKindV1, number> = {
  talk: 4,
  help: 8,
  work: 12,
  gift: 3,
  cook: 10,
  care: 8,
  observe: 1,
}

export async function performAiTownActionV1(
  input: ProductRuntimeCommandEnvelopeV1 & {
    kind: AiTownPlayerActionKindV1
    targetResidentKey?: string | null
    note?: string
  },
): Promise<ProductRuntimeEvent> {
  return appendAiTownCommand({
    ...input,
    type: 'town.action.performed',
    actorKey: 'player',
    targetKey: input.targetResidentKey ?? null,
    buildPayload: state => {
      if (!Object.prototype.hasOwnProperty.call(ACTION_COSTS, input.kind)) throw new Error('[ai-town] 行动类型无效')
      if (state.actionsRemaining < 1 && input.kind !== 'observe') throw new Error('[ai-town] 今天的主动行动次数已用完')
      const target = input.targetResidentKey ? state.residents[input.targetResidentKey] : null
      if (input.targetResidentKey && !target) throw new Error('[ai-town] 行动目标居民不存在')
      if (target && target.residencyStatus !== 'resident') throw new Error('[ai-town] 行动目标已不在小镇生活')
      if (target && target.locationKey !== state.player.locationKey) throw new Error('[ai-town] 行动目标不在当前地点')
      const cost = ACTION_COSTS[input.kind]
      if (state.player.energy < cost) throw new Error('[ai-town] 精力不足')
      const residentDefinition = target ? state.content.residents.find(resident => resident.residentKey === target.residentKey) : null
      const location = state.content.map.locations.find(item => item.key === state.player.locationKey)!
      const actionLabel: Record<AiTownPlayerActionKindV1, string> = {
        talk: `和${residentDefinition?.name ?? '在场居民'}聊了一会儿`,
        help: `帮助${residentDefinition?.name ?? '共同体'}处理眼前的事情`,
        work: `为“${state.sharedProject.title}”共同劳动`,
        gift: `向${residentDefinition?.name ?? '在场居民'}送出一份心意`,
        cook: '为在场的人准备了一顿简单的饭',
        care: '照料了这里需要被留意的人和事',
        observe: `安静观察${location.title}正在发生的生活`,
      }
      const summary = `${actionLabel[input.kind]}。${input.note?.trim() ? ` ${input.note.trim().slice(0, 500)}` : ''}`
      const relationship = target
        ? Object.values(state.relationships).find(edge => edge.fromResidentKey === target.residentKey && edge.toResidentKey === 'player')
        : null
      const nextSlot = nextAiTownSlotV1(state.slot)
      const digest = nextSlot === 'morning' ? publicDigest(state) : null
      if (digest && !digest.publicSummary.includes(summary)) {
        digest.publicSummary = [...digest.publicSummary.slice(-5), summary]
      }
      return {
        kind: input.kind,
        targetResidentKey: target?.residentKey ?? null,
        summary,
        energyCost: cost,
        projectProgress: input.kind === 'work' ? 6 : input.kind === 'help' || input.kind === 'care' ? 2 : 0,
        relationshipKey: relationship?.key ?? null,
        trustDelta: relationship ? (input.kind === 'talk' || input.kind === 'help' || input.kind === 'care' ? 2 : 1) : 0,
        intimacyDelta: relationship ? (input.kind === 'gift' || input.kind === 'cook' ? 2 : 1) : 0,
        warinessDelta: relationship ? -1 : 0,
        nextSlot,
        ...(digest ? { digest } : {}),
      }
    },
  })
}

export async function advanceAiTownTimeV1(
  input: ProductRuntimeCommandEnvelopeV1,
): Promise<ProductRuntimeEvent> {
  return appendAiTownCommand({
    ...input,
    type: 'town.time.advanced',
    actorKey: 'player',
    buildPayload: state => {
      const toSlot = nextAiTownSlotV1(state.slot)
      return {
        fromSlot: state.slot,
        toSlot,
        reason: '玩家选择等待或休息',
        ...(toSlot === 'morning' ? { digest: publicDigest(state) } : {}),
      }
    },
  })
}

export async function resolveAiTownEventSeedV1(
  input: ProductRuntimeCommandEnvelopeV1 & { seedKey: string },
): Promise<ProductRuntimeEvent> {
  const seedKey = input.seedKey.trim()
  return appendAiTownCommand({
    ...input,
    type: 'town.event.resolved',
    targetKey: seedKey,
    buildPayload: state => {
      const seed = state.content.eventSeeds.find(item => item.key === seedKey)
      if (!seed || state.day < seed.minimumDay || !seed.eligibleSlots.includes(state.slot)) throw new Error('[ai-town] 事件当前不符合触发条件')
      const lastDay = state.cadence.seedLastTriggeredDay[seedKey]
      if (lastDay != null && state.day - lastDay < seed.cooldownDays) throw new Error('[ai-town] 事件仍在冷却')
      if (seed.category === 'rare-crisis' && state.cadence.lastRareCrisisDay != null
        && state.day - state.cadence.lastRareCrisisDay < state.content.cadence.rareCrisisCooldownDays) throw new Error('[ai-town] 罕见危机仍在全局冷却')
      if (seed.intensity > state.cadence.remainingIntensity) throw new Error('[ai-town] 今日事件强度预算不足')
      if (seed.intensity >= 4 && state.cadence.highIntensityStreak >= state.content.cadence.highIntensityStreakLimit) throw new Error('[ai-town] 高强度事件需要留出喘息日')
      const participants = seed.participantKeys.filter(key => state.residents[key]?.residencyStatus === 'resident' && state.residents[key]?.locationKey === state.player.locationKey)
      if (!participants.length && !seed.locationKeys.includes(state.player.locationKey)) throw new Error('[ai-town] 当前地点无法观察此事件')
      return { seedKey, intensity: seed.intensity, participants, summary: `${seed.title}：${seed.summary}` }
    },
  })
}

export async function runAiTownOfflineBatchV1(
  input: ProductRuntimeCommandEnvelopeV1 & { days: number },
): Promise<ProductRuntimeEvent> {
  return appendAiTownCommand({
    ...input,
    type: 'town.offline-batch.completed',
    buildPayload: state => {
      if (!state.content.offline.enabled) throw new Error('[ai-town] 当前小镇未启用离线演化')
      if (!Number.isInteger(input.days) || input.days < 1 || input.days > state.content.offline.maximumDays) {
        throw new Error(`[ai-town] 离线批次只能推进 1..${state.content.offline.maximumDays} 个游戏日`)
      }
      const digests = Array.from({ length: input.days }, (_, index) => {
        const simulatedDay = state.day + index
        const eligible = state.content.eventSeeds.filter(seed => seed.minimumDay <= simulatedDay)
        const seed = eligible[simulatedDay % Math.max(1, eligible.length)]
        return {
          day: simulatedDay,
          publicSummary: seed ? [`${seed.title}：${seed.summary}`] : ['居民按各自日程度过了平稳的一天。'],
          publicKnowledgeChanges: [],
          observableRelationshipChanges: [],
          tomorrowHints: state.content.lifeThreads.filter(thread => state.lifeThreads[thread.key]?.stage === 'active').slice(0, 2).map(thread => thread.title),
        }
      })
      return { days: input.days, digests, maximumModelCalls: 0, degraded: true, reason: '确定性离线演化；未授权重大变化不会生效' }
    },
  })
}

export async function resolveAiTownMajorChangeV1(
  input: ProductRuntimeCommandEnvelopeV1 & { candidateKey: string; resolution: 'accepted' | 'rejected' },
): Promise<ProductRuntimeEvent> {
  const candidateKey = input.candidateKey.trim()
  return appendAiTownCommand({
    ...input,
    type: input.resolution === 'accepted' ? 'town.major-change.accepted' : 'town.major-change.rejected',
    targetKey: candidateKey,
    buildPayload: () => ({ candidateKey }),
  })
}

export async function proposeAiTownMajorChangeV1(
  input: ProductRuntimeCommandEnvelopeV1 & {
    candidateKey: string
    kind: AiTownMajorChangeKindV1
    title: string
    summary: string
    residentKeys: string[]
  },
): Promise<ProductRuntimeEvent> {
  const candidateKey = input.candidateKey.trim()
  return appendAiTownCommand({
    ...input,
    type: 'town.major-change.proposed',
    actorKey: 'town-director',
    targetKey: candidateKey,
    buildPayload: (state, sequence) => {
      if (!state.content.safety.majorChangeKinds.includes(input.kind)) throw new Error('[ai-town] 重大变化类型未获 Brief 授权')
      const residentKeys = [...new Set(input.residentKeys.map(key => key.trim()).filter(Boolean))].sort()
      if (residentKeys.length > 8 || residentKeys.some(key => !state.residents[key])) throw new Error('[ai-town] 重大变化居民范围无效')
      if ((input.kind === 'permanent-departure' || input.kind === 'death-or-permanent-incapacity')
        && (!residentKeys.length || residentKeys.some(key => state.residents[key].residencyStatus !== 'resident'))) throw new Error('[ai-town] 居民离场类变化必须指向当前居民')
      if (state.pendingMajorChanges.some(candidate => candidate.candidateKey === candidateKey)) throw new Error('[ai-town] 重大变化候选重复')
      if (!candidateKey || !input.title.trim() || !input.summary.trim()) throw new Error('[ai-town] 重大变化候选内容无效')
      return {
        candidateKey,
        kind: input.kind,
        title: input.title.trim().slice(0, 200),
        summary: input.summary.trim().slice(0, 4_000),
        residentKeys,
        evidenceSequence: sequence,
        requiresAuthorConfirmation: true,
      }
    },
  })
}
