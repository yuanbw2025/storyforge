import type { CreateWorkspaceInput, NovelWorkflowProfile, Project, Work, WorkKind, WorkspacePurpose, WorkspaceScope, World, CommunityWorldOrigin } from '../types'
import { assertCurrentProductEntryV1, productCatalogIdForWorkV1 } from '../product/product-catalog'
import { normalizeNewWorkClassification } from './work-kind'
import { allocateWorkspace, workspaceCreationTransactionTablesV1 as allocationTables } from './workspace-allocation'


export interface CreateWorkspaceOptions {
  /** ARCH-01: defaults to an independent authored work. */
  purpose?: WorkspacePurpose
  kind?: WorkKind
  novelProfile?: NovelWorkflowProfile | null
  preferredChapterCount?: number
  /** Optional author-written seed for the first short-novel chapter card. */
  initialChapterSummary?: string
  /** Optional author-provided prose imported into the first short-novel chapter. */
  initialChapterContent?: string
  /** Author import into an independent long novel; preserved as ordered source chapters. */
  importedNovelText?: string
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

/** The public lifecycle list delegates to the single internal allocator. */
export function workspaceCreationTransactionTablesV1() {
  return allocationTables()
}


/**
 * Creates a new LocalWorkspace and its initial World/Work roots atomically.
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
  options: CreateWorkspaceOptions = {},
): Promise<CreatedWorkspace> {
  input = structuredClone(input)
  options = structuredClone(options)
  assertCurrentProductEntryV1(productCatalogIdForWorkV1(normalizeNewWorkClassification({
    kind: options.kind, novelProfile: options.novelProfile, targetWordCount: input.targetWordCount,
  })))
  if ((options.purpose ?? input.workspacePurpose) === 'world-engine') assertCurrentProductEntryV1('world-engine')
  return allocateWorkspace(input, options)
}
