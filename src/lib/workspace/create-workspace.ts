import { db } from '../db/schema'
import { generateWorkspaceUid } from '../memory/identity'
import { generateWorkspaceScopeCode, generateWorldCode } from './identity'
import type {
  Chapter,
  CreateWorkspaceInput,
  NovelWorkflowProfile,
  OutlineNode,
  Project,
  Work,
  WorkKind,
  WorkspacePurpose,
  WorkspaceScope,
  World,
  CommunityWorldOrigin,
} from '../types'
import { scopeTransactionTables, stampNewRecord } from './scope'
import { buildWorkRecord } from './works'
import { deriveShortNovelStructure } from './work-kind'

export interface CreateWorkspaceOptions {
  /** ARCH-01: defaults to an independent authored work. */
  purpose?: WorkspacePurpose
  kind?: WorkKind
  novelProfile?: NovelWorkflowProfile | null
  preferredChapterCount?: number
  /** World identity options belong to the World root, never the Project shell root. */
  world?: {
    code?: string
    currentVersion?: number
    communityOrigin?: CommunityWorldOrigin
  }
}

export interface CreatedWorkspace {
  project: Project
  world: World
  work: Work
  scope: WorkspaceScope
}

function projectRoot(input: CreateWorkspaceInput, options: CreateWorkspaceOptions, now: number): Project {
  const allowedInputKeys = new Set([
    'workspaceUid', 'workspacePurpose', 'name', 'genres', 'customGenre', 'status',
    'description', 'targetWordCount', 'coverImage', 'writingStyleId', 'methodologyId',
    'enableMultiWorld', 'includeCultivationProgressInAI', 'activeCharacterDrivenPlanId',
    'productPlatformOptIns',
  ])
  const unknownKeys = Object.keys(input).filter(key => !allowedInputKeys.has(key))
  if (unknownKeys.length) {
    throw new Error(`创建工作区包含非当前字段：${unknownKeys.join('、')}`)
  }
  if (!Array.isArray(input.genres) || input.genres.some(genre => typeof genre !== 'string')) {
    throw new Error('创建工作区 genres 必须是字符串数组')
  }
  const purpose = options.purpose ?? input.workspacePurpose ?? 'independent-work'
  return {
    workspaceUid: input.workspaceUid ?? generateWorkspaceUid(),
    workspacePurpose: purpose,
    name: input.name,
    enableMultiWorld: input.enableMultiWorld,
    activeWorldId: null,
    activeWorkId: null,
    productPlatformOptIns: input.productPlatformOptIns,
    createdAt: now,
    updatedAt: now,
  }
}

async function createShortNovelSkeleton(
  scope: WorkspaceScope,
  targetWordCount: number,
  preferredChapterCount: number | undefined,
  now: number,
): Promise<void> {
  const structure = deriveShortNovelStructure(targetWordCount, preferredChapterCount)
  const volume: OutlineNode = stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId,
    parentId: null,
    type: 'volume',
    title: '短篇正文',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' })
  const volumeId = await db.outlineNodes.add(volume) as number

  for (let index = 0; index < structure.chapterCount; index += 1) {
    const title = `第${index + 1}章`
    const outline: OutlineNode = stampNewRecord(scope, 'outlineNodes', {
      projectId: scope.projectId,
      parentId: volumeId,
      type: 'chapter',
      title,
      summary: '',
      order: index,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' })
    const outlineNodeId = await db.outlineNodes.add(outline) as number
    const chapter: Chapter = stampNewRecord(scope, 'chapters', {
      projectId: scope.projectId,
      outlineNodeId,
      title,
      content: '',
      wordCount: 0,
      status: 'outline',
      order: index,
      notes: '',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' })
    await db.chapters.add(chapter)
  }
}

/**
 * Creates a new LocalWorkspace and its initial World/Work roots atomically.
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
  options: CreateWorkspaceOptions = {},
): Promise<CreatedWorkspace> {
  const now = Date.now()
  const preparedProject = projectRoot(input, options, now)
  const genres = input.genres.length ? [...input.genres] : ['other']
  return db.transaction('rw', scopeTransactionTables(db.outlineNodes, db.chapters), async () => {
    const projectId = await db.projects.add(preparedProject) as number
    const world: World = {
      projectId,
      identityKind: preparedProject.workspacePurpose === 'world-engine' ? 'world-draft' : 'workspace-scope',
      code: preparedProject.workspacePurpose === 'world-engine'
        ? options.world?.code ?? generateWorldCode()
        : generateWorkspaceScopeCode(now),
      name: preparedProject.name,
      description: input.description,
      currentVersion: preparedProject.workspacePurpose === 'world-engine'
        ? options.world?.currentVersion ?? 0
        : 0,
      communityOrigin: preparedProject.workspacePurpose === 'world-engine'
        ? options.world?.communityOrigin
        : undefined,
      createdAt: now,
      updatedAt: now,
    }
    const worldId = await db.worlds.add(world) as number
    const work = buildWorkRecord({
      projectId,
      worldId,
      fallback: {
        genres,
        targetWordCount: input.targetWordCount,
        writingStyleId: input.writingStyleId,
        methodologyId: input.methodologyId,
        includeCultivationProgressInAI: input.includeCultivationProgressInAI ?? false,
      },
      create: {
        title: preparedProject.name,
        description: input.description,
        genres,
        customGenre: input.customGenre,
        status: input.status,
        targetWordCount: input.targetWordCount,
        coverImage: input.coverImage,
        activeCharacterDrivenPlanId: input.activeCharacterDrivenPlanId,
        kind: options.kind,
        novelProfile: options.novelProfile,
      },
      now,
    })
    const workId = await db.works.add(work) as number
    const scope = { projectId, worldId, workId }
    if (work.kind === 'novel' && work.novelProfile === 'short') {
      await createShortNovelSkeleton(scope, work.targetWordCount, options.preferredChapterCount, now)
    }
    const createdWorld = { ...world, id: worldId }
    const createdWork = { ...work, id: workId }
    const projectPatch = { activeWorldId: worldId, activeWorkId: workId }
    await db.projects.update(projectId, { ...projectPatch, updatedAt: now })
    return {
      project: { ...preparedProject, ...projectPatch, id: projectId, updatedAt: now },
      world: createdWorld,
      work: createdWork,
      scope,
    }
  })
}
