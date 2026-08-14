import { db } from '../db/schema'
import { canonicalStringify } from '../agent/run/hash'
import { adopt } from '../registry/adopt'
import type { ForeshadowType, WorkspaceScope } from '../types'
import { readOwnedRows, scopeTransactionTables } from '../world-engine/scope'

export interface ForeshadowSuggestionBaselineRowV1 {
  id: number
  name: string
  type: ForeshadowType
  status: 'planned' | 'planted' | 'echoed' | 'resolved'
  description: string
  plantChapterId: number | null
  echoChapterIds: string
  resolveChapterId: number | null
  notes: string
  timelinePosition: number | null
  expectedResolveChapterId: number | null
  importance: number | null
  urgency: 'low' | 'medium' | 'high' | 'critical' | null
  worldId: number | null
  workId: number | null
  createdAt: number
  updatedAt: number
}

export interface ForeshadowSuggestionBaselineV1 {
  version: 1
  project: {
    id: number
    name: string
    genre: string
    genres: string[]
    description: string
  }
  worldGroupId: number | null
  foreshadows: ForeshadowSuggestionBaselineRowV1[]
}

export interface ForeshadowSuggestionCandidateItemV1 {
  name: string
  type: ForeshadowType
  description: string
}

export interface ForeshadowSuggestionFormalItemV1 extends ForeshadowSuggestionCandidateItemV1 {
  status: 'planned'
  plantChapterId: null
  echoChapterIds: []
  resolveChapterId: null
  notes: ''
}

const TYPES = new Set<ForeshadowType>([
  'chekhov', 'prophecy', 'symbol', 'character', 'dialogue',
  'environment', 'timeline', 'red-herring', 'parallel', 'callback',
])
const STATUSES = new Set(['planned', 'planted', 'echoed', 'resolved'])
const URGENCIES = new Set(['low', 'medium', 'high', 'critical'])

function nullableInteger(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null
}

function nullableFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function readForeshadowSuggestionBaselineV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
}): Promise<ForeshadowSuggestionBaselineV1> {
  const [project, rows] = await Promise.all([
    db.projects.get(input.scope.projectId),
    readOwnedRows<Record<string, unknown>>(input.scope, 'foreshadows', { owner: 'work' }),
  ])
  if (!project?.id) throw new Error('伏笔建议目标项目不存在。')
  const foreshadows = rows.map(row => {
    if (!Number.isInteger(row.id) || !TYPES.has(row.type as ForeshadowType)
      || !STATUSES.has(String(row.status)) || !Number.isFinite(row.createdAt)
      || !Number.isFinite(row.updatedAt)) throw new Error('既有伏笔 baseline 包含无效记录。')
    const urgency = row.urgency == null ? null : String(row.urgency)
    if (urgency != null && !URGENCIES.has(urgency)) throw new Error('既有伏笔紧急度无效。')
    return {
      id: row.id as number,
      name: String(row.name ?? ''),
      type: row.type as ForeshadowType,
      status: row.status as ForeshadowSuggestionBaselineRowV1['status'],
      description: String(row.description ?? ''),
      plantChapterId: nullableInteger(row.plantChapterId),
      echoChapterIds: String(row.echoChapterIds ?? '[]'),
      resolveChapterId: nullableInteger(row.resolveChapterId),
      notes: String(row.notes ?? ''),
      timelinePosition: nullableFinite(row.timelinePosition),
      expectedResolveChapterId: nullableInteger(row.expectedResolveChapterId),
      importance: nullableFinite(row.importance),
      urgency: urgency as ForeshadowSuggestionBaselineRowV1['urgency'],
      worldId: nullableInteger(row.worldId),
      workId: nullableInteger(row.workId),
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
    }
  }).sort((left, right) => left.id - right.id)
  return {
    version: 1,
    project: {
      id: project.id,
      name: project.name,
      genre: project.genre,
      genres: [...project.genres],
      description: project.description,
    },
    worldGroupId: input.worldGroupId,
    foreshadows,
  }
}

export function formatForeshadowSuggestionBaselineV1(baseline: ForeshadowSuggestionBaselineV1): string {
  return [
    '【伏笔建议正式基线】',
    `项目：${baseline.project.name}`,
    `题材：${baseline.project.genres.join('、') || baseline.project.genre || '未设置'}`,
    baseline.project.description ? `项目说明：${baseline.project.description}` : '',
    `目标世界组：${baseline.worldGroupId ?? '主世界/未分组'}`,
    baseline.foreshadows.length ? '已有伏笔（名称不得重复）：' : '已有伏笔：无',
    ...baseline.foreshadows.map(row => (
      `- #${row.id} ${row.name}｜${row.type}｜${row.status}｜${row.description.slice(0, 600)}`
    )),
  ].filter(Boolean).join('\n')
}

export async function readForeshadowSuggestionBaselineContextV1(input: {
  scope: WorkspaceScope
  worldGroupId?: number | null
}): Promise<string> {
  // Context Gateway can enumerate every registered source before a concrete
  // project exists (for example while calculating a model budget). In that
  // generic path a missing owner means "source unavailable", not a corrupt
  // durable foreshadow run. The runner still calls the strict baseline reader
  // itself and therefore continues to fail closed for an invalid target.
  if (!await db.projects.get(input.scope.projectId)) return ''
  return formatForeshadowSuggestionBaselineV1(await readForeshadowSuggestionBaselineV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId ?? null,
  }))
}

export function buildForeshadowSuggestionFormalItemsV1(
  candidates: readonly ForeshadowSuggestionCandidateItemV1[],
): ForeshadowSuggestionFormalItemV1[] {
  return candidates.map(candidate => ({
    ...candidate,
    status: 'planned',
    plantChapterId: null,
    echoChapterIds: [],
    resolveChapterId: null,
    notes: '',
  }))
}

export async function adoptForeshadowSuggestionsAtomicV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  baseline: ForeshadowSuggestionBaselineV1
  formalItems: readonly ForeshadowSuggestionFormalItemV1[]
}): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.foreshadows), async () => {
    const current = await readForeshadowSuggestionBaselineV1({
      scope: input.scope,
      worldGroupId: input.worldGroupId,
    })
    if (canonicalStringify(current) !== canonicalStringify(input.baseline)) {
      throw new Error('伏笔建议 CAS 失败：项目或正式伏笔 baseline 已变化。')
    }
    const result = await adopt({
      projectId: input.scope.projectId,
      scope: input.scope,
      target: 'foreshadows',
      mode: 'add-many',
      data: input.formalItems.map(item => ({ ...item })),
    })
    if (result.written.length !== input.formalItems.length
      || result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length) {
      throw new Error('伏笔冻结候选未完整通过注册表校验，事务已回滚。')
    }
  })
}
