import {test, expect} from '@playwright/test'

test('portable promise replacement keeps both public versions after branch and parent deletion', async ({page}, info) => {
  test.setTimeout(120000)
  let calls = 0
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/\/chat\/completions|\/api\/local-codex\/generate/, async route => {calls++; await route.abort()})
  await page.goto('./chat/library')
  const result = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const fixture = await load('/storyforge/tests/helpers/chat-commitment-fixture.ts')
    const f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const run = async (action: unknown) => {
      const result = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '约定工程核验',
        runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(fixture.chatCommitmentReviewOutputFixture(action))})
      await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
    }
    await api.requestChatNarrativeTrigger({...await command(), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
    await run(fixture.chatPromiseActionFixture())
    const made = await api.readProductRuntimeState(f.sessionId), original = made.interaction.chatNarrative.situation.goals[0].commitments[0]
    await api.requestChatNarrativeTrigger({...await command(), kind: 'continue', sourceEventSequence: made.lastSequence})
    const withdrawal = '我撤回检查后门后向你报告的约定。', terms = '我改为明晨先检查门闩再报告，你不必等我。'
    const action = {...fixture.chatPromiseActionFixture(terms), text: withdrawal + terms, commitmentEffects: [
      {kind: 'withdraw', commitmentKey: original.commitmentKey, evidenceExcerpt: withdrawal},
      {kind: 'promise', terms, evidenceExcerpt: terms},
    ]}
    await run(action)
    const child = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await api.readProductRuntimeStateVersion(f.sessionId)).sequence, title: '改约记录分支'})
    const expected = (await api.readProductRuntimeState(child.id)).interaction
    await api.deleteProductRuntimeSession(f.sessionId)
    const portable = await load('/storyforge/src/lib/export/json-export.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const projectId = await portable.importProjectJSON(await portable.exportProjectJSON(f.scope.projectId))
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {title: string}) => s.title === child.title)
    const restored = (await api.readProductRuntimeState(imported.id)).interaction
    return {projectId, workId: imported.workId, sessionId: imported.id, oldTerms: original.terms, terms, withdrawal, equal: JSON.stringify(restored) === JSON.stringify(expected)}
  })
  expect(result.equal).toBe(true)
  await page.goto(`./chat/play?project=${result.projectId}&work=${result.workId}&session=${result.sessionId}`)
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  const panel = page.getByTestId('chat-commitment-panel')
  await expect(panel).toContainText(result.terms)
  await panel.getByText('已处理的约定（1）', {exact: true}).click()
  await expect(panel).toContainText('已撤回')
  await expect(panel).toContainText(result.oldTerms)
  await expect(panel).toContainText(result.withdrawal)
  await expect(panel).not.toContainText('担心再次错怪人')
  await panel.getByTestId('chat-commitment-entry').filter({hasText: '已撤回'}).getByText('查看原话', {exact: true}).click()
  await page.setViewportSize({width: 390, height: 844})
  await panel.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('replacement-mobile.png')})
  await page.reload(); await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await expect(panel).toContainText(result.terms)
  expect(calls).toBe(0)
})
