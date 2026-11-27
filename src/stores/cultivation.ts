import { create } from 'zustand'
import Dexie from 'dexie'
import { isPortableResourceUidV1 } from '../lib/context-gateway/resource-uid'
import type { WorkspaceScope } from '../lib/types'
import type { LocalSaveIntentV1, LocalSaveAckV1 } from '../lib/authoring/local-save-evidence'
import { recordTextSaveRequestV1, assertRecordTextSaveExpectedV1, recordTextSaveAckV1, type RecordTextRowV1 } from '../lib/authoring/record-text-save-evidence'
import { decodePowerStagesStrictV1, preparePowerAuthoringEditV1, type PowerStageFieldV1 } from '../lib/cultivation/power-authoring-contract'
import { db } from '../lib/db/schema'
import {
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
  scopeTransactionTables,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'

export interface CultivationSaveOptionsV1 {
  scope?: WorkspaceScope
  confirmation?: LocalSaveIntentV1
  expectedStages?: string
  stageEdit?: { stageId: string; patch: Partial<Pick<import('../lib/types/cultivation').CultivationStage, PowerStageFieldV1>> }
}
interface CultivationStore {
  systems: CultivationSystem[]
  loading: boolean
  loadError: string | null
  loadedScope: WorkspaceScope | null
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  addSystem: (system: Omit<CultivationSystem, 'id' | 'createdAt' | 'updatedAt'>, scope?: WorkspaceScope) => Promise<number>
  updateSystem: (id: number, patch: Partial<CultivationSystem>, options?: CultivationSaveOptionsV1) => Promise<void | LocalSaveAckV1>
  deleteSystem: (id: number, scope?: WorkspaceScope) => Promise<void>
}
let readRequest = 0, writeRevision = 0
const sameScope = (left: WorkspaceScope | null, right: WorkspaceScope) => left?.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId

const now = () => Date.now()

export const useCultivationStore = create<CultivationStore>((set, get) => ({
  systems: [],
  loading: false,
  loadError: null, loadedScope: null,

  loadAll: async (input) => {
    const request = ++readRequest
    const target = typeof input === 'object' ? { ...input } : input
    set({ loading: true, loadError: null })
    try {
      const scope = await resolveReadScopeLike(target)
      let systems: CultivationSystem[] = [], observed = -1
      for (let attempt = 0; attempt < 3; attempt++) {
        observed = writeRevision
        systems = await readOwnedRows<CultivationSystem>(scope, 'cultivationSystems', { owner: 'world' })
        if (request !== readRequest) return
        if (observed === writeRevision) break
      }
      if (observed !== writeRevision) throw new Error('读取期间修炼体系持续变化，请重新读取。')
      if (request === readRequest) set({ systems, loadedScope: scope })
    } catch (error) {
      if (request === readRequest) set({ loadError: error instanceof Error ? error.message : String(error) })
      throw error
    } finally { if (request === readRequest) set({ loading: false }) }
  },

  addSystem: async (input, explicitScope) => {
    const system = structuredClone(input), frozenScope = explicitScope ? { ...explicitScope } : undefined
    const validation = validateCultivationStages(decodePowerStagesStrictV1(system.stages))
    if (!validation.valid) throw new Error(validation.errors.join('；'))
    const timestamp = now(), scope = await resolveScopeLike(frozenScope ?? system.projectId)
    if (scope.projectId !== system.projectId) throw new Error('修炼体系工作区不匹配。')
    const row = stampNewRecord(
      scope,
      'cultivationSystems',
      { ...system, createdAt: timestamp, updatedAt: timestamp },
      { owner: 'world' },
    ) as CultivationSystem
    const id = await db.transaction('rw', scopeTransactionTables(db.cultivationSystems, db.worldGroups), async () => {
      if (system.worldGroupId != null && !await assertRecordInScope(scope, 'worldGroups', await db.worldGroups.get(system.worldGroupId), { owner: 'world' })) throw new Error('修炼体系世界组不属于原 World。')
      if (typeof system.name !== 'string' || !system.name.trim() || typeof system.description !== 'string') throw new Error('请填写有效的修炼体系名称和原理。')
      const added = await db.cultivationSystems.add(row) as number
      const written = await db.cultivationSystems.get(added)
      if (!written || !isPortableResourceUidV1(Reflect.get(written, 'ragDocumentId'), 'cultivation-system')
        || !await assertRecordInScope(scope, 'cultivationSystems', written, { owner: 'world' })
        || Object.entries(row).some(([field, value]) => JSON.stringify(Reflect.get(written, field)) !== JSON.stringify(value))) throw new Error('修炼体系创建后原文或身份未能回读。')
      return added
    })
    writeRevision++
    const actual = await db.cultivationSystems.get(id)
    if (!actual || !await assertRecordInScope(scope, 'cultivationSystems', actual, { owner: 'world' }) || actual.stages !== row.stages || actual.name !== row.name || actual.description !== row.description) throw new Error('修炼体系创建后无法确认相同原文。')
    if (sameScope(get().loadedScope, scope)) set({ systems: [...get().systems, actual] })
    return id
  },

  updateSystem: async (id, input, options) => {
    const patch = structuredClone(input), config = options ? structuredClone(options) : undefined
    if (Object.keys(patch).some(field => !['name', 'description', 'stages'].includes(field))) throw new Error('修炼体系更新包含身份或非作者字段。')
    if (Object.values(patch).some(value => typeof value !== 'string')) throw new Error('修炼体系字段必须是原文。')
    if (config?.stageEdit && Object.keys(patch).length) throw new Error('阶段定点编辑不能混入其它字段。')
    if (config?.confirmation && Dexie.currentTransaction) throw new Error('本机保存确认需要独立提交事务。')
    const proof = config?.confirmation
    const request = proof ? recordTextSaveRequestV1('cultivationSystems', id, config?.stageEdit?.patch ?? patch, config?.scope, proof) : undefined
    if (config?.stageEdit && proof && request?.identity.entryId !== config.stageEdit.stageId) throw new Error('阶段保存凭据与原 ID 不一致。')
    if (proof && Boolean(request?.identity.entryId) !== Boolean(config?.stageEdit)) throw new Error('阶段字段凭据与更新方式不一致。')
    const initialRead = db.cultivationSystems.get(id)
    void initialRead.catch(() => undefined)
    const selected = config?.scope ? resolveScopeLike(config.scope) : initialRead.then(row => {
      if (!row) throw new Error('修炼体系已不存在，输入已保留。')
      return resolveScopeLike(row.projectId)
    })
    void selected.catch(() => undefined)
    return coordinatePendingEditV1({ key: `cultivation-system:${id}`, persist: async () => {
      const scope = await selected, initial = await initialRead
      const result = await db.transaction('rw', scopeTransactionTables(...transactionTablesForReferences('cultivationSystems')), () => {
        const transaction = Dexie.currentTransaction!, table = transaction.table<CultivationSystem, number>('cultivationSystems'), update = db.cultivationSystems.update.bind(table)
        return Dexie.waitFor((async () => {
          const current = await table.get(id)
          if (!current || !initial || Reflect.get(current, 'ragDocumentId') !== Reflect.get(initial, 'ragDocumentId')
            || !await assertRecordInScope(scope, 'cultivationSystems', current, { owner: 'world' })) throw new Error('修炼体系已删除或不属于原 World，输入已保留。')
          if (config?.expectedStages !== undefined && current.stages !== config.expectedStages) throw new Error('阶段图谱已被其他页面修改，输入已保留。')
          if (proof) await assertRecordTextSaveExpectedV1(current as unknown as RecordTextRowV1, proof, transaction)
          let write = { ...patch }
          if (config?.stageEdit) {
            let text = current.stages
            const entries = Object.entries(config.stageEdit.patch)
            if (!entries.length) throw new Error('阶段更新为空。')
            for (const [field, value] of entries) text = preparePowerAuthoringEditV1({
              scope: { ...scope, worldGroupId: current.worldGroupId ?? null },
              target: { table: 'cultivationSystems', recordId: id, field: 'stages', stageId: config.stageEdit.stageId, stageField: field as PowerStageFieldV1 },
              snapshot: { table: 'cultivationSystems', record: { ...current, worldId: scope.worldId, stages: text } }, value,
            }).patch.stages
            write = { stages: text }
          }
          if (write.name !== undefined && !write.name.trim()) throw new Error('请填写体系名称，输入已保留。')
          let removed = new Set<string>()
          if (write.stages !== undefined) {
            const next = decodePowerStagesStrictV1(write.stages), before = decodePowerStagesStrictV1(current.stages), ids = new Set(next.map(stage => stage.id))
            removed = new Set(before.map(stage => stage.id).filter(stageId => !ids.has(stageId)))
          }
          if (await update(id, { ...write, updatedAt: now() }) !== 1) throw new Error('修炼体系更新0行，输入已保留。')
          await clearRemovedCultivationStageReferences(current.projectId, id, removed, transaction)
          if (write.stages !== undefined) await refreshCultivationProgressStageSources({ projectId: current.projectId, systemId: id, previousStages: current.stages, nextStages: write.stages }, transaction)
          const actual = await table.get(id)
          if (!actual || Reflect.get(actual, 'ragDocumentId') !== Reflect.get(current, 'ragDocumentId') || !await assertRecordInScope(scope, 'cultivationSystems', actual, { owner: 'world' }) || (actual.worldGroupId ?? null) !== (current.worldGroupId ?? null)
            || Object.entries(write).some(([field, value]) => Reflect.get(actual, field) !== value)) throw new Error('修炼体系精确保存校验失败，输入已保留。')
          if (proof) await recordTextSaveAckV1(actual as unknown as RecordTextRowV1, proof, request!.raw)
          return { actual, write }
        })())
      })
      writeRevision++
      await refreshSettingAssertionSourceStatus({ projectId: scope.projectId, table: 'cultivationSystems', recordId: id, changedFields: Object.keys(result.write) })
      const committed = await db.cultivationSystems.get(id)
      if (!committed || Reflect.get(committed, 'ragDocumentId') !== Reflect.get(result.actual, 'ragDocumentId')
        || !await assertRecordInScope(scope, 'cultivationSystems', committed, { owner: 'world' }) || (committed.worldGroupId ?? null) !== (result.actual.worldGroupId ?? null)
        || Object.entries(result.write).some(([field, value]) => Reflect.get(committed, field) !== value)) throw new Error('修炼体系提交后内容已变化，未确认保存。')
      const ack = proof ? await recordTextSaveAckV1(committed as unknown as RecordTextRowV1, proof, request!.raw) : undefined
      if (sameScope(get().loadedScope, scope)) set({ systems: get().systems.map(system => system.id === id ? committed : system) })
      return ack
    } })
  },

  deleteSystem: async (id, explicitScope) => {
    const frozenScope = explicitScope ? { ...explicitScope } : undefined
    const existingSystem = get().systems.find(system => system.id === id) ?? await db.cultivationSystems.get(id)
    if (!existingSystem) return
    const scope = await resolveScopeLike(frozenScope ?? existingSystem.projectId)
    const current = await db.cultivationSystems.get(id)
    if (!current || !await assertRecordInScope(scope, 'cultivationSystems', current, { owner: 'world' })) return
    await db.transaction('rw', transactionTablesForReferences('cultivationSystems'), async () => {
      await clearCultivationSystemReferences(current.projectId, new Set([id]))
      await db.cultivationSystems.delete(id)
    })
    writeRevision++
    if (sameScope(get().loadedScope, scope)) set({ systems: get().systems.filter(system => system.id !== id) })
  },
}))
