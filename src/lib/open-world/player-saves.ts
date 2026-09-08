import { db } from '../db/schema'
import {
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  hashProductRuntimeStateV1,
  normalizeProductRuntimeCheckpointPurposeV1,
  parseProductRuntimeState,
  replayProductRuntimeEvents,
  updateProductRuntimeSessionHeadV1,
  verifyProductRuntimeCheckpoint,
} from '../product/runtime-core'
import type {
  ProductRuntimeCheckpoint,
  ProductRuntimeCheckpointPurposeV1,
  ProductRuntimeEvent,
  ProductRuntimeSession,
  ProductRuntimeState,
  WorkspaceScope,
} from '../types'
import { resolveScope } from '../workspace/scope'
import {
  branchTextOpenWorldSessionFromCheckpointV1,
  inspectTextOpenWorldCheckpointV1,
  inspectTextOpenWorldRuntimeHeadV1,
  repairTextOpenWorldRuntimeHeadV1,
} from './checkpoints'
import {
  parseTextOpenWorldEffectsAppliedEventPayloadV1,
  replayTextOpenWorldEventProtocolV1,
} from './event-contract'
import { parseTextOpenWorldModulesV1 } from './modules'

export const TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1 = 20
export const TEXT_OPEN_WORLD_AUTOMATIC_SAVE_LIMIT_V1 = 8

const AUTOMATIC_PURPOSES = new Set<ProductRuntimeCheckpointPurposeV1>(['autosave', 'milestone'])
const REPAIRABLE_CHECKPOINT_CODES = new Set([
  'checkpoint-hash-invalid',
  'checkpoint-state-invalid',
  'checkpoint-hash-mismatch',
  'checkpoint-sequence-mismatch',
  'replay-mismatch',
])

export interface TextOpenWorldSaveOwnerV1 {
  scope: WorkspaceScope
  worldGroupId: number | null
}

export interface TextOpenWorldPlayerSaveSummaryV1 {
  runtimeFormat: 'vnext' | 'legacy'
  level: number | null
  locationLabel: string | null
  regionLabel: string | null
  mainlineLabel: string
  worldTimeLabel: string
}

/** Local operation keys for commands. Player UI must never render these values. */
export interface TextOpenWorldSaveActionIdentityV1 {
  sessionId: number
}

export interface TextOpenWorldCheckpointActionIdentityV1 extends TextOpenWorldSaveActionIdentityV1 {
  checkpointId: number
}

export interface TextOpenWorldPlayerCheckpointV1 {
  /** Presentation-only identity. It must not be used to route mutations. */
  uiId: string
  actionIdentity: TextOpenWorldCheckpointActionIdentityV1
  name: string
  purpose: ProductRuntimeCheckpointPurposeV1 | 'invalid'
  purposeLabel: string
  createdAt: number
  summary: TextOpenWorldPlayerSaveSummaryV1 | null
  health: 'available' | 'repairable' | 'damaged'
  healthLabel: string
  repairable: boolean
}

export interface TextOpenWorldPlayerSaveBranchV1 {
  uiId: string
  actionIdentity: TextOpenWorldSaveActionIdentityV1
  title: string
  statusLabel: string
  relationship: 'root' | 'child' | 'orphaned-parent'
  relationshipLabel: string
  parentTitle: string | null
  depth: number
  isCurrent: boolean
  updatedAt: number
  runtimeFormat: 'vnext' | 'legacy'
  summary: TextOpenWorldPlayerSaveSummaryV1 | null
  runtimeHealth: 'available' | 'repairable' | 'damaged'
  runtimeHealthLabel: string
  runtimeRepairable: boolean
  manualSlots: { used: number; limit: number; remaining: number }
  checkpoints: TextOpenWorldPlayerCheckpointV1[]
}

export interface TextOpenWorldPlayerSaveGroupV1 {
  uiId: string
  title: string
  versionLabel: string
  sourceKind: '正式发布' | '制作预览'
  branchCount: number
  branches: TextOpenWorldPlayerSaveBranchV1[]
}

export interface TextOpenWorldPlayerSavesProjectionV1 {
  groups: TextOpenWorldPlayerSaveGroupV1[]
  totalBranches: number
  totalCheckpoints: number
}

export interface TextOpenWorldAutomaticSaveReconcileResultV1 {
  candidateCount: number
  createdCount: number
  retainedCount: number
  prunedCount: number
  damagedCount: number
}

interface ResolvedOwnerV1 extends WorkspaceScope {
  worldGroupId: number | null
}

interface CanonicalBoundaryV1 {
  session: ProductRuntimeSession
  events: ProductRuntimeEvent[]
  state: ProductRuntimeState
  throughSequence: number
  runtimeFormat: 'vnext' | 'legacy'
}

interface AutomaticSaveCandidateV1 {
  purpose: 'autosave' | 'milestone'
  throughSequence: number
  subjectKey: string | null
  name: string
  createdAt: number
}

function fail(message: string): never {
  throw new Error(`[text-open-world-player-saves] ${message}`)
}

function normalizedPurpose(checkpoint: ProductRuntimeCheckpoint): ProductRuntimeCheckpointPurposeV1 | 'invalid' {
  try { return normalizeProductRuntimeCheckpointPurposeV1(checkpoint).purpose } catch { return 'invalid' }
}

function snapshotJson(value: unknown): string {
  return JSON.stringify(value)
}

function trimLabel(value: unknown, fallback: string, maximum = 200): string {
  const normalized = (typeof value === 'string' ? value : '').trim().normalize('NFC') || fallback
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`
}

async function resolveOwner(owner: TextOpenWorldSaveOwnerV1): Promise<ResolvedOwnerV1> {
  const scope = await resolveScope({ scope: owner.scope })
  if (owner.worldGroupId != null && (!Number.isSafeInteger(owner.worldGroupId) || owner.worldGroupId < 1)) {
    fail('worldGroupId无效')
  }
  return { ...scope, worldGroupId: owner.worldGroupId ?? null }
}

function sessionMatchesOwner(session: ProductRuntimeSession, owner: ResolvedOwnerV1): boolean {
  return session.projectId === owner.projectId
    && session.worldId === owner.worldId
    && session.workId === owner.workId
    && (session.worldGroupId ?? null) === owner.worldGroupId
    && session.kind === 'text-open-world'
}

function assertSessionMatchesOwner(session: ProductRuntimeSession | undefined, owner: ResolvedOwnerV1): asserts session is ProductRuntimeSession {
  if (!session || !sessionMatchesOwner(session, owner)) {
    fail('只能操作当前World/Work和世界分组内的文字开放世界存档')
  }
}

async function ownedSession(owner: ResolvedOwnerV1, sessionId: number): Promise<ProductRuntimeSession> {
  if (!Number.isSafeInteger(sessionId) || sessionId < 1) fail('sessionId无效')
  const session = await db.productRuntimeSessions.get(sessionId)
  assertSessionMatchesOwner(session, owner)
  return session
}

async function eventsFor(session: ProductRuntimeSession, throughSequence = Number.MAX_SAFE_INTEGER): Promise<ProductRuntimeEvent[]> {
  const events = (await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence'))
    .filter(event => event.sequence <= throughSequence)
  events.forEach(event => {
    if (event.projectId !== session.projectId
      || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)) {
      fail('Session事件作用域不一致')
    }
  })
  return events
}

async function canonicalBoundary(
  session: ProductRuntimeSession,
  throughSequence?: number,
): Promise<CanonicalBoundaryV1> {
  const allEvents = await eventsFor(session)
  const latestSequence = allEvents[allEvents.length - 1]?.sequence ?? 0
  const boundary = throughSequence ?? latestSequence
  if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary > latestSequence) fail('存档事件位置无效')
  const events = allEvents.filter(event => event.sequence <= boundary)
  const initialState = parseProductRuntimeState(session.initialStateJson)
  const runtimeFormat = initialState.textOpenWorld ? 'vnext' : 'legacy'
  if (runtimeFormat === 'vnext') {
    const protocol = await replayTextOpenWorldEventProtocolV1(events, session.seed)
    if (protocol.pendingCommandId) fail('不能在未终结命令上建立或修复存档')
  }
  const state = replayProductRuntimeEvents(initialState, events, boundary)
  if (state.lastSequence !== boundary) fail('规范事件与共享运行投影序号不一致')
  if (runtimeFormat === 'vnext') {
    const latestTextOpenWorldSequence = [...events].reverse()
      .find(event => event.type.startsWith('text-open-world.'))?.sequence ?? 0
    if (!state.textOpenWorld || state.textOpenWorld.lastEventSequence !== latestTextOpenWorldSequence) {
      fail('规范事件与文字开放世界投影序号不一致')
    }
  }
  return { session, events, state, throughSequence: boundary, runtimeFormat }
}

function worldTimeLabel(state: ProductRuntimeState): string {
  const projection = state.textOpenWorld!
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const worldMinute = projection.state.time.worldMinute
  const minuteInDay = worldMinute % modules['time-weather'].minutesPerDay
  const period = modules['time-weather'].timePeriods.find(candidate => (
    minuteInDay >= candidate.startMinute && minuteInDay < candidate.endMinute
  ))
  return `第 ${Math.floor(worldMinute / modules['time-weather'].minutesPerDay) + 1} 天${period ? ` · ${period.label}` : ''}`
}

function vNextSummary(state: ProductRuntimeState): TextOpenWorldPlayerSaveSummaryV1 {
  const projection = state.textOpenWorld ?? fail('存档不包含文字开放世界状态')
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const location = modules.world.locations.find(candidate => candidate.key === projection.state.map.currentLocationKey)
    ?? fail('当前地点不存在于冻结发布')
  const region = modules.world.regions.find(candidate => candidate.key === location.regionKey)
    ?? fail('当前地区不存在于冻结发布')
  const mainlineCandidates = modules.quests.quests.flatMap(definition => {
    if (definition.type !== 'mainline') return []
    const instance = Object.values(projection.state.quests.instancesByKey)
      .find(candidate => candidate.definitionKey === definition.key)
    if (!instance || ['locked', 'available'].includes(instance.status)) return []
    const stage = instance.currentStageKey == null
      ? null
      : modules.quests.stages.find(candidate => candidate.key === instance.currentStageKey) ?? null
    const rank = instance.status === 'active' ? 4
      : instance.status === 'suspended' ? 3
        : instance.status === 'accepted' || instance.status === 'revealed' ? 2
          : instance.status === 'completed' ? 1 : 0
    const label = instance.status === 'completed'
      ? `${definition.title} · 已完成`
      : stage ? `${definition.title} · ${stage.title}` : `${definition.title} · 待继续`
    return [{ rank, label }]
  }).sort((left, right) => right.rank - left.rank)
  return {
    runtimeFormat: 'vnext',
    level: projection.state.player.level,
    locationLabel: location.title,
    regionLabel: region.title,
    mainlineLabel: mainlineCandidates[0]?.label ?? '主线尚未揭示',
    worldTimeLabel: worldTimeLabel(state),
  }
}

function playerSafeSummary(state: ProductRuntimeState): TextOpenWorldPlayerSaveSummaryV1 {
  if (state.textOpenWorld) return vNextSummary(state)
  const narrative = state.narrative
  const currentNode = narrative?.currentNodeKey == null
    ? null
    : narrative.nodes.find(node => node.key === narrative.currentNodeKey) ?? null
  return {
    runtimeFormat: 'legacy',
    level: null,
    locationLabel: null,
    regionLabel: null,
    mainlineLabel: currentNode
      ? `当前剧情 · ${trimLabel(currentNode.title, '未命名剧情')}`
      : narrative?.completed ? '故事已完成' : '旧版剧情进度可读取',
    worldTimeLabel: `运行时钟 ${state.clock}`,
  }
}

function checkpointPurposeLabel(purpose: ProductRuntimeCheckpointPurposeV1 | 'invalid'): string {
  if (purpose === 'invalid') return '用途无效的存档'
  if (purpose === 'manual') return '手动存档'
  if (purpose === 'autosave') return '自动存档'
  if (purpose === 'combat-retry') return '战前重试点'
  if (purpose === 'milestone') return '故事里程碑'
  return '系统恢复点'
}

function sessionStatusLabel(status: ProductRuntimeSession['status']): string {
  if (status === 'active') return '进行中'
  if (status === 'paused') return '已暂停'
  return '已归档'
}

async function canRebuildCheckpoint(
  checkpoint: ProductRuntimeCheckpoint,
  session: ProductRuntimeSession,
): Promise<{ repairable: boolean; state: ProductRuntimeState | null }> {
  try {
    const canonical = await canonicalBoundary(session, checkpoint.throughSequence)
    return { repairable: true, state: canonical.state }
  } catch {
    return { repairable: false, state: null }
  }
}

async function projectCheckpoint(
  checkpoint: ProductRuntimeCheckpoint,
  session: ProductRuntimeSession,
  uiId: string,
): Promise<TextOpenWorldPlayerCheckpointV1> {
  let runtimeFormat: 'vnext' | 'legacy' = 'legacy'
  try { runtimeFormat = parseProductRuntimeState(session.initialStateJson).textOpenWorld ? 'vnext' : 'legacy' } catch { /* diagnosed below */ }
  const inspection = runtimeFormat === 'vnext'
    ? await inspectTextOpenWorldCheckpointV1(checkpoint.id!)
    : null
  const valid = inspection ? inspection.valid : await verifyProductRuntimeCheckpoint(checkpoint.id!)
  const purpose = normalizedPurpose(checkpoint)
  let state: ProductRuntimeState | null = null
  let repairable = false
  if (valid) {
    try { state = parseProductRuntimeState(checkpoint.stateJson) } catch { state = null }
  } else if (purpose !== 'invalid' && (!inspection || REPAIRABLE_CHECKPOINT_CODES.has(inspection.code))) {
    const recovery = await canRebuildCheckpoint(checkpoint, session)
    repairable = recovery.repairable
    state = recovery.state
  }
  let summary: TextOpenWorldPlayerSaveSummaryV1 | null = null
  if (state) {
    try { summary = playerSafeSummary(state) } catch {
      summary = null
      repairable = false
    }
  }
  const health = valid && summary ? 'available' : repairable && summary ? 'repairable' : 'damaged'
  return {
    uiId,
    actionIdentity: { sessionId: session.id!, checkpointId: checkpoint.id! },
    name: trimLabel(checkpoint.name, checkpointPurposeLabel(purpose)),
    purpose,
    purposeLabel: checkpointPurposeLabel(purpose),
    createdAt: checkpoint.createdAt,
    summary,
    health,
    healthLabel: health === 'available' ? '可读取' : health === 'repairable' ? '可从规范事件修复' : '需要保留诊断并选择其它存档',
    repairable,
  }
}

function sourceIdentity(session: ProductRuntimeSession): string {
  return session.productReleaseId != null ? `release:${session.productReleaseId}` : `build:${session.productBuildId}`
}

function rootSessionId(session: ProductRuntimeSession, sessions: Map<number, ProductRuntimeSession>): number {
  let current = session
  const visited = new Set<number>()
  while (current.parentSessionId != null && !visited.has(current.parentSessionId)) {
    visited.add(current.id!)
    const parent = sessions.get(current.parentSessionId)
    if (!parent || sourceIdentity(parent) !== sourceIdentity(session)) break
    current = parent
  }
  return current.id!
}

function branchDepth(session: ProductRuntimeSession, sessions: Map<number, ProductRuntimeSession>): number {
  let current = session
  let depth = 0
  const visited = new Set<number>()
  while (current.parentSessionId != null && !visited.has(current.parentSessionId)) {
    visited.add(current.id!)
    const parent = sessions.get(current.parentSessionId)
    if (!parent || sourceIdentity(parent) !== sourceIdentity(session)) break
    depth += 1
    current = parent
  }
  return depth
}

/**
 * Builds the player-facing save/branch list without exposing hashes, stable
 * definition keys, or unrevealed Release content. `actionIdentity` carries
 * non-display local ids so callers never route mutations by array index/uiId.
 */
export async function projectTextOpenWorldPlayerSavesV1(input: {
  owner: TextOpenWorldSaveOwnerV1
  currentSessionId?: number | null
  includeBuildPreviews?: boolean
}): Promise<TextOpenWorldPlayerSavesProjectionV1> {
  const owner = await resolveOwner(input.owner)
  const sessions = (await db.productRuntimeSessions.where('workId').equals(owner.workId).toArray())
    .filter(session => sessionMatchesOwner(session, owner))
    .filter(session => input.includeBuildPreviews === true || session.productReleaseId != null)
  const sessionsById = new Map(sessions.map(session => [session.id!, session]))
  const checkpointRows = await db.productRuntimeCheckpoints.where('projectId').equals(owner.projectId).toArray()
  const checkpointsBySession = new Map<number, ProductRuntimeCheckpoint[]>()
  checkpointRows.forEach(checkpoint => {
    const session = sessionsById.get(checkpoint.sessionId)
    if (!session || checkpoint.projectId !== owner.projectId
      || (checkpoint.worldGroupId ?? null) !== owner.worldGroupId) return
    const rows = checkpointsBySession.get(checkpoint.sessionId) ?? []
    rows.push(checkpoint)
    checkpointsBySession.set(checkpoint.sessionId, rows)
  })

  const releases = await db.productReleases.bulkGet(
    [...new Set(sessions.flatMap(session => session.productReleaseId == null ? [] : [session.productReleaseId]))],
  )
  const releasesById = new Map(releases.flatMap(release => release?.id == null ? [] : [[release.id, release] as const]))
  const rawGroups = new Map<string, ProductRuntimeSession[]>()
  sessions.forEach(session => {
    const key = `${sourceIdentity(session)}:root:${rootSessionId(session, sessionsById)}`
    const group = rawGroups.get(key) ?? []
    group.push(session)
    rawGroups.set(key, group)
  })
  const orderedGroups = [...rawGroups.values()].sort((left, right) => (
    Math.max(...right.map(session => session.updatedAt)) - Math.max(...left.map(session => session.updatedAt))
  ))

  const groups: TextOpenWorldPlayerSaveGroupV1[] = []
  for (let groupIndex = 0; groupIndex < orderedGroups.length; groupIndex += 1) {
    const groupSessions = orderedGroups[groupIndex]
      .slice()
      .sort((left, right) => Number(right.id === input.currentSessionId) - Number(left.id === input.currentSessionId)
        || right.updatedAt - left.updatedAt || (right.id ?? 0) - (left.id ?? 0))
    const root = groupSessions.find(session => session.id === rootSessionId(session, sessionsById)) ?? groupSessions[0]
    const release = root.productReleaseId == null ? null : releasesById.get(root.productReleaseId) ?? null
    const branches: TextOpenWorldPlayerSaveBranchV1[] = []
    for (let branchIndex = 0; branchIndex < groupSessions.length; branchIndex += 1) {
      const session = groupSessions[branchIndex]
      const rawCheckpoints = (checkpointsBySession.get(session.id!) ?? [])
        .slice()
        .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
      const checkpoints = await Promise.all(rawCheckpoints.map((checkpoint, checkpointIndex) => (
        projectCheckpoint(checkpoint, session, `save-${groupIndex + 1}-${branchIndex + 1}-${checkpointIndex + 1}`)
      )))
      let boundary: CanonicalBoundaryV1 | null = null
      let summary: TextOpenWorldPlayerSaveSummaryV1 | null = null
      try {
        boundary = await canonicalBoundary(session)
        summary = playerSafeSummary(boundary.state)
      } catch { summary = null }
      const runtimeFormat = boundary?.runtimeFormat
        ?? (() => {
          try { return parseProductRuntimeState(session.initialStateJson).textOpenWorld ? 'vnext' as const : 'legacy' as const } catch { return 'legacy' as const }
        })()
      const runtimeInspection = runtimeFormat === 'vnext'
        ? await inspectTextOpenWorldRuntimeHeadV1(session.id!)
        : null
      const runtimeHealth = runtimeInspection
        ? runtimeInspection.code === 'valid' && summary ? 'available' : runtimeInspection.repairable && summary ? 'repairable' : 'damaged'
        : boundary && summary ? 'available' : 'damaged'
      const parent = session.parentSessionId == null ? null : sessionsById.get(session.parentSessionId) ?? null
      const relationship = session.id === root.id ? 'root' : parent ? 'child' : 'orphaned-parent'
      const manualUsed = rawCheckpoints.filter(checkpoint => normalizedPurpose(checkpoint) === 'manual').length
      branches.push({
        uiId: `branch-${groupIndex + 1}-${branchIndex + 1}`,
        actionIdentity: { sessionId: session.id! },
        title: trimLabel(session.title, '未命名旅程'),
        statusLabel: sessionStatusLabel(session.status),
        relationship,
        relationshipLabel: relationship === 'root' ? '主时间线' : relationship === 'child' ? '分支时间线' : '父时间线已删除',
        parentTitle: parent ? trimLabel(parent.title, '未命名旅程') : null,
        depth: branchDepth(session, sessionsById),
        isCurrent: session.id === input.currentSessionId,
        updatedAt: session.updatedAt,
        runtimeFormat,
        summary,
        runtimeHealth,
        runtimeHealthLabel: runtimeHealth === 'available'
          ? '运行状态可读取'
          : runtimeHealth === 'repairable' ? '运行缓存可从规范事件修复' : '事件记录需要诊断',
        runtimeRepairable: runtimeInspection?.repairable ?? false,
        manualSlots: {
          used: manualUsed,
          limit: TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1,
          remaining: Math.max(0, TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1 - manualUsed),
        },
        checkpoints,
      })
    }
    groups.push({
      uiId: `save-group-${groupIndex + 1}`,
      title: release ? trimLabel(release.label, '未命名游戏') : trimLabel(root.title, '未命名游戏'),
      versionLabel: release ? `版本 ${release.version}` : '制作预览',
      sourceKind: release ? '正式发布' : '制作预览',
      branchCount: branches.length,
      branches,
    })
  }
  return {
    groups,
    totalBranches: groups.reduce((sum, group) => sum + group.branchCount, 0),
    totalCheckpoints: groups.reduce((sum, group) => sum + group.branches.reduce((branchSum, branch) => branchSum + branch.checkpoints.length, 0), 0),
  }
}

/** Creates a named manual save with a transactionally enforced per-Session cap. */
export async function createTextOpenWorldManualSaveV1(input: {
  owner: TextOpenWorldSaveOwnerV1
  sessionId: number
  name: string
  expectedThroughSequence?: number
}): Promise<ProductRuntimeCheckpoint> {
  const owner = await resolveOwner(input.owner)
  const previewSession = await ownedSession(owner, input.sessionId)
  const canonical = await canonicalBoundary(previewSession)
  if (input.expectedThroughSequence != null && canonical.throughSequence !== input.expectedThroughSequence) {
    fail('存档基线已变化，请刷新后重试')
  }
  const name = trimLabel(input.name, '手动存档')
  const created = await db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, db.productRuntimeCheckpoints, async () => {
    const session = await db.productRuntimeSessions.get(input.sessionId)
    assertSessionMatchesOwner(session, owner)
    if (session.initialStateJson !== previewSession.initialStateJson
      || session.runtimeSourceHash !== previewSession.runtimeSourceHash
      || session.productReleaseId !== previewSession.productReleaseId
      || session.productBuildId !== previewSession.productBuildId) {
      fail('存档冻结来源已变化，请刷新后重试')
    }
    const currentEvents = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
    const latest = currentEvents[currentEvents.length - 1]
    if ((latest?.sequence ?? 0) !== canonical.throughSequence) fail('存档基线已变化，请刷新后重试')
    const checkpoints = await db.productRuntimeCheckpoints.where('sessionId').equals(input.sessionId).toArray()
    if (checkpoints.filter(checkpoint => normalizedPurpose(checkpoint) === 'manual').length >= TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1) {
      fail(`手动存档最多${TEXT_OPEN_WORLD_MANUAL_SAVE_LIMIT_V1}个，请先删除旧存档`)
    }
    return createProductRuntimeCheckpoint({
      sessionId: input.sessionId,
      throughSequence: canonical.throughSequence,
      purpose: 'manual',
      subjectKey: null,
      name,
    })
  })
  if (!created.id) fail('手动存档没有完成持久化')
  if (canonical.runtimeFormat === 'vnext') {
    const inspection = await inspectTextOpenWorldCheckpointV1(created.id)
    if (!inspection.valid) fail(`新手动存档校验失败:${inspection.code}`)
  } else if (!(await verifyProductRuntimeCheckpoint(created.id))) {
    fail('旧版Release手动存档未通过共享检查点验证')
  }
  return created
}

function parseEventPayload(event: ProductRuntimeEvent): unknown {
  try { return JSON.parse(event.payloadJson) } catch { fail('规范终态事件正文损坏') }
}

function milestoneSubject(definitionKey: string, stageKey: string | null, throughSequence: number): string {
  const literal = `quest:${definitionKey}:stage:${stageKey ?? 'complete'}`
  return literal.length <= 200 ? literal : `quest-stage-event:${throughSequence}`
}

function automaticCandidates(boundary: CanonicalBoundaryV1): AutomaticSaveCandidateV1[] {
  const modules = parseTextOpenWorldModulesV1(boundary.state.textOpenWorld!.runtimePackage)
  const candidates: AutomaticSaveCandidateV1[] = []
  boundary.events.forEach(event => {
    if (event.type !== 'text-open-world.effects.applied') return
    const payload = parseTextOpenWorldEffectsAppliedEventPayloadV1(parseEventPayload(event))
    if (payload.outcome === 'failure') return
    if (payload.plan.authorization?.kind === 'quest-transition') {
      const authorization = payload.plan.authorization
      const milestone = [...authorization.transitions].reverse()
        .find(transition => transition.intent === 'advance-stage' || transition.intent === 'complete')
      const definition = modules.quests.quests.find(candidate => candidate.key === authorization.definitionKey)
      if (milestone && definition && (definition.type === 'mainline' || definition.type === 'significant')) {
        const stage = milestone.stageKey == null
          ? null
          : modules.quests.stages.find(candidate => candidate.key === milestone.stageKey) ?? null
        candidates.push({
          purpose: 'milestone',
          throughSequence: event.sequence,
          subjectKey: milestoneSubject(definition.key, milestone.stageKey, event.sequence),
          name: trimLabel(`里程碑 · ${definition.title}${stage ? ` · ${stage.title}` : ''}`, '故事里程碑'),
          createdAt: event.createdAt,
        })
        return
      }
    }
    const destination = [...payload.plan.effects].reverse().find(effect => effect.operation === 'enter-location')
    const fastTravel = payload.plan.effects.some(effect => effect.operation === 'fast-travel')
    if (!destination && !fastTravel) return
    const locationKey = destination?.operation === 'enter-location'
      ? destination.payload.locationKey
      : payload.plan.authorization?.kind === 'fast-travel' ? payload.plan.authorization.destinationLocationKey : null
    const location = locationKey == null ? null : modules.world.locations.find(candidate => candidate.key === locationKey) ?? null
    candidates.push({
      purpose: 'autosave',
      throughSequence: event.sequence,
      subjectKey: null,
      name: trimLabel(`自动保存${location ? ` · 抵达${location.title}` : ''}`, '自动保存'),
      createdAt: event.createdAt,
    })
  })
  return candidates.sort((left, right) => left.throughSequence - right.throughSequence)
}

function sameAutomaticIdentity(checkpoint: ProductRuntimeCheckpoint, candidate: AutomaticSaveCandidateV1): boolean {
  return normalizedPurpose(checkpoint) === candidate.purpose
    && checkpoint.throughSequence === candidate.throughSequence
    && (candidate.purpose !== 'milestone' || (checkpoint.subjectKey ?? null) === candidate.subjectKey)
}

/**
 * Reconciles missing post-terminal saves after normal execution or a crash.
 * It never observes UI callbacks: only verified canonical terminal events count.
 */
export async function reconcileTextOpenWorldAutomaticSavesV1(input: {
  owner: TextOpenWorldSaveOwnerV1
  sessionId: number
  maximumAutomaticSaves?: number
}): Promise<TextOpenWorldAutomaticSaveReconcileResultV1> {
  const owner = await resolveOwner(input.owner)
  const session = await ownedSession(owner, input.sessionId)
  const boundary = await canonicalBoundary(session)
  if (boundary.runtimeFormat !== 'vnext') fail('旧版Release不支持vNext自动存档或故事里程碑推导')
  const maximum = input.maximumAutomaticSaves ?? TEXT_OPEN_WORLD_AUTOMATIC_SAVE_LIMIT_V1
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 50) fail('自动存档轮转上限必须是1..50')
  const desired = automaticCandidates(boundary).slice(-maximum)
  const eventSnapshot = snapshotJson(boundary.events)
  let createdCount = 0
  let retainedCount = 0
  let prunedCount = 0
  const retainedIds: number[] = []
  await db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, db.productRuntimeCheckpoints, async () => {
    const current = await db.productRuntimeSessions.get(input.sessionId)
    assertSessionMatchesOwner(current, owner)
    if (current.initialStateJson !== session.initialStateJson
      || current.runtimeSourceHash !== session.runtimeSourceHash
      || current.productReleaseId !== session.productReleaseId
      || current.productBuildId !== session.productBuildId) {
      fail('自动存档扫描期间冻结来源已变化，请重试')
    }
    const currentEvents = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
    if (snapshotJson(currentEvents) !== eventSnapshot) fail('自动存档扫描期间事件已变化，请重试')
    const checkpoints = await db.productRuntimeCheckpoints.where('sessionId').equals(input.sessionId).toArray()
    for (const candidate of desired) {
      const matches = checkpoints
        .filter(checkpoint => sameAutomaticIdentity(checkpoint, candidate))
        .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
      let checkpoint = matches[0]
      if (!checkpoint) {
        checkpoint = await createProductRuntimeCheckpoint({
          sessionId: input.sessionId,
          throughSequence: candidate.throughSequence,
          purpose: candidate.purpose,
          subjectKey: candidate.subjectKey,
          name: candidate.name,
        })
        checkpoints.push(checkpoint)
        createdCount += 1
      } else {
        retainedCount += 1
      }
      retainedIds.push(checkpoint.id!)
    }
    const keep = new Set(retainedIds)
    const stale = checkpoints.filter(checkpoint => (
      normalizedPurpose(checkpoint) !== 'invalid'
      && AUTOMATIC_PURPOSES.has(normalizedPurpose(checkpoint) as ProductRuntimeCheckpointPurposeV1)
      && !keep.has(checkpoint.id!)
    ))
    if (stale.length > 0) {
      await db.productRuntimeCheckpoints.bulkDelete(stale.map(checkpoint => checkpoint.id!))
      prunedCount = stale.length
    }
  })
  let damagedCount = 0
  for (const id of retainedIds) {
    if (!(await inspectTextOpenWorldCheckpointV1(id)).valid) damagedCount += 1
  }
  return { candidateCount: desired.length, createdCount, retainedCount, prunedCount, damagedCount }
}

/** Branches from a verified slot and proves that the immutable runtime source did not change. */
export async function branchTextOpenWorldPlayerSaveV1(input: {
  owner: TextOpenWorldSaveOwnerV1
  checkpointId: number
  title: string
  seed?: string
}): Promise<ProductRuntimeSession> {
  const owner = await resolveOwner(input.owner)
  const checkpoint = await db.productRuntimeCheckpoints.get(input.checkpointId)
  if (!checkpoint) fail('存档不存在')
  const parent = await ownedSession(owner, checkpoint.sessionId)
  if (checkpoint.projectId !== parent.projectId
    || (checkpoint.worldGroupId ?? null) !== (parent.worldGroupId ?? null)) fail('存档作用域与Session不一致')
  const runtimeFormat = parseProductRuntimeState(parent.initialStateJson).textOpenWorld ? 'vnext' : 'legacy'
  if (runtimeFormat === 'legacy' && !(await verifyProductRuntimeCheckpoint(input.checkpointId))) {
    fail('旧版Release存档没有通过共享检查点验证')
  }
  const child = runtimeFormat === 'vnext'
    ? await branchTextOpenWorldSessionFromCheckpointV1({
      checkpointId: input.checkpointId,
      title: trimLabel(input.title, `${parent.title} · 分支`),
      seed: input.seed,
    })
    : await branchProductRuntimeSession({
      parentSessionId: parent.id!,
      throughSequence: checkpoint.throughSequence,
      title: trimLabel(input.title, `${parent.title} · 分支`),
      seed: input.seed,
    })
  if (!sessionMatchesOwner(child, owner)
    || child.productReleaseId !== parent.productReleaseId
    || child.productBuildId !== parent.productBuildId
    || child.runtimeSourceHash !== parent.runtimeSourceHash) {
    fail('新分支没有保持父存档的冻结发布版本')
  }
  return child
}

/** Repairs checkpoint snapshot/cache fields only; canonical events remain untouched. */
export async function repairTextOpenWorldPlayerCheckpointV1(input: {
  owner: TextOpenWorldSaveOwnerV1
  checkpointId: number
}): Promise<TextOpenWorldPlayerCheckpointV1> {
  const owner = await resolveOwner(input.owner)
  const checkpoint = await db.productRuntimeCheckpoints.get(input.checkpointId)
  if (!checkpoint) fail('存档不存在')
  const session = await ownedSession(owner, checkpoint.sessionId)
  if (checkpoint.projectId !== session.projectId
    || (checkpoint.worldGroupId ?? null) !== (session.worldGroupId ?? null)) fail('存档作用域与Session不一致')
  const runtimeFormat = parseProductRuntimeState(session.initialStateJson).textOpenWorld ? 'vnext' : 'legacy'
  const before = runtimeFormat === 'vnext'
    ? await inspectTextOpenWorldCheckpointV1(input.checkpointId)
    : null
  if (before?.valid || (!before && await verifyProductRuntimeCheckpoint(input.checkpointId))) {
    return projectCheckpoint(checkpoint, session, 'save-repaired')
  }
  if (normalizedPurpose(checkpoint) === 'invalid'
    || (before && !REPAIRABLE_CHECKPOINT_CODES.has(before.code))) fail('该存档不能从规范事件安全修复')
  const canonical = await canonicalBoundary(session, checkpoint.throughSequence)
  const stateJson = JSON.stringify(canonical.state)
  const stateHash = await hashProductRuntimeStateV1(canonical.state)
  const checkpointSnapshot = snapshotJson(checkpoint)
  const eventSnapshot = snapshotJson(canonical.events)
  await db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, db.productRuntimeCheckpoints, async () => {
    const currentSession = await db.productRuntimeSessions.get(session.id!)
    assertSessionMatchesOwner(currentSession, owner)
    if (currentSession.initialStateJson !== session.initialStateJson
      || currentSession.runtimeSourceHash !== session.runtimeSourceHash) fail('存档冻结来源在修复期间已变化，请重试')
    const currentCheckpoint = await db.productRuntimeCheckpoints.get(input.checkpointId)
    if (!currentCheckpoint || snapshotJson(currentCheckpoint) !== checkpointSnapshot) {
      fail('存档在修复期间已变化，请重试')
    }
    const currentEvents = (await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence'))
      .filter(event => event.sequence <= checkpoint.throughSequence)
    if (snapshotJson(currentEvents) !== eventSnapshot) fail('事件在修复期间已变化，请重试')
    await db.productRuntimeCheckpoints.update(input.checkpointId, { stateJson, stateHash })
  })
  const repaired = await db.productRuntimeCheckpoints.get(input.checkpointId) ?? fail('修复后的存档不存在')
  if (runtimeFormat === 'vnext') {
    const inspection = await inspectTextOpenWorldCheckpointV1(input.checkpointId)
    if (!inspection.valid) fail(`存档修复未通过复验:${inspection.code}`)
  } else if (!(await verifyProductRuntimeCheckpoint(input.checkpointId))) {
    fail('旧版Release存档修复未通过共享检查点复验')
  }
  return projectCheckpoint(repaired, session, 'save-repaired')
}

export async function repairTextOpenWorldPlayerRuntimeHeadV1(input: {
  owner: TextOpenWorldSaveOwnerV1
  sessionId: number
}): Promise<{ health: 'available'; label: string }> {
  const owner = await resolveOwner(input.owner)
  const session = await ownedSession(owner, input.sessionId)
  const runtimeFormat = parseProductRuntimeState(session.initialStateJson).textOpenWorld ? 'vnext' : 'legacy'
  if (runtimeFormat === 'legacy') {
    const canonical = await canonicalBoundary(session)
    const stateJson = JSON.stringify(canonical.state)
    const stateHash = await hashProductRuntimeStateV1(canonical.state)
    const eventSnapshot = snapshotJson(canonical.events)
    await db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, async () => {
      const current = await db.productRuntimeSessions.get(input.sessionId)
      assertSessionMatchesOwner(current, owner)
      if (current.initialStateJson !== session.initialStateJson
        || current.runtimeSourceHash !== session.runtimeSourceHash) fail('运行状态修复期间冻结来源已变化，请重试')
      const currentEvents = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
      if (snapshotJson(currentEvents) !== eventSnapshot) fail('运行状态修复期间事件已变化，请重试')
      await updateProductRuntimeSessionHeadV1({
        sessionId: input.sessionId,
        sequence: canonical.throughSequence,
        stateJson,
        stateHash,
        updatedAt: Date.now(),
      })
    })
    await canonicalBoundary(await ownedSession(owner, input.sessionId))
    return { health: 'available', label: '运行状态可读取' }
  }
  const before = await inspectTextOpenWorldRuntimeHeadV1(input.sessionId)
  if (before.code !== 'valid' && !before.repairable) fail('该运行状态不能从规范事件安全修复')
  if (before.repairable) await repairTextOpenWorldRuntimeHeadV1(input.sessionId)
  await ownedSession(owner, input.sessionId)
  const after = await inspectTextOpenWorldRuntimeHeadV1(input.sessionId)
  if (after.code !== 'valid') fail('运行状态修复未通过复验')
  return { health: 'available', label: '运行状态可读取' }
}

export async function deleteTextOpenWorldPlayerCheckpointV1(input: {
  owner: TextOpenWorldSaveOwnerV1
  checkpointId: number
}): Promise<void> {
  const owner = await resolveOwner(input.owner)
  await db.transaction('rw', db.productRuntimeSessions, db.productRuntimeCheckpoints, async () => {
    const checkpoint = await db.productRuntimeCheckpoints.get(input.checkpointId)
    if (!checkpoint) fail('存档不存在')
    const session = await db.productRuntimeSessions.get(checkpoint.sessionId)
    assertSessionMatchesOwner(session, owner)
    if (checkpoint.projectId !== session.projectId
      || (checkpoint.worldGroupId ?? null) !== (session.worldGroupId ?? null)) fail('存档作用域与Session不一致')
    await db.productRuntimeCheckpoints.delete(input.checkpointId)
  })
}

export async function deleteTextOpenWorldPlayerBranchV1(input: {
  owner: TextOpenWorldSaveOwnerV1
  sessionId: number
}): Promise<void> {
  const owner = await resolveOwner(input.owner)
  await ownedSession(owner, input.sessionId)
  await deleteProductRuntimeSession(input.sessionId)
}
