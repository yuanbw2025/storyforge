import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('history-bound outline deletion is visible, atomic, and remains backable after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  let externalRequests = 0
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => {
    if (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)) return route.continue()
    externalRequests++; return route.abort()
  })
  await createLongform(page, 'Historical scope deletion safety')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expect(page.getByLabel('卷标题', { exact: true })).toHaveValue('第1卷')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(1)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")'))()
    const { createAgentRunV1 } = await (new Function('return import("/storyforge/src/lib/agent/run/event-store.ts")'))()
    const scope = useOutlineStore.getState().loadedScope
    const node = useOutlineStore.getState().nodes.find((row: { type: string }) => row.type === 'chapter')
    await createAgentRunV1({ scope, worldGroupId: node.worldGroupId ?? null, contract: {
      version: 1, objective: 'Synthetic history binding', workflowKind: 'long-running-resumable',
      scope: { projectId: scope.projectId, worldGroupId: node.worldGroupId ?? null, outlineNodeIds: [node.id] },
      permissions: { contextSourceKeys: ['worldview', 'storyCore'], writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }] },
      runtimeBindingHash: 'a'.repeat(64), budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 4000, maxOutputTokens: 1000, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'outline.output', kind: 'output-present', required: true }],
      verificationPlan: [{ id: 'outline.terminal', kind: 'terminal', verifier: 'terminal-v1', criterionIds: ['outline.output'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    } })
    // Read-only baseline, scoped to this isolated test installation.
    Object.assign(window, { deletionBaseline: { nodes: await db.outlineNodes.toArray(), runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray() } })
  })
  await page.getByTitle('删除当前卷', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '仍被运行历史引用' })).toBeVisible()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(1)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const { exportProjectJSON } = await (new Function('return import("/storyforge/src/lib/export/json-export.ts")'))()
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")'))()
    const before = (window as unknown as { deletionBaseline: unknown }).deletionBaseline
    const after = { nodes: await db.outlineNodes.toArray(), runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray() }
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Deletion changed original rows')
    await exportProjectJSON(useOutlineStore.getState().loadedScope.projectId)
  })
  await page.getByRole('button', { name: /清空章节/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '清空', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '仍被运行历史引用' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('卷标题', { exact: true })).toBeVisible()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(1)
  expect(errors).toEqual([])
  expect(externalRequests).toBe(0)
})
