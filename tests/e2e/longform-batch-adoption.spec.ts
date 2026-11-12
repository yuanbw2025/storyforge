import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function prepareBatch(page: Page, count: number) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://batch-adoption-test.invalid/v1', model: 'batch-adoption-e2e', temperature: 0.2, maxTokens: 4000 }))
  })
  let calls = 0
  await page.route('https://batch-adoption-test.invalid/**', async route => {
    calls++
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify([{ title: `批量候选章${calls}`, summary: `原始第${calls}卷章纲` }]) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    }) })
  })
  await createLongform(page, `SFQA094同批${count}卷`)
  await openLongformLeaf(page, '大纲')
  for (let index = 0; index < count; index++) await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '批量生成所有卷的章节', exact: true }).click()
  await expect(page.getByText(`批量生成完成：${count} 章`, { exact: true })).toBeVisible()
  expect(calls).toBe(count)
  return () => calls
}

async function batchState(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as () => Promise<typeof import('../../src/lib/db/schema')>)()
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")') as () => Promise<typeof import('../../src/stores/outline')>)()
    const { readAgentRunV1 } = await (new Function('return import("/storyforge/src/lib/agent/run/event-store.ts")') as () => Promise<typeof import('../../src/lib/agent/run/event-store')>)()
    const scope = useOutlineStore.getState().loadedScope
    if (!scope) throw new Error('outline Work is not ready')
    const runs = (await db.agentRuns.where('projectId').equals(scope.projectId).toArray()).filter(row => row.workId === scope.workId)
    const states = []
    for (const row of runs) {
      if (row.id == null) throw new Error('run missing actual id')
      const snapshot = await readAgentRunV1(scope, row.id)
      states.push({ id: row.id, state: snapshot.projection.state, receipt: snapshot.projection.terminalReceiptHash ?? null,
        models: snapshot.events.filter(event => event.type === 'model.requested').length,
        adoptions: snapshot.events.filter(event => event.type === 'adoption.committed').length })
    }
    const nodes = (await db.outlineNodes.where('projectId').equals(scope.projectId).toArray()).filter(row => row.workId === scope.workId)
    return { runs: states, chapters: nodes.filter(row => row.type === 'chapter').map(row => ({ id: row.id, title: row.title, summary: row.summary })),
      volumes: nodes.filter(row => row.type === 'volume').map(row => ({ id: row.id, summary: row.summary })) }
  })
}

for (const count of [2, 3]) {
  test(`SFQA094: actual all-write adopts ${count} same-world volumes once with receipts and survives reload`, async ({ page }) => {
    const calls = await prepareBatch(page, count)
    await page.getByRole('button', { name: '全部写入', exact: true }).click()
    await expect(page.getByText(`批量生成完成：${count} 章`, { exact: true })).toHaveCount(0)
    const before = await batchState(page)
    expect(before.chapters).toHaveLength(count)
    expect(before.runs).toHaveLength(count)
    for (const run of before.runs) expect(run).toMatchObject({ state: 'completed', receipt: expect.stringMatching(/^[a-f0-9]{64}$/), models: 1, adoptions: 1 })
    await page.reload()
    await expect(page.getByRole('button', { name: '批量生成所有卷的章节', exact: true })).toBeVisible()
    expect(await batchState(page)).toEqual(before)
    expect(calls()).toBe(count)
  })
}

async function failSecondVolumeOnce(page: Page, target: 'proof' | 'receipt', count: number) {
  await page.evaluate(async ({ target, count }) => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as () => Promise<typeof import('../../src/lib/db/schema')>)()
    const runs = (await db.agentRuns.toArray()).filter(row => row.status === 'awaiting_confirmation')
    if (runs.length !== count || runs[1].id == null) throw new Error('unexpected pending run count')
    const second = runs[1].id
    let armed = true
    if (target === 'proof') db.agentEvents.hook('creating', (_key: unknown, row: { durableRunId?: number | null; payload?: string }) => {
      if (armed && row.durableRunId === second && JSON.parse(row.payload ?? '{}').type === 'outline-batch-append-evidence-v1') {
        armed = false; throw new Error('native-batch-storage-failure')
      }
    })
    else db.agentRunEvents.hook('creating', (_key: unknown, row: { runId?: number; type?: string }) => {
      if (armed && row.runId === second && row.type === 'verification.accepted') {
        armed = false; throw new Error('native-batch-storage-failure')
      }
    })
  }, { target, count })
}

for (const target of ['proof', 'receipt'] as const) {
  test(`SFQA094: actual ${target} storage failure keeps the unfinished volumes and resumes after refresh`, async ({ page }) => {
    const calls = await prepareBatch(page, 3)
    await failSecondVolumeOnce(page, target, 3)
    await page.getByRole('button', { name: '全部写入', exact: true }).click()
    await expect(page.getByText(/native-batch-storage-failure/)).toBeVisible()
    await expect(page.getByText('批量生成完成：2 章', { exact: true })).toBeVisible()
    const partial = await batchState(page)
    expect(partial.chapters).toHaveLength(target === 'proof' ? 1 : 2)
    expect(partial.runs.filter(run => run.state === 'completed')).toHaveLength(1)
    expect(partial.runs[1].state).toBe(target === 'proof' ? 'running' : 'verifying')
    expect(partial.runs[2].state).toBe('running')
    await page.reload()
    await expect(page.getByText('批量生成完成：2 章', { exact: true })).toBeVisible()
    expect(await batchState(page)).toEqual(partial)
    expect(calls()).toBe(3)
    await page.getByRole('button', { name: '全部写入', exact: true }).click()
    await expect(page.getByText('批量生成完成：2 章', { exact: true })).toHaveCount(0)
    const final = await batchState(page)
    expect(final.chapters).toHaveLength(3)
    for (const row of partial.chapters) expect(final.chapters.find(item => item.id === row.id)).toEqual(row)
    for (const run of final.runs) expect(run).toMatchObject({ state: 'completed', models: 1, adoptions: 1, receipt: expect.any(String) })
    expect(calls()).toBe(3)
  })
}

test('SFQA094: author changes after generation remain visible and block all-write without another model call', async ({ page }) => {
  const calls = await prepareBatch(page, 2)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as () => Promise<typeof import('../../src/lib/db/schema')>)()
    const volume = (await db.outlineNodes.toArray()).find(row => row.type === 'volume')
    if (volume?.id == null) throw new Error('missing actual volume')
    await db.outlineNodes.update(volume.id, { summary: '生成后作者明确改过的卷纲' })
  })
  await page.getByRole('button', { name: '全部写入', exact: true }).click()
  await expect(page.getByText(/批量确认失败：.*内容已变化/)).toBeVisible()
  await expect(page.getByText('批量生成完成：2 章', { exact: true })).toBeVisible()
  const state = await batchState(page)
  expect(state.chapters).toHaveLength(0)
  expect(state.volumes.some(volume => volume.summary === '生成后作者明确改过的卷纲')).toBe(true)
  for (const run of state.runs) expect(run).toMatchObject({ state: 'awaiting_confirmation', models: 1, adoptions: 0, receipt: null })
  expect(calls()).toBe(2)
})

test('SFQA094/095: closing after a committed write keeps the receipt available to finish', async ({ page }) => {
  const calls = await prepareBatch(page, 2)
  await failSecondVolumeOnce(page, 'receipt', 2)
  const confirm = page.getByRole('button', { name: '全部写入', exact: true })
  await confirm.click()
  await expect(page.getByText(/native-batch-storage-failure/)).toBeVisible()
  const partial = await batchState(page)
  expect(partial.chapters).toHaveLength(2)
  expect(partial.runs[1]).toMatchObject({ state: 'verifying', adoptions: 1, receipt: null })
  await page.getByTitle('关闭批量生成结果', { exact: true }).click()
  await expect(page.getByText(/此卷已写入/)).toBeVisible()
  expect(await batchState(page)).toEqual(partial)
  await page.reload()
  await expect(page.getByText('批量生成完成：1 章', { exact: true })).toBeVisible()
  await confirm.click()
  await expect(page.getByText('批量生成完成：1 章', { exact: true })).toHaveCount(0)
  const final = await batchState(page)
  expect(final.chapters).toEqual(partial.chapters)
  for (const run of final.runs) expect(run).toMatchObject({
    state: 'completed', adoptions: 1, models: 1, receipt: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  expect(calls()).toBe(2)
})
