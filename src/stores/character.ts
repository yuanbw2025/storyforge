import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Character } from '../lib/types'
import { applyCharacterReferenceRemap } from '../lib/registry/character-references'

// 注:势力(Faction)已于 C2 并入「势力」词条,旧 factions 表数据由
// migrations/faction-to-codex 一次性迁移;本 store 不再管理势力。

interface CharacterStore {
  characters: Character[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>

  addCharacter: (char: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
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
    const newChar: Character = { ...char, createdAt: now(), updatedAt: now() }
    const id = await db.characters.add(newChar) as number
    set({ characters: [...get().characters, { ...newChar, id }] })
    return id
  },

  updateCharacter: async (id, data) => {
    await db.characters.update(id, { ...data, updatedAt: now() })
    set({
      characters: get().characters.map(c =>
        c.id === id ? { ...c, ...data, updatedAt: now() } : c
      ),
    })
  },

  deleteCharacter: async (id) => {
    await db.transaction('rw', db.characters, db.characterRelations, db.detailedOutlines, db.stateCards, async () => {
      const char = await db.characters.get(id)
      if (!char) return
      await db.characters.delete(id)
      await applyCharacterReferenceRemap({
        projectId: char.projectId,
        fromCharacterId: id,
        fromName: char.name,
      })
    })
    set({ characters: get().characters.filter(c => c.id !== id) })
  },
}))
