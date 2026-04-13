import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { CharacterRelation } from '../lib/types'

interface CharacterRelationStore {
  relations: CharacterRelation[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addRelation: (relation: Omit<CharacterRelation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateRelation: (id: number, data: Partial<CharacterRelation>) => Promise<void>
  deleteRelation: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useCharacterRelationStore = create<CharacterRelationStore>((set, get) => ({
  relations: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const relations = await db.characterRelations
      .where('projectId')
      .equals(projectId)
      .toArray()
    set({ relations, loading: false })
  },

  addRelation: async (data) => {
    const newRelation: CharacterRelation = {
      ...data,
      createdAt: now(),
      updatedAt: now(),
    }
    const id = await db.characterRelations.add(newRelation)
    set({ relations: [...get().relations, { ...newRelation, id: id as number }] })
  },

  updateRelation: async (id: number, data: Partial<CharacterRelation>) => {
    await db.characterRelations.update(id, { ...data, updatedAt: now() })
    set({
      relations: get().relations.map((r) =>
        r.id === id ? { ...r, ...data, updatedAt: now() } : r
      ),
    })
  },

  deleteRelation: async (id: number) => {
    await db.characterRelations.delete(id)
    set({ relations: get().relations.filter((r) => r.id !== id) })
  },
}))
