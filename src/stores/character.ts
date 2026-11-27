import { create } from 'zustand'
import Dexie from 'dexie'
import { db } from '../lib/db/schema'
import type { Character, WorkspaceScope } from '../lib/types'
import { applyCharacterReferenceRemap } from '../lib/registry/character-references'
import { normalizeCharacterAxes } from '../lib/character/character-axes'
import { transactionTablesFor } from '../lib/registry/lifecycle'
import { refreshSettingAssertionSourceStatus } from '../lib/fact-ledger/setting-assertions'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { FIELD_BY_TARGET } from '../lib/registry/field-registry'

import { assertRecordTextSaveExpectedV1, recordTextSaveRequestV1, recordTextSaveAckV1 } from '../lib/authoring/record-text-save-evidence'
import type { LocalSaveIntentV1, LocalSaveAckV1 } from '../lib/authoring/local-save-evidence'
interface CharacterTextUpdateV1 {
  (id: number, data: Partial<Character>, options?: { scope?: WorkspaceScope; expected?: Partial<Character> }): Promise<void>
  (id: number, data: Partial<Character>, options: { scope: WorkspaceScope; expected?: Partial<Character>; confirmation: LocalSaveIntentV1 }): Promise<LocalSaveAckV1>
}
// 势力由 Codex「势力」词条管理，本 store 只管理角色主档。

interface CharacterStore {
  characters: Character[]
  loading: boolean
  loadedScope: WorkspaceScope | null
  loadError: string | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>

  addCharacter: (char: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateCharacter: CharacterTextUpdateV1
  deleteCharacter: (id: number) => Promise<void>
}

const now = () => Date.now()
const sameWorld = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId
const authorFields = new Map((FIELD_BY_TARGET.get('characters') ?? []).filter(field => !field.adoptionPolicy && !field.field.startsWith('statusProducer')).map(field => [field.field, field]))
let loadSequence = 0, confirmedWriteRevision = 0

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  characters: [],
  loading: false,
  loadedScope: null,
  loadError: null,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    const request = ++loadSequence
    set({ loading: true, loadError: null })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      if (request !== loadSequence) return
      if (!sameWorld(get().loadedScope, scope)) set({ characters: [], loadedScope: null })
      let characters: Character[] = [], observed = -1
      for (let attempt = 0; attempt < 3; attempt++) {
        observed = confirmedWriteRevision
        characters = await readOwnedRows<Character>(scope, 'characters', { owner: 'world' })
        if (request !== loadSequence) return
        if (observed === confirmedWriteRevision) break
      }
      if (observed !== confirmedWriteRevision) throw new Error('读取期间角色持续变化，请重新读取。')
      if (request === loadSequence) set({ characters, loading: false, loadedScope: scope })
    } catch (cause) {
      if (request === loadSequence) set({ loading: false, loadError: cause instanceof Error ? cause.message : '角色读取失败。' })
    }
  },

  addCharacter: async (char) => {
    const normalized = normalizeCharacterAxes(char as unknown as Record<string, unknown>)
    const scope = await resolveScopeLike(char.projectId)
    const newChar: Character = stampNewRecord(
      scope,
      'characters',
      { ...char, ...normalized, createdAt: now(), updatedAt: now() } as Character,
      { owner: 'world' },
    )
    const id = await db.characters.add(newChar) as number
    if (sameWorld(get().loadedScope, scope)) set({ characters: [...get().characters, { ...newChar, id }] })
    return id
  },

  updateCharacter: ((id: number, data: Partial<Character>, options?: { scope?: WorkspaceScope; expected?: Partial<Character>; confirmation?: LocalSaveIntentV1 }) => {
    data = structuredClone(data)
    const confirmation = options?.confirmation ? structuredClone(options.confirmation) : undefined
    if (confirmation && Dexie.currentTransaction) return Promise.reject(new Error('文字保存确认需要独立提交。'))
    let proof: ReturnType<typeof recordTextSaveRequestV1> | undefined
    try { proof = confirmation ? recordTextSaveRequestV1('characters', id, data, options?.scope, confirmation) : undefined }
    catch (error) { return Promise.reject(error) }
    let ack: LocalSaveAckV1 | undefined
    const cached = get().characters.find(row => row.id === id)
    const expected = structuredClone(options?.expected ?? cached)
    const loaded = get().loadedScope
    const selected = options?.scope ? { ...options.scope } : (cached?.projectId === loaded?.projectId ? loaded ?? undefined : undefined)
    const scopePromise = selected ? Promise.resolve(selected) : db.characters.get(id).then(row => {
      if (!row) throw new Error('角色已删除，输入尚未保存。')
      return resolveScopeLike(row.projectId)
    })
    void scopePromise.catch(() => undefined)
    const operation = coordinatePendingEditV1({
      key: `character:${id}`,
      persist: async () => {
        for (const [key, value] of Object.entries(data)) {
          const spec = authorFields.get(key)
          if (!spec) throw new Error('角色更新包含非作者字段。')
          if (key === 'name' && (typeof value !== 'string' || !value.trim())) throw new Error('角色姓名格式异常，不能为空。')
          if (value == null) {
            if (!['homeWorldGroupId', 'raceEntryId', 'cultivationSystemId', 'powerSystemId', 'cultivationStageId', 'importantLocationId', 'firstAppearChapterId', 'exitChapterId', 'statusEvidenceChapterId', 'statusEvidenceStoryArcId'].includes(key)) throw new Error(`角色 ${key} 格式异常。`)
          } else if ((['string', 'longtext', 'json'].includes(spec.type) && typeof value !== 'string')
            || (spec.type === 'enum' && !spec.enums?.includes(value as string))
            || (spec.type === 'boolean' && typeof value !== 'boolean')
            || (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error(`角色 ${key} 格式异常。`)
          spec.validate?.(value)
        }
        const scope = await scopePromise
        let next = await db.transaction('rw', scopeTransactionTables(db.characters, db.temporalFacts), async () => {
          await resolveScopeLike(scope)
          const transaction = Dexie.currentTransaction!
          const table = transaction.table<Character, number>('characters')
          const update = db.characters.update.bind(table)
          const current = await table.get(id)
          if (!current || !await assertRecordInScope(scope, 'characters', current, { owner: 'world' })) throw new Error('角色已删除或不属于原来的 World；输入尚未保存。')
          if (expected && Object.keys(data).some(key => JSON.stringify(current[key as keyof Character]) !== JSON.stringify(expected[key as keyof Character]))) throw new Error('角色已被其他页面修改，输入已保留，请核对后保存。')
          if (confirmation) await Dexie.waitFor(assertRecordTextSaveExpectedV1(current, confirmation, transaction))
          const patch = normalizeCharacterAxes(data as Record<string, unknown>, current as unknown as Record<string, unknown>) as Partial<Character>
          const updatedAt = Math.max(now(), (Number.isFinite(current.updatedAt) ? current.updatedAt : 0) + 1)
          if (await update(id, { ...patch, updatedAt }) !== 1) throw new Error('角色已删除，输入尚未保存。')
          await refreshSettingAssertionSourceStatus({ projectId: current.projectId, table: 'characters', recordId: id, changedFields: Object.keys(patch) })
          if (confirmation && proof) {
            const actual = await table.get(id)
            await Dexie.waitFor(recordTextSaveAckV1(actual, confirmation, proof.raw))
            return actual!
          }
          return { ...current, ...patch, updatedAt }
        })
        if (confirmation && proof) {
          confirmedWriteRevision++
          const actual = await db.characters.get(id)
          ack = await recordTextSaveAckV1(actual, confirmation, proof.raw)
          next = actual!
        }
        if (sameWorld(get().loadedScope, scope)) set({ characters: get().characters.map(c => c.id === id ? next : c) })
      },
    })
    return operation.then(() => ack)
  }) as CharacterTextUpdateV1,

  deleteCharacter: async (id) => {
    const existingCharacter = await db.characters.get(id)
    if (!existingCharacter) return
    const projectId = existingCharacter.projectId
    const scope = await resolveScopeLike(projectId)
    const preChar = await db.characters.get(id)
    if (!preChar) return
    if (!await assertRecordInScope(scope, 'characters', preChar, { owner: 'world' })) return
    await db.transaction('rw', transactionTablesFor('importProject'), async () => {
      await applyCharacterReferenceRemap({
        projectId,
        fromCharacterId: id,
        fromName: preChar.name,
      })
      await db.characters.delete(id)
    })
    set({ characters: get().characters.filter(c => c.id !== id) })
  },
}))
