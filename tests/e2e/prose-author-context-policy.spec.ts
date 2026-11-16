import { expect, test, type Page } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

const marker = '资料页关闭证据：银铃只在满月响起。'
const unboundedFact = '无界历史事实隔离证据：蓝门早已坍塌。'

async function seed(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('storyforge_guide_completed', 'e2e') })
  await page.goto('./long')
  await page.getByRole('button', { name: '新建长篇', exact: true }).waitFor({ state: 'visible' })
  const ids = await page.evaluate(async ({ marker, unboundedFact }) => {
    const imp = new Function('p', 'return import(p)')
    const { seedSFQA086Continuity } = await imp('/storyforge/tests/helpers/sfqa086-continuity.ts')
    const { stampNewRecord } = await imp('/storyforge/src/lib/workspace/scope.ts')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { makeRagEntryKey, updateRagDocumentPolicy } = await imp('/storyforge/src/lib/retrieval/rag-library.ts')
    const f = await seedSFQA086Continuity()
    const unboundedFactId = await db.temporalFacts.add(stampNewRecord(f.created.scope, 'temporalFacts', { subjectName: '蓝门', predicate: 'state', value: unboundedFact, factKind: 'state', sourceType: 'chapter', sourceChapterId: f.priorId, validFromChapterId: f.priorId, validToChapterId: null, status: 'superseded', locked: false, createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
    const id = await db.worldviews.add(stampNewRecord(f.created.scope, 'worldviews', { worldGroupId: null, worldOrigin: marker, races: '公开种族资料', createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    await updateRagDocumentPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'worldviews', recordId: id, patch: { weight: 2.5, tokenCap: 1600 } })
    const row = await db.worldviews.get(id)
    return { scope: f.created.scope as { projectId: number; worldId: number; workId: number }, priorId: f.priorId as number, targetId: f.targetId as number, outlineId: f.outlineId as number, unboundedFactId: unboundedFactId as number, entryKey: makeRagEntryKey(row.ragDocumentId, 'worldOrigin') as string }
  }, { marker, unboundedFact })
  await page.goto(`./workspace/${ids.scope.projectId}?work=${ids.scope.workId}`)
  await openLongformLeaf(page, '资料与检索库')
  return ids
}

async function readInputs(page: Page, ids: Awaited<ReturnType<typeof seed>>) {
  return page.evaluate(async ids => {
    const imp = new Function('p', 'return import(p)')
    const { prepareProseGatewayAssemblyV1 } = await imp('/storyforge/src/lib/prose/gateway-context.ts')
    const { readRagSelectionContext } = await imp('/storyforge/src/lib/retrieval/rag-library.ts')
    const { useAIConfigStore } = await imp('/storyforge/src/stores/ai-config.ts')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const outputs: string[] = []
    let error = ''
    try {
      for (const operation of ['generate', 'continue']) {
        const result = await prepareProseGatewayAssemblyV1({ projectId: ids.scope.projectId, scope: ids.scope, worldGroupId: null, chapterId: ids.targetId, outlineNodeId: ids.outlineId, operation, authorRequest: '打开蓝门', config: useAIConfigStore.getState().config })
        outputs.push(result.text)
      }
    } catch (cause) { error = String(cause) }
    return { outputs, error, node: await readRagSelectionContext({ projectId: ids.scope.projectId, scope: ids.scope, worldGroupId: null, entryKeys: [ids.entryKey] }), runs: await db.agentRuns.count(), unboundedStatus: (await db.temporalFacts.get(ids.unboundedFactId))?.status as string | undefined }
  }, ids)
}

test('SFQA087: real library switches govern prose and node inputs across reload while preserving author viewing and policy values', async ({ page }) => {
  const ids = await seed(page)
  await page.getByText('世界观主世界观', { exact: true }).click()
  const group = page.getByRole('group').filter({ hasText: '世界观主世界观' })
  const field = group.getByRole('checkbox', { name: '启用字段 世界来源', exact: true })
  await expect(field).toBeChecked()
  await field.click()
  await expect(field).not.toBeChecked()
  await expect(group.getByText(marker, { exact: true })).toBeVisible()
  let result = await readInputs(page, ids)
  expect(result.error).toBe('')
  expect(result.outputs).toHaveLength(2)
  for (const text of result.outputs) { expect(text).not.toContain(marker); expect(text).not.toContain(unboundedFact) }
  expect(result.unboundedStatus).toBe('superseded')
  expect(result.node).not.toContain(marker)
  await field.click()
  await expect(field).toBeChecked()
  result = await readInputs(page, ids)
  for (const text of result.outputs) { expect(text).toContain(marker); expect(text).not.toContain(unboundedFact) }
  expect(result.node).toContain(marker)
  const document = group.getByRole('checkbox', { name: '启用资料 主世界观', exact: true })
  await expect(document).toBeChecked()
  await document.click()
  await expect(document).not.toBeChecked()
  await page.reload()
  await openLongformLeaf(page, '资料与检索库')
  await expect(group.getByRole('checkbox', { name: '启用资料 主世界观', exact: true })).not.toBeChecked()
  result = await readInputs(page, ids)
  expect(result.error).toBe('')
  for (const text of result.outputs) { expect(text).not.toContain(marker); expect(text).not.toContain(unboundedFact) }
  expect(result.unboundedStatus).toBe('superseded')
  expect(result.node).not.toContain(marker)
  expect(result.runs).toBe(0)
  await expect(group.getByRole('spinbutton', { name: '默认权重', exact: true })).toHaveValue('2.5')
  await expect(group.getByRole('spinbutton', { name: '字段上限', exact: true })).toHaveValue('1600')
  await document.click()
  await expect(document).toBeChecked()
  result = await readInputs(page, ids)
  expect(result.error).toBe('')
  for (const text of result.outputs) { expect(text).toContain(marker); expect(text).not.toContain(unboundedFact) }
  expect(result.node).toContain(marker)
  expect(result.runs).toBe(0)
})

test('SFQA087: closing a genuinely required chapter source gives an explicit restore action and makes no model run', async ({ page }) => {
  const ids = await seed(page)
  const chapter = page.getByRole('group').filter({ has: page.getByRole('checkbox', { name: '启用资料 第一章', exact: true }) })
  await chapter.locator('summary').click()
  const content = chapter.getByRole('checkbox', { name: '启用字段 content', exact: true })
  await expect(content).toBeChecked()
  await content.click()
  await expect(content).not.toBeChecked()
  let result = await readInputs(page, ids)
  expect(result.outputs).toHaveLength(0)
  expect(result.error).toMatch(/停用|关闭/)
  expect(result.error).toMatch(/恢复|启用/)
  expect(result.runs).toBe(0)
  await content.click()
  await expect(content).toBeChecked()
  result = await readInputs(page, ids)
  expect(result.error).toBe('')
  expect(result.outputs).toHaveLength(2)
  for (const text of result.outputs) expect(text).not.toContain(unboundedFact)
  expect(result.unboundedStatus).toBe('superseded')
  expect(result.runs).toBe(0)
})
