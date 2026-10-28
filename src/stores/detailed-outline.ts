import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { DetailedOutline, DetailedScene, WorkspaceScope } from '../lib/types'
import { DETAILED_SCENE_TASK_FIELDS, normalizeDetailedScenes } from '../lib/types/detailed-outline'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { FIELD_BY_TARGET } from '../lib/registry/field-registry'

export type DetailedSceneEditV1 =
  | { kind: 'add'; scene: DetailedScene }
  | { kind: 'patch'; sceneId: string; patch: Partial<Omit<DetailedScene, 'sceneId'>>; expected?: Partial<Omit<DetailedScene, 'sceneId'>> }
  | { kind: 'remove'; sceneId: string }

interface DetailedOutlineStore {
  detailedOutlines: DetailedOutline[]
  loading: boolean
  loadedScope: WorkspaceScope | null
  loadError: string | null
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  getOrCreate: (scope: WorkspaceScopeLike, outlineNodeId: number) => Promise<DetailedOutline>
  save: (id: number, patch: Partial<DetailedOutline>, scope?: WorkspaceScopeLike, expected?: Partial<DetailedOutline>) => Promise<void>
  editScene: (id: number, edit: DetailedSceneEditV1, scope: WorkspaceScopeLike, chapterSummary: string) => Promise<void>
  remove: (id: number, scope?: WorkspaceScopeLike) => Promise<void>
}

const now = () => Date.now()
let loadSequence = 0
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId
const authorFields = new Map((FIELD_BY_TARGET.get('detailedOutlines') ?? []).filter(field => !field.adoptionPolicy && field.field !== 'outlineNodeId').map(field => [field.field, field]))
const sceneFields = new Set<string>(['title', 'summary', 'characterIds', 'location', 'conflict', 'pace', 'estimatedWords', 'notes', ...DETAILED_SCENE_TASK_FIELDS.map(field => field.key)])
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Capture the displayed owner before joining an edit queue; never resolve an
 * omitted scope from the mutable active Work after the write has started. */
function captureScope(input: WorkspaceScopeLike | undefined, displayed: WorkspaceScope | null, id: number): Promise<WorkspaceScope> {
  const selected = input ?? displayed
  const promise = selected != null ? resolveScopeLike(typeof selected === 'number' ? selected : { ...selected }) : (async () => {
    const row = await db.detailedOutlines.get(id)
    const work = row?.workId == null ? undefined : await db.works.get(row.workId)
    if (!row || !work) throw new Error('细纲已删除或作品归属无效，输入未保存。')
    return resolveScopeLike({ projectId: row.projectId, worldId: work.worldId, workId: work.id! })
  })()
  void promise.catch(() => undefined)
  return promise
}
function validatePatch(patch: Partial<DetailedOutline>): void {
  for (const [key, value] of Object.entries(patch)) {
    const spec = authorFields.get(key)
    if (!spec) throw new Error('细纲更新包含身份、归属或未登记的作者字段。')
    if ((['string', 'longtext'].includes(spec.type) && typeof value !== 'string')
      || (spec.type === 'enum' && !spec.enums?.includes(value as string))
      || (spec.type === 'array' && !Array.isArray(value))) throw new Error(`细纲 ${key} 格式异常。`)
    if (key === 'scenes') normalizeDetailedScenes(value)
    if (['appearingCharacterIds', 'foreshadowIds'].includes(key)
      && (!Array.isArray(value) || Array.from(value as unknown[]).some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1))) throw new Error(`细纲 ${key} 必须是有效标识数组。`)
    if (key === 'prohibitions' && (!Array.isArray(value) || Array.from(value as unknown[]).some(item => typeof item !== 'string'))) throw new Error('细纲不可写清单必须是文本数组。')
  }
}
function normalizeRow(row: DetailedOutline): DetailedOutline {
  const patch = Object.fromEntries(Object.entries(row).filter(([key, value]) => authorFields.has(key) && value !== undefined))
  validatePatch(patch)
  return { ...row, scenes: normalizeDetailedScenes(row.scenes) }
}
async function ownedRow(scope: WorkspaceScope, id: number): Promise<DetailedOutline> {
  const row = await db.detailedOutlines.get(id)
  if (!row || !await assertRecordInScope(scope, 'detailedOutlines', row, { owner: 'work' })) throw new Error('细纲已删除或不属于指定作品，输入未保存。')
  const node = await db.outlineNodes.get(row.outlineNodeId)
  if (!node || node.type !== 'chapter' || !await assertRecordInScope(scope, 'outlineNodes', node, { owner: 'work' })) throw new Error('细纲章纲目标已删除或不属于原作品。')
  return normalizeRow(row)
}
async function validateReferences(scope: WorkspaceScope, row: DetailedOutline): Promise<void> {
  for (const id of new Set([...(row.appearingCharacterIds ?? []), ...row.scenes.flatMap(scene => scene.characterIds)])) {
    const character = await db.characters.get(id)
    if (!character || !await assertRecordInScope(scope, 'characters', character)) throw new Error('细纲引用的角色已删除或不属于当前世界。')
  }
  for (const id of new Set(row.foreshadowIds ?? [])) {
    const item = await db.foreshadows.get(id)
    if (!item || !await assertRecordInScope(scope, 'foreshadows', item)) throw new Error('细纲引用的伏笔已删除或不属于当前作品。')
  }
}

export const useDetailedOutlineStore = create<DetailedOutlineStore>((set, get) => {
  const canPublish = (scope: WorkspaceScope) => sameWork(get().loadedScope, scope)
    || (!get().loadedScope && get().detailedOutlines.every(row => row.projectId === scope.projectId && row.workId === scope.workId))
  const publish = (scope: WorkspaceScope, saved: DetailedOutline, replaceParent = false) => {
    if (!canPublish(scope)) return
    const list = get().detailedOutlines.filter(row => replaceParent ? row.outlineNodeId !== saved.outlineNodeId : row.id !== saved.id)
    set({ loadedScope: scope, detailedOutlines: [...list, saved] })
  }
  return {
    detailedOutlines: [], loading: false, loadedScope: null, loadError: null,
    loadAll: async input => {
      const request = ++loadSequence
      set({ loading: true, loadError: null })
      try {
        const scope = await resolveReadScopeLike(typeof input === 'number' ? input : { ...input })
        if (request !== loadSequence) return
        if (!sameWork(get().loadedScope, scope)) set({ detailedOutlines: [], loadedScope: null })
        const rows = (await readOwnedRows<DetailedOutline>(scope, 'detailedOutlines', { owner: 'work' })).map(normalizeRow)
        if (new Set(rows.map(row => row.outlineNodeId)).size !== rows.length) throw new Error('同一章纲存在多个细纲记录，原数据已保留，请先核对恢复。')
        if (request === loadSequence) set({ detailedOutlines: rows, loading: false, loadedScope: scope })
      } catch (cause) {
        if (request === loadSequence) set({ loading: false, loadError: cause instanceof Error ? cause.message : '细纲读取失败。' })
      }
    },
    getOrCreate: async (input, outlineNodeId) => {
      const scope = await resolveScopeLike(typeof input === 'number' ? input : { ...input })
      const saved = await db.transaction('rw', scopeTransactionTables(db.detailedOutlines, db.outlineNodes), async () => {
        await resolveScopeLike(scope)
        const node = await db.outlineNodes.get(outlineNodeId)
        if (!node || node.type !== 'chapter' || !await assertRecordInScope(scope, 'outlineNodes', node, { owner: 'work' })) throw new Error('细纲必须关联原作品中的有效章纲。')
        const rows = await db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).toArray()
        if (rows.length > 1) throw new Error('同一章纲存在多个细纲记录，原数据已保留。')
        if (rows.length) return ownedRow(scope, rows[0].id!)
        const row = stampNewRecord(scope, 'detailedOutlines', { projectId: scope.projectId, outlineNodeId, scenes: [], createdAt: now(), updatedAt: now() }, { owner: 'work' }) as DetailedOutline
        const id = await db.detailedOutlines.add(row) as number
        return { ...row, id }
      })
      publish(scope, saved, true)
      return saved
    },
    save: (id, input, scopeInput, inputExpected) => {
      const patch = structuredClone(input)
      const expected = structuredClone(inputExpected ?? get().detailedOutlines.find(row => row.id === id))
      const captured = captureScope(scopeInput, get().loadedScope, id)
      return coordinatePendingEditV1({ key: `detailed-outline:${id}`, persist: async () => {
        validatePatch(patch)
        const scope = await captured
        const saved = await db.transaction('rw', scopeTransactionTables(db.detailedOutlines, db.outlineNodes, db.characters, db.foreshadows), async () => {
          await resolveScopeLike(scope)
          const row = await ownedRow(scope, id)
          if (expected && Object.keys(patch).some(key => !equal(row[key as keyof DetailedOutline], expected[key as keyof DetailedOutline]))) throw new Error('细纲字段已被其他页面修改，输入已保留，请核对后保存。')
          const next = normalizeRow({ ...row, ...patch, updatedAt: Math.max(now(), row.updatedAt + 1) })
          await validateReferences(scope, next)
          if (await db.detailedOutlines.update(id, { ...patch, updatedAt: next.updatedAt }) !== 1) throw new Error('细纲已删除，输入未保存。')
          return next
        })
        publish(scope, saved)
      } })
    },
    editScene: (id, input, scopeInput, chapterSummary) => {
      const edit = structuredClone(input)
      const captured = captureScope(scopeInput, get().loadedScope, id)
      const persist = async () => {
        if (typeof chapterSummary !== 'string') throw new Error('章纲摘要必须是文本。')
        const scope = await captured
        const saved = await db.transaction('rw', scopeTransactionTables(db.detailedOutlines, db.outlineNodes, db.characters, db.foreshadows), async () => {
          await resolveScopeLike(scope)
          const row = await ownedRow(scope, id)
          const scenes = row.scenes
          let next: DetailedScene[]
          if (edit.kind === 'add') next = [...scenes, edit.scene]
          else {
            const current = scenes.find(scene => scene.sceneId === edit.sceneId)
            if (!current) throw new Error('场景已变化或删除，编辑未写入。')
            if (edit.kind === 'patch') {
              if ('sceneId' in edit.patch) throw new Error('场景编辑不能改变稳定标识。')
              for (const key of Object.keys(edit.patch)) if (!sceneFields.has(key)) throw new Error('场景编辑包含稳定标识或未登记字段。')
              if (edit.expected && Object.keys(edit.patch).some(key => !equal(current[key as keyof DetailedScene], edit.expected![key as keyof typeof edit.expected]))) throw new Error('场景字段已被其他页面修改，输入已保留，请核对后保存。')
            }
            next = edit.kind === 'remove' ? scenes.filter(scene => scene.sceneId !== edit.sceneId) : scenes.map(scene => scene.sceneId === edit.sceneId ? { ...scene, ...edit.patch } : scene)
          }
          normalizeDetailedScenes(next)
          const data = { scenes: next, lastUsedSummary: row.lastUsedSummary ?? chapterSummary, updatedAt: Math.max(now(), row.updatedAt + 1) }
          await validateReferences(scope, { ...row, ...data })
          if (await db.detailedOutlines.update(id, data) !== 1) throw new Error('细纲已删除，场景编辑未写入。')
          return { ...row, ...data }
        })
        publish(scope, saved)
      }
      // A reported add/delete failure has no unsaved field draft. Native write
      // transactions still serialize with edits, without a permanent draft key.
      return edit.kind !== 'patch' ? persist() : coordinatePendingEditV1({ key: `detailed-outline:${id}`, persist })
    },
    remove: async (id, input) => {
      const scope = await captureScope(input, get().loadedScope, id)
      await db.transaction('rw', scopeTransactionTables(db.detailedOutlines, db.outlineNodes), async () => {
        await resolveScopeLike(scope)
        await ownedRow(scope, id)
        await db.detailedOutlines.delete(id)
      })
      if (canPublish(scope)) set({ detailedOutlines: get().detailedOutlines.filter(row => row.id !== id) })
    },
  }
})
