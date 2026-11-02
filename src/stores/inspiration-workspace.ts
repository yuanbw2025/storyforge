import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { adopt, adoptionTransactionTablesV1 } from '../lib/registry/adopt'
import {
  createInspirationFragment, createInspirationVersion, MAX_INSPIRATION_VERSIONS,
  parseInspirationFragments, parseInspirationVersions, repairInspirationVersionParents,
  upsertInspirationFragment,
} from '../lib/inspiration/workspace'
import type {
  InspirationFragment, InspirationResultMode, InspirationSourceKind, InspirationVersion,
  InspirationWorkspace,
} from '../lib/types/inspiration-workspace'
import type { WorkspaceScope } from '../lib/types/world-ownership'
import { readOwnedRows, resolveReadScopeLike, resolveScopeLike, type WorkspaceScopeLike } from '../lib/workspace/scope'

interface InspirationWorkspaceState {
  scope: WorkspaceScope | null
  workspace: InspirationWorkspace | null
  fragments: InspirationFragment[]
  versions: InspirationVersion[]
  loading: boolean
  load: (scope: WorkspaceScopeLike) => Promise<void>
  addFragment: (scope: WorkspaceScopeLike, input: {
    text: string; label?: string; sourceKind?: InspirationSourceKind
  }) => Promise<InspirationFragment | null>
  removeFragment: (scope: WorkspaceScopeLike, fragmentId: string) => Promise<void>
  saveVersion: (scope: WorkspaceScopeLike, input: {
    mode: InspirationResultMode; parentVersionId?: string | null; fragmentIds: string[]; result: unknown
  }) => Promise<InspirationVersion>
}

const sameScope = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId
  && a.worldId === b.worldId && a.workId === b.workId
const snapshotScope = (scope: WorkspaceScopeLike): WorkspaceScopeLike => typeof scope === 'number' ? scope : { ...scope }
let observationSequence = 0

async function readWorkspace(scope: WorkspaceScope): Promise<InspirationWorkspace | null> {
  const rows = await readOwnedRows<InspirationWorkspace>(scope, 'inspirationWorkspaces', { owner: 'work' })
  if (rows.length > 1) throw new Error('当前作品存在多份灵感工作区，请先核验；原数据未修改')
  return rows[0] ?? null
}

/** Readers may show legacy data defensively. A writer must not discard data it
 * could not read completely, including unknown properties on otherwise valid rows. */
function writableArray<T extends object>(raw: string | undefined, parsed: T[], field: string): T[] {
  let values: unknown
  try { values = JSON.parse(raw ?? '[]') } catch { throw new Error(`灵感${field}数据无法完整读取，原数据未修改`) }
  if (!Array.isArray(values) || values.length !== parsed.length || values.some((value, index) =>
    !value || typeof value !== 'object' || Array.isArray(value) || Object.entries(parsed[index]).some(([key, expected]) =>
      JSON.stringify((value as Record<string, unknown>)[key]) !== JSON.stringify(expected)))) {
    throw new Error(`灵感${field}数据无法完整读取，原数据未修改`)
  }
  return values as T[]
}

type Content = { fragments: InspirationFragment[]; versions: InspirationVersion[] }
type Patch = Partial<Pick<InspirationWorkspace, 'fragments' | 'versions'>>
async function mutateWorkspace<T>(scope: WorkspaceScope, mutate: (content: Content) => { data?: Patch; value: T }) {
  return db.transaction('rw', adoptionTransactionTablesV1('inspirationWorkspaces'), async () => {
    await resolveScopeLike(scope)
    const current = await readWorkspace(scope)
    const outcome = mutate({
      fragments: writableArray(current?.fragments, parseInspirationFragments(current?.fragments), '素材'),
      versions: writableArray(current?.versions, parseInspirationVersions(current?.versions), '版本'),
    })
    if (outcome.data) {
      const result = await adopt({ projectId: scope.projectId, scope, target: 'inspirationWorkspaces', mode: 'replace', data: outcome.data })
      if (!result.written.length) throw new Error(`灵感工作区写回被拒绝：${result.skipped[0]?.reason ?? result.typeErrors[0]?.field ?? 'unknown'}`)
    }
    // Capture the observation inside the native transaction. Only publish after
    // commit; a later-observed row cannot be replaced by a late Promise result.
    return { value: outcome.value, workspace: await readWorkspace(scope), sequence: ++observationSequence }
  })
}

export const useInspirationWorkspaceStore = create<InspirationWorkspaceState>((set, get) => {
  let loadGeneration = 0, publishedSequence = 0
  const publish = (scope: WorkspaceScope, workspace: InspirationWorkspace | null, sequence: number) => {
    if (!sameScope(get().scope, scope) || sequence < publishedSequence) return
    publishedSequence = sequence
    set({ workspace, fragments: parseInspirationFragments(workspace?.fragments), versions: parseInspirationVersions(workspace?.versions) })
  }
  const prepare = async (input: WorkspaceScopeLike) => {
    const generation = loadGeneration, scope = await resolveScopeLike(snapshotScope(input))
    if (generation === loadGeneration && !get().scope && !get().loading) set({ scope })
    return scope
  }
  return {
    scope: null, workspace: null, fragments: [], versions: [], loading: false,
    load: async input => {
      const generation = ++loadGeneration, captured = snapshotScope(input)
      set({ scope: null, workspace: null, fragments: [], versions: [], loading: true })
      try {
        const scope = await resolveReadScopeLike(captured)
        if (generation !== loadGeneration) return
        set({ scope })
        const observation = await db.transaction('r', adoptionTransactionTablesV1('inspirationWorkspaces'), async () => {
          await resolveReadScopeLike(scope)
          return { workspace: await readWorkspace(scope), sequence: ++observationSequence }
        })
        if (generation === loadGeneration) publish(scope, observation.workspace, observation.sequence)
      } finally { if (generation === loadGeneration) set({ loading: false }) }
    },
    addFragment: async (inputScope, input) => {
      const fragment = createInspirationFragment(input)
      if (!fragment) return null
      const scope = await prepare(inputScope)
      const result = await mutateWorkspace(scope, ({ fragments }) => {
        const next = upsertInspirationFragment(fragments, fragment)
        if (next === fragments) {
          const normalized = fragment.text.replace(/\s+/g, '').toLocaleLowerCase()
          return { value: fragments.find(item => item.text.replace(/\s+/g, '').toLocaleLowerCase() === normalized)! }
        }
        return { value: fragment, data: { fragments: JSON.stringify(next) } }
      })
      publish(scope, result.workspace, result.sequence)
      return result.value
    },
    removeFragment: async (inputScope, fragmentId) => {
      const scope = await prepare(inputScope)
      const result = await mutateWorkspace(scope, ({ fragments, versions }) => {
        if (versions.some(version => version.fragmentIds.includes(fragmentId))) {
          throw new Error('该碎片已被确认版本引用，只能取消勾选，不能删除来源证据')
        }
        const next = fragments.filter(fragment => fragment.id !== fragmentId)
        return { value: undefined, ...(next.length === fragments.length ? {} : { data: { fragments: JSON.stringify(next) } }) }
      })
      publish(scope, result.workspace, result.sequence)
    },
    saveVersion: async (inputScope, input) => {
      const version = createInspirationVersion(input), scope = await prepare(inputScope)
      const result = await mutateWorkspace(scope, ({ fragments, versions }) => {
        const ids = new Set(fragments.map(fragment => fragment.id))
        if (version.fragmentIds.some(id => !ids.has(id))) throw new Error('确认版本的来源片段不在当前作品中；原数据未修改')
        if (version.parentVersionId && !versions.some(item => item.id === version.parentVersionId)) throw new Error('确认版本的父版本已不存在或不属于当前作品；原数据未修改')
        const next = repairInspirationVersionParents([...versions, version].slice(-MAX_INSPIRATION_VERSIONS))
        return { value: version, data: { versions: JSON.stringify(next) } }
      })
      publish(scope, result.workspace, result.sequence)
      return result.value
    },
  }
})
