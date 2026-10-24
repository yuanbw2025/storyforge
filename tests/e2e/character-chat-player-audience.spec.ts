import {test, expect} from '@playwright/test'

test('a returning role cannot read a player message sent while absent, including after portable restore', async ({page}) => {
  let externalCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.removeItem('storyforge-ai-config')
  })
  await page.route('**/chat/completions', async route => {externalCalls++; await route.abort()})
  await page.route('**/local-codex/v1/requests', async route => {externalCalls++; await route.abort()})
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const v = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.leaveInteractionParticipant({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, participantKey: 'artisan'})
    return f
  })
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  const privateText = '程素不在，我只向在场的叶岑提起青色线轴。'
  await page.getByLabel('发送给角色的消息', {exact: true}).fill(privateText)
  await page.getByRole('button', {name: '仅保存消息', exact: true}).click()
  await expect(page.getByRole('article').getByText(privateText, {exact: true})).toBeVisible()
  const result = await page.evaluate(async ({f, privateText}) => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts'), helpers = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts'), portable = await load('/storyforge/src/lib/export/json-export.ts')
    const command = async (id: number) => {const v = await api.readProductRuntimeStateVersion(id); return {sessionId: id, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const before = await api.readProductRuntimeState(f.sessionId)
    if (JSON.stringify(before.interaction.messages[0].audienceKeys) !== JSON.stringify(['player', 'guard'])) throw new Error('Player UI did not freeze actual listeners')
    if (before.interaction.messages[0].playerConversation !== 'present') throw new Error('Public UI conversation was reclassified as private because another role was absent')
    await api.joinInteractionParticipant({...await command(f.sessionId), participantKey: 'artisan'})
    const title = (await db.productRuntimeSessions.get(f.sessionId)).title
    const projectId = await portable.importProjectJSON(await portable.exportProjectJSON(f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {title: string}) => s.title === title)
    const scope = {projectId, worldId: session.worldId, workId: session.workId}
    const version = await command(session.id)
    await api.requestChatNarrativeTrigger({...version, kind: 'continue', sourceEventSequence: version.baseSequence, direction: {actorKey: 'artisan', actionLimit: 1}})
    let expressionAndReviewCalls = 0
    const candidate = await harness.generateInteractionRuntimeCandidateV1({scope, productRuntimeSessionId: session.id, participantKey: 'artisan', skillId: 'character.chat-narrative-action', objective: 'Returning participant visibility engineering check',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async (messages: Array<{content: string}>) => {
        expressionAndReviewCalls++
        if (messages.some(message => message.content.includes(privateText))) throw new Error('Returning role heard the absent dialogue')
        return JSON.stringify({kind: 'speak', text: '天黑后不宜搬动倒树，我先考虑白天可行的办法。', goalKey: 'fix-road', evidenceFactKeys: ['road'], audienceKeys: ['artisan', 'player'], waitingForPlayer: false,
          newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
      }), runReviewAI: async () => {expressionAndReviewCalls++; return JSON.stringify(helpers.chatActionReviewOutputFixture())}})
    await harness.adoptInteractionRuntimeCandidateV1({scope, runId: candidate.snapshot.run.id})
    return {sessionId: session.id, scope, state: await api.readProductRuntimeState(session.id), expressionAndReviewCalls}
  }, {f, privateText})
  expect(result.expressionAndReviewCalls).toBe(2)
  await page.goto(`./chat/play?project=${result.scope.projectId}&work=${result.scope.workId}&session=${result.sessionId}`)
  await expect(page.getByRole('article').getByText(privateText, {exact: true})).toBeVisible()
  await page.reload()
  const after = await page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)}, result.sessionId)
  expect(after).toEqual(result.state)
  expect(after.interaction.messages[0].playerConversation).toBe('present')
  expect(externalCalls).toBe(0)
})
