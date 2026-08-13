import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type {
  CharacterDrivenPlan,
  CharacterDrivenPlanArc,
  CharacterDrivenPlotVolume,
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
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/world-engine/scope'
import type { WorkspaceScope } from '../lib/types/world-ownership'

interface CharacterDrivenPlanStore {
  plans: CharacterDrivenPlan[]
  currentPlanId: number | null
  activePlanId: number | null
  loading: boolean

  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  selectPlan: (id: number | null) => void
  createPlan: (projectId: number, name?: string) => Promise<number>
  copyAsNewVersion: (id: number) => Promise<number>
  renamePlan: (id: number, name: string) => Promise<void>
  saveInputs: (
    id: number,
    input: { arcs: CharacterDrivenPlanArc[]; userHint: string },
  ) => Promise<void>
  saveGenerated: (id: number, volumes: CharacterDrivenPlotVolume[]) => Promise<void>
  markAdopted: (id: number) => Promise<void>
  setActivePlan: (projectId: number, id: number | null) => Promise<void>
  deletePlan: (id: number) => Promise<void>
}

const now = () => Date.now()
const inputSaveChains = new Map<number, Promise<void>>()

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
  const beforeMigration = await db.characterDrivenPlans.get(id)
  if (!beforeMigration) return null
  const scope = await resolveScopeLike(beforeMigration.projectId)
  const plan = await db.characterDrivenPlans.get(id)
  if (!plan || !await assertRecordInScope(scope, 'characterDrivenPlans', plan, { owner: 'work' })) return null
  return { plan, scope }
}

export const useCharacterDrivenPlanStore = create<CharacterDrivenPlanStore>((set, get) => ({
  plans: [],
  currentPlanId: null,
  activePlanId: null,
  loading: false,

  loadAll: async (scopeInput) => {
    set({ loading: true })
    const scope = await resolveReadScopeLike(scopeInput)
    const [plans, project, work] = await Promise.all([
      readOwnedRows<CharacterDrivenPlan>(scope, 'characterDrivenPlans', { owner: 'work' })
        .then(rows => rows.sort((left, right) => right.updatedAt - left.updatedAt)),
      db.projects.get(scope.projectId),
      scope.workId > 0 ? db.works.get(scope.workId) : undefined,
    ])
    const current = get().currentPlanId
    const activeCandidate = work?.activeCharacterDrivenPlanId ?? project?.activeCharacterDrivenPlanId
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
    })
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

  saveInputs: async (id, input) => {
    const previous = inputSaveChains.get(id) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(async () => {
      const resolved = await resolveOwnedPlan(id)
      if (!resolved) throw new Error('方案不存在或不属于当前作品')
      const { scope } = resolved
      const validCharacterIds = new Set(
        (await readOwnedRows<any>(scope, 'characters', { owner: 'world' }))
          .map(character => character.id)
          .filter((characterId): characterId is number => typeof characterId === 'number'),
      )
      const normalizedArcs = input.arcs.map(arc => ({
        ...arc,
        characterId: arc.characterId != null && validCharacterIds.has(arc.characterId)
          ? arc.characterId
          : null,
      }))
      const patch: Partial<CharacterDrivenPlan> = {
        arcs: stringifyCharacterDrivenPlanArcs(normalizedArcs),
        userHint: input.userHint,
        status: 'draft',
        updatedAt: now(),
      }
      await db.characterDrivenPlans.update(id, patch)
      set({ plans: get().plans.map(plan => plan.id === id ? updatedPlan(plan, patch) : plan) })
    })
    inputSaveChains.set(id, pending)
    try {
      await pending
    } finally {
      if (inputSaveChains.get(id) === pending) inputSaveChains.delete(id)
    }
  },

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
    await db.transaction('rw', db.projects, db.works, async () => {
      await db.works.update(scope.workId, { activeCharacterDrivenPlanId: id, updatedAt })
      await db.projects.update(projectId, { activeCharacterDrivenPlanId: id, updatedAt })
    })
    set({ activePlanId: id })
  },

  deletePlan: async (id) => {
    const resolved = await resolveOwnedPlan(id)
    if (!resolved?.plan.id) return
    const { plan, scope } = resolved
    const updatedAt = now()
    await db.transaction('rw', db.characterDrivenPlans, db.projects, db.works, async () => {
      const children = (await readOwnedRows<CharacterDrivenPlan>(scope, 'characterDrivenPlans', { owner: 'work' }))
        .filter(child => child.parentPlanId === id)
      if (children.length) {
        await db.characterDrivenPlans.bulkUpdate(children.map(child => ({
          key: child.id!,
          changes: { parentPlanId: null, updatedAt },
        })))
      }
      const project = await db.projects.get(plan.projectId)
      if (project?.activeCharacterDrivenPlanId === id) {
        await db.projects.update(plan.projectId, {
          activeCharacterDrivenPlanId: null,
          updatedAt,
        })
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
