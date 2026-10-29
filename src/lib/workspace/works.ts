/** Work creation and switching inside one workspace semantic scope. */
import { db } from '../db/schema'
import type {
  NovelWorkflowProfile,
  PostAdoptionBudgetV1,
  PostAdoptionPolicyV1,
  PostAdoptionTaskTypeV1,
  Work,
  WorkKind,
  WorkspaceScope,
} from '../types/world-ownership'
import type { Project, WorkStatus } from '../types/project'
import { resolveWorkspaceOwnership } from './ownership'
import { assertRecordInScope, readOwnedRows, resolveScope, scopeTransactionTables } from './scope'
import { generateWorkCode } from '../memory/identity'
import {
  assertShortNovelTargetWords,
  effectiveNovelProfile,
  effectiveWorkKind,
  normalizeNewWorkClassification,
  SHORT_NOVEL_MAX_WORDS,
  SHORT_NOVEL_MIN_WORDS,
} from './work-kind'
import type { Chapter } from '../types/outline'
import { canonicalManuscriptWordCount } from '../chapters/selectors'

export interface CreateWorkInput {
  title: string
  description?: string
  genres?: string[]
  customGenre?: string
  status?: WorkStatus
  targetWordCount?: number
  coverImage?: string
  activeCharacterDrivenPlanId?: number | null
  kind?: WorkKind
  novelProfile?: NovelWorkflowProfile | null
}

export function buildWorkRecord(input: {
  projectId: number
  worldId: number
  fallback: Pick<Work, 'genres' | 'targetWordCount' | 'writingStyleId' | 'methodologyId' | 'includeCultivationProgressInAI'>
  create: CreateWorkInput
  now: number
}): Work {
  const title = input.create.title.trim()
  if (!title) throw new Error('[works] 作品名称不能为空')
  const targetWordCount = input.create.targetWordCount ?? input.fallback.targetWordCount
  const classification = normalizeNewWorkClassification({
    kind: input.create.kind,
    novelProfile: input.create.novelProfile,
    targetWordCount,
  })
  const status = input.create.status ?? 'drafting'
  if (classification.novelProfile === 'short' && status === 'completed') {
    throw new Error('[works] 空白短篇不能在创建时标记为已完成')
  }
  return {
    projectId: input.projectId,
    worldId: input.worldId,
    code: generateWorkCode(),
    ...classification,
    title,
    description: input.create.description?.trim() ?? '',
    genres: input.create.genres?.length ? [...input.create.genres] : [...input.fallback.genres],
    customGenre: input.create.customGenre?.trim() || undefined,
    status,
    targetWordCount,
    currentWordCount: 0,
    coverImage: input.create.coverImage,
    writingStyleId: input.fallback.writingStyleId,
    methodologyId: input.fallback.methodologyId,
    includeCultivationProgressInAI: input.fallback.includeCultivationProgressInAI,
    activeCharacterDrivenPlanId: input.create.activeCharacterDrivenPlanId ?? null,
    activeNarrativeModuleId: null,
    postAdoptionPolicy: 'suggest',
    postAdoptionTaskTypes: ['organization', 'memory', 'retrieval', 'consistency'],
    postAdoptionBudget: {
      maxModelCalls: 2,
      maxInputTokens: 48_000,
      maxOutputTokens: 16_000,
      maxCostUsd: 0.25,
      allowUnknownCost: false,
    },
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export async function listWorldWorks(projectId: number, worldId?: number): Promise<Work[]> {
  const ownership = await resolveWorkspaceOwnership(projectId)
  const targetWorldId = worldId ?? ownership.scope.worldId
  const world = await db.worlds.get(targetWorldId)
  if (!world || world.projectId !== projectId) throw new Error('[works] World 不属于当前工作区')
  return db.works.where('worldId').equals(targetWorldId).sortBy('createdAt')
}

export async function createWorldWork(projectId: number, input: CreateWorkInput): Promise<Work> {
  const ownership = await resolveWorkspaceOwnership(projectId)
  const ts = Date.now()
  const row = buildWorkRecord({
    projectId,
    worldId: ownership.scope.worldId,
    fallback: ownership.work,
    create: input,
    now: ts,
  })
  const id = await db.works.add(row) as number
  return { ...row, id }
}

export async function switchActiveWork(projectId: number, workId: number): Promise<WorkspaceScope> {
  return db.transaction('rw', db.projects, db.worlds, db.works, async () => {
    const [project, work] = await Promise.all([db.projects.get(projectId), db.works.get(workId)])
    if (!project || !work || work.projectId !== projectId) throw new Error('[works] Work 不属于当前工作区')
    const world = await db.worlds.get(work.worldId)
    if (!world || world.projectId !== projectId) throw new Error('[works] Work 的 World 根无效')
    await db.projects.update(projectId, { activeWorldId: world.id!, activeWorkId: work.id!, updatedAt: Date.now() })
    return { projectId, worldId: world.id!, workId: work.id! }
  })
}

export async function readCanonicalWorkManuscriptWordCount(scope: WorkspaceScope): Promise<number> {
  const chapters = await readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' })
  return canonicalManuscriptWordCount(chapters)
}

/** Library projection only: longform prose has multiple governed editing paths,
 * so a cached Work count must not hide saved text. No read-side database writes. */
export async function readWorkLibraryProjectionV1(work: Work): Promise<Work> {
  if (effectiveWorkKind(work) !== 'novel' || effectiveNovelProfile(work) !== 'long') return work
  return {
    ...work,
    currentWordCount: await readCanonicalWorkManuscriptWordCount({
      projectId: work.projectId, worldId: work.worldId, workId: work.id!,
    }),
  }
}

export async function switchNovelProfile(input: {
  projectId: number
  workId: number
  profile: NovelWorkflowProfile
  targetWordCount?: number
}): Promise<Work> {
  return db.transaction('rw', scopeTransactionTables(db.chapters, db.shortNovelProductions, db.agentRuns), async () => {
    const work = await db.works.get(input.workId)
    if (!work || work.projectId !== input.projectId) {
      throw new Error('[works] Work 不属于当前工作区')
    }
    if (effectiveWorkKind(work) !== 'novel') throw new Error('[works] 只有小说 Work 可以切换短篇/长篇 Profile')
    const world = await db.worlds.get(work.worldId)
    if (!world || world.projectId !== input.projectId) throw new Error('[works] Work 的 World 根无效')

    const targetWordCount = input.targetWordCount ?? work.targetWordCount
    let currentWordCount = work.currentWordCount ?? 0
    if (input.profile === 'short') {
      assertShortNovelTargetWords(targetWordCount)
      currentWordCount = await readCanonicalWorkManuscriptWordCount({
        projectId: input.projectId,
        worldId: work.worldId,
        workId: work.id!,
      })
      if (currentWordCount > SHORT_NOVEL_MAX_WORDS) {
        throw new Error(`[works] 正文已有 ${currentWordCount} 字，超过短篇上限 ${SHORT_NOVEL_MAX_WORDS} 字`)
      }
    }

    const updatedAt = Date.now()
    if (effectiveNovelProfile(work) === 'short' && input.profile === 'long') {
      const tasks = await readOwnedRows<any>({projectId: work.projectId, worldId: work.worldId, workId: work.id!}, 'agentRuns', {owner: 'work'})
      if (tasks.some(task => ['running', 'paused', 'awaiting_confirmation'].includes(task.status) && task.contractJson?.includes('short:'))) throw new Error('[works] 请先采纳或结束待处理短篇任务，再扩写为长篇')
      const production = await db.shortNovelProductions.where('workId').equals(work.id!).first()
      if (production) await db.shortNovelProductions.update(production.id!, {expandedFromShort: {convertedAt: updatedAt, targetWordCount: work.targetWordCount, productionRevision: production.revision}, updatedAt})
    }
    const nextWork: Work = {
      ...work,
      kind: 'novel',
      novelProfile: input.profile,
      targetWordCount,
      currentWordCount,
      updatedAt,
    }
    await db.works.update(work.id!, {
      kind: nextWork.kind,
      novelProfile: nextWork.novelProfile,
      targetWordCount,
      currentWordCount,
      updatedAt,
    })
    return nextWork
  })
}

export type WorkspacePatch = Partial<Pick<
  Project,
  'name' | 'enableMultiWorld' | 'productPlatformOptIns'
>>

export type ActiveWorkPatch = Partial<Pick<
  Work,
  | 'title'
  | 'description'
  | 'genres'
  | 'customGenre'
  | 'status'
  | 'targetWordCount'
  | 'coverImage'
  | 'writingStyleId'
  | 'methodologyId'
  | 'includeCultivationProgressInAI'
>>

/** Update workspace-owned settings only. Work metadata is rejected by the type and runtime boundary. */
export async function updateWorkspace(projectId: number, data: WorkspacePatch): Promise<void> {
  const allowed = new Set(['name', 'enableMultiWorld', 'productPlatformOptIns'])
  const unknown = Object.keys(data).filter(field => !allowed.has(field))
  if (unknown.length) throw new Error(`[works] 工作区更新包含非工作区字段：${unknown.join('、')}`)
  await db.projects.update(projectId, { ...data, updatedAt: Date.now() })
}

/** Update author-selected Work metadata; queued callers freeze scope before admission. */
export async function updateActiveWork(projectId: number, data: ActiveWorkPatch, frozenScope?: WorkspaceScope): Promise<Work> {
  const scope = await resolveScope({ projectId, scope: frozenScope })
  return db.transaction('rw', scopeTransactionTables(db.chapters), async () => {
    const work = await db.works.get(scope.workId)
    if (!work || work.projectId !== projectId || work.worldId !== scope.worldId) {
      throw new Error('[works] 当前 World/Work 根无效')
    }
    const allowed = new Set([
      'title', 'description', 'genres', 'customGenre', 'status', 'targetWordCount',
      'coverImage', 'writingStyleId', 'methodologyId', 'includeCultivationProgressInAI',
    ])
    const unknown = Object.keys(data).filter(field => !allowed.has(field))
    if (unknown.length) throw new Error(`[works] 作品更新包含非作品字段：${unknown.join('、')}`)
    const workPatch: Partial<Work> = {
      ...data,
      ...(data.genres ? { genres: [...data.genres] } : {}),
    }

    const kind = effectiveWorkKind(work)
    const profile = effectiveNovelProfile(work)
    const requestedTarget = workPatch.targetWordCount ?? work.targetWordCount
    if (kind === 'novel' && profile === 'short' && 'targetWordCount' in workPatch) {
      assertShortNovelTargetWords(requestedTarget)
    }
    if (workPatch.status === 'completed' && kind === 'novel' && profile === 'short') {
      const actualWordCount = await readCanonicalWorkManuscriptWordCount(scope)
      if (actualWordCount < SHORT_NOVEL_MIN_WORDS || actualWordCount > SHORT_NOVEL_MAX_WORDS) {
        throw new Error(
          `[works] 短篇实际正文须为 ${SHORT_NOVEL_MIN_WORDS}～${SHORT_NOVEL_MAX_WORDS} 字；当前 ${actualWordCount} 字`,
        )
      }
      workPatch.currentWordCount = actualWordCount
    }
    const updatedAt = Date.now()
    if (!Object.keys(workPatch).length) return work
    await db.works.update(work.id!, { ...workPatch, updatedAt })
    return { ...work, ...workPatch, updatedAt }
  })
}

export async function selectWorkNarrativeModule(
  scope: WorkspaceScope,
  moduleId: number | null,
): Promise<void> {
  await db.transaction('rw', db.projects, db.worlds, db.works, db.narrativeModules, async () => {
    scope = await resolveScope({ scope })
    if (moduleId != null) {
      const module = await db.narrativeModules.get(moduleId)
      if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) {
        throw new Error('[works] 叙事模块不属于当前 scope')
      }
    }
    await db.works.update(scope.workId, { activeNarrativeModuleId: moduleId, updatedAt: Date.now() })
  })
}

/** PROGRESS-1 governed Work-root configuration write; never contains AI output. */
export async function updateWorkPostAdoptionPolicyV1(input: {
  scope: WorkspaceScope
  policy: PostAdoptionPolicyV1
  taskTypes: PostAdoptionTaskTypeV1[]
  budget: PostAdoptionBudgetV1
}): Promise<void> {
  const work = await db.works.get(input.scope.workId)
  if (
    !work
    || work.projectId !== input.scope.projectId
    || work.worldId !== input.scope.worldId
  ) throw new Error('[works] 章后策略不能写入其他 Work')
  await db.works.update(input.scope.workId, {
    postAdoptionPolicy: input.policy,
    postAdoptionTaskTypes: [...input.taskTypes],
    postAdoptionBudget: { ...input.budget },
    updatedAt: Date.now(),
  })
}

/** Manual longform acceptance uses a caller-held transaction and a freshly verified coverage report. */
export async function recordLongformWorkCompletionV1(scope: WorkspaceScope): Promise<void> {
  const project = await db.projects.get(scope.projectId)
  const work = await db.works.get(scope.workId)
  if (!project || project.activeWorkId !== scope.workId || !work || work.projectId !== scope.projectId || work.worldId !== scope.worldId
    || effectiveWorkKind(work) !== 'novel' || effectiveNovelProfile(work) !== 'long') throw new Error('长篇完稿记录与当前作品不匹配。')
  await db.works.update(scope.workId, { status: 'completed', updatedAt: Date.now() })
}

/** Manual cover adoption targets an explicit Work, even if another tab changes the active pointer. */
export async function updateWorkCover(scope: WorkspaceScope, coverImage: string, expectedUpdatedAt: number): Promise<number> {
  if (coverImage && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(coverImage) || coverImage.length > 7_000_000)) {
    throw new Error('封面必须是 5 MB 以内的 PNG、JPEG 或 WebP 图片。')
  }
  return db.transaction('rw', db.projects, db.worlds, db.works, async () => {
    const current = await resolveScope({ scope })
    const work = await db.works.get(current.workId)
    if (!work || work.updatedAt !== expectedUpdatedAt) throw new Error('作品已被修改，请重新打开封面后再保存。')
    const updatedAt = Math.max(Date.now(), work.updatedAt + 1)
    await db.works.update(current.workId, { coverImage, updatedAt })
    return updatedAt
  })
}

/** Explicit author rename of a particular Work; never follows another tab's active pointer. */
export async function updateWorkTitle(scope: WorkspaceScope, title: string): Promise<void> {
  if (!title.trim() || title.length > 200) throw new Error('请填写 1～200 字的作品名称')
  await db.transaction('rw', db.projects, db.worlds, db.works, async () => {
    const current = await resolveScope({ scope })
    await db.works.update(current.workId, { title: title.trim(), updatedAt: Date.now() })
  })
}
