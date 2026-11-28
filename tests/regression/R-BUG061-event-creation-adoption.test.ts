import Dexie from 'dexie'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { adopt } from '../../src/lib/registry/adopt'
import { allocateHistoryEventDraftIdsV1, parseHistoryEventCandidatesV1 } from '../../src/lib/history/event-creation-contract'
import { historyEventCreationTransactionTablesV1, readHistoryEventCreationSnapshotV1 } from '../../src/lib/history/event-creation-adoption'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())
async function fixture() {
  const f = await seedCurrentWorkspace('061 时间轴候选')
  const scope = { ...f.scope, worldGroupId: null }
  const request = { mode: 'from-empty' as const, draftIds: allocateHistoryEventDraftIdsV1(2) }
  const snapshot = await readHistoryEventCreationSnapshotV1(scope, request)
  const events = request.draftIds.map((draftId, index) => ({ draftId, title: `灰潮事件${index}`, era: 'custom', date: `灰潮前${index + 1}旬`, description: `原样过程${index}\n尾空格  `, impact: `影响${index}` }))
  return { ...f, owner: scope, request, snapshot, events }
}
it('keeps model proposals unselected and rejects owner fields, fake identities and model-selected adoption', async () => {
  const f = await fixture(), raw = JSON.stringify({ version: 1, events: f.events })
  expect(parseHistoryEventCandidatesV1(raw, f.request, false).selectedIds).toBeUndefined()
  expect(() => parseHistoryEventCandidatesV1(JSON.stringify({ version: 1, events: f.events, selectedIds: f.request.draftIds }), f.request, false)).toThrow()
  expect(() => parseHistoryEventCandidatesV1(JSON.stringify({ version: 1, events: [{ ...f.events[0], projectId: f.scope.projectId }] }), f.request)).toThrow()
  expect(() => parseHistoryEventCandidatesV1(JSON.stringify({ version: 1, events: [{ ...f.events[0], draftId: allocateHistoryEventDraftIdsV1(1)[0] }] }), f.request)).toThrow('身份')
  await expect(adopt({ target: 'historicalTimelineEvents', mode: 'add-many', historyEventCreation: f.snapshot, data: { version: 1, events: f.events } })).rejects.toThrow('先选择')
  expect(await db.historicalTimelineEvents.count()).toBe(0)
})
it('adds only selected stable candidates once, retains exact prose and relative dates, and uses real World ownership', async () => {
  const f = await fixture(), input = { target: 'historicalTimelineEvents' as const, mode: 'add-many' as const, historyEventCreation: f.snapshot,
    data: { version: 1 as const, events: f.events, selectedIds: [f.events[1].draftId] } }
  const first = await adopt(input), second = await adopt(input)
  expect(second.written).toEqual(first.written)
  const rows = await db.historicalTimelineEvents.toArray()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ title: f.events[1].title, description: f.events[1].description, date: f.events[1].date, year: null, isHistorical: false })
  expect(Reflect.get(rows[0], 'worldId')).toBe(f.scope.worldId);expect(Reflect.get(rows[0], 'workId')).toBeUndefined()
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  expect((await db.historicalTimelineEvents.where('projectId').equals(imported).toArray())[0]).toMatchObject({ description: f.events[1].description, date: f.events[1].date, year: null })
})
it('rolls back selected rows with the caller transaction and refuses overwriting an already adopted author edit', async () => {
  const f = await fixture(), input = { target: 'historicalTimelineEvents' as const, mode: 'add-many' as const, historyEventCreation: f.snapshot,
    data: { version: 1 as const, events: f.events, selectedIds: f.request.draftIds } }
  await expect(db.transaction('rw', historyEventCreationTransactionTablesV1(), async () => {
    await adopt(input, { transaction: Dexie.currentTransaction! })
    throw new Error('outer final receipt fault')
  })).rejects.toThrow('outer final receipt fault')
  expect(await db.historicalTimelineEvents.count()).toBe(0)
  await adopt(input)
  const first = (await db.historicalTimelineEvents.toArray())[0]
  await db.historicalTimelineEvents.update(first.id!, { description: '作者后改，不能覆盖' })
  await expect(adopt(input)).rejects.toThrow('又被修改')
  expect((await db.historicalTimelineEvents.get(first.id!))!.description).toBe('作者后改，不能覆盖')
  expect(await db.historicalTimelineEvents.count()).toBe(2)
})
it('rejects stale source history and foreign or inactive Work scope without adding partial records', async () => {
  const f = await fixture(), other = await seedCurrentWorkspace('其他作品')
  await expect(readHistoryEventCreationSnapshotV1({ ...f.owner, workId: other.scope.workId }, f.request)).rejects.toThrow()
  await db.projects.update(f.scope.projectId, { activeWorkId: other.scope.workId })
  await expect(adopt({ target: 'historicalTimelineEvents', mode: 'add-many', historyEventCreation: f.snapshot, data: { version: 1, events: f.events, selectedIds: f.request.draftIds } })).rejects.toThrow()
  await db.projects.update(f.scope.projectId, { activeWorkId: f.scope.workId })
  const { useHistoryStore } = await import('../../src/stores/project-singletons')
  await useHistoryStore.getState().saveForHistoryAuthorV1({ origin: { version: 1, kind: 'work', scope: f.scope }, selection: { kind: 'partition', worldGroupId: null }, patch: { overview: '作者新增历史背景' } })
  await expect(adopt({ target: 'historicalTimelineEvents', mode: 'add-many', historyEventCreation: f.snapshot, data: { version: 1, events: f.events, selectedIds: f.request.draftIds } })).rejects.toThrow('已变化')
  expect(await db.historicalTimelineEvents.count()).toBe(0)
})
