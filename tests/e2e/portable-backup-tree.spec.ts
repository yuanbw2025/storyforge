import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('SFQA019: backup file UI rejects duplicate, missing-parent and cyclic trees with zero writes, then restores valid shuffled rows', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await createLongform(page, '便携树原作保护')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByLabel('章节摘要', { exact: true }).fill('恢复时逐字保留原作。')
  await page.getByLabel('章节摘要', { exact: true }).blur()
  const { backup, originalProjectId, before } = await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const { exportProjectJSON } = await (new Function('return import("/storyforge/src/lib/export/json-export.ts")'))()
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")'))()
    const scope = useOutlineStore.getState().loadedScope
    const tables = db.tables as Array<{ name: string; count: () => Promise<number> }>
    return { backup: await exportProjectJSON(scope.projectId), originalProjectId: scope.projectId, before: Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await table.count()]))) }
  })
  await page.goto('./home/data')
  const upload = page.getByLabel('导入 JSON 备份', { exact: true })
  const counts = () => page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const tables = db.tables as Array<{ name: string; count: () => Promise<number> }>
    return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await table.count()])))
  })
  for (const kind of ['duplicate', 'orphan', 'cycle']) {
    const invalid = structuredClone(backup)
    if (kind === 'duplicate') invalid.outlineNodes[1]._exportId = invalid.outlineNodes[0]._exportId
    if (kind === 'orphan') invalid.outlineNodes[1]._parentExportId = 98765
    if (kind === 'cycle') invalid.outlineNodes[0]._parentExportId = invalid.outlineNodes[1]._exportId
    await upload.setInputFiles({ name: `invalid-${kind}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) })
    await expect(page.getByRole('alert').filter({ hasText: 'outlineNodes' })).toBeVisible()
    await expect(page.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0)
    expect(await counts()).toEqual(before)
  }
  const valid = structuredClone(backup)
  valid.outlineNodes.reverse()
  await upload.setInputFiles({ name: 'valid-shuffled.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(valid)) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect.poll(async () => (await counts()).projects).toBe(Number(before.projects) + 1)
  const restoredProjectId = Number(new URL(page.url()).searchParams.get('project'))
  expect(restoredProjectId).not.toBe(originalProjectId)
  const rows = await page.evaluate(async ({ originalProjectId, restoredProjectId }) => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const read = async (projectId: number) => {
      const data = await db.outlineNodes.where('projectId').equals(projectId).toArray() as Array<{ id: number; type: string; parentId: number | null; title: string; summary: string }>
      const parent = data.find(row => row.type === 'volume')!
      const child = data.find(row => row.type === 'chapter')!
      return { title: child.title, summary: child.summary, linked: child.parentId === parent.id, count: data.length }
    }
    return { original: await read(originalProjectId), restored: await read(restoredProjectId) }
  }, { originalProjectId, restoredProjectId })
  expect(rows.original).toEqual({ title: '第1章', summary: '恢复时逐字保留原作。', linked: true, count: 2 })
  expect(rows.restored).toEqual(rows.original)
})
