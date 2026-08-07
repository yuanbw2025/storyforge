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
  AgentContextTaskKind,
} from './context-policy'
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

export const DOMAIN_AGENT_IDS = ['world-origin', 'character', 'inspiration', 'outline', 'prose'] as const
export type DomainAgentId = typeof DOMAIN_AGENT_IDS[number]

const CONTEXT_TASK_BY_AGENT: Record<DomainAgentId, AgentContextTaskKind> = {
  'world-origin': 'agent-world-origin',
  character: 'agent-character',
  inspiration: 'agent-inspiration',
  outline: 'agent-outline',
  prose: 'agent-prose',
}

const MAX_OUTPUT_TOKENS_BY_AGENT: Record<DomainAgentId, number> = {
  'world-origin': 3_000,
  character: 6_000,
  inspiration: 8_000,
  outline: 12_000,
  prose: 16_000,
}

export interface MasterAgentTask {
  id: string
  agentId: DomainAgentId
  instruction: string
  dependsOn: string[]
  /** 正文领域的显式叙事视角；缺省时正文不注入角色认知。 */
  perspectiveCharacterId?: number | null
}

export interface MasterAgentPlan {
  summary: string
  tasks: MasterAgentTask[]
}

export interface MasterCandidatePayload {
  version: 1
  taskId: string
  agentId: DomainAgentId
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
  workspaceScope?: WorkspaceScope
  runId?: number
  runStepId?: string
  candidateHash?: string
  perspectiveCharacterId?: number | null
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

function explicitlyRequestedDomains(request: string): Set<DomainAgentId> {
  const hasInspiration = /灵感|反推|碎片|脑洞/.test(request)
  const hasProse = /正文|续写|接着写|继续写|写(?:作|出|完)?第\s*[零〇一二两三四五六七八九十\d]+\s*章/.test(request)
  const outlineMention = /大纲|卷纲|章纲|章节规划|剧情结构|情节结构/.test(request)
  const outlineAction = (
    /(?:生成|创建|新增|规划|设计|展开|补充|完善|修改|重做).{0,12}(?:大纲|卷纲|章纲|章节规划|剧情结构|情节结构)/.test(request)
    || /(?:大纲|卷纲|章纲|章节规划|剧情结构|情节结构).{0,12}(?:生成|创建|新增|规划|设计|展开|补充|完善|修改|重做)/.test(request)
  )
  const hasOutline = hasProse ? outlineAction : outlineMention
  const worldMention = /世界|设定|起源|文明|力量|体系|时代|地理/.test(request)
  const worldObject = '(?:世界观|世界|背景设定|世界起源|文明设定|力量体系|时代背景|地理设定)'
  const worldAction = (
    new RegExp(`(?:创建|生成|设计|新增|建立|补充|完善|修改|重做).{0,12}${worldObject}`).test(request)
    || new RegExp(`${worldObject}.{0,12}(?:创建|生成|设计|新增|建立|补充|完善|修改|重做)`).test(request)
  )
  const characterMention = /角色|人物|主角|配角|反派|npc/i.test(request)
  const characterAction = (
    /(?:创建|生成|设计|新增|塑造|补充|完善|修改|重做).{0,12}(?:角色|人物|主角|配角|反派|npc)/i.test(request)
    || /(?:角色|人物|主角|配角|反派|npc).{0,12}(?:创建|生成|设计|新增|塑造|补充|完善|修改|重做)/i.test(request)
  )
  const downstreamWriting = hasOutline || hasProse
  const hasWorld = downstreamWriting ? worldAction : worldMention
  // 大纲里的“角色变化/角色弧光”是输出约束，不是创建或修改角色主档的授权。
  const hasCharacter = downstreamWriting ? characterAction : characterMention
  return new Set<DomainAgentId>([
    ...(hasWorld ? ['world-origin' as const] : []),
    ...(hasCharacter ? ['character' as const] : []),
    ...(hasInspiration ? ['inspiration' as const] : []),
    ...(hasOutline ? ['outline' as const] : []),
    ...(hasProse ? ['prose' as const] : []),
  ])
}

function fallbackPlan(request: string): MasterAgentPlan {
  const tasks: MasterAgentTask[] = []
  const requested = explicitlyRequestedDomains(request)
  const hasWorld = requested.has('world-origin')
  const hasCharacter = requested.has('character')
  const hasInspiration = requested.has('inspiration')
  const hasOutline = requested.has('outline')
  const hasProse = requested.has('prose')
  if (hasWorld) tasks.push({
    id: 'world-1',
    agentId: 'world-origin',
    instruction: request,
    dependsOn: [],
  })
  if (hasInspiration) tasks.push({
    id: 'inspiration-1',
    agentId: 'inspiration',
    instruction: request,
    dependsOn: [],
  })
  if (hasCharacter) tasks.push({
    id: 'character-1',
    agentId: 'character',
    instruction: request,
    dependsOn: hasWorld ? ['world-1'] : [],
  })
  if (hasOutline) tasks.push({
    id: 'outline-1',
    agentId: 'outline',
    instruction: request,
    dependsOn: [
      ...(hasWorld ? ['world-1'] : []),
      ...(hasCharacter ? ['character-1'] : []),
    ],
  })
  if (hasProse && !hasOutline) tasks.push({
    id: 'prose-1',
    agentId: 'prose',
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
    instruction: request,
    dependsOn: [],
  })
  return {
    summary: hasProse && hasOutline
      ? '先生成并确认章节大纲；确认进入正式数据后，再继续生成正文。'
      : '根据用户要求调度相关创作领域。',
    tasks,
  }
}

function sanitizePlan(raw: Record<string, unknown>, request: string): MasterAgentPlan {
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : []
  const tasks: MasterAgentTask[] = []
  const ids = new Set<string>()
  const agentIds = new Set<DomainAgentId>()
  const explicitlyRequested = explicitlyRequestedDomains(request)
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
      instruction,
      dependsOn: Array.isArray(source.dependsOn)
        ? source.dependsOn.filter((value): value is string => typeof value === 'string').slice(0, 5)
        : [],
      ...(agentId === 'prose' && perspectiveCharacterId !== undefined ? { perspectiveCharacterId } : {}),
    })
  }
  if (!tasks.length) return fallbackPlan(request)
  const knownIds = new Set(tasks.map(task => task.id))
  tasks.forEach(task => {
    task.dependsOn = task.dependsOn.filter(id => id !== task.id && knownIds.has(id))
  })
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
    return sanitizePlan(extractJsonObject(output), request)
  } catch (error) {
    if (reservation && !settled) input.budget!.settleFailedCall(reservation)
    if (error instanceof AgentTeamBudgetExceededError) throw error
    if (input.signal?.aborted) throw error
    console.warn('[master-agent] 计划模型失败，使用确定性路由降级：', error)
    return fallbackPlan(request)
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

export async function executeMasterAgentPlan(input: {
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
}): Promise<ExecutedMasterCandidate[]> {
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
  for (const task of topologicalTasks(input.plan)) {
    if (outputs.has(task.id)) continue
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await input.executionTrace?.taskStarted?.(task)
    await input.onTask?.(task, 'running')
    try {
      const upstream = task.dependsOn
        .map(id => outputs.get(id))
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n\n')
      if (task.agentId === 'world-origin') {
        const prepared = await prepareWorldOriginCopilot({
          projectId: input.projectId,
          scope,
          worldGroupId: input.worldGroupId,
          authorRequest: task.instruction,
          routingCategory: AGENT_ROLE_CATEGORIES['world-origin'],
          contextProfile: contextProfiles[CONTEXT_TASK_BY_AGENT[task.agentId]],
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '世界领域 Agent',
          maxOutputTokens: MAX_OUTPUT_TOKENS_BY_AGENT[task.agentId],
        })
        const draft = result.output
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            label: '世界来源',
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            dependsOnTaskIds: task.dependsOn,
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
          supplementalContext: upstream,
          routingCategory: AGENT_ROLE_CATEGORIES.character,
          contextProfile: contextProfiles[CONTEXT_TASK_BY_AGENT[task.agentId]],
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '角色领域 Agent',
          maxOutputTokens: MAX_OUTPUT_TOKENS_BY_AGENT[task.agentId],
        })
        const draft = JSON.stringify(result.output, null, 2)
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            label: '新角色',
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            dependsOnTaskIds: task.dependsOn,
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
          routingCategory: AGENT_ROLE_CATEGORIES.inspiration,
          contextProfile: contextProfiles[CONTEXT_TASK_BY_AGENT[task.agentId]],
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '灵感领域 Agent',
          maxOutputTokens: MAX_OUTPUT_TOKENS_BY_AGENT[task.agentId],
        })
        const draft = JSON.stringify(result.output, null, 2)
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            label: '灵感反推版本',
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            mode: prepared.mode,
            selectedFragmentIds,
            dependsOnTaskIds: task.dependsOn,
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
          supplementalContext: upstream,
          routingCategory: AGENT_ROLE_CATEGORIES.outline,
          contextProfile: contextProfiles[CONTEXT_TASK_BY_AGENT[task.agentId]],
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '大纲领域 Agent',
          maxOutputTokens: MAX_OUTPUT_TOKENS_BY_AGENT[task.agentId],
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
            label: prepared.label,
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            outlineMode: prepared.mode,
            outlineParentId: prepared.parentVolumeId,
            dependsOnTaskIds: task.dependsOn,
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
          supplementalContext: upstream,
          routingCategory: AGENT_ROLE_CATEGORIES.prose,
          contextProfile: contextProfiles[CONTEXT_TASK_BY_AGENT[task.agentId]],
          perspectiveCharacterId: task.perspectiveCharacterId ?? null,
          signal: input.signal,
        })
        const result = await runBudgetedGenerationNode({
          node: prepared.node,
          prepared: prepared.prepared,
          budget,
          callLabel: '正文领域 Agent',
          maxOutputTokens: MAX_OUTPUT_TOKENS_BY_AGENT[task.agentId],
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
            label: prepared.label,
            contextSources: prepared.contextSources,
            contextEvidence: prepared.contextEvidence,
            baseSnapshot: prepared.snapshot,
            workspaceScope: scope,
            proseOperation: prepared.operation,
            proseOutlineNodeId: prepared.outlineNodeId,
            perspectiveCharacterId: prepared.perspectiveCharacterId,
            dependsOnTaskIds: task.dependsOn,
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
  if (input.payload.workspaceScope && !sameWorkspaceScope(scope, input.payload.workspaceScope)) {
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

async function assertCandidateDependenciesAdopted(
  event: AgentEvent,
  payload: MasterCandidatePayload,
  scope: WorkspaceScope,
): Promise<void> {
  const taskIds = payload.dependsOnTaskIds ?? []
  if (!taskIds.length) return
  const events = (await readOwnedRows<AgentEvent>(scope, 'agentEvents', { owner: 'work' }))
    .filter(row => row.conversationId === event.conversationId)
  const candidateByTask = new Map<string, number>()
  const adoptedCandidateIds = new Set<number>()
  for (const row of events) {
    if (row.kind === 'candidate' && row.id != null) {
      const candidate = parseAgentEventPayload<Partial<MasterCandidatePayload>>(row, {})
      if (candidate.taskId) candidateByTask.set(candidate.taskId, row.id)
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
  const missing = taskIds.filter(taskId => {
    const candidateId = candidateByTask.get(taskId)
    return candidateId == null || !adoptedCandidateIds.has(candidateId)
  })
  if (missing.length) {
    throw new Error(`请先采纳本候选依赖的上游结果：${missing.join('、')}。`)
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
  await assertCandidateDependenciesAdopted(input.event, input.payload, scope)
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
