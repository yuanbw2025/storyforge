import type { AgentRunWorkflowKind } from '../types/agent-run'
import {
  getAgentSkillV1,
  resolveAgentSkillV1,
  type AgentSkillId,
  type DomainAgentId,
} from './skill-registry'

export type MasterWorkflowReasonCodeV1 =
  | 'single-explicit-domain'
  | 'multiple-explicit-domains'
  | 'outline-prose-confirmation-barrier'
  | 'perspective-resolution-required'
  | 'explicit-independent-fan-out'
  | 'fan-out-disabled'
  | 'classifier-disabled'
  | 'domain-ambiguous'

export interface MasterWorkflowDefinitionV1 {
  version: 1
  id: string
  label: string
  strategy: 'direct' | 'sequential' | 'fan-out'
  planner: 'skip' | 'required'
  runContractWorkflowKind: Extract<
    AgentRunWorkflowKind,
    'direct-generation' | 'multi-domain-sequential' | 'fan-out-synthesize'
  >
}

export const MASTER_WORKFLOWS = [
  {
    version: 1,
    id: 'single-domain-direct',
    label: '单领域直接执行',
    strategy: 'direct',
    planner: 'skip',
    runContractWorkflowKind: 'direct-generation',
  },
  {
    version: 1,
    id: 'multi-domain-sequential',
    label: '多领域顺序执行',
    strategy: 'sequential',
    planner: 'required',
    runContractWorkflowKind: 'multi-domain-sequential',
  },
  {
    version: 1,
    id: 'staged-author-confirmed',
    label: '作者确认分阶段执行',
    strategy: 'sequential',
    planner: 'required',
    runContractWorkflowKind: 'multi-domain-sequential',
  },
  {
    version: 1,
    id: 'multi-domain-fan-out',
    label: '多领域有限并行',
    strategy: 'fan-out',
    planner: 'required',
    runContractWorkflowKind: 'fan-out-synthesize',
  },
  {
    version: 1,
    id: 'conservative-sequential',
    label: '保守顺序执行',
    strategy: 'sequential',
    planner: 'required',
    runContractWorkflowKind: 'multi-domain-sequential',
  },
] as const satisfies readonly MasterWorkflowDefinitionV1[]

export type MasterWorkflowIdV1 = typeof MASTER_WORKFLOWS[number]['id']

export interface MasterWorkflowSelectionV1 {
  version: 1
  workflowId: MasterWorkflowIdV1
  reasonCodes: MasterWorkflowReasonCodeV1[]
}

export function validateMasterWorkflowDefinitionsV1(
  definitions: readonly MasterWorkflowDefinitionV1[],
): void {
  const ids = new Set<string>()
  for (const workflow of definitions) {
    if (workflow.version !== 1 || !/^[a-z][a-z0-9-]+$/.test(workflow.id)) {
      throw new Error(`Master Workflow ${workflow.id} 版本或 ID 无效`)
    }
    if (ids.has(workflow.id)) throw new Error(`Master Workflow ID 重复：${workflow.id}`)
    ids.add(workflow.id)
    if (
      (workflow.strategy === 'direct' && (
        workflow.planner !== 'skip' || workflow.runContractWorkflowKind !== 'direct-generation'
      ))
      || (workflow.strategy === 'sequential' && (
        workflow.planner !== 'required' || workflow.runContractWorkflowKind !== 'multi-domain-sequential'
      ))
      || (workflow.strategy === 'fan-out' && (
        workflow.planner !== 'required' || workflow.runContractWorkflowKind !== 'fan-out-synthesize'
      ))
    ) throw new Error(`Master Workflow ${workflow.id} 的执行策略契约无效`)
  }
}

validateMasterWorkflowDefinitionsV1(MASTER_WORKFLOWS)

export const MASTER_WORKFLOW_BY_ID: ReadonlyMap<string, MasterWorkflowDefinitionV1> = new Map(
  MASTER_WORKFLOWS.map(workflow => [workflow.id, workflow]),
)

const REASON_CODES: readonly MasterWorkflowReasonCodeV1[] = [
  'single-explicit-domain',
  'multiple-explicit-domains',
  'outline-prose-confirmation-barrier',
  'perspective-resolution-required',
  'explicit-independent-fan-out',
  'fan-out-disabled',
  'classifier-disabled',
  'domain-ambiguous',
]

export const MASTER_WORKFLOW_CLASSIFIER_STORAGE_KEY = 'storyforge:harness:workflow-classifier-v1'
export const MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY = 'storyforge:harness:fan-out-v1'

export function isMasterWorkflowClassifierEnabledV1(): boolean {
  try {
    return globalThis.localStorage?.getItem(MASTER_WORKFLOW_CLASSIFIER_STORAGE_KEY) !== 'disabled'
  } catch {
    return true
  }
}

export function isMasterFanOutEnabledV1(): boolean {
  try {
    return globalThis.localStorage?.getItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY) !== 'disabled'
  } catch {
    return true
  }
}

export function classifyRequestedDomainIdsV1(request: string): Set<DomainAgentId> {
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
  const hasCharacter = downstreamWriting ? characterAction : characterMention
  return new Set<DomainAgentId>([
    ...(hasWorld ? ['world-origin' as const] : []),
    ...(hasCharacter ? ['character' as const] : []),
    ...(hasInspiration ? ['inspiration' as const] : []),
    ...(hasOutline ? ['outline' as const] : []),
    ...(hasProse ? ['prose' as const] : []),
  ])
}

export function selectAgentSkillIdV1(agentId: DomainAgentId, request: string): AgentSkillId {
  if (agentId === 'outline') {
    if (/章纲|章节大纲|章节规划|展开.{0,8}(?:卷纲|章节)|(?:卷纲|章节).{0,8}展开/.test(request)) {
      return 'outline.chapters'
    }
    if (/卷纲|卷级|分卷|全书大纲|新增.{0,6}卷|规划.{0,6}卷/.test(request)) {
      return 'outline.volumes'
    }
    return 'outline.compose'
  }
  if (agentId === 'prose') {
    return /续写|接着写|继续写|承接.{0,6}正文/.test(request)
      ? 'prose.continue'
      : 'prose.generate'
  }
  if (agentId === 'world-origin') return 'world-origin.complete'
  if (agentId === 'character') return 'character.create'
  return 'inspiration.reverse'
}

export function classifyMasterWorkflowV1(request: string): MasterWorkflowSelectionV1 {
  const domains = classifyRequestedDomainIdsV1(request)
  if (domains.has('outline') && domains.has('prose')) {
    return {
      version: 1,
      workflowId: 'staged-author-confirmed',
      reasonCodes: ['outline-prose-confirmation-barrier', 'multiple-explicit-domains'],
    }
  }
  if (
    domains.size > 1
    && domains.has('inspiration')
    && domains.has('world-origin')
    && !domains.has('outline')
    && !domains.has('prose')
    && /并行|同时|分别|各自/.test(request)
  ) {
    return {
      version: 1,
      workflowId: 'multi-domain-fan-out',
      reasonCodes: ['explicit-independent-fan-out', 'multiple-explicit-domains'],
    }
  }
  if (domains.size === 1 && /视角|第一人称|第三人称限知/.test(request)) {
    return {
      version: 1,
      workflowId: 'conservative-sequential',
      reasonCodes: ['perspective-resolution-required', 'single-explicit-domain'],
    }
  }
  if (domains.size === 1) {
    return { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] }
  }
  if (domains.size > 1) {
    return { version: 1, workflowId: 'multi-domain-sequential', reasonCodes: ['multiple-explicit-domains'] }
  }
  return { version: 1, workflowId: 'conservative-sequential', reasonCodes: ['domain-ambiguous'] }
}

export function selectMasterWorkflowV1(request: string): MasterWorkflowSelectionV1 {
  if (!isMasterWorkflowClassifierEnabledV1()) {
    return { version: 1, workflowId: 'conservative-sequential', reasonCodes: ['classifier-disabled'] }
  }
  const selected = classifyMasterWorkflowV1(request)
  if (selected.workflowId === 'multi-domain-fan-out' && !isMasterFanOutEnabledV1()) {
    return {
      version: 1,
      workflowId: 'multi-domain-sequential',
      reasonCodes: ['fan-out-disabled', 'multiple-explicit-domains'],
    }
  }
  return selected
}

export function parseMasterWorkflowSelectionV1(value: unknown): MasterWorkflowSelectionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('主 Agent workflow 必须是对象')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join(',') !== 'reasonCodes,version,workflowId') {
    throw new Error('主 Agent workflow 字段不符合严格契约')
  }
  if (record.version !== 1 || !MASTER_WORKFLOW_BY_ID.has(String(record.workflowId))) {
    throw new Error('主 Agent workflow 版本或 ID 无效')
  }
  if (
    !Array.isArray(record.reasonCodes)
    || record.reasonCodes.length < 1
    || record.reasonCodes.some(code => !REASON_CODES.includes(code as MasterWorkflowReasonCodeV1))
    || new Set(record.reasonCodes).size !== record.reasonCodes.length
  ) {
    throw new Error('主 Agent workflow reasonCodes 无效')
  }
  return {
    version: 1,
    workflowId: record.workflowId as MasterWorkflowIdV1,
    reasonCodes: record.reasonCodes as MasterWorkflowReasonCodeV1[],
  }
}

export function getMasterWorkflowV1(selection: MasterWorkflowSelectionV1): MasterWorkflowDefinitionV1 {
  const parsed = parseMasterWorkflowSelectionV1(selection)
  return MASTER_WORKFLOW_BY_ID.get(parsed.workflowId)!
}

export function assertMasterWorkflowTaskCompatibilityV1(
  selection: MasterWorkflowSelectionV1,
  tasks: ReadonlyArray<{
    id?: string
    agentId: DomainAgentId
    skillId?: string
    dependsOn?: readonly string[]
  }>,
): void {
  const workflow = getMasterWorkflowV1(selection)
  if (workflow.strategy === 'direct' && tasks.length !== 1) {
    throw new Error('单领域直接工作流必须且只能包含一个任务')
  }
  for (const task of tasks) {
    if (task.skillId) getAgentSkillV1(task.skillId, task.agentId)
  }
  if (workflow.strategy === 'fan-out' && !hasMasterFanOutPairV1(tasks)) {
    throw new Error('有限 fan-out 工作流至少需要一对无依赖且写目标不冲突的任务')
  }
}

export function isMasterAgentRunWorkflowKindV1(value: AgentRunWorkflowKind): boolean {
  return value === 'direct-generation'
    || value === 'multi-domain-sequential'
    || value === 'fan-out-synthesize'
}

interface FanOutTaskLikeV1 {
  id?: string
  agentId: DomainAgentId
  skillId?: string
  dependsOn?: readonly string[]
}

function taskWriteTables(task: FanOutTaskLikeV1): Set<string> {
  return new Set(resolveAgentSkillV1(task.agentId, task.skillId).writeTargets.map(target => target.table))
}

function tasksHaveWriteConflict(left: FanOutTaskLikeV1, right: FanOutTaskLikeV1): boolean {
  const leftTables = taskWriteTables(left)
  return [...taskWriteTables(right)].some(table => leftTables.has(table))
}

/** Stable, bounded selection for one generation wave. Canon adoption remains serial. */
export function selectMasterFanOutBatchV1<T extends FanOutTaskLikeV1>(
  tasks: readonly T[],
  completedTaskIds: ReadonlySet<string>,
  maxConcurrency = 2,
): T[] {
  const boundedConcurrency = Math.max(1, Math.min(2, Math.floor(maxConcurrency)))
  const available = tasks.filter(task => (
    task.id
    && !completedTaskIds.has(task.id)
    && (task.dependsOn ?? []).every(dependency => completedTaskIds.has(dependency))
  ))
  const selected: T[] = []
  for (const task of available) {
    if (selected.length >= boundedConcurrency) break
    if (selected.some(existing => tasksHaveWriteConflict(existing, task))) continue
    selected.push(task)
  }
  return selected
}

export function hasMasterFanOutPairV1(tasks: readonly FanOutTaskLikeV1[]): boolean {
  if (tasks.length < 2 || tasks.some(task => !task.id)) return false
  const completed = new Set<string>()
  while (completed.size < tasks.length) {
    const batch = selectMasterFanOutBatchV1(tasks, completed, 2)
    if (batch.length > 1) return true
    const next = batch[0]
    if (!next?.id) return false
    completed.add(next.id)
  }
  return false
}
