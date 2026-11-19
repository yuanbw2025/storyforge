import Dexie from 'dexie'
import { isPortableResourceUidV1 } from '../lib/context-gateway/resource-uid'
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Worldview, StoryCore, PowerSystem, WorkspaceScope, DivineDesign, NaturalResources, WorldGroup } from '../lib/types'
import { EMPTY_DIVINE_DESIGN, EMPTY_NATURAL_RESOURCES } from '../lib/types/worldview'
import type { AdoptResult } from '../lib/registry/types'
import { adopt, adoptionTransactionTablesV1, hashAdoptFieldValueV1 } from '../lib/registry/adopt'
import { refreshSettingAssertionSourceStatus } from '../lib/fact-ledger/setting-assertions'
import { assertRecordInScope, scopeTransactionTables, readOwnedRows, resolveScope, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'

import { LOCAL_SAVE_NATURAL_FIELDS_V1, type LocalSaveAckV1, type LocalSaveIntentV1, type LocalSaveWitnessV1, type LocalSaveNaturalFieldV1 } from '../lib/authoring/local-save-evidence'

interface SaveWorldview {
  (data: WorldviewAuthorPatch, scope?: WorkspaceScope): Promise<void>
  (data: WorldviewAuthorPatch, scope: WorkspaceScope, confirmation: LocalSaveIntentV1): Promise<LocalSaveAckV1>
}
export type WorldviewAuthorPatch = Partial<Omit<Worldview, 'divineDesign' | 'naturalResources'>> & {
  divineDesign?: Partial<DivineDesign>
  naturalResources?: Partial<NaturalResources>
}

interface WorldviewStore {
  worldview: Worldview | null
  storyCore: StoryCore | null
  powerSystem: PowerSystem | null
  loading: boolean
  loadError: string | null
  loadedProjectId: number | null
  loadedScope: WorkspaceScope | null
  /** 当前加载的世界组（null = 单世界模式 / 未指定） */
  activeWorldGroupId: number | null

  loadAll: (scope: WorkspaceScopeLike, worldGroupId?: number | null) => Promise<void>

  localSaveWitnesses: Partial<Record<LocalSaveNaturalFieldV1, LocalSaveWitnessV1>>
  saveWorldview: SaveWorldview
  saveStoryCore: (data: Partial<StoryCore>, scope?: WorkspaceScope) => Promise<void>
  savePowerSystem: (data: Partial<PowerSystem>, scope?: WorkspaceScope) => Promise<void>
}

const now = () => Date.now()
let worldviewLoadRequest = 0

function captureScope(projectId: number, scope?: WorkspaceScope) {
  const promise = resolveScope({ projectId, scope })
  // Queue admission can precede execution. Observe early read failure while
  // retaining the rejected promise for the writer/navigation barrier.
  void promise.catch(() => undefined)
  return promise
}

function sameScope(left: WorkspaceScope | null, right: WorkspaceScope) {
  return left?.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId
}

function requireWritten(result: AdoptResult, fields: string[]) {
  if (result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length
    || fields.some(field => !result.written.some(row => row.fields.includes(field)))) {
    throw new Error(`编辑未保存：${result.typeErrors[0]?.got || result.skipped[0]?.reason || (result.unknown.length ? '包含未登记字段' : '字段未写入')}`)
  }
}

function mergeAuthorWorldviewObjects(current: Worldview | undefined, patch: Record<string, unknown>) {
  for (const [field, defaults] of [['divineDesign', EMPTY_DIVINE_DESIGN], ['naturalResources', EMPTY_NATURAL_RESOURCES]] as const) {
    const delta = patch[field]
    if (delta === undefined) continue
    const before = current?.[field]
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)
      || Object.entries(delta).some(([key, value]) => !Object.prototype.hasOwnProperty.call(defaults, key)
        || typeof value !== typeof (defaults as Record<string, unknown>)[key])) {
      throw new Error(`编辑未保存：${field} 子项格式无效`)
    }
    if (before != null && (typeof before !== 'object' || Array.isArray(before)
      || Object.entries(defaults).some(([key, value]) => Object.prototype.hasOwnProperty.call(before, key)
        && typeof (before as unknown as Record<string, unknown>)[key] !== typeof value))) {
      throw new Error(`编辑未保存：已有 ${field} 数据格式无效，请先恢复数据`)
    }
    patch[field] = { ...defaults, ...before, ...delta }
  }
  return patch
}

async function naturalWitness(row: Worldview | undefined, scope: WorkspaceScope, worldGroupId: number | null,
  field: LocalSaveNaturalFieldV1, source: LocalSaveWitnessV1['source']): Promise<LocalSaveWitnessV1> {
  const value = row?.[field]
  if (value !== undefined && typeof value !== 'string') throw new Error('字段格式异常，不能确认本机保存。')
  if (row && (row.id == null || !isPortableResourceUidV1(row.ragDocumentId, 'worldview'))) throw new Error('字段记录身份不完整，不能确认本机保存。')
  return { version: 1, source, identity: { ...scope, table: 'worldviews', field, worldGroupId },
    recordId: row?.id ?? null, resourceUid: row?.ragDocumentId ?? null,
    present: row != null && Object.prototype.hasOwnProperty.call(row, field), value, valueHash: await hashAdoptFieldValueV1(value), confirmedAt: Date.now() }
}
async function naturalWitnesses(row: Worldview | undefined, scope: WorkspaceScope, group: number | null) {
  const pairs = await Promise.all(LOCAL_SAVE_NATURAL_FIELDS_V1.map(async field => {
    try { return [field, await naturalWitness(row, scope, group, field, 'database-read')] as const }
    catch { return [field, undefined] as const }
  }))
  return Object.fromEntries(pairs) as WorldviewStore['localSaveWitnesses']
}

/** One opt-in branch of the existing writer, never a second UI write callback.
 * Keep every transactional continuation on the original Dexie transaction;
 * native promises are bridged only for the existing scoped reads/hashes. */
function saveConfirmedNaturalField(data: WorldviewAuthorPatch, scope: WorkspaceScope, intent: LocalSaveIntentV1) {
  if (Dexie.currentTransaction) return Promise.reject(new Error('本机保存确认需要独立提交事务。'))
  scope = { ...scope }
  const request = structuredClone(intent)
  const { expected } = request
  const identity = expected?.identity
  const field = identity?.field
  if (request.kind !== 'natural-field-local-save-v1' || !identity || identity.table !== 'worldviews'
    || !LOCAL_SAVE_NATURAL_FIELDS_V1.includes(field) || !request.session || !Number.isSafeInteger(request.generation)
    || request.generation < 0 || expected.version !== 1
    || !['database-read', 'committed-write'].includes(expected.source)
    || identity.projectId !== scope.projectId || identity.worldId !== scope.worldId || identity.workId !== scope.workId
    || data.projectId !== scope.projectId || (data.worldGroupId ?? null) !== identity.worldGroupId
    || Object.keys(data).some(key => !['projectId', 'worldGroupId', field].includes(key)) || typeof data[field] !== 'string') {
    return Promise.reject(new Error('本机保存字段或作用域凭据无效。'))
  }
  const raw = data[field]!
  const patch = { [field]: raw }
  const group = identity.worldGroupId
  const tables = scopeTransactionTables(...adoptionTransactionTablesV1('worldviews', patch, { callerOwned: true }), db.worldGroups)
  return coordinatePendingEditV1({ key: `worldview:${scope.projectId}:${group ?? 'default'}`, persist: () => {
    if (Dexie.currentTransaction) throw new Error('本机保存确认需要独立提交事务。')
    return db.transaction('rw', tables, () => {
      const transaction = Dexie.currentTransaction!
      const owned = { transaction }
      const base = { projectId: scope.projectId, scope, worldGroupId: group, target: 'worldviews', mode: 'replace' as const, data: patch }
      return Dexie.Promise.resolve(Dexie.waitFor(resolveScope({ projectId: scope.projectId, scope }))).then(() => {
        return transaction.table('projects').get(scope.projectId)
      }).then(project => {
        if (project?.workspacePurpose !== 'independent-work') throw new Error('本机保存确认仅开放独立长篇。')
        return transaction.table('works').get(scope.workId)
      }).then(work => {
        if (work?.kind !== 'novel' || work.novelProfile !== 'long') throw new Error('本机保存确认仅开放独立长篇。')
        return group == null ? undefined : transaction.table('worldGroups').get(group).then(row =>
          Dexie.waitFor(assertRecordInScope(scope, 'worldGroups', row, { owner: 'world' })).then(valid => {
            if (!valid) throw new Error('世界组已失效，已保留草稿。')
          }))
      }).then(() => Dexie.waitFor(readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' }))).then(rows => {
        const matches = rows.filter(row => (row.worldGroupId ?? null) === group)
        if (matches.length > 1) throw new Error('世界设定记录不唯一，已保留草稿。')
        const row = matches[0]
        if ((row?.id ?? null) !== expected.recordId || (row?.ragDocumentId ?? null) !== expected.resourceUid
          || (row != null && Object.prototype.hasOwnProperty.call(row, field)) !== expected.present || row?.[field] !== expected.value) {
          throw new Error('此字段已被修改或记录已变化，已保留草稿；请核对后重新读取。')
        }
        return Dexie.waitFor(hashAdoptFieldValueV1(row?.[field])).then(hash => {
          if (hash !== expected.valueHash) throw new Error('字段预像已变化，已保留草稿。')
          if (row?.id != null) {
            if (row[field] === raw) return row.id
            return Dexie.Promise.resolve(adopt({ ...base, recordId: row.id, preserveAuthorText: true }, owned)).then(result => {
              requireWritten(result, [field]); return row.id!
            })
          }
          if (raw === '') throw new Error('尚未填写：空字段未创建记录，不能确认已保存。')
          return Dexie.Promise.resolve(adopt(base, owned)).then(created => {
            requireWritten(created, [field])
            if (created.written.length !== 1) throw new Error('首建记录不唯一。')
            const id = created.written[0].id
            return Dexie.Promise.resolve(adopt({ ...base, recordId: id, preserveAuthorText: true }, owned)).then(exact => {
              requireWritten(exact, [field]); return id
            })
          })
        })
      }).then(id => transaction.table('worldviews').get(id).then(row => {
        if (!row || row[field] !== raw || !row.ragDocumentId || (row.worldGroupId ?? null) !== group) throw new Error('事务内精确保存校验失败。')
        return { id, uid: row.ragDocumentId as string }
      }))
    }).then(async committed => {
      // The root promise resolves after commit. Read the original identity,
      // never select whatever record happens to be current in the UI now.
      await resolveScope({ projectId: scope.projectId, scope })
      const rows = (await readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' }))
        .filter(row => (row.worldGroupId ?? null) === group)
      const row = rows[0]
      if (rows.length !== 1 || row.id !== committed.id || row.ragDocumentId !== committed.uid || row[field] !== raw) {
        throw new Error('提交后字段已变化，未确认保存；已保留草稿。')
      }
      return { kind: 'natural-field-local-save-ack-v1' as const, session: request.session, generation: request.generation,
        witness: await naturalWitness(row, scope, group, field, 'committed-write'), row,
        witnesses: await naturalWitnesses(row, scope, group) }
    })
  } })
}

export const useWorldviewStore = create<WorldviewStore>((set, get) => ({
  worldview: null,
  localSaveWitnesses: {},
  storyCore: null,
  powerSystem: null,
  loading: false,
  loadError: null,
  loadedProjectId: null,
  loadedScope: null,
  activeWorldGroupId: null,

  loadAll: async (scopeInput: WorkspaceScopeLike, worldGroupId: number | null = null) => {
    const request = ++worldviewLoadRequest
    set({ loading: true, loadError: null, activeWorldGroupId: worldGroupId, localSaveWitnesses: {} })
    try {
      const scope = await resolveScopeLike(scopeInput)
      if (request !== worldviewLoadRequest) return
      if (!sameScope(get().loadedScope, scope)) set({ worldview: null, storyCore: null, powerSystem: null })
      set({ loadedProjectId: scope.projectId, loadedScope: scope })
      const [wvList, sc, psList, groups] = await Promise.all([
        readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' }),
        readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }).then(rows => rows[0]),
        readOwnedRows<PowerSystem>(scope, 'powerSystems', { owner: 'world' }),
        worldGroupId == null ? readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' }) : Promise.resolve([] as WorldGroup[]),
      ])
      if (request !== worldviewLoadRequest || get().loadedProjectId !== scope.projectId || get().activeWorldGroupId !== worldGroupId) return
      // 关闭多世界只收起分组入口，不把已归属主世界的记录隐藏或复制。
      const primaryId = groups.find(group => group.type === 'primary')?.id
      const wv = worldGroupId == null
        ? wvList.find(w => w.worldGroupId == null) ?? wvList.find(w => w.worldGroupId === primaryId)
        : wvList.find(w => w.worldGroupId === worldGroupId)
      const ps = worldGroupId == null
        ? psList.find(p => p.worldGroupId == null) ?? psList.find(p => p.worldGroupId === primaryId)
        : psList.find(p => p.worldGroupId === worldGroupId)
      const witnesses = await naturalWitnesses(wv, scope, wv?.worldGroupId ?? worldGroupId)
      if (request !== worldviewLoadRequest || !sameScope(get().loadedScope, scope) || get().activeWorldGroupId !== worldGroupId) return
      set({
        localSaveWitnesses: witnesses,
        worldview: wv ?? null,
        storyCore: sc || null,   // 故事核心归当前作品，不分世界组
        powerSystem: ps || null,
        loading: false,
      })
    } catch (cause) {
      if (request === worldviewLoadRequest) set({ loadError: cause instanceof Error ? cause.message : String(cause) })
      throw cause
    } finally {
      if (request === worldviewLoadRequest) set({ loading: false })
    }
  },

  saveWorldview: ((data: WorldviewAuthorPatch, frozenScope?: WorkspaceScope, confirmation?: LocalSaveIntentV1) => {
    if (confirmation) {
      if (!frozenScope) return Promise.reject(new Error('缺少冻结的工作区。'))
      return saveConfirmedNaturalField(data, frozenScope, confirmation).then(({ row, witnesses, ...ack }) => {
        const current = get()
        if (sameScope(current.loadedScope, frozenScope) && (current.activeWorldGroupId === ack.witness.identity.worldGroupId
          || (current.activeWorldGroupId == null && current.worldview?.id === row.id))) {
          worldviewLoadRequest++
          set({ loading: false, loadError: null, worldview: row, localSaveWitnesses: { ...witnesses, [ack.witness.identity.field]: ack.witness } })
        } else if (sameScope(current.loadedScope, frozenScope) && current.activeWorldGroupId == null && row.worldGroupId == null) {
          worldviewLoadRequest++
          set({ loading: false, loadError: null, worldview: row, localSaveWitnesses: { ...witnesses, [ack.witness.identity.field]: ack.witness } })
        }
        return ack
      })
    }
    const { worldview, activeWorldGroupId } = get()
    const projectId = data.projectId ?? worldview?.projectId
    if (projectId == null) return Promise.reject(new Error('编辑未保存：缺少工作区'))
    const { id: _, projectId: __, createdAt: ___, updatedAt: ____, worldGroupId, ...patch } = data
    const targetWorldGroupId = worldGroupId !== undefined ? worldGroupId : activeWorldGroupId
    const scopePromise = captureScope(projectId, frozenScope)
    return coordinatePendingEditV1({
      key: `worldview:${projectId}:${targetWorldGroupId ?? 'default'}`,
      persist: async () => {
        const scope = await scopePromise
        const list = await readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' })
        const target = list.find(row => (row.worldGroupId ?? null) === targetWorldGroupId)
        const merged = mergeAuthorWorldviewObjects(target, { ...patch })
        const result = await adopt({
          projectId, scope, worldGroupId: targetWorldGroupId, target: 'worldviews', mode: 'replace',
          ...(target?.id != null ? { recordId: target.id, preserveAuthorText: true } : {}),
          data: merged,
        })
        requireWritten(result, Object.keys(merged))
        const next = (await readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' }))
          .find(row => (row.worldGroupId ?? null) === targetWorldGroupId) ?? null
        const current = get()
        if (sameScope(current.loadedScope, scope) && (current.activeWorldGroupId === targetWorldGroupId
          || (current.activeWorldGroupId == null && target?.id != null && current.worldview?.id === target.id))) set({ worldview: next, localSaveWitnesses: {} })
      },
    })
  }) as SaveWorldview,

  saveStoryCore: (data: Partial<StoryCore>, frozenScope?: WorkspaceScope) => {
    const { storyCore } = get()
    const projectId = data.projectId ?? storyCore?.projectId
    if (projectId == null) return Promise.reject(new Error('编辑未保存：缺少工作区'))
    const { id: _, projectId: __, createdAt: ___, updatedAt: ____, ...patch } = data
    const scopePromise = captureScope(projectId, frozenScope)
    return coordinatePendingEditV1({
      key: `story-core:${projectId}`,
      persist: async () => {
        const scope = await scopePromise
        const target = (await readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }))[0]
        const result = await adopt({
          projectId, scope, target: 'storyCores', mode: 'replace',
          ...(target?.id != null ? { recordId: target.id, preserveAuthorText: true } : {}),
          data: patch as Record<string, unknown>,
        })
        requireWritten(result, Object.keys(patch))
        const next = (await readOwnedRows<StoryCore>(scope, 'storyCores', { owner: 'work' }))[0] ?? null
        if (sameScope(get().loadedScope, scope)) set({ storyCore: next })
      },
    })
  },

  savePowerSystem: (data: Partial<PowerSystem>, frozenScope?: WorkspaceScope) => {
    const { powerSystem, activeWorldGroupId } = get()
    const projectId = data.projectId ?? powerSystem?.projectId
    if (projectId == null) return Promise.resolve()
    const worldGroupId = data.worldGroupId !== undefined ? data.worldGroupId : activeWorldGroupId
    // Capture scope and field patch before the queued write; never borrow a newly
    // selected project's/group's record from the global store inside persist().
    const patch = Object.fromEntries(
      (['name', 'description', 'levels', 'rules'] as const)
        .filter(field => data[field] !== undefined).map(field => [field, data[field]]),
    )
    if (!Object.keys(patch).length) return Promise.resolve()
    const scopePromise = captureScope(projectId, frozenScope)
    return coordinatePendingEditV1({
      key: `power-system:${projectId}:${worldGroupId ?? 'default'}`,
      persist: async () => {
        const scope = await scopePromise
        const list = await readOwnedRows<PowerSystem>(scope, 'powerSystems', { owner: 'world' })
        const target = list.find(row => (row.worldGroupId ?? null) === worldGroupId)
        let next: PowerSystem
        if (target?.id) {
          const updatedAt = now()
          await db.powerSystems.update(target.id, { ...patch, updatedAt })
          await refreshSettingAssertionSourceStatus({
            projectId, table: 'powerSystems', recordId: target.id,
            changedFields: Object.keys(patch),
          })
          next = { ...target, ...patch, updatedAt }
        } else {
          const row = stampNewRecord(scope, 'powerSystems', {
            projectId, name: '', description: '', levels: '', rules: '',
            ...patch, worldGroupId, createdAt: now(), updatedAt: now(),
          }, { owner: 'world' }) as PowerSystem
          const id = await db.powerSystems.add(row)
          next = { ...row, id: id as number }
        }
        const current = get()
        if ((current.activeWorldGroupId === worldGroupId || (current.activeWorldGroupId == null && current.powerSystem?.id === target?.id))
          && sameScope(current.loadedScope, scope)) {
          set({ powerSystem: next })
        }
      },
    })
  },
}))
