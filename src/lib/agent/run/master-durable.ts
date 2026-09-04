import Dexie from 'dexie'
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
  collectMasterAgentAffectedTaskIdsV1,
  createMasterAgentReplanV1,
  executeMasterAgentPlan,
  type ExecutedMasterCandidate,
  type MasterAgentExecutionTrace,
  type MasterAgentReplanFailureV1,
  type MasterAgentPlan,
  type MasterAgentTask,
  type MasterCandidateDependencyBindingV1,
  type MasterCandidatePayload,
} from '../orchestrator'
import { parseCharacterSupplementTaskInputV1 } from '../character-supplement-copilot'
import { parseCharacterLifecycleTaskInputV1 } from '../character-lifecycle-copilot'
import type { AgentTeamBudgetEvidence } from '../team-budget'
import { parseCreativeArtifactV1 } from '../creative-reliability'
import {
  parseStructuredOutputRunEvidenceV1,
  structuredOutputFailureEvidenceV1,
} from '../structured-output-pipeline'
import { parseNarrativeBriefV1 } from '../narrative-brief'
import { parseInformationBoundaryManifestV1 } from '../information-boundary'
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
  appendPrivilegedAgentRunEventInTransactionV1,
  createAgentRunV1,
  readAgentRunV1,
  readVerifiedAgentRunInTransactionV1,
  withAgentRunMutationLockV1,
  type AgentRunSnapshotV1,
} from './event-store'
import {
  beginAgentRunRecoveryV1,
  createAgentRunCheckpointInTransactionV1,
  createAgentRunCheckpointV1,
  completeAgentRunRecoveryV1,
  readLatestVerifiedAgentRunCheckpointV1,
} from './checkpoint'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { parseAgentRunEventV1 } from './event-schema'
import {
  classifyAgentRunFailureV1,
  matchingFailureCountV1,
} from './failure-policy'
import { maybeInjectHarnessFaultV1 } from '../dev-fault-injection'
import {
  MASTER_CANDIDATE_STEP_VERIFIER_SET_VERSION_V1,
  contextManifestHashForStepAttemptV1,
  createMasterCandidateStepReceiptV1,
  readFreshMasterCandidateStepReceiptV1,
  verifyHistoricalMasterCandidateStepReceiptV1,
} from './master-step-verification'
import {
  AgentTeamBudgetExceededError,
  AgentTeamBudgetTracker,
  AGENT_TEAM_BUDGET_PROFILES,
  resolveAgentTeamBudgetPolicy,
  type AgentTeamBudgetProfile,
} from '../team-budget'
import { db } from '../../db/schema'
import { assertRecordInScope, readOwnedRows, scopeTransactionTables } from '../../workspace/scope'
import {
  MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1,
  MasterCandidateSemanticReviewBlockedError,
  masterCandidateReviewStepIdV1,
  parseMasterCandidateSemanticReviewArtifactV1,
  runMasterCandidateSemanticReviewWithClientV1,
  verifyMasterCandidateSemanticReviewArtifactV1,
} from '../master-candidate-semantic-review'
import { STORY_CORE_FIELDS, resolveStoryCoreFieldV1 } from '../story-core-copilot'
import { CREATIVE_RULES_FIELDS, resolveCreativeRulesFieldV1 } from '../creative-rules-copilot'
import {
  WORLDVIEW_AGENT_FIELDS,
  parseWorldviewFieldOutputBudgetV1,
  resolveWorldviewAgentFieldV1,
} from '../worldview-field-copilot'
import { MAX_INSPIRATION_FRAGMENTS } from '../../inspiration/workspace'
import { parseCharacterRevisionTaskInputV1 } from '../character-revision-copilot'
import {
  parseStoryArcMutationRequestV1,
  type StoryArcMutationRequestV1,
} from '../story-arc-copilot'
import { parseWorkspaceContentRevisionV1 } from '../../authoring/content-revision'
import {
  assertPromptEvidenceMatchesOptionsV1,
  parsePromptExecutionEvidenceV1,
  parsePromptExecutionOptionsV1,
  type GovernedPromptModuleKeyV1,
} from '../prompt-execution'
import {
  computeMasterCandidateHashV1,
  isMasterCandidateContextGatewayRequiredV1,
} from './master-candidate-hash'
import {
  finalizeContextGatewayAttemptEvidenceV1,
  recordContextGatewayPreflightEvidenceV1,
  type ContextGatewayPreflightEvidenceV1,
} from '../../context-gateway/attempt-evidence'
import {
  createContextManifestFromAssemblyV1,
  createContextManifestV2FromV1,
} from './context-manifest'
import { isContextGatewayRequiredForWriteTargetV1 } from '../../context-gateway/skill-policy'
import type { ContextManifestV2 } from '../../types/agent-run'
import { recordAgentRunArtifactV1 } from '../../memory/artifact-store'

export const MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1 = 'master-agent-plan'
export const MASTER_AGENT_PLAN_CHECKPOINT_VERSION_V1 = 1 as const
export const MAX_MASTER_AGENT_REPLANS_V1 = 1

const MAX_PLAN_TASKS = 5
const MAX_PLAN_SUMMARY_CHARS = 500
const MAX_TASK_ID_CHARS = 80
const MAX_TASK_INSTRUCTION_CHARS = 8_000
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
  /** Explicit creation-time policy. The choice is frozen into the durable Run Contract. */
  candidateSemanticReview?: 'required' | 'disabled'
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
  replan?: typeof createMasterAgentReplanV1
  semanticReview?: typeof runMasterCandidateSemanticReviewWithClientV1
  /** Deterministic failure inspection only; production may never disable the current replan path. */
  disableAutomaticReplanForTest?: boolean
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
      ['taskId', 'outputHash', 'candidateHash', 'generation'],
      ['verificationReceiptHash'],
      `${label}[${index}]`,
    )
    const candidateHash = readHash(item.candidateHash, `${label}[${index}].candidateHash`)
    const generation = readInteger(item.generation, `${label}[${index}].generation`)
    if (generation < 1) fail(`${label}[${index}].generation 无效`)
    const verificationReceiptHash = item.verificationReceiptHash === undefined
      ? undefined
      : readHash(item.verificationReceiptHash, `${label}[${index}].verificationReceiptHash`)
    return {
      taskId: readString(item.taskId, `${label}[${index}].taskId`, MAX_TASK_ID_CHARS),
      outputHash: readHash(item.outputHash, `${label}[${index}].outputHash`),
      candidateHash,
      generation,
      ...(verificationReceiptHash ? { verificationReceiptHash } : {}),
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

function readOptionalInspirationFragmentIds(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  label: string,
): string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, 'inspirationFragmentIds')) return undefined
  if (agentId !== 'inspiration' || !Array.isArray(value.inspirationFragmentIds)) {
    fail(label + '.inspirationFragmentIds 无效')
  }
  const ids = [...new Set(value.inspirationFragmentIds)]
  if (
    ids.length < 1
    || ids.length > MAX_INSPIRATION_FRAGMENTS
    || ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 120)
  ) {
    fail(label + '.inspirationFragmentIds 无效')
  }
  return ids as string[]
}

function readOptionalCharacterDrivenPlanId(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  skillId: AgentSkillId | undefined,
  label: string,
): number | undefined {
  const present = Object.prototype.hasOwnProperty.call(value, 'characterDrivenPlanId')
  if (!present) {
    if (skillId === 'outline.character-driven') {
      fail(label + '.characterDrivenPlanId 缺失')
    }
    return undefined
  }
  if (
    agentId !== 'outline'
    || skillId !== 'outline.character-driven'
    || !Number.isInteger(value.characterDrivenPlanId)
    || Number(value.characterDrivenPlanId) < 1
  ) fail(label + '.characterDrivenPlanId 无效')
  return Number(value.characterDrivenPlanId)
}

function readOptionalCharacterRevisionRequest(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  skillId: AgentSkillId | undefined,
  label: string,
) {
  const present = Object.prototype.hasOwnProperty.call(value, 'characterRevisionRequest')
  if (!present) {
    if (skillId === 'outline.character-revision') {
      fail(label + '.characterRevisionRequest 缺失')
    }
    return undefined
  }
  if (agentId !== 'outline' || skillId !== 'outline.character-revision') {
    fail(label + '.characterRevisionRequest 无效')
  }
  try {
    return parseCharacterRevisionTaskInputV1(value.characterRevisionRequest)
  } catch (error) {
    fail(`${label}.characterRevisionRequest 无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

function readOptionalCharacterSupplementRequest(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  skillId: AgentSkillId | undefined,
  label: string,
) {
  const present = Object.prototype.hasOwnProperty.call(value, 'characterSupplementRequest')
  if (!present) {
    if (skillId === 'character.supplement') fail(label + '.characterSupplementRequest 缺失')
    return undefined
  }
  if (agentId !== 'character' || skillId !== 'character.supplement') {
    fail(label + '.characterSupplementRequest 无效')
  }
  try {
    return parseCharacterSupplementTaskInputV1(value.characterSupplementRequest)
  } catch (error) {
    fail(`${label}.characterSupplementRequest 无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

function readOptionalCharacterLifecycleRequest(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  skillId: AgentSkillId | undefined,
  label: string,
) {
  const present = Object.prototype.hasOwnProperty.call(value, 'characterLifecycleRequest')
  if (!present) {
    if (skillId === 'character.lifecycle') fail(label + '.characterLifecycleRequest 缺失')
    return undefined
  }
  if (agentId !== 'character' || skillId !== 'character.lifecycle') {
    fail(label + '.characterLifecycleRequest 无效')
  }
  try {
    return parseCharacterLifecycleTaskInputV1(value.characterLifecycleRequest)
  } catch (error) {
    fail(`${label}.characterLifecycleRequest 无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

function readOptionalStorylineProgressChapterId(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  skillId: AgentSkillId | undefined,
  label: string,
): number | undefined {
  const present = Object.prototype.hasOwnProperty.call(value, 'storylineProgressChapterId')
  if (!present) {
    if (skillId === 'outline.storyline-progress') fail(label + '.storylineProgressChapterId 缺失')
    return undefined
  }
  if (agentId !== 'outline' || skillId !== 'outline.storyline-progress') {
    fail(label + '.storylineProgressChapterId 无效')
  }
  const chapterId = readInteger(value.storylineProgressChapterId, label + '.storylineProgressChapterId')
  if (chapterId < 1) fail(label + '.storylineProgressChapterId 无效')
  return chapterId
}

function readOptionalStoryArcMutationRequest(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  skillId: AgentSkillId | undefined,
  label: string,
): StoryArcMutationRequestV1 | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, 'storyArcMutationRequest')) return undefined
  if (agentId !== 'outline' || skillId !== 'outline.story-arcs') {
    fail(label + '.storyArcMutationRequest 无效')
  }
  try {
    return parseStoryArcMutationRequestV1(value.storyArcMutationRequest)
  } catch (error) {
    fail(`${label}.storyArcMutationRequest 无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

function readRequiredSkillId(
  value: Record<string, unknown>,
  agentId: DomainAgentId,
  label: string,
): AgentSkillId {
  if (!Object.prototype.hasOwnProperty.call(value, 'skillId')) fail(label + '.skillId 缺失')
  if (typeof value.skillId !== 'string') fail(label + '.skillId 无效')
  const skill = getAgentSkillV1(value.skillId, agentId)
  const allowedModes: Record<DomainAgentId, ReadonlySet<string>> = {
    'world-origin': new Set(['worldview-field', 'story-core', 'creative-rules']),
    character: new Set(['create', 'supplement', 'lifecycle']),
    inspiration: new Set(['reverse']),
    outline: new Set(['auto', 'story-arcs', 'storyline-progress', 'character-driven', 'character-revision', 'volumes', 'chapters']),
    prose: new Set(['auto', 'generate', 'continue']),
  }
  if (!allowedModes[agentId].has(skill.executionMode)) {
    fail(`${label}.skillId 不是主计划可直接执行的生成 Skill`)
  }
  return skill.id as AgentSkillId
}

function promptModuleForPlanTaskV1(
  agentId: DomainAgentId,
  skillId: AgentSkillId | undefined,
): GovernedPromptModuleKeyV1 | null {
  const skill = resolveAgentSkillV1(agentId, skillId)
  if (skill.executionMode === 'worldview-field') return 'worldview.dimension'
  if (skill.executionMode === 'story-core') return 'story.generate'
  if (agentId === 'character' && skill.executionMode === 'create') return 'character.generate'
  return null
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
  assertKeysWithOptional(value, ['summary', 'tasks', 'workflow'], [], '主 Agent 计划')
  const summary = readString(value.summary, '主 Agent 计划 summary', MAX_PLAN_SUMMARY_CHARS)
  if (!Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > MAX_PLAN_TASKS) {
    fail(`主 Agent 计划任务数必须在 1-${MAX_PLAN_TASKS} 之间`)
  }
  const ids = new Set<string>()
  const tasks: MasterAgentTask[] = value.tasks.map((item, index) => {
    if (!isRecord(item)) fail(`主 Agent 计划任务 ${index + 1} 无效`)
    assertKeysWithOptional(
      item,
      ['id', 'agentId', 'skillId', 'instruction', 'dependsOn'],
      ['perspectiveCharacterId', 'inspirationFragmentIds', 'characterDrivenPlanId', 'characterRevisionRequest', 'characterSupplementRequest', 'characterLifecycleRequest', 'storylineProgressChapterId', 'storyArcMutationRequest', 'promptExecution'],
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
    const skillId = readRequiredSkillId(item, agentId, '主 Agent 计划任务 ' + id)
    const inspirationFragmentIds = readOptionalInspirationFragmentIds(
      item,
      agentId,
      '主 Agent 计划任务 ' + id,
    )
    const characterDrivenPlanId = readOptionalCharacterDrivenPlanId(
      item,
      agentId,
      skillId,
      '主 Agent 计划任务 ' + id,
    )
    const characterRevisionRequest = readOptionalCharacterRevisionRequest(
      item,
      agentId,
      skillId,
      '主 Agent 计划任务 ' + id,
    )
    const characterSupplementRequest = readOptionalCharacterSupplementRequest(
      item,
      agentId,
      skillId,
      '主 Agent 计划任务 ' + id,
    )
    const characterLifecycleRequest = readOptionalCharacterLifecycleRequest(
      item,
      agentId,
      skillId,
      '主 Agent 计划任务 ' + id,
    )
    const storylineProgressChapterId = readOptionalStorylineProgressChapterId(
      item,
      agentId,
      skillId,
      '主 Agent 计划任务 ' + id,
    )
    const storyArcMutationRequest = readOptionalStoryArcMutationRequest(
      item,
      agentId,
      skillId,
      '主 Agent 计划任务 ' + id,
    )
    const expectedPromptModule = promptModuleForPlanTaskV1(agentId, skillId)
    const promptExecution = item.promptExecution === undefined
      ? undefined
      : expectedPromptModule
        ? parsePromptExecutionOptionsV1(item.promptExecution, expectedPromptModule)
        : fail(`主 Agent 计划任务 ${id} 的 Skill 不允许 Prompt 执行选项`)
    return {
      id,
      agentId,
      skillId,
      instruction,
      dependsOn,
      ...(perspectiveCharacterId !== undefined ? { perspectiveCharacterId } : {}),
      ...(inspirationFragmentIds !== undefined ? { inspirationFragmentIds } : {}),
      ...(characterDrivenPlanId !== undefined ? { characterDrivenPlanId } : {}),
      ...(characterRevisionRequest !== undefined ? { characterRevisionRequest } : {}),
      ...(characterSupplementRequest !== undefined ? { characterSupplementRequest } : {}),
      ...(characterLifecycleRequest !== undefined ? { characterLifecycleRequest } : {}),
      ...(storylineProgressChapterId !== undefined ? { storylineProgressChapterId } : {}),
      ...(storyArcMutationRequest !== undefined ? { storyArcMutationRequest } : {}),
      ...(promptExecution !== undefined ? { promptExecution } : {}),
    }
  })
  const workflow = parseMasterWorkflowSelectionV1(value.workflow)
  const result: MasterAgentPlan = {
    summary,
    tasks,
    workflow,
  }
  const known = new Set(tasks.map(task => task.id))
  tasks.forEach(task => task.dependsOn.forEach(dep => {
    if (!known.has(dep)) fail(`主 Agent 计划任务 ${task.id} 依赖不存在的任务 ${dep}`)
  }))
  assertAcyclic(result)
  assertMasterWorkflowTaskCompatibilityV1(workflow, tasks)
  return result
}

export async function hashMasterAgentPlanV1(plan: MasterAgentPlan): Promise<string> {
  return hashCanonicalValue(parseMasterAgentPlanV1(plan))
}

function sourceKeysForPlan(plan: MasterAgentPlan): string[] {
  return [...new Set(plan.tasks.flatMap(task => {
    const skill = resolveAgentSkillV1(task.agentId, task.skillId)
    return resolveAgentSkillContextSourceKeysV1(skill, {
      includeOptional: (task.agentId === 'prose' && task.perspectiveCharacterId != null)
        || (task.skillId === 'character.supplement' && task.characterSupplementRequest?.useEvidence === true),
      includeGatewayProviders: true,
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
    const writeTargets = skill.executionMode === 'worldview-field'
      ? skill.writeTargets.map(target => target.table === 'worldviews'
          ? { ...target, fields: [resolveWorldviewAgentFieldV1(task.instruction)] }
          : target)
      : skill.executionMode === 'story-core'
        ? skill.writeTargets.map(target => target.table === 'storyCores'
            ? { ...target, fields: [resolveStoryCoreFieldV1(task.instruction)] }
            : target)
        : skill.executionMode === 'creative-rules'
          ? skill.writeTargets.map(target => target.table === 'creativeRules'
              ? { ...target, fields: [resolveCreativeRulesFieldV1(task.instruction)] }
              : target)
          : skill.writeTargets
    writeTargets.forEach(target => {
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

function semanticReviewTaskIdsForPlan(plan: MasterAgentPlan): string[] {
  const workflow = plan.workflow ? getMasterWorkflowV1(plan.workflow) : null
  if (workflow?.strategy !== 'fan-out') return []
  return plan.tasks
    .filter(task => (
      task.dependsOn.length === 0
      && (task.agentId === 'world-origin' || task.agentId === 'inspiration')
    ))
    .map(task => task.id)
}

function requiredContextGatewayWriteTargetForTaskV1(task: MasterAgentTask): string | undefined {
  const skill = resolveAgentSkillV1(task.agentId, task.skillId)
  const specializedWriteTarget = skill.executionMode === 'worldview-field'
    ? `worldviews.${resolveWorldviewAgentFieldV1(task.instruction)}`
    : skill.executionMode === 'story-core'
      ? `storyCores.${resolveStoryCoreFieldV1(task.instruction)}`
      : skill.executionMode === 'story-arcs'
        ? 'storyArcs.name'
      : task.agentId === 'character' && skill.executionMode === 'create'
        ? 'characters.name'
      : task.agentId === 'character' && skill.executionMode === 'supplement'
        ? `characters.${task.characterSupplementRequest?.dimensions[0] ?? 'shortDescription'}`
      : task.agentId === 'character' && skill.executionMode === 'lifecycle'
        ? 'characters.narrativeStatus'
    : undefined
  if (specializedWriteTarget
    && isContextGatewayRequiredForWriteTargetV1(skill, specializedWriteTarget)) {
    return specializedWriteTarget
  }
  // Required Gateway rollout is a Skill contract, not a hard-coded list of
  // domains. Once outline/detail/prose Skills move to required, the Master
  // Agent must derive their canary target from the same frozen write registry
  // instead of introducing a hard-coded world/character allowlist.
  return skill.writeTargets
    .flatMap(target => target.fields.map(field => `${target.table}.${field}`))
    .find(target => isContextGatewayRequiredForWriteTargetV1(skill, target))
}

export function buildMasterAgentRunContractV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  plan: MasterAgentPlan
  budgetEvidence: AgentTeamBudgetEvidence
  includeDependencyReceiptPolicy?: boolean
  includeCandidateSemanticReviewPolicy?: boolean
}) {
  const plan = parseMasterAgentPlanV1(input.plan)
  const policy = resolveAgentTeamBudgetPolicy(input.budgetEvidence.profile)
  const workflow = getMasterWorkflowV1(plan.workflow)
  const includeDependencyReceiptPolicy = input.includeDependencyReceiptPolicy
    ?? workflow?.strategy === 'fan-out'
  const semanticReviewTaskIds = input.includeCandidateSemanticReviewPolicy
    ? semanticReviewTaskIdsForPlan(plan)
    : []
  const semanticReviewTaskIdSet = new Set(semanticReviewTaskIds)
  const acceptance = plan.tasks.flatMap(task => [
    { id: `${task.id}.candidate`, kind: 'output-present' as const, required: true },
    ...(semanticReviewTaskIdSet.has(task.id)
      ? [{ id: `${task.id}.semantic-review`, kind: 'semantic-review' as const, required: true }]
      : []),
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
      ...(includeDependencyReceiptPolicy ? [{
        id: `${task.id}.candidate-step`,
        kind: 'deterministic' as const,
        verifier: semanticReviewTaskIdSet.has(task.id)
          ? MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1
          : MASTER_CANDIDATE_STEP_VERIFIER_SET_VERSION_V1,
        criterionIds: [
          `${task.id}.candidate`,
          ...(semanticReviewTaskIdSet.has(task.id) ? [`${task.id}.semantic-review`] : []),
        ],
      }] : []),
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
    workflowKind: workflow.runContractWorkflowKind,
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
    },
    permissions: {
      contextSourceKeys: sourceKeysForPlan(plan),
      writeTargets: writeTargetsForPlan(plan),
    },
    executionBindings: [
        ...plan.tasks.map(task => ({
          stepId: taskStepId(task.id),
          ...createAgentSkillExecutionBindingV1(resolveAgentSkillV1(task.agentId, task.skillId)),
          ...(task.promptExecution ? {
            promptExecution: {
              version: 1 as const,
              moduleKey: task.promptExecution.moduleKey,
              templateId: task.promptExecution.template.id,
              templateName: task.promptExecution.template.name,
              templateScope: task.promptExecution.template.scope,
              templateUpdatedAt: task.promptExecution.template.updatedAt,
              templateHash: task.promptExecution.templateHash,
              parameterValuesHash: task.promptExecution.parameterValuesHash,
              overridesHash: task.promptExecution.overridesHash,
            },
          } : {}),
        })),
        ...plan.tasks.flatMap(task => semanticReviewTaskIdSet.has(task.id)
          ? [1, 2].map(attempt => ({
              stepId: masterCandidateReviewStepIdV1(task.id, attempt),
              ...createAgentSkillExecutionBindingV1(getAgentSkillV1(
                task.agentId === 'world-origin' ? 'world-origin.review' : 'inspiration.review',
                task.agentId,
              )),
            }))
          : []),
      ],
    ...(includeDependencyReceiptPolicy ? {
      dependencyReceiptPolicy: {
        requiredForJoin: true as const,
        verifierSetVersion: MASTER_CANDIDATE_STEP_VERIFIER_SET_VERSION_V1,
      },
    } : {}),
    ...(semanticReviewTaskIds.length > 0 ? {
      candidateSemanticReviewPolicy: {
        requiredForJoin: true as const,
        verifierSetVersion: MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1,
        taskIds: semanticReviewTaskIds,
      },
    } : {}),
    budget: {
      maxModelCalls: policy.maxCalls,
      maxToolCalls: 0,
      maxInputTokens: policy.maxTokens,
      maxOutputTokens: policy.maxTokens,
      maxAttemptsPerStep: 2,
      maxReplans: MAX_MASTER_AGENT_REPLANS_V1,
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

function sameTaskIdentity(left: MasterAgentTask, right: MasterAgentTask): boolean {
  return left.id === right.id
    && left.agentId === right.agentId
    && (left.skillId ?? null) === (right.skillId ?? null)
    && (left.perspectiveCharacterId ?? null) === (right.perspectiveCharacterId ?? null)
    && JSON.stringify(left.inspirationFragmentIds ?? null)
      === JSON.stringify(right.inspirationFragmentIds ?? null)
    && (left.characterDrivenPlanId ?? null) === (right.characterDrivenPlanId ?? null)
    && JSON.stringify(left.characterRevisionRequest ?? null)
      === JSON.stringify(right.characterRevisionRequest ?? null)
    && JSON.stringify(left.characterSupplementRequest ?? null)
      === JSON.stringify(right.characterSupplementRequest ?? null)
    && JSON.stringify(left.characterLifecycleRequest ?? null)
      === JSON.stringify(right.characterLifecycleRequest ?? null)
    && (left.storylineProgressChapterId ?? null) === (right.storylineProgressChapterId ?? null)
    && JSON.stringify(left.storyArcMutationRequest ?? null)
      === JSON.stringify(right.storyArcMutationRequest ?? null)
}

function sameTaskDefinition(left: MasterAgentTask, right: MasterAgentTask): boolean {
  return sameTaskIdentity(left, right)
    && left.instruction === right.instruction
    && JSON.stringify(left.dependsOn) === JSON.stringify(right.dependsOn)
}

function assertBoundedMasterReplan(
  previousPlan: MasterAgentPlan,
  nextPlan: MasterAgentPlan,
  rootTaskIds: readonly string[],
): Set<string> {
  const previous = parseMasterAgentPlanV1(previousPlan)
  const next = parseMasterAgentPlanV1(nextPlan)
  if (
    previous.tasks.length !== next.tasks.length
    || JSON.stringify(previous.workflow ?? null) !== JSON.stringify(next.workflow ?? null)
  ) fail('主 Agent 有限重规划不得改变任务数量或工作流')
  const affected = collectMasterAgentAffectedTaskIdsV1(previous, rootTaskIds)
  const nextAffected = collectMasterAgentAffectedTaskIdsV1(next, rootTaskIds)
  nextAffected.forEach(taskId => affected.add(taskId))
  previous.tasks.forEach((task, index) => {
    const replacement = next.tasks[index]
    if (!replacement || !sameTaskIdentity(task, replacement)) {
      fail('主 Agent 有限重规划不得改变任务身份、Skill、顺序或叙事视角')
    }
    if (!affected.has(task.id) && !sameTaskDefinition(task, replacement)) {
      fail(`主 Agent 有限重规划越界修改了未受影响任务 ${task.id}`)
    }
  })
  if (!previous.tasks.some((task, index) => !sameTaskDefinition(task, next.tasks[index]))) {
    fail('主 Agent 有限重规划没有改变任何受影响任务')
  }
  return affected
}

export interface ReplanDurableMasterAgentRunInputV1 {
  scope: WorkspaceScope
  runId: number
  nextPlan: MasterAgentPlan
  rootTaskIds: string[]
  failures: Array<MasterAgentReplanFailureV1>
  budgetEvidence: AgentTeamBudgetEvidence
  reasonCode?: string
  now?: number
}

/**
 * Atomically advances a paused master run to one new contract generation.
 * Unaffected pending candidates receive explicit carry-forward evidence;
 * candidates in the failed branch remain in history but are staled.
 */
export async function replanDurableMasterAgentRunV1(
  input: ReplanDurableMasterAgentRunInputV1,
): Promise<AgentRunSnapshotV1> {
  const before = await readAgentRunV1(input.scope, input.runId)
  if (before.projection.state !== 'paused') fail('只有 paused 主 Agent run 可以有限重规划')
  const maxReplans = before.contract.budget.maxReplans ?? 0
  if (maxReplans < 1) fail('当前主 Agent RunContract 未授权重规划')
  if (before.events.filter(event => event.type === 'plan.replanned').length >= maxReplans) {
    fail('主 Agent run 的有限重规划次数已耗尽')
  }
  if (Object.values(before.projection.steps).some(step => (
    (step.status === 'succeeded' && !step.stepId.includes(':semantic-review:'))
    || step.confirmation !== undefined
    || step.adoptionHash !== undefined
  ))) fail('已经确认或采纳候选的主 Agent run 不允许原地重规划')
  const latest = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
  if (!latest) fail('主 Agent 有限重规划缺少当前代计划检查点')
  const checkpoint = parsePlanCheckpoint(latest.resumePayload)
  const previousPlanHash = await hashMasterAgentPlanV1(checkpoint.plan)
  if (previousPlanHash !== checkpoint.planHash) fail('主 Agent 有限重规划的原计划检查点已损坏')
  const affected = assertBoundedMasterReplan(checkpoint.plan, input.nextPlan, input.rootTaskIds)
  const parsedBudget = budgetEvidence(input.budgetEvidence, '主 Agent 重规划 budgetEvidence')
  const restored = await readPersistedCandidates({
    scope: input.scope,
    snapshot: before,
    plan: checkpoint.plan,
    checkpointBudget: checkpoint.budgetEvidence,
  })
  if (!budgetAtLeast(parsedBudget, restored.latestBudget)) {
    fail('主 Agent 重规划预算证据倒退')
  }
  for (const taskId of before.contract.candidateSemanticReviewPolicy?.taskIds ?? []) {
    for (const affectedTaskId of collectMasterAgentAffectedTaskIdsV1(checkpoint.plan, [taskId])) {
      affected.add(affectedTaskId)
    }
  }
  const carried = restored.candidates.filter(candidate => !affected.has(candidate.payload.taskId))
  const staled = restored.candidates.filter(candidate => affected.has(candidate.payload.taskId))
  const nextPlan = parseMasterAgentPlanV1(input.nextPlan)
  const nextPlanHash = await hashMasterAgentPlanV1(nextPlan)
  const accepted = await acceptAgentRunContractV1(buildMasterAgentRunContractV1({
    scope: input.scope,
    worldGroupId: before.run.worldGroupId ?? null,
    plan: nextPlan,
    budgetEvidence: parsedBudget,
    includeDependencyReceiptPolicy: before.contract.dependencyReceiptPolicy !== undefined,
    includeCandidateSemanticReviewPolicy: before.contract.candidateSemanticReviewPolicy !== undefined,
  }))
  const now = input.now ?? Date.now()

  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    scopeTransactionTables(
      db.agentConversations,
      db.agentEvents,
      db.agentRuns,
      db.agentRunEvents,
      db.agentRunCheckpoints,
    ),
    async () => {
      let snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (
        snapshot.projection.lastSequence !== before.projection.lastSequence
        || snapshot.projection.generation !== before.projection.generation
      ) fail('主 Agent run 已推进，重规划基线过期')
      for (const candidate of staled) {
        const stepId = taskStepId(candidate.payload.taskId)
        const priorReceiptHash = snapshot.projection.steps[stepId]?.verificationReceiptHash
        if (priorReceiptHash) {
          snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
            version: 1,
            runId: input.runId,
            sequence: snapshot.projection.lastSequence + 1,
            generation: snapshot.projection.generation,
            projectId: snapshot.run.projectId,
            worldGroupId: snapshot.run.worldGroupId ?? null,
            contractHash: snapshot.run.contractHash,
            type: 'step.verification.staled',
            createdAt: now,
            payload: {
              stepId,
              previousReceiptHash: priorReceiptHash,
              reason: input.reasonCode ?? 'bounded_replan_affected_branch',
            },
          }))
        }
        snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
          version: 1,
          runId: input.runId,
          sequence: snapshot.projection.lastSequence + 1,
          generation: snapshot.projection.generation,
          projectId: snapshot.run.projectId,
          worldGroupId: snapshot.run.worldGroupId ?? null,
          contractHash: snapshot.run.contractHash,
          type: 'candidate.staled',
          createdAt: now,
          payload: {
            stepId,
            candidateHash: candidate.payload.candidateHash,
            reason: input.reasonCode ?? 'bounded_replan_affected_branch',
          },
        }))
      }
      snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
        version: 1,
        runId: input.runId,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.projection.generation + 1,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: accepted.contractHash,
        type: 'contract.revised',
        createdAt: now,
        payload: {
          previousContractHash: snapshot.run.contractHash,
          contractJson: canonicalStringify(accepted.contract),
        },
      }), accepted)
      snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
        version: 1,
        runId: input.runId,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.projection.generation,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: snapshot.run.contractHash,
        type: 'plan.replanned',
        createdAt: now,
        payload: {
          previousPlanHash,
          planHash: nextPlanHash,
          reasonCode: input.reasonCode ?? 'bounded_replan',
          affectedStepIds: [...affected].map(taskStepId),
          carriedStepIds: carried.map(candidate => taskStepId(candidate.payload.taskId)),
          failureFingerprints: [...new Set(input.failures.map(failure => failure.fingerprint))],
        },
      }))
      for (const task of nextPlan.tasks) {
        snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
          version: 1,
          runId: input.runId,
          sequence: snapshot.projection.lastSequence + 1,
          generation: snapshot.projection.generation,
          projectId: snapshot.run.projectId,
          worldGroupId: snapshot.run.worldGroupId ?? null,
          contractHash: snapshot.run.contractHash,
          type: 'step.scheduled',
          createdAt: now,
          payload: { stepId: taskStepId(task.id) },
        }))
      }
      for (const candidate of carried) {
        const oldStep = before.projection.steps[taskStepId(candidate.payload.taskId)]
        if (!oldStep || oldStep.status !== 'awaiting_confirmation' || oldStep.attempt < 1) {
          fail(`主 Agent 候选 ${candidate.payload.taskId} 不满足跨代保留条件`)
        }
        snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
          version: 1,
          runId: input.runId,
          sequence: snapshot.projection.lastSequence + 1,
          generation: snapshot.projection.generation,
          projectId: snapshot.run.projectId,
          worldGroupId: snapshot.run.worldGroupId ?? null,
          contractHash: snapshot.run.contractHash,
          type: 'candidate.carried-forward',
          createdAt: now,
          payload: {
            stepId: taskStepId(candidate.payload.taskId),
            sourceGeneration: candidate.payload.runGeneration ?? before.projection.generation,
            sourceAttempt: oldStep.attempt,
            candidateHash: candidate.payload.candidateHash,
          },
        }))
        if (snapshot.contract.dependencyReceiptPolicy?.requiredForJoin) {
          const contextManifestHash = contextManifestHashForStepAttemptV1(
            before,
            taskStepId(candidate.payload.taskId),
            oldStep.attempt,
          )
          if (!contextManifestHash) {
            fail(`主 Agent 候选 ${candidate.payload.taskId} 缺少可跨代验证的 Context Manifest`)
          }
          const receipt = await Dexie.waitFor(createMasterCandidateStepReceiptV1({
            payload: candidate.payload,
            draft: candidate.draft,
            attempt: snapshot.projection.steps[taskStepId(candidate.payload.taskId)].attempt,
            contextManifestHash,
            acceptedAt: now,
            verifierSetVersion: snapshot.contract.dependencyReceiptPolicy.verifierSetVersion,
          }))
          snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
            version: 1,
            runId: input.runId,
            sequence: snapshot.projection.lastSequence + 1,
            generation: snapshot.projection.generation,
            projectId: snapshot.run.projectId,
            worldGroupId: snapshot.run.worldGroupId ?? null,
            contractHash: snapshot.run.contractHash,
            type: 'step.verification.accepted',
            createdAt: now,
            payload: { receipt },
          }))
        }
      }
      const saved = await createAgentRunCheckpointInTransactionV1({
        snapshot,
        resumePayload: {
          version: 1,
          kind: MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1,
          plan: nextPlan,
          planHash: nextPlanHash,
          budgetEvidence: parsedBudget,
        } satisfies MasterAgentPlanCheckpointV1,
        now,
      })
      const conversationId = snapshot.run.conversationId
      if (conversationId != null) {
        for (const candidate of staled) {
          await appendAgentEvent({
            projectId: input.scope.projectId,
            conversationId,
            kind: 'confirmation',
            role: 'system',
            content: '候选因有限重规划失效，未写入正式数据。',
            payload: {
              version: 1,
              runId: input.runId,
              candidateEventId: candidate.event.id,
              decision: 'staled',
              reason: input.reasonCode ?? 'bounded_replan_affected_branch',
            },
            scope: input.scope,
          })
        }
      }
      return saved.snapshot
    },
  ))
}

async function computeCandidateHash(payload: MasterCandidatePayload, draft: string): Promise<string> {
  return computeMasterCandidateHashV1(payload, draft)
}

function parseCandidatePayload(value: unknown, label: string): MasterCandidatePayload {
  if (!isRecord(value)) fail(`${label} payload 无效`)
  const payload = value as unknown as MasterCandidatePayload
  if (payload.version !== 1) fail(`${label} payload 版本不支持`)
  if (typeof payload.taskId !== 'string' || typeof payload.agentId !== 'string') fail(`${label} payload 缺少任务身份`)
  if (!DOMAIN_AGENT_IDS.includes(payload.agentId as DomainAgentId)) fail(`${label} payload 领域无效`)
  if (typeof payload.skillId !== 'string') fail(`${label} payload 缺少当前 skillId`)
  getAgentSkillV1(payload.skillId, payload.agentId)
  if (payload.executionBinding === undefined) fail(`${label} 缺少当前 executionBinding`)
  assertAgentSkillExecutionBindingV1(
    payload.executionBinding,
    resolveAgentSkillV1(payload.agentId, payload.skillId),
    `${label} executionBinding`,
  )
  if (!Number.isInteger(payload.runGeneration) || payload.runGeneration! < 1) {
    fail(`${label} runGeneration 无效`)
  }
  if (!Array.isArray(payload.dependencyBindings)) {
    fail(`${label} dependencyBindings 无效`)
  }
  for (const [index, binding] of payload.dependencyBindings.entries()) {
    if (
      !isRecord(binding)
      || typeof binding.taskId !== 'string'
      || !binding.taskId.trim()
      || typeof binding.outputHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(binding.outputHash)
      || typeof binding.candidateHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(binding.candidateHash)
      || !Number.isInteger(binding.generation)
      || binding.generation! < 1
      || (binding.verificationReceiptHash !== undefined
        && (typeof binding.verificationReceiptHash !== 'string'
          || !/^[a-f0-9]{64}$/u.test(binding.verificationReceiptHash)))
    ) fail(`${label} dependencyBindings[${index}] 无效`)
  }
  if (payload.generator !== undefined) {
    if (
      !isRecord(payload.generator)
      || typeof payload.generator.provider !== 'string'
      || !payload.generator.provider.trim()
      || typeof payload.generator.model !== 'string'
      || !payload.generator.model.trim()
    ) fail(`${label} payload generator 无效`)
    payload.generator = {
      provider: payload.generator.provider.trim(),
      model: payload.generator.model.trim(),
    }
  }
  if (payload.semanticReview !== undefined) {
    payload.semanticReview = parseMasterCandidateSemanticReviewArtifactV1(payload.semanticReview)
    if (
      payload.semanticReview.taskId !== payload.taskId
      || payload.semanticReview.domain !== payload.agentId
      || payload.semanticReview.candidateStepId !== payload.runStepId
    ) fail(`${label} payload semanticReview 与候选身份不一致`)
    if (!payload.generator) fail(`${label} payload semanticReview 缺少 generator 身份`)
  }
  if (payload.creativeArtifact !== undefined) {
    payload.creativeArtifact = parseCreativeArtifactV1(payload.creativeArtifact)
  }
  if (payload.structuredOutputEvidence !== undefined) {
    payload.structuredOutputEvidence = parseStructuredOutputRunEvidenceV1(payload.structuredOutputEvidence)
  }
  if (payload.promptExecutionEvidence !== undefined) {
    payload.promptExecutionEvidence = parsePromptExecutionEvidenceV1(payload.promptExecutionEvidence)
  }
  if (payload.narrativeBrief !== undefined) {
    payload.narrativeBrief = parseNarrativeBriefV1(payload.narrativeBrief)
  }
  if (payload.informationBoundary !== undefined) {
    payload.informationBoundary = parseInformationBoundaryManifestV1(payload.informationBoundary)
    if (
      payload.informationBoundary.projectId !== payload.workspaceScope?.projectId
      || payload.informationBoundary.outlineNodeId !== payload.proseOutlineNodeId
      || payload.informationBoundary.manifestHash
        !== (payload.baseSnapshot as { informationBoundaryHash?: string }).informationBoundaryHash
    ) fail(`${label} payload informationBoundary 与正文候选身份不一致`)
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
  if (payload.contextManifestHash !== undefined) {
    readHash(payload.contextManifestHash, `${label} payload contextManifestHash`)
    if (!payload.contextEvidence) fail(`${label} payload Context Manifest 缺少上下文证据`)
  }
  if (payload.contentRevision !== undefined) {
    try {
      payload.contentRevision = parseWorkspaceContentRevisionV1(payload.contentRevision)
    } catch (error) {
      fail(`${label} payload contentRevision 无效：${error instanceof Error ? error.message : String(error)}`)
    }
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
  if (
    payload.storyCoreField !== undefined
    && !STORY_CORE_FIELDS.includes(payload.storyCoreField)
  ) fail(label + ' storyCoreField 无效')
  if (
    payload.creativeRulesField !== undefined
    && !CREATIVE_RULES_FIELDS.includes(payload.creativeRulesField)
  ) fail(label + ' creativeRulesField 无效')
  if (
    payload.worldviewField !== undefined
    && !WORLDVIEW_AGENT_FIELDS.includes(payload.worldviewField)
  ) fail(label + ' worldviewField 无效')
  if (
    payload.worldviewFieldOperation !== undefined
    && !['create', 'expand', 'rewrite', 'polish'].includes(payload.worldviewFieldOperation)
  ) fail(label + ' worldviewFieldOperation 无效')
  if (payload.worldviewFieldOutputBudget !== undefined) {
    try {
      payload.worldviewFieldOutputBudget = parseWorldviewFieldOutputBudgetV1(
        payload.worldviewFieldOutputBudget,
      )
    } catch (error) {
      fail(`${label} worldviewFieldOutputBudget 无效：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if ((payload.worldviewFieldOperation === undefined) !== (payload.worldviewFieldOutputBudget === undefined)) {
    fail(label + ' worldviewFieldOperation 与 worldviewFieldOutputBudget 必须同时存在')
  }
  if (
    payload.storylineProgressChapterId !== undefined
    && (!Number.isInteger(payload.storylineProgressChapterId) || payload.storylineProgressChapterId < 1)
  ) fail(label + ' storylineProgressChapterId 无效')
  if (payload.storyArcMutationRequest !== undefined) {
    try {
      payload.storyArcMutationRequest = parseStoryArcMutationRequestV1(payload.storyArcMutationRequest)
    } catch (error) {
      fail(`${label} storyArcMutationRequest 无效：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (
    payload.characterDrivenPlanId !== undefined
    && (!Number.isInteger(payload.characterDrivenPlanId) || payload.characterDrivenPlanId < 1)
  ) fail(label + ' characterDrivenPlanId 无效')
  if (payload.characterRevisionRequest !== undefined) {
    try {
      payload.characterRevisionRequest = parseCharacterRevisionTaskInputV1(payload.characterRevisionRequest)
    } catch (error) {
      fail(`${label} characterRevisionRequest 无效：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (payload.characterSupplementRequest !== undefined) {
    try {
      payload.characterSupplementRequest = parseCharacterSupplementTaskInputV1(payload.characterSupplementRequest)
    } catch (error) {
      fail(`${label} characterSupplementRequest 无效：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (payload.characterLifecycleRequest !== undefined) {
    try {
      payload.characterLifecycleRequest = parseCharacterLifecycleTaskInputV1(payload.characterLifecycleRequest)
    } catch (error) {
      fail(`${label} characterLifecycleRequest 无效：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  budgetEvidence(payload.teamBudgetEvidence, `${label} payload teamBudgetEvidence`)
  return payload
}

function assertCandidateMatchesTaskSkill(
  task: MasterAgentTask,
  payload: MasterCandidatePayload,
  label: string,
): void {
  if (typeof payload.skillId !== 'string') fail(`${label} 缺少当前 skillId`)
  const taskSkill = resolveAgentSkillV1(task.agentId, task.skillId)
  const candidateSkill = getAgentSkillV1(payload.skillId, payload.agentId)
  if (candidateSkill.id !== taskSkill.id) fail(`${label} 的 Skill 与计划不一致`)
  if (payload.executionBinding !== undefined) {
    assertAgentSkillExecutionBindingV1(payload.executionBinding, taskSkill, `${label} executionBinding`)
  }
  if (task.promptExecution !== undefined) {
    if (!payload.promptExecutionEvidence) fail(`${label} 缺少冻结 Prompt 的实际运行证据`)
    assertPromptEvidenceMatchesOptionsV1(payload.promptExecutionEvidence, task.promptExecution)
  } else if (payload.promptExecutionEvidence !== undefined) {
    fail(`${label} 不得为历史或非治理任务伪造 Prompt 运行证据`)
  }
  if (
    taskSkill.executionMode === 'story-core'
    && (!payload.storyCoreField || !STORY_CORE_FIELDS.includes(payload.storyCoreField))
  ) fail(`${label} 的故事核心字段与 Skill 不一致`)
  if (
    taskSkill.executionMode === 'creative-rules'
    && (!payload.creativeRulesField || !CREATIVE_RULES_FIELDS.includes(payload.creativeRulesField))
  ) fail(`${label} 的创作规则字段与 Skill 不一致`)
  if (
    taskSkill.executionMode === 'storyline-progress'
    && (
      payload.storylineProgressChapterId == null
      || payload.storylineProgressChapterId !== task.storylineProgressChapterId
    )
  ) fail(`${label} 的故事线进度章节与 Skill 计划不一致`)
  if (
    taskSkill.executionMode !== 'storyline-progress'
    && payload.storylineProgressChapterId !== undefined
  ) fail(`${label} 不得携带故事线进度章节`)
  if (
    taskSkill.executionMode === 'worldview-field'
    && (!payload.worldviewField || !WORLDVIEW_AGENT_FIELDS.includes(payload.worldviewField))
  ) fail(`${label} 的世界基座字段与 Skill 不一致`)
  if (
    task.agentId === 'outline'
    && (taskSkill.executionMode === 'volumes' || taskSkill.executionMode === 'chapters')
    && payload.outlineMode !== taskSkill.executionMode
  ) fail(`${label} 的大纲模式与 Skill 不一致`)
  if (
    taskSkill.executionMode === 'story-arcs'
    && !['main', 'sub', 'mixed'].includes(payload.storyArcKind ?? '')
  ) fail(`${label} 的故事线类型与 Skill 不一致`)
  if (
    taskSkill.executionMode === 'story-arcs'
    && JSON.stringify(payload.storyArcMutationRequest ?? { operation: 'create' })
      !== JSON.stringify(task.storyArcMutationRequest ?? { operation: 'create' })
  ) fail(`${label} 的故事线操作与 Skill 计划不一致`)
  if (
    taskSkill.executionMode !== 'story-arcs'
    && payload.storyArcMutationRequest !== undefined
  ) fail(`${label} 不得携带故事线操作请求`)
  if (
    taskSkill.executionMode === 'character-driven'
    && (
      payload.characterDrivenPlanId == null
      || payload.characterDrivenPlanId !== task.characterDrivenPlanId
    )
  ) fail(`${label} 的角色驱动方案与 Skill 计划不一致`)
  if (
    taskSkill.executionMode !== 'character-driven'
    && payload.characterDrivenPlanId !== undefined
  ) fail(`${label} 不得携带角色驱动方案`)
  if (
    taskSkill.executionMode === 'character-revision'
    && JSON.stringify(payload.characterRevisionRequest ?? null)
      !== JSON.stringify(task.characterRevisionRequest ?? null)
  ) fail(`${label} 的角色变更请求与 Skill 计划不一致`)
  if (
    taskSkill.executionMode !== 'character-revision'
    && payload.characterRevisionRequest !== undefined
  ) fail(`${label} 不得携带角色变更请求`)
  if (
    taskSkill.executionMode === 'supplement'
    && JSON.stringify(payload.characterSupplementRequest ?? null)
      !== JSON.stringify(task.characterSupplementRequest ?? null)
  ) fail(`${label} 的角色补全请求与 Skill 计划不一致`)
  if (
    taskSkill.executionMode !== 'supplement'
    && payload.characterSupplementRequest !== undefined
  ) fail(`${label} 不得携带角色补全请求`)
  if (
    taskSkill.executionMode === 'lifecycle'
    && JSON.stringify(payload.characterLifecycleRequest ?? null)
      !== JSON.stringify(task.characterLifecycleRequest ?? null)
  ) fail(`${label} 的角色状态请求与 Skill 计划不一致`)
  if (
    taskSkill.executionMode !== 'lifecycle'
    && payload.characterLifecycleRequest !== undefined
  ) fail(`${label} 不得携带角色状态请求`)
  if (
    task.agentId === 'prose'
    && (taskSkill.executionMode === 'generate' || taskSkill.executionMode === 'continue')
    && payload.proseOperation !== taskSkill.executionMode
  ) fail(`${label} 的正文操作与 Skill 不一致`)
  if (task.agentId === 'inspiration' && task.inspirationFragmentIds !== undefined) {
    const expected = [...new Set(task.inspirationFragmentIds)]
    const actual = payload.selectedFragmentIds ?? []
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(label + ' 的灵感碎片选择与计划不一致')
    }
  }
}

export function assertMasterAgentRunContractExecutionBindingsV1(
  contract: AgentRunSnapshotV1['contract'],
  plan: MasterAgentPlan,
): void {
  if (contract.executionBindings === undefined) {
    fail('主 Agent RunContract 缺少当前执行绑定')
  }
  const expected = new Map<string, ReturnType<typeof resolveAgentSkillV1>>()
  for (const task of plan.tasks) {
    expected.set(taskStepId(task.id), resolveAgentSkillV1(task.agentId, task.skillId))
  }
  const semanticPolicy = contract.candidateSemanticReviewPolicy
  if (semanticPolicy) {
    const expectedTaskIds = semanticReviewTaskIdsForPlan(plan)
    if (
      semanticPolicy.verifierSetVersion !== MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1
      || semanticPolicy.taskIds.length !== expectedTaskIds.length
      || semanticPolicy.taskIds.some((taskId, index) => taskId !== expectedTaskIds[index])
    ) fail('主 Agent RunContract 的候选语义终验策略与计划不一致')
    for (const taskId of semanticPolicy.taskIds) {
      const task = plan.tasks.find(item => item.id === taskId)
      if (!task || (task.agentId !== 'world-origin' && task.agentId !== 'inspiration')) {
        fail(`主 Agent RunContract 的语义终验任务 ${taskId} 无效`)
      }
      const skill = getAgentSkillV1(
        task.agentId === 'world-origin' ? 'world-origin.review' : 'inspiration.review',
        task.agentId,
      )
      for (const attempt of [1, 2]) expected.set(masterCandidateReviewStepIdV1(taskId, attempt), skill)
    }
  }
  if (contract.executionBindings.length !== expected.size) {
    fail('主 Agent RunContract executionBindings 数量与计划不一致')
  }
  const byStep = new Map(contract.executionBindings.map(binding => [binding.stepId, binding]))
  for (const [stepId, skill] of expected) {
    const binding = byStep.get(stepId)
    if (!binding) fail(`主 Agent RunContract 缺少 ${stepId} execution binding`)
    if (binding.version !== 1) fail(`主 Agent RunContract ${stepId} 当前只接受 V1 Skill 执行绑定`)
    const { stepId: _stepId, promptExecution, ...skillBinding } = binding
    assertAgentSkillExecutionBindingV1(
      skillBinding,
      skill,
      `主 Agent RunContract ${stepId}`,
    )
    const task = plan.tasks.find(item => taskStepId(item.id) === stepId)
    if (task?.promptExecution) {
      const expectedPrompt = {
        version: 1 as const,
        moduleKey: task.promptExecution.moduleKey,
        templateId: task.promptExecution.template.id,
        templateName: task.promptExecution.template.name,
        templateScope: task.promptExecution.template.scope,
        templateUpdatedAt: task.promptExecution.template.updatedAt,
        templateHash: task.promptExecution.templateHash,
        parameterValuesHash: task.promptExecution.parameterValuesHash,
        overridesHash: task.promptExecution.overridesHash,
      }
      if (canonicalStringify(promptExecution) !== canonicalStringify(expectedPrompt)) {
        fail(`主 Agent RunContract ${stepId} 的 Prompt 绑定与冻结计划不一致`)
      }
    } else if (promptExecution !== undefined) {
      fail(`主 Agent RunContract ${stepId} 不得携带 Prompt 绑定`)
    }
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
  const allRows = await readAgentEvents(conversationId, input.scope)
  const rows = allRows.filter(event => event.kind === 'candidate' && event.id != null)
  const semanticArtifacts = allRows.flatMap(event => {
    if (
      event.kind !== 'task'
      || event.durableRunId !== input.snapshot.run.id
    ) return []
    let raw: unknown
    try {
      raw = JSON.parse(event.payload)
    } catch {
      fail(`语义终验审计事件 ${event.id} payload JSON 已损坏`)
    }
    if (
      !isRecord(raw)
      || raw.version !== 1
      || raw.type !== 'master-candidate-semantic-review-evidence'
    ) return []
    try {
      return [parseMasterCandidateSemanticReviewArtifactV1(raw.artifact)]
    } catch (error) {
      fail(`语义终验审计事件 ${event.id} 无效：${error instanceof Error ? error.message : String(error)}`)
    }
  })
  const taskById = new Map(input.plan.tasks.map(task => [task.id, task]))
  const seen = new Set<string>()
  const candidates: MasterAgentDurableCandidateV1[] = []
  // Candidate evidence is ordered by conversation sequence. A later failure
  // checkpoint may legitimately be ahead of every candidate, so compare the
  // two monotonic streams only after validating each stream independently.
  let latestBudget: AgentTeamBudgetEvidence = {
    ...input.checkpointBudget,
    usedTokens: 0,
    calls: 0,
    canonRetries: 0,
  }
  for (const event of rows) {
    let raw: unknown
    try {
      raw = JSON.parse(event.payload)
    } catch {
      fail(`候选事件 ${event.id} payload JSON 已损坏`)
    }
    if (!isRecord(raw)) continue
    const importedDurableCandidate = event.durableRunId === input.snapshot.run.id
      && raw.runId !== input.snapshot.run.id
    if (
      event.durableRunId != null
        ? event.durableRunId !== input.snapshot.run.id
        : raw.runId !== input.snapshot.run.id
    ) continue
    const payload = parseCandidatePayload(raw, `候选事件 ${event.id}`)
    const task = taskById.get(payload.taskId)
    if (!task || payload.agentId !== task.agentId) fail(`候选事件 ${event.id} 不属于当前计划任务`)
    if (
      !payload.workspaceScope
      || (!importedDurableCandidate && (
        payload.workspaceScope.projectId !== input.scope.projectId
        || payload.workspaceScope.worldId !== input.scope.worldId
        || payload.workspaceScope.workId !== input.scope.workId
      ))
    ) fail(`候选事件 ${event.id} 的 WorkspaceScope 不一致`)
    const allowedSources = new Set(input.snapshot.contract.permissions.contextSourceKeys)
    if (payload.contextSources.some(source => !allowedSources.has(source))) {
      fail(`候选事件 ${event.id} 使用了契约未授权的上下文源`)
    }
    if (event.content.length > MAX_CANDIDATE_CHARS) fail(`候选事件 ${event.id} 超出持久化上限`)
    const expectedHash = await computeCandidateHash(payload, event.content)
    if (expectedHash !== payload.candidateHash) fail(`候选事件 ${event.id} candidateHash 校验失败`)
    const semanticRequired = input.snapshot.contract.candidateSemanticReviewPolicy
      ?.taskIds.includes(payload.taskId) === true
    if (semanticRequired) {
      const authorRevisedWithoutReview = !payload.semanticReview
        && input.snapshot.projection.steps[taskStepId(payload.taskId)]?.verificationReceiptHash === undefined
        && input.snapshot.events.some(runEvent => (
          runEvent.generation === input.snapshot.projection.generation
          && runEvent.type === 'candidate.revised'
          && runEvent.payload.stepId === taskStepId(payload.taskId)
          && runEvent.payload.candidateHash === payload.candidateHash
        ))
      if (!authorRevisedWithoutReview && (
        !payload.semanticReview
          || !payload.generator
          || payload.semanticReview.verdict !== 'pass'
          || payload.semanticReview.runGeneration !== payload.runGeneration
          || !await verifyMasterCandidateSemanticReviewArtifactV1({
            artifact: payload.semanticReview,
            candidateText: event.content,
            generator: payload.generator,
          })
      )) fail(`候选事件 ${event.id} 缺少 fresh 独立语义终验`)
      if (payload.semanticReview) {
        const fresh = await readFreshMasterCandidateStepReceiptV1({
          snapshot: input.snapshot,
          stepId: taskStepId(payload.taskId),
          candidateHash: payload.candidateHash!,
          outputHash: await hashCanonicalValue(event.content),
          semanticReview: payload.semanticReview,
          generator: payload.generator,
        })
        if (!fresh) fail(`候选事件 ${event.id} 的独立语义终验 durable 证据无效或已过期`)
      }
    }
    const evidence = budgetEvidence(payload.teamBudgetEvidence, `候选事件 ${event.id} teamBudgetEvidence`)
    if (!budgetAtLeast(evidence, latestBudget)) fail(`候选事件 ${event.id} 的团队预算证据倒退`)
    latestBudget = evidence
    const step = input.snapshot.projection.steps[taskStepId(task.id)]
    // Replanning retains historical candidates for audit. Only the candidate
    // selected by the current generation projection is executable.
    if (!step || step.candidateHash !== payload.candidateHash) continue
    if (seen.has(payload.taskId)) fail(`当前 durable run 存在重复活动候选任务 ${payload.taskId}`)
    assertCandidateMatchesTaskSkill(task, payload, `候选事件 ${event.id}`)
    if (
      !Array.isArray(payload.dependsOnTaskIds)
      || payload.dependsOnTaskIds.length !== task.dependsOn.length
      || payload.dependsOnTaskIds.some((dependency, index) => dependency !== task.dependsOn[index])
    ) fail(`候选事件 ${event.id} 的任务依赖与计划不一致`)
    seen.add(payload.taskId)
    candidates.push({ event, payload, draft: event.content })
  }
  if (budgetAtLeast(input.checkpointBudget, latestBudget)) {
    latestBudget = input.checkpointBudget
  } else if (!budgetAtLeast(latestBudget, input.checkpointBudget)) {
    fail('主 Agent 候选与检查点预算证据无法形成单调顺序')
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
    const bindings = candidate.payload.dependencyBindings!
    const candidateGeneration = candidate.payload.runGeneration!
    const candidateCarried = input.snapshot.events.some(event => (
      event.generation === input.snapshot.projection.generation
      && event.type === 'candidate.carried-forward'
      && event.payload.stepId === taskStepId(candidate.payload.taskId)
      && event.payload.candidateHash === candidate.payload.candidateHash
      && event.payload.sourceGeneration === candidateGeneration
    ))
    if (candidateGeneration !== input.snapshot.projection.generation && !candidateCarried) {
      fail(`候选事件 ${candidate.event.id} 不属于当前 Run generation`)
    }
    if (
      bindings.length !== task.dependsOn.length
      || bindings.some((binding, index) => binding.taskId !== task.dependsOn[index])
    ) fail(`候选事件 ${candidate.event.id} 的冻结依赖清单与计划不一致`)
    const joinEvent = input.snapshot.events.find(event => (
      event.generation === candidateGeneration
      && event.type === 'candidate.persisted'
      && event.payload.stepId === taskStepId(task.id)
    ))
    if (bindings.length > 0 && !joinEvent) {
      fail(`候选事件 ${candidate.event.id} 缺少生成时的 join 事件`)
    }
    for (const binding of bindings) {
      const upstream = candidateByTask.get(binding.taskId)
      if (!upstream || (upstream.event.sequence ?? 0) >= (candidate.event.sequence ?? 0)) {
        fail(`候选事件 ${candidate.event.id} 缺少先行依赖 ${binding.taskId}`)
      }
      if (
        upstream.payload.runId !== candidate.payload.runId
      ) fail(`候选事件 ${candidate.event.id} 的依赖 ${binding.taskId} 跨 Run 或版本不匹配`)
      const upstreamStepId = taskStepId(binding.taskId)
      const upstreamGeneration = upstream.payload.runGeneration!
      const upstreamCarried = input.snapshot.events.some(event => (
        event.generation === binding.generation
        && event.type === 'candidate.carried-forward'
        && event.payload.stepId === upstreamStepId
        && event.payload.candidateHash === binding.candidateHash
        && event.payload.sourceGeneration === upstreamGeneration
      ))
      if (upstreamGeneration !== binding.generation && !upstreamCarried) {
        fail(`候选事件 ${candidate.event.id} 的依赖 ${binding.taskId} 跨代或版本不匹配`)
      }
      const historicalVersionExists = input.snapshot.events.some(event => (
        event.generation === binding.generation
        && (
          (event.type === 'candidate.persisted'
            && event.payload.stepId === upstreamStepId
            && event.payload.candidateHash === binding.candidateHash)
          || (event.type === 'candidate.revised'
            && event.payload.stepId === upstreamStepId
            && event.payload.candidateHash === binding.candidateHash)
          || (event.type === 'candidate.carried-forward'
            && event.payload.stepId === upstreamStepId
            && event.payload.candidateHash === binding.candidateHash)
        )
      ))
      if (!historicalVersionExists) {
        fail(`候选事件 ${candidate.event.id} 的依赖 ${binding.taskId} 从未存在于当前 Run generation`)
      }
      if (
        input.snapshot.contract.dependencyReceiptPolicy?.requiredForJoin
        && !binding.verificationReceiptHash
      ) fail(`候选事件 ${candidate.event.id} 的依赖 ${binding.taskId} 缺少步骤回执绑定`)
      if (
        binding.verificationReceiptHash
        && !await verifyHistoricalMasterCandidateStepReceiptV1({
          snapshot: input.snapshot,
          stepId: upstreamStepId,
          candidateHash: binding.candidateHash ?? upstream.payload.candidateHash!,
          outputHash: binding.outputHash,
          receiptHash: binding.verificationReceiptHash,
          generation: binding.generation!,
          beforeSequence: joinEvent!.sequence,
          semanticReview: upstream.payload.semanticReview ?? semanticArtifacts.find(artifact => (
            artifact.taskId === binding.taskId
            && artifact.runGeneration === binding.generation
            && artifact.candidateTextHash === binding.outputHash
          )),
          generator: upstream.payload.generator,
        })
      ) fail(`候选事件 ${candidate.event.id} 的依赖 ${binding.taskId} 步骤回执无效或在 join 前已过期`)
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
  if (dependencies.disableAutomaticReplanForTest && import.meta.env.MODE !== 'test') {
    fail('disableAutomaticReplanForTest 仅允许隔离测试环境')
  }
  const automaticReplanEnabled = !dependencies.disableAutomaticReplanForTest
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
      includeCandidateSemanticReviewPolicy: input.candidateSemanticReview === 'required',
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
      includeDependencyReceiptPolicy: snapshot.contract.dependencyReceiptPolicy !== undefined,
      includeCandidateSemanticReviewPolicy: snapshot.contract.candidateSemanticReviewPolicy !== undefined,
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
  const gatewayAttempts = new Map<string, {
    preflight: ContextGatewayPreflightEvidenceV1
    baseManifest: ContextManifestV2
  }>()
  let gatewayPreflightQueue: Promise<void> = Promise.resolve()
  let previousBudget = restored.latestBudget
  const recordGatewayPrepared = async (
    task: MasterAgentTask,
    prepared: Parameters<NonNullable<MasterAgentExecutionTrace['contextGatewayPrepared']>>[1],
  ): Promise<void> => {
    const writeTarget = requiredContextGatewayWriteTargetForTaskV1(task)
    if (!writeTarget) fail(`主 Agent 任务 ${task.id} 未获 required Gateway canary 权限`)
    if (!activeTasks.has(task.id)) fail(`主 Agent Gateway preflight 收到未启动任务 ${task.id}`)
    const stepId = taskStepId(task.id)
    const step = snapshot.projection.steps[stepId]
    if (!step || step.status !== 'running') fail(`主 Agent Gateway preflight 步骤 ${stepId} 未运行`)
    if (gatewayAttempts.has(task.id)) fail(`主 Agent Gateway preflight ${task.id} 不得重复记录`)
    const skill = resolveAgentSkillV1(task.agentId, task.skillId)
    const v1 = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId,
      attempt: step.attempt,
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      declaredSourceKeys: skill.contextGateway!.providerSourceKeys,
      assembled: prepared.assembled,
      readerVersion: 'context-gateway-execution-v1',
    })
    const baseManifest = await createContextManifestV2FromV1({ manifest: v1, scope: input.scope })
    const recorded = await recordContextGatewayPreflightEvidenceV1({
      scope: input.scope,
      runId: snapshot.run.id,
      stepId,
      attempt: step.attempt,
      contextPacket: prepared.execution.contextPacket,
      selector: prepared.execution.selector,
      renderedRequest: prepared.renderedRequest,
      sourceSnapshots: prepared.execution.sourceSnapshots,
      toolTranscript: prepared.execution.toolTranscript,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: now(),
    })
    snapshot = recorded.snapshot
    snapshot = await appendAgentRunEventV1({
      scope: input.scope,
      runId: snapshot.run.id,
      type: 'model.requested',
      payload: {
        stepId,
        attempt: step.attempt,
        bindingHash: await hashCanonicalValue({
          plan,
          task,
          runId: snapshot.run.id,
          contractHash: snapshot.run.contractHash,
          writeTarget,
          preflightHash: recorded.evidence.preflightHash,
        }),
      },
      expectedLastSequence: snapshot.projection.lastSequence,
      now: now(),
    })
    gatewayAttempts.set(task.id, { preflight: recorded.evidence, baseManifest })
    await notify(input.onDurableBoundary, 'model.requested', snapshot)
  }
  const trace: MasterAgentExecutionTrace = {
    async taskStarted(task) {
      const stepId = taskStepId(task.id)
      let step = snapshot.projection.steps[stepId]
      if (!step) fail(`主 Agent durable run 缺少步骤 ${stepId}`)
      if (plan.workflow.workflowId === 'staged-author-confirmed') {
        const unconfirmedDependencies = task.dependsOn.filter(taskId => (
          snapshot.projection.steps[taskStepId(taskId)]?.status !== 'succeeded'
        ))
        if (unconfirmedDependencies.length) {
          fail(
            `主 Agent 分阶段任务 ${task.id} 的上游 ${unconfirmedDependencies.join('、')} 尚未完成作者采纳，已阻止下游模型调用`,
          )
        }
      }
      activeTasks.set(task.id, task)
      if (step.status === 'awaiting_confirmation' || step.status === 'succeeded') {
        fail(`主 Agent durable run 步骤 ${stepId} 已有候选或已完成，不得重复调用`)
      }
      const lastFailure = [...snapshot.events].reverse().find(event => (
        event.generation === snapshot.projection.generation
        && event.type === 'step.failed'
        && event.payload.stepId === stepId
        && event.payload.attempt === step.attempt
      ))
      if (
        step.status === 'failed'
        && lastFailure?.type === 'step.failed'
        && lastFailure.payload.action
        && lastFailure.payload.action !== 'retry'
      ) {
        fail(`主 Agent durable run 步骤 ${stepId} 的失败策略要求${
          lastFailure.payload.action === 'replan' ? '有限重规划' : '作者处理'
        }，不得原样重试`)
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
      if (snapshot.contract.dependencyReceiptPolicy?.requiredForJoin) {
        for (const dependencyTaskId of task.dependsOn) {
          const upstream = liveCandidates.get(dependencyTaskId)
            ?? restored.candidates.find(item => item.payload.taskId === dependencyTaskId)
          if (!upstream?.payload.candidateHash) {
            fail(`主 Agent durable run 缺少依赖候选 ${dependencyTaskId}`)
          }
          const receipt = await readFreshMasterCandidateStepReceiptV1({
            snapshot,
            stepId: taskStepId(dependencyTaskId),
            candidateHash: upstream.payload.candidateHash,
            outputHash: await hashCanonicalValue(upstream.draft),
            semanticReview: upstream.payload.semanticReview,
            generator: upstream.payload.generator,
          })
          if (!receipt) {
            fail(`主 Agent 任务 ${task.id} 的上游 ${dependencyTaskId} 缺少 fresh 步骤回执`)
          }
        }
      }
      if (!requiredContextGatewayWriteTargetForTaskV1(task)) {
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
      }
    },
    async contextGatewayPrepared(task, prepared) {
      const queued = gatewayPreflightQueue.then(() => recordGatewayPrepared(task, prepared))
      gatewayPreflightQueue = queued.catch(() => undefined)
      await queued
    },
    async taskFailed(task, error) {
      const failureEvidence = structuredOutputFailureEvidenceV1(error)
      if (!failureEvidence || !gatewayAttempts.has(task.id)) return
      const queued = gatewayPreflightQueue.then(async () => {
        const stepId = taskStepId(task.id)
        const step = snapshot.projection.steps[stepId]
        if (!step || step.status !== 'running') return
        const alreadyResponded = snapshot.events.some(event => (
          event.type === 'model.responded'
          && event.payload.stepId === stepId
          && event.payload.attempt === step.attempt
        ))
        if (!alreadyResponded) {
          snapshot = await appendAgentRunEventV1({
            scope: input.scope,
            runId: snapshot.run.id,
            type: 'model.responded',
            payload: {
              stepId,
              attempt: step.attempt,
              outputHash: await hashCanonicalValue(failureEvidence),
            },
            expectedLastSequence: snapshot.projection.lastSequence,
            now: now(),
          })
          await notify(input.onDurableBoundary, 'model.responded', snapshot)
        }
        const recorded = await recordAgentRunArtifactV1({
          scope: input.scope,
          runId: snapshot.run.id,
          artifactKind: 'raw-response',
          content: canonicalStringify(failureEvidence),
          stepId,
          attempt: step.attempt,
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
        snapshot = recorded.snapshot
      })
      gatewayPreflightQueue = queued.catch(() => undefined)
      await queued
    },
    async candidateReady(task, candidate) {
      const stepId = taskStepId(task.id)
      if (!activeTasks.has(task.id)) fail(`主 Agent durable trace 收到未启动候选 ${task.id}`)
      if (candidate.payload.taskId !== task.id || candidate.payload.agentId !== task.agentId) {
        fail(`主 Agent durable trace 候选身份与当前任务 ${task.id} 不一致`)
      }
      assertCandidateMatchesTaskSkill(task, candidate.payload, `主 Agent durable trace 候选 ${task.id}`)
      const skill = resolveAgentSkillV1(task.agentId, task.skillId)
      if (candidate.payload.contextEvidence) {
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
        const outputHash = await hashCanonicalValue(upstream.draft)
        const receipt = snapshot.contract.dependencyReceiptPolicy?.requiredForJoin
          ? await readFreshMasterCandidateStepReceiptV1({
              snapshot,
              stepId: taskStepId(dependencyTaskId),
              candidateHash: upstream.payload.candidateHash,
              outputHash,
              semanticReview: upstream.payload.semanticReview,
              generator: upstream.payload.generator,
            })
          : null
        if (snapshot.contract.dependencyReceiptPolicy?.requiredForJoin && !receipt) {
          fail(`主 Agent durable trace 的依赖 ${dependencyTaskId} 缺少 fresh 步骤回执`)
        }
        return {
          taskId: dependencyTaskId,
          candidateHash: upstream.payload.candidateHash,
          outputHash,
          generation: snapshot.projection.generation,
          ...(receipt ? { verificationReceiptHash: receipt.receiptHash } : {}),
        }
      }))
      const payload: MasterCandidatePayload = {
        ...candidatePayload,
        taskId: task.id,
        agentId: task.agentId,
        skillId: skill.id as AgentSkillId,
        dependsOnTaskIds: [...task.dependsOn],
        workspaceScope: input.scope,
        runId: snapshot.run.id,
        runGeneration: snapshot.projection.generation,
        runStepId: stepId,
        dependencyBindings: frozenDependencies,
        teamBudgetEvidence: candidate.payload.teamBudgetEvidence ?? budget.snapshot(),
        executionBinding: candidateExecutionBinding
          ?? createAgentSkillExecutionBindingV1(resolveAgentSkillV1(task.agentId, task.skillId)),
        candidateHash: undefined,
      }
      const draft = candidate.draft
      if (!draft || draft.length > MAX_CANDIDATE_CHARS) fail(`主 Agent 任务 ${task.id} 候选长度无效`)
      const outputHash = await hashCanonicalValue(candidate.runtimeOutput)
      const gatewayRequired = isMasterCandidateContextGatewayRequiredV1(payload)
      let contextManifestHash: string | null = null
      if (gatewayRequired) {
        const gatewayAttempt = gatewayAttempts.get(task.id)
        const runtime = candidate.contextGatewayRuntime
        if (!gatewayAttempt || !runtime) fail(`主 Agent 任务 ${task.id} 缺少 required Gateway exact evidence`)
        payload.candidateHash = await computeCandidateHash(payload, draft)
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'model.responded',
          payload: {
            stepId,
            attempt: snapshot.projection.steps[stepId].attempt,
            outputHash,
          },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
        await notify(input.onDurableBoundary, 'model.responded', snapshot)
        const finalized = await finalizeContextGatewayAttemptEvidenceV1({
          scope: input.scope,
          runId: snapshot.run.id,
          stepId,
          attempt: snapshot.projection.steps[stepId].attempt,
          baseManifest: gatewayAttempt.baseManifest,
          preflight: gatewayAttempt.preflight,
          selector: runtime.execution.selector,
          sufficiency: runtime.execution.sufficiency,
          retrievalTrace: runtime.execution.retrievalTrace,
          gatewayVersionHash: runtime.execution.contextPacket.gatewayVersionHash,
          policyHash: runtime.execution.contextPacket.policyHash,
          rawResponse: runtime.rawResponse,
          candidateHash: payload.candidateHash,
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
        snapshot = finalized.snapshot
        contextManifestHash = finalized.manifest.manifestHash
        payload.contextManifestHash = contextManifestHash
        if (await computeCandidateHash(payload, draft) !== payload.candidateHash) {
          fail(`主 Agent 任务 ${task.id} 的 Gateway 候选哈希形成循环或漂移`)
        }
      } else {
        contextManifestHash = payload.contextEvidence
          ? await hashCanonicalValue({
              version: 1,
              runId: snapshot.run.id,
              stepId,
              attempt: snapshot.projection.steps[stepId].attempt,
              contextSources: payload.contextSources,
              contextEvidence: payload.contextEvidence,
            })
          : null
        if (contextManifestHash) payload.contextManifestHash = contextManifestHash
      }
      const semanticRequired = snapshot.contract.candidateSemanticReviewPolicy
        ?.taskIds.includes(task.id) === true
      if (semanticRequired) {
        if (
          (task.agentId !== 'world-origin' && task.agentId !== 'inspiration')
          || !payload.generator
          || !contextManifestHash
        ) fail(`主 Agent 任务 ${task.id} 缺少语义终验所需的领域、生成器或 Context Manifest`)
        const review = dependencies.semanticReview ?? runMasterCandidateSemanticReviewWithClientV1
        const reviewStepId = masterCandidateReviewStepIdV1(
          task.id,
          snapshot.projection.steps[stepId].attempt,
        )
        let reviewStarted = false
        let reviewSucceeded = false
        try {
          const result = await review({
            scope: input.scope,
            worldGroupId: input.worldGroupId,
            runId: snapshot.run.id,
            runGeneration: snapshot.projection.generation,
            taskId: task.id,
            candidateStepId: stepId,
            attempt: snapshot.projection.steps[stepId].attempt,
            domain: task.agentId,
            authorRequest: task.instruction,
            candidateText: draft,
            generationContextManifestHash: contextManifestHash,
            generator: payload.generator,
            selectedFragmentIds: payload.selectedFragmentIds,
            inspirationMode: payload.mode,
            budget,
            signal: input.signal,
            now,
            onCall: async event => {
              if (event.state === 'requested') {
                snapshot = await appendAgentRunEventV1({
                  scope: input.scope,
                  runId: snapshot.run.id,
                  type: 'step.scheduled',
                  payload: { stepId: reviewStepId },
                  expectedLastSequence: snapshot.projection.lastSequence,
                  now: now(),
                })
                snapshot = await appendAgentRunEventV1({
                  scope: input.scope,
                  runId: snapshot.run.id,
                  type: 'step.started',
                  payload: { stepId: reviewStepId, attempt: 1 },
                  expectedLastSequence: snapshot.projection.lastSequence,
                  now: now(),
                })
                reviewStarted = true
                snapshot = await appendAgentRunEventV1({
                  scope: input.scope,
                  runId: snapshot.run.id,
                  type: 'context.assembled',
                  payload: {
                    stepId: reviewStepId,
                    attempt: 1,
                    manifestHash: event.contextManifest.manifestHash,
                  },
                  expectedLastSequence: snapshot.projection.lastSequence,
                  now: now(),
                })
                snapshot = await appendAgentRunEventV1({
                  scope: input.scope,
                  runId: snapshot.run.id,
                  type: 'model.requested',
                  payload: {
                    stepId: reviewStepId,
                    attempt: 1,
                    bindingHash: await hashCanonicalValue({
                      candidateTextHash: await hashCanonicalValue(draft),
                      generationContextManifestHash: contextManifestHash,
                      reviewContextManifestHash: event.contextManifest.manifestHash,
                    }),
                  },
                  expectedLastSequence: snapshot.projection.lastSequence,
                  now: now(),
                })
                await notify(input.onDurableBoundary, 'model.requested', snapshot)
              } else {
                snapshot = await appendAgentRunEventV1({
                  scope: input.scope,
                  runId: snapshot.run.id,
                  type: 'model.responded',
                  payload: {
                    stepId: reviewStepId,
                    attempt: 1,
                    outputHash: await hashCanonicalValue(event.output ?? ''),
                  },
                  expectedLastSequence: snapshot.projection.lastSequence,
                  now: now(),
                })
                await notify(input.onDurableBoundary, 'model.responded', snapshot)
              }
            },
          })
          snapshot = await appendAgentRunEventV1({
            scope: input.scope,
            runId: snapshot.run.id,
            type: 'step.succeeded',
            payload: { stepId: reviewStepId, attempt: 1, outputHash: result.artifact.artifactHash },
            expectedLastSequence: snapshot.projection.lastSequence,
            now: now(),
          })
          reviewSucceeded = true
          payload.semanticReview = result.artifact
          payload.teamBudgetEvidence = budget.snapshot()
          await appendAgentEvent({
            projectId: input.scope.projectId,
            conversationId: snapshot.run.conversationId!,
            durableRunId: snapshot.run.id,
            kind: 'task',
            role: 'system',
            content: result.artifact.verdict === 'pass'
              ? '候选已通过独立语义终验。'
              : '候选未通过独立语义终验。',
            payload: {
              version: 1,
              type: 'master-candidate-semantic-review-evidence',
              artifact: result.artifact,
            },
            scope: input.scope,
          })
          await notify(input.onDurableBoundary, 'step.succeeded', snapshot)
          if (result.artifact.verdict !== 'pass') {
            throw new MasterCandidateSemanticReviewBlockedError(result.artifact)
          }
        } catch (error) {
          if (reviewStarted && !reviewSucceeded) {
            snapshot = await appendAgentRunEventV1({
              scope: input.scope,
              runId: snapshot.run.id,
              type: 'step.failed',
              payload: {
                stepId: reviewStepId,
                attempt: 1,
                code: 'semantic_review_failed',
                retryable: true,
              },
              expectedLastSequence: snapshot.projection.lastSequence,
              now: now(),
            })
          }
          throw error
        }
      }
      const evidence = budgetEvidence(payload.teamBudgetEvidence, `主 Agent 任务 ${task.id} teamBudgetEvidence`)
      if (!budgetAtLeast(evidence, previousBudget)) fail(`主 Agent 任务 ${task.id} 团队预算证据倒退`)
      const finalCandidateHash = await computeCandidateHash(payload, draft)
      if (payload.candidateHash && payload.candidateHash !== finalCandidateHash) {
        fail(`主 Agent 任务 ${task.id} 的候选在证据冻结后发生变化`)
      }
      payload.candidateHash = finalCandidateHash
      const stepReceipt = snapshot.contract.dependencyReceiptPolicy?.requiredForJoin
        ? await createMasterCandidateStepReceiptV1({
            payload,
            draft,
            attempt: snapshot.projection.steps[stepId].attempt,
            contextManifestHash: contextManifestHash
              ?? fail(`主 Agent 任务 ${task.id} 缺少可验证 Context Manifest`),
            acceptedAt: now(),
            verifierSetVersion: semanticRequired
              ? snapshot.contract.candidateSemanticReviewPolicy!.verifierSetVersion
              : snapshot.contract.dependencyReceiptPolicy.verifierSetVersion,
            semanticReview: payload.semanticReview,
            generator: payload.generator,
          })
        : null
      maybeInjectHarnessFaultV1('candidate.before-persist')
      const persisted = await db.transaction(
        'rw',
        scopeTransactionTables(db.agentConversations, db.agentEvents, db.agentRuns, db.agentRunEvents),
        async () => {
          const event = await appendAgentEvent({
            projectId: input.scope.projectId,
            conversationId: snapshot.run.conversationId!,
            durableRunId: snapshot.run.id,
            kind: 'candidate',
            content: draft,
            payload,
            scope: input.scope,
          })
          let nextSnapshot = snapshot
          if (payload.contextEvidence && !gatewayRequired) {
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
          if (!gatewayRequired) {
            nextSnapshot = await appendAgentRunEventV1({
              scope: input.scope,
              runId: snapshot.run.id,
              type: 'model.responded',
              payload: { stepId, attempt: nextSnapshot.projection.steps[stepId].attempt, outputHash },
              expectedLastSequence: nextSnapshot.projection.lastSequence,
              now: now(),
            })
          }
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
          const candidateSnapshot = nextSnapshot
          if (stepReceipt) {
            nextSnapshot = await appendAgentRunEventV1({
              scope: input.scope,
              runId: snapshot.run.id,
              type: 'step.verification.accepted',
              payload: { receipt: stepReceipt },
              expectedLastSequence: nextSnapshot.projection.lastSequence,
              now: now(),
            })
          }
          return { event, candidateSnapshot, snapshot: nextSnapshot }
        },
      )
      snapshot = persisted.snapshot
      previousBudget = evidence
      maybeInjectHarnessFaultV1('candidate.after-persist')
      const durableCandidate: MasterAgentDurableCandidateV1 = {
        event: persisted.event,
        payload,
        draft,
        runtime: candidate,
      }
      liveCandidates.set(task.id, durableCandidate)
      activeTasks.delete(task.id)
      await notify(input.onDurableBoundary, 'candidate.persisted', persisted.candidateSnapshot)
      if (stepReceipt) await notify(input.onDurableBoundary, 'step.verification.accepted', snapshot)
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
      authorConfirmedTaskIds: plan.tasks
        .filter(task => snapshot.projection.steps[taskStepId(task.id)]?.status === 'succeeded')
        .map(task => task.id),
      completedTaskAssumptions: Object.fromEntries(restored.candidates.map(candidate => [
        candidate.payload.taskId,
        candidate.payload.creativeArtifact?.assumptions
          ?? candidate.payload.narrativeBrief?.assumptions
          ?? [],
      ])),
      executionTrace: trace,
      onTask: input.onTask,
    })
  } catch (error) {
    const latest = await readAgentRunV1(input.scope, snapshot.run.id)
    snapshot = latest
    const failedTasks = [...activeTasks.values()]
    const classified = await classifyAgentRunFailureV1(error)
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
            category: 'cancelled',
            action: 'retry',
            fingerprint: classified.fingerprint,
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
      const finalBudget = budget.snapshot()
      if (
        failedTasks.length > 0
        && budgetAtLeast(finalBudget, previousBudget)
        && (
          finalBudget.calls > previousBudget.calls
          || finalBudget.usedTokens > previousBudget.usedTokens
          || finalBudget.canonRetries > previousBudget.canonRetries
        )
      ) {
        snapshot = await appendAgentRunEventV1({
          scope: input.scope,
          runId: snapshot.run.id,
          type: 'budget.settled',
          payload: {
            stepId: taskStepId(failedTasks[0].id),
            modelCalls: finalBudget.calls - previousBudget.calls,
            toolCalls: 0,
            tokens: finalBudget.usedTokens - previousBudget.usedTokens,
          },
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
        previousBudget = finalBudget
      }
      const replanFailures: MasterAgentReplanFailureV1[] = []
      let requiresReplan = classified.action === 'replan'
      for (const failedTask of failedTasks) {
        const stepId = taskStepId(failedTask.id)
        const step = snapshot.projection.steps[stepId]
        if (!step) continue
        const existing = [...snapshot.events].reverse().find(event => (
          event.generation === snapshot.projection.generation
          && event.type === 'step.failed'
          && event.payload.stepId === stepId
          && event.payload.attempt === step.attempt
        ))
        if (step.status === 'running') {
          const repeated = matchingFailureCountV1(snapshot.events, {
            generation: snapshot.projection.generation,
            stepId,
            fingerprint: classified.fingerprint,
          }) > 0
          const action = repeated && classified.action === 'retry' ? 'replan' : classified.action
          const retryable = action === 'retry' && classified.retryable
          snapshot = await appendAgentRunEventV1({
            scope: input.scope,
            runId: snapshot.run.id,
            type: 'step.failed',
            payload: {
              stepId,
              attempt: step.attempt,
              code: classified.code,
              retryable,
              category: classified.category,
              action,
              fingerprint: classified.fingerprint,
            },
            expectedLastSequence: snapshot.projection.lastSequence,
            now: now(),
          })
          requiresReplan ||= action === 'replan'
          replanFailures.push({
            taskId: failedTask.id,
            code: classified.code,
            category: classified.category,
            fingerprint: classified.fingerprint,
          })
        } else if (existing?.type === 'step.failed') {
          requiresReplan ||= existing.payload.action === 'replan'
          replanFailures.push({
            taskId: failedTask.id,
            code: existing.payload.code,
            category: existing.payload.category ?? 'unknown',
            fingerprint: existing.payload.fingerprint ?? classified.fingerprint,
          })
        }
      }
      const replanCount = snapshot.events.filter(event => event.type === 'plan.replanned').length
      const replanLimit = snapshot.contract.budget.maxReplans ?? 0
      const replanExhausted = requiresReplan
        && replanCount >= replanLimit
      if (['running', 'awaiting_confirmation'].includes(snapshot.projection.state)) {
        snapshot = replanExhausted
          ? await appendAgentRunEventV1({
              scope: input.scope,
              runId: snapshot.run.id,
              type: 'budget.exhausted',
              payload: { resource: 'replans' },
              expectedLastSequence: snapshot.projection.lastSequence,
              now: now(),
            })
          : await appendAgentRunEventV1({
              scope: input.scope,
              runId: snapshot.run.id,
              type: 'run.paused',
              payload: {
                reason: requiresReplan ? 'master_agent_replan_required' : classified.code,
                recoverable: true,
              },
              expectedLastSequence: snapshot.projection.lastSequence,
              now: now(),
            })
      }
      if (snapshot.projection.state === 'paused') {
        const saved = await createAgentRunCheckpointV1({
          scope: input.scope,
          runId: snapshot.run.id,
          resumePayload: {
            version: 1,
            kind: MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1,
            plan,
            planHash: await hashMasterAgentPlanV1(plan),
            budgetEvidence: budget.snapshot(),
          } satisfies MasterAgentPlanCheckpointV1,
          expectedLastSequence: snapshot.projection.lastSequence,
          now: now(),
        })
        snapshot = saved.snapshot
        await notify(input.onDurableBoundary, 'checkpoint.created', snapshot)
      }
      if (
        requiresReplan
        && replanFailures.length > 0
        && !replanExhausted
        && automaticReplanEnabled
      ) {
        let replannedSnapshot: AgentRunSnapshotV1
        try {
          const replan = dependencies.replan ?? createMasterAgentReplanV1
          const nextPlan = await replan({
            projectId: input.scope.projectId,
            plan,
            failures: replanFailures,
            budget,
            signal: input.signal,
          })
          replannedSnapshot = await replanDurableMasterAgentRunV1({
            scope: input.scope,
            runId: snapshot.run.id,
            nextPlan,
            rootTaskIds: replanFailures.map(failure => failure.taskId),
            failures: replanFailures,
            budgetEvidence: budget.snapshot(),
            reasonCode: 'same_failure_loop_or_replan_policy',
            now: now(),
          })
        } catch (replanError) {
          const current = await readAgentRunV1(input.scope, snapshot.run.id)
          if (current.projection.state === 'paused') {
            await createAgentRunCheckpointV1({
              scope: input.scope,
              runId: current.run.id,
              resumePayload: {
                version: 1,
                kind: MASTER_AGENT_PLAN_CHECKPOINT_KIND_V1,
                plan,
                planHash: await hashMasterAgentPlanV1(plan),
                budgetEvidence: budget.snapshot(),
              } satisfies MasterAgentPlanCheckpointV1,
              expectedLastSequence: current.projection.lastSequence,
              now: now(),
            })
          }
          throw new Error(`主 Agent 有限重规划未完成：${replanError instanceof Error ? replanError.message : String(replanError)}`)
        }
        await notify(input.onDurableBoundary, 'plan.replanned', replannedSnapshot)
        return runDurableMasterAgentPlanV1({
          ...input,
          plan: undefined,
          conversationId: undefined,
          budget: undefined,
          runId: replannedSnapshot.run.id,
        }, dependencies)
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
