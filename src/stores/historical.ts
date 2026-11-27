import { cascadeRegisteredReferences } from '../lib/workspace/lifecycle'
import { transactionTablesForReferenceCascade } from '../lib/registry/lifecycle'
import { create } from 'zustand'
import Dexie from 'dexie'
import { db } from '../lib/db/schema'
import type { HistoricalTimelineEvent, HistoricalKeyword, WorldOwnerScope } from '../lib/types'
import {
  assertRecordInScope,
  getTableSpec,
  readOwnedRows,
  resolveWorldOwnerScopeLike,
  resolveScopeLike,
  scopeTransactionTables,
  stampNewRecord,
  type WorldOwnerScopeLike,
} from '../lib/workspace/scope'

import { assertHistoryTextSaveExpectedV1, historyTextSaveAckV1, historyTextSaveRequestV1, readHistoryTextSaveAckV1 } from '../lib/authoring/history-local-save-evidence'
import type { LocalSaveAckV1, LocalSaveIntentV1 } from '../lib/authoring/local-save-evidence'

interface HistoricalTextUpdateV1<T> {
  (id: number, patch: Partial<T>, scope?: WorldOwnerScopeLike): Promise<void>
  (id: number, patch: Partial<T>, scope: WorldOwnerScopeLike, confirmation: LocalSaveIntentV1): Promise<LocalSaveAckV1>
}
interface HistoricalStore {
  events: HistoricalTimelineEvent[]
  keywords: HistoricalKeyword[]
  loading: boolean
  loadedEventsScope: WorldOwnerScope | null
  loadingKeywords: boolean

  // ── 历史时间线事件 ──
  /** 加载某个项目的所有历史时间线事件（按数字化年份 year 升序排序） */
  loadEvents: (scope: WorldOwnerScopeLike) => Promise<void>
  /** 添加历史事件 */
  addEvent: (event: Omit<HistoricalTimelineEvent, 'createdAt' | 'updatedAt'>, scope?: WorldOwnerScopeLike) => Promise<number>
  /** 更新历史事件 */
  updateEvent: HistoricalTextUpdateV1<HistoricalTimelineEvent>
  /** 删除历史事件 */
  deleteEvent: (id: number) => Promise<void>

  // ── 历史关键词与细节 ──
  /** 加载某个项目的所有历史关键词 */
  loadKeywords: (scope: WorldOwnerScopeLike) => Promise<void>
  /** 添加历史关键词 */
  addKeyword: (keyword: Omit<HistoricalKeyword, 'createdAt' | 'updatedAt'>) => Promise<number>
  /** 更新历史关键词 */
  updateKeyword: HistoricalTextUpdateV1<HistoricalKeyword>
  /** 删除历史关键词 */
  deleteKeyword: (id: number) => Promise<void>
}

function confirmedTextUpdateV1(table: 'historicalTimelineEvents' | 'historicalKeywords', id: number,
  patch: Record<string, unknown>, scope: WorldOwnerScopeLike | undefined, confirmation?: LocalSaveIntentV1) {
  if (!confirmation) return undefined
  if (Dexie.currentTransaction) throw new Error('历史本机保存确认需要独立提交。')
  const proof = historyTextSaveRequestV1(patch, confirmation)
  if (typeof scope !== 'object' || proof.identity.table !== table || !('recordId' in proof.identity)
    || proof.identity.recordId !== id || proof.identity.projectId !== scope.projectId || proof.identity.worldId !== scope.worldId)
    throw new Error('历史保存记录或作用域凭据无效。')
  return proof
}

const sameWorld = (left: WorldOwnerScope | null, right: WorldOwnerScope) => left?.projectId === right.projectId && left.worldId === right.worldId
let eventLoadSequence = 0

const eventIdentityFields = new Set(['id', 'projectId', 'worldId', 'workId', 'createdAt',
  getTableSpec('historicalTimelineEvents').resourceIdentity!.field])

function assertEventIdentityUnchanged(event: HistoricalTimelineEvent, patch: Partial<HistoricalTimelineEvent>): void {
  for (const [key, value] of Object.entries(patch)) {
    // Dexie.update also accepts dot paths such as resourceUid.suffix.
    const field = key.split('.')[0]
    if (eventIdentityFields.has(field) && (key !== field || value !== Reflect.get(event, field))) {
      throw new Error('历史事件的身份与归属不可通过编辑更改')
    }
  }
}

// This cache belongs to the currently selected history view, not to whichever
// author operation finishes last. Reuse the stores' owner/load-sequence pattern.
async function publishEvents(scope: WorldOwnerScope, request: number, get: () => HistoricalStore, set: (patch: Partial<HistoricalStore>) => void): Promise<void> {
  try {
    const events = (await readOwnedRows<HistoricalTimelineEvent>(scope, 'historicalTimelineEvents', { owner: 'world' }))
      .sort((left, right) => left.year - right.year)
    const project = await db.projects.get(scope.projectId)
    if (request !== eventLoadSequence || !sameWorld(get().loadedEventsScope, scope)) return
    if (project?.activeWorldId !== scope.worldId) {
      set({ events: [], loadedEventsScope: null, loading: false })
      return
    }
    set({ events, loading: false })
  } catch (error) {
    if (request === eventLoadSequence && sameWorld(get().loadedEventsScope, scope)) {
      console.error('[HistoricalStore] loadEvents failed:', error)
      set({ events: [], loadedEventsScope: null, loading: false })
    }
  }
}

// Author writes may be nested in a caller's larger atomic operation. Do not
// publish (or invalidate an older committed refresh) until the native root commits.
async function refreshEvents(scope: WorldOwnerScope, get: () => HistoricalStore, set: (patch: Partial<HistoricalStore>) => void): Promise<void> {
  if (!sameWorld(get().loadedEventsScope, scope)) return
  let transaction = Dexie.currentTransaction
  while (transaction?.parent) transaction = transaction.parent
  if (transaction?.db === db && transaction.mode === 'readwrite' && transaction.active) {
    const selectedRequest = eventLoadSequence
    transaction.on('complete', () => {
      if (selectedRequest === eventLoadSequence && sameWorld(get().loadedEventsScope, scope)) {
        void Dexie.ignoreTransaction(() => refreshEvents(scope, get, set))
      }
    })
    return
  }
  await publishEvents(scope, ++eventLoadSequence, get, set)
}

export const useHistoricalStore = create<HistoricalStore>((set, get) => ({
  events: [],
  keywords: [],
  loading: false,
  loadedEventsScope: null,
  loadingKeywords: false,

  // ── 历史时间线事件 ──
  loadEvents: async (scopeInput) => {
    const request = ++eventLoadSequence
    set({ events: [], loadedEventsScope: null, loading: true })
    try {
      const scope = await resolveWorldOwnerScopeLike(scopeInput)
      if (request !== eventLoadSequence) return
      set({ loadedEventsScope: scope })
      await publishEvents(scope, request, get, set)
    } catch (error) {
      if (request === eventLoadSequence) {
        console.error('[HistoricalStore] loadEvents failed:', error)
        set({ events: [], loadedEventsScope: null, loading: false })
      }
    }
  },

  addEvent: async (event, scopeInput) => {
    const { id, scope } = await db.transaction('rw', scopeTransactionTables(db.historicalTimelineEvents), async () => {
      const scope = await resolveWorldOwnerScopeLike(scopeInput ?? event.projectId)
      const now = Date.now()
      const row = stampNewRecord(scope, 'historicalTimelineEvents', { ...event, createdAt: now, updatedAt: now }, { owner: 'world' })
      return { id: await db.historicalTimelineEvents.add(row), scope }
    })
    await refreshEvents(scope, get, set)
    return id
  },

  updateEvent: (async (id: number, patch: Partial<HistoricalTimelineEvent>, scopeInput?: WorldOwnerScopeLike, intent?: LocalSaveIntentV1) => {
    patch = { ...patch }
    const confirmation = intent ? structuredClone(intent) : undefined
    const proof = confirmedTextUpdateV1('historicalTimelineEvents', id, patch, scopeInput, confirmation)
    const selectedScope = typeof scopeInput === 'object' ? { ...scopeInput } : scopeInput
    const shown = get().events.find(event => event.id === id)
    const scope = await db.transaction('rw', scopeTransactionTables(db.historicalTimelineEvents), async () => {
      const transaction = Dexie.currentTransaction!
      const table = transaction.table<HistoricalTimelineEvent, number>('historicalTimelineEvents')
      const event = await table.get(id)
      if (!event) {
        if (selectedScope != null) throw new Error('历史事件已不存在，输入已保留')
        return
      }
      const owner = await resolveWorldOwnerScopeLike(selectedScope ?? shown?.projectId ?? event.projectId)
      if (!await assertRecordInScope(owner, 'historicalTimelineEvents', event, { owner: 'world' })) {
        if (selectedScope != null) throw new Error('历史事件不属于打开编辑时的世界，输入已保留')
        return
      }
      if (confirmation) await Dexie.waitFor(assertHistoryTextSaveExpectedV1(event, confirmation, transaction))
      const changes = { ...patch, updatedAt: Date.now() }
      assertEventIdentityUnchanged(event, changes)
      if (await table.update(id, changes) !== 1) throw new Error('历史事件保存未完成，输入已保留')
      if (confirmation && proof) await Dexie.waitFor(historyTextSaveAckV1(await table.get(id), confirmation, proof.raw))
      return owner
    })
    const ack = confirmation && proof ? await readHistoryTextSaveAckV1(confirmation, proof.raw) : undefined
    if (scope) await refreshEvents(scope, get, set)
    return ack
  }) as HistoricalTextUpdateV1<HistoricalTimelineEvent>,

  deleteEvent: async (id) => {
    const tables = scopeTransactionTables(...transactionTablesForReferenceCascade('historicalTimelineEvents'))
    const scope = await db.transaction('rw', tables, async () => {
      const event = await db.historicalTimelineEvents.get(id)
      if (!event) return
      const owner = await resolveWorldOwnerScopeLike(event.projectId)
      if (!await assertRecordInScope(owner, 'historicalTimelineEvents', event, { owner: 'world' })) return
      await cascadeRegisteredReferences('historicalTimelineEvents', id)
      await db.historicalTimelineEvents.delete(id)
      return owner
    })
    if (scope) await refreshEvents(scope, get, set)
  },

  // ── 历史关键词与细节 ──
  loadKeywords: async (scopeInput) => {
    set({ loadingKeywords: true })
    try {
      const scope = await resolveWorldOwnerScopeLike(scopeInput)
      const keywords = (await readOwnedRows<HistoricalKeyword>(
        scope,
        'historicalKeywords',
        { owner: 'world' },
      )).sort((left, right) => right.updatedAt - left.updatedAt)
      set({ keywords, loadingKeywords: false })
    } catch (err) {
      console.error('[HistoricalStore] loadKeywords failed:', err)
      set({ loadingKeywords: false })
    }
  },

  addKeyword: async (keyword) => {
    const now = Date.now()
    const row = stampNewRecord(
      await resolveScopeLike(keyword.projectId),
      'historicalKeywords',
      { ...keyword, createdAt: now, updatedAt: now },
      { owner: 'world' },
    ) as HistoricalKeyword
    const id = await db.historicalKeywords.add(row) as number
    await get().loadKeywords(keyword.projectId)
    return id
  },

  updateKeyword: (async (id: number, patch: Partial<HistoricalKeyword>, scopeInput?: WorldOwnerScopeLike, intent?: LocalSaveIntentV1) => {
    patch = { ...patch }
    const confirmation = intent ? structuredClone(intent) : undefined
    const proof = confirmedTextUpdateV1('historicalKeywords', id, patch, scopeInput, confirmation)
    // Existing callers keep their lookup API. Text editors supply their frozen
    // World owner so a late save cannot follow a newly selected active World.
    const selectedScope = typeof scopeInput === 'object' ? { ...scopeInput } : scopeInput
    if (selectedScope != null) {
      const next = await db.transaction('rw', scopeTransactionTables(db.historicalKeywords), async () => {
        const transaction = Dexie.currentTransaction!
        const table = transaction.table<HistoricalKeyword, number>('historicalKeywords')
        const scope = await resolveWorldOwnerScopeLike(selectedScope)
        const current = await table.get(id)
        if (!current) throw new Error('历史关键词已不存在，输入已保留')
        if (!await assertRecordInScope(scope, 'historicalKeywords', current, { owner: 'world' })) {
          throw new Error('历史关键词不属于打开编辑时的世界，输入已保留')
        }
        const immutable = new Set(['id', 'projectId', 'worldId', 'workId', 'createdAt', getTableSpec('historicalKeywords').resourceIdentity?.field])
        for (const [key, value] of Object.entries(patch)) {
          if (immutable.has(key.split('.')[0]) && (key.includes('.') || value !== Reflect.get(current, key))) {
            throw new Error('历史关键词的身份与归属不可通过编辑更改')
          }
        }
        if (confirmation) await Dexie.waitFor(assertHistoryTextSaveExpectedV1(current, confirmation, transaction))
        const changes = { ...patch, updatedAt: Date.now() }
        if (await table.update(id, changes) !== 1) throw new Error('历史关键词保存未完成，输入已保留')
        if (confirmation && proof) await Dexie.waitFor(historyTextSaveAckV1(await table.get(id), confirmation, proof.raw))
        return changes
      })
      const ack = confirmation && proof ? await readHistoryTextSaveAckV1(confirmation, proof.raw) : undefined
      set({ keywords: get().keywords.map(row => row.id === id ? { ...row, ...next } : row).sort((a, b) => b.updatedAt - a.updatedAt) })
      return ack
    }
    const existingRecord = get().keywords.find(keyword => keyword.id === id)
      ?? await db.historicalKeywords.get(id)
    if (!existingRecord) return
    const scope = await resolveScopeLike(existingRecord.projectId)
    const current = await db.historicalKeywords.get(id)
    if (!current || !await assertRecordInScope(scope, 'historicalKeywords', current, { owner: 'world' })) return
    const now = Date.now()
    const next = {
      ...patch,
      updatedAt: now,
    }
    await db.historicalKeywords.update(id, next)
    // 同步内存并重新按更新时间排序
    const keywords = get().keywords.map(k => k.id === id ? { ...k, ...next } as HistoricalKeyword : k)
    keywords.sort((a, b) => b.updatedAt - a.updatedAt)
    set({ keywords })
  }) as HistoricalTextUpdateV1<HistoricalKeyword>,

  deleteKeyword: async (id) => {
    const existingRecord = await db.historicalKeywords.get(id)
    if (!existingRecord) return
    const scope = await resolveScopeLike(existingRecord.projectId)
    const keyword = await db.historicalKeywords.get(id)
    if (!keyword || !await assertRecordInScope(scope, 'historicalKeywords', keyword, { owner: 'world' })) return
    await db.historicalKeywords.delete(id)
    await get().loadKeywords(keyword.projectId)
  },
}))
