import { create } from 'zustand'
import { adopt } from '../lib/registry/adopt'
import {
  createInspirationFragment,
  createInspirationVersion,
  MAX_INSPIRATION_VERSIONS,
  parseInspirationFragments,
  parseInspirationVersions,
  repairInspirationVersionParents,
  upsertInspirationFragment,
} from '../lib/inspiration/workspace'
import type {
  InspirationFragment,
  InspirationResultMode,
  InspirationSourceKind,
  InspirationVersion,
  InspirationWorkspace,
} from '../lib/types/inspiration-workspace'
import {
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  type WorkspaceScopeLike,
} from '../lib/world-engine/scope'

interface InspirationWorkspaceState {
  workspace: InspirationWorkspace | null
  fragments: InspirationFragment[]
  versions: InspirationVersion[]
  loading: boolean
  load: (scope: WorkspaceScopeLike) => Promise<void>
  addFragment: (scope: WorkspaceScopeLike, input: {
    text: string
    label?: string
    sourceKind?: InspirationSourceKind
  }) => Promise<InspirationFragment | null>
  removeFragment: (scope: WorkspaceScopeLike, fragmentId: string) => Promise<void>
  saveVersion: (scope: WorkspaceScopeLike, input: {
    mode: InspirationResultMode
    parentVersionId?: string | null
    fragmentIds: string[]
    result: unknown
  }) => Promise<InspirationVersion>
}

async function persistWorkspace(
  scopeInput: WorkspaceScopeLike,
  fragments: InspirationFragment[],
  versions: InspirationVersion[],
): Promise<InspirationWorkspace> {
  const scope = await resolveScopeLike(scopeInput)
  const adopted = await adopt({
    projectId: scope.projectId,
    scope,
    target: 'inspirationWorkspaces',
    mode: 'replace',
    data: {
      fragments: JSON.stringify(fragments),
      versions: JSON.stringify(versions),
    },
  })
  if (adopted.written.length === 0) {
    throw new Error(`灵感工作区写回被拒绝：${adopted.skipped[0]?.reason ?? adopted.typeErrors[0]?.field ?? 'unknown'}`)
  }
  const row = (await readOwnedRows<InspirationWorkspace>(scope, 'inspirationWorkspaces', { owner: 'work' }))[0]
  if (!row) throw new Error('灵感工作区写回后无法回读')
  return row
}

export const useInspirationWorkspaceStore = create<InspirationWorkspaceState>((set, get) => ({
  workspace: null,
  fragments: [],
  versions: [],
  loading: false,

  load: async (scopeInput) => {
    set({ loading: true })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      const workspace = (await readOwnedRows<InspirationWorkspace>(
        scope,
        'inspirationWorkspaces',
        { owner: 'work' },
      ))[0] ?? null
      set({
        workspace,
        fragments: parseInspirationFragments(workspace?.fragments),
        versions: parseInspirationVersions(workspace?.versions),
      })
    } finally {
      set({ loading: false })
    }
  },

  addFragment: async (scopeInput, input) => {
    const scope = await resolveScopeLike(scopeInput)
    const fragment = createInspirationFragment(input)
    if (!fragment) return null
    const current = get().workspace?.projectId === scope.projectId
      && get().workspace?.workId === scope.workId ? get().fragments : []
    const fragments = upsertInspirationFragment(current, fragment)
    if (fragments === current) {
      return current.find(item =>
        item.text.replace(/\s+/g, '').toLocaleLowerCase()
        === fragment.text.replace(/\s+/g, '').toLocaleLowerCase()) ?? null
    }
    const versions = get().workspace?.projectId === scope.projectId
      && get().workspace?.workId === scope.workId ? get().versions : []
    const workspace = await persistWorkspace(scope, fragments, versions)
    set({ workspace, fragments, versions })
    return fragment
  },

  removeFragment: async (scopeInput, fragmentId) => {
    const scope = await resolveScopeLike(scopeInput)
    const matchesScope = get().workspace?.projectId === scope.projectId
      && get().workspace?.workId === scope.workId
    const current = matchesScope ? get().fragments : []
    const versions = matchesScope ? get().versions : []
    if (versions.some(version => version.fragmentIds.includes(fragmentId))) {
      throw new Error('该碎片已被确认版本引用，只能取消勾选，不能删除来源证据')
    }
    const fragments = current.filter(fragment => fragment.id !== fragmentId)
    const workspace = await persistWorkspace(scope, fragments, versions)
    set({ workspace, fragments, versions })
  },

  saveVersion: async (scopeInput, input) => {
    const scope = await resolveScopeLike(scopeInput)
    const version = createInspirationVersion(input)
    const matchesScope = get().workspace?.projectId === scope.projectId
      && get().workspace?.workId === scope.workId
    const fragments = matchesScope ? get().fragments : []
    const current = matchesScope ? get().versions : []
    const versions = repairInspirationVersionParents(
      [...current, version].slice(-MAX_INSPIRATION_VERSIONS),
    )
    const workspace = await persistWorkspace(scope, fragments, versions)
    set({ workspace, fragments, versions })
    return version
  },
}))
