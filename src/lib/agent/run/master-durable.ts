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
  type ExecutedMasterCandidate,
  type MasterAgentExecutionTrace,
  type MasterAgentPlan,
  type MasterAgentTask,
  type MasterCandidateDependencyBindingV1,
  type MasterCandidatePayload,
} from '../orchestrator'
import type { AgentTeamBudgetEvidence } from '../team-budget'
import {
  getAgentSkillV1,
  resolveAgentSkillV1,
  validateAgentSkillContextEvidenceV1,
  resolveAgentSkillContextSourceKeysV1,
  type AgentSkillId,
  type DomainAgentId,
} from '../skill-registry'
import {
  assertAgentSkillExecutionBindingV1,
  createAgentSkillExecutionBindingV1,
} from '../execution-binding'
import {
  assertMasterWorkflowTaskCompatibilityV1,
  getMasterWorkflowV1,
  isMasterAgentRunWorkflowKindV1,
  parseMasterWorkflowSelectionV1,
} from '../workflow-catalog'
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
import { assertRecordInScope, readOwnedRows, scopeTransactionTables } from '../../world-engine/scope'

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

function dependencyBindings(
  value: unknown,
  label: string,
): MasterCandidateDependencyBindingV1[] {
  if (!Array.isArray(value)) fail(`${label} 必须是数组`)
  return value.map((item, index) => {
    if (!isRecord(item)) fail(`${label}[${index}] 无效`)
    assertKeysWithOptional(
      item,
      ['taskId', 'outputHash'],
      ['candidateHash', 'generation'],
      `${label}[${index}]`,
    )
    const candidateHash = item.candidateHash === undefined
      ? undefined
      : readHash(item.candidateHash, `${label}[${index}].candidateHash`)
    const generation = item.generation === undefined
      ? undefined
      : readInteger(item.generation, `${label}[${index}].generation`)
    if (generation !== undefined && generation < 1) fail(`${label}[${index}].generation 无效`)
    return {
      taskId: readString(item.taskId, `${label}[${index}].taskId`, MAX_TASK_ID_CHARS),
      outputHash: readHash(item.outputHash, `${label}[${index}].outputHash`),
      ...(candidateHash ? { candidateHash } : {}),
      ...(generation === undefined ? {} : { generation }),
    }
  })
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

function assertKeysWithOptional(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  const actual = Object.keys(value)
  if (
    required.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || actual.some(key => !allowed.has(key))
  ) {
    fail(label + ' 字段不符合严格契约')
  }
}

function readOptionalPerspectiveCharacterId(
  value: Record<string, unknown>,
  label: string,
): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, 'perspectiveCharacterId')) return undefined
  if (value.perspectiveCharacterId === null) return null
  if (!Number.isInteger(value.perspectiveCharacterId) || Number(value.perspectiveCharacterId) < 1) {
    fail(label + '.perspectiveCharacterId 无效')
  }
  return Number(value.perspectiveCharacterId)
}

function readOptionalSkillId(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  label: string,
): AgentSkillId | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, 'skillId')) return undefined
  if (typeof value.skillId !== 'string') fail(label + '.skillId 无效')
  return getAgentSkillV1(value.skillId, agentId).id as AgentSkillId
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
  assertKeysWithOptional(value, ['summary', 'tasks'], ['workflow'], '主 Agent 计划')
  const summary = readString(value.summary, '主 Agent 计划 summary', MAX_PLAN_SUMMARY_CHARS)
  if (!Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > MAX_PLAN_TASKS) {
    fail(`主 Agent 计划任务数必须在 1-${MAX_PLAN_TASKS} 之间`)
  }
  const ids = new Set<string>()
  const tasks: MasterAgentTask[] = value.tasks.map((item, index) => {
    if (!isRecord(item)) fail(`主 Agent 计划任务 ${index + 1} 无效`)
    assertKeysWithOptional(
      item,
      ['id', 'agentId', 'instruction', 'dependsOn'],
      ['perspectiveCharacterId', 'skillId'],
      '主 Agent 计划任务 ' + (index + 1),
    )
    const id = readString(item.id, `主 Agent 计划任务 ${index + 1}.id`, MAX_TASK_ID_CHARS)
    if (ids.has(id)) fail(`主 Agent 计划包含重复任务 ID ${id}`)
    ids.add(id)
    if (!DOMAIN_AGENT_IDS.includes(item.agentId as DomainAgentId)) {
      fail(`主 Agent 计划包含未知领域 ${String(item.agentId)}`)
    }
    const agentId = item.agentId as DomainAgentId
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
    const perspectiveCharacterId = readOptionalPerspectiveCharacterId(item, '主 Agent 计划任务 ' + id)
    const skillId = readOptionalSkillId(item, agentId, '主 Agent 计划任务 ' + id)
    return {
      id,
      agentId,
      ...(skillId !== undefined ? { skillId } : {}),
      instruction,
      dependsOn,
      ...(perspectiveCharacterId !== undefined ? { perspectiveCharacterId } : {}),
    }
  })
  const workflow = value.workflow === undefined
    ? undefined
    : parseMasterWorkflowSelectionV1(value.workflow)
  const result: MasterAgentPlan = {
    summary,
    tasks,
    ...(workflow ? { workflow } : {}),
  }
  const known = new Set(tasks.map(task => task.id))
  tasks.forEach(task => task.dependsOn.forEach(dep => {
    if (!known.has(dep)) fail(`主 Agent 计划任务 ${task.id} 依赖不存在的任务 ${dep}`)
  }))
  assertAcyclic(result)
  if (workflow) assertMasterWorkflowTaskCompatibilityV1(workflow, tasks)
  return result
}

export async function hashMasterAgentPlanV1(plan: MasterAgentPlan): Promise<string> {
  return hashCanonicalValue(parseMasterAgentPlanV1(plan))
}

function sourceKeysForPlan(plan: MasterAgentPlan): string[] {
  return [...new Set(plan.tasks.flatMap(task => {
    const skill = resolveAgentSkillV1(task.agentId, task.skillId)
    return resolveAgentSkillContextSourceKeysV1(skill, {
      includeOptional: task.agentId === 'prose' && task.perspectiveCharacterId != null,
    })
  }))]
}

function writeTargetsForPlan(plan: MasterAgentPlan): Array<{
  table: string
  fields: string[]
  mode: 'author-confirmed'
  adoptionExtension?: string
}> {
  const byTable = new Map<string, { fields: Set<string>; adoptionExtension?: string }>()
  plan.tasks.forEach(task => {
    const skill = resolveAgentSkillV1(task.agentId, task.skillId)
    skill.writeTargets.forEach(target => {
      const existing = byTable.get(target.table) ?? { fields: new Set<string>() }
      target.fields.forEach(field => existing.fields.add(field))
      if (target.adoptionExtension && existing.adoptionExtension && target.adoptionExtension !== existing.adoptionExtension) {
        throw new Error(`主 Agent 计划对 ${target.table} 声明了冲突的采纳扩展。`)
      }
      if (target.adoptionExtension) existing.adoptionExtension = target.adoptionExtension
      byTable.set(target.table, existing)
    })
  })
  return [...byTable.entries()].map(([table, target]) => ({
    table,
    fields: [...target.fields],
    mode: 'author-confirmed' as const,
    ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}),
  }))
}

export function buildMasterAgentRunContractV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  plan: MasterAgentPlan
  budgetEvidence: AgentTeamBudgetEvidence
  includeExecutionBindings?: boolean
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
    workflowKind: plan.workflow
      ? getMasterWorkflowV1(plan.workflow).runContractWorkflowKind
      : 'multi-domain-sequential' as const,
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
    },
    permissions: {
      contextSourceKeys: sourceKeysForPlan(plan),
      writeTargets: writeTargetsForPlan(plan),
    },
    ...(input.includeExecutionBindings === false ? {} : {
      executionBindings: plan.tasks.map(task => ({
        stepId: taskStepId(task.id),
        ...createAgentSkillExecutionBindingV1(resolveAgentSkillV1(task.agentId, task.skillId)),
      })),
    }),
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
  if (payload.skillId !== undefined) getAgentSkillV1(payload.skillId, payload.agentId)
  if (payload.executionBinding !== undefined) {
    assertAgentSkillExecutionBindingV1(
      payload.executionBinding,
      resolveAgentSkillV1(payload.agentId, payload.skillId),
      `${label} executionBinding`,
    )
  }
  if (!Array.isArray(payload.contextSources) || payload.contextSources.some(source => typeof source !== 'string')) {
    fail(`${label} payload contextSources 无效`)
  }
  if (payload.contextEvidence) {
    const skill = resolveAgentSkillV1(payload.agentId, payload.skillId)
    validateAgentSkillContextEvidenceV1(skill, payload.contextEvidence)
    if (
      payload.contextSources.length !== payload.contextEvidence.included.length
      || payload.contextSources.some((source, index) => source !== payload.contextEvidence!.included[index])
    ) fail(`${label} payload contextSources 与上下文证据不一致`)
  }
  if (typeof payload.runId !== 'number' || !Number.isInteger(payload.runId) || payload.runId < 1) fail(`${label} payload runId 无效`)
  if (
    payload.runGeneration !== undefined
    && (!Number.isInteger(payload.runGeneration) || payload.runGeneration < 1)
  ) fail(`${label} payload runGeneration 无效`)
  if (payload.runStepId !== taskStepId(payload.taskId)) fail(`${label} payload runStepId 不匹配`)
  readHash(payload.candidateHash, `${label} payload candidateHash`)
  if (payload.dependencyBindings !== undefined) {
    payload.dependencyBindings = dependencyBindings(
      payload.dependencyBindings,
      `${label} payload dependencyBindings`,
    )
  }
  if ((payload.runGeneration === undefined) !== (payload.dependencyBindings === undefined)) {
    fail(`${label} payload 必须同时携带 runGeneration 和 dependencyBindings`)
  }
  if (
    payload.perspectiveCharacterId !== undefined
    && payload.perspectiveCharacterId !== null
    && (!Number.isInteger(payload.perspectiveCharacterId) || payload.perspectiveCharacterId < 1)
  ) {
    fail(label + ' perspectiveCharacterId 无效')
  }
  budgetEvidence(payload.teamBudgetEvidence, `${label} payload teamBudgetEvidence`)
  return payload
}

function assertCandidateMatchesTaskSkill(
  task: MasterAgentTask,
  payload: MasterCandidatePayload,
  label: string,
): void {
  const taskSkill = resolveAgentSkillV1(task.agentId, task.skillId)
  const candidateSkill = resolveAgentSkillV1(payload.agentId, payload.skillId)
  if (candidateSkill.id !== taskSkill.id) fail(`${label} 的 Skill 与计划不一致`)
  if (payload.executionBinding !== undefined) {
    assertAgentSkillExecutionBindingV1(payload.executionBinding, taskSkill, `${label} executionBinding`)
  }
  if (
    task.agentId === 'outline'
    && (taskSkill.executionMode === 'volumes' || taskSkill.executionMode === 'chapters')
    && payload.outlineMode !== taskSkill.executionMode
  ) fail(`${label} 的大纲模式与 Skill 不一致`)
  if (
    task.agentId === 'prose'
    && (taskSkill.executionMode === 'generate' || taskSkill.executionMode === 'continue')
    && payload.proseOperation !== taskSkill.executionMode
  ) fail(`${label} 的正文操作与 Skill 不一致`)
}

export function assertMasterAgentRunContractExecutionBindingsV1(
  contract: AgentRunSnapshotV1['contract'],
  plan: MasterAgentPlan,
): void {
  if (contract.executionBindings === undefined) return
  if (contract.executionBindings.length !== plan.tasks.length) {
    fail('主 Agent RunContract executionBindings 数量与计划不一致')
  }
  const byStep = new Map(contract.executionBindings.map(binding => [binding.stepId, binding]))
  for (const task of plan.tasks) {
    const stepId = taskStepId(task.id)
    const binding = byStep.get(stepId)
    if (!binding) fail(`主 Agent RunContract 缺少 ${stepId} execution binding`)
    const { stepId: _stepId, ...skillBinding } = binding
    assertAgentSkillExecutionBindingV1(
      skillBinding,
      resolveAgentSkillV1(task.agentId, task.skillId),
      `主 Agent RunContract ${stepId}`,
    )
  }
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
    assertCandidateMatchesTaskSkill(task, payload, `候选事件 ${event.id}`)
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
  const candidateByTask = new Map(candidates.map(candidate => [candidate.payload.taskId, candidate]))
  for (const candidate of candidates) {
    const task = taskById.get(candidate.payload.taskId)!
    const bindings = candidate.payload.dependencyBindings
    if (bindings === undefined) continue
    if (candidate.payload.runGeneration !== input.snapshot.projection.generation) {
      fail(`候选事件 ${candidate.event.id} 不属于当前 Run generation`)
    }
    if (
      bindings.length !== task.dependsOn.length
      || bindings.some((binding, index) => binding.taskId !== task.dependsOn[index])
    ) fail(`候选事件 ${candidate.event.id} 的冻结依赖清单与计划不一致`)
    for (const binding of bindings) {
      const upstream = candidateByTask.get(binding.taskId)
      if (!upstream || (upstream.event.sequence ?? 0) >= (candidate.event.sequence ?? 0)) {
        fail(`候选事件 ${candidate.event.id} 缺少先行依赖 ${binding.taskId}`)
      }
      if (
        upstream.payload.runId !== candidate.payload.runId
        || (upstream.payload.runGeneration ?? candidate.payload.runGeneration) !== binding.generation
      ) fail(`候选事件 ${candidate.event.id} 的依赖 ${binding.taskId} 跨 Run、跨代或版本不匹配`)
      const upstreamStepId = taskStepId(binding.taskId)
      const historicalVersionExists = input.snapshot.events.some(event => (
        event.generation === binding.generation
        && (
          (event.type === 'candidate.persisted'
            && event.payload.stepId === upstreamStepId
            && event.payload.candidateHash === binding.candidateHash)
          || (event.type === 'candidate.revised'
            && event.payload.stepId === upstreamStepId
            && event.payload.candidateHash === binding.candidateHash)
        )
      ))
      if (!historicalVersionExists) {
        fail(`候选事件 ${candidate.event.id} 的依赖 ${binding.taskId} 从未存在于当前 Run generation`)
      }
    }
  }
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
      includeExecutionBindings: snapshot.contract.executionBindings !== undefined,
    }))
    if (snapshot.run.contractHash !== contract.contractHash) fail('主 Agent durable run 契约已变化')
    budget = new AgentTeamBudgetTracker(checkpointPayload.budgetEvidence.profile, checkpointPayload.budgetEvidence)
  }

  assertMasterAgentRunContractExecutionBindingsV1(snapshot.contract, plan)

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
  const activeTasks = new Map<string, MasterAgentTask>()
  let previousBudget = restored.latestBudget
  const trace: MasterAgentExecutionTrace = {
    async taskStarted(task) {
      activeTasks.set(task.id, task)
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
      if (!activeTasks.has(task.id)) fail(`主 Agent durable trace 收到未启动候选 ${task.id}`)
      if (candidate.payload.taskId !== task.id || candidate.payload.agentId !== task.agentId) {
        fail(`主 Agent durable trace 候选身份与当前任务 ${task.id} 不一致`)
      }
      assertCandidateMatchesTaskSkill(task, candidate.payload, `主 Agent durable trace 候选 ${task.id}`)
      if (candidate.payload.contextEvidence) {
        const skill = resolveAgentSkillV1(task.agentId, task.skillId)
        validateAgentSkillContextEvidenceV1(skill, candidate.payload.contextEvidence)
        if (
          candidate.payload.contextSources.length !== candidate.payload.contextEvidence.included.length
          || candidate.payload.contextSources.some((source, index) => (
            source !== candidate.payload.contextEvidence!.included[index]
          ))
        ) fail(`主 Agent durable trace 候选 ${task.id} 的上下文来源与证据不一致`)
      }
      const allowedSources = new Set(snapshot.contract.permissions.contextSourceKeys)
      if (candidate.payload.contextSources.some(source => !allowedSources.has(source))) {
        fail(`主 Agent durable trace 候选 ${task.id} 使用了契约未授权的上下文源`)
      }
      if (
        task.agentId === 'prose'
        && (candidate.payload.perspectiveCharacterId ?? null) !== (task.perspectiveCharacterId ?? null)
      ) {
        fail(`主 Agent durable trace 候选视角与当前任务 ${task.id} 不一致`)
      }
      const {
        executionBinding: candidateExecutionBinding,
        dependencyBindings: _candidateDependencyBindings,
        runGeneration: _candidateRunGeneration,
        ...candidatePayload
      } = candidate.payload
      const frozenDependencies = await Promise.all(task.dependsOn.map(async dependencyTaskId => {
        const upstream = liveCandidates.get(dependencyTaskId)
          ?? restored.candidates.find(item => item.payload.taskId === dependencyTaskId)
        if (!upstream?.payload.candidateHash) {
          fail(`主 Agent durable trace 缺少依赖候选 ${dependencyTaskId}`)
        }
        return {
          taskId: dependencyTaskId,
          candidateHash: upstream.payload.candidateHash,
          outputHash: await hashCanonicalValue(upstream.draft),
          generation: snapshot.projection.generation,
        }
      }))
      const payload: MasterCandidatePayload = {
        ...candidatePayload,
        taskId: task.id,
        agentId: task.agentId,
        dependsOnTaskIds: [...task.dependsOn],
        workspaceScope: input.scope,
        runId: snapshot.run.id,
        runGeneration: snapshot.projection.generation,
        runStepId: stepId,
        dependencyBindings: frozenDependencies,
        teamBudgetEvidence: candidate.payload.teamBudgetEvidence ?? budget.snapshot(),
        ...(snapshot.contract.executionBindings === undefined ? {} : {
          executionBinding: candidateExecutionBinding
            ?? createAgentSkillExecutionBindingV1(resolveAgentSkillV1(task.agentId, task.skillId)),
        }),
        candidateHash: undefined,
      }
      const draft = candidate.draft
      if (!draft || draft.length > MAX_CANDIDATE_CHARS) fail(`主 Agent 任务 ${task.id} 候选长度无效`)
      const evidence = budgetEvidence(payload.teamBudgetEvidence, `主 Agent 任务 ${task.id} teamBudgetEvidence`)
      if (!budgetAtLeast(evidence, previousBudget)) fail(`主 Agent 任务 ${task.id} 团队预算证据倒退`)
      payload.candidateHash = await computeCandidateHash(payload, draft)
      const outputHash = await hashCanonicalValue(candidate.runtimeOutput)
      const contextManifestHash = payload.contextEvidence
        ? await hashCanonicalValue({
            version: 1,
            runId: snapshot.run.id,
            stepId,
            attempt: snapshot.projection.steps[stepId].attempt,
            contextSources: payload.contextSources,
            contextEvidence: payload.contextEvidence,
          })
        : null
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
          let nextSnapshot = snapshot
          if (payload.contextEvidence) {
            nextSnapshot = await appendAgentRunEventV1({
              scope: input.scope,
              runId: snapshot.run.id,
              type: 'context.assembled',
              payload: {
                stepId,
                attempt: snapshot.projection.steps[stepId].attempt,
                manifestHash: contextManifestHash!,
              },
              expectedLastSequence: nextSnapshot.projection.lastSequence,
              now: now(),
            })
          }
          nextSnapshot = await appendAgentRunEventV1({
            scope: input.scope,
            runId: snapshot.run.id,
            type: 'model.responded',
            payload: { stepId, attempt: nextSnapshot.projection.steps[stepId].attempt, outputHash },
            expectedLastSequence: nextSnapshot.projection.lastSequence,
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
      activeTasks.delete(task.id)
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
    const failedTasks = [...activeTasks.values()]
    if (input.signal?.aborted) {
      for (const failedTask of failedTasks) {
        const stepId = taskStepId(failedTask.id)
        if (snapshot.projection.steps[stepId]?.status !== 'running') continue
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
      for (const failedTask of failedTasks) {
        const stepId = taskStepId(failedTask.id)
        if (snapshot.projection.steps[stepId]?.status !== 'running') continue
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

export async function findResumableMasterAgentRunV1(input: {
  scope: WorkspaceScope
  conversationId: number
}): Promise<number | null> {
  const runs = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(run => run.id != null && run.conversationId === input.conversationId)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  for (const run of runs) {
    try {
      const snapshot = await readAgentRunV1(input.scope, run.id)
      if (!isMasterAgentRunWorkflowKindV1(snapshot.contract.workflowKind)) continue
      if (!['paused', 'running'].includes(snapshot.projection.state)) continue
      if (Object.values(snapshot.projection.steps).some(step => (
        step.status === 'scheduled' || step.status === 'running' || step.status === 'failed'
      ))) return run.id
    } catch {
      // A corrupted run must remain visible to ledger diagnostics, never auto-run.
    }
  }
  return null
}
