import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  parseCultivationStages,
  validateCultivationStages,
  type CultivationSystem,
} from '../lib/types/cultivation'
import {
  clearCultivationSystemReferences,
  clearRemovedCultivationStageReferences,
  refreshCultivationProgressStageSources,
} from '../lib/cultivation/lifecycle'
import { refreshSettingAssertionSourceStatus } from '../lib/fact-ledger/setting-assertions'
import { transactionTablesForReferences } from '../lib/registry/lifecycle'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'

interface CultivationStore {
  systems: CultivationSystem[]
  loading: boolean
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addSystem: (system: Omit<CultivationSystem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateSystem: (id: number, patch: Partial<CultivationSystem>) => Promise<void>
  deleteSystem: (id: number) => Promise<void>
}

const now = () => Date.now()

export const useCultivationStore = create<CultivationStore>((set, get) => ({
  systems: [],
  loading: false,

  loadAll: async (scopeInput) => {
    set({ loading: true })
    try {
      const scope = await resolveReadScopeLike(scopeInput)
      const systems = await readOwnedRows<CultivationSystem>(scope, 'cultivationSystems', { owner: 'world' })
      set({ systems, loading: false })
    } catch (error) {
      console.error('[Cultivation] loadAll 失败:', error)
      set({ systems: [], loading: false })
    }
  },

  addSystem: async (system) => {
    const validation = validateCultivationStages(parseCultivationStages(system.stages))
    if (!validation.valid) throw new Error(validation.errors.join('；'))
    const timestamp = now()
    const row = stampNewRecord(
      await resolveScopeLike(system.projectId),
      'cultivationSystems',
      { ...system, createdAt: timestamp, updatedAt: timestamp },
      { owner: 'world' },
    ) as CultivationSystem
    const id = await db.cultivationSystems.add(row) as number
    set({ systems: [...get().systems, { ...row, id }] })
    return id
  },

  updateSystem: async (id, patch) => {
    await coordinatePendingEditV1({
      key: `cultivation-system:${id}`,
      persist: async () => {
        const initial = await db.cultivationSystems.get(id)
        if (!initial) return
        const scope = await resolveScopeLike(initial.projectId)
        const current = await db.cultivationSystems.get(id)
        if (!current) return
        if (!await assertRecordInScope(scope, 'cultivationSystems', current, { owner: 'world' })) return
        let removedStageIds = new Set<string>()
        if (patch.stages !== undefined) {
          const nextStages = parseCultivationStages(patch.stages)
          const validation = validateCultivationStages(nextStages)
          if (!validation.valid) throw new Error(validation.errors.join('；'))
          const nextIds = new Set(nextStages.map(stage => stage.id))
          removedStageIds = new Set(parseCultivationStages(current.stages)
            .map(stage => stage.id)
            .filter(stageId => !nextIds.has(stageId)))
        }
        const next = { ...patch, updatedAt: now() }
        await db.transaction('rw', transactionTablesForReferences('cultivationSystems'), async () => {
          await db.cultivationSystems.update(id, next)
          await clearRemovedCultivationStageReferences(current.projectId, id, removedStageIds)
          if (patch.stages !== undefined) {
            await refreshCultivationProgressStageSources({
              projectId: current.projectId,
              systemId: id,
              previousStages: current.stages,
              nextStages: patch.stages,
            })
          }
        })
        await refreshSettingAssertionSourceStatus({
          projectId: current.projectId,
          table: 'cultivationSystems',
          recordId: id,
          changedFields: Object.keys(patch),
        })
        set({ systems: get().systems.map(system => system.id === id ? { ...system, ...next } : system) })
      },
    })
  },

  deleteSystem: async (id) => {
    const beforeMigration = get().systems.find(system => system.id === id) ?? await db.cultivationSystems.get(id)
    if (!beforeMigration) return
    const scope = await resolveScopeLike(beforeMigration.projectId)
    const current = await db.cultivationSystems.get(id)
    if (!current || !await assertRecordInScope(scope, 'cultivationSystems', current, { owner: 'world' })) return
    await db.transaction('rw', transactionTablesForReferences('cultivationSystems'), async () => {
      await clearCultivationSystemReferences(current.projectId, new Set([id]))
      await db.cultivationSystems.delete(id)
    })
    set({ systems: get().systems.filter(system => system.id !== id) })
  },
}))
