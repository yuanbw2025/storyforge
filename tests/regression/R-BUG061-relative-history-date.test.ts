import { buildWorldRulesManifest } from '../../src/lib/ai/world-rules-manifest'
import { createEmptyProfile } from '../../src/lib/types/world-rules'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useHistoricalStore } from '../../src/stores/historical'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { formatHistoricalYear } from '../../src/lib/history/year'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())
it('preserves relative dates as unspecified, distinct from an explicit zero, across native update, reload and backup import', async () => {
  const { scope } = await seedCurrentWorkspace('架空时间不伪造纪元'), store = useHistoricalStore.getState()
  const base = { projectId: scope.projectId, era: 'custom', date: '灰潮之前三旬', description: '完整相对时间', isHistorical: false }
  const explicitZero = await store.addEvent({ ...base, year: 0, title: '明确纪年原点' }, scope)
  const relative = await store.addEvent({ ...base, year: null, title: '没有绝对年份' }, scope)
  const bce = await store.addEvent({ ...base, year: -221, title: '有绝对年份' }, scope)
  await store.loadEvents(scope)
  expect(useHistoricalStore.getState().events.map(row => row.id)).toEqual([bce, explicitZero, relative])
  const manifest = buildWorldRulesManifest({ ...createEmptyProfile(scope.projectId), createdAt: 1, updatedAt: 1 }, { timelineEvents: useHistoricalStore.getState().events })
  expect(manifest).toContain('灰潮之前三旬');expect(manifest.indexOf('有绝对年份')).toBeLessThan(manifest.indexOf('没有绝对年份'))
  await store.updateEvent(explicitZero, { year: null }, scope)
  expect((await db.historicalTimelineEvents.get(explicitZero))!.year).toBeNull()
  expect(formatHistoricalYear((await db.historicalTimelineEvents.get(relative))!.year)).toBe('年份未指定')
  await store.loadEvents(scope)
  expect(useHistoricalStore.getState().events.map(row => row.id)).toEqual([bce, explicitZero, relative])
  const imported = await importProjectJSON(await exportProjectJSON(scope.projectId))
  const copy = await db.historicalTimelineEvents.where('projectId').equals(imported).toArray()
  expect(copy.filter(row => row.year === null).map(row => row.date)).toEqual(['灰潮之前三旬', '灰潮之前三旬'])
  expect(copy.find(row => row.title === '有绝对年份')!.year).toBe(-221)
})
