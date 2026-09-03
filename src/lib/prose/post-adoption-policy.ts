import { db } from '../db/schema'
import { propagateChapterEditStale } from '../consistency/impact-analysis'
import { hashCanonicalValue } from '../agent/run/hash'
import { computeKnownCostUsd } from '../ai/usage-log'
import type {
  PostAdoptionBudgetV1,
  PostAdoptionPolicyV1,
  PostAdoptionTaskTypeV1,
  Work,
  WorkspaceScope,
} from '../types/world-ownership'
import { assertRecordInScope, readOwnedRows } from '../workspace/scope'
import { updateWorkPostAdoptionPolicyV1 } from '../workspace/works'

export const DEFAULT_POST_ADOPTION_TASK_TYPES_V1 = Object.freeze([
  'organization',
  'memory',
  'retrieval',
  'consistency',
] as const satisfies readonly PostAdoptionTaskTypeV1[])

export const DEFAULT_POST_ADOPTION_BUDGET_V1: Readonly<PostAdoptionBudgetV1> = Object.freeze({
  maxModelCalls: 2,
  maxInputTokens: 48_000,
  maxOutputTokens: 16_000,
  maxCostUsd: 0.25,
  allowUnknownCost: false,
})

const TASK_TYPES = new Set<PostAdoptionTaskTypeV1>(DEFAULT_POST_ADOPTION_TASK_TYPES_V1)

export interface ResolvedPostAdoptionSettingsV1 {
  version: 1
  policy: PostAdoptionPolicyV1
  taskTypes: PostAdoptionTaskTypeV1[]
  budget: PostAdoptionBudgetV1
}

export interface PostAdoptionAuthorizationSnapshotV1 extends ResolvedPostAdoptionSettingsV1 {
  taskKey: string
  settingsHash: string
  chapterId: number
  sourceTextHash: string
  modelRoutes: Array<{
    taskType: 'organization' | 'memory'
    provider: string
    model: string
  }>
  estimate: {
    modelCalls: number
    inputTokens: { min: number; max: number }
    outputTokens: { min: number; max: number }
    costUsd: { min: number; max: number } | null
  }
}

export interface PostAdoptionAutoPreflightV1 {
  allowed: boolean
  reason: string | null
  snapshot: PostAdoptionAuthorizationSnapshotV1
}

function positiveInt(value: unknown, fallback: number, maximum: number): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Math.min(Number(value), maximum)
    : fallback
}

function positiveNumber(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, maximum)
    : fallback
}

/** Normalize dependencies so a selected deterministic step never runs on stale inputs. */
export function normalizePostAdoptionTaskTypesV1(
  value: unknown,
): PostAdoptionTaskTypeV1[] {
  if (!Array.isArray(value)) return [...DEFAULT_POST_ADOPTION_TASK_TYPES_V1]
  const requested = new Set<PostAdoptionTaskTypeV1>(
    value.filter((item): item is PostAdoptionTaskTypeV1 => TASK_TYPES.has(item as PostAdoptionTaskTypeV1)),
  )
  if (requested.has('consistency')) requested.add('retrieval')
  if (requested.has('retrieval')) requested.add('memory')
  // `off` is the explicit zero-task policy. An enabled policy always keeps one
  // useful task instead of unexpectedly re-enabling the complete default set.
  if (requested.size === 0) return ['organization']
  return DEFAULT_POST_ADOPTION_TASK_TYPES_V1.filter(task => requested.has(task))
}

export function resolveWorkPostAdoptionSettingsV1(
  work: Pick<Work, 'postAdoptionPolicy' | 'postAdoptionTaskTypes' | 'postAdoptionBudget'> | null | undefined,
): ResolvedPostAdoptionSettingsV1 {
  const policy: PostAdoptionPolicyV1 = work?.postAdoptionPolicy === 'off'
    || work?.postAdoptionPolicy === 'auto-with-budget'
    || work?.postAdoptionPolicy === 'suggest'
    ? work.postAdoptionPolicy
    : 'suggest'
  const rawBudget = work?.postAdoptionBudget
  return {
    version: 1,
    policy,
    taskTypes: normalizePostAdoptionTaskTypesV1(work?.postAdoptionTaskTypes),
    budget: {
      maxModelCalls: positiveInt(rawBudget?.maxModelCalls, DEFAULT_POST_ADOPTION_BUDGET_V1.maxModelCalls, 8),
      maxInputTokens: positiveInt(rawBudget?.maxInputTokens, DEFAULT_POST_ADOPTION_BUDGET_V1.maxInputTokens, 1_000_000),
      maxOutputTokens: positiveInt(rawBudget?.maxOutputTokens, DEFAULT_POST_ADOPTION_BUDGET_V1.maxOutputTokens, 256_000),
      maxCostUsd: positiveNumber(rawBudget?.maxCostUsd, DEFAULT_POST_ADOPTION_BUDGET_V1.maxCostUsd, 1_000),
      allowUnknownCost: rawBudget?.allowUnknownCost === true,
    },
  }
}

export async function readWorkPostAdoptionSettingsV1(
  scope: WorkspaceScope,
): Promise<ResolvedPostAdoptionSettingsV1> {
  const work = await db.works.get(scope.workId)
  if (!work || work.projectId !== scope.projectId || work.worldId !== scope.worldId) {
    throw new Error('章后策略找不到当前 Work 根。')
  }
  return resolveWorkPostAdoptionSettingsV1(work)
}

export async function updateWorkPostAdoptionSettingsV1(input: {
  scope: WorkspaceScope
  settings: ResolvedPostAdoptionSettingsV1
}): Promise<ResolvedPostAdoptionSettingsV1> {
  const current = await db.works.get(input.scope.workId)
  if (!current || current.projectId !== input.scope.projectId || current.worldId !== input.scope.worldId) {
    throw new Error('章后策略不能写入其他 Work。')
  }
  const settings = resolveWorkPostAdoptionSettingsV1({
    postAdoptionPolicy: input.settings.policy,
    postAdoptionTaskTypes: input.settings.taskTypes,
    postAdoptionBudget: input.settings.budget,
  })
  await updateWorkPostAdoptionPolicyV1({
    scope: input.scope,
    policy: settings.policy,
    taskTypes: settings.taskTypes,
    budget: settings.budget,
  })
  return settings
}

function estimateFor(
  settings: ResolvedPostAdoptionSettingsV1,
  modelRoutes: PostAdoptionAuthorizationSnapshotV1['modelRoutes'],
) {
  const modelCalls = Number(settings.taskTypes.includes('organization'))
    + Number(settings.taskTypes.includes('memory'))
  const inputMax = Number(settings.taskTypes.includes('organization')) * 24_000
    + Number(settings.taskTypes.includes('memory')) * 24_000
  const outputMax = Number(settings.taskTypes.includes('organization')) * 8_000
    + Number(settings.taskTypes.includes('memory')) * 8_000
  const inputMin = Math.min(inputMax, modelCalls * 1_000)
  const outputMin = Math.min(outputMax, modelCalls * 300)
  const selectedRoutes = modelRoutes.filter(route => settings.taskTypes.includes(route.taskType))
  const perCallInputMin = modelCalls > 0 ? Math.floor(inputMin / modelCalls) : 0
  const perCallInputMax = modelCalls > 0 ? Math.floor(inputMax / modelCalls) : 0
  const perCallOutputMin = modelCalls > 0 ? Math.floor(outputMin / modelCalls) : 0
  const perCallOutputMax = modelCalls > 0 ? Math.floor(outputMax / modelCalls) : 0
  const minimumCosts = selectedRoutes.map(route => computeKnownCostUsd(route.model, perCallInputMin, perCallOutputMin))
  const maximumCosts = selectedRoutes.map(route => computeKnownCostUsd(route.model, perCallInputMax, perCallOutputMax))
  const costKnown = minimumCosts.every(cost => cost != null) && maximumCosts.every(cost => cost != null)
  const costMin = costKnown ? minimumCosts.reduce<number>((sum, cost) => sum + Number(cost), 0) : null
  const costMax = costKnown ? maximumCosts.reduce<number>((sum, cost) => sum + Number(cost), 0) : null
  return {
    modelCalls,
    inputTokens: { min: inputMin, max: inputMax },
    outputTokens: { min: outputMin, max: outputMax },
    costUsd: costMin == null || costMax == null ? null : { min: costMin, max: costMax },
  }
}

export async function buildPostAdoptionAuthorizationSnapshotV1(input: {
  scope: WorkspaceScope
  chapterId: number
  sourceTextHash: string
  modelRoutes: Array<{
    taskType: 'organization' | 'memory'
    provider: string
    model: string
  }>
  settings: ResolvedPostAdoptionSettingsV1
}): Promise<PostAdoptionAuthorizationSnapshotV1> {
  const normalized = resolveWorkPostAdoptionSettingsV1({
    postAdoptionPolicy: input.settings.policy,
    postAdoptionTaskTypes: input.settings.taskTypes,
    postAdoptionBudget: input.settings.budget,
  })
  if (new Set(input.modelRoutes.map(route => route.taskType)).size !== input.modelRoutes.length) {
    throw new Error('章后授权的模型路由不得重复。')
  }
  const providedRoutes = new Map(input.modelRoutes.map(route => [route.taskType, route]))
  const modelRoutes = (['organization', 'memory'] as const)
    .filter(taskType => normalized.taskTypes.includes(taskType))
    .map(taskType => {
      const route = providedRoutes.get(taskType)
      if (!route?.provider.trim() || !route.model.trim()) {
        throw new Error(`章后授权缺少 ${taskType} 的冻结模型路由。`)
      }
      return {
        taskType,
        provider: route.provider.trim(),
        model: route.model.trim(),
      }
    })
  const settingsHash = await hashCanonicalValue(normalized)
  const taskKey = await hashCanonicalValue({
    version: 1,
    workId: input.scope.workId,
    chapterId: input.chapterId,
    sourceTextHash: input.sourceTextHash,
    settingsHash,
    modelRoutes,
  })
  return {
    ...normalized,
    taskKey,
    settingsHash,
    chapterId: input.chapterId,
    sourceTextHash: input.sourceTextHash,
    modelRoutes,
    estimate: estimateFor(normalized, modelRoutes),
  }
}

export function preflightPostAdoptionAutoV1(
  snapshot: PostAdoptionAuthorizationSnapshotV1,
): PostAdoptionAutoPreflightV1 {
  if (snapshot.policy !== 'auto-with-budget') {
    return { allowed: false, reason: '当前 Work 没有启用 auto-with-budget。', snapshot }
  }
  if (snapshot.estimate.modelCalls > snapshot.budget.maxModelCalls) {
    return { allowed: false, reason: '预计模型调用次数超过预授权上限。', snapshot }
  }
  if (snapshot.estimate.inputTokens.max > snapshot.budget.maxInputTokens) {
    return { allowed: false, reason: '预计输入 token 超过预授权上限。', snapshot }
  }
  if (snapshot.estimate.outputTokens.max > snapshot.budget.maxOutputTokens) {
    return { allowed: false, reason: '预计输出 token 超过预授权上限。', snapshot }
  }
  if (snapshot.estimate.costUsd == null && !snapshot.budget.allowUnknownCost) {
    return { allowed: false, reason: '当前模型没有可信价格表，且未授权未知费用自动运行。', snapshot }
  }
  if (snapshot.estimate.costUsd && snapshot.estimate.costUsd.max > snapshot.budget.maxCostUsd) {
    return { allowed: false, reason: '预计费用超过预授权上限。', snapshot }
  }
  return { allowed: true, reason: null, snapshot }
}

/**
 * Zero-model, deterministic invalidation. It is safe in every policy mode and
 * never deletes Canon: retrieval chunks are rebuildable caches; summary nodes
 * are retained but marked stale; confirmed facts only demote when their exact
 * evidence quote disappeared.
 */
export async function invalidateChapterPostAdoptionDerivativesV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<{ deletedChunks: number; staleSummaries: number; demotedFacts: number }> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('章后失效处理找不到当前作品的来源章节。')
  }
  const [chunks, summaries, facts] = await Promise.all([
    readOwnedRows<any>(input.scope, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<any>(input.scope, 'narrativeSummaryNodes', { owner: 'work' }),
    propagateChapterEditStale(input.scope, input.chapterId),
  ])
  const chunkIds = chunks
    .filter(row => row.sourceChapterId === input.chapterId && row.id != null)
    .map(row => row.id as number)
  if (chunkIds.length) await db.retrievalChunks.bulkDelete(chunkIds)
  let staleSummaries = 0
  for (const row of summaries) {
    if (row.id == null) continue
    if (row.level === 'book' || row.level === 'volume' || row.sourceChapterId === input.chapterId) {
      if (row.status !== 'stale') staleSummaries++
      await db.narrativeSummaryNodes.update(row.id, { status: 'stale', updatedAt: Date.now() })
    }
  }
  return { deletedChunks: chunkIds.length, staleSummaries, demotedFacts: facts.demotedFacts }
}
