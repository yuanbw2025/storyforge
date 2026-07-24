import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Character } from '../lib/types'
import { applyCharacterReferenceRemap, nullifyItemLedgerCharacterRefs } from '../lib/registry/character-references'
import { normalizeCharacterAxes } from '../lib/character/character-axes'
import { transactionTablesFor } from '../lib/registry/lifecycle'

// 注:势力(Faction)已于 C2 并入「势力」词条,旧 factions 表数据由
// migrations/faction-to-codex 一次性迁移;本 store 不再管理势力。

interface CharacterStore {
  characters: Character[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>

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

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const characters = await db.characters.where('projectId').equals(projectId).toArray()
    set({ characters, loading: false })
  },

  addCharacter: async (char) => {
    const normalized = normalizeCharacterAxes(char as unknown as Record<string, unknown>)
    const newChar: Character = { ...char, ...normalized, createdAt: now(), updatedAt: now() } as Character
    const id = await db.characters.add(newChar) as number
    set({ characters: [...get().characters, { ...newChar, id }] })
    return id
  },

  updateCharacter: async (id, data) => {
    const current = get().characters.find(c => c.id === id) ?? await db.characters.get(id)
    if (!current) return
    const patch = normalizeCharacterAxes(
      data as Record<string, unknown>,
      current as unknown as Record<string, unknown>,
    ) as Partial<Character>
    const updatedAt = now()
    await db.characters.update(id, { ...patch, updatedAt })
    set({
      characters: get().characters.map(c =>
        c.id === id ? { ...c, ...patch, updatedAt } : c
      ),
    })
  },

  deleteCharacter: async (id) => {
    const preChar = await db.characters.get(id)
    if (!preChar) return
    const projectId = preChar.projectId
    await db.transaction('rw', transactionTablesFor('importProject'), async () => {
      await db.characters.delete(id)
      await applyCharacterReferenceRemap({
        projectId,
        fromCharacterId: id,
        fromName: preChar.name,
      })
    })
    // itemLedger 的 characterId 软引用在事务外清理，避免 fake-indexeddb 兼容问题
    try {
      await nullifyItemLedgerCharacterRefs(projectId, id)
    } catch {
      // 软引用清理失败不阻塞删除
    }
    set({ characters: get().characters.filter(c => c.id !== id) })
  },
}))
