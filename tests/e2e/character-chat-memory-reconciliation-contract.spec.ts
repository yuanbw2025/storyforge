import {test, expect} from '@playwright/test'

// Real IndexedDB/Harness lifecycle with the production binding; model outputs
// are injected and do not establish semantic accuracy.
test('persists reviewed memory reconciliation through browser reload and portable nested branches without changing facts', async ({page}) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const skills = await load('/storyforge/src/lib/agent/skill-registry.ts'), portable = await load('/storyforge/src/lib/export/json-export.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    const f = await fixture.seedChatNarrativeRuntimeFixture()
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const source = await api.commitInteractionPlayerMessage({...await command(), messageId: 'source', text: '我没有答应帮忙寻找铜印。'})
    await api.proposeInteractionMemory({...await command(), memoryId: 'old', participantKey: 'guard', kind: 'key-memory', content: '旧的未核对摘要', importance: 1, sourceEventSequences: [source.sequence], evidenceExcerpt: '没有答应帮忙'})
    const correction = await api.correctChatMemory({...await command(), memoryId: 'old', replacementMemoryId: 'corrected', content: '玩家没有答应帮忙。', sourceEventSequences: [source.sequence], evidenceExcerpt: '没有答应帮忙', reason: '依据原话修正'})
    await api.requestChatNarrativeTrigger({...await command(), kind: 'player-response', sourceEventSequence: source.sequence})
    const before = await api.readProductRuntimeState(f.sessionId), skill = skills.getAgentSkillV1('character.chat-narrative-action-review')
    const action = {kind: 'speak', text: '我自己去检查门口。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    let expressionAndReviewCalls = 0
      const generated = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '隔离浏览器合同检查',
        runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async (messages: Array<{content: string}>) => {expressionAndReviewCalls++; if (!messages[1].content.includes('尚待本次行动核对的记忆修正')) throw new Error('修正未进入角色输入'); return JSON.stringify(action)}), runReviewAI: async () => {expressionAndReviewCalls++; return JSON.stringify({...fixture.chatActionReviewOutputFixture(),
          memoryChecks: [{memoryId: 'corrected', sourceSequence: correction.sequence, passed: true, reason: '注入的工程判定，不是模型质量证据。'}]})}})
      await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
      await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    const after = await api.readProductRuntimeState(f.sessionId)
    if (JSON.stringify(before.interaction.chatNarrative.situation) !== JSON.stringify(after.interaction.chatNarrative.situation)) throw new Error('核对改写了既有情境')
    const child = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '核对分支'})
    const nested = await api.branchProductRuntimeSession({parentSessionId: child.id, throughSequence: (await api.readProductRuntimeStateVersion(child.id)).sequence, title: '核对继承'})
    const expected = (await api.readProductRuntimeState(nested.id)).interaction
    await api.deleteProductRuntimeSession(child.id); await api.deleteProductRuntimeSession(f.sessionId)
    const projectId = await portable.importProjectJSON(await portable.exportProjectJSON(f.scope.projectId))
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {title: string}) => s.title === '核对继承')
    if (JSON.stringify((await api.readProductRuntimeState(imported.id)).interaction) !== JSON.stringify(expected)) throw new Error('便携核对记录发生变化')
    return {sessionId: imported.id, expected, expressionAndReviewCalls, productionBinding: skill.promptVersion}
  })
  expect(f.expressionAndReviewCalls).toBe(2)
  expect(f.productionBinding).toBe('chat-narrative-action-review-v42')
  expect(f.expected.chatNarrative.memoryReconciliations).toHaveLength(1)
  expect(f.expected.chatNarrative.memoryReconciliations[0].sourceSequence).toBeLessThan(0)
  await page.reload()
  const after = await page.evaluate(async sessionId => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const rules = await load('/storyforge/src/lib/character-interaction/memory-reconciliation.ts'), skills = await load('/storyforge/src/lib/agent/skill-registry.ts')
    const state = (await api.readProductRuntimeState(sessionId)).interaction
    return {state, pending: rules.pendingChatMemoryCorrectionsV1(state, 'guard'), productionBinding: skills.getAgentSkillV1('character.chat-narrative-action-review').promptVersion}
  }, f.sessionId)
  expect(after).toEqual({state: f.expected, pending: [], productionBinding: 'chat-narrative-action-review-v42'})
})

test('shows the exact delivered correction and shared evidence after adoption and reload without a new model call', async ({page}, info) => {
  let externalCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://correction.invalid/v1', model: 'test'}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://correction.invalid/**', async route => {externalCalls++; await route.abort()})
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const f = await fixture.seedChatNarrativeRuntimeFixture()
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const source = await api.commitInteractionPlayerMessage({...await command(), messageId: 'source', text: '我只是暂借地图，没有答应帮忙寻找铜印。'})
    await api.proposeInteractionMemory({...await command(), memoryId: 'old', participantKey: 'guard', kind: 'key-memory', content: '禁止显示的旧错误摘要', importance: 1, sourceEventSequences: [source.sequence], evidenceExcerpt: '没有答应帮忙'})
    const corrected = await api.correctChatMemory({...await command(), memoryId: 'old', replacementMemoryId: 'corrected', content: '玩家只是暂借地图，没有答应帮忙。', sourceEventSequences: [source.sequence], evidenceExcerpt: '没有答应帮忙', reason: '依照原话修正'})
    await api.requestChatNarrativeTrigger({...await command(), kind: 'player-response', sourceEventSequence: source.sequence})
    const generated = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '核对修正输入',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async () => JSON.stringify({kind: 'speak', text: '我自己去核对借用登记。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
        nextPossibilities: [{text: '自己核对借用登记。', evidenceFactKeys: ['lost']}]})),
      runReviewAI: async () => JSON.stringify({...fixture.chatActionReviewOutputFixture(), memoryChecks: [{memoryId: 'corrected', sourceSequence: corrected.sequence, passed: true, reason: '不可对玩家显示的审查理由。'}]})})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    return f
  })
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  const inspector = page.getByTestId('chat-context-inspector'), corrections = page.getByTestId('chat-context-corrections')
  await expect(corrections).toContainText('玩家只是暂借地图，没有答应帮忙。')
  await corrections.locator('summary').click()
  await expect(corrections).toContainText('我只是暂借地图，没有答应帮忙寻找铜印。')
  await inspector.locator('summary').filter({hasText: '已确认记忆的选入与省略'}).click()
  await expect(inspector).toContainText('这条修正尚待行动核对，本次完整保留')
  for (const secret of ['禁止显示的旧错误摘要', '不可对玩家显示的审查理由', '柜台下', '担心再次错怪人']) await expect(inspector).not.toContainText(secret)
  await page.setViewportSize({width: 390, height: 844})
  await corrections.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('memory-correction-mobile.png')})
  const history = await corrections.innerText()
  await page.reload()
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  await corrections.locator('summary').click()
  expect(await corrections.innerText()).toBe(history)
  expect(externalCalls).toBe(0)
})
