import { db } from '../db/schema'
import { generateWorkspaceUid } from '../memory/identity'
import { generateWorkspaceScopeCode, generateWorldCode } from './identity'
import type {
  Chapter,
  CreateProjectInput,
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
import { nativeOwnershipReceipt, WORKSPACE_OWNERSHIP_CONTRACT_VERSION } from './ownership'
import { scopeTransactionTables, stampNewRecord } from './scope'
import { buildWorkRecord, projectActiveWorkProjection } from './works'
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

function projectRoot(input: CreateProjectInput, options: CreateWorkspaceOptions, now: number): Project {
  const genres = input.genres?.length ? [...input.genres] : [input.genre || 'other']
  const purpose = options.purpose ?? input.workspacePurpose ?? 'independent-work'
  return {
    ...input,
    workspaceUid: input.workspaceUid ?? generateWorkspaceUid(),
    workspacePurpose: purpose,
    genres,
    genre: input.genre || genres[0] || 'other',
    status: input.status ?? 'drafting',
    activeWorldId: null,
    activeWorkId: null,
    ownershipSchemaVersion: WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
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
 * Legacy ownership migration remains separate and is never called here.
 */
export async function createWorkspace(
  input: CreateProjectInput,
  options: CreateWorkspaceOptions = {},
): Promise<CreatedWorkspace> {
  const now = Date.now()
  const preparedProject = projectRoot(input, options, now)
  return db.transaction('rw', scopeTransactionTables(db.outlineNodes, db.chapters, db.ownershipMigrations), async () => {
    const projectId = await db.projects.add(preparedProject) as number
    const world: World = {
      projectId,
      identityKind: preparedProject.workspacePurpose === 'world-engine' ? 'world-draft' : 'workspace-scope',
      code: preparedProject.workspacePurpose === 'world-engine'
        ? options.world?.code ?? generateWorldCode()
        : generateWorkspaceScopeCode(now),
      name: preparedProject.name,
      description: preparedProject.description,
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
        genres: preparedProject.genres,
        targetWordCount: preparedProject.targetWordCount,
        writingStyleId: preparedProject.writingStyleId,
        methodologyId: preparedProject.methodologyId,
      },
      create: {
        title: preparedProject.name,
        description: preparedProject.description,
        genres: preparedProject.genres,
        status: preparedProject.status,
        targetWordCount: preparedProject.targetWordCount,
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
    const projectPatch = projectActiveWorkProjection(createdWorld, createdWork)
    await db.projects.update(projectId, { ...projectPatch, updatedAt: now })
    await db.ownershipMigrations.add(nativeOwnershipReceipt({
      projectId,
      worldId,
      workId,
      workspaceUid: preparedProject.workspaceUid!,
      createdAt: now,
    }))
    return {
      project: { ...preparedProject, ...projectPatch, id: projectId, updatedAt: now },
      world: createdWorld,
      work: createdWork,
      scope,
    }
  })
}
