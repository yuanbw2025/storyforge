import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { CharacterRelation } from '../lib/types'
import { assertRecordInScope, readOwnedRows, resolveScopeLike, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'

interface CharacterRelationStore {
  relations: CharacterRelation[]
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addRelation: (relation: Omit<CharacterRelation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateRelation: (id: number, data: Partial<CharacterRelation>) => Promise<void>
  deleteRelation: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useCharacterRelationStore = create<CharacterRelationStore>((set, get) => ({
  relations: [],
  loading: false,

  loadAll: async (scopeInput: WorkspaceScopeLike) => {
    set({ loading: true })
    const relations = await readOwnedRows<CharacterRelation>(await resolveScopeLike(scopeInput), 'characterRelations', { owner: 'world' })
    set({ relations, loading: false })
  },

  addRelation: async (data) => {
    const scope = await resolveScopeLike(data.projectId)
    const [from, to] = await Promise.all([db.characters.get(data.fromCharacterId), db.characters.get(data.toCharacterId)])
    if (!from || !to || !await assertRecordInScope(scope, 'characters', from, { owner: 'world' })
      || !await assertRecordInScope(scope, 'characters', to, { owner: 'world' })) {
      throw new Error('[CharacterRelation] 角色不属于当前 World')
    }
    const newRelation = stampNewRecord(scope, 'characterRelations', {
      ...data,
      createdAt: now(),
      updatedAt: now(),
    }, { owner: 'world' }) as CharacterRelation
    const id = await db.characterRelations.add(newRelation)
    set({ relations: [...get().relations, { ...newRelation, id: id as number }] })
  },

  updateRelation: async (id: number, data: Partial<CharacterRelation>) => {
    const current = get().relations.find(r => r.id === id) ?? await db.characterRelations.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'characterRelations', current, { owner: 'world' })) return
    if (data.fromCharacterId != null || data.toCharacterId != null) {
      const scope = await resolveScopeLike(current.projectId)
      const [from, to] = await Promise.all([
        db.characters.get(data.fromCharacterId ?? current.fromCharacterId),
        db.characters.get(data.toCharacterId ?? current.toCharacterId),
      ])
      if (!from || !to || !await assertRecordInScope(scope, 'characters', from, { owner: 'world' })
        || !await assertRecordInScope(scope, 'characters', to, { owner: 'world' })) return
    }
    await db.characterRelations.update(id, { ...data, updatedAt: now() })
    set({
      relations: get().relations.map((r) =>
        r.id === id ? { ...r, ...data, updatedAt: now() } : r
      ),
    })
  },

  deleteRelation: async (id: number) => {
    const current = get().relations.find(r => r.id === id) ?? await db.characterRelations.get(id)
    if (!current || !await assertRecordInScope(await resolveScopeLike(current.projectId), 'characterRelations', current, { owner: 'world' })) return
    await db.characterRelations.delete(id)
    set({ relations: get().relations.filter((r) => r.id !== id) })
  },
}))
