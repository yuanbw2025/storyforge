/** WORLD-2C C5 · Work creation and switching inside one World. */
import { db } from '../db/schema'
import type { Work, WorkspaceScope, World } from '../types/world-ownership'
import type { Project, ProjectStatus } from '../types/project'
import { ensureWorkspaceOwnership } from './ownership'
import { assertRecordInScope, resolveScope } from './scope'
import { generateWorkCode } from '../memory/identity'

export interface CreateWorkInput {
  title: string
  description?: string
  genres?: string[]
  status?: ProjectStatus
  targetWordCount?: number
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
  return {
    activeWorldId: world.id!,
    activeWorkId: work.id!,
    worldCode: world.code,
    worldVersion: world.currentVersion,
    communityOrigin: world.communityOrigin,
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
  return {
    activeWorldId: world.id!,
    activeWorkId: null,
    worldCode: world.code,
    worldVersion: world.currentVersion,
    communityOrigin: world.communityOrigin,
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
  const title = input.title.trim()
  if (!title) throw new Error('[works] 作品名称不能为空')
  const ts = Date.now()
  const row: Work = {
    projectId,
    worldId: ownership.scope.worldId,
    code: generateWorkCode(),
    title,
    description: input.description?.trim() ?? '',
    genres: input.genres?.length ? [...input.genres] : [...ownership.work.genres],
    status: input.status ?? 'drafting',
    targetWordCount: input.targetWordCount ?? ownership.work.targetWordCount,
    writingStyleId: ownership.work.writingStyleId,
    methodologyId: ownership.work.methodologyId,
    createdAt: ts,
    updatedAt: ts,
  }
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

export async function updateProjectAndActiveWork(projectId: number, data: Partial<Project>): Promise<void> {
  const ownership = await ensureWorkspaceOwnership(projectId)
  await db.transaction('rw', db.projects, db.worlds, db.works, async () => {
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
