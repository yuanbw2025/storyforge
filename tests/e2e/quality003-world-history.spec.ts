import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('World history public API keeps its owner without a Work and survives refresh', async ({ page }) => {
  let modelRequests = 0
  await page.route('**/chat/completions', async route => { modelRequests++; await route.abort() })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible({ timeout: 15_000 })
  const bytes = [...await readFile('public/workshop/packages/storyforge.world-timeline-1.0.0.sfplugin')]
  const dependencyBytes = [...await readFile('public/workshop/packages/storyforge.calendar-1.0.0.sfplugin')]
  const result = await page.evaluate(async ({ packageBytes, dependencyBytes }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
    const { activePackages, enablePackage, extensionScope, installPackage } = await load<typeof import('../../src/lib/extensions/store')>('/storyforge/src/lib/extensions/store.ts')
    const { createHistory, listHistory } = await load<typeof import('../../src/lib/extensions/domain')>('/storyforge/src/lib/extensions/domain.ts')
    const { useHistoricalStore } = await load<typeof import('../../src/stores/historical')>('/storyforge/src/stores/historical.ts')
    const { scopeTransactionTables } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { scope } = await createWorkspace({ name: '无作品的世界历史', description: '', genres: [], status: 'drafting', targetWordCount: 30000 }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const owner = await extensionScope(scope.projectId, 'world')
    await installPackage(new Uint8Array(dependencyBytes).buffer)
    const pkg = await installPackage(new Uint8Array(packageBytes).buffer)
    await enablePackage(pkg, owner)
    const [{ profile }] = await activePackages(owner)
    await db.projects.update(scope.projectId, { activeWorkId: null })
    await db.works.delete(scope.workId)
    await useHistoricalStore.getState().loadEvents(scope.projectId)
    const entry = { title: '无作品也可保存的历史', time: '125', description: '作者原文：灯塔建立。\r\n第二行保留。' }
    await createHistory(profile, entry)
    const originalId = (await listHistory(profile))[0].id
    entry.title = '无作品也可修订的历史'
    await useHistoricalStore.getState().updateEvent(originalId, { title: entry.title })
    await createHistory(profile, { ...entry, title: '必须删除的历史' })
    const deleteId = (await listHistory(profile)).find(row => row.title === '必须删除的历史')!.id
    await useHistoricalStore.getState().deleteEvent(deleteId)
    const first = await listHistory(profile)
    let rollback = ''
    try {
      await db.transaction('rw', scopeTransactionTables(db.extensionProfiles, db.historicalTimelineEvents, db.storyTimelineEvents), async () => {
        await createHistory(profile, { ...entry, title: '必须回滚的历史' })
        await db.historicalTimelineEvents.where('projectId').equals(scope.projectId).count()
        throw new Error('浏览器原生回滚')
      })
    } catch (cause) { rollback = cause instanceof Error ? cause.message : String(cause) }
    const afterRollback = await listHistory(profile)
    const foreign = await createWorkspace({ name: '独立外来世界', description: '', genres: [], status: 'drafting', targetWordCount: 30000 }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const foreignOwner = await extensionScope(foreign.scope.projectId, 'world')
    let foreignError = ''
    try { await createHistory({ ...profile, worldId: foreignOwner.worldId, ownerKey: foreignOwner.ownerKey }, { ...entry, title: '禁止跨世界' }) }
    catch (cause) { foreignError = cause instanceof Error ? cause.message : String(cause) }
    const [row] = await db.historicalTimelineEvents.where('projectId').equals(scope.projectId).toArray()
    return {
      projectId: scope.projectId, profileId: profile.id!, worldId: scope.worldId, entry, first, afterRollback,
      rollback, foreignError, rowOwner: (row as typeof row & { worldId: number }).worldId, workOwnerAbsent: (row as typeof row & { workId?: number | null }).workId == null,
      workCount: await db.works.where('projectId').equals(scope.projectId).count(),
      foreignEvents: await db.historicalTimelineEvents.where('projectId').equals(foreign.scope.projectId).count(),
      visibleTitles: useHistoricalStore.getState().events.map(row => row.title),
    }
  }, { packageBytes: bytes, dependencyBytes })
  expect(result.first).toEqual([expect.objectContaining(result.entry)])
  expect(result.afterRollback).toEqual(result.first)
  expect(result.rollback).toBe('浏览器原生回滚')
  expect(result.foreignError).not.toBe('')
  expect(result.rowOwner).toBe(result.worldId)
  expect(result.workOwnerAbsent).toBe(true)
  expect(result.workCount).toBe(0)
  expect(result.foreignEvents).toBe(0)
  expect(result.visibleTitles).toEqual([result.entry.title])
  await page.reload()
  await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible({ timeout: 15_000 })
  const restored = await page.evaluate(async ({ projectId, profileId }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { listHistory } = await load<typeof import('../../src/lib/extensions/domain')>('/storyforge/src/lib/extensions/domain.ts')
    const profile = await db.extensionProfiles.get(profileId)
    if (!profile) throw new Error('插件历史配置未持久化')
    return { rows: await listHistory(profile), works: await db.works.where('projectId').equals(projectId).count() }
  }, result)
  expect(restored.rows).toEqual(result.first)
  expect(restored.works).toBe(0)
  expect(modelRequests).toBe(0)
})
