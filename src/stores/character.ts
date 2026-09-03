import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Character } from '../lib/types'
import { applyCharacterReferenceRemap } from '../lib/registry/character-references'
import { normalizeCharacterAxes } from '../lib/character/character-axes'
import { transactionTablesFor } from '../lib/registry/lifecycle'
import { refreshSettingAssertionSourceStatus } from '../lib/fact-ledger/setting-assertions'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'

// 注:势力(Faction)已于 C2 并入「势力」词条,旧 factions 表数据由
// migrations/faction-to-codex 一次性迁移;本 store 不再管理势力。

interface CharacterStore {
  characters: Character[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>

  addCharacter: (
    char: Omit<Character, 'id' | 'createdAt' | 'updatedAt' | 'role'>
      & Partial<Pick<Character, 'role'>>
  ) => Promise<number>
  updateCharacter: (id: number, data: Partial<Character>) => Promise<void>
  deleteCharacter: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  characters: [],
  loading: false,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    const scope = await resolveReadScopeLike(scopeInput)
    const characters = await readOwnedRows<Character>(scope, 'characters', { owner: 'world' })
    set({ characters, loading: false })
  },

  addCharacter: async (char) => {
    const normalized = normalizeCharacterAxes(char as unknown as Record<string, unknown>)
    const newChar: Character = stampNewRecord(
      await resolveScopeLike(char.projectId),
      'characters',
      { ...char, ...normalized, createdAt: now(), updatedAt: now() } as Character,
      { owner: 'world' },
    )
    const id = await db.characters.add(newChar) as number
    set({ characters: [...get().characters, { ...newChar, id }] })
    return id
  },

  updateCharacter: async (id, data) => {
    await coordinatePendingEditV1({
      key: `character:${id}`,
      persist: async () => {
        const initial = await db.characters.get(id)
        if (!initial) return
        const scope = await resolveScopeLike(initial.projectId)
        const current = await db.characters.get(id)
        if (!current) return
        if (!await assertRecordInScope(scope, 'characters', current, { owner: 'world' })) return
        const patch = normalizeCharacterAxes(
          data as Record<string, unknown>,
          current as unknown as Record<string, unknown>,
        ) as Partial<Character>
        const updatedAt = now()
        await db.characters.update(id, { ...patch, updatedAt })
        await refreshSettingAssertionSourceStatus({
          projectId: current.projectId,
          table: 'characters',
          recordId: id,
          changedFields: Object.keys(patch),
        })
        set({
          characters: get().characters.map(c =>
            c.id === id ? { ...c, ...patch, updatedAt } : c
          ),
        })
      },
    })
  },

  deleteCharacter: async (id) => {
    const beforeMigration = await db.characters.get(id)
    if (!beforeMigration) return
    const projectId = beforeMigration.projectId
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
