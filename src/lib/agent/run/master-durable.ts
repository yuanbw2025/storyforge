import type {
  AgentEvent,
  AgentRunEventTypeV1,
  AgentRunProjectionV1,
  WorkspaceScope,
} from '../../types'
import {
  appendAgentEvent,
  readAgentEvents,
} from '../conversations'
import {
  DOMAIN_AGENT_IDS,
  executeMasterAgentPlan,
  type DomainAgentId,
  type ExecutedMasterCandidate,
  type MasterAgentExecutionTrace,
  type MasterAgentPlan,
  type MasterAgentTask,
  type MasterCandidatePayload,
} from '../orchestrator'
import type { AgentTeamBudgetEvidence } from '../team-budget'
import { CHARACTER_DIMENSIONS } from '../../character/character-dimensions'
import { OUTLINE_COPILOT_SOURCE_KEYS } from '../outline-copilot'
import { PROSE_COPILOT_SOURCE_KEYS } from '../prose-copilot'
import { acceptAgentRunContractV1 } from './contract'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import {
  beginAgentRunRecoveryV1,
  createAgentRunCheckpointV1,
  completeAgentRunRecoveryV1,
  readLatestVerifiedAgentRunCheckpointV1,
} from './checkpoint'
import { hashCanonicalValue } from './hash'
import {
  AgentTeamBudgetExceededError,
  AgentTeamBudgetTracker,
  AGENT_TEAM_BUDGET_PROFILES,
  resolveAgentTeamBudgetPolicy,
  type AgentTeamBudgetProfile,
} from '../team-budget'
import { db } from '../../db/schema'
import { assertRecordInScope, scopeTransactionTables } from '../../world-engine/scope'

export const MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1 = 'master-agent-plan'
export const MASTER_AGENT_PLAN_CHECKPOINT_VERSION_V1 = 1 as const
export const MASTER_AGENT_DURABLE_HARNESS_STORAGE_KEY = 'storyforge:harness:master-agent-durable-v1'

export function isMasterAgentDurableHarnessEnabledV1(): boolean {
  try {
    return globalThis.localStorage?.getItem(MASTER_AGENT_DURABLE_HARNESS_STORAGE_KEY) !== 'disabled'
  } catch {
    return true
  }
}

const MAX_PLAN_TASKS = 5
const MAX_PLAN_SUMMARY_CHARS = 500
const MAX_TASK_ID_CHARS = 80
const MAX_TASK_INSTRUCTION_CHARS = 1_000
const MAX_CANDIDATE_CHARS = 120_000

const CONTEXT_KEYS_BY_AGENT: Record<DomainAgentId, readonly string[]> = {
  'world-origin': ['projectStatus', 'worldview', 'powerSystem', 'codex'],
  character: ['worldview', 'powerSystem', 'codex', 'characters', 'characterRelations'],
  inspiration: ['inspirationWorkspace'],
  outline: [...OUTLINE_COPILOT_SOURCE_KEYS],
  prose: [...PROSE_COPILOT_SOURCE_KEYS],
}

const WRITE_TARGETS_BY_AGENT: Record<DomainAgentId, { table: string; fields: string[] }> = {
  'world-origin': { table: 'worldviews', fields: ['worldOrigin'] },
  character: {
    table: 'characters',
    fields: [
      'name',
      'roleWeight',
      'moralAxis',
      'orderAxis',
      'relationships',
      ...CHARACTER_DIMENSIONS.map(dimension => dimension.key),
    ],
  },
  inspiration: { table: 'inspirationWorkspaces', fields: ['versions'] },
  outline: { table: 'outlineNodes', fields: ['title', 'summary'] },
  prose: { table: 'chapters', fields: ['content'] },
}

export interface MasterAgentPlanCheckpointV1 {
  version: typeof MASTER_AGENT_PLAN_CHECKPOINT_VERSION_V1
  kind: typeof MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1
  plan: MasterAgentPlan
  planHash: string
  budgetEvidence: AgentTeamBudgetEvidence
}

export interface MasterAgentDurableCandidateV1 {
  event: AgentEvent
  payload: MasterCandidatePayload
  draft: string
  runtime?: ExecutedMasterCandidate
}

export interface DurableMasterAgentResultV1 {
  runId: number
  resumed: boolean
  plan: MasterAgentPlan
  candidates: MasterAgentDurableCandidateV1[]
  budgetEvidence: AgentTeamBudgetEvidence
  projection: AgentRunProjectionV1
}

export interface RestoredMasterAgentCandidatesV1 {
  snapshot: AgentRunSnapshotV1
  plan: MasterAgentPlan
  candidates: MasterAgentDurableCandidateV1[]
  outputs: Record<string, string>
  budgetEvidence: AgentTeamBudgetEvidence
}

export interface MasterAgentDurableBoundaryV1 {
  type: AgentRunEventTypeV1
  runId: number
  sequence: number
}

export interface RunDurableMasterAgentInputV1 {
  scope: WorkspaceScope
  worldGroupId: number | null
  conversationId?: number
  plan?: MasterAgentPlan
  runId?: number
  budget?: AgentTeamBudgetTracker
  signal?: AbortSignal
  onDurableBoundary?: (boundary: MasterAgentDurableBoundaryV1) => void | Promise<void>
  onTask?: (
    task: MasterAgentTask,
    status: 'running' | 'completed' | 'failed',
    error?: string,
  ) => void | Promise<void>
  now?: () => number
}

export interface MasterAgentDurableDependenciesV1 {
  execute?: typeof executeMasterAgentPlan
}

function fail(message: string): never {
  throw new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(`${label} 无效`)
  }
  return value
}

function readHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`${label} 不是有效哈希`)
  return value
}

function readInteger(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) fail(`${label} 无效`)
  return Number(value)
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不符合严格契约`)
  }
}

function assertAcyclic(plan: MasterAgentPlan): void {
  const byId = new Map(plan.tasks.map(task => [task.id, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) fail('主 Agent 计划包含循环依赖')
    if (visited.has(id)) return
    const task = byId.get(id)
    if (!task) fail(`主 Agent 计划依赖不存在的任务 ${id}`)
    visiting.add(id)
    task.dependsOn.forEach(visit)
    visiting.delete(id)
    visited.add(id)
  }
  plan.tasks.forEach(task => visit(task.id))
}

/** Strictly validates the persisted plan instead of trusting a UI plan object. */
export function parseMasterAgentPlanV1(value: unknown): MasterAgentPlan {
  if (!isRecord(value)) fail('主 Agent 计划必须是对象')
  assertExactKeys(value, ['summary', 'tasks'], '主 Agent 计划')
  const summary = readString(value.summary, '主 Agent 计划 summary', MAX_PLAN_SUMMARY_CHARS)
  if (!Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > MAX_PLAN_TASKS) {
    fail(`主 Agent 计划任务数必须在 1-${MAX_PLAN_TASKS} 之间`)
  }
  const ids = new Set<string>()
  const tasks: MasterAgentTask[] = value.tasks.map((item, index) => {
    if (!isRecord(item)) fail(`主 Agent 计划任务 ${index + 1} 无效`)
    assertExactKeys(item, ['id', 'agentId', 'instruction', 'dependsOn'], `主 Agent 计划任务 ${index + 1}`)
    const id = readString(item.id, `主 Agent 计划任务 ${index + 1}.id`, MAX_TASK_ID_CHARS)
    if (ids.has(id)) fail(`主 Agent 计划包含重复任务 ID ${id}`)
    ids.add(id)
    if (!DOMAIN_AGENT_IDS.includes(item.agentId as DomainAgentId)) {
      fail(`主 Agent 计划包含未知领域 ${String(item.agentId)}`)
    }
    const instruction = readString(
      item.instruction,
      `主 Agent 计划任务 ${id}.instruction`,
      MAX_TASK_INSTRUCTION_CHARS,
    )
    if (!Array.isArray(item.dependsOn) || item.dependsOn.some(dep => typeof dep !== 'string')) {
      fail(`主 Agent 计划任务 ${id}.dependsOn 无效`)
    }
    const dependsOn = [...new Set(item.dependsOn as string[])]
    if (dependsOn.includes(id)) fail(`主 Agent 计划任务 ${id} 不得依赖自身`)
    return {
      id,
      agentId: item.agentId as DomainAgentId,
      instruction,
      dependsOn,
    }
  })
  const result = { summary, tasks }
  const known = new Set(tasks.map(task => task.id))
  tasks.forEach(task => task.dependsOn.forEach(dep => {
    if (!known.has(dep)) fail(`主 Agent 计划任务 ${task.id} 依赖不存在的任务 ${dep}`)
  }))
  assertAcyclic(result)
  return result
}

export async function hashMasterAgentPlanV1(plan: MasterAgentPlan): Promise<string> {
  return hashCanonicalValue(parseMasterAgentPlanV1(plan))
}

function sourceKeysForPlan(plan: MasterAgentPlan): string[] {
  return [...new Set(plan.tasks.flatMap(task => CONTEXT_KEYS_BY_AGENT[task.agentId]))]
}

function writeTargetsForPlan(plan: MasterAgentPlan): Array<{ table: string; fields: string[]; mode: 'author-confirmed' }> {
  const byTable = new Map<string, Set<string>>()
  plan.tasks.forEach(task => {
    const target = WRITE_TARGETS_BY_AGENT[task.agentId]
    const fields = byTable.get(target.table) ?? new Set<string>()
    target.fields.forEach(field => fields.add(field))
    byTable.set(target.table, fields)
  })
  return [...byTable.entries()].map(([table, fields]) => ({
    table,
    fields: [...fields],
    mode: 'author-confirmed' as const,
  }))
}

export function buildMasterAgentRunContractV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  plan: MasterAgentPlan
  budgetEvidence: AgentTeamBudgetEvidence
}) {
  const plan = parseMasterAgentPlanV1(input.plan)
  const policy = resolveAgentTeamBudgetPolicy(input.budgetEvidence.profile)
  const acceptance = plan.tasks.flatMap(task => [
    { id: `${task.id}.candidate`, kind: 'output-present' as const, required: true },
    { id: `${task.id}.confirmed`, kind: 'author-confirmed' as const, required: true },
    { id: `${task.id}.adopted`, kind: 'adoption-committed' as const, required: true },
  ])
  const verificationPlan = [
    ...plan.tasks.flatMap(task => [
      {
        id: `${task.id}.candidate-persistence`,
        kind: 'protocol' as const,
        verifier: 'master-candidate-persistence-v1',
        criterionIds: [`${task.id}.candidate`],
      },
      {
        id: `${task.id}.adoption`,
        kind: 'adoption' as const,
        verifier: 'master-author-adoption-v1',
        criterionIds: [`${task.id}.confirmed`, `${task.id}.adopted`],
      },
    ]),
    {
      id: 'master.terminal',
      kind: 'terminal' as const,
      verifier: 'master-terminal-verifier-v1',
      criterionIds: acceptance.map(item => item.id),
    },
  ]
  return {
    version: 1 as const,
    objective: plan.summary,
    workflowKind: 'multi-domain-sequential' as const,
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
    },
    permissions: {
      contextSourceKeys: sourceKeysForPlan(plan),
      writeTargets: writeTargetsForPlan(plan),
    },
    budget: {
      maxModelCalls: policy.maxCalls,
      maxToolCalls: 0,
      maxInputTokens: policy.maxTokens,
      maxOutputTokens: policy.maxTokens,
      maxAttemptsPerStep: 2,
      maxProtocolErrors: policy.maxCanonRetries,
    },
    acceptance,
    verificationPlan,
    failurePolicy: {
      onProtocolError: 'retry' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function budgetEvidence(value: unknown, label: string): AgentTeamBudgetEvidence {
  if (!isRecord(value)) fail(`${label} 无效`)
  assertExactKeys(value, ['profile', 'maxTokens', 'maxCalls', 'maxCanonRetries', 'usedTokens', 'calls', 'canonRetries'], label)
  if (!AGENT_TEAM_BUDGET_PROFILES.includes(value.profile as AgentTeamBudgetProfile)) {
    fail(`${label}.profile 无效`)
  }
  const profile = value.profile as AgentTeamBudgetProfile
  const policy = resolveAgentTeamBudgetPolicy(profile)
  const evidence = {
    profile,
    maxTokens: readInteger(value.maxTokens, `${label}.maxTokens`),
    maxCalls: readInteger(value.maxCalls, `${label}.maxCalls`),
    maxCanonRetries: readInteger(value.maxCanonRetries, `${label}.maxCanonRetries`),
    usedTokens: readInteger(value.usedTokens, `${label}.usedTokens`),
    calls: readInteger(value.calls, `${label}.calls`),
    canonRetries: readInteger(value.canonRetries, `${label}.canonRetries`),
  }
  if (
    evidence.maxTokens !== policy.maxTokens
    || evidence.maxCalls !== policy.maxCalls
    || evidence.maxCanonRetries !== policy.maxCanonRetries
    || evidence.usedTokens > policy.maxTokens
    || evidence.calls > policy.maxCalls
    || evidence.canonRetries > policy.maxCanonRetries
  ) fail(`${label} 与团队预算策略不一致`)
  return evidence
}

function parsePlanCheckpoint(value: unknown): MasterAgentPlanCheckpointV1 {
  if (!isRecord(value)) fail('主 Agent 计划检查点必须是对象')
  assertExactKeys(value, ['version', 'kind', 'plan', 'planHash', 'budgetEvidence'], '主 Agent 计划检查点')
  if (value.version !== MASTER_AGENT_PLAN_CHECKPOINT_VERSION_V1 || value.kind !== MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1) {
    fail('主 Agent 计划检查点版本或类型不匹配')
  }
  const plan = parseMasterAgentPlanV1(value.plan)
  const planHash = readHash(value.planHash, '主 Agent 计划检查点 planHash')
  const parsedBudget = budgetEvidence(value.budgetEvidence, '主 Agent 计划检查点 budgetEvidence')
  return { version: 1, kind: MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1, plan, planHash, budgetEvidence: parsedBudget }
}

function taskStepId(taskId: string): string {
  return `master:${taskId}`
}

function candidateHashInput(payload: MasterCandidatePayload, draft: string): unknown {
  const { candidateHash: _candidateHash, ...withoutHash } = payload
  return { draft, payload: withoutHash }
}

async function computeCandidateHash(payload: MasterCandidatePayload, draft: string): Promise<string> {
  return hashCanonicalValue(candidateHashInput(payload, draft))
}

function parseCandidatePayload(value: unknown, label: string): MasterCandidatePayload {
  if (!isRecord(value)) fail(`${label} payload 无效`)
  const payload = value as unknown as MasterCandidatePayload
  if (payload.version !== 1) fail(`${label} payload 版本不支持`)
  if (typeof payload.taskId !== 'string' || typeof payload.agentId !== 'string') fail(`${label} payload 缺少任务身份`)
  if (!DOMAIN_AGENT_IDS.includes(payload.agentId as DomainAgentId)) fail(`${label} payload 领域无效`)
  if (!Array.isArray(payload.contextSources) || payload.contextSources.some(source => typeof source !== 'string')) {
    fail(`${label} payload contextSources 无效`)
  }
  if (typeof payload.runId !== 'number' || !Number.isInteger(payload.runId) || payload.runId < 1) fail(`${label} payload runId 无效`)
  if (payload.runStepId !== taskStepId(payload.taskId)) fail(`${label} payload runStepId 不匹配`)
  readHash(payload.candidateHash, `${label} payload candidateHash`)
  budgetEvidence(payload.teamBudgetEvidence, `${label} payload teamBudgetEvidence`)
  return payload
}

function budgetAtLeast(next: AgentTeamBudgetEvidence, previous: AgentTeamBudgetEvidence): boolean {
  return next.profile === previous.profile
    && next.maxTokens === previous.maxTokens
    && next.maxCalls === previous.maxCalls
    && next.maxCanonRetries === previous.maxCanonRetries
    && next.usedTokens >= previous.usedTokens
    && next.calls >= previous.calls
    && next.canonRetries >= previous.canonRetries
}

async function readPersistedCandidates(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  plan: MasterAgentPlan
  checkpointBudget: AgentTeamBudgetEvidence
}): Promise<{
  candidates: MasterAgentDurableCandidateV1[]
  outputs: Record<string, string>
  latestBudget: AgentTeamBudgetEvidence
}> {
  const conversationId = input.snapshot.run.conversationId
  if (conversationId == null) fail('主 Agent durable run 缺少候选对话')
  const rows = (await readAgentEvents(conversationId, input.scope))
    .filter(event => event.kind === 'candidate' && event.id != null)
  const taskById = new Map(input.plan.tasks.map(task => [task.id, task]))
  const seen = new Set<string>()
  const candidates: MasterAgentDurableCandidateV1[] = []
  let latestBudget = input.checkpointBudget
  for (const event of rows) {
    let raw: unknown
    try {
      raw = JSON.parse(event.payload)
    } catch {
      fail(`候选事件 ${event.id} payload JSON 已损坏`)
    }
    if (!isRecord(raw) || raw.runId !== input.snapshot.run.id) continue
    const payload = parseCandidatePayload(raw, `候选事件 ${event.id}`)
    const task = taskById.get(payload.taskId)
    if (!task || payload.agentId !== task.agentId) fail(`候选事件 ${event.id} 不属于当前计划任务`)
    if (
      !Array.isArray(payload.dependsOnTaskIds)
      || payload.dependsOnTaskIds.length !== task.dependsOn.length
      || payload.dependsOnTaskIds.some((dependency, index) => dependency !== task.dependsOn[index])
    ) fail(`候选事件 ${event.id} 的任务依赖与计划不一致`)
    if (
      !payload.workspaceScope
      || payload.workspaceScope.projectId !== input.scope.projectId
      || payload.workspaceScope.worldId !== input.scope.worldId
      || payload.workspaceScope.workId !== input.scope.workId
    ) fail(`候选事件 ${event.id} 的 WorkspaceScope 不一致`)
    const allowedSources = new Set(input.snapshot.contract.permissions.contextSourceKeys)
    if (payload.contextSources.some(source => !allowedSources.has(source))) {
      fail(`候选事件 ${event.id} 使用了契约未授权的上下文源`)
    }
    if (seen.has(payload.taskId)) fail(`当前 durable run 存在重复候选任务 ${payload.taskId}`)
    if (event.content.length > MAX_CANDIDATE_CHARS) fail(`候选事件 ${event.id} 超出持久化上限`)
    const expectedHash = await computeCandidateHash(payload, event.content)
    if (expectedHash !== payload.candidateHash) fail(`候选事件 ${event.id} candidateHash 校验失败`)
    const step = input.snapshot.projection.steps[taskStepId(task.id)]
    if (!step || step.candidateHash !== payload.candidateHash) fail(`候选事件 ${event.id} 与 run ledger 不一致`)
    const evidence = budgetEvidence(payload.teamBudgetEvidence, `候选事件 ${event.id} teamBudgetEvidence`)
    if (!budgetAtLeast(evidence, latestBudget)) fail(`候选事件 ${event.id} 的团队预算证据倒退`)
    latestBudget = evidence
    seen.add(payload.taskId)
    candidates.push({ event, payload, draft: event.content })
  }
  input.plan.tasks.forEach(task => {
    const step = input.snapshot.projection.steps[taskStepId(task.id)]
    if (step?.candidateHash && !seen.has(task.id)) {
      fail(`run ledger 中的任务 ${task.id} 缺少对应候选事件`)
    }
  })
  candidates.sort((left, right) => (left.event.sequence ?? 0) - (right.event.sequence ?? 0))
  const outputs: Record<string, string> = {}
  candidates.forEach(candidate => { outputs[candidate.payload.taskId] = candidate.draft })
  return { candidates, outputs, latestBudget }
}

async function notify(
  callback: RunDurableMasterAgentInputV1['onDurableBoundary'],
  type: AgentRunEventTypeV1,
  snapshot: AgentRunSnapshotV1,
): Promise<void> {
  await callback?.({ type, runId: snapshot.run.id, sequence: snapshot.projection.lastSequence })
}

function failureResource(error: unknown): 'model-calls' | 'input-tokens' | null {
  return error instanceof AgentTeamBudgetExceededError ? 'input-tokens' : null
}

async function assertConversationScope(input: RunDurableMasterAgentInputV1): Promise<void> {
  if (input.conversationId == null) return
  const conversation = await db.agentConversations.get(input.conversationId)
  if (!conversation || !await assertRecordInScope(input.scope, 'agentConversations', conversation, { owner: 'work' })) {
    fail('主 Agent durable run 的对话不存在或越界')
  }
  if ((conversation.worldGroupId ?? null) !== input.worldGroupId) fail('主 Agent durable run 对话世界组不一致')
}

export async function runDurableMasterAgentPlanV1(
  input: RunDurableMasterAgentInputV1,
  dependencies: MasterAgentDurableDependenciesV1 = {},
): Promise<DurableMasterAgentResultV1> {
  const now = input.now ?? Date.now
  const execute = dependencies.execute ?? executeMasterAgentPlan
  let snapshot: AgentRunSnapshotV1
  let plan: MasterAgentPlan
  let budget: AgentTeamBudgetTracker
  const resumed = input.runId != null

  if (input.runId == null) {
    if (!input.plan) fail('新建主 Agent durable run 必须提供计划')
    if (input.conversationId == null) fail('新建主 Agent durable run 必须绑定候选对话')
    plan = parseMasterAgentPlanV1(input.plan)
    budget = input.budget ?? new AgentTeamBudgetTracker('balanced')
    const evidence = budget.snapshot()
    const contract = buildMasterAgentRunContractV1({
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      plan,
      budgetEvidence: evidence,
    })
    await assertConversationScope(input)
    snapshot = await createAgentRunV1({
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      conversationId: input.conversationId,
      contract,
      now: now(),
    })
    for (const task of plan.tasks) {
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: snapshot.run.id,
        type: 'step.scheduled',
        payload: { stepId: taskStepId(task.id) },
        expectedLastSequence: snapshot.projection.lastSequence,
        now: now(),
      })
      await notify(input.onDurableBoundary, 'step.scheduled', snapshot)
    }
    const checkpointPayload: MasterAgentPlanCheckpointV1 = {
      version: 1,
      kind: MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1,
      plan,
      planHash: await hashMasterAgentPlanV1(plan),
      budgetEvidence: evidence,
    }
    const saved = await createAgentRunCheckpointV1({
      scope: input.scope,
      runId: snapshot.run.id,
      resumePayload: checkpointPayload,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: now(),
    })
    snapshot = saved.snapshot
    await notify(input.onDurableBoundary, 'checkpoint.created', snapshot)
  } else {
    snapshot = await readAgentRunV1(input.scope, input.runId)
    const latest = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
    if (!latest) fail('主 Agent durable run 缺少计划检查点')
    const checkpointPayload = parsePlanCheckpoint(latest.resumePayload)
    const expectedPlanHash = await hashMasterAgentPlanV1(checkpointPayload.plan)
    if (expectedPlanHash !== checkpointPayload.planHash) fail('主 Agent 计划检查点 planHash 校验失败')
    if (input.plan && await hashMasterAgentPlanV1(input.plan) !== checkpointPayload.planHash) {
      fail('恢复提供的主 Agent 计划与持久化计划不一致')
    }
    plan = checkpointPayload.plan
    const contract = await acceptAgentRunContractV1(buildMasterAgentRunContractV1({
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      plan,
      budgetEvidence: checkpointPayload.budgetEvidence,
    }))
    if (snapshot.run.contractHash !== contract.contractHash) fail('主 Agent durable run 契约已变化')
    budget = new AgentTeamBudgetTracker(checkpointPayload.budgetEvidence.profile, checkpointPayload.budgetEvidence)
  }

  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  if (!checkpoint) fail('主 Agent durable run 缺少可验证检查点')
  const checkpointPayload = parsePlanCheckpoint(checkpoint.resumePayload)
  const restored = await readPersistedCandidates({
    scope: input.scope,
    snapshot,
    plan,
    checkpointBudget: checkpointPayload.budgetEvidence,
  })
  if (restored.latestBudget.profile !== budget.policy.profile) {
    fail('恢复的团队预算证据与当前策略不一致')
  }
  budget = new AgentTeamBudgetTracker(restored.latestBudget.profile, restored.latestBudget)
  if (resumed && snapshot.projection.state === 'paused') {
    const recovery = await beginAgentRunRecoveryV1({
      scope: input.scope,
      runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: now(),
    })
    snapshot = await completeAgentRunRecoveryV1({
      scope: input.scope,
      runId: snapshot.run.id,
      checkpointHash: recovery.checkpointHash,
      expectedLastSequence: recovery.snapshot.projection.lastSequence,
      now: now(),
    })
    await notify(input.onDurableBoundary, 'recovery.completed', snapshot)
  } else if (resumed && snapshot.projection.state === 'running') {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope,
      runId: snapshot.run.id,
      type: 'run.paused',
      payload: { reason: 'host_interrupted', recoverable: true },
      expectedLastSequence: snapshot.projection.lastSequence,
      now: now(),
    })
    await notify(input.onDurableBoundary, 'run.paused', snapshot)
    const recovery = await beginAgentRunRecoveryV1({
      scope: input.scope,
      runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: now(),
    })
    snapshot = await completeAgentRunRecoveryV1({
      scope: input.scope,
      runId: snapshot.run.id,
      checkpointHash: recovery.checkpointHash,
      expectedLastSequence: recovery.snapshot.projection.lastSequence,
      now: now(),
    })
    await notify(input.onDurableBoundary, 'recovery.completed', snapshot)
  } else if (resumed && snapshot.projection.state === 'recovering') {
    const recovery = await beginAgentRunRecoveryV1({
      scope: input.scope,
      runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: now(),
    })
    snapshot = await completeAgentRunRecoveryV1({
      scope: input.scope,
      runId: snapshot.run.id,
      checkpointHash: recovery.checkpointHash,
      expectedLastSequence: recovery.snapshot.projection.lastSequence,
      now: now(),
    })
    await notify(input.onDurableBoundary, 'recovery.completed', snapshot)
  } else if (snapshot.projection.state !== 'running') {
    fail(`主 Agent durable run 当前状态 ${snapshot.projection.state} 不能继续执行`)
  }

  if (restored.candidates.length === plan.tasks.length) {
    snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
    return {
      runId: snapshot.run.id,
      resumed,
      plan,
      candidates: restored.candidates,
      budgetEvidence: restored.latestBudget,
      projection: snapshot.projection,
    }
  }

  const liveCandidates = new Map<string, MasterAgentDurableCandidateV1>()
  let activeTask: MasterAgentTask | null = null
  let previousBudget = restored.latestBudget
  const trace: MasterAgentExecutionTrace = {
    async taskStarted(task) {
      activeTask = task
      const stepId = taskStepId(task.id)
      let step = snapshot.projection.steps[stepId]
      if (!step) fail(`主 Agent durable run 缺少步骤 ${stepId}`)
      if (step.status === 'awaiting_confirmation' || step.status === 'succeeded') {
        fail(`主 Agent durable run 步骤 ${stepId} 已有候选或已完成，不得重复调用`)
      }
      if (step.status === 'running') {
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'step.failed',
          payload: { stepId, attempt: step.attempt, code: 'host_interrupted', retryable: true },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
        await notify(input.onDurableBoundary, 'step.failed', snapshot)
        step = snapshot.projection.steps[stepId]
      }
      const attempt = step.status === 'scheduled' ? 1 : step.attempt + 1
      if (attempt > snapshot.contract.budget.maxAttemptsPerStep) {
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'budget.exhausted',
          payload: { resource: 'attempts' },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
        await notify(input.onDurableBoundary, 'budget.exhausted', snapshot)
        fail(`主 Agent durable run 步骤 ${stepId} 的恢复次数已耗尽`)
      }
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: snapshot.run.id,
        type: 'step.started',
        payload: { stepId, attempt },
        expectedLastSequence: snapshot.projection.lastSequence,
        now: now(),
      })
      await notify(input.onDurableBoundary, 'step.started', snapshot)
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: snapshot.run.id,
        type: 'model.requested',
        payload: {
          stepId,
          attempt,
          bindingHash: await hashCanonicalValue({
            plan,
            task,
            runId: snapshot.run.id,
            contractHash: snapshot.run.contractHash,
          }),
        },
        expectedLastSequence: snapshot.projection.lastSequence,
        now: now(),
      })
      await notify(input.onDurableBoundary, 'model.requested', snapshot)
    },
    async candidateReady(task, candidate) {
      const stepId = taskStepId(task.id)
      if (activeTask?.id !== task.id) fail(`主 Agent durable trace 收到乱序候选 ${task.id}`)
      if (candidate.payload.taskId !== task.id || candidate.payload.agentId !== task.agentId) {
        fail(`主 Agent durable trace 候选身份与当前任务 ${task.id} 不一致`)
      }
      const payload: MasterCandidatePayload = {
        ...candidate.payload,
        taskId: task.id,
        agentId: task.agentId,
        dependsOnTaskIds: [...task.dependsOn],
        workspaceScope: input.scope,
        runId: snapshot.run.id,
        runStepId: stepId,
        teamBudgetEvidence: candidate.payload.teamBudgetEvidence ?? budget.snapshot(),
        candidateHash: undefined,
      }
      const draft = candidate.draft
      if (!draft || draft.length > MAX_CANDIDATE_CHARS) fail(`主 Agent 任务 ${task.id} 候选长度无效`)
      const evidence = budgetEvidence(payload.teamBudgetEvidence, `主 Agent 任务 ${task.id} teamBudgetEvidence`)
      if (!budgetAtLeast(evidence, previousBudget)) fail(`主 Agent 任务 ${task.id} 团队预算证据倒退`)
      payload.candidateHash = await computeCandidateHash(payload, draft)
      const outputHash = await hashCanonicalValue(candidate.runtimeOutput)
      const persisted = await db.transaction(
        'rw',
        scopeTransactionTables(db.agentConversations, db.agentEvents, db.agentRuns, db.agentRunEvents),
        async () => {
          const event = await appendAgentEvent({
            projectId: input.scope.projectId,
            conversationId: snapshot.run.conversationId!,
            kind: 'candidate',
            content: draft,
            payload,
            scope: input.scope,
          })
          let nextSnapshot = await appendAgentRunEventV1({
            scope: input.scope,
            runId: snapshot.run.id,
            type: 'model.responded',
            payload: { stepId, attempt: snapshot.projection.steps[stepId].attempt, outputHash },
            expectedLastSequence: snapshot.projection.lastSequence,
            now: now(),
          })
          const prior = previousBudget
          nextSnapshot = await appendAgentRunEventV1({
            scope: input.scope,
            runId: snapshot.run.id,
            type: 'budget.settled',
            payload: {
              stepId,
              modelCalls: evidence.calls - prior.calls,
              toolCalls: 0,
              tokens: evidence.usedTokens - prior.usedTokens,
            },
            expectedLastSequence: nextSnapshot.projection.lastSequence,
            now: now(),
          })
          nextSnapshot = await appendAgentRunEventV1({
            scope: input.scope,
            runId: snapshot.run.id,
            type: 'candidate.persisted',
            payload: {
              stepId,
              attempt: nextSnapshot.projection.steps[stepId].attempt,
              candidateHash: payload.candidateHash!,
              requiresConfirmation: true,
            },
            expectedLastSequence: nextSnapshot.projection.lastSequence,
            now: now(),
          })
          return { event, snapshot: nextSnapshot }
        },
      )
      snapshot = persisted.snapshot
      previousBudget = evidence
      const durableCandidate: MasterAgentDurableCandidateV1 = {
        event: persisted.event,
        payload,
        draft,
        runtime: candidate,
      }
      liveCandidates.set(task.id, durableCandidate)
      activeTask = null
      await notify(input.onDurableBoundary, 'candidate.persisted', snapshot)
    },
  }

  try {
    await execute({
      projectId: input.scope.projectId,
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      plan,
      budget,
      signal: input.signal,
      completedTaskOutputs: restored.outputs,
      executionTrace: trace,
      onTask: input.onTask,
    })
  } catch (error) {
    const latest = await readAgentRunV1(input.scope, snapshot.run.id)
    snapshot = latest
    const failedTask = activeTask as MasterAgentTask | null
    if (input.signal?.aborted) {
      if (failedTask && snapshot.projection.steps[taskStepId(failedTask.id)]?.status === 'running') {
        const stepId = taskStepId(failedTask.id)
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'step.failed',
          payload: {
            stepId,
            attempt: snapshot.projection.steps[stepId].attempt,
            code: 'host_interrupted',
            retryable: true,
          },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
      }
      if (['running', 'awaiting_confirmation'].includes(snapshot.projection.state)) {
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'run.cancelled',
          payload: { reason: 'master_agent_aborted' },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
      }
    } else if (failureResource(error)) {
      if (['running', 'verifying'].includes(snapshot.projection.state)) {
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'budget.exhausted',
          payload: { resource: failureResource(error)! },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
      }
    } else if (['running', 'awaiting_confirmation'].includes(snapshot.projection.state)) {
      if (failedTask && snapshot.projection.steps[taskStepId(failedTask.id)]?.status === 'running') {
        const stepId = taskStepId(failedTask.id)
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'step.failed',
          payload: {
            stepId,
            attempt: snapshot.projection.steps[stepId].attempt,
            code: 'master_agent_execution_failed',
            retryable: true,
          },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
      }
      if (['running', 'awaiting_confirmation'].includes(snapshot.projection.state)) {
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'run.paused',
          payload: { reason: 'master_agent_execution_failed', recoverable: true },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
      }
    }
    throw error
  }

  snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
  const latestCandidates = await readPersistedCandidates({
    scope: input.scope,
    snapshot,
    plan,
    checkpointBudget: (parsePlanCheckpoint((await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id))!.resumePayload)).budgetEvidence,
  })
  const candidates = latestCandidates.candidates.map(candidate => ({
    ...candidate,
    runtime: liveCandidates.get(candidate.payload.taskId)?.runtime,
  }))
  return {
    runId: snapshot.run.id,
    resumed,
    plan,
    candidates,
    budgetEvidence: latestCandidates.latestBudget,
    projection: snapshot.projection,
  }
}

/** Reads a master run and its candidates without executing any remaining task. */
export async function restoreMasterAgentCandidatesV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<RestoredMasterAgentCandidatesV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const latest = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
  if (!latest) fail('主 Agent durable run 缺少计划检查点')
  const checkpoint = parsePlanCheckpoint(latest.resumePayload)
  const expectedPlanHash = await hashMasterAgentPlanV1(checkpoint.plan)
  if (expectedPlanHash !== checkpoint.planHash) fail('主 Agent 计划检查点 planHash 校验失败')
  const restored = await readPersistedCandidates({
    scope: input.scope,
    snapshot,
    plan: checkpoint.plan,
    checkpointBudget: checkpoint.budgetEvidence,
  })
  return {
    snapshot,
    plan: checkpoint.plan,
    candidates: restored.candidates,
    outputs: restored.outputs,
    budgetEvidence: restored.latestBudget,
  }
}
