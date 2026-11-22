import type { PromptExecutionRequestV1 } from './prompt-execution'
import type { PromptTemplate } from '../types/prompt'
import type { AuthorLengthIntentV1, TaskLengthPlanV1, ContextMaterialAllocationV2 } from '../types/agent-run'
import type { WorkspaceScope } from '../types/world-ownership'
import type { WorldviewAgentField, WorldviewFieldCopilotSnapshot, WorldviewFieldOperationV1 } from './worldview-field-copilot'
import type { AuthorLengthObservationV1 } from '../ai/author-length-revision'
import type { StructuredOutputRunEvidenceV1 } from './structured-output-pipeline'
import { WORLDVIEW_GENERATABLE_FIELD_SPECS } from '../registry/field-registry'
import { createAuthorLengthIntentV1, parseAuthorLengthIntentV1, parseTaskLengthPlanV1, resolveTaskLengthPlanV1 } from '../ai/author-length-intent'
import { hashCanonicalValue, canonicalStringify } from './run/hash'
import { countWords } from '../utils/html'

export const WORLDVIEW_FIELD_SKILL_V2 = 'world-origin.worldview-field.v2' as const
export const WORLDVIEW_FIELD_ENTRY_V2 = 'world.worldview-field.v2' as const
export const WORLDVIEW_FULL_SOURCE_KEYS_V2 = ['manualText', 'worldviewFieldBaselineV2', 'worldviewFieldContextV2'] as const
export interface WorldviewExactRefV2 {
  artifactKind: import('../types/memory-engineering').ExactRunArtifactKindV1
  contentHash: string
  byteLength: number
  stepId?: string
  attempt?: number
}
/** Product-local prompt carrier. Never parsed as/migrated into old Prompt V1. */
export interface WorldviewFieldPromptV2 {
  version: 'worldview-field-prompt-v2'
  template: PromptTemplate
  templateHash: string
  request: PromptExecutionRequestV1
  requestHash: string
}
export interface WorldviewFieldTaskV2 {
  id: string
  agentId: 'world-origin'
  skillId: typeof WORLDVIEW_FIELD_SKILL_V2
  instruction: string
  dependsOn: []
  targetField: WorldviewAgentField
  authorLengthIntent: AuthorLengthIntentV1 | null
  worldviewFieldPromptV2: WorldviewFieldPromptV2
}
export interface WorldviewFieldRootV2 {
  version: 'worldview-field-root-v2'
  portable: false
  scope: WorkspaceScope
  worldGroupId: number | null
  conversationId: number
  task: WorldviewFieldTaskV2
  operation: WorldviewFieldOperationV1
  lengthPlan: TaskLengthPlanV1
  sourceRefs: WorldviewExactRefV2[]
  baselineSnapshotRef: WorldviewExactRefV2
  rootHash: string
}
export interface WorldviewFieldPlanV2 {
  version: 'worldview-field-plan-v2'
  rootHash: string
  previousPlanHash: string | null
  round: number
  predecessorDraftHash: string | null
  material: ContextMaterialAllocationV2
  request: import('../ai/client').AIRequestEvidenceV2
  lengthPlan: TaskLengthPlanV1
  frameHash: string
  forecast: { modelCalls: number; inputTokens: number; outputTokens: number }
  planHash: string
}
export interface WorldviewFieldRoundV2 {
  version: 'worldview-field-round-v2'
  runId: number
  rootHash: string
  planHash: string
  callId: string
  rawRef: WorldviewExactRefV2
  callRef: WorldviewExactRefV2
  planRef: WorldviewExactRefV2
  wireRef: WorldviewExactRefV2
  frameRef: WorldviewExactRefV2
  draftRef: WorldviewExactRefV2
  resultHash: string
  observation: AuthorLengthObservationV1
  structuredOutputEvidence: StructuredOutputRunEvidenceV1
}
export interface WorldviewFieldCandidateMetadataV2 {
  version: 'worldview-field-candidate-v2'
  rootRef: WorldviewExactRefV2
  draftRef: WorldviewExactRefV2
  roundRefs: WorldviewExactRefV2[]
  lengthPlan: TaskLengthPlanV1
  lengthObservation: AuthorLengthObservationV1
  disposition: 'ready' | 'needs-attention' | 'author-edited'
  reason: string
}

export function assertWorldviewExactKeysV2(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error(`${label}字段集合无效。`)
}
export function parseWorldviewExactRefV2(value: unknown): WorldviewExactRefV2 {
  const row = value as WorldviewExactRefV2
  assertWorldviewExactKeysV2(value, ['artifactKind','contentHash','byteLength', ...(row?.stepId === undefined ? [] : ['stepId','attempt'])], 'worldview exact ref')
  if (!['source-snapshot','rendered-request','raw-response','tool-result','context-manifest'].includes(row.artifactKind)
    || !/^[a-f0-9]{64}$/.test(row.contentHash) || !Number.isSafeInteger(row.byteLength) || row.byteLength < 0
    || row.stepId !== undefined && (!row.stepId || !Number.isSafeInteger(row.attempt) || row.attempt! < 1)) throw new Error('准确工件引用无效。')
  return structuredClone(row)
}
export async function freezeWorldviewFieldPromptV2(template: PromptTemplate, request: PromptExecutionRequestV1): Promise<WorldviewFieldPromptV2> {
  const frozen = structuredClone(template), normalized = parseWorldviewPromptRequestV2(request)
  if (frozen.moduleKey !== 'worldview.dimension' || typeof frozen.systemPrompt !== 'string' || typeof frozen.userPromptTemplate !== 'string') throw new Error('世界基座模板身份无效。')
  const parameters = new Set((frozen.parameters ?? []).map(item => item.key))
  if (Object.keys(normalized.parameterValues ?? {}).some(key => !parameters.has(key))) throw new Error('参数未在本轮有效模板中声明。')
  return { version: 'worldview-field-prompt-v2', template: frozen, templateHash: await hashCanonicalValue(frozen),
    request: normalized, requestHash: await hashCanonicalValue(normalized) }
}
function parseWorldviewPromptRequestV2(value: unknown): PromptExecutionRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界基座 Prompt 请求无效。')
  const row = value as PromptExecutionRequestV1
  const allowed = ['version','moduleKey','parameterValues','systemOverride','userOverride','temperature','maxTokens']
  if (Object.keys(row).some(key => !allowed.includes(key)) || row.version !== 1 || row.moduleKey !== 'worldview.dimension') throw new Error('世界基座 Prompt 请求身份无效。')
  for (const key of ['systemOverride','userOverride'] as const) if (row[key] !== undefined && row[key] !== null && typeof row[key] !== 'string') throw new Error('Prompt 覆盖必须为文本。')
  if (row.temperature !== undefined && (typeof row.temperature !== 'number' || !Number.isFinite(row.temperature) || row.temperature < 0 || row.temperature > 2)) throw new Error('temperature 无效。')
  if (row.maxTokens !== undefined && (!Number.isSafeInteger(row.maxTokens) || row.maxTokens < 1)) throw new Error('作者明确输出消费约束无效。')
  if (row.parameterValues !== undefined) {
    if (!row.parameterValues || typeof row.parameterValues !== 'object' || Array.isArray(row.parameterValues)) throw new Error('参数必须为对象。')
    for (const [key,item] of Object.entries(row.parameterValues)) if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)
      || item !== null && !['string','number','boolean'].includes(typeof item)
      || typeof item === 'number' && !Number.isFinite(item)) throw new Error('Prompt 参数名或类型无效。')
  }
  return structuredClone(row)
}
export async function parseWorldviewFieldTaskV2(value: unknown): Promise<WorldviewFieldTaskV2> {
  assertWorldviewExactKeysV2(value, ['id','agentId','skillId','instruction','dependsOn','targetField','authorLengthIntent','worldviewFieldPromptV2'], 'worldview task v2')
  const task = value as unknown as WorldviewFieldTaskV2
  if (task.agentId !== 'world-origin' || task.skillId !== WORLDVIEW_FIELD_SKILL_V2 || typeof task.id !== 'string' || !task.id.trim()
    || typeof task.instruction !== 'string' || !task.instruction.trim() || !Array.isArray(task.dependsOn) || task.dependsOn.length
    || !WORLDVIEW_GENERATABLE_FIELD_SPECS.some(spec => spec.field === task.targetField)) throw new Error('世界基座新任务身份或目标无效。')
  if (task.authorLengthIntent !== null) parseAuthorLengthIntentV1(task.authorLengthIntent)
  const prompt = task.worldviewFieldPromptV2
  assertWorldviewExactKeysV2(prompt, ['version','template','templateHash','request','requestHash'], 'worldview prompt v2')
  const expected = await freezeWorldviewFieldPromptV2(prompt.template, prompt.request)
  if (canonicalStringify(expected) !== canonicalStringify(prompt)) throw new Error('世界基座冻结模板或请求 hash 无效。')
  return structuredClone(task)
}
export function worldviewTargetTextV2(value: WorldviewFieldCopilotSnapshot['values'][WorldviewAgentField]): string {
  // Native object fields: count content values only; JSON keys/booleans/metadata never count.
  return typeof value === 'string' ? value : Object.values(value).filter((item): item is string => typeof item === 'string').join('\n')
}
export function resolveWorldviewLengthPlanV2(task: WorldviewFieldTaskV2, snapshot: WorldviewFieldCopilotSnapshot,
  operation: WorldviewFieldOperationV1): TaskLengthPlanV1 {
  const spec = WORLDVIEW_GENERATABLE_FIELD_SPECS.find(item => item.field === task.targetField)!
  const structured = spec.aiGeneration.kind !== 'text'
  const short = task.targetField === 'worldDimensions'
  const components = spec.aiGeneration.kind === 'natural-resources'
    ? ['rareCreatures','herbs','minerals','others'].map(componentKey => ({ componentKey, taskKind: 'setting-field' as const, referenceWords: 4000 }))
    : spec.aiGeneration.kind === 'divine-design'
      ? [{ componentKey: 'divineRank', taskKind: 'short-field' as const, referenceWords: null },
        ...['divineNames','divineRules'].map(componentKey => ({ componentKey, taskKind: 'setting-field' as const, referenceWords: 4000 }))] : []
  // Controls/parameters inherit the actual operation, not an earlier hidden UI basis.
  // An explicit instruction's declared counting basis remains the author's choice.
  const originalIntent = task.authorLengthIntent
  const intent = originalIntent && operation !== 'expand' && originalIntent.source !== 'instruction'
    ? createAuthorLengthIntentV1({ ...originalIntent, basis: 'final-text' }) : originalIntent
  return resolveTaskLengthPlanV1({ taskKind: structured ? 'setting-set' : short ? 'short-field' : 'setting-field', operation,
    originalWords: countWords(worldviewTargetTextV2(snapshot.values[task.targetField])), intent,
    components, arrangement: { version: 1, basis: operation === 'polish' ? 'preserve-original' : 'task-semantics', sourceKeys: [...WORLDVIEW_FULL_SOURCE_KEYS_V2] } })
}
export function assertWorldviewRootV2(value: unknown): asserts value is WorldviewFieldRootV2 {
  assertWorldviewExactKeysV2(value, ['version','portable','scope','worldGroupId','conversationId','task','operation','lengthPlan','sourceRefs','baselineSnapshotRef','rootHash'], 'worldview root')
  const row = value as unknown as WorldviewFieldRootV2
  if (row.version !== 'worldview-field-root-v2' || row.portable !== false
    || !Number.isSafeInteger(row.conversationId) || row.conversationId < 1 || !['create','expand','rewrite','polish'].includes(row.operation)
    || !Array.isArray(row.sourceRefs) || row.sourceRefs.length !== WORLDVIEW_FULL_SOURCE_KEYS_V2.length || !/^[a-f0-9]{64}$/.test(row.rootHash)) throw new Error('世界基座 Root 身份无效。')
  assertWorldviewExactKeysV2(row.scope,['projectId','worldId','workId'],'worldview root scope')
  if(Object.values(row.scope).some(id=>typeof id!=='number'||!Number.isSafeInteger(id)||id<1)||!(row.worldGroupId===null||Number.isSafeInteger(row.worldGroupId)&&row.worldGroupId>0))throw new Error('世界基座 scope 身份无效。')
  const plan=parseTaskLengthPlanV1(row.lengthPlan)
  if(plan.operation!==row.operation)throw new Error('实际操作与篇幅计划不一致。')
  row.sourceRefs.forEach(parseWorldviewExactRefV2); parseWorldviewExactRefV2(row.baselineSnapshotRef)
}
