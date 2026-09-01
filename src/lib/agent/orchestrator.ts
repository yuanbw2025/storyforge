import JSON5 from 'json5'
import { useAIConfigStore } from '../../stores/ai-config'
import { AGENT_ROLE_CATEGORIES } from '../ai/task-routing'
import { useChapterStore } from '../../stores/chapter'
import { useCharacterStore } from '../../stores/character'
import { useInspirationWorkspaceStore } from '../../stores/inspiration-workspace'
import { useOutlineStore } from '../../stores/outline'
import { useStoryArcStore } from '../../stores/story-arc'
import { useWorldviewStore } from '../../stores/worldview'
import { useCharacterDrivenPlanStore } from '../../stores/character-driven-plan'
import { chat, resolveRequestConfig } from '../ai/client'
import { db } from '../db/schema'
import {
  adoptGenerationNodeOutput,
  type GenerationNode,
} from '../generation/generation-node'
import {
  parseInspirationFragments,
  parseInspirationVersions,
  latestInspirationVersion,
  MAX_INSPIRATION_FRAGMENTS,
} from '../inspiration/workspace'
import { adopt } from '../registry/adopt'
import {
  parseAgentEventPayload,
  type AgentEvent,
  type AIConfig,
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
  runOutlineCreativeReliabilityV1,
  type OutlineCopilotMode,
  type OutlineCopilotSnapshot,
} from './outline-copilot'
import {
  adoptRestoredProseCandidate,
  parseProseCandidateDraft,
  prepareProseCopilot,
  runProseCreativeReliabilityV1,
  type ProseCopilotOperation,
  type ProseCopilotSnapshot,
} from './prose-copilot'
import {
  prepareWorldOriginCopilot,
  type WorldOriginSnapshot,
} from './world-origin-copilot'
import {
  adoptRestoredStoryCoreCandidate,
  parseStoryCoreCandidateDraft,
  prepareStoryCoreCopilot,
  type StoryCoreCopilotSnapshot,
  type StoryCoreField,
} from './story-core-copilot'
import {
  adoptRestoredCreativeRulesCandidateV1,
  parseCreativeRulesCandidateDraftV1,
  prepareCreativeRulesCopilotV1,
  type CreativeRulesCopilotSnapshotV1,
  type CreativeRulesField,
} from './creative-rules-copilot'
import {
  adoptRestoredWorldviewFieldCandidate,
  parseWorldviewFieldCandidateDraft,
  prepareWorldviewFieldCopilot,
  type WorldviewAgentField,
  type WorldviewFieldOperationV1,
  type WorldviewFieldOutputBudgetV1,
  type WorldviewFieldCopilotSnapshot,
} from './worldview-field-copilot'
import {
  adoptRestoredStoryArcCandidate,
  parseStoryArcMutationRequestV1,
  prepareStoryArcCopilot,
  runStoryArcCreativeReliabilityV1,
  type StoryArcCopilotSnapshot,
  type StoryArcRequestKind,
  type StoryArcMutationRequestV1,
} from './story-arc-copilot'
import {
  adoptRestoredCharacterDrivenCandidateV1,
  parseCharacterDrivenCandidateDraftV1,
  prepareCharacterDrivenCopilotV1,
  type CharacterDrivenCopilotSnapshotV1,
} from './character-driven-copilot'
import {
  adoptRestoredCharacterRevisionCandidateV1,
  parseCharacterRevisionCandidateDraftV1,
  parseCharacterRevisionTaskInputV1,
  prepareCharacterRevisionCopilotV1,
  serializeCharacterRevisionCandidateV1,
  type CharacterRevisionCopilotSnapshotV1,
  type CharacterRevisionTaskInputV1,
} from './character-revision-copilot'
import {
  adoptRestoredCharacterSupplementCandidateV1,
  parseCharacterSupplementCandidateDraftV1,
  parseCharacterSupplementTaskInputV1,
  prepareCharacterSupplementCopilotV1,
  serializeCharacterSupplementCandidateV1,
  type CharacterSupplementCopilotSnapshotV1,
  type CharacterSupplementTaskInputV1,
} from './character-supplement-copilot'
import {
  adoptRestoredCharacterLifecycleCandidateV1,
  parseCharacterLifecycleCandidateV1,
  parseCharacterLifecycleTaskInputV1,
  prepareCharacterLifecycleCopilotV1,
  serializeCharacterLifecycleCandidateV1,
  type CharacterLifecycleSnapshotV1,
  type CharacterLifecycleTaskInputV1,
} from './character-lifecycle-copilot'
import {
  adoptRestoredStorylineProgressCandidateV1,
  parseStorylineProgressCandidateDraftV1,
  prepareStorylineProgressCopilotV1,
  type StorylineProgressCopilotSnapshotV1,
} from './storyline-progress-copilot'
import type {
  AgentContextEvidence,
} from './context-policy'
import type { AssembleContextResult } from '../registry/types'
import type { ContextGatewayExecutionV1 } from '../context-gateway/execution'
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
import {
  assertWorkspaceContentRevisionFreshV1,
  captureWorkspaceContentRevisionV1,
  type WorkspaceContentRevisionVectorV1,
} from '../authoring/content-revision'
import type {
  MasterCandidateModelIdentityV1,
  MasterCandidateSemanticReviewArtifactV1,
} from './master-candidate-semantic-review'
import {
  creativeArtifactCanAdoptV1,
  isCreativeReliabilityRuntimeEnabledV1,
  type CreativeAssumptionV1,
  type CreativeArtifactV1,
} from './creative-reliability'
import {
  mergeProvisionalAssumptionsV1,
  type NarrativeBriefV1,
} from './narrative-brief'
import type { InformationBoundaryManifestV1 } from './information-boundary'
import type { StructuredOutputRunEvidenceV1 } from './structured-output-pipeline'
import { usePromptStore } from '../../stores/prompt'
import {
  freezePromptExecutionOptionsV1,
  parsePromptExecutionOptionsV1,
  promptExecutionRequestForModuleV1,
  verifyPromptExecutionOptionsV1,
  type GovernedPromptModuleKeyV1,
  type PromptExecutionEvidenceV1,
  type PromptExecutionOptionsV1,
  type PromptExecutionRequestV1,
} from './prompt-execution'

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
  /** 灵感领域的显式碎片选择；缺省时由主 Agent 使用受限默认选择。 */
  inspirationFragmentIds?: string[]
  /** 角色驱动规划面板明确选择的方案；只允许 outline.character-driven。 */
  characterDrivenPlanId?: number
  /** 中途重规划面板冻结的角色变更、保护区、锚点与方案选择。 */
  characterRevisionRequest?: CharacterRevisionTaskInputV1
  /** 已有角色补全面板冻结的目标角色、字段闭集与剧情证据开关。 */
  characterSupplementRequest?: CharacterSupplementTaskInputV1
  /** 角色状态变化/退场冻结的目标状态与触发证据。 */
  characterLifecycleRequest?: CharacterLifecycleTaskInputV1
  /** 故事线进度映射固定的已写章节。 */
  storylineProgressChapterId?: number
  /** ARC-1: existing-arc transformations freeze operation and stable target ID. */
  storyArcMutationRequest?: StoryArcMutationRequestV1
  /** New formal plans freeze the selected PromptTemplate and run options here. */
  promptExecution?: PromptExecutionOptionsV1
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
  /** Durable Context Manifest identity frozen before candidate persistence. */
  contextManifestHash?: string
  /** Absent on candidates created before WEH-0C. */
  contentRevision?: WorkspaceContentRevisionVectorV1
  teamBudgetEvidence?: AgentTeamBudgetEvidence
  baseSnapshot: unknown
  mode?: InspirationResultMode
  selectedFragmentIds?: string[]
  characterDrivenPlanId?: number
  characterRevisionRequest?: CharacterRevisionTaskInputV1
  characterSupplementRequest?: CharacterSupplementTaskInputV1
  characterLifecycleRequest?: CharacterLifecycleTaskInputV1
  outlineMode?: OutlineCopilotMode
  outlineParentId?: number | null
  storyArcKind?: StoryArcRequestKind
  storyArcMutationRequest?: StoryArcMutationRequestV1
  storyCoreField?: StoryCoreField
  creativeRulesField?: CreativeRulesField
  worldviewField?: WorldviewAgentField
  worldviewFieldOperation?: WorldviewFieldOperationV1
  worldviewFieldOutputBudget?: WorldviewFieldOutputBudgetV1
  storylineProgressChapterId?: number
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
  /** Present on candidates governed by the bounded creative-reliability policy. */
  creativeArtifact?: CreativeArtifactV1
  /** Absent on candidates created before WEH-0E or on free-text outputs. */
  structuredOutputEvidence?: StructuredOutputRunEvidenceV1
  /** Absent on candidates created before WEH-0F or on non-governed prompt paths. */
  promptExecutionEvidence?: PromptExecutionEvidenceV1
  /** Per-run narrative drive derived only from already assembled registered sources. */
  narrativeBrief?: NarrativeBriefV1
  /** Prose-only immutable knowledge boundary used for local author revalidation. */
  informationBoundary?: InformationBoundaryManifestV1
}

export interface ExecutedMasterCandidate {
  payload: MasterCandidatePayload
  draft: string
  runtimeNode: GenerationNode<any, any, any>
  runtimeOutput: unknown
  /** Ephemeral exact-evidence inputs; durable runner persists them before candidate storage. */
  contextGatewayRuntime?: MasterContextGatewayRuntimeV1
}

export interface MasterContextGatewayPreparedV1 {
  execution: ContextGatewayExecutionV1
  assembled: AssembleContextResult
  renderedRequest: unknown
}

export interface MasterContextGatewayRuntimeV1 extends MasterContextGatewayPreparedV1 {
  rawResponse: unknown
}

export interface MasterAgentExecutionTrace {
  taskStarted?: (task: MasterAgentTask) => Promise<void>
  contextGatewayPrepared?: (
    task: MasterAgentTask,
    prepared: MasterContextGatewayPreparedV1,
  ) => Promise<void>
  candidateReady?: (task: MasterAgentTask, candidate: ExecutedMasterCandidate) => Promise<void>
  taskFailed?: (task: MasterAgentTask, error: unknown) => Promise<void>
}

interface PlannerDependencies {
  complete?: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<string>
}

export interface PinnedMasterAgentTaskV1 {
  agentId: DomainAgentId
  skillId?: AgentSkillId
  instruction: string
  dependsOn?: string[]
  perspectiveCharacterId?: number | null
  inspirationFragmentIds?: string[]
  characterDrivenPlanId?: number
  characterRevisionRequest?: CharacterRevisionTaskInputV1
  characterSupplementRequest?: CharacterSupplementTaskInputV1
  characterLifecycleRequest?: CharacterLifecycleTaskInputV1
  storylineProgressChapterId?: number
  storyArcMutationRequest?: StoryArcMutationRequestV1
  promptExecution?: PromptExecutionRequestV1
  id?: string
}

export interface MasterAgentReplanFailureV1 {
  taskId: string
  code: string
  category: string
  fingerprint: string
}

function governedPromptModuleForTaskV1(
  task: Pick<MasterAgentTask, 'agentId' | 'skillId'>,
): GovernedPromptModuleKeyV1 | null {
  const skill = resolveAgentSkillV1(task.agentId, task.skillId)
  if (skill.executionMode === 'worldview-field') return 'worldview.dimension'
  if (skill.executionMode === 'story-core') return 'story.generate'
  if (task.agentId === 'character' && skill.executionMode === 'create') return 'character.generate'
  return null
}

async function freezeMasterAgentPlanPromptsV1(plan: MasterAgentPlan): Promise<MasterAgentPlan> {
  const tasks = await Promise.all(plan.tasks.map(async task => {
    const expectedModuleKey = governedPromptModuleForTaskV1(task)
    if (!expectedModuleKey) {
      if (task.promptExecution !== undefined) {
        throw new Error(`主 Agent 任务 ${task.id} 的 Skill 不允许携带 Prompt 执行选项。`)
      }
      return task
    }
    if (task.promptExecution) {
      const frozen = parsePromptExecutionOptionsV1(task.promptExecution, expectedModuleKey)
      await verifyPromptExecutionOptionsV1(frozen)
      return { ...task, promptExecution: frozen }
    }
    const request = promptExecutionRequestForModuleV1(expectedModuleKey)
    return {
      ...task,
      promptExecution: await freezePromptExecutionOptionsV1({
        request,
        template: usePromptStore.getState().getActive(expectedModuleKey),
      }),
    }
  }))
  return { ...plan, tasks }
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
  pinnedTask?: PinnedMasterAgentTaskV1
}, dependencies: PlannerDependencies = {}): Promise<MasterAgentPlan> {
  const request = input.request.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的创作要求。')
  const workflow = selectMasterWorkflowV1(request)
  if (input.pinnedTask) {
    const pinned = input.pinnedTask
    if (pinned.agentId !== 'inspiration' && pinned.inspirationFragmentIds !== undefined) {
      throw new Error('只有灵感领域任务可以固定灵感碎片。')
    }
    if (
      pinned.characterDrivenPlanId !== undefined
      && (
        pinned.agentId !== 'outline'
        || pinned.skillId !== 'outline.character-driven'
        || !Number.isInteger(pinned.characterDrivenPlanId)
        || pinned.characterDrivenPlanId < 1
      )
    ) throw new Error('只有角色驱动大纲 Skill 可以固定角色驱动方案。')
    if (pinned.skillId === 'outline.character-driven' && pinned.characterDrivenPlanId === undefined) {
      throw new Error('角色驱动大纲 Skill 必须固定角色驱动方案。')
    }
    if (
      pinned.characterRevisionRequest !== undefined
      && (pinned.agentId !== 'outline' || pinned.skillId !== 'outline.character-revision')
    ) throw new Error('只有角色中途重规划 Skill 可以固定角色变更请求。')
    if (pinned.skillId === 'outline.character-revision' && pinned.characterRevisionRequest === undefined) {
      throw new Error('角色中途重规划 Skill 必须固定角色变更请求。')
    }
    if (
      pinned.characterSupplementRequest !== undefined
      && (pinned.agentId !== 'character' || pinned.skillId !== 'character.supplement')
    ) throw new Error('只有角色补全 Skill 可以固定角色补全请求。')
    if (pinned.skillId === 'character.supplement' && pinned.characterSupplementRequest === undefined) {
      throw new Error('角色补全 Skill 必须固定角色补全请求。')
    }
    if (
      pinned.characterLifecycleRequest !== undefined
      && (pinned.agentId !== 'character' || pinned.skillId !== 'character.lifecycle')
    ) throw new Error('只有角色状态 Skill 可以固定生命周期请求。')
    if (pinned.skillId === 'character.lifecycle' && pinned.characterLifecycleRequest === undefined) {
      throw new Error('角色状态 Skill 必须固定生命周期请求。')
    }
    if (
      pinned.storylineProgressChapterId !== undefined
      && (pinned.agentId !== 'outline' || pinned.skillId !== 'outline.storyline-progress')
    ) throw new Error('只有故事线进度 Skill 可以固定映射章节。')
    if (pinned.skillId === 'outline.storyline-progress') {
      const chapterId = pinned.storylineProgressChapterId
      if (typeof chapterId !== 'number' || !Number.isInteger(chapterId) || chapterId < 1) {
        throw new Error('故事线进度 Skill 必须固定已写章节 ID。')
      }
    }
    if (
      pinned.storyArcMutationRequest !== undefined
      && (pinned.agentId !== 'outline' || pinned.skillId !== 'outline.story-arcs')
    ) throw new Error('只有故事线 Skill 可以固定既有故事线变换请求。')
    const characterRevisionRequest = pinned.characterRevisionRequest === undefined
      ? undefined
      : parseCharacterRevisionTaskInputV1(pinned.characterRevisionRequest)
    const characterSupplementRequest = pinned.characterSupplementRequest === undefined
      ? undefined
      : parseCharacterSupplementTaskInputV1(pinned.characterSupplementRequest)
    const characterLifecycleRequest = pinned.characterLifecycleRequest === undefined
      ? undefined
      : parseCharacterLifecycleTaskInputV1(pinned.characterLifecycleRequest)
    const storyArcMutationRequest = pinned.storyArcMutationRequest === undefined
      ? undefined
      : parseStoryArcMutationRequestV1(pinned.storyArcMutationRequest)
    const instruction = pinned.instruction.trim()
    if (instruction.length > 8_000) {
      throw new Error('固定领域任务的作者要求超过 8000 字符；已在模型调用前阻止，请缩短后重试。')
    }
    const task: MasterAgentTask = {
      id: pinned.id ?? `${pinned.agentId}-targeted`,
      agentId: pinned.agentId,
      ...(pinned.skillId ? { skillId: pinned.skillId } : {}),
      instruction,
      dependsOn: [...new Set(pinned.dependsOn ?? [])].slice(0, 5),
      ...(pinned.perspectiveCharacterId !== undefined
        ? { perspectiveCharacterId: pinned.perspectiveCharacterId }
        : {}),
      ...(pinned.inspirationFragmentIds !== undefined
        ? { inspirationFragmentIds: [...new Set(pinned.inspirationFragmentIds)].slice(0, 24) }
        : {}),
      ...(pinned.characterDrivenPlanId !== undefined
        ? { characterDrivenPlanId: pinned.characterDrivenPlanId }
        : {}),
      ...(characterRevisionRequest !== undefined
        ? { characterRevisionRequest }
        : {}),
      ...(characterSupplementRequest !== undefined
        ? { characterSupplementRequest }
        : {}),
      ...(characterLifecycleRequest !== undefined
        ? { characterLifecycleRequest }
        : {}),
      ...(pinned.storylineProgressChapterId !== undefined
        ? { storylineProgressChapterId: pinned.storylineProgressChapterId }
        : {}),
      ...(storyArcMutationRequest !== undefined ? { storyArcMutationRequest } : {}),
    }
    const expectedPromptModule = governedPromptModuleForTaskV1(task)
    if (pinned.promptExecution !== undefined) {
      if (!expectedPromptModule || pinned.promptExecution.moduleKey !== expectedPromptModule) {
        throw new Error('固定任务的 Prompt 模块与 Agent Skill 不一致。')
      }
      task.promptExecution = await freezePromptExecutionOptionsV1({
        request: pinned.promptExecution,
        template: usePromptStore.getState().getActive(expectedPromptModule),
      })
    }
    return freezeMasterAgentPlanPromptsV1({
      summary: pinned.agentId === 'inspiration'
        ? '按作者选择的灵感碎片生成结构化反推候选。'
        : '按固定领域任务执行一次受治理候选生成。',
      tasks: [task],
      workflow,
    })
  }
  if (getMasterWorkflowV1(workflow).planner === 'skip') {
    return freezeMasterAgentPlanPromptsV1(fallbackPlan(request, workflow))
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
    return freezeMasterAgentPlanPromptsV1(sanitizePlan(extractJsonObject(output), request, workflow))
  } catch (error) {
    if (reservation && !settled) input.budget!.settleFailedCall(reservation)
    if (error instanceof AgentTeamBudgetExceededError) throw error
    if (input.signal?.aborted) throw error
    console.warn('[master-agent] 计划模型失败，使用确定性路由降级：', error)
    return freezeMasterAgentPlanPromptsV1(fallbackPlan(request, workflow))
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
  completedTaskAssumptions?: Readonly<Record<string, readonly CreativeAssumptionV1[]>>
  /**
   * Tasks whose candidates have crossed the author-confirmation boundary and
   * have been committed to Canon.  `staged-author-confirmed` uses this set as
   * an execution barrier; persisted candidate output alone is not authority.
   */
  authorConfirmedTaskIds?: readonly string[]
  /** Ephemeral, caller-authorized connection freeze; never persisted in the plan or RunContract. */
  taskConfigOverrides?: Readonly<Record<string, AIConfig>>
  executionTrace?: MasterAgentExecutionTrace
  onTask?: (
    task: MasterAgentTask,
    status: 'running' | 'completed' | 'failed',
    error?: string,
  ) => void | Promise<void>
}

function scopeRuntimeAssumptionsV1(
  taskId: string,
  assumptions: readonly CreativeAssumptionV1[],
): CreativeAssumptionV1[] {
  return mergeProvisionalAssumptionsV1(assumptions).map(assumption => ({
    ...assumption,
    id: assumption.id.startsWith(`${taskId}:`) ? assumption.id : `${taskId}:${assumption.id}`,
    derivedFrom: [...new Set([`candidate:${taskId}`, ...assumption.derivedFrom])],
  }))
}

async function executeSequentialMasterAgentPlan(
  input: ExecuteMasterAgentPlanInput,
  runtime: { requiredFutureModelCalls?: number } = {},
): Promise<ExecutedMasterCandidate[]> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const candidates: ExecutedMasterCandidate[] = []
  const outputs = new Map<string, string>()
  const runtimeAssumptions = new Map<string, CreativeAssumptionV1[]>()
  const creativeReliabilityEnabled = isCreativeReliabilityRuntimeEnabledV1()
  const contextProfiles = useAIConfigStore.getState().agentContextProfiles
  const budget = input.budget ?? new AgentTeamBudgetTracker(
    useAIConfigStore.getState().agentTeamBudgetProfile,
  )
  for (const [taskId, output] of Object.entries(input.completedTaskOutputs ?? {})) {
    if (output.trim()) outputs.set(taskId, output)
  }
  for (const [taskId, assumptions] of Object.entries(input.completedTaskAssumptions ?? {})) {
    runtimeAssumptions.set(taskId, scopeRuntimeAssumptionsV1(taskId, assumptions))
  }
  const orderedTasks = topologicalTasks(input.plan)
  const stagedAuthorConfirmed = input.plan.workflow?.workflowId === 'staged-author-confirmed'
  const authorConfirmedTaskIds = new Set(input.authorConfirmedTaskIds ?? [])
  for (let taskIndex = 0; taskIndex < orderedTasks.length; taskIndex += 1) {
    const task = orderedTasks[taskIndex]
    if (outputs.has(task.id)) continue
    if (
      stagedAuthorConfirmed
      && task.dependsOn.some(taskId => !authorConfirmedTaskIds.has(taskId))
    ) continue
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await input.executionTrace?.taskStarted?.(task)
    await input.onTask?.(task, 'running')
    try {
      const contentRevision = await captureWorkspaceContentRevisionV1({
        scope,
        worldGroupId: input.worldGroupId,
      })
      const dependencyBindings = await Promise.all(task.dependsOn.map(async taskId => {
        const output = outputs.get(taskId)
        if (!output?.trim()) throw new Error(`主 Agent 任务 ${task.id} 缺少依赖输出 ${taskId}。`)
        return {
          taskId,
          outputHash: await hashCanonicalValue(output),
        }
      }))
      // A staged downstream task must re-read author-confirmed Canon through
      // its registered Context Gateway.  Candidate prose and provisional
      // assumptions remain lineage evidence, never downstream context.
      const upstream = stagedAuthorConfirmed
        ? ''
        : task.dependsOn
            .map(id => outputs.get(id))
            .filter((value): value is string => Boolean(value?.trim()))
            .join('\n\n')
      const inheritedAssumptions = stagedAuthorConfirmed
        ? []
        : mergeProvisionalAssumptionsV1(
            ...task.dependsOn.map(id => runtimeAssumptions.get(id) ?? []),
          )
      const skill = resolveAgentSkillV1(task.agentId, task.skillId)
      const executionBinding = createAgentSkillExecutionBindingV1(skill)
      const contextProfile = contextProfiles[skill.contextTaskKind]
      const budgetSnapshot = budget.snapshot()
      const pendingGenerationCalls = runtime.requiredFutureModelCalls
        ?? orderedTasks.slice(taskIndex).filter(item => (
          !outputs.has(item.id)
          && (
            !stagedAuthorConfirmed
            || item.dependsOn.every(taskId => authorConfirmedTaskIds.has(taskId))
          )
        )).length
      const contextCompressionRuntime = {
        budget,
        requiredFutureModelCalls: pendingGenerationCalls
          + Math.max(0, budgetSnapshot.maxCanonRetries - budgetSnapshot.canonRetries),
      }
      if (task.agentId === 'world-origin') {
        if (skill.executionMode === 'worldview-field') {
          const prepared = await prepareWorldviewFieldCopilot({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            supplementalContext: upstream,
            routingCategory: `${AGENT_ROLE_CATEGORIES['world-origin']}.worldview-field`,
            contextProfile,
            contextCompressionRuntime,
            configOverride: input.taskConfigOverrides?.[task.id],
            promptExecution: task.promptExecution,
            signal: input.signal,
          })
          if (prepared.contextGatewayExecution) {
            await input.executionTrace?.contextGatewayPrepared?.(task, {
              execution: prepared.contextGatewayExecution,
              assembled: prepared.input.assembled,
              renderedRequest: prepared.prepared.messages,
            })
          }
          const result = await runBudgetedGenerationNode({
            node: prepared.node,
            prepared: prepared.prepared,
            budget,
            callLabel: '世界基座字段 Skill',
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
              label: prepared.label,
              contextSources: prepared.contextSources,
              contextEvidence: prepared.contextEvidence,
              baseSnapshot: prepared.snapshot,
              worldviewField: prepared.targetField,
              worldviewFieldOperation: prepared.input.mode,
              worldviewFieldOutputBudget: prepared.input.outputBudget,
              workspaceScope: scope,
              dependsOnTaskIds: task.dependsOn,
              dependencyBindings,
              generator: prepared.modelIdentity,
              structuredOutputEvidence: result.structuredOutputEvidence,
              promptExecutionEvidence: prepared.promptExecutionEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
            ...(prepared.contextGatewayExecution ? {
              contextGatewayRuntime: {
                execution: prepared.contextGatewayExecution,
                assembled: prepared.input.assembled,
                renderedRequest: prepared.prepared.messages,
                rawResponse: result.structuredOutputEvidence ?? result.output,
              },
            } : {}),
          })
          outputs.set(task.id, draft)
        } else if (skill.executionMode === 'story-core') {
          const prepared = await prepareStoryCoreCopilot({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            supplementalContext: upstream,
            routingCategory: `${AGENT_ROLE_CATEGORIES['world-origin']}.story-core`,
            contextProfile,
            contextCompressionRuntime,
            promptExecution: task.promptExecution,
            signal: input.signal,
          })
          if (prepared.contextGatewayExecution) {
            await input.executionTrace?.contextGatewayPrepared?.(task, {
              execution: prepared.contextGatewayExecution,
              assembled: prepared.input.assembled,
              renderedRequest: prepared.prepared.messages,
            })
          }
          const result = await runBudgetedGenerationNode({
            node: prepared.node,
            prepared: prepared.prepared,
            budget,
            callLabel: '故事核心 Skill',
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
              label: prepared.label,
              contextSources: prepared.contextSources,
              contextEvidence: prepared.contextEvidence,
              baseSnapshot: prepared.snapshot,
              storyCoreField: prepared.targetField,
              workspaceScope: scope,
              dependsOnTaskIds: task.dependsOn,
              dependencyBindings,
              generator: prepared.modelIdentity,
              structuredOutputEvidence: result.structuredOutputEvidence,
              promptExecutionEvidence: prepared.promptExecutionEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
            ...(prepared.contextGatewayExecution ? {
              contextGatewayRuntime: {
                execution: prepared.contextGatewayExecution,
                assembled: prepared.input.assembled,
                renderedRequest: prepared.prepared.messages,
                rawResponse: result.structuredOutputEvidence ?? result.output,
              },
            } : {}),
          })
          outputs.set(task.id, draft)
        } else if (skill.executionMode === 'creative-rules') {
          const prepared = await prepareCreativeRulesCopilotV1({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            supplementalContext: upstream,
            routingCategory: `${AGENT_ROLE_CATEGORIES['world-origin']}.creative-rules`,
            contextProfile,
            contextCompressionRuntime,
            signal: input.signal,
          })
          const result = await runBudgetedGenerationNode({
            node: prepared.node,
            prepared: prepared.prepared,
            budget,
            callLabel: '创作规则 Skill',
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
              label: prepared.label,
              contextSources: prepared.contextSources,
              contextEvidence: prepared.contextEvidence,
              baseSnapshot: prepared.snapshot,
              creativeRulesField: prepared.targetField,
              workspaceScope: scope,
              dependsOnTaskIds: task.dependsOn,
              dependencyBindings,
              generator: prepared.modelIdentity,
              structuredOutputEvidence: result.structuredOutputEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
          })
          outputs.set(task.id, draft)
        } else if (skill.executionMode === 'storyline-progress') {
          if (task.storylineProgressChapterId == null) {
            throw new Error('故事线进度任务缺少固定章节 ID。')
          }
          const prepared = await prepareStorylineProgressCopilotV1({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            chapterId: task.storylineProgressChapterId,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            supplementalContext: upstream,
            routingCategory: `${AGENT_ROLE_CATEGORIES.outline}.storyline-progress`,
            contextProfile,
            contextCompressionRuntime,
            signal: input.signal,
          })
          const result = await runBudgetedGenerationNode({
            node: prepared.node,
            prepared: prepared.prepared,
            budget,
            callLabel: '故事线进度映射 Skill',
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
              label: prepared.label,
              contextSources: prepared.contextSources,
              contextEvidence: prepared.contextEvidence,
              baseSnapshot: prepared.snapshot,
              storylineProgressChapterId: prepared.chapterId,
              workspaceScope: scope,
              dependsOnTaskIds: task.dependsOn,
              dependencyBindings,
              generator: prepared.modelIdentity,
              structuredOutputEvidence: result.structuredOutputEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
          })
          outputs.set(task.id, draft)
        } else {
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
        }
      } else if (task.agentId === 'character') {
        if (skill.executionMode === 'lifecycle') {
          if (!task.characterLifecycleRequest) throw new Error('角色状态任务缺少冻结目标与证据。')
          const prepared = await prepareCharacterLifecycleCopilotV1({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            request: task.characterLifecycleRequest,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            contextProfile,
            signal: input.signal,
          })
          await input.executionTrace?.contextGatewayPrepared?.(task, {
            execution: prepared.contextGatewayExecution,
            assembled: prepared.input.assembled,
            renderedRequest: prepared.prepared.messages,
          })
          const result = await runBudgetedGenerationNode({
            node: prepared.node,
            prepared: prepared.prepared,
            budget,
            callLabel: '角色状态演化 Skill',
            maxOutputTokens: skill.maxOutputTokens,
          })
          const draft = serializeCharacterLifecycleCandidateV1(result.output, prepared.snapshot)
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
              characterLifecycleRequest: task.characterLifecycleRequest,
              dependsOnTaskIds: task.dependsOn,
              dependencyBindings,
              generator: prepared.modelIdentity,
              structuredOutputEvidence: result.structuredOutputEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
            contextGatewayRuntime: {
              execution: prepared.contextGatewayExecution,
              assembled: prepared.input.assembled,
              renderedRequest: prepared.prepared.messages,
              rawResponse: result.structuredOutputEvidence ?? result.output,
            },
          })
          outputs.set(task.id, draft)
        } else if (skill.executionMode === 'supplement') {
          if (!task.characterSupplementRequest) throw new Error('角色补全任务缺少固定目标与字段。')
          const prepared = await prepareCharacterSupplementCopilotV1({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            request: task.characterSupplementRequest,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            routingCategory: `${AGENT_ROLE_CATEGORIES.character}.supplement`,
            contextProfile,
            contextCompressionRuntime,
            signal: input.signal,
          })
          if (prepared.contextGatewayExecution) {
            await input.executionTrace?.contextGatewayPrepared?.(task, {
              execution: prepared.contextGatewayExecution,
              assembled: prepared.input.assembled,
              renderedRequest: prepared.prepared.messages,
            })
          }
          const result = await runBudgetedGenerationNode({
            node: prepared.node,
            prepared: prepared.prepared,
            budget,
            callLabel: '已有角色定向补全 Skill',
            maxOutputTokens: skill.maxOutputTokens,
          })
          const draft = serializeCharacterSupplementCandidateV1(
            result.output,
            task.characterSupplementRequest,
          )
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
              characterSupplementRequest: task.characterSupplementRequest,
              dependsOnTaskIds: task.dependsOn,
              dependencyBindings,
              generator: prepared.modelIdentity,
              structuredOutputEvidence: result.structuredOutputEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
            ...(prepared.contextGatewayExecution ? {
              contextGatewayRuntime: {
                execution: prepared.contextGatewayExecution,
                assembled: prepared.input.assembled,
                renderedRequest: prepared.prepared.messages,
                rawResponse: result.structuredOutputEvidence ?? result.output,
              },
            } : {}),
          })
          outputs.set(task.id, draft)
        } else {
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
            promptExecution: task.promptExecution,
            signal: input.signal,
          })
          if (prepared.contextGatewayExecution) {
            await input.executionTrace?.contextGatewayPrepared?.(task, {
              execution: prepared.contextGatewayExecution,
              assembled: prepared.input.assembled,
              renderedRequest: prepared.prepared.messages,
            })
          }
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
              generator: prepared.modelIdentity,
              structuredOutputEvidence: result.structuredOutputEvidence,
              promptExecutionEvidence: prepared.promptExecutionEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
            ...(prepared.contextGatewayExecution ? {
              contextGatewayRuntime: {
                execution: prepared.contextGatewayExecution,
                assembled: prepared.input.assembled,
                renderedRequest: prepared.prepared.messages,
                rawResponse: result.structuredOutputEvidence ?? result.output,
              },
            } : {}),
          })
          outputs.set(task.id, draft)
        }
      } else if (task.agentId === 'inspiration') {
        const workspace = (await readOwnedRows<any>(
          scope,
          'inspirationWorkspaces',
          { owner: 'work' },
        ))[0]
        const availableFragmentIds = new Set(
          parseInspirationFragments(workspace?.fragments).map(fragment => fragment.id),
        )
        const requestedFragmentIds = task.inspirationFragmentIds
        const selectedFragmentIds = (requestedFragmentIds?.length
          ? [...new Set(requestedFragmentIds)].filter(id => availableFragmentIds.has(id))
          : parseInspirationFragments(workspace?.fragments)
              .slice(0, MAX_INSPIRATION_FRAGMENTS)
              .map(fragment => fragment.id))
        if (!selectedFragmentIds.length) throw new Error('项目尚无已保存的灵感碎片。')
        if (requestedFragmentIds?.length && selectedFragmentIds.length !== requestedFragmentIds.length) {
          throw new Error('固定的灵感碎片已变化，请重新选择后生成。')
        }
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
            structuredOutputEvidence: result.structuredOutputEvidence,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      } else if (task.agentId === 'outline') {
        if (skill.executionMode === 'character-revision') {
          if (!task.characterRevisionRequest) {
            throw new Error('角色中途重规划任务缺少固定变更请求。')
          }
          const prepared = await prepareCharacterRevisionCopilotV1({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            request: task.characterRevisionRequest,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            routingCategory: `${AGENT_ROLE_CATEGORIES.outline}.character-revision`,
            contextProfile,
            contextCompressionRuntime,
            signal: input.signal,
          })
          const result = await runBudgetedGenerationNode({
            node: prepared.node,
            prepared: prepared.prepared,
            budget,
            callLabel: '角色变更影响与中途重规划 Skill',
            maxOutputTokens: skill.maxOutputTokens,
          })
          const draft = serializeCharacterRevisionCandidateV1(result.output)
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
              characterRevisionRequest: task.characterRevisionRequest,
              dependsOnTaskIds: task.dependsOn,
              dependencyBindings,
              structuredOutputEvidence: result.structuredOutputEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
          })
          outputs.set(task.id, draft)
        } else if (skill.executionMode === 'character-driven') {
          if (task.characterDrivenPlanId == null) {
            throw new Error('角色驱动规划任务缺少固定方案 ID。')
          }
          const prepared = await prepareCharacterDrivenCopilotV1({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            planId: task.characterDrivenPlanId,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            routingCategory: `${AGENT_ROLE_CATEGORIES.outline}.character-driven`,
            contextProfile,
            contextCompressionRuntime,
            signal: input.signal,
          })
          const result = await runBudgetedGenerationNode({
            node: prepared.node,
            prepared: prepared.prepared,
            budget,
            callLabel: '角色驱动卷章编排 Skill',
            maxOutputTokens: skill.maxOutputTokens,
            validate: output => validateDomainCandidateCanon({
              agentId: task.agentId,
              projectId: input.projectId,
              worldGroupId: input.worldGroupId,
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
              characterDrivenPlanId: prepared.snapshot.planId,
              dependsOnTaskIds: task.dependsOn,
              dependencyBindings,
              structuredOutputEvidence: result.structuredOutputEvidence,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
          })
          outputs.set(task.id, draft)
        } else if (skill.executionMode === 'story-arcs') {
          const prepared = await prepareStoryArcCopilot({
            projectId: input.projectId,
            scope,
            worldGroupId: input.worldGroupId,
            authorRequest: task.instruction,
            skillId: skill.id as AgentSkillId,
            supplementalContext: upstream,
            routingCategory: `${AGENT_ROLE_CATEGORIES.outline}.story-arcs`,
            contextProfile,
            contextCompressionRuntime,
            inheritedAssumptions,
            creativeReliabilityEnabled,
            mutationRequest: task.storyArcMutationRequest,
            signal: input.signal,
          })
          if (prepared.contextGatewayExecution) {
            await input.executionTrace?.contextGatewayPrepared?.(task, {
              execution: prepared.contextGatewayExecution,
              assembled: prepared.input.assembled,
              renderedRequest: prepared.prepared.messages,
            })
          }
          if (creativeReliabilityEnabled) {
            const result = await runStoryArcCreativeReliabilityV1({
              prepared,
              budget,
              qualityMode: useAIConfigStore.getState().creativeQualityMode,
              validate: output => validateDomainCandidateCanon({
                agentId: task.agentId,
                projectId: input.projectId,
                worldGroupId: input.worldGroupId,
                outputText: JSON.stringify(output),
              }),
            })
            const draft = result.draft
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
                storyArcKind: prepared.kind,
                storyArcMutationRequest: prepared.mutation,
                dependsOnTaskIds: task.dependsOn,
                dependencyBindings,
                creativeArtifact: result.artifact,
                narrativeBrief: prepared.input.narrativeBrief,
              },
              draft,
              runtimeNode: prepared.node,
              runtimeOutput: result.output,
              ...(prepared.contextGatewayExecution ? {
                contextGatewayRuntime: {
                  execution: prepared.contextGatewayExecution,
                  assembled: prepared.input.assembled,
                  renderedRequest: prepared.prepared.messages,
                  rawResponse: result.artifact,
                },
              } : {}),
            })
            outputs.set(task.id, draft)
          } else {
            const result = await runBudgetedGenerationNode({
              node: prepared.node,
              prepared: prepared.prepared,
              budget,
              callLabel: '故事线编排 Skill',
              maxOutputTokens: skill.maxOutputTokens,
              validate: output => validateDomainCandidateCanon({
                agentId: task.agentId,
                projectId: input.projectId,
                worldGroupId: input.worldGroupId,
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
                storyArcKind: prepared.kind,
                storyArcMutationRequest: prepared.mutation,
                dependsOnTaskIds: task.dependsOn,
                dependencyBindings,
                structuredOutputEvidence: result.structuredOutputEvidence,
              },
              draft,
              runtimeNode: prepared.node,
              runtimeOutput: result.output,
              ...(prepared.contextGatewayExecution ? {
                contextGatewayRuntime: {
                  execution: prepared.contextGatewayExecution,
                  assembled: prepared.input.assembled,
                  renderedRequest: prepared.prepared.messages,
                  rawResponse: result.structuredOutputEvidence ?? result.output,
                },
              } : {}),
            })
            outputs.set(task.id, draft)
          }
        } else {
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
            inheritedAssumptions,
            creativeReliabilityEnabled,
            signal: input.signal,
          })
          await input.executionTrace?.contextGatewayPrepared?.(task, {
            execution: prepared.contextGatewayExecution,
            assembled: prepared.input.assembled,
            renderedRequest: prepared.prepared.messages,
          })
          if (creativeReliabilityEnabled) {
            const result = await runOutlineCreativeReliabilityV1({
              prepared,
              budget,
              qualityMode: useAIConfigStore.getState().creativeQualityMode,
              validate: output => validateDomainCandidateCanon({
                agentId: task.agentId,
                projectId: input.projectId,
                worldGroupId: input.worldGroupId,
                outlineNodeId: prepared.parentVolumeId,
                outputText: JSON.stringify(output),
              }),
            })
            const draft = result.draft
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
                creativeArtifact: result.artifact,
                narrativeBrief: prepared.input.narrativeBrief,
              },
              draft,
              runtimeNode: prepared.node,
              runtimeOutput: result.output,
              contextGatewayRuntime: {
                execution: prepared.contextGatewayExecution,
                assembled: prepared.input.assembled,
                renderedRequest: prepared.prepared.messages,
                rawResponse: result.artifact.originalText,
              },
            })
            outputs.set(task.id, draft)
          } else {
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
                structuredOutputEvidence: result.structuredOutputEvidence,
              },
              draft,
              runtimeNode: prepared.node,
              runtimeOutput: result.output,
              contextGatewayRuntime: {
                execution: prepared.contextGatewayExecution,
                assembled: prepared.input.assembled,
                renderedRequest: prepared.prepared.messages,
                rawResponse: result.structuredOutputEvidence ?? result.output,
              },
            })
            outputs.set(task.id, draft)
          }
        }
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
          inheritedAssumptions,
          creativeReliabilityEnabled,
          perspectiveCharacterId: task.perspectiveCharacterId ?? null,
          signal: input.signal,
        })
        await input.executionTrace?.contextGatewayPrepared?.(task, {
          execution: prepared.contextGatewayExecution,
          assembled: prepared.input.assembled,
          renderedRequest: prepared.prepared.messages,
        })
        if (creativeReliabilityEnabled) {
          const result = await runProseCreativeReliabilityV1({
            prepared,
            budget,
            qualityMode: useAIConfigStore.getState().creativeQualityMode,
            validate: output => validateDomainCandidateCanon({
              agentId: task.agentId,
              projectId: input.projectId,
              worldGroupId: input.worldGroupId,
              outlineNodeId: prepared.outlineNodeId,
              outputText: output,
            }),
          })
          const draft = result.draft
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
              creativeArtifact: result.artifact,
              narrativeBrief: prepared.input.narrativeBrief,
              informationBoundary: prepared.informationBoundary,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
            contextGatewayRuntime: {
              execution: prepared.contextGatewayExecution,
              assembled: prepared.input.assembled,
              renderedRequest: prepared.prepared.messages,
              rawResponse: result.artifact,
            },
          })
          outputs.set(task.id, draft)
        } else {
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
              informationBoundary: prepared.informationBoundary,
            },
            draft,
            runtimeNode: prepared.node,
            runtimeOutput: result.output,
            contextGatewayRuntime: {
              execution: prepared.contextGatewayExecution,
              assembled: prepared.input.assembled,
              renderedRequest: prepared.prepared.messages,
              rawResponse: result.output,
            },
          })
          outputs.set(task.id, draft)
        }
      }
      const candidate = candidates[candidates.length - 1]
      candidate.payload.contentRevision = contentRevision
      await assertWorkspaceContentRevisionFreshV1(contentRevision, {
        scope,
        worldGroupId: input.worldGroupId,
      })
      const candidateAssumptions = candidate.payload.creativeArtifact?.assumptions
        ?? candidate.payload.narrativeBrief?.assumptions
        ?? []
      runtimeAssumptions.set(
        task.id,
        scopeRuntimeAssumptionsV1(task.id, candidateAssumptions),
      )
      candidate.payload.teamBudgetEvidence = budget.snapshot()
      await input.executionTrace?.candidateReady?.(task, candidate)
      await input.onTask?.(task, 'completed')
    } catch (error) {
      await input.executionTrace?.taskFailed?.(task, error)
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
  const runtimeAssumptions = new Map<string, CreativeAssumptionV1[]>()
  for (const [taskId, output] of Object.entries(input.completedTaskOutputs ?? {})) {
    if (output.trim()) outputs.set(taskId, output)
  }
  for (const [taskId, assumptions] of Object.entries(input.completedTaskAssumptions ?? {})) {
    runtimeAssumptions.set(taskId, scopeRuntimeAssumptionsV1(taskId, assumptions))
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
    const completedTaskAssumptions = Object.fromEntries(runtimeAssumptions)
    const requiredFutureModelCalls = input.plan.tasks.length - completed.size
    const settled = await Promise.all(batch.map(async task => {
      try {
        const generated = await executeSequentialMasterAgentPlan({
          ...input,
          plan: { summary: input.plan.summary, tasks: [task] },
          budget,
          completedTaskOutputs,
          completedTaskAssumptions,
          executionTrace: input.executionTrace?.contextGatewayPrepared
            ? {
                contextGatewayPrepared: input.executionTrace.contextGatewayPrepared,
                ...(input.executionTrace.taskFailed
                  ? { taskFailed: input.executionTrace.taskFailed }
                  : {}),
              }
            : input.executionTrace?.taskFailed
              ? { taskFailed: input.executionTrace.taskFailed }
            : undefined,
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
      runtimeAssumptions.set(
        item.task.id,
        scopeRuntimeAssumptionsV1(
          item.task.id,
          item.candidate.payload.creativeArtifact?.assumptions
            ?? item.candidate.payload.narrativeBrief?.assumptions
            ?? [],
        ),
      )
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
  assertMasterCreativeArtifactAdoptableV1(input.payload)
  const scope = await resolveCandidateScope(input)
  await assertMasterCandidateDependenciesAdoptedV1(input.event, input.payload, scope)
  if (input.payload.skillId === 'character.lifecycle') {
    if (!input.payload.characterLifecycleRequest) {
      throw new Error('角色状态候选缺少冻结目标与证据，请重新生成。')
    }
    await adoptRestoredCharacterLifecycleCandidateV1({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      snapshot: input.payload.baseSnapshot as CharacterLifecycleSnapshotV1,
      draft: input.draft,
      producerRunContractHash: input.payload.runId == null
        ? null
        : (await db.agentRuns.get(input.payload.runId))?.contractHash ?? null,
      producerCandidateHash: input.payload.candidateHash ?? null,
    })
  } else if (input.payload.skillId === 'outline.story-arcs') {
    await adoptRestoredStoryArcCandidate({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      snapshot: input.payload.baseSnapshot as StoryArcCopilotSnapshot,
      draft: input.draft,
      producerRunId: input.payload.runId,
      producerCandidateHash: input.payload.candidateHash,
      mutation: input.payload.storyArcMutationRequest,
    })
  } else if (input.runtime) {
    const output = input.payload.skillId === 'world-origin.worldview-field'
      ? parseWorldviewFieldCandidateDraft(input.draft)
      : input.payload.skillId === 'world-origin.story-core'
      ? parseStoryCoreCandidateDraft(input.draft)
      : input.payload.skillId === 'world-origin.creative-rules'
      ? parseCreativeRulesCandidateDraftV1(input.draft)
      : input.payload.skillId === 'outline.storyline-progress'
      ? parseStorylineProgressCandidateDraftV1(input.draft)
      : input.payload.skillId === 'outline.character-driven'
      ? parseCharacterDrivenCandidateDraftV1(input.draft)
      : input.payload.skillId === 'outline.character-revision'
      ? parseCharacterRevisionCandidateDraftV1(
          input.draft,
          input.payload.baseSnapshot as CharacterRevisionCopilotSnapshotV1,
        )
      : input.payload.agentId === 'world-origin'
      ? input.draft
      : input.payload.agentId === 'character'
        ? input.payload.skillId === 'character.supplement'
          ? parseCharacterSupplementCandidateDraftV1(
              input.draft,
              input.payload.characterSupplementRequest!,
            )
          : parseCharacterCandidateDraft(input.draft)
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
    if (input.payload.skillId === 'world-origin.worldview-field') {
      if (!input.payload.worldviewField) throw new Error('世界基座候选缺少目标字段，请重新生成。')
      await adoptRestoredWorldviewFieldCandidate({
        projectId: input.projectId,
        scope,
        worldGroupId: input.worldGroupId,
        snapshot: input.payload.baseSnapshot as WorldviewFieldCopilotSnapshot,
        targetField: input.payload.worldviewField,
        draft: input.draft,
      })
    } else if (input.payload.skillId === 'world-origin.story-core') {
      if (!input.payload.storyCoreField) throw new Error('故事核心候选缺少目标字段，请重新生成。')
      await adoptRestoredStoryCoreCandidate({
        projectId: input.projectId,
        scope,
        snapshot: input.payload.baseSnapshot as StoryCoreCopilotSnapshot,
        targetField: input.payload.storyCoreField,
        draft: input.draft,
      })
    } else if (input.payload.skillId === 'world-origin.creative-rules') {
      if (!input.payload.creativeRulesField) throw new Error('创作规则候选缺少目标字段，请重新生成。')
      await adoptRestoredCreativeRulesCandidateV1({
        projectId: input.projectId,
        scope,
        snapshot: input.payload.baseSnapshot as CreativeRulesCopilotSnapshotV1,
        targetField: input.payload.creativeRulesField,
        draft: input.draft,
      })
    } else {
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
    }
  } else if (input.payload.agentId === 'character') {
    if (input.payload.skillId === 'character.supplement') {
      if (!input.payload.characterSupplementRequest) {
        throw new Error('角色补全候选缺少固定目标与字段，请重新生成。')
      }
      await adoptRestoredCharacterSupplementCandidateV1({
        projectId: input.projectId,
        scope,
        worldGroupId: input.worldGroupId,
        snapshot: input.payload.baseSnapshot as CharacterSupplementCopilotSnapshotV1,
        draft: input.draft,
      })
    } else {
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
    }
  } else if (input.payload.agentId === 'inspiration') {
    const base = input.payload.baseSnapshot as InspirationWorkspaceSnapshot
    const current = await currentInspirationSnapshot(scope)
    if (JSON.stringify(base) !== JSON.stringify(current)) throw new Error('灵感工作区已变化，请重新生成。')
    const mode = input.payload.mode ?? 'single'
    const result = parseInspirationCandidateDraft(input.draft, mode)
    const parentVersionId = latestInspirationVersion(
      parseInspirationVersions(base.versions),
      mode,
    )?.id ?? null
    await useInspirationWorkspaceStore.getState().load(scope)
    await useInspirationWorkspaceStore.getState().saveVersion(scope, {
      mode,
      parentVersionId,
      fragmentIds: input.payload.selectedFragmentIds ?? [],
      result: result as InspirationCopilotResult,
    })
  } else if (input.payload.agentId === 'outline') {
    if (input.payload.skillId === 'outline.character-revision') {
      if (!input.payload.characterRevisionRequest) {
        throw new Error('角色中途重规划候选缺少固定变更请求，请重新生成。')
      }
      await adoptRestoredCharacterRevisionCandidateV1({
        projectId: input.projectId,
        scope,
        snapshot: input.payload.baseSnapshot as CharacterRevisionCopilotSnapshotV1,
        draft: input.draft,
      })
    } else if (input.payload.skillId === 'outline.character-driven') {
      if (input.payload.characterDrivenPlanId == null) {
        throw new Error('角色驱动候选缺少目标方案，请重新生成。')
      }
      await adoptRestoredCharacterDrivenCandidateV1({
        projectId: input.projectId,
        scope,
        planId: input.payload.characterDrivenPlanId,
        snapshot: input.payload.baseSnapshot as CharacterDrivenCopilotSnapshotV1,
        draft: input.draft,
      })
    } else if (input.payload.skillId === 'outline.storyline-progress') {
      if (input.payload.storylineProgressChapterId == null) {
        throw new Error('故事线进度候选缺少目标章节，请重新生成。')
      }
      await adoptRestoredStorylineProgressCandidateV1({
        projectId: input.projectId,
        scope,
        chapterId: input.payload.storylineProgressChapterId,
        snapshot: input.payload.baseSnapshot as StorylineProgressCopilotSnapshotV1,
        draft: input.draft,
      })
    } else {
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
    }
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
    useStoryArcStore.getState().loadAll(scope),
    useChapterStore.getState().loadAll(scope),
    useCharacterDrivenPlanStore.getState().loadAll(scope),
  ])
  return input.payload.agentId === 'world-origin'
    ? input.payload.skillId === 'world-origin.worldview-field'
      ? `世界基座“${input.payload.label}”已写入当前世界。`
      : input.payload.skillId === 'world-origin.story-core'
      ? `故事核心“${input.payload.label}”已写入项目。`
      : input.payload.skillId === 'world-origin.creative-rules'
      ? `创作规则“${input.payload.label}”已写入项目。`
      : '世界来源已写入项目。'
    : input.payload.agentId === 'character'
      ? input.payload.skillId === 'character.lifecycle'
        ? `角色状态已更新为 ${(parseCharacterLifecycleCandidateV1(
            input.draft,
            input.payload.baseSnapshot as CharacterLifecycleSnapshotV1,
          )).targetStatus}。`
      : input.payload.skillId === 'character.supplement'
        ? `角色设定已补全 ${input.payload.characterSupplementRequest?.dimensions.length ?? 0} 个字段。`
        : `角色“${(parseCharacterCandidateDraft(input.draft) as CharacterCopilotCandidate).name}”已加入项目。`
      : input.payload.agentId === 'inspiration'
        ? `已保存新的${input.payload.mode === 'multiworld' ? '多世界' : '单世界'}灵感版本。`
        : input.payload.agentId === 'outline'
          ? input.payload.skillId === 'outline.character-revision'
            ? '选中的未来大纲 patch 已写入项目；已写正文、故事主线和只读影响建议均未修改。'
            : input.payload.skillId === 'outline.character-driven'
            ? '角色驱动卷章方案已保存到当前版本。'
            : input.payload.skillId === 'outline.story-arcs'
            ? '故事线已写入项目。'
            : input.payload.skillId === 'outline.storyline-progress'
            ? '本章故事线进度、交汇和疑似新线候选已按作者确认写入项目。'
            : input.payload.outlineMode === 'volumes'
            ? '卷级大纲已写入项目。'
            : '章节大纲已写入目标卷。'
          : input.payload.proseOperation === 'continue'
            ? '续写内容已追加到目标章节。'
            : '正文已写入目标章节。'
}

export function assertMasterCreativeArtifactAdoptableV1(payload: MasterCandidatePayload): void {
  const artifact = payload.creativeArtifact
  if (!artifact || creativeArtifactCanAdoptV1(artifact)) return
  const summary = artifact.issues.slice(0, 3).map(issue => issue.message).join('；')
  throw new Error(
    artifact.status === 'blocked'
      ? `该候选存在阻断问题，不能采纳。${summary}`
      : `该候选需要手动修复并通过本地校验后才能采纳。${summary}`,
  )
}
