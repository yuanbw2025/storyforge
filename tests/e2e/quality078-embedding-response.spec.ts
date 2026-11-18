import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('automatic retrieval keeps malformed vectors uncached and retries without changing the manuscript', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  let rejectBatch = true
  let calls = 0
  let lastInputs: string[] = []
  await page.route('**/sfqa078-mock/v1/embeddings', async route => {
    calls += 1
    const body = route.request().postDataJSON() as { input: string[] }
    if (body.input.length > 1) lastInputs = body.input
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      data: body.input.map((_text, index) => ({ index: rejectBatch ? 0 : index, embedding: [index + 1, 1] })).reverse(),
    }) })
  })
  await createLongform(page, 'SFQA078 isolated retrieval')
  const fixture = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord } = await load('/storyforge/src/lib/workspace/scope.ts')
    const projectId = Number(location.pathname.match(/workspace\/(\d+)/)?.[1])
    const project = await db.projects.get(projectId)
    const scope = { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
    const oldOutline = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {projectId:project.id,parentId:null,type:'chapter',title:'历史章',summary:'青灯旧事',order:1,createdAt:1,updatedAt:1},{owner:'work'}))
    await db.chapters.add(stampNewRecord(scope, 'chapters', {projectId:project.id,outlineNodeId:oldOutline,title:'历史章',content:'青灯旧事。'.repeat(200),summary:'',status:'draft',order:1,wordCount:1200,notes:'',createdAt:1,updatedAt:1},{owner:'work'}))
    const outlineId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {projectId:project.id,parentId:null,type:'chapter',title:'当前章',summary:'青灯旧事',order:999,createdAt:1,updatedAt:1},{owner:'work'}))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {projectId:project.id,outlineNodeId:outlineId,title:'当前章',content:'当前章不应上传',summary:'',status:'draft',order:999,wordCount:8,notes:'',createdAt:1,updatedAt:1},{owner:'work'}))
    return {scope,outlineId,chapterId,chapters:await db.chapters.toArray()}
  })
  await openLongformLeaf(page, '设置')
  const card = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '独立语义检索服务' }) })
  await card.locator('summary').click()
  await card.getByRole('checkbox').check()
  await card.getByRole('button', { name: /本地 Ollama/ }).click()
  await card.getByLabel('语义检索服务 Base URL').fill('/sfqa078-mock/v1')
  const retrieve = () => page.evaluate(async input => {
    const { assembleContext } = await (new Function('return import("/storyforge/src/lib/registry/assemble-context.ts")'))()
    return (await assembleContext({ projectId:input.scope.projectId,scope:input.scope,chapterId:input.chapterId,outlineNodeId:input.outlineId,sourceKeys:['retrievedPassages'] })).text
  },fixture)
  expect(await retrieve()).toContain('青灯旧事')
  expect(lastInputs.length).toBeGreaterThan(1)
  expect(calls).toBe(2)
  const failed = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.retrievalChunks.toArray()
  })
  expect(failed.filter(row => row.sourceChapterId !== fixture.chapterId)).toHaveLength(lastInputs.length)
  expect(failed.every(row => row.embedding == null && row.embeddingModel == null)).toBe(true)
  rejectBatch = false
  expect(await retrieve()).toContain('青灯旧事')
  expect(calls).toBe(4)
  await page.reload()
  await card.locator('summary').click()
  await expect(card.getByRole('checkbox')).toBeChecked()
  expect(await retrieve()).toContain('青灯旧事')
  expect(calls).toBe(5)
  const after = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return { chapters: await db.chapters.toArray(), chunks: await db.retrievalChunks.toArray() }
  })
  expect(after.chapters).toEqual(fixture.chapters)
  expect(after.chunks.filter(row => row.sourceChapterId !== fixture.chapterId).map(row => row.embedding)).toEqual(lastInputs.map((_text, index) => [index + 1, 1]))
})
