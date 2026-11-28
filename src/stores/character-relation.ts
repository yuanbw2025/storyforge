import { transactionTablesForReferenceCascade } from '../lib/registry/lifecycle'
import { cascadeRegisteredReferences } from '../lib/workspace/lifecycle'
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { CharacterRelation, Character, WorkspaceScope } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

import Dexie from 'dexie'
import { FIELD_BY_TARGET } from '../lib/registry/field-registry'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import type { LocalSaveAckV1, LocalSaveIntentV1, LocalSaveWitnessV1 } from '../lib/authoring/local-save-evidence'
import { assertRecordTextSaveExpectedV1, recordTextSaveAckV1, recordTextSaveRequestV1 } from '../lib/authoring/record-text-save-evidence'

interface RelationAuthorOptions { scope?: WorkspaceScope; expected?: Partial<CharacterRelation> }
interface RelationAuthorUpdateV1 {
  (id: number, data: Partial<CharacterRelation>, options?: RelationAuthorOptions): Promise<void>
  (id: number, data: Partial<CharacterRelation>, options: RelationAuthorOptions & { scope: WorkspaceScope; confirmation: LocalSaveIntentV1 }): Promise<LocalSaveAckV1>
}
const authorFields = new Map((FIELD_BY_TARGET.get('characterRelations') ?? []).filter(field => !field.adoptionPolicy).map(field => [field.field, field]))
const sameWorld = (left: WorkspaceScope | null, right: WorkspaceScope) => left?.projectId === right.projectId && left.worldId === right.worldId
let readSequence = 0, writeRevision = 0
// A known committed field can fail its outside-transaction readback. Retain only
// its original confirmation until explicit retry; this is not a second data store.
const committedTextRecovery = new Map<string, { session: string; expected: LocalSaveWitnessV1; written: LocalSaveWitnessV1 }>()

interface CharacterRelationStore {
  relations: CharacterRelation[]
  loading: boolean
  loadedScope: WorkspaceScope | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addRelation: (relation: Omit<CharacterRelation, 'id' | 'createdAt' | 'updatedAt'>, scope?: WorkspaceScope) => Promise<void>
  updateRelation: RelationAuthorUpdateV1
  deleteRelation: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useCharacterRelationStore = create<CharacterRelationStore>((set, get) => ({
  relations: [],
  loading: false,
  loadedScope: null,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    const request = ++readSequence
    set({ loading: true })
    try {
      const scope = await resolveScopeLike(typeof scopeInput === 'number' ? scopeInput : { ...scopeInput })
      let relations: CharacterRelation[] = [], observed = -1
      for (let attempt = 0; attempt < 3; attempt++) {
        observed = writeRevision
        relations = await readOwnedRows<CharacterRelation>(scope, 'characterRelations', { owner: 'world' })
        if (request !== readSequence) return
        if (observed === writeRevision) break
      }
      if (observed !== writeRevision) throw new Error('读取期间关系持续变化，请重新读取。')
      if (request === readSequence) set({ relations, loadedScope: scope, loading: false })
    } catch (cause) { if (request === readSequence) set({ loading: false }); throw cause }
  },

  addRelation: async (input, explicitScope) => {
    const data = structuredClone(input)
    const scope = await resolveScopeLike(explicitScope ? { ...explicitScope } : data.projectId)
    if (data.projectId !== scope.projectId) throw new Error('关系创建作用域不匹配。')
    const saved = await db.transaction('rw', scopeTransactionTables(db.characterRelations, db.characters), async transaction => {
      await resolveScopeLike(scope)
      const characters = transaction.table<Character, number>('characters')
      const [from, to] = await Promise.all([characters.get(data.fromCharacterId), characters.get(data.toCharacterId)])
      if (!from || !to || !await assertRecordInScope(scope, 'characters', from, { owner: 'world' })
        || !await assertRecordInScope(scope, 'characters', to, { owner: 'world' })) throw new Error('[CharacterRelation] 角色不属于当前 World')
      const row = stampNewRecord(scope, 'characterRelations', { ...data, createdAt: now(), updatedAt: now() }, { owner: 'world' }) as CharacterRelation
      const table = transaction.table<CharacterRelation, number>('characterRelations')
      const id = await db.characterRelations.add.bind(table)(row) as number
      const actual = await table.get(id)
      if (!actual || actual.ragDocumentId !== row.ragDocumentId || !await assertRecordInScope(scope, 'characterRelations', actual, { owner: 'world' })
        || [...authorFields.keys()].some(field => Reflect.get(actual, field) !== Reflect.get(row, field))) throw new Error('关系创建后未读到相同身份与内容。')
      return actual
    })
    writeRevision++
    if (!get().loadedScope || sameWorld(get().loadedScope, scope)) set({ relations: [...get().relations, saved], loadedScope: scope })
  },

  updateRelation: ((id: number, input: Partial<CharacterRelation>, options?: RelationAuthorOptions & { confirmation?: LocalSaveIntentV1 }) => {
    const data = structuredClone(input), expected = structuredClone(options?.expected ?? get().relations.find(row => row.id === id))
    const confirmation = options?.confirmation ? structuredClone(options.confirmation) : undefined
    const explicitScope = options?.scope ? { ...options.scope } : undefined
    if (confirmation && Dexie.currentTransaction) return Promise.reject(new Error('角色关系保存确认需要独立提交。'))
    const captured = (async () => {
      if (explicitScope) return resolveScopeLike(explicitScope)
      const row = await db.characterRelations.get(id)
      if (!row) throw new Error('关系已删除，输入尚未保存。')
      return resolveScopeLike(row.projectId)
    })()
    void captured.catch(() => undefined)
    return coordinatePendingEditV1({ key: `character-relation:${id}`, persist: async () => {
      const scope = await captured
      for (const [field, value] of Object.entries(data)) {
        const spec = authorFields.get(field)
        if (!spec || (['string', 'longtext'].includes(spec.type) && typeof value !== 'string')
          || (spec.type === 'enum' && !spec.enums?.includes(value as string))
          || (spec.type === 'boolean' && typeof value !== 'boolean')
          || (spec.type === 'number' && (!Number.isSafeInteger(value) || Number(value) < 1))) throw new Error('关系修改包含身份、归属或无效作者字段。')
      }
      const proof = confirmation ? recordTextSaveRequestV1('characterRelations', id, data, explicitScope, confirmation) : undefined
      const recoveryKey = `${scope.projectId}:${scope.worldId}:${id}:${proof?.identity.field}`
      const recovery = committedTextRecovery.get(recoveryKey)
      const recovered = confirmation && recovery?.session === confirmation.session
        && recovery.expected.resourceUid === confirmation.expected.resourceUid
        && recovery.expected.valueHash === confirmation.expected.valueHash && recovery.expected.present === confirmation.expected.present
        ? { ...confirmation, expected: recovery.written } : confirmation
      let committedAck: LocalSaveAckV1 | undefined
      let saved = await db.transaction('rw', scopeTransactionTables(db.characterRelations, db.characters), async transaction => {
        await resolveScopeLike(scope)
        const table = transaction.table<CharacterRelation, number>('characterRelations'), current = await table.get(id)
        if (!current || !await assertRecordInScope(scope, 'characterRelations', current, { owner: 'world' })) throw new Error('关系已删除或不属于原世界，输入尚未保存。')
        if (expected && (confirmation ? ['fromCharacterId', 'toCharacterId'] : Object.keys(data)).some(field => Object.prototype.hasOwnProperty.call(expected, field) && Reflect.get(current, field) !== Reflect.get(expected, field))) throw new Error('关系字段或端点已被其他页面修改，输入已保留。')
        const characters = transaction.table<Character, number>('characters')
        const [from, to] = await Promise.all([characters.get(data.fromCharacterId ?? current.fromCharacterId), characters.get(data.toCharacterId ?? current.toCharacterId)])
        if (!from || !to || !await assertRecordInScope(scope, 'characters', from, { owner: 'world' })
          || !await assertRecordInScope(scope, 'characters', to, { owner: 'world' })) throw new Error('关系端点已删除或不属于原世界。')
        if (recovered) await Dexie.waitFor(assertRecordTextSaveExpectedV1(current, recovered, transaction))
        if (await db.characterRelations.update.bind(table)(id, { ...data, updatedAt: Math.max(now(), current.updatedAt + 1) }) !== 1) throw new Error('关系写入0行，输入尚未保存。')
        const actual = await table.get(id)
        if (!actual || !await assertRecordInScope(scope, 'characterRelations', actual, { owner: 'world' }) || actual.ragDocumentId !== current.ragDocumentId
          || Object.entries(data).some(([field, value]) => Reflect.get(actual, field) !== value)) throw new Error('关系保存后未读到相同身份与输入原文。')
        if (confirmation && proof) committedAck = await Dexie.waitFor(recordTextSaveAckV1(actual, confirmation, proof.raw))
        return actual
      })
      const revision = ++writeRevision
      if (confirmation && committedAck) committedTextRecovery.set(recoveryKey, { session: confirmation.session, expected: structuredClone(confirmation.expected), written: committedAck.witness })
      let ack: LocalSaveAckV1 | undefined
      if (confirmation && proof) {
        const actual = await db.characterRelations.get(id)
        ack = await recordTextSaveAckV1(actual, confirmation, proof.raw); saved = actual!
        committedTextRecovery.delete(recoveryKey)
      }
      if (revision === writeRevision && (!get().loadedScope || sameWorld(get().loadedScope, scope))) set({ relations: get().relations.map(row => row.id === id ? saved : row) })
      return ack
    } })
  }) as RelationAuthorUpdateV1,

  deleteRelation: async (id: number) => {
    const current = get().relations.find(r => r.id === id) ?? await db.characterRelations.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'characterRelations', current, { owner: 'world' })) return
    await db.transaction('rw', transactionTablesForReferenceCascade('characterRelations'), async () => {
      await cascadeRegisteredReferences('characterRelations', id)
      await db.characterRelations.delete(id)
    })
    set({ relations: get().relations.filter((r) => r.id !== id) })
  },
}))
