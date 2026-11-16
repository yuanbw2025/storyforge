import { expect, test } from '@playwright/test'

test('SFQA086: native generate/continue Gateway and page reload retain source text while excluding stale derived facts', async ({ page }) => {
  await page.goto('./long')
  // main.tsx renders this entry only after prompt/workflow initialization.
  await page.getByRole('button', { name: '新建长篇', exact: true }).waitFor({ state: 'visible' })
  const ids = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { seedSFQA086Continuity } = await imp('/storyforge/tests/helpers/sfqa086-continuity.ts')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const f = await seedSFQA086Continuity()
    await db.chapters.update(f.priorId, { summarySourceTextHash: 'a'.repeat(64), continuityHandoff: { ...f.priorRow.continuityHandoff, sourceTextHash: 'a'.repeat(64) }, planReconciliation: { ...f.priorRow.planReconciliation, sourceTextHash: 'a'.repeat(64) } })
    return { scope: f.created.scope as { projectId: number; worldId: number; workId: number }, priorId: f.priorId as number, targetId: f.targetId as number, outlineId: f.outlineId as number, key: f.key as string }
  })
  for (let round = 0; round < 2; round++) {
    if (round) {
      await page.reload()
      await page.getByRole('button', { name: '新建长篇', exact: true }).waitFor({ state: 'visible' })
    }
    const results = await page.evaluate(async ids => {
      const imp = new Function('p', 'return import(p)')
      const { prepareProseGatewayAssemblyV1 } = await imp('/storyforge/src/lib/prose/gateway-context.ts')
      const { useAIConfigStore } = await imp('/storyforge/src/stores/ai-config.ts')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const changedTables = new Set<string>()
      const observe = (parts: Record<string, unknown>) => {
        for (const key of Object.keys(parts)) changedTables.add(key.split('/').slice(-2).join('/'))
      }
      db.constructor.on.storagemutated.subscribe(observe)
      const outputs: Array<{ operation: string; text: string; mandatory: string[] }> = []
      try {
        for (const operation of ['generate', 'continue']) {
          const result = await prepareProseGatewayAssemblyV1({ projectId: ids.scope.projectId, scope: ids.scope, worldGroupId: null, chapterId: ids.targetId, outlineNodeId: ids.outlineId, operation, authorRequest: '打开蓝门', config: useAIConfigStore.getState().config })
          outputs.push({ operation, text: result.text, mandatory: result.contextGatewayExecution.retrievalTrace.mandatory.map((item: { resourceKey: string }) => item.resourceKey) })
        }
      } catch (cause) { throw new Error(`${String(cause)}; changed tables=${[...changedTables].join(',')}`) }
      finally { db.constructor.on.storagemutated.unsubscribe(observe) }
      const original = await db.chapters.get(ids.priorId)
      return { outputs, original: { content: original.content, summary: original.summary, sourceTextHash: original.summarySourceTextHash }, runs: await db.agentRuns.count() }
    }, ids)
    for (const result of results.outputs) {
      expect(result.text).toContain('当前作者原文')
      for (const marker of ['摘要事实：只带蓝钥匙。', '交接事实：停在蓝门。', '对账事实：没有红钥匙。']) expect(result.text).not.toContain(marker)
      expect(result.mandatory).toContain(ids.key)
    }
    expect(results.original).toEqual({ content: '<p>当前作者原文：林只带了蓝钥匙，停在蓝门。</p>', summary: '摘要事实：只带蓝钥匙。', sourceTextHash: 'a'.repeat(64) })
    expect(results.runs).toBe(0)
  }
})
