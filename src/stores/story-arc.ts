/** Scoped manual story-arc authoring; AI adoption keeps its registered path. */
import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { StoryArc, WorkspaceScope } from '../lib/types'
import { parseStages, stringifyStages, parseAuthorStoryStagesV1, validateAuthorStoryStagesV1, type StoryStage } from '../lib/types/story-arc'
import { deleteStoryArcLifecycle, updateStoryArcStagesLifecycle } from '../lib/storyline/lifecycle'
import { readStoryCoreIntentSnapshotV1, storyArcIntentAlignmentV1, type StoryArcIntentAlignmentV1 } from '../lib/storyline/intent-projection'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScopeLike, scopeTransactionTables, stampNewRecord, type WorkspaceScopeLike } from '../lib/workspace/scope'
import { coordinatePendingEditV1 } from '../lib/authoring/pending-edit-coordinator'
import { FIELD_BY_TARGET } from '../lib/registry/field-registry'
import { transactionTablesForReferenceCascade } from '../lib/registry/lifecycle'

type ArcPatch = Partial<Pick<StoryArc, 'name' | 'description' | 'type'>>
type StagePatch = Partial<Omit<StoryStage, 'id'>>
export type StoryStageEditV1 =
  | { kind: 'patch'; stageId: string; patch: StagePatch; expected?: StagePatch }
  | { kind: 'add'; stage: StoryStage }
  | { kind: 'remove'; stageId: string; expected?: StoryStage }
interface StoryArcStore {
  arcs: StoryArc[]
  intentAlignmentByArcId: Record<number, StoryArcIntentAlignmentV1>
  activeArcId: number | null
  loading: boolean
  loadedScope: WorkspaceScope | null
  loadError: string | null
  loadAll: (scope: WorkspaceScopeLike) => Promise<void>
  setActiveArc: (id: number | null) => void
  addArc: (arc: Omit<StoryArc, 'id' | 'createdAt' | 'updatedAt'>, scope?: WorkspaceScopeLike) => Promise<number>
  updateArc: (id: number, data: ArcPatch, scope?: WorkspaceScopeLike, expected?: ArcPatch) => Promise<void>
  deleteArc: (id: number, scope?: WorkspaceScopeLike) => Promise<void>
  getActiveStages: () => StoryStage[]
  updateStages: (arcId: number, stages: StoryStage[], scope?: WorkspaceScopeLike, expected?: string) => Promise<void>
  editStage: (arcId: number, edit: StoryStageEditV1, scope?: WorkspaceScopeLike) => Promise<void>
  buildStoryArcContext: (currentChapterOrder?: number) => string
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sameWork = (a: WorkspaceScope | null, b: WorkspaceScope) => a?.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId
const authorFields = new Map((FIELD_BY_TARGET.get('storyArcs') ?? []).filter(field => ['name', 'description', 'type'].includes(field.field)).map(field => [field.field, field]))
const stageFields = new Set(['title', 'description', 'startVolume', 'endVolume', 'keyEvents', 'turningPoint'])
let loadSequence = 0
function validatePatch(patch: ArcPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    const spec = authorFields.get(key)
    if (!spec) throw new Error('故事线更新包含身份、归属或未登记的作者字段。')
    if ((['string', 'longtext'].includes(spec.type) && typeof value !== 'string') || (spec.type === 'enum' && !spec.enums?.includes(value as string))) throw new Error(`故事线 ${key} 格式异常。`)
  }
}
function stagesOf(row: StoryArc): StoryStage[] { return parseAuthorStoryStagesV1(row.stages) }
function validateRow(row: StoryArc): StoryArc {
  validatePatch({ name: row.name, type: row.type, ...(row.description === undefined ? {} : { description: row.description }) })
  stagesOf(row)
  return row
}
function captureScope(input: WorkspaceScopeLike | undefined, displayed: WorkspaceScope | null, id: number): Promise<WorkspaceScope> {
  const selected = input ?? displayed
  const promise = selected != null ? resolveScopeLike(typeof selected === 'number' ? selected : { ...selected }) : (async () => {
    const row = await db.storyArcs.get(id)
    const work = row?.workId == null ? undefined : await db.works.get(row.workId)
    if (!row || !work) throw new Error('故事线已删除或作品归属无效，输入未保存。')
    return resolveScopeLike({ projectId: row.projectId, worldId: work.worldId, workId: work.id! })
  })()
  void promise.catch(() => undefined)
  return promise
}
async function ownedRow(scope: WorkspaceScope, id: number): Promise<StoryArc> {
  const row = await db.storyArcs.get(id)
  if (!row || !await assertRecordInScope(scope, 'storyArcs', row, { owner: 'work' })) throw new Error('故事线已删除或不属于原作品，输入未保存。')
  return validateRow(row)
}
async function persistStages(scope: WorkspaceScope, row: StoryArc, stages: StoryStage[]): Promise<StoryArc> {
  validateAuthorStoryStagesV1(stages)
  for (const progress of await db.storylineProgress.where('arcId').equals(row.id!).toArray()) {
    if (!await assertRecordInScope(scope, 'storylineProgress', progress, { owner: 'work' })) throw new Error('故事线进度引用的作品归属异常，修改未保存。')
  }
  await updateStoryArcStagesLifecycle({ arcId: row.id!, stages: stringifyStages(stages), validStageIds: stages.map(stage => stage.id) })
  return ownedRow(scope, row.id!)
}
export const useStoryArcStore = create<StoryArcStore>((set, get) => {
  const publish = (scope: WorkspaceScope, row: StoryArc) => {
    if (!sameWork(get().loadedScope, scope) && (get().loading || get().loadedScope || get().arcs.some(arc => arc.workId !== scope.workId))) return
    set({ loadedScope: scope, arcs: get().arcs.some(arc => arc.id === row.id) ? get().arcs.map(arc => arc.id === row.id ? row : arc) : [...get().arcs, row] })
  }
  return {
    arcs: [], intentAlignmentByArcId: {}, activeArcId: null, loading: false, loadedScope: null, loadError: null,
    loadAll: async input => {
      const request = ++loadSequence
      set({ loading: true, loadError: null })
      try {
        const scope = await resolveReadScopeLike(typeof input === 'number' ? input : { ...input })
        if (request !== loadSequence) return
        if (!sameWork(get().loadedScope, scope)) set({ arcs: [], activeArcId: null, loadedScope: null, intentAlignmentByArcId: {} })
        const [rows, intent] = await Promise.all([readOwnedRows<StoryArc>(scope, 'storyArcs', { owner: 'work' }), readStoryCoreIntentSnapshotV1(scope)])
        if (request !== loadSequence) return
        const arcs = rows.map(validateRow)
        const current = get().activeArcId
        set({ arcs, loadedScope: scope, loading: false, loadError: null,
          activeArcId: arcs.some(arc => arc.id === current) ? current : (arcs.find(arc => arc.type === 'main')?.id ?? arcs[0]?.id ?? null),
          intentAlignmentByArcId: Object.fromEntries(arcs.flatMap(arc => arc.id == null ? [] : [[arc.id, storyArcIntentAlignmentV1(arc, intent)]])) })
      } catch (error) {
        if (request === loadSequence) set({ loading: false, loadError: error instanceof Error ? error.message : '故事线读取失败。' })
      }
    },
    setActiveArc: id => {
      if (id != null && !get().arcs.some(arc => arc.id === id)) return
      set({ activeArcId: id })
    },
    addArc: async (input, scopeInput) => {
      const data = structuredClone(input)
      const selected = scopeInput ?? get().loadedScope ?? data.projectId
      const scope = await resolveScopeLike(typeof selected === 'number' ? selected : { ...selected })
      if (data.projectId !== scope.projectId || (data.workId !== undefined && data.workId !== scope.workId)) throw new Error('新故事线不属于指定作品。')
      const now = Date.now()
      const row = stampNewRecord(scope, 'storyArcs', { ...data, origin: 'manual', status: 'active', createdAt: now, updatedAt: now }, { owner: 'work' }) as StoryArc
      validateRow(row)
      const id = await db.transaction('rw', scopeTransactionTables(db.storyArcs, db.worldGroups), async () => {
        await resolveScopeLike(scope)
        if (data.worldGroupId != null) {
          const group = await db.worldGroups.get(data.worldGroupId)
          if (!group || !await assertRecordInScope(scope, 'worldGroups', group, { owner: 'world' })) throw new Error('故事线的世界分组已删除或不属于原世界。')
        }
        return db.storyArcs.add(row) as Promise<number>
      })
      publish(scope, { ...row, id }); return id
    },
    updateArc: (id, input, scopeInput, inputExpected) => {
      const patch = structuredClone(input)
      const cached = get().arcs.find(arc => arc.id === id)
      const expected = structuredClone(inputExpected ?? (cached ? Object.fromEntries(Object.keys(patch).map(key => [key, cached[key as keyof StoryArc]])) : {}))
      const captured = captureScope(scopeInput, get().loadedScope, id)
      return coordinatePendingEditV1({ key: `story-arc:${id}`, persist: async () => {
        const scope = await captured; validatePatch(patch)
        const saved = await db.transaction('rw', scopeTransactionTables(db.storyArcs), async () => {
          const row = await ownedRow(scope, id)
          for (const key of Object.keys(patch)) if (Object.prototype.hasOwnProperty.call(expected, key) && !equal(row[key as keyof StoryArc], expected[key as keyof typeof expected])) throw new Error('故事线已被另一页面修改，输入已保留。')
          if (await db.storyArcs.update(id, { ...patch, updatedAt: Date.now() }) !== 1) throw new Error('故事线写入0行，输入未保存。')
          return ownedRow(scope, id)
        })
        publish(scope, saved)
      } })
    },
    deleteArc: async (id, scopeInput) => {
      const scope = await captureScope(scopeInput, get().loadedScope, id)
      await db.transaction('rw', scopeTransactionTables(...transactionTablesForReferenceCascade('storyArcs')), async () => { await ownedRow(scope, id); await deleteStoryArcLifecycle(id) })
      if (!sameWork(get().loadedScope, scope)) return
      const arcs = get().arcs.filter(arc => arc.id !== id)
      set({ arcs, activeArcId: get().activeArcId === id ? (arcs[0]?.id ?? null) : get().activeArcId })
    },
    getActiveStages: () => { const arc = get().arcs.find(row => row.id === get().activeArcId); return arc ? stagesOf(arc) : [] },
    updateStages: (id, input, scopeInput, expectedInput) => {
      const stages = structuredClone(input)
      const expected = expectedInput ?? get().arcs.find(arc => arc.id === id)?.stages
      const captured = captureScope(scopeInput, get().loadedScope, id)
      return coordinatePendingEditV1({ key: `story-arc:${id}`, persist: async () => {
        const scope = await captured
        const saved = await db.transaction('rw', scopeTransactionTables(db.storyArcs, db.storylineProgress), async () => {
          const row = await ownedRow(scope, id)
          if (expected !== undefined && row.stages !== expected) throw new Error('故事阶段已被另一页面修改，请保留输入后重读。')
          return persistStages(scope, row, stages)
        })
        publish(scope, saved)
      } })
    },
    editStage: (id, input, scopeInput) => {
      const edit = structuredClone(input); const captured = captureScope(scopeInput, get().loadedScope, id)
      return coordinatePendingEditV1({ key: `story-arc:${id}`, persist: async () => {
        const scope = await captured
        const saved = await db.transaction('rw', scopeTransactionTables(db.storyArcs, db.storylineProgress), async () => {
          const row = await ownedRow(scope, id); let stages = stagesOf(row)
          if (edit.kind === 'add') {
            if (stages.some(stage => stage.id === edit.stage.id)) throw new Error('故事阶段标识已存在。')
            stages.push(edit.stage)
          } else {
            const current = stages.find(stage => stage.id === edit.stageId)
            if (!current) throw new Error('故事阶段已删除，输入未保存。')
            if (edit.kind === 'remove') {
              if (edit.expected && !equal(current, edit.expected)) throw new Error('故事阶段已被修改，删除未执行。')
              stages = stages.filter(stage => stage.id !== edit.stageId)
            } else {
              for (const key of Object.keys(edit.patch)) {
                if (!stageFields.has(key)) throw new Error('故事阶段包含身份或未知作者字段。')
                if (edit.expected && Object.prototype.hasOwnProperty.call(edit.expected, key) && !equal(current[key as keyof StoryStage], edit.expected[key as keyof StagePatch])) throw new Error('故事阶段字段已被另一页面修改，输入已保留。')
              }
              stages = stages.map(stage => stage.id === current.id ? { ...stage, ...edit.patch } : stage)
            }
          }
          return persistStages(scope, row, stages)
        })
        publish(scope, saved)
      } })
    },
  buildStoryArcContext: (currentChapterOrder?: number) => {
    const arcs = get().arcs.filter(arc => arc.status !== 'deprecated')
    if (!arcs.length) return ''

    const parts: string[] = ['【全局故事线】']

    for (const arc of arcs) {
      const stages = parseStages(arc.stages)
      if (!stages.length) continue

      const typeLabel = arc.type === 'main' ? '主线' : '支线'
      parts.push(`\n[${typeLabel}] ${arc.name}${arc.description ? `：${arc.description}` : ''}`)

      for (let i = 0; i < stages.length; i++) {
        const s = stages[i]
        // 标注当前所处阶段
        const marker = ''
        if (currentChapterOrder !== undefined && s.startVolume !== undefined && s.endVolume !== undefined) {
          // 简化：暂用卷序号近似
        }
        const eventsStr = s.keyEvents.length > 0 ? ` | 关键事件：${s.keyEvents.join('、')}` : ''
        const tpStr = s.turningPoint ? ` | 转折：${s.turningPoint}` : ''
        parts.push(`  ${i + 1}. ${s.title}${marker}：${s.description}${eventsStr}${tpStr}`)
      }
    }

    return parts.join('\n')
  },
  }
})
