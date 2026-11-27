import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type {
  CharacterDrivenPlan,
  CharacterDrivenPlanArc,
  CharacterDrivenPlotVolume,
  Work,
} from '../lib/types'
import {
  parseCharacterDrivenPlanArcs,
  parseCharacterDrivenPlotVolumes,
  stringifyCharacterDrivenPlanArcs,
  stringifyCharacterDrivenPlotVolumes,
} from '../lib/types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  scopeTransactionTables,
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'
import type { WorkspaceScope } from '../lib/types/world-ownership'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { assertCharacterDrivenInputSourceV1, assertCharacterDrivenInputExpectedV1, assertCharacterDrivenInputWrittenV1, type CharacterDrivenInputSaveV1 } from '../lib/authoring/character-driven-input-save'

interface SavePlanInputs {
  (id: number, input: { arcs: CharacterDrivenPlanArc[]; userHint: string }): Promise<void>
  (id: number, input: { arcs: CharacterDrivenPlanArc[]; userHint: string }, confirmation: CharacterDrivenInputSaveV1): Promise<CharacterDrivenPlan>
}

interface CharacterDrivenPlanStore {
  plans: CharacterDrivenPlan[]
  currentPlanId: number | null
  activePlanId: number | null
  loading: boolean
  loadedScope: WorkspaceScope | null

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  selectPlan: (id: number | null) => void
  createPlan: (projectId: number, name?: string) => Promise<number>
  copyAsNewVersion: (id: number) => Promise<number>
  renamePlan: (id: number, name: string) => Promise<void>
  saveInputs: SavePlanInputs
  saveGenerated: (id: number, volumes: CharacterDrivenPlotVolume[]) => Promise<void>
  markAdopted: (id: number) => Promise<void>
  setActivePlan: (projectId: number, id: number | null) => Promise<void>
  deletePlan: (id: number) => Promise<void>
}

const now = () => Date.now()
let loadSequence = 0, inputWriteRevision = 0
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId

function updatedPlan(
  plan: CharacterDrivenPlan,
  patch: Partial<CharacterDrivenPlan>,
): CharacterDrivenPlan {
  return { ...plan, ...patch }
}

async function resolveOwnedPlan(id: number): Promise<{
  plan: CharacterDrivenPlan
  scope: WorkspaceScope
} | null> {
  const existingRecord = await db.characterDrivenPlans.get(id)
  if (!existingRecord) return null
  const scope = await resolveScopeLike(existingRecord.projectId)
  const plan = await db.characterDrivenPlans.get(id)
  if (!plan || !await assertRecordInScope(scope, 'characterDrivenPlans', plan, { owner: 'work' })) return null
  return { plan, scope }
}

export const useCharacterDrivenPlanStore = create<CharacterDrivenPlanStore>((set, get) => ({
  plans: [],
  currentPlanId: null,
  activePlanId: null,
  loading: false,
  loadedScope: null,

  loadAll: async (scopeInput) => {
    const request = ++loadSequence
    set({ loading: true })
    try {
    const scope = await resolveReadScopeLike(typeof scopeInput === 'number' ? scopeInput : { ...scopeInput })
    let plans: CharacterDrivenPlan[] = [], observed = -1, work: Work | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      observed = inputWriteRevision
      ;[plans, work] = await Promise.all([readOwnedRows<CharacterDrivenPlan>(scope, 'characterDrivenPlans', { owner: 'work' }), db.works.get(scope.workId)])
      if (request !== loadSequence) return
      if (observed === inputWriteRevision) break
    }
    if (observed !== inputWriteRevision) throw new Error('读取期间方案持续变化，请重新读取。')
    if (request !== loadSequence) return
    plans.sort((left, right) => right.updatedAt - left.updatedAt)
    const current = get().currentPlanId
    const activeCandidate = work?.activeCharacterDrivenPlanId
    const active = plans.some(plan => plan.id === activeCandidate)
      ? activeCandidate ?? null
      : null
    set({
      plans,
      currentPlanId: plans.some(plan => plan.id === current)
        ? current
        : (active ?? plans[0]?.id ?? null),
      activePlanId: active,
      loading: false,
      loadedScope: scope,
    })
    } catch (cause) { if (request === loadSequence) set({ loading: false }); throw cause }
  },

  selectPlan: id => set({ currentPlanId: id }),

  createPlan: async (projectId, name) => {
    const ts = now()
    const plan = stampNewRecord(await resolveScopeLike(projectId), 'characterDrivenPlans', {
      projectId,
      name: name?.trim() || `角色驱动方案 ${get().plans.length + 1}`,
      arcs: '[]',
      userHint: '',
      generatedVolumes: '[]',
      status: 'draft',
      version: 1,
      parentPlanId: null,
      createdAt: ts,
      updatedAt: ts,
    } as CharacterDrivenPlan, { owner: 'work' }) as CharacterDrivenPlan
    const id = await db.characterDrivenPlans.add(plan) as number
    set({ plans: [{ ...plan, id }, ...get().plans], currentPlanId: id })
    return id
  },

  copyAsNewVersion: async (id) => {
    const resolved = await resolveOwnedPlan(id)
    if (!resolved?.plan.id) throw new Error('来源方案不存在或不属于当前作品')
    const { plan: source, scope } = resolved
    const ts = now()
    const version = Math.max(1, source.version) + 1
    const copy = stampNewRecord(scope, 'characterDrivenPlans', {
      ...source,
      id: undefined,
      // A copied plan is a new Canon resource. Never inherit the source's
      // portable identity; stampNewRecord must allocate a fresh one.
      ragDocumentId: undefined,
      name: `${source.name} v${version}`,
      arcs: stringifyCharacterDrivenPlanArcs(parseCharacterDrivenPlanArcs(source.arcs)),
      generatedVolumes: stringifyCharacterDrivenPlotVolumes(
        parseCharacterDrivenPlotVolumes(source.generatedVolumes),
      ),
      status: source.status === 'adopted' ? 'generated' : source.status,
      version,
      parentPlanId: source.id,
      createdAt: ts,
      updatedAt: ts,
    } as CharacterDrivenPlan, { owner: 'work' }) as CharacterDrivenPlan
    const newId = await db.characterDrivenPlans.add(copy) as number
    set({ plans: [{ ...copy, id: newId }, ...get().plans], currentPlanId: newId })
    return newId
  },

  renamePlan: async (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (!await resolveOwnedPlan(id)) return
    const updatedAt = now()
    await db.characterDrivenPlans.update(id, { name: trimmed, updatedAt })
    set({ plans: get().plans.map(plan => plan.id === id ? updatedPlan(plan, { name: trimmed, updatedAt }) : plan) })
  },

  saveInputs: ((id: number, payload: { arcs: CharacterDrivenPlanArc[]; userHint: string }, confirmation?: CharacterDrivenInputSaveV1) => {
    const input = structuredClone(payload), proof = confirmation ? structuredClone(confirmation) : undefined
    const selected = proof ? resolveScopeLike(proof.scope) : resolveOwnedPlan(id).then(resolved => {
      if (!resolved) throw new Error('方案不存在或不属于当前作品')
      return resolved.scope
    })
    void selected.catch(() => undefined)
    return coordinatePendingEditV1({ key: `character-driven-inputs:${id}`, persist: async () => {
      const scope = await selected
      const parsed = parseCharacterDrivenPlanArcs(input.arcs)
      if (typeof input.userHint !== 'string') throw new Error('方案作者要求必须是原文。')
      const saved = await db.transaction('rw', scopeTransactionTables(db.characterDrivenPlans, db.characters), async transaction => {
      const table = transaction.table<CharacterDrivenPlan, number>('characterDrivenPlans'), current = await table.get(id)
      await resolveScopeLike(scope)
      if (!current || !await assertRecordInScope(scope, 'characterDrivenPlans', current, { owner: 'work' })) throw new Error('方案不存在或不属于当前作品')
      if (proof) { await assertCharacterDrivenInputSourceV1(current, scope); assertCharacterDrivenInputExpectedV1(current, proof.expected) }
      const characters = await transaction.table('characters').toArray(), validCharacterIds = new Set<number>()
      for (const character of characters) if (await assertRecordInScope(scope, 'characters', character, { owner: 'world' })) validCharacterIds.add(character.id)
      const normalizedArcs = parsed.map(arc => ({
        ...arc,
        characterId: arc.characterId != null && validCharacterIds.has(arc.characterId)
          ? arc.characterId
          : null,
      }))
      const patch: Partial<CharacterDrivenPlan> = {
        arcs: stringifyCharacterDrivenPlanArcs(normalizedArcs),
        userHint: input.userHint,
        status: 'draft',
        updatedAt: Math.max(now(), current.updatedAt + 1),
      }
      if (await db.characterDrivenPlans.update.bind(table)(id, patch) !== 1) throw new Error('方案输入写入0行，草稿已保留。')
      const actual = await table.get(id)
      if (!actual || !await assertRecordInScope(scope, 'characterDrivenPlans', actual, { owner: 'work' })) throw new Error('方案提交后归属异常，草稿已保留。')
      assertCharacterDrivenInputWrittenV1(actual, current, normalizedArcs, input.userHint)
      return actual
      })
      const revision = ++inputWriteRevision
      let actual: CharacterDrivenPlan
      try {
        const read = await db.characterDrivenPlans.get(id)
        if (!read || !await assertRecordInScope(scope, 'characterDrivenPlans', read, { owner: 'work' })) throw new Error('方案提交后归属异常。')
        assertCharacterDrivenInputWrittenV1(read, saved, parseCharacterDrivenPlanArcs(saved.arcs), input.userHint)
        actual = read
      } catch (cause) {
        throw Object.assign(new Error('方案输入已提交，但尚未确认回读；输入已保留，请显式重试。'), { cause, committedCharacterDrivenInputsV1: saved })
      }
      if ((sameWork(get().loadedScope, scope) || !get().loadedScope && get().plans.some(plan => plan.id === id && Reflect.get(plan, 'workId') === scope.workId))
        && revision === inputWriteRevision) set({ plans: get().plans.map(plan => plan.id === id ? actual : plan) })
      return proof ? actual : undefined
    } })
  }) as SavePlanInputs,

  saveGenerated: async (id, volumes) => {
    if (!await resolveOwnedPlan(id)) throw new Error('方案不存在或不属于当前作品')
    const parsed = parseCharacterDrivenPlotVolumes(volumes)
    if (parsed.length === 0) throw new Error('生成结果没有可保存的有效卷')
    const patch: Partial<CharacterDrivenPlan> = {
      generatedVolumes: stringifyCharacterDrivenPlotVolumes(parsed),
      status: 'generated',
      updatedAt: now(),
    }
    await db.characterDrivenPlans.update(id, patch)
    set({ plans: get().plans.map(plan => plan.id === id ? updatedPlan(plan, patch) : plan) })
  },

  markAdopted: async (id) => {
    if (!await resolveOwnedPlan(id)) return
    const patch: Partial<CharacterDrivenPlan> = { status: 'adopted', updatedAt: now() }
    await db.characterDrivenPlans.update(id, patch)
    set({ plans: get().plans.map(plan => plan.id === id ? updatedPlan(plan, patch) : plan) })
  },

  setActivePlan: async (projectId, id) => {
    const scope = await resolveScopeLike(projectId)
    if (id != null) {
      const plan = await db.characterDrivenPlans.get(id)
      if (!plan || !await assertRecordInScope(scope, 'characterDrivenPlans', plan, { owner: 'work' })) {
        throw new Error('不能激活其它作品的角色驱动方案')
      }
    }
    const updatedAt = now()
    await db.transaction('rw', db.works, async () => {
      await db.works.update(scope.workId, { activeCharacterDrivenPlanId: id, updatedAt })
    })
    set({ activePlanId: id })
  },

  deletePlan: async (id) => {
    const resolved = await resolveOwnedPlan(id)
    if (!resolved?.plan.id) return
    const { scope } = resolved
    const updatedAt = now()
    await db.transaction('rw', db.characterDrivenPlans, db.works, async () => {
      const children = (await readOwnedRows<CharacterDrivenPlan>(scope, 'characterDrivenPlans', { owner: 'work' }))
        .filter(child => child.parentPlanId === id)
      if (children.length) {
        await db.characterDrivenPlans.bulkUpdate(children.map(child => ({
          key: child.id!,
          changes: { parentPlanId: null, updatedAt },
        })))
      }
      const work = await db.works.get(scope.workId)
      if (work?.activeCharacterDrivenPlanId === id) {
        await db.works.update(scope.workId, { activeCharacterDrivenPlanId: null, updatedAt })
      }
      await db.characterDrivenPlans.delete(id)
    })
    const remaining = get().plans
      .filter(item => item.id !== id)
      .map(item => item.parentPlanId === id ? updatedPlan(item, { parentPlanId: null, updatedAt }) : item)
    set({
      plans: remaining,
      currentPlanId: get().currentPlanId === id ? (remaining[0]?.id ?? null) : get().currentPlanId,
      activePlanId: get().activePlanId === id ? null : get().activePlanId,
    })
  },
}))
