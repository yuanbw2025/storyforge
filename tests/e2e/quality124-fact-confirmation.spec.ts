import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'
import type { Chapter, OutlineNode, TemporalFact } from '../../src/lib/types'

test('SFQA124 native IndexedDB serializes Canon confirmation and the real fact panel explains locked conflicts after refresh', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, 'SFQA124 并发事实隔离')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  const fixture = await page.evaluate(async projectId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { resolveScopeLike, stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { confirmFactCandidate } = await load<typeof import('../../src/lib/fact-ledger/fact-ledger')>('/storyforge/src/lib/fact-ledger/fact-ledger.ts')
    const { assembleContext } = await load<typeof import('../../src/lib/registry/assemble-context')>('/storyforge/src/lib/registry/assemble-context.ts')
    const scope = await resolveScopeLike(projectId), chapters: number[] = []
    for (let order = 0; order < 3; order++) {
      const outlineNodeId = await db.outlineNodes.add(stampNewRecord<OutlineNode>(scope, 'outlineNodes', {
        projectId, parentId: null, type: 'chapter', title: `事实章${order}`, summary: '', order, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }))
      chapters.push(await db.chapters.add(stampNewRecord<Chapter>(scope, 'chapters', {
        projectId, outlineNodeId, title: `事实章${order}`, content: '作者事实来源。', wordCount: 7,
        status: 'draft', order, notes: '', createdAt: 1, updatedAt: 1,
      }, { owner: 'work' })))
    }
    const ids: number[] = []
    for (const [index, value] of ['洛阳', '北境'].entries()) ids.push(await db.temporalFacts.add(stampNewRecord<TemporalFact>(scope, 'temporalFacts', {
      projectId, subjectName: '林飞', predicate: 'location', factKind: 'state', value,
      sourceType: 'chapter', sourceChapterId: chapters[index], validFromChapterId: chapters[index],
      validToChapterId: null, status: 'candidate', locked: false, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' })))
    const results = await Promise.all(ids.map(confirmFactCandidate))
    const rows = await db.temporalFacts.bulkGet(ids), current = rows.find(row => row?.status === 'confirmed')!
    await db.temporalFacts.update(current.id!, { locked: true })
    await db.temporalFacts.add(stampNewRecord<TemporalFact>(scope, 'temporalFacts', {
      projectId, subjectName: '林飞', predicate: 'location', factKind: 'state', value: '不可覆盖的候选',
      sourceType: 'chapter', sourceChapterId: chapters[2], validFromChapterId: chapters[2],
      validToChapterId: null, status: 'candidate', locked: false, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    return { scope, chapters, results, rows, current,
      context: (await assembleContext({ scope, projectId, chapterId: chapters[2], sourceKeys: ['currentFacts'] })).text }
  }, projectId)
  expect(fixture.results.every(row => row.confirmed)).toBe(true)
  expect(fixture.rows.filter(row => row?.status === 'confirmed')).toHaveLength(1)
  expect(fixture.rows.filter(row => row?.status === 'superseded')).toHaveLength(1)
  expect(fixture.context).toContain(fixture.current.value)
  expect(fixture.context).not.toContain(fixture.rows.find(row => row?.status === 'superseded')!.value)
  await openLongformLeaf(page, '事实库')
  await page.getByRole('button', { name: /待确认候选/ }).click()
  await page.getByTitle('确认为权威事实（Canon）', { exact: true }).click()
  await expect(page.getByRole('status')).toContainText('同一时段的事实已锁定')
  await expect(page.getByText('不可覆盖的候选', { exact: true })).toBeVisible()
  await page.reload()
  await openLongformLeaf(page, '事实库')
  await page.getByRole('button', { name: /已确认 Canon/ }).click()
  await expect(page.getByText(fixture.current.value, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /已被取代/ }).click()
  await expect(page.getByText(fixture.rows.find(row => row?.status === 'superseded')!.value, { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('SFQA124 native IndexedDB checks constitution sources inside concurrent confirm and explicit replacement transactions', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, 'SFQA124 宪法事务隔离')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  const result = await page.evaluate(async projectId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { resolveScopeLike, stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { confirmFactCandidate, replaceConstitutionFactCandidate } = await load<typeof import('../../src/lib/fact-ledger/fact-ledger')>('/storyforge/src/lib/fact-ledger/fact-ledger.ts')
    const { fingerprintSettingSource } = await load<typeof import('../../src/lib/fact-ledger/setting-assertions')>('/storyforge/src/lib/fact-ledger/setting-assertions.ts')
    const scope = await resolveScopeLike(projectId), source = '力量设定：潮汐、血脉、星光与海潮。'
    const sourceWorldviewId = await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId, worldOrigin: source, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    const candidate = (value: string) => db.temporalFacts.add(stampNewRecord<TemporalFact>(scope, 'temporalFacts', {
      projectId, subjectName: '世界', predicate: 'magicSource', factKind: 'state', value,
      sourceType: 'setting', sourceRecordTable: 'worldviews', sourceWorldviewId, sourceField: 'worldOrigin',
      sourceFingerprint: fingerprintSettingSource(source), validFromChapterId: null, validToChapterId: null,
      status: 'candidate', locked: false, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const ids = [await candidate('潮汐'), await candidate('血脉')]
    const confirmed = await Promise.all(ids.map(confirmFactCandidate))
    const replacements = [await candidate('星光'), await candidate('海潮')]
    const replaced = await Promise.all(replacements.map(replaceConstitutionFactCandidate))
    await db.worldviews.update(sourceWorldviewId, { worldOrigin: '原来源已被作者修改。' })
    const stale = await confirmFactCandidate(confirmed[0].confirmed ? ids[1] : ids[0])
    return { confirmed, replaced, stale, rows: await db.temporalFacts.toArray() }
  }, projectId)
  expect(result.confirmed.filter(row => row.confirmed)).toHaveLength(1)
  expect(result.confirmed.find(row => !row.confirmed)?.clashes).toHaveLength(1)
  expect(result.replaced.every(row => row.confirmed)).toBe(true)
  expect(result.rows.filter(row => row.status === 'confirmed')).toHaveLength(1)
  expect(result.rows.filter(row => row.status === 'superseded')).toHaveLength(2)
  expect(result.stale).toMatchObject({ confirmed: false, reason: 'source-stale' })
})
