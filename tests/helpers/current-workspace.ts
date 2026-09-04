import { createWorkspace, type CreateWorkspaceOptions } from '../../src/lib/workspace/create-workspace'
import { db } from '../../src/lib/db/schema'
import { generateWorkCode } from '../../src/lib/memory/identity'
import { generateWorkspaceScopeCode } from '../../src/lib/workspace/identity'
import { buildWorkRecord, type CreateWorkInput } from '../../src/lib/workspace/works'
import type {
  CreateWorkspaceInput,
  Project,
  Work,
  WorkspacePurpose,
  WorkspaceScope,
  World,
} from '../../src/lib/types'

/** Minimal current-schema workspace for tests that exercise current contracts. */
export async function seedCurrentWorkspace(
  name = 'Current test workspace',
  options: {
    enableMultiWorld?: boolean
    genres?: string[]
    targetWordCount?: number
    purpose?: WorkspacePurpose
    kind?: CreateWorkspaceOptions['kind']
    novelProfile?: CreateWorkspaceOptions['novelProfile']
  } = {},
) {
  return createWorkspace({
    name,
    genres: options.genres ?? ['fantasy'],
    description: '',
    targetWordCount: options.targetWordCount ?? 100_000,
    status: 'drafting',
    enableMultiWorld: options.enableMultiWorld ?? false,
  }, {
    purpose: options.purpose ?? 'independent-work',
    kind: options.kind ?? 'novel',
    novelProfile: options.novelProfile ?? 'long',
  })
}

/**
 * Current-schema project fixture for focused tests that only need the numeric
 * project id. Unlike a raw projects.add(), this always creates the required
 * stable workspace identity and the matching World/Work roots through the
 * production creation boundary.
 */
export async function seedCurrentProject(
  input: Partial<CreateWorkspaceInput> & { name: string },
  options: { purpose?: WorkspacePurpose } = {},
): Promise<number> {
  const genres = input.genres?.length
    ? [...input.genres]
    : ['other']
  const created = await createWorkspace({
    workspaceUid: input.workspaceUid,
    workspacePurpose: input.workspacePurpose,
    name: input.name,
    genres,
    customGenre: input.customGenre,
    description: input.description ?? '',
    targetWordCount: input.targetWordCount ?? 100_000,
    status: input.status ?? 'drafting',
    coverImage: input.coverImage,
    writingStyleId: input.writingStyleId,
    methodologyId: input.methodologyId,
    enableMultiWorld: input.enableMultiWorld ?? false,
    includeCultivationProgressInAI: input.includeCultivationProgressInAI,
    activeCharacterDrivenPlanId: input.activeCharacterDrivenPlanId,
    productPlatformOptIns: input.productPlatformOptIns,
  }, {
    purpose: options.purpose ?? input.workspacePurpose ?? 'independent-work',
    kind: 'novel',
    novelProfile: 'long',
  })
  return created.scope.projectId
}

/** Build a complete current-schema Work row for tests that need a non-active scope. */
export function currentWorkFixtureRecordV1(input: {
  projectId: number
  worldId: number
  title: string
} & Partial<Omit<Work, 'projectId' | 'worldId' | 'title'>>): Work {
  const kind = input.kind ?? 'novel'
  const createdAt = input.createdAt ?? Date.now()
  return {
    id: input.id,
    projectId: input.projectId,
    worldId: input.worldId,
    code: input.code ?? generateWorkCode(),
    kind,
    novelProfile: kind === 'novel' ? (input.novelProfile ?? 'long') : null,
    title: input.title,
    description: input.description ?? '',
    genres: input.genres ? [...input.genres] : ['other'],
    customGenre: input.customGenre,
    status: input.status ?? 'drafting',
    targetWordCount: input.targetWordCount ?? 100_000,
    currentWordCount: input.currentWordCount ?? 0,
    coverImage: input.coverImage,
    writingStyleId: input.writingStyleId,
    methodologyId: input.methodologyId,
    includeCultivationProgressInAI: input.includeCultivationProgressInAI ?? false,
    activeCharacterDrivenPlanId: input.activeCharacterDrivenPlanId ?? null,
    activeNarrativeModuleId: input.activeNarrativeModuleId ?? null,
    postAdoptionPolicy: input.postAdoptionPolicy ?? 'suggest',
    postAdoptionTaskTypes: input.postAdoptionTaskTypes
      ? [...input.postAdoptionTaskTypes]
      : ['organization', 'memory', 'retrieval', 'consistency'],
    postAdoptionBudget: input.postAdoptionBudget ?? {
      maxModelCalls: 2,
      maxInputTokens: 48_000,
      maxOutputTokens: 16_000,
      maxCostUsd: 0.25,
      allowUnknownCost: false,
    },
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  }
}

/** Adds another explicit current-schema World root to a test workspace. */
export async function addCurrentWorldFixtureV1(input: {
  projectId: number
  name: string
  description?: string
  now?: number
}): Promise<World> {
  const now = input.now ?? Date.now()
  const world: World = {
    projectId: input.projectId,
    identityKind: 'workspace-scope',
    code: generateWorkspaceScopeCode(now),
    name: input.name,
    description: input.description ?? '',
    currentVersion: 0,
    createdAt: now,
    updatedAt: now,
  }
  const id = await db.worlds.add(world) as number
  return { ...world, id }
}

/** Adds another explicit current-schema Work root without changing the active Work. */
export async function addCurrentWorkFixtureV1(input: {
  projectId: number
  worldId: number
  create: CreateWorkInput
  now?: number
}): Promise<Work> {
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('当前测试工作区不存在')
  const fallbackWork = project.activeWorkId == null ? undefined : await db.works.get(project.activeWorkId)
  if (!fallbackWork) throw new Error('当前测试工作区缺少活动作品')
  const now = input.now ?? Date.now()
  const work = buildWorkRecord({
    projectId: input.projectId,
    worldId: input.worldId,
    fallback: {
      genres: fallbackWork.genres,
      targetWordCount: fallbackWork.targetWordCount,
      writingStyleId: fallbackWork.writingStyleId,
      methodologyId: fallbackWork.methodologyId,
      includeCultivationProgressInAI: fallbackWork.includeCultivationProgressInAI,
    },
    create: input.create,
    now,
  })
  const id = await db.works.add(work) as number
  return { ...work, id }
}

/** Current fixed-id workspace fixture for tests whose recorded ids are part of the assertion. */
export async function putCurrentWorkspaceFixtureV1(
  input: Project,
  workInput: Partial<Pick<
    Work,
    | 'title'
    | 'description'
    | 'genres'
    | 'customGenre'
    | 'status'
    | 'targetWordCount'
    | 'currentWordCount'
    | 'coverImage'
    | 'writingStyleId'
    | 'methodologyId'
    | 'includeCultivationProgressInAI'
    | 'activeCharacterDrivenPlanId'
  >> = {},
): Promise<WorkspaceScope> {
  if (!Number.isSafeInteger(input.id) || input.id! < 1) throw new Error('固定测试工作区必须声明正整数 id')
  const projectId = input.id!
  const now = input.updatedAt || input.createdAt || Date.now()
  const worldId = projectId
  const workId = projectId
  await db.projects.put({
    ...input,
    id: projectId,
    workspaceUid: input.workspaceUid,
    workspacePurpose: input.workspacePurpose,
    activeWorldId: worldId,
    activeWorkId: workId,
  })
  await db.worlds.put({
    id: worldId,
    projectId,
    identityKind: 'workspace-scope',
    code: generateWorkspaceScopeCode(now, projectId / 1_000_000),
    name: input.name,
    description: workInput.description ?? '',
    currentVersion: 0,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  })
  await db.works.put({
    id: workId,
    projectId,
    worldId,
    code: generateWorkCode(),
    kind: 'novel',
    novelProfile: 'long',
    title: workInput.title ?? input.name,
    description: workInput.description ?? '',
    genres: workInput.genres ?? ['other'],
    customGenre: workInput.customGenre,
    status: workInput.status ?? 'drafting',
    targetWordCount: workInput.targetWordCount ?? 100_000,
    currentWordCount: workInput.currentWordCount ?? 0,
    coverImage: workInput.coverImage,
    writingStyleId: workInput.writingStyleId,
    methodologyId: workInput.methodologyId,
    includeCultivationProgressInAI: workInput.includeCultivationProgressInAI ?? false,
    activeCharacterDrivenPlanId: workInput.activeCharacterDrivenPlanId ?? null,
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
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  })
  return { projectId, worldId, workId }
}
