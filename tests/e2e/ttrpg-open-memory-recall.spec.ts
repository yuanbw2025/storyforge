import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })

test('native actor recall retains actual private evidence through one formal response and refresh without granting knowledge', async ({ page }) => {
  test.setTimeout(120000)
  const requests: string[] = []
  page.on('request', r => { if (/\/v1\/(?:chat\/completions|responses)/.test(r.url())) requests.push(r.url()) })
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const { prepareTtrpgOpenIntentInputV1 } = await importer('/storyforge/src/lib/ttrpg/open-intent-input.ts')
    const { executeTtrpgOpenIntentRequestV1 } = await importer('/storyforge/src/lib/ttrpg/open-intent-harness.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native memory recall', (p: any) => { p.ttrpg.campaign.runtimePolicy.enabled = true })
    const viewerKey = helper.OPEN_HUMAN_VIEWER, rawInput = '调查旧港的记忆线索', summary = '我怀疑有人在旧港跟踪，仍然只是个人推测。'
    const record = async (key: string, gm: boolean) => {
      const e = await helper.openEnvelopeV1(f.sessionId, key)
      await api.recordTtrpgOpenNarrativeMemoryV1({ ...e, viewerKey, draft: { revisionKey: key, observerKey: gm ? 'gm' : 'hero',
        reliability: 'belief', audience: gm ? 'gm-only' : 'private', knownBy: gm ? [] : ['hero'],
        summary: gm ? 'EXCLUDED-NATIVE-GM-MEMORY' : summary, fromEventSequence: 1, toEventSequence: e.baseSequence } })
    }
    await record('native.hero.note', false); await record('native.gm.note', true)
    await api.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.memory.epoch'), viewerKey, triggerKind: 'submit-action', rawInput })
    const prepared = await prepareTtrpgOpenIntentInputV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.memory.prepare'),
      scope: f.scope, actorKey: 'hero', viewerKey, rawInput, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    const before = await readProductRuntimeState(f.sessionId), rows = await db.ttrpgNarrativeMemories.toArray()
    let calls = 0
    const outcome = await executeTtrpgOpenIntentRequestV1({ scope: f.scope, sessionId: f.sessionId, viewerKey,
      runId: prepared.runId, requestKey: prepared.requestKey, runAI: async () => { calls++; return JSON.stringify({ goal: '调查旧港', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) } })
    const after = await readProductRuntimeState(f.sessionId)
    return { sessionId: f.sessionId, scope: f.scope, viewerKey, summary, messages: prepared.messages, calls, status: outcome.status,
      unchangedMemories: JSON.stringify(rows) === JSON.stringify(await db.ttrpgNarrativeMemories.toArray()),
      unchangedKnowledge: JSON.stringify(before.ttrpg.openRun.knowledge) === JSON.stringify(after.ttrpg.openRun.knowledge),
      unchangedWorldTurn: before.ttrpg.openRun.worldTime.worldTurn === after.ttrpg.openRun.worldTime.worldTurn,
      selected: prepared.evidence.contextSelection.selected }
  })
  expect(result.status).toBe('candidate'); expect(result.calls).toBe(1)
  expect(JSON.stringify(result.messages)).toContain(result.summary)
  expect(JSON.stringify(result.messages)).not.toContain('EXCLUDED-NATIVE-GM-MEMORY')
  expect(result.unchangedMemories && result.unchangedKnowledge && result.unchangedWorldTurn).toBe(true)
  expect(result.selected.some((r: any) => r.sourceKey === 'ttrpgOpenMemory' && r.tierKey === 'memory-summary')).toBe(true)
  await page.reload()
  const restored = await page.evaluate(async r => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/open-memory-service.ts')).readTtrpgOpenNarrativeMemoriesV1({ scope: r.scope, sessionId: r.sessionId, viewerKey: r.viewerKey })
  }, result)
  expect(restored.entries.some((e: any) => e.summary === result.summary && e.reliability === 'belief')).toBe(true)
  expect(requests).toEqual([])
})
