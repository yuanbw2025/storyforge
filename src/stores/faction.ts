import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Faction, FactionRelation } from '../lib/types'
import { transactionTablesFor } from '../lib/registry/lifecycle'

interface FactionStore {
  factions: Faction[]
  factionRelations: FactionRelation[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addFaction: (faction: Omit<Faction, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateFaction: (id: number, data: Partial<Faction>) => Promise<void>
  deleteFaction: (id: number) => Promise<void>
  addFactionRelation: (rel: Omit<FactionRelation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateFactionRelation: (id: number, data: Partial<FactionRelation>) => Promise<void>
  deleteFactionRelation: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useFactionStore = create<FactionStore>((set, get) => ({
  factions: [],
  factionRelations: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const [factions, factionRelations] = await Promise.all([
      db.factions.where('projectId').equals(projectId).toArray(),
      db.factionRelations.where('projectId').equals(projectId).toArray(),
    ])
    set({ factions, factionRelations, loading: false })
  },

  addFaction: async (faction) => {
    const newFaction: Faction = { ...faction, createdAt: now(), updatedAt: now() }
    const id = await db.factions.add(newFaction) as number
    set({ factions: [...get().factions, { ...newFaction, id }] })
    return id
  },

  updateFaction: async (id, data) => {
    const updatedAt = now()
    await db.factions.update(id, { ...data, updatedAt })
    set({
      factions: get().factions.map(f => f.id === id ? { ...f, ...data, updatedAt } : f),
    })
  },

  deleteFaction: async (id) => {
    // 级联清理：删势力同时删除引用该势力的所有 factionRelations
    // （PROJECT_TABLES refs 定义了 cascade，但 Dexie 无原生外键，需显式执行）
    await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
      await db.factionRelations.where('fromFactionId').equals(id).delete()
      await db.factionRelations.where('toFactionId').equals(id).delete()
      await db.factions.delete(id)
    })
    set({
      factions: get().factions.filter(f => f.id !== id),
      factionRelations: get().factionRelations.filter(r => r.fromFactionId !== id && r.toFactionId !== id),
    })
  },

  addFactionRelation: async (rel) => {
    const newRel: FactionRelation = { ...rel, createdAt: now(), updatedAt: now() }
    const id = await db.factionRelations.add(newRel) as number
    set({ factionRelations: [...get().factionRelations, { ...newRel, id }] })
    return id
  },

  updateFactionRelation: async (id, data) => {
    const updatedAt = now()
    await db.factionRelations.update(id, { ...data, updatedAt })
    set({
      factionRelations: get().factionRelations.map(r => r.id === id ? { ...r, ...data, updatedAt } : r),
    })
  },

  deleteFactionRelation: async (id) => {
    await db.factionRelations.delete(id)
    set({ factionRelations: get().factionRelations.filter(r => r.id !== id) })
  },
}))
