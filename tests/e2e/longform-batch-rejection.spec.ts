import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('SFQA095: a failed batch rejection stays visible and restores the exact unfinished volume without a model retry', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://batch-rejection-test.invalid/v1', model: 'batch-rejection-e2e', temperature: 0.2, maxTokens: 4000 }))
  })
  let modelCalls = 0
  await page.route('https://batch-rejection-test.invalid/**', async route => {
    modelCalls++
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ title: `候选章${modelCalls}`, summary: `第${modelCalls}卷推进剧情` }]) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  await createLongform(page, '批量拒绝失败保留')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '批量生成所有卷的章节', exact: true }).click()
  await expect(page.getByText('批量生成完成：2 章', { exact: true })).toBeVisible()
  expect(modelCalls).toBe(2)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")'))()
    const scope = useOutlineStore.getState().loadedScope
    const runs = await db.agentRuns.where('projectId').equals(scope.projectId).toArray() as Array<{ id: number; status: string }>
    if (runs.length !== 2 || runs.some(run => run.status !== 'awaiting_confirmation')) throw new Error('Missing exact two pending batch runs')
    const first = Math.min(...runs.map(run => run.id))
    let armed = true
    db.agentRunEvents.hook('creating', (_key: unknown, row: { runId: number; type: string }) => {
      if (armed && row.runId === first && row.type === 'run.failed') { armed = false; throw new Error('durable-batch-write-fault') }
    })
  })
  await page.getByTitle('关闭批量生成结果', { exact: true }).click()
  await expect(page.getByText(/批量章纲拒绝有 1 卷失败：durable-batch-write-fault/)).toBeVisible()
  await expect(page.getByText('批量生成完成：1 章', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('批量生成完成：1 章', { exact: true })).toBeVisible()
  expect(modelCalls).toBe(2)
  await page.getByTitle('关闭批量生成结果', { exact: true }).click()
  await expect(page.getByText('批量生成完成：1 章', { exact: true })).toHaveCount(0)
  expect(modelCalls).toBe(2)
  const states = await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")'))()
    const scope = useOutlineStore.getState().loadedScope
    const runs = await db.agentRuns.where('projectId').equals(scope.projectId).toArray() as Array<{ status: string }>
    const nodes = await db.outlineNodes.where('projectId').equals(scope.projectId).toArray() as Array<{ type: string }>
    return { statuses: runs.map(run => run.status), chapters: nodes.filter(node => node.type === 'chapter').length }
  })
  expect(states).toEqual({ statuses: ['failed', 'failed'], chapters: 0 })
})
