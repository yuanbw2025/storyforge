import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Character, Faction } from '../lib/types'

interface CharacterStore {
  characters: Character[]
  factions: Faction[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>

  addCharacter: (char: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateCharacter: (id: number, data: Partial<Character>) => Promise<void>
  deleteCharacter: (id: number) => Promise<void>

  addFaction: (faction: Omit<Faction, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateFaction: (id: number, data: Partial<Faction>) => Promise<void>
  deleteFaction: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  characters: [],
  factions: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const [characters, factions] = await Promise.all([
      db.characters.where('projectId').equals(projectId).toArray(),
      db.factions.where('projectId').equals(projectId).toArray(),
    ])
    set({ characters, factions, loading: false })
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
    await db.characters.delete(id)
    set({ characters: get().characters.filter(c => c.id !== id) })
  },

  addFaction: async (faction) => {
    const newFaction: Faction = { ...faction, createdAt: now(), updatedAt: now() }
    const id = await db.factions.add(newFaction) as number
    set({ factions: [...get().factions, { ...newFaction, id }] })
    return id
  },

  updateFaction: async (id, data) => {
    await db.factions.update(id, { ...data, updatedAt: now() })
    set({
      factions: get().factions.map(f =>
        f.id === id ? { ...f, ...data, updatedAt: now() } : f
      ),
    })
  },

  deleteFaction: async (id) => {
    await db.factions.delete(id)
    set({ factions: get().factions.filter(f => f.id !== id) })
  },
}))
