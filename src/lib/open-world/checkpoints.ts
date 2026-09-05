import { db } from '../db/schema'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import {
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  hashProductRuntimeStateV1,
  parseProductRuntimeState,
  replayProductRuntimeEvents,
  updateProductRuntimeSessionHeadV1,
} from '../product/runtime-core'
import type {
  ProductRuntimeCheckpoint,
  ProductRuntimeEvent,
  ProductRuntimeState,
  ProductRuntimeSession,
  TextOpenWorldCheckpointInspectionV1,
  TextOpenWorldRuntimeHeadInspectionV1,
} from '../types'
import { replayTextOpenWorldEventProtocolV1 } from './event-contract'
import { parseTextOpenWorldModulesV1 } from './modules'

function fail(message: string): never { throw new Error(`[text-open-world-checkpoint] ${message}`) }
async function sha256Text(value: string): Promise<string> { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') }
async function eventsFor(session: ProductRuntimeSession, throughSequence = Number.MAX_SAFE_INTEGER): Promise<ProductRuntimeEvent[]> {
  const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
  for (const event of events) if (event.projectId !== session.projectId || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)) fail(`事件${event.sequence}作用域与Session不一致`)
  return events.filter(event => event.sequence <= throughSequence)
}
function isVNext(state: ProductRuntimeState) { return state.textOpenWorld != null }
async function canonical(session: ProductRuntimeSession, throughSequence = Number.MAX_SAFE_INTEGER) {
  const events = await eventsFor(session, throughSequence)
  const protocol = await replayTextOpenWorldEventProtocolV1(events, session.seed)
  const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events, throughSequence)
  if (!isVNext(state)) fail('Session不是文字开放世界vNext')
  return { events, protocol, state, stateJson: JSON.stringify(state), stateHash: await hashProductRuntimeStateV1(state) }
}

/** Reports why a derived runtime head was ignored instead of silently collapsing every failure into a cache miss. */
export async function inspectTextOpenWorldRuntimeHeadV1(sessionId: number): Promise<TextOpenWorldRuntimeHeadInspectionV1> {
  const session = await db.productRuntimeSessions.get(sessionId)
  if (!session) return { sessionId, latestSequence: 0, code: 'not-vnext', detail: 'Session不存在。', canonicalStateHash: null, cachedStateHash: null, repairable: false }
  let verified: Awaited<ReturnType<typeof canonical>>
  try { verified = await canonical(session) } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return { sessionId, latestSequence: 0, code: detail.includes('不是文字开放世界vNext') ? 'not-vnext' : 'event-protocol-invalid', detail, canonicalStateHash: null, cachedStateHash: session.runtimeHeadStateHash ?? null, repairable: false }
  }
  const base = { sessionId, latestSequence: verified.state.lastSequence, canonicalStateHash: verified.stateHash, cachedStateHash: session.runtimeHeadStateHash ?? null }
  if (session.runtimeHeadStateJson == null || session.runtimeHeadStateHash == null || session.runtimeHeadSequence == null) return { ...base, code: 'cache-missing', detail: 'runtime head字段缺失，将从事件重放。', repairable: true }
  if (session.runtimeHeadSequence !== verified.state.lastSequence) return { ...base, code: 'cache-sequence-mismatch', detail: `缓存序号${session.runtimeHeadSequence}与事件头${verified.state.lastSequence}不一致。`, repairable: true }
  if (!/^[a-f0-9]{64}$/.test(session.runtimeHeadStateHash)) return { ...base, code: 'cache-hash-invalid', detail: 'runtime head Hash格式无效。', repairable: true }
  let cached: ProductRuntimeState
  try { cached = parseProductRuntimeState(session.runtimeHeadStateJson) } catch (cause) { return { ...base, code: 'cache-state-invalid', detail: cause instanceof Error ? cause.message : String(cause), repairable: true } }
  const latestTextOpenWorldSequence = [...verified.events].reverse()
    .find(event => event.type.startsWith('text-open-world.'))?.sequence ?? 0
  if (cached.lastSequence !== verified.state.lastSequence
    || cached.textOpenWorld?.lastEventSequence !== latestTextOpenWorldSequence) {
    return { ...base, code: 'cache-sequence-mismatch', detail: '缓存内部序号与共享事件头不一致。', repairable: true }
  }
  if (await sha256Text(session.runtimeHeadStateJson) !== session.runtimeHeadStateHash) return { ...base, code: 'cache-hash-mismatch', detail: '缓存正文与其Hash不一致。', repairable: true }
  if (canonicalProductProductionJsonV2(cached) !== canonicalProductProductionJsonV2(verified.state)) return { ...base, code: 'cache-replay-mismatch', detail: '缓存状态与规范事件重放结果不一致。', repairable: true }
  return { ...base, code: 'valid', detail: 'runtime head序号、Hash和事件重放结果一致。', repairable: false }
}

export async function repairTextOpenWorldRuntimeHeadV1(sessionId: number): Promise<TextOpenWorldRuntimeHeadInspectionV1> {
  const session = await db.productRuntimeSessions.get(sessionId); if (!session) fail('Session不存在')
  const verified = await canonical(session)
  await db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, async () => {
    const current = await db.productRuntimeSessions.get(sessionId); if (!current) fail('Session在修复前已删除')
    const latest = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    if ((latest[latest.length - 1]?.sequence ?? 0) !== verified.state.lastSequence) fail('Session在修复期间已变化，请重试')
    await updateProductRuntimeSessionHeadV1({
      sessionId,
      sequence: verified.state.lastSequence,
      stateJson: verified.stateJson,
      stateHash: verified.stateHash,
      updatedAt: Date.now(),
    })
  })
  return inspectTextOpenWorldRuntimeHeadV1(sessionId)
}

export async function inspectTextOpenWorldCheckpointV1(checkpointId: number): Promise<TextOpenWorldCheckpointInspectionV1> {
  const checkpoint = await db.productRuntimeCheckpoints.get(checkpointId)
  if (!checkpoint) return { checkpointId, sessionId: null, throughSequence: null, code: 'checkpoint-missing', detail: '检查点不存在。', valid: false }
  const base = { checkpointId, sessionId: checkpoint.sessionId, throughSequence: checkpoint.throughSequence }
  const session = await db.productRuntimeSessions.get(checkpoint.sessionId)
  if (!session) return { ...base, code: 'session-missing', detail: '检查点所属Session不存在。', valid: false }
  if (session.projectId !== checkpoint.projectId || (session.worldGroupId ?? null) !== (checkpoint.worldGroupId ?? null)) return { ...base, code: 'scope-mismatch', detail: '检查点作用域与Session不一致。', valid: false }
  if (!/^[a-f0-9]{64}$/.test(checkpoint.stateHash)) return { ...base, code: 'checkpoint-hash-invalid', detail: '检查点Hash格式无效。', valid: false }
  let saved: ProductRuntimeState
  try { saved = parseProductRuntimeState(checkpoint.stateJson) } catch (cause) { return { ...base, code: 'checkpoint-state-invalid', detail: cause instanceof Error ? cause.message : String(cause), valid: false } }
  if (!isVNext(saved)) return { ...base, code: 'not-vnext', detail: '检查点不包含文字开放世界vNext投影。', valid: false }
  const purpose = checkpoint.purpose ?? 'manual'
  if (!['manual', 'combat-retry'].includes(purpose) || (purpose === 'combat-retry') !== (checkpoint.subjectKey != null)) return { ...base, code: 'checkpoint-purpose-invalid', detail: '检查点用途与对象不一致。', valid: false }
  if (purpose === 'combat-retry') {
    const modules = parseTextOpenWorldModulesV1(saved.textOpenWorld!.runtimePackage)
    const encounter = modules.combat.encounters.find(item => item.key === checkpoint.subjectKey)
    if (!encounter || saved.textOpenWorld!.state.combat != null || saved.textOpenWorld!.state.player.health <= 0
      || saved.textOpenWorld!.state.map.currentLocationKey !== encounter.locationKey) {
      return { ...base, code: 'checkpoint-purpose-invalid', detail: '战前重试点没有冻结对应遭遇开始前的安全状态。', valid: false }
    }
  }
  if (await sha256Text(checkpoint.stateJson) !== checkpoint.stateHash) return { ...base, code: 'checkpoint-hash-mismatch', detail: '检查点正文与Hash不一致。', valid: false }
  let verified: Awaited<ReturnType<typeof canonical>>
  try { verified = await canonical(session, checkpoint.throughSequence) } catch (cause) { return { ...base, code: 'event-protocol-invalid', detail: cause instanceof Error ? cause.message : String(cause), valid: false } }
  const latestTextOpenWorldSequence = [...verified.events].reverse()
    .find(event => event.type.startsWith('text-open-world.'))?.sequence ?? 0
  if (saved.lastSequence !== checkpoint.throughSequence
    || saved.textOpenWorld!.lastEventSequence !== latestTextOpenWorldSequence) {
    return { ...base, code: 'checkpoint-sequence-mismatch', detail: '检查点内部序号与共享事件游标不一致。', valid: false }
  }
  if (verified.protocol.pendingCommandId) return { ...base, code: 'event-protocol-invalid', detail: `检查点停在未终结命令:${verified.protocol.pendingCommandId}`, valid: false }
  if (canonicalProductProductionJsonV2(saved) !== canonicalProductProductionJsonV2(verified.state)) return { ...base, code: 'replay-mismatch', detail: '检查点状态与事件重放结果不一致。', valid: false }
  return { ...base, code: 'valid', detail: '检查点Hash、序号、协议和重放状态一致。', valid: true }
}

export async function createTextOpenWorldCheckpointV1(input: {
  sessionId: number
  name: string
  throughSequence?: number
  purpose?: ProductRuntimeCheckpoint['purpose']
  subjectKey?: string | null
}): Promise<ProductRuntimeCheckpoint> {
  const session = await db.productRuntimeSessions.get(input.sessionId); if (!session) fail('Session不存在')
  const latestEvents = await eventsFor(session); const throughSequence = input.throughSequence ?? (latestEvents[latestEvents.length - 1]?.sequence ?? 0)
  const verified = await canonical(session, throughSequence)
  if (verified.protocol.pendingCommandId) fail(`不能在未终结命令上创建检查点:${verified.protocol.pendingCommandId}`)
  const purpose = input.purpose ?? 'manual'
  if (purpose === 'combat-retry') {
    const encounterKey = input.subjectKey ?? fail('战前重试点缺少encounterKey')
    const modules = parseTextOpenWorldModulesV1(verified.state.textOpenWorld!.runtimePackage)
    const encounter = modules.combat.encounters.find(item => item.key === encounterKey) ?? fail(`战前重试点遭遇不存在:${encounterKey}`)
    const runtime = verified.state.textOpenWorld!.state
    if (runtime.combat != null || runtime.player.health <= 0 || runtime.map.currentLocationKey !== encounter.locationKey) fail('只能在对应遭遇开始前建立战前重试点')
  } else if (input.subjectKey != null) fail('手动检查点不能绑定战斗对象')
  const checkpoint = await createProductRuntimeCheckpoint({ ...input, throughSequence })
  const inspection = await inspectTextOpenWorldCheckpointV1(checkpoint.id!)
  if (!inspection.valid) fail(`新检查点验证失败:${inspection.code}`)
  return checkpoint
}

/** Idempotently freezes the verified pre-combat state used by encounter retry. */
export async function ensureTextOpenWorldCombatRetryCheckpointV1(input: {
  sessionId: number
  encounterKey: string
  throughSequence?: number
}): Promise<ProductRuntimeCheckpoint> {
  const session = await db.productRuntimeSessions.get(input.sessionId); if (!session) fail('Session不存在')
  const latestEvents = await eventsFor(session)
  const throughSequence = input.throughSequence ?? (latestEvents[latestEvents.length - 1]?.sequence ?? 0)
  const existing = (await db.productRuntimeCheckpoints.where('sessionId').equals(input.sessionId).toArray())
    .find(item => item.throughSequence === throughSequence && item.purpose === 'combat-retry' && item.subjectKey === input.encounterKey)
  if (existing) {
    const inspection = await inspectTextOpenWorldCheckpointV1(existing.id!)
    if (!inspection.valid) fail(`既有战前重试点无效:${inspection.code}`)
    return existing
  }
  return createTextOpenWorldCheckpointV1({
    sessionId: input.sessionId, throughSequence, purpose: 'combat-retry', subjectKey: input.encounterKey,
    name: `战前重试 · ${input.encounterKey}`,
  })
}

/** A retry preserves the defeated timeline and starts a child branch from the latest verified pre-combat checkpoint. */
export async function retryDefeatedTextOpenWorldCombatV1(input: {
  sessionId: number
  title?: string
  seed?: string
}): Promise<ProductRuntimeSession> {
  const session = await db.productRuntimeSessions.get(input.sessionId); if (!session) fail('Session不存在')
  const current = (await canonical(session)).state.textOpenWorld!
  if (current.state.combat?.status !== 'defeat' || current.state.player.health !== 0) fail('只有战败Session可以从战前重试')
  const encounterKey = current.state.combat.encounterKey
  const candidates = (await db.productRuntimeCheckpoints.where('sessionId').equals(input.sessionId).toArray())
    .filter(item => item.purpose === 'combat-retry' && item.subjectKey === encounterKey)
    .sort((left, right) => right.throughSequence - left.throughSequence || right.createdAt - left.createdAt)
  for (const checkpoint of candidates) {
    const inspection = await inspectTextOpenWorldCheckpointV1(checkpoint.id!)
    if (inspection.valid) return branchTextOpenWorldSessionFromCheckpointV1({
      checkpointId: checkpoint.id!, title: input.title?.trim() || `重试 · ${encounterKey}`, seed: input.seed,
    })
  }
  fail(`没有可用的战前重试点:${encounterKey}`)
}

/** Branches from a verified historical checkpoint; parent events remain untouched and the child begins at sequence zero. */
export async function branchTextOpenWorldSessionFromCheckpointV1(input: { checkpointId: number; title: string; seed?: string }): Promise<ProductRuntimeSession> {
  const inspection = await inspectTextOpenWorldCheckpointV1(input.checkpointId)
  if (!inspection.valid || inspection.sessionId == null || inspection.throughSequence == null) fail(`检查点不可用于分支:${inspection.code}`)
  const parentEventCount = await db.productRuntimeEvents.where('sessionId').equals(inspection.sessionId).count()
  const child = await branchProductRuntimeSession({ parentSessionId: inspection.sessionId, throughSequence: inspection.throughSequence, title: input.title, seed: input.seed })
  const childState = parseProductRuntimeState(child.initialStateJson)
  if (!childState.textOpenWorld || childState.lastSequence !== 0 || childState.textOpenWorld.lastEventSequence !== 0 || childState.textOpenWorld.protocol.pendingCommandId) fail('子分支vNext初态没有正确重基线')
  if (await db.productRuntimeEvents.where('sessionId').equals(inspection.sessionId).count() !== parentEventCount) fail('创建分支意外修改父Session事件')
  return child
}
