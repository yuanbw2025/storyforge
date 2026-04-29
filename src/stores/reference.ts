import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Reference, CreateReferenceInput } from '../lib/types'

interface ReferenceStore {
  references: Reference[]
  loading: boolean
  loadAll: (projectId: number) => Promise<void>
  addReference: (data: CreateReferenceInput) => Promise<number>
  updateReference: (id: number, data: Partial<Reference>) => Promise<void>
  deleteReference: (id: number) => Promise<void>
}

export const useReferenceStore = create<ReferenceStore>((set, get) => ({
  references: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const references = await db.references.where('projectId').equals(projectId).toArray()
    set({ references, loading: false })
  },

  addReference: async (data: CreateReferenceInput) => {
    const now = Date.now()
    const id = await db.references.add({ ...data, createdAt: now, updatedAt: now } as Reference)
    await get().loadAll(data.projectId)
    return id as number
  },

  updateReference: async (id: number, data: Partial<Reference>) => {
    await db.references.update(id, { ...data, updatedAt: Date.now() })
    const ref = await db.references.get(id)
    if (ref) await get().loadAll(ref.projectId)
  },

  deleteReference: async (id: number) => {
    const ref = await db.references.get(id)
    await db.references.delete(id)
    if (ref) await get().loadAll(ref.projectId)
  },
}))
