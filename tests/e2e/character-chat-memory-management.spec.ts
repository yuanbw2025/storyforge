import {test, expect, type Page} from '@playwright/test'

test.beforeEach(async ({page}) => {await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))})
async function seed(page: Page, legacy = false) {
  await page.goto('./chat/library')
  return page.evaluate(async legacy => {
    const load = new Function('p', 'return import(p)')
    const f = legacy ? await (await load('/storyforge/tests/helpers/character-chat-fixture.ts')).seedChatRuntimeFixture()
      : await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxMemoryEntries: 1})
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const v = await api.readProductRuntimeStateVersion(f.sessionId)
    const message = await api.commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'friday', text: '我约好周五再来。'})
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    await api.proposeInteractionMemory({...await command(), memoryId: 'original', participantKey: legacy ? 'aria' : 'guard', kind: 'commitment', content: 'PRIVATE-UNREVIEWED-BODY：错记周二，夹带角色内心。', importance: 70,
      sourceEventSequences: [message.sequence], evidenceExcerpt: '周五再来'})
    await api.resolveInteractionMemory({...await command(), memoryId: 'original', resolution: 'accepted'})
    if (!legacy) await api.proposeInteractionMemory({...await command(), memoryId: 'proposed', participantKey: 'guard', kind: 'key-memory', content: 'PRIVATE-PROPOSAL-BODY：不应显示或预填。', importance: 50,
      sourceEventSequences: [message.sequence], evidenceExcerpt: '周五再来'})
    return f as {scope: {projectId: number; workId: number; worldId: number | null}; sessionId: number}
  }, legacy)
}
async function open(page: Page, f: Awaited<ReturnType<typeof seed>>) {
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await expect(page.getByTestId('chat-memory-panel')).toBeVisible()
}

test('corrects from public sources, keeps disabled state, restores and revokes; manually rewrites legacy proposals with portable branch history', async ({page}, info) => {
  test.setTimeout(120000)
  let calls = 0
  await page.route(/\/chat\/completions|\/api\/local-codex\/generate/, async route => {calls++; await route.abort()})
  const f = await seed(page); await open(page, f)
  const panel = page.getByTestId('chat-memory-panel'), editor = page.getByTestId('chat-memory-editor')
  await expect(panel).not.toContainText('PRIVATE-')
  await panel.getByRole('button', {name: '修正记忆', exact: true}).click()
  await expect(editor.getByLabel('修正后的记忆', {exact: true})).toHaveValue('')
  await expect(editor).toContainText('我约好周五再来。')
  await editor.getByLabel('修正后的记忆', {exact: true}).fill('我们约定周五再见。')
  await editor.getByLabel('原消息摘录', {exact: true}).fill('周二')
  await expect(editor.getByRole('button', {name: '保存修正', exact: true})).toBeDisabled()
  await editor.getByLabel('原消息摘录', {exact: true}).fill('周五再来')
  await page.setViewportSize({width: 390, height: 844})
  await editor.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('memory-editor-mobile.png')})
  await editor.getByRole('button', {name: '保存修正', exact: true}).click()
  await expect(editor).toHaveCount(0)
  let card = panel.getByTestId('chat-memory-entry').filter({has: page.getByText('我们约定周五再见。', {exact: true})})
  await expect(card).toContainText('使用中')
  await card.getByRole('button', {name: '停用', exact: true}).click()
  await expect(card).toContainText('已停用')
  await card.getByRole('button', {name: '修正记忆', exact: true}).click()
  await expect(editor.getByLabel('修正后的记忆', {exact: true})).toHaveValue('我们约定周五再见。')
  await editor.getByLabel('修正后的记忆', {exact: true}).fill('玩家表示周五再来。')
  await editor.getByRole('button', {name: '保存修正', exact: true}).click()
  card = panel.getByTestId('chat-memory-entry').filter({has: page.getByText('玩家表示周五再来。', {exact: true})})
  await expect(card).toContainText('已停用')
  await card.getByRole('button', {name: '恢复使用', exact: true}).click()
  await expect(card).toContainText('使用中')
  await page.reload(); await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await expect(card).toContainText('使用中')
  await card.getByRole('button', {name: '撤回并保留历史', exact: true}).click()
  await expect(panel.getByText('玩家表示周五再来。', {exact: true})).toBeHidden()
  await panel.getByRole('button', {name: '依据原消息修正并采用', exact: true}).click()
  await expect(editor.getByLabel('修正后的记忆', {exact: true})).toHaveValue('')
  await editor.getByLabel('修正后的记忆', {exact: true}).fill('只记下玩家约定周五再来。')
  await editor.getByRole('button', {name: '保存修正并采用', exact: true}).click()
  await expect(panel.getByText('只记下玩家约定周五再来。', {exact: true})).toBeVisible()
  await panel.getByText('历史记录（4）', {exact: true}).click()
  await expect(panel).toContainText('已撤回')
  await expect(panel).not.toContainText('PRIVATE-')
  await panel.locator('[data-memory-id="original"]').getByRole('button', {name: '查看修正后的条目'}).click()
  const firstCorrection = panel.getByTestId('chat-memory-entry').filter({has: page.getByText('我们约定周五再见。', {exact: true})})
  await expect(firstCorrection).toBeFocused()
  await firstCorrection.getByRole('button', {name: '查看修正后的条目'}).click()
  await expect(panel.getByTestId('chat-memory-entry').filter({has: page.getByText('玩家表示周五再来。', {exact: true})})).toBeFocused()
  const child = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const child = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await api.readProductRuntimeStateVersion(f.sessionId)).sequence, title: '记忆分支'})
    await api.deleteProductRuntimeSession(f.sessionId)
    return child.id as number
  }, f)
  await open(page, {...f, sessionId: child})
  await panel.getByRole('button', {name: '修正记忆', exact: true}).click()
  await expect(editor).toContainText('我约好周五再来。')
  await editor.getByLabel('修正后的记忆', {exact: true}).fill('分支中仍保留周五约定。')
  await editor.getByRole('button', {name: '保存修正', exact: true}).click()
  await expect(editor).toHaveCount(0)
  const branchCorrection = panel.getByTestId('chat-memory-entry').filter({has: page.getByText('分支中仍保留周五约定。', {exact: true})})
  await expect(branchCorrection).toContainText('使用中')
  const recalled = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const state = (await api.readProductRuntimeState(id)).interaction
    const context = (await load('/storyforge/src/lib/character-interaction/runtime.ts')).buildInteractionContextWindow(state, 'guard')
    return {contents: context.memories.map((m: {content: string}) => m.content), source: state.memories.at(-1).sourceEventSequences[0]}
  }, child)
  expect(recalled.contents).toEqual(['分支中仍保留周五约定。']); expect(recalled.source).toBeLessThan(0)
  expect(calls).toBe(0)
})

test('retains a typed correction when another page changes memory and requires a fresh source check', async ({page, context}) => {
  const f = await seed(page); await open(page, f)
  const panel = page.getByTestId('chat-memory-panel'), editor = page.getByTestId('chat-memory-editor')
  await panel.getByRole('button', {name: '修正记忆', exact: true}).click()
  await editor.getByLabel('修正后的记忆', {exact: true}).fill('保留我的修正：周五再来。')
  const other = await context.newPage()
  try {
    await open(other, f)
    await other.getByTestId('chat-memory-panel').getByRole('button', {name: '停用', exact: true}).click()
    await expect(other.getByTestId('chat-memory-panel')).toContainText('已停用')
    await editor.getByRole('button', {name: '保存修正', exact: true}).click()
    await expect(panel.getByRole('alert')).toContainText('聊天或记忆已变化')
    await expect(editor.getByLabel('修正后的记忆', {exact: true})).toHaveValue('保留我的修正：周五再来。')
    await editor.getByRole('button', {name: '重新核对来源', exact: true}).click()
    await expect(editor).toContainText('保存后仍保持停用')
    await expect(editor.getByLabel('修正后的记忆', {exact: true})).toHaveValue('保留我的修正：周五再来。')
    await editor.getByRole('button', {name: '保存修正', exact: true}).click()
    const corrected = panel.getByTestId('chat-memory-entry').filter({hasText: '保留我的修正：周五再来。'})
    await expect(corrected).toContainText('已停用')
    await page.reload(); await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
    await expect(corrected).toContainText('已停用')
  } finally {await other.close()}
})

test('existing chat sessions can stop, restore and revoke legacy memory without enabling narrative mode', async ({page}) => {
  const f = await seed(page, true); await open(page, f)
  const panel = page.getByTestId('chat-memory-panel')
  await panel.getByRole('button', {name: '停用', exact: true}).click()
  await expect(panel).toContainText('已停用')
  await panel.getByRole('button', {name: '恢复使用', exact: true}).click()
  await expect(panel).toContainText('使用中')
  await panel.getByRole('button', {name: '撤回并保留历史', exact: true}).click()
  await panel.getByText('历史记录（1）', {exact: true}).click()
  await expect(panel).toContainText('已撤回')
  await expect(panel).not.toContainText('PRIVATE-')
  await page.reload(); await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await panel.getByText('历史记录（1）', {exact: true}).click()
  await expect(panel).toContainText('已撤回')
})

test('pins a player-corrected memory, retains its historical input evidence, and preserves the pin across correction and temporary disable', async ({page}, info) => {
  let externalCalls = 0
  await page.route(/\/chat\/completions|\/api\/local-codex\/generate/, async route => {externalCalls++; await route.abort()})
  const f = await seed(page); await open(page, f)
  const panel = page.getByTestId('chat-memory-panel'), editor = page.getByTestId('chat-memory-editor')
  await expect(panel.getByRole('button', {name: '固定为必读记忆', exact: true})).toBeDisabled()
  await panel.getByRole('button', {name: '修正记忆', exact: true}).click()
  await editor.getByLabel('修正后的记忆', {exact: true}).fill('玩家约定周五再来。')
  await editor.getByRole('button', {name: '保存修正', exact: true}).click()
  await panel.getByRole('button', {name: '固定为必读记忆', exact: true}).click()
  await expect(panel).toContainText('已固定 · 使用期间每轮保留')
  const calls = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts'), fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const v = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'continue', sourceEventSequence: v.sequence})
    const state = (await api.readProductRuntimeState(f.sessionId)).interaction
    const corrected = state.memories.filter((m: {authorship?: string; content: string; supersededByMemoryId: string | null}) => m.authorship === 'player-correction' && m.content === '玩家约定周五再来。' && m.supersededByMemoryId == null)
    if (corrected.length !== 1) throw new Error('缺少当前真实记忆修正')
    const memory = corrected[0]
    let calls = 0
    const result = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '固定记忆页面工程检查',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async (messages: unknown) => {calls++; if (!JSON.stringify(messages).includes('玩家约定周五再来。')) throw new Error('固定记忆未送入实际输入')
        return JSON.stringify({kind: 'speak', text: '我先查看门边，再核对铜印的去向。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}),
      runReviewAI: async (messages: unknown) => {
        calls++
        if (!JSON.stringify(messages).includes('我约好周五再来。')) throw new Error('修正原话未送入审查')
        return JSON.stringify({...fixture.chatActionReviewOutputFixture(), memoryChecks: [{memoryId: memory.memoryId, sourceSequence: memory.proposalSequence, passed: true, reason: '查看门边不改变周五再来的约定，也未要求玩家提前参与。'}]})
      }})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
    const after = (await api.readProductRuntimeState(f.sessionId)).interaction
    if (!after.chatNarrative.memoryReconciliations?.some((r: {memoryId: string; sourceSequence: number}) => r.memoryId === memory.memoryId && r.sourceSequence === memory.proposalSequence)) throw new Error('修正核对未随实际行动提交')
    // Once the correction has been processed, pinning itself must keep it in
    // the next actual input. The first request was required by correction.
    const next = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: next.sequence, baseStateHash: next.stateHash, kind: 'continue', sourceEventSequence: next.sequence})
    const pinned = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '已核对记忆继续按固定读取',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async (messages: unknown) => {
        calls++
        if (!JSON.stringify(messages).includes('玩家约定周五再来。')) throw new Error('核对之后的固定记忆未送入实际输入')
        return JSON.stringify({kind: 'speak', text: '接下来我想核对门口的脚印。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
      }), runReviewAI: async () => {calls++; return JSON.stringify(fixture.chatActionReviewOutputFixture())}})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: pinned.snapshot.run.id})
    return calls
  }, f)
  expect(calls).toBe(4)
  await open(page, f)
  await expect(panel).toContainText('已固定 · 使用期间每轮保留')
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  const inspection = page.getByTestId('chat-context-inspector')
  await inspection.locator('summary').filter({hasText: '已确认记忆的选入与省略'}).click()
  await expect(inspection).toContainText('由你固定，每轮保留')
  await expect(inspection).toContainText('玩家约定周五再来。')
  await panel.getByRole('button', {name: '停用', exact: true}).click()
  await panel.getByRole('button', {name: '修正记忆', exact: true}).click()
  await editor.getByLabel('修正后的记忆', {exact: true}).fill('约定的日期是周五。')
  await editor.getByRole('button', {name: '保存修正', exact: true}).click()
  const card = panel.getByTestId('chat-memory-entry').filter({has: page.getByText('约定的日期是周五。', {exact: true})})
  await expect(card).toContainText('已停用')
  await expect(card).toContainText('已固定')
  await card.getByRole('button', {name: '恢复使用', exact: true}).click()
  await card.getByRole('button', {name: '取消固定', exact: true}).click()
  await expect(card).not.toContainText('已固定')
  await expect(card).toContainText('使用中')
  await open(page, f)
  await expect(card).not.toContainText('已固定')
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  await inspection.locator('summary').filter({hasText: '已确认记忆的选入与省略'}).click()
  await expect(inspection).toContainText('由你固定，每轮保留')
  await expect(inspection).toContainText('玩家约定周五再来。')
  await expect(inspection).not.toContainText('约定的日期是周五。')
  await page.setViewportSize({width: 390, height: 844}); await panel.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('memory-pin-mobile.png')})
  expect(externalCalls).toBe(0)
})
