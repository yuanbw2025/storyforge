import JSON5 from 'json5'
import { useAIConfigStore } from '../../stores/ai-config'
import { AGENT_ROLE_CATEGORIES } from '../ai/task-routing'
import { useChapterStore } from '../../stores/chapter'
import { useCharacterStore } from '../../stores/character'
import { useInspirationWorkspaceStore } from '../../stores/inspiration-workspace'
import { useOutlineStore } from '../../stores/outline'
import { useWorldviewStore } from '../../stores/worldview'
import { chat, resolveRequestConfig } from '../ai/client'
import { db } from '../db/schema'
import {
  adoptGenerationNodeOutput,
  type GenerationNode,
} from '../generation/generation-node'
import {
  parseInspirationFragments,
  MAX_INSPIRATION_FRAGMENTS,
} from '../inspiration/workspace'
import { adopt } from '../registry/adopt'
import {
  parseAgentEventPayload,
  type AgentEvent,
  type InspirationResultMode,
  type WorkspaceScope,
} from '../types'
import {
  parseCharacterCandidateDraft,
  prepareCharacterCopilot,
  type CharacterCopilotCandidate,
  type CharacterRosterSnapshot,
} from './character-copilot'
import {
  parseInspirationCandidateDraft,
  prepareInspirationCopilot,
  type InspirationCopilotResult,
  type InspirationWorkspaceSnapshot,
} from './inspiration-copilot'
import {
  adoptRestoredOutlineCandidate,
  parseOutlineCandidateDraft,
  prepareOutlineCopilot,
  type OutlineCopilotMode,
  type OutlineCopilotSnapshot,
} from './outline-copilot'
import {
  adoptRestoredProseCandidate,
  parseProseCandidateDraft,
  prepareProseCopilot,
  type ProseCopilotOperation,
  type ProseCopilotSnapshot,
} from './prose-copilot'
import {
  prepareWorldOriginCopilot,
  type WorldOriginSnapshot,
} from './world-origin-copilot'
import type {
  AgentContextEvidence,
} from './context-policy'
import type { AgentSkillExecutionBindingV1 } from '../types/agent-run'
import { executeAgentTool } from './tool-registry'
import { validateDomainCandidateCanon } from './canon-validator'
import { runBudgetedGenerationNode } from './team-execution'
import {
  AgentTeamBudgetExceededError,
  AgentTeamBudgetTracker,
  type AgentTeamBudgetEvidence,
} from './team-budget'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScope,
} from '../world-engine/scope'
import {
  DOMAIN_AGENT_IDS,
  resolveAgentSkillV1,
  type AgentSkillId,
  type DomainAgentId,
} from './skill-registry'
import {
  classifyRequestedDomainIdsV1,
  getMasterWorkflowV1,
  hasMasterFanOutPairV1,
  isMasterFanOutEnabledV1,
  selectMasterFanOutBatchV1,
  selectAgentSkillIdV1,
  selectMasterWorkflowV1,
  type MasterWorkflowSelectionV1,
} from './workflow-catalog'
import { createAgentSkillExecutionBindingV1 } from './execution-binding'
import { hashCanonicalValue } from './run/hash'
import { readAgentRunV1 } from './run/event-store'
import type {
  MasterCandidateModelIdentityV1,
  MasterCandidateSemanticReviewArtifactV1,
} from './master-candidate-semantic-review'

export { DOMAIN_AGENT_IDS }
export type { DomainAgentId }

export interface MasterAgentTask {
  id: string
  agentId: DomainAgentId
  /** 新计划冻结具体 Skill；旧 durable 计划缺省时回退到该 Agent 的默认 Skill。 */
  skillId?: AgentSkillId
  instruction: string
  dependsOn: string[]
  /** 正文领域的显式叙事视角；缺省时正文不注入角色认知。 */
  perspectiveCharacterId?: number | null
}

export interface MasterAgentPlan {
  summary: string
  tasks: MasterAgentTask[]
  /** 旧 durable 计划没有该字段，恢复时保持原始 plan hash 与顺序工作流语义。 */
  workflow?: MasterWorkflowSelectionV1
}

export interface MasterCandidateDependencyBindingV1 {
  taskId: string
  outputHash: string
  /** Present on durable candidates; binds the exact upstream author-editable candidate. */
  candidateHash?: string
  /** Present on durable candidates; prevents a revised contract generation from joining old output. */
  generation?: number
  /** Present when the RunContract requires a fresh deterministic upstream receipt. */
  verificationReceiptHash?: string
}

export interface MasterCandidatePayload {
  version: 1
  taskId: string
  agentId: DomainAgentId
  skillId?: AgentSkillId
  /** Absent on candidates created before HARNESS-18. */
  executionBinding?: AgentSkillExecutionBindingV1
  label: string
  contextSources: string[]
  contextEvidence?: AgentContextEvidence
  teamBudgetEvidence?: AgentTeamBudgetEvidence
  baseSnapshot: unknown
  mode?: InspirationResultMode
  selectedFragmentIds?: string[]
  outlineMode?: OutlineCopilotMode
  outlineParentId?: number | null
  proseOperation?: ProseCopilotOperation
  proseOutlineNodeId?: number
  dependsOnTaskIds?: string[]
  /** Absent on candidates created before HARNESS-22. */
  dependencyBindings?: MasterCandidateDependencyBindingV1[]
  workspaceScope?: WorkspaceScope
  runId?: number
  /** Absent on candidates created before HARNESS-22. */
  runGeneration?: number
  runStepId?: string
  candidateHash?: string
  perspectiveCharacterId?: number | null
  /** Present on candidates covered by independent semantic review. */
  generator?: MasterCandidateModelIdentityV1
  semanticReview?: MasterCandidateSemanticReviewArtifactV1
}

export interface ExecutedMasterCandidate {
  payload: MasterCandidatePayload
  draft: string
  runtimeNode: GenerationNode<any, any, any>
  runtimeOutput: unknown
}

export interface MasterAgentExecutionTrace {
  taskStarted?: (task: MasterAgentTask) => Promise<void>
  candidateReady?: (task: MasterAgentTask, candidate: ExecutedMasterCandidate) => Promise<void>
}

interface PlannerDependencies {
  complete?: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<string>
}

export interface MasterAgentReplanFailureV1 {
  taskId: string
  code: string
  category: string
  fingerprint: string
}

function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('主 Agent 没有返回任务计划 JSON。')
  const parsed = JSON5.parse(fenced.slice(start, end + 1)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('主 Agent 任务计划必须是对象。')
  }
  return parsed as Record<string, unknown>
}

function fallbackPlan(
  request: string,
  workflow = selectMasterWorkflowV1(request),
): MasterAgentPlan {
  const tasks: MasterAgentTask[] = []
  const requested = classifyRequestedDomainIdsV1(request)
  const hasWorld = requested.has('world-origin')
  const hasCharacter = requested.has('character')
  const hasInspiration = requested.has('inspiration')
  const hasOutline = requested.has('outline')
  const hasProse = requested.has('prose')
  if (hasWorld) tasks.push({
    id: 'world-1',
    agentId: 'world-origin',
    skillId: selectAgentSkillIdV1('world-origin', request),
    instruction: request,
    dependsOn: [],
  })
  if (hasInspiration) tasks.push({
    id: 'inspiration-1',
    agentId: 'inspiration',
    skillId: selectAgentSkillIdV1('inspiration', request),
    instruction: request,
    dependsOn: [],
  })
  if (hasCharacter) tasks.push({
    id: 'character-1',
    agentId: 'character',
    skillId: selectAgentSkillIdV1('character', request),
    instruction: request,
    dependsOn: hasWorld ? ['world-1'] : [],
  })
  if (hasOutline) tasks.push({
    id: 'outline-1',
    agentId: 'outline',
    skillId: selectAgentSkillIdV1('outline', request),
    instruction: request,
    dependsOn: [
      ...(hasWorld ? ['world-1'] : []),
      ...(hasCharacter ? ['character-1'] : []),
    ],
  })
  if (hasProse && !hasOutline) tasks.push({
    id: 'prose-1',
    agentId: 'prose',
    skillId: selectAgentSkillIdV1('prose', request),
    instruction: request,
    dependsOn: [
      ...(hasWorld ? ['world-1'] : []),
      ...(hasCharacter ? ['character-1'] : []),
      ...(hasOutline ? ['outline-1'] : []),
    ],
  })
  if (!tasks.length) tasks.push({
    id: 'character-1',
    agentId: 'character',
    skillId: selectAgentSkillIdV1('character', request),
    instruction: request,
    dependsOn: [],
  })
  return {
    summary: hasProse && hasOutline
      ? '先生成并确认章节大纲；确认进入正式数据后，再继续生成正文。'
      : '根据用户要求调度相关创作领域。',
    tasks,
    workflow,
  }
}

function sanitizePlan(
  raw: Record<string, unknown>,
  request: string,
  workflow: MasterWorkflowSelectionV1,
): MasterAgentPlan {
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : []
  const tasks: MasterAgentTask[] = []
  const ids = new Set<string>()
  const agentIds = new Set<DomainAgentId>()
  const explicitlyRequested = classifyRequestedDomainIdsV1(request)
  for (const item of rawTasks.slice(0, 6)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    if (!DOMAIN_AGENT_IDS.includes(source.agentId as DomainAgentId)) continue
    const agentId = source.agentId as DomainAgentId
    // 模型不得把描述中出现的设定元素误当成新增数据授权。只要用户文本明确命中了至少一个
    // 已闭环领域，就只能调度这些领域；例如“用浮空城和守灯人规划卷纲”只能写大纲。
    if (explicitlyRequested.size > 0 && !explicitlyRequested.has(agentId)) continue
    // 当前每个领域节点都以一次候选快照为确认单位。同领域并列任务会共享旧快照，
    // 第一个采纳后让后续候选必然过期；批量目标必须由单个领域任务一次产出。
    if (agentIds.has(agentId)) {
      const existing = tasks.find(task => task.agentId === agentId)!
      existing.instruction = request.slice(0, 1000)
      if (Array.isArray(source.dependsOn)) {
        existing.dependsOn = [...new Set([
          ...existing.dependsOn,
          ...source.dependsOn.filter((value): value is string => typeof value === 'string'),
        ])].slice(0, 5)
      }
      continue
    }
    const id = typeof source.id === 'string' && source.id.trim()
      ? source.id.trim().slice(0, 80)
      : `task-${tasks.length + 1}`
    if (ids.has(id)) continue
    ids.add(id)
    agentIds.add(agentId)
    const instruction = typeof source.instruction === 'string' && source.instruction.trim()
      ? source.instruction.trim().slice(0, 1000)
      : request
    const perspectiveCharacterId = source.perspectiveCharacterId === null
      ? null
      : Number.isInteger(source.perspectiveCharacterId) && Number(source.perspectiveCharacterId) > 0
        ? Number(source.perspectiveCharacterId)
        : undefined
    tasks.push({
      id,
      agentId,
      skillId: selectAgentSkillIdV1(agentId, request),
      instruction,
      dependsOn: Array.isArray(source.dependsOn)
        ? source.dependsOn.filter((value): value is string => typeof value === 'string').slice(0, 5)
        : [],
      ...(agentId === 'prose' && perspectiveCharacterId !== undefined ? { perspectiveCharacterId } : {}),
    })
  }
  if (!tasks.length) return fallbackPlan(request, workflow)
  const knownIds = new Set(tasks.map(task => task.id))
  tasks.forEach(task => {
    task.dependsOn = task.dependsOn.filter(id => id !== task.id && knownIds.has(id))
  })
  if (getMasterWorkflowV1(workflow).strategy === 'fan-out') {
    // Inspiration reverse only reads the author's saved fragments. A planner may
    // invent a semantic dependency on another generated candidate, but that
    // would destroy the independently verifiable leaf boundary.
    tasks.filter(task => task.agentId === 'inspiration').forEach(task => {
      task.dependsOn = []
    })
    if (!hasMasterFanOutPairV1(tasks)) return fallbackPlan(request, workflow)
  }
  const outlineTaskIds = new Set(tasks
    .filter(task => task.agentId === 'outline')
    .map(task => task.id))
  const stagedProse = tasks.some(task => (
    task.agentId === 'prose'
    && (outlineTaskIds.size > 0 || task.dependsOn.some(id => outlineTaskIds.has(id)))
  ))
  if (stagedProse) {
    for (let index = tasks.length - 1; index >= 0; index--) {
      if (tasks[index].agentId === 'prose') tasks.splice(index, 1)
    }
  }
  return {
    summary: stagedProse
      ? '先生成并确认章节大纲；确认进入正式数据后，再继续生成正文。'
      : typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim().slice(0, 500)
      : '主 Agent 已拆分本轮创作任务。',
    tasks,
    workflow,
  }
}

export async function createMasterAgentPlan(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  request: string
  budget?: AgentTeamBudgetTracker
  signal?: AbortSignal
}, dependencies: PlannerDependencies = {}): Promise<MasterAgentPlan> {
  const request = input.request.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的创作要求。')
  const workflow = selectMasterWorkflowV1(request)
  if (getMasterWorkflowV1(workflow).planner === 'skip') {
    return fallbackPlan(request, workflow)
  }
  const config = resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: AGENT_ROLE_CATEGORIES.orchestrator },
  ).config
  const status = await executeAgentTool('read_project_status', {
    projectId: input.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    provider: config.provider,
    model: config.model,
  })
  const messages = [{
    role: 'system' as const,
    content: `你是 StoryForge 面向用户的唯一主 Agent。你不直接生成作品，也不要求用户选择领域；
你只把用户目标拆成幕后领域任务。可用领域 Agent：
- world-origin：建立或补充世界来源、时代与文明起点；
- character：设计一个新角色；
- inspiration：基于项目内已保存灵感碎片做结构化反推。
- outline：生成卷级大纲，或把当前卷纲展开为章节大纲。
- prose：为已有章纲生成空白章正文，或显式续写已有正文；不得覆盖已有手稿。
只调度用户明确要求生成或修改的领域。用户在大纲要求中提到世界元素或角色姓名，只是大纲
约束，不代表授权新建世界观或角色；不得擅自扩大写入范围。
依赖任务必须写 dependsOn。世界设定与角色同时出现时，角色应依赖世界任务。
灵感反推只读取作者已保存的灵感碎片，不得把它伪装成依赖本轮世界候选；若角色明确需要同时使用
本轮世界与灵感结果，角色应依赖这两个任务。
大纲依赖本轮新生成的世界或角色任务；正文依赖本轮新生成的大纲、世界或角色任务。只输出 JSON：
{"summary":"给用户的简短计划","tasks":[{"id":"稳定ID","agentId":"world-origin|character|inspiration|outline|prose","instruction":"给分 Agent 的完整要求","dependsOn":[]}]}。
只有用户明确指定正文叙事视角且项目状态能确认角色 ID 时，正文任务才可额外填写 perspectiveCharacterId；不要猜测，缺省则不注入角色认知。
每个领域最多一个任务；同一领域的批量目标必须合并到这个任务中一次产出。最多 5 个任务；
不要输出 Markdown。`,
  }, {
    role: 'user' as const,
    content: `【项目紧凑状态】\n${status.ok ? status.content : '状态不可用'}\n\n【用户目标】\n${request}`,
  }]
  let reservation: ReturnType<AgentTeamBudgetTracker['reserveCall']> | null = null
  let settled = false
  try {
    reservation = input.budget?.reserveCall({
      label: '主 Agent 编排',
      messages,
      maxOutputTokens: 1_800,
    }) ?? null
    const output = dependencies.complete
      ? await dependencies.complete(messages)
      : await chat(messages, config, {
          category: 'agent.orchestrator',
          projectId: input.projectId,
          configOverrides: { maxTokens: 1800, temperature: 0.2 },
          contextOverflowPolicy: 'reject',
        }, input.signal)
    if (reservation) {
      input.budget!.settleCall(reservation, output)
      settled = true
    }
    return sanitizePlan(extractJsonObject(output), request, workflow)
  } catch (error) {
    if (reservation && !settled) input.budget!.settleFailedCall(reservation)
    if (error instanceof AgentTeamBudgetExceededError) throw error
    if (input.signal?.aborted) throw error
    console.warn('[master-agent] 计划模型失败，使用确定性路由降级：', error)
    return fallbackPlan(request, workflow)
  }
}

export function collectMasterAgentAffectedTaskIdsV1(
  plan: MasterAgentPlan,
  rootTaskIds: readonly string[],
): Set<string> {
  const affected = new Set(rootTaskIds)
  let changed = true
  while (changed) {
    changed = false
    for (const task of plan.tasks) {
      if (!affected.has(task.id) && task.dependsOn.some(dependency => affected.has(dependency))) {
        affected.add(task.id)
        changed = true
      }
    }
  }
  return affected
}

/**
 * Produces a bounded plan patch. Task identity, Skill, perspective and workflow
 * stay code-owned; the model may only adjust instructions/dependencies inside
 * the failed branch selected by the durable runner.
 */
export async function createMasterAgentReplanV1(input: {
  projectId: number
  plan: MasterAgentPlan
  failures: readonly MasterAgentReplanFailureV1[]
  budget: AgentTeamBudgetTracker
  signal?: AbortSignal
}, dependencies: PlannerDependencies = {}): Promise<MasterAgentPlan> {
  if (!input.failures.length) throw new Error('主 Agent 重规划缺少失败证据。')
  const knownTaskIds = new Set(input.plan.tasks.map(task => task.id))
  if (input.failures.some(failure => !knownTaskIds.has(failure.taskId))) {
    throw new Error('主 Agent 重规划失败证据引用了未知任务。')
  }
  const affected = collectMasterAgentAffectedTaskIdsV1(
    input.plan,
    input.failures.map(failure => failure.taskId),
  )
  const config = resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: AGENT_ROLE_CATEGORIES.orchestrator },
  ).config
  const messages = [{
    role: 'system' as const,
    content: `你是 StoryForge 主 Agent 的受限重规划器。你只能修订失败任务及其下游的 instruction 和
dependsOn，不能新增、删除或改名任务，不能改变 agentId、skillId、叙事视角或工作流。不要重复原失败
策略；依赖只能引用原计划任务 ID，且不得形成循环。只输出 JSON：
{"summary":"修订原因","tasks":[{"id":"允许修订的任务ID","instruction":"新指令","dependsOn":[]}]}。
不要输出 Markdown。`,
  }, {
    role: 'user' as const,
    content: [
      `【冻结原计划】\n${JSON.stringify(input.plan)}`,
      `【允许修订任务】\n${JSON.stringify([...affected])}`,
      `【失败证据】\n${JSON.stringify(input.failures)}`,
    ].join('\n\n'),
  }]
  const reservation = input.budget.reserveCall({
    label: '主 Agent 有限重规划',
    messages,
    maxOutputTokens: 1_200,
  })
  let settled = false
  try {
    const output = dependencies.complete
      ? await dependencies.complete(messages)
      : await chat(messages, config, {
          category: 'agent.orchestrator.replan',
          projectId: input.projectId,
          configOverrides: { maxTokens: 1200, temperature: 0.1 },
          contextOverflowPolicy: 'reject',
        }, input.signal)
    input.budget.settleCall(reservation, output)
    settled = true
    const raw = extractJsonObject(output)
    const patches = Array.isArray(raw.tasks) ? raw.tasks : []
    const byId = new Map(input.plan.tasks.map(task => [task.id, task]))
    let changed = false
    for (const value of patches) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const patch = value as Record<string, unknown>
      if (typeof patch.id !== 'string' || !affected.has(patch.id)) continue
      const task = byId.get(patch.id)!
      const instruction = typeof patch.instruction === 'string'
        ? patch.instruction.trim().slice(0, 1_000)
        : ''
      const dependsOn = Array.isArray(patch.dependsOn)
        ? [...new Set(patch.dependsOn.filter((item): item is string => (
            typeof item === 'string' && item !== task.id && knownTaskIds.has(item)
          )))].slice(0, 5)
        : task.dependsOn
      if (!instruction) continue
      if (instruction !== task.instruction || JSON.stringify(dependsOn) !== JSON.stringify(task.dependsOn)) {
        byId.set(task.id, { ...task, instruction, dependsOn })
        changed = true
      }
    }
    if (!changed) throw new Error('主 Agent 重规划没有产生受限范围内的有效变化。')
    const plan: MasterAgentPlan = {
      ...input.plan,
      summary: typeof raw.summary === 'string' && raw.summary.trim()
        ? raw.summary.trim().slice(0, 500)
        : `${input.plan.summary}（已根据失败证据有限重规划）`,
      tasks: input.plan.tasks.map(task => byId.get(task.id)!),
    }
    topologicalTasks(plan)
    return plan
  } catch (error) {
    if (!settled) input.budget.settleFailedCall(reservation)
    throw error
  }
}

function topologicalTasks(plan: MasterAgentPlan): MasterAgentTask[] {
  const byId = new Map(plan.tasks.map(task => [task.id, task]))
  const done = new Set<string>()
  const result: MasterAgentTask[] = []
  while (result.length < plan.tasks.length) {
    const available = plan.tasks.filter(task => (
      !done.has(task.id) && task.dependsOn.every(id => done.has(id) || !byId.has(id))
    ))
    if (!available.length) throw new Error('主 Agent 任务计划包含循环依赖。')
    available.forEach(task => {
      result.push(task)
      done.add(task.id)
    })
  }
  return result
}

export interface ExecuteMasterAgentPlanInput {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  plan: MasterAgentPlan
  budget?: AgentTeamBudgetTracker
  signal?: AbortSignal
  completedTaskOutputs?: Readonly<Record<string, string>>
  executionTrace?: MasterAgentExecutionTrace
  onTask?: (
    task: MasterAgentTask,
    status: 'running' | 'completed' | 'failed',
    error?: string,
  ) => void | Promise<void>
}

async function executeSequentialMasterAgentPlan(
  input: ExecuteMasterAgentPlanInput,
  runtime: { requiredFutureModelCalls?: number } = {},
): Promise<ExecutedMasterCandidate[]> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const candidates: ExecutedMasterCandidate[] = []
  const outputs = new Map<string, string>()
  const contextProfiles = useAIConfigStore.getState().agentContextProfiles
  const budget = input.budget ?? new AgentTeamBudgetTracker(
    useAIConfigStore.getState().agentTeamBudgetProfile,
  )
  for (const [taskId, output] of Object.entries(input.completedTaskOutputs ?? {})) {
    if (output.trim()) outputs.set(taskId, output)
  }
  const orderedTasks = topologicalTasks(input.plan)
  for (let taskIndex = 0; taskIndex < orderedTasks.length; taskIndex += 1) {
    const task = orderedTasks[taskIndex]
    if (outputs.has(task.id)) continue
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await input.executionTrace?.taskStarted?.(task)
    await input.onTask?.(task, 'running')
    try {
      const dependencyBindings = await Promise.all(task.dependsOn.map(async taskId => {
        const output = outputs.get(taskId)
        if (!output?.trim()) throw new Error(`主 Agent 任务 ${task.id} 缺少依赖输出 ${taskId}。`)
        return {
          taskId,
          outputHash: await hashCanonicalValue(output),
        }
      }))
      const upstream = task.dependsOn
        .map(id => outputs.get(id))
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n\n')
      const skill = resolveAgentSkillV1(task.agentId, task.skillId)
      const executionBinding = createAgentSkillExecutionBindingV1(skill)
      const contextProfile = contextProfiles[skill.contextTaskKind]
      const budgetSnapshot = budget.snapshot()
      const pendingGenerationCalls = runtime.requiredFutureModelCalls
        ?? orderedTasks.slice(taskIndex).filter(item => !outputs.has(item.id)).length
      const contextCompressionRuntime = {
        budget,
        requiredFutureModelCalls: pendingGenerationCalls
          + Math.max(0, budgetSnapshot.maxCanonRetries - budgetSnapshot.canonRetries),
      }
      if (task.agentId === 'world-origin') {
        const prepared = await prepareWorldOriginCopilot({
          projectId: input.projectId,
          scope,
          worldGroupId: input.worldGroupId,
          authorRequest: task.instruction,
          skillId: skill.id as AgentSkillId,
          routingCategory: AGENT_ROLE_CATEGORIES['world-origin'],
          contextProfile,
          contextCompressionRuntime,
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '世界领域 Agent',
          maxOutputTokens: skill.maxOutputTokens,
        })
        const draft = result.output
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            skillId: skill.id as AgentSkillId,
            executionBinding,
            label: '世界来源',
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            dependsOnTaskIds: task.dependsOn,
            dependencyBindings,
            generator: prepared.modelIdentity,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      } else if (task.agentId === 'character') {
        const prepared = await prepareCharacterCopilot({
          projectId: input.projectId,
          scope,
          worldGroupId: input.worldGroupId,
          authorRequest: task.instruction,
          skillId: skill.id as AgentSkillId,
          supplementalContext: upstream,
          routingCategory: AGENT_ROLE_CATEGORIES.character,
          contextProfile,
          contextCompressionRuntime,
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '角色领域 Agent',
          maxOutputTokens: skill.maxOutputTokens,
        })
        const draft = JSON.stringify(result.output, null, 2)
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            skillId: skill.id as AgentSkillId,
            executionBinding,
            label: '新角色',
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            dependsOnTaskIds: task.dependsOn,
            dependencyBindings,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      } else if (task.agentId === 'inspiration') {
        const workspace = (await readOwnedRows<any>(
          scope,
          'inspirationWorkspaces',
          { owner: 'work' },
        ))[0]
        const selectedFragmentIds = parseInspirationFragments(workspace?.fragments)
          .slice(0, MAX_INSPIRATION_FRAGMENTS)
          .map(fragment => fragment.id)
        if (!selectedFragmentIds.length) throw new Error('项目尚无已保存的灵感碎片。')
        const prepared = await prepareInspirationCopilot({
          projectId: input.projectId,
          scope,
          selectedFragmentIds,
          authorRequest: task.instruction,
          skillId: skill.id as AgentSkillId,
          routingCategory: AGENT_ROLE_CATEGORIES.inspiration,
          contextProfile,
          contextCompressionRuntime,
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '灵感领域 Agent',
          maxOutputTokens: skill.maxOutputTokens,
        })
        const draft = JSON.stringify(result.output, null, 2)
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            skillId: skill.id as AgentSkillId,
            executionBinding,
            label: '灵感反推版本',
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            mode: prepared.mode,
            selectedFragmentIds,
            dependsOnTaskIds: task.dependsOn,
            dependencyBindings,
            generator: prepared.modelIdentity,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      } else if (task.agentId === 'outline') {
        const prepared = await prepareOutlineCopilot({
          projectId: input.projectId,
          scope,
          worldGroupId: input.worldGroupId,
          authorRequest: task.instruction,
          skillId: skill.id as AgentSkillId,
          supplementalContext: upstream,
          routingCategory: AGENT_ROLE_CATEGORIES.outline,
          contextProfile,
          contextCompressionRuntime,
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '大纲领域 Agent',
          maxOutputTokens: skill.maxOutputTokens,
          validate: output => validateDomainCandidateCanon({
            agentId: task.agentId,
            projectId: input.projectId,
            worldGroupId: input.worldGroupId,
            outlineNodeId: prepared.parentVolumeId,
            outputText: JSON.stringify(output),
          }),
        })
        const draft = JSON.stringify(result.output, null, 2)
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            skillId: skill.id as AgentSkillId,
            executionBinding,
            label: prepared.label,
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            outlineMode: prepared.mode,
            outlineParentId: prepared.parentVolumeId,
            dependsOnTaskIds: task.dependsOn,
            dependencyBindings,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      } else {
        const prepared = await prepareProseCopilot({
          projectId: input.projectId,
          scope,
          worldGroupId: input.worldGroupId,
          authorRequest: task.instruction,
          skillId: skill.id as AgentSkillId,
          supplementalContext: upstream,
          routingCategory: AGENT_ROLE_CATEGORIES.prose,
          contextProfile,
          contextCompressionRuntime,
          perspectiveCharacterId: task.perspectiveCharacterId ?? null,
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '正文领域 Agent',
          maxOutputTokens: skill.maxOutputTokens,
          validate: output => validateDomainCandidateCanon({
            agentId: task.agentId,
            projectId: input.projectId,
            worldGroupId: input.worldGroupId,
            outlineNodeId: prepared.outlineNodeId,
            outputText: output,
          }),
        })
        const draft = result.output
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            skillId: skill.id as AgentSkillId,
            executionBinding,
            label: prepared.label,
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            proseOperation: prepared.operation,
            proseOutlineNodeId: prepared.outlineNodeId,
            perspectiveCharacterId: prepared.perspectiveCharacterId,
            dependsOnTaskIds: task.dependsOn,
            dependencyBindings,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      }
      const candidate = candidates[candidates.length - 1]
      candidate.payload.teamBudgetEvidence = budget.snapshot()
      await input.executionTrace?.candidateReady?.(task, candidate)
      await input.onTask?.(task, 'completed')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await input.onTask?.(task, 'failed', message)
      throw error
    }
  }
  return candidates
}

function compareCandidateBudgetEvidence(
  left: ExecutedMasterCandidate,
  right: ExecutedMasterCandidate,
): number {
  const leftEvidence = left.payload.teamBudgetEvidence
  const rightEvidence = right.payload.teamBudgetEvidence
  if (!leftEvidence || !rightEvidence) return 0
  return leftEvidence.calls - rightEvidence.calls
    || leftEvidence.usedTokens - rightEvidence.usedTokens
    || leftEvidence.canonRetries - rightEvidence.canonRetries
}

async function executeFanOutMasterAgentPlan(
  input: ExecuteMasterAgentPlanInput,
): Promise<ExecutedMasterCandidate[]> {
  const budget = input.budget ?? new AgentTeamBudgetTracker(
    useAIConfigStore.getState().agentTeamBudgetProfile,
  )
  const outputs = new Map<string, string>()
  for (const [taskId, output] of Object.entries(input.completedTaskOutputs ?? {})) {
    if (output.trim()) outputs.set(taskId, output)
  }
  const completed = new Set(
    input.plan.tasks.filter(task => outputs.has(task.id)).map(task => task.id),
  )
  const candidates: ExecutedMasterCandidate[] = []

  while (completed.size < input.plan.tasks.length) {
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const batch = selectMasterFanOutBatchV1(input.plan.tasks, completed, 2)
    if (!batch.length) throw new Error('主 Agent fan-out 计划没有可执行任务，依赖可能已损坏。')
    for (const task of batch) {
      await input.executionTrace?.taskStarted?.(task)
      await input.onTask?.(task, 'running')
    }

    const completedTaskOutputs = Object.fromEntries(outputs)
    const requiredFutureModelCalls = input.plan.tasks.length - completed.size
    const settled = await Promise.all(batch.map(async task => {
      try {
        const generated = await executeSequentialMasterAgentPlan({
          ...input,
          plan: { summary: input.plan.summary, tasks: [task] },
          budget,
          completedTaskOutputs,
          executionTrace: undefined,
          onTask: undefined,
        }, { requiredFutureModelCalls })
        const candidate = generated[0]
        if (!candidate) throw new Error(`主 Agent fan-out 任务 ${task.id} 没有生成候选。`)
        return { status: 'fulfilled' as const, task, candidate }
      } catch (error) {
        return { status: 'rejected' as const, task, error }
      }
    }))

    const fulfilled = settled
      .filter((item): item is Extract<typeof item, { status: 'fulfilled' }> => (
        item.status === 'fulfilled'
      ))
      .sort((left, right) => compareCandidateBudgetEvidence(left.candidate, right.candidate))
    for (const item of fulfilled) {
      outputs.set(item.task.id, item.candidate.draft)
      completed.add(item.task.id)
      candidates.push(item.candidate)
      await input.executionTrace?.candidateReady?.(item.task, item.candidate)
      await input.onTask?.(item.task, 'completed')
    }

    const failed = settled.filter(item => item.status === 'rejected')
    for (const item of failed) {
      const message = item.error instanceof Error ? item.error.message : String(item.error)
      await input.onTask?.(item.task, 'failed', message)
    }
    if (failed.length) throw failed[0].error
  }
  return candidates
}

export async function executeMasterAgentPlan(
  input: ExecuteMasterAgentPlanInput,
): Promise<ExecutedMasterCandidate[]> {
  const workflow = input.plan.workflow ? getMasterWorkflowV1(input.plan.workflow) : null
  return workflow?.strategy === 'fan-out' && isMasterFanOutEnabledV1()
    ? executeFanOutMasterAgentPlan(input)
    : executeSequentialMasterAgentPlan(input)
}

function sameWorldSnapshot(
  left: WorldOriginSnapshot,
  right: WorldOriginSnapshot,
): boolean {
  return left.id === right.id
    && left.updatedAt === right.updatedAt
    && left.worldOrigin === right.worldOrigin
}

function sameWorkspaceScope(left: WorkspaceScope, right: WorkspaceScope): boolean {
  return left.projectId === right.projectId
    && left.worldId === right.worldId
    && left.workId === right.workId
}

async function resolveCandidateScope(input: {
  projectId: number
  scope?: WorkspaceScope
  event: AgentEvent
  payload: MasterCandidatePayload
}): Promise<WorkspaceScope> {
  if (input.event.projectId !== input.projectId) throw new Error('Agent 候选不属于当前项目。')
  let declared = input.scope ?? input.payload.workspaceScope
  if (!declared && input.event.workId != null) {
    const work = await db.works.get(input.event.workId)
    if (!work || work.projectId !== input.projectId) throw new Error('Agent 候选所属作品不存在。')
    declared = { projectId: input.projectId, worldId: work.worldId, workId: work.id! }
  }
  const scope = await resolveScope({ projectId: input.projectId, scope: declared })
  const importedDurableCandidate = input.event.durableRunId != null
    && input.event.durableRunId !== input.payload.runId
  if (
    input.payload.workspaceScope
    && !sameWorkspaceScope(scope, input.payload.workspaceScope)
    && !importedDurableCandidate
  ) {
    throw new Error('Agent 候选的冻结作品作用域不一致。')
  }
  if (!await assertRecordInScope(scope, 'agentEvents', input.event, { owner: 'work' })) {
    throw new Error('Agent 候选不属于当前作品。')
  }
  return scope
}

async function currentWorldSnapshot(scope: WorkspaceScope, worldGroupId: number | null): Promise<WorldOriginSnapshot> {
  const rows = await readOwnedRows<any>(scope, 'worldviews', { owner: 'world' })
  const row = worldGroupId == null
    ? (rows.find(item => (item.worldGroupId ?? null) === null) ?? rows[0] ?? null)
    : (rows.find(item => item.worldGroupId === worldGroupId) ?? null)
  return { id: row?.id ?? null, updatedAt: row?.updatedAt ?? null, worldOrigin: row?.worldOrigin ?? '' }
}

async function currentRosterSnapshot(scope: WorkspaceScope, worldGroupId: number | null): Promise<CharacterRosterSnapshot> {
  const rows = await readOwnedRows<any>(scope, 'characters', { owner: 'world' })
  return {
    serialized: JSON.stringify(rows.map(character => ({
      id: character.id ?? null,
      updatedAt: character.updatedAt,
      name: character.name,
      homeWorldGroupId: character.homeWorldGroupId ?? null,
      isCrossWorld: Boolean(character.isCrossWorld),
    })).sort((left, right) => (left.id ?? 0) - (right.id ?? 0))),
    visibleNames: rows
      .filter(character => character.isCrossWorld || (character.homeWorldGroupId ?? null) === worldGroupId)
      .map(character => character.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')),
  }
}

async function currentInspirationSnapshot(scope: WorkspaceScope): Promise<InspirationWorkspaceSnapshot> {
  const row = (await readOwnedRows<any>(scope, 'inspirationWorkspaces', { owner: 'work' }))[0]
  return {
    id: row?.id ?? null,
    updatedAt: row?.updatedAt ?? null,
    fragments: row?.fragments ?? '[]',
    versions: row?.versions ?? '[]',
  }
}

export async function assertMasterCandidateDependenciesAdoptedV1(
  event: AgentEvent,
  payload: MasterCandidatePayload,
  scope: WorkspaceScope,
): Promise<void> {
  const taskIds = payload.dependsOnTaskIds ?? []
  if (!taskIds.length) return
  const events = (await readOwnedRows<AgentEvent>(scope, 'agentEvents', { owner: 'work' }))
    .filter(row => row.conversationId === event.conversationId)
  const candidates: Array<{
    event: AgentEvent
    payload: Partial<MasterCandidatePayload>
  }> = []
  const legacyCandidateByTask = new Map<string, number>()
  const adoptedCandidateIds = new Set<number>()
  for (const row of events) {
    if (row.kind === 'candidate' && row.id != null) {
      const candidate = parseAgentEventPayload<Partial<MasterCandidatePayload>>(row, {})
      candidates.push({ event: row, payload: candidate })
      if (candidate.taskId) legacyCandidateByTask.set(candidate.taskId, row.id)
    } else if (row.kind === 'confirmation') {
      const confirmation = parseAgentEventPayload<{
        candidateEventId?: number
        decision?: 'adopted' | 'rejected'
      }>(row, {})
      if (confirmation.decision === 'adopted' && confirmation.candidateEventId != null) {
        adoptedCandidateIds.add(confirmation.candidateEventId)
      }
    }
  }

  const bindings = payload.dependencyBindings
  if (bindings === undefined) {
    const missing = taskIds.filter(taskId => {
      const candidateId = legacyCandidateByTask.get(taskId)
      return candidateId == null || !adoptedCandidateIds.has(candidateId)
    })
    if (missing.length) {
      throw new Error(`请先采纳本候选依赖的上游结果：${missing.join('、')}。`)
    }
    return
  }
  if (
    bindings.length !== taskIds.length
    || bindings.some((binding, index) => binding.taskId !== taskIds[index])
  ) throw new Error('下游候选的冻结依赖清单与计划不一致。')

  const durableRunId = event.durableRunId ?? payload.runId
  const durableSnapshot = durableRunId == null ? null : await readAgentRunV1(scope, durableRunId)
  if (durableSnapshot && payload.runGeneration !== durableSnapshot.projection.generation) {
    throw new Error('下游候选不属于当前 Run generation，请重新生成。')
  }
  for (const binding of bindings) {
    if (
      durableSnapshot?.contract.dependencyReceiptPolicy?.requiredForJoin
      && !binding.verificationReceiptHash
    ) throw new Error(`依赖 ${binding.taskId} 缺少步骤验证回执，请重新生成下游候选。`)
    const eligible = candidates.filter(candidate => (
      candidate.payload.taskId === binding.taskId
      && (payload.runId == null || candidate.payload.runId === payload.runId)
      && (binding.candidateHash == null || candidate.payload.candidateHash === binding.candidateHash)
    ))
    let upstream: typeof eligible[number] | undefined
    for (let index = eligible.length - 1; index >= 0; index -= 1) {
      if (await hashCanonicalValue(eligible[index].event.content) === binding.outputHash) {
        upstream = eligible[index]
        break
      }
    }
    if (!upstream?.event.id) {
      throw new Error(`依赖 ${binding.taskId} 的冻结候选版本已经变化，请重新生成下游候选。`)
    }
    if (
      binding.generation !== undefined
      && (upstream.payload.runGeneration ?? payload.runGeneration) !== binding.generation
    ) throw new Error(`依赖 ${binding.taskId} 来自不同 Run generation，请重新生成。`)
    if (durableSnapshot && binding.candidateHash) {
      const step = durableSnapshot.projection.steps[`master:${binding.taskId}`]
      if (
        !step
        || step.status !== 'succeeded'
        || step.confirmation !== 'adopt'
        || !step.adoptionHash
        || step.candidateHash !== binding.candidateHash
        || (
          binding.verificationReceiptHash !== undefined
          && step.verificationReceiptHash !== binding.verificationReceiptHash
        )
      ) throw new Error(`请先完成采纳本候选依赖的上游结果：${binding.taskId}。`)
    } else if (!adoptedCandidateIds.has(upstream.event.id)) {
      throw new Error(`请先采纳本候选依赖的上游结果：${binding.taskId}。`)
    }
  }
}

export async function adoptMasterCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  event: AgentEvent
  payload: MasterCandidatePayload
  draft: string
  runtime?: ExecutedMasterCandidate
}): Promise<string> {
  const scope = await resolveCandidateScope(input)
  await assertMasterCandidateDependenciesAdoptedV1(input.event, input.payload, scope)
  if (input.runtime) {
    const output = input.payload.agentId === 'world-origin'
      ? input.draft
      : input.payload.agentId === 'character'
        ? parseCharacterCandidateDraft(input.draft)
        : input.payload.agentId === 'inspiration'
          ? parseInspirationCandidateDraft(input.draft, input.payload.mode ?? 'single')
          : input.payload.agentId === 'outline'
            ? parseOutlineCandidateDraft(input.draft)
            : parseProseCandidateDraft(input.draft)
    const result = await adoptGenerationNodeOutput(input.runtime.runtimeNode, output)
    if (!result.adopted) {
      throw new Error(result.gate?.issues.map(issue => issue.message).join('；') || '候选没有通过确认闸门。')
    }
  } else if (input.payload.agentId === 'world-origin') {
    const base = input.payload.baseSnapshot as WorldOriginSnapshot
    if (!sameWorldSnapshot(base, await currentWorldSnapshot(scope, input.worldGroupId))) {
      throw new Error('世界来源已在候选生成后发生变化，请重新生成。')
    }
    const draft = input.draft.trim()
    if (draft.length < 4 || draft.length > 12_000) throw new Error('世界来源候选长度无效。')
    await adopt({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      target: 'worldviews',
      mode: 'replace',
      data: { worldOrigin: draft },
    })
  } else if (input.payload.agentId === 'character') {
    const base = input.payload.baseSnapshot as CharacterRosterSnapshot
    const current = await currentRosterSnapshot(scope, input.worldGroupId)
    if (base.serialized !== current.serialized) throw new Error('角色主档已变化，请重新生成。')
    const candidate = parseCharacterCandidateDraft(input.draft)
    const normalized = candidate.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
    if (current.visibleNames.includes(normalized)) throw new Error(`当前世界已存在角色“${candidate.name}”。`)
    await adopt({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      target: 'characters',
      mode: 'add',
      data: { ...candidate, isCrossWorld: false },
    })
  } else if (input.payload.agentId === 'inspiration') {
    const base = input.payload.baseSnapshot as InspirationWorkspaceSnapshot
    const current = await currentInspirationSnapshot(scope)
    if (JSON.stringify(base) !== JSON.stringify(current)) throw new Error('灵感工作区已变化，请重新生成。')
    const mode = input.payload.mode ?? 'single'
    const result = parseInspirationCandidateDraft(input.draft, mode)
    await useInspirationWorkspaceStore.getState().load(scope)
    await useInspirationWorkspaceStore.getState().saveVersion(scope, {
      mode,
      parentVersionId: null,
      fragmentIds: input.payload.selectedFragmentIds ?? [],
      result: result as InspirationCopilotResult,
    })
  } else if (input.payload.agentId === 'outline') {
    const mode = input.payload.outlineMode
    if (!mode) throw new Error('大纲候选缺少写回模式，请重新生成。')
    await adoptRestoredOutlineCandidate({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      mode,
      parentVolumeId: input.payload.outlineParentId ?? null,
      snapshot: input.payload.baseSnapshot as OutlineCopilotSnapshot,
      draft: input.draft,
    })
  } else {
    if (!input.payload.proseOperation || input.payload.proseOutlineNodeId == null) {
      throw new Error('正文候选缺少目标章节或写回模式，请重新生成。')
    }
    await adoptRestoredProseCandidate({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      operation: input.payload.proseOperation,
      outlineNodeId: input.payload.proseOutlineNodeId,
      snapshot: input.payload.baseSnapshot as ProseCopilotSnapshot,
      draft: input.draft,
    })
  }

  await Promise.all([
    useWorldviewStore.getState().loadAll(scope, input.worldGroupId),
    useCharacterStore.getState().loadAll(scope),
    useOutlineStore.getState().loadAll(scope),
    useChapterStore.getState().loadAll(scope),
  ])
  return input.payload.agentId === 'world-origin'
    ? '世界来源已写入项目。'
    : input.payload.agentId === 'character'
      ? `角色“${(parseCharacterCandidateDraft(input.draft) as CharacterCopilotCandidate).name}”已加入项目。`
      : input.payload.agentId === 'inspiration'
        ? `已保存新的${input.payload.mode === 'multiworld' ? '多世界' : '单世界'}灵感版本。`
        : input.payload.agentId === 'outline'
          ? input.payload.outlineMode === 'volumes'
            ? '卷级大纲已写入项目。'
            : '章节大纲已写入目标卷。'
          : input.payload.proseOperation === 'continue'
            ? '续写内容已追加到目标章节。'
            : '正文已写入目标章节。'
}
