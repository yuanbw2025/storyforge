import { expect, test } from '@playwright/test'

type Observation = { started: boolean; settled: boolean; error: string | null; selections: (number | null)[] }

test('085 actual memory UI keeps B selected when A commits and its paid acknowledgement arrives later', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('085 requires isolated loopback')
  const origin = new URL(baseURL)
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('085 refuses author/external storage')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const forbidden: string[] = [], errors: string[] = []
  let calls = 0
  const intent = { kind: 'dialogue-only', confidence: 1, actionKeys: [], choiceKeys: [], extractedArguments: { targetKey: null },
    rationale: '只回答当前角色的对话', requiresConfirmation: false, boundaryExplanation: null, replyText: '' }
  const dialogue = { kind: 'npc-dialogue', actorKey: 'actor.caretaker', replyText: '我正在照看旧渠。', tone: 'neutral',
    citedKnowledgeKeys: [], recommendedActionKeys: [], recommendedChoiceKeys: [], boundaryExplanation: null }
  const memory = { kind: 'dialogue-window', subjectKey: 'actor.caretaker', summary: '来客与岑阿婆谈过照看旧渠的事情。',
    coveredEventSequences: [], playerKnowledgeKeys: [], actorKnowledgeKeys: [], openThreadKeys: [] }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'POST' && /\/chat\/completions$/.test(url.pathname)) {
      calls++
      const output = calls === 1 ? intent : calls === 2 ? dialogue : calls === 3 ? memory : null
      if (!output) { forbidden.push('unexpected model resend'); await route.abort(); return }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'sfqa085-native-' + calls,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 } }) })
    } else if (url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { forbidden.push(request.method() + ' ' + url.origin); await route.abort() }
  })
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa085-isolated'))
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('./')
    const fixture = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      if (await db.projects.count()) throw new Error('085 requires empty isolated storage')
      const { createGovernedTextOpenWorldSessionFixtureV1 } = await load<typeof import('../helpers/text-open-world-product-session')>('/storyforge/tests/helpers/text-open-world-product-session.ts')
      const { createTextOpenWorldVNextP9Fixture } = await load<typeof import('../helpers/text-open-world-vnext-fixture')>('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts')
      const { createTextOpenWorldInstance } = await load<typeof import('../../src/lib/product/runtime-instances')>('/storyforge/src/lib/product/runtime-instances.ts')
      const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
      useAIConfigStore.getState().setRememberApiKey(true)
      useAIConfigStore.getState().setConfig({ provider: 'openai', apiKey: 'synthetic-sfqa085-native-key', model: 'gpt-4o-mini',
        baseUrl: 'https://sfqa085-native.invalid/v1', maxTokens: 800, contextWindow: 128000, temperature: 0.2 })
      const a = await createGovernedTextOpenWorldSessionFixtureV1({ name: '085隔离双存档', textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
        runtimeShape: 'vnext-only', title: '085原A存档', seed: '085-native-A' })
      const b = await createTextOpenWorldInstance({ scope: a.scope, productReleaseId: a.release.id!, title: '085当前B存档', seed: '085-native-B' })
      if (a.session.id == null || b.id == null) throw new Error('085 requires actual public session IDs')
      return { scope: a.scope, a: a.session.id, b: b.id, title: a.session.title,
        beforeB: JSON.stringify({ session: await db.productRuntimeSessions.get(b.id), events: await db.productRuntimeEvents.where('sessionId').equals(b.id).sortBy('sequence') }) }
    })
    await page.goto('./openworld/runtime?project=' + fixture.scope.projectId + '&mode=play')
    const saves = page.getByRole('region', { name: '正式存档' })
    await saves.locator('.open-world-save-open').filter({ hasText: fixture.title }).click()
    await page.getByRole('button', { name: '岑阿婆 · 守渠人的话', exact: true }).click()
    await page.getByLabel('你想怎么做？').fill('085隔离提问：我只想听你说说话。')
    await page.getByTestId('text-open-world-natural-input').getByRole('button', { name: '提交', exact: true }).click()
    await expect(page.getByTestId('text-open-world-runtime-dialogue')).toContainText(dialogue.replyText)
    expect(calls).toBe(2)
    await page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { useTextOpenWorldPlayerStore } = await load<typeof import('../../src/stores/text-open-world-player')>('/storyforge/src/stores/text-open-world-player.ts')
      const state: Observation = { started: false, settled: false, error: null, selections: [] }
      Reflect.set(window, '__sfqa085', state)
      const actualSelect = useTextOpenWorldPlayerStore.getState().select
      useTextOpenWorldPlayerStore.setState({ select: id => { state.selections.push(id); return actualSelect(id) } })
      const constructor = db.constructor as typeof import('dexie').default
      if (typeof constructor.ignoreTransaction !== 'function') throw new Error('085 needs real native transaction separation')
      db.productRuntimeEvents.hook('creating', (_key, row) => {
        if (state.started || row.sessionId !== input.a || row.type !== 'text-open-world.memory.committed') return
        state.started = true
        // Actual user selection API starts while A's real native event is
        // being added. Do not await B inside A's own RW transaction.
        void constructor.ignoreTransaction(() => useTextOpenWorldPlayerStore.getState().select(input.b))
          .then(() => { state.settled = true }).catch(cause => { state.error = cause instanceof Error ? cause.message : 'B selection failed'; state.settled = true })
      })
    }, fixture)
    await page.getByRole('button', { name: '整理并保存长期记忆', exact: true }).click()
    await expect.poll(async () => page.evaluate(() => {
      const state = Reflect.get(window, '__sfqa085') as Observation | undefined
      return state?.started && state.settled && !state.error
    })).toBe(true)
    await page.getByLabel('你想怎么做？').fill('当前B尚未提交的输入')
    await expect.poll(async () => page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { readInstanceAgentRunV1 } = await load<typeof import('../../src/lib/agent/run/event-store')>('/storyforge/src/lib/agent/run/event-store.ts')
      const events = await db.agentRunEvents.where('projectId').equals(input.scope.projectId).toArray()
      const requested = events.filter(row => row.type === 'model.requested'
        && JSON.parse(row.payloadJson).stepId === 'text-open-world-runtime-ai:memory')
      if (requested.length !== 1) return false
      return (await readInstanceAgentRunV1(input.scope, requested[0].runId)).projection.state === 'completed'
    }, fixture)).toBe(true)
    const proof = await page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { useTextOpenWorldPlayerStore } = await load<typeof import('../../src/stores/text-open-world-player')>('/storyforge/src/stores/text-open-world-player.ts')
      const { readInstanceAgentRunV1 } = await load<typeof import('../../src/lib/agent/run/event-store')>('/storyforge/src/lib/agent/run/event-store.ts')
      const state = Reflect.get(window, '__sfqa085') as Observation | undefined
      if (!state) throw new Error('085 real event actor did not run')
      const requested = (await db.agentRunEvents.where('projectId').equals(input.scope.projectId).toArray())
        .filter(row => row.type === 'model.requested' && JSON.parse(row.payloadJson).stepId === 'text-open-world-runtime-ai:memory')
      if (requested.length !== 1) throw new Error('085 memory must have exactly one original request')
      const run = await readInstanceAgentRunV1(input.scope, requested[0].runId)
      return { selected: useTextOpenWorldPlayerStore.getState().selectedSessionId, observation: state,
        beforeBAfter: JSON.stringify({ session: await db.productRuntimeSessions.get(input.b), events: await db.productRuntimeEvents.where('sessionId').equals(input.b).sortBy('sequence') }),
        memoryEvents: (await db.productRuntimeEvents.where('sessionId').equals(input.a).toArray()).filter(row => row.type === 'text-open-world.memory.committed').length,
        terminal: run.projection.state, receiptHash: run.projection.terminalReceiptHash,
        rawKept: (await db.agentRunArtifacts.where('projectId').equals(input.scope.projectId).toArray()).some(row => row.artifactKind === 'raw-response' && row.content === input.memory),
        usage: (await db.aiUsageLog.where('projectId').equals(input.scope.projectId).toArray()).map(row => [row.inputTokens, row.outputTokens]) }
    }, { ...fixture, memory: JSON.stringify(memory) })
    expect(proof.selected).toBe(fixture.b)
    expect(proof.observation.selections).toEqual([fixture.b])
    expect(proof.observation.error).toBeNull()
    expect(proof.beforeBAfter).toBe(fixture.beforeB)
    expect(proof.memoryEvents).toBe(1)
    expect(proof.terminal).toBe('completed')
    expect(proof.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(proof.rawKept).toBe(true)
    expect(proof.usage).toEqual([[31, 7], [31, 7], [31, 7]])
    expect(calls).toBe(3)
    await expect(page.getByLabel('你想怎么做？')).toHaveValue('当前B尚未提交的输入')
    expect(forbidden).toEqual([]); expect(errors).toEqual([])
    await testInfo.attach('sfqa085-real-memory-selection-proof', { body: Buffer.from(JSON.stringify({ proof, calls }, null, 2)), contentType: 'application/json' })
  } finally { await context.close() }
})
