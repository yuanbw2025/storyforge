/** WORLD-2C C5 · Work creation and switching inside one World. */
import { db } from '../db/schema'
import type {
  NovelWorkflowProfile,
  PostAdoptionBudgetV1,
  PostAdoptionPolicyV1,
  PostAdoptionTaskTypeV1,
  Work,
  WorkKind,
  WorkspaceScope,
  World,
} from '../types/world-ownership'
import type { Project, ProjectStatus } from '../types/project'
import { ensureWorkspaceOwnership } from './ownership'
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
import { isShareableWorld } from '../product/world-identity'

export interface CreateWorkInput {
  title: string
  description?: string
  genres?: string[]
  status?: ProjectStatus
  targetWordCount?: number
  kind?: WorkKind
  novelProfile?: NovelWorkflowProfile | null
}

export function buildWorkRecord(input: {
  projectId: number
  worldId: number
  fallback: Pick<Work, 'genres' | 'targetWordCount' | 'writingStyleId' | 'methodologyId'>
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
    status,
    targetWordCount,
    writingStyleId: input.fallback.writingStyleId,
    methodologyId: input.fallback.methodologyId,
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

const WORK_MIRROR_FIELDS = [
  'name',
  'description',
  'genres',
  'genre',
  'status',
  'targetWordCount',
  'currentWordCount',
  'coverImage',
  'writingStyleId',
  'methodologyId',
  'activeCharacterDrivenPlanId',
] as const satisfies readonly (keyof Project)[]

export function projectCompatibilityMirror(world: World, work: Work): Partial<Project> {
  const shareable = isShareableWorld(world)
  return {
    activeWorldId: world.id!,
    activeWorkId: work.id!,
    worldCode: shareable ? world.code : undefined,
    worldVersion: shareable ? world.currentVersion : undefined,
    communityOrigin: shareable ? world.communityOrigin : undefined,
    name: work.title,
    description: work.description,
    genres: [...work.genres],
    genre: work.genres[0] ?? 'other',
    status: work.status,
    targetWordCount: work.targetWordCount,
    currentWordCount: work.currentWordCount,
    coverImage: work.coverImage,
    writingStyleId: work.writingStyleId,
    methodologyId: work.methodologyId,
    activeCharacterDrivenPlanId: work.activeCharacterDrivenPlanId ?? null,
  }
}

export function projectCompatibilityWithoutWork(world: World): Partial<Project> {
  const shareable = isShareableWorld(world)
  return {
    activeWorldId: world.id!,
    activeWorkId: null,
    worldCode: shareable ? world.code : undefined,
    worldVersion: shareable ? world.currentVersion : undefined,
    communityOrigin: shareable ? world.communityOrigin : undefined,
    name: world.name,
    description: world.description,
    genres: [],
    genre: 'other',
    status: 'drafting',
    targetWordCount: 0,
    currentWordCount: 0,
    coverImage: undefined,
    writingStyleId: undefined,
    methodologyId: undefined,
    activeCharacterDrivenPlanId: null,
  }
}

export function projectCompatibilityWithoutWorld(): Partial<Project> {
  return {
    activeWorldId: null,
    activeWorkId: null,
    worldCode: undefined,
    worldVersion: undefined,
    communityOrigin: undefined,
    genres: [],
    genre: 'other',
    status: 'drafting',
    targetWordCount: 0,
    currentWordCount: 0,
    coverImage: undefined,
    writingStyleId: undefined,
    methodologyId: undefined,
    activeCharacterDrivenPlanId: null,
  }
}

export async function listWorldWorks(projectId: number, worldId?: number): Promise<Work[]> {
  const ownership = await ensureWorkspaceOwnership(projectId)
  const targetWorldId = worldId ?? ownership.scope.worldId
  const world = await db.worlds.get(targetWorldId)
  if (!world || world.projectId !== projectId) throw new Error('[works] World 不属于当前工作区')
  return db.works.where('worldId').equals(targetWorldId).sortBy('createdAt')
}

export async function createWorldWork(projectId: number, input: CreateWorkInput): Promise<Work> {
  const ownership = await ensureWorkspaceOwnership(projectId)
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
    await db.projects.update(projectId, {
      ...projectCompatibilityMirror(world, work),
      updatedAt: Date.now(),
    })
    return { projectId, worldId: world.id!, workId: work.id! }
  })
}

export async function readCanonicalWorkManuscriptWordCount(scope: WorkspaceScope): Promise<number> {
  const chapters = await readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' })
  return canonicalManuscriptWordCount(chapters)
}

export async function switchNovelProfile(input: {
  projectId: number
  workId: number
  profile: NovelWorkflowProfile
  targetWordCount?: number
}): Promise<Work> {
  return db.transaction('rw', scopeTransactionTables(db.chapters), async () => {
    const [project, work] = await Promise.all([
      db.projects.get(input.projectId),
      db.works.get(input.workId),
    ])
    if (!project || !work || work.projectId !== input.projectId) {
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
    if (project.activeWorkId === work.id) {
      await db.projects.update(project.id!, {
        ...projectCompatibilityMirror(world, nextWork),
        updatedAt,
      })
    }
    return nextWork
  })
}

export async function updateProjectAndActiveWork(projectId: number, data: Partial<Project>): Promise<void> {
  const ownership = await ensureWorkspaceOwnership(projectId)
  await db.transaction('rw', scopeTransactionTables(db.chapters), async () => {
    const [project, world, work] = await Promise.all([
      db.projects.get(projectId),
      db.worlds.get(ownership.scope.worldId),
      db.works.get(ownership.scope.workId),
    ])
    if (!project || !world || !work || world.projectId !== projectId || work.projectId !== projectId || work.worldId !== world.id) {
      throw new Error('[works] 当前 World/Work 根无效')
    }
    const workPatch: Partial<Work> = {}
    if ('name' in data && data.name != null) workPatch.title = data.name
    if ('description' in data && data.description != null) workPatch.description = data.description
    if ('genres' in data && data.genres != null) workPatch.genres = [...data.genres]
    else if ('genre' in data && data.genre != null) {
      workPatch.genres = [data.genre, ...work.genres.filter(genre => genre !== data.genre)]
    }
    for (const field of WORK_MIRROR_FIELDS) {
      if (['name', 'description', 'genres', 'genre'].includes(field)) continue
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const workField = field as keyof Work
        ;(workPatch as Record<string, unknown>)[workField] = data[field]
      }
    }

    const kind = effectiveWorkKind(work)
    const profile = effectiveNovelProfile(work)
    const requestedTarget = workPatch.targetWordCount ?? work.targetWordCount
    if (kind === 'novel' && profile === 'short' && 'targetWordCount' in workPatch) {
      assertShortNovelTargetWords(requestedTarget)
    }
    if (data.status === 'completed' && kind === 'novel' && profile === 'short') {
      const actualWordCount = await readCanonicalWorkManuscriptWordCount(ownership.scope)
      if (actualWordCount < SHORT_NOVEL_MIN_WORDS || actualWordCount > SHORT_NOVEL_MAX_WORDS) {
        throw new Error(
          `[works] 短篇实际正文须为 ${SHORT_NOVEL_MIN_WORDS}～${SHORT_NOVEL_MAX_WORDS} 字；当前 ${actualWordCount} 字`,
        )
      }
      workPatch.currentWordCount = actualWordCount
    }
    const updatedAt = Date.now()
    const nextWork = { ...work, ...workPatch, updatedAt }
    if (Object.keys(workPatch).length > 0) await db.works.update(work.id!, { ...workPatch, updatedAt })
    await db.projects.update(projectId, {
      ...data,
      ...projectCompatibilityMirror(world, nextWork),
      updatedAt,
    })
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
