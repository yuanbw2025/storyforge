import { expect, test } from '@playwright/test'

/** Native isolated IndexedDB/API, not public player UI or real-model quality evidence. */
test('a paid private discovery survives reload and shares only attributed hearsay to the selected actor', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-knowledge.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const coordinator = await importer('/storyforge/src/lib/ttrpg/open-operation-coordinator.ts')
    const fixture = await helper.setup({ private: true, generic: true, failForward: true })
    const command = await helper.start(fixture)
    const resourceKey = fixture.runtimePackage.ttrpg.rulePack.content.resources[0].key
    const before = await core.readProductRuntimeState(fixture.sessionId)
    await coordinator.resumeTtrpgOpenOperationV1(command)
    return { scope: fixture.scope, command, resourceKey, beforeResource: before.entities.hero.attributes[`resource.${resourceKey}`],
      state: await core.readProductRuntimeState(fixture.sessionId), runtimeSourceHash: fixture.session.runtimeSourceHash }
  })
  expect(initial.state.ttrpg.openRun.knowledge).toHaveLength(1)
  expect(initial.state.entities.hero.attributes[`resource.${initial.resourceKey}`]).toBe(initial.beforeResource - 1)
  await page.reload()
  const restored = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    await (await importer('/storyforge/src/lib/ttrpg/open-operation-coordinator.ts')).resumeTtrpgOpenOperationV1(fixture.command)
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(fixture.command.sessionId)
  }, initial)
  expect(restored).toEqual(initial.state)
  const shared = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const sharing = await importer('/storyforge/src/lib/ttrpg/open-knowledge-share.ts')
    const actors = await importer('/storyforge/src/lib/ttrpg/open-player-context.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const source = fixture.state.ttrpg.openRun.knowledge[0], envelope = await helper.openEnvelopeV1(fixture.command.sessionId, 'browser.share')
    const request = { actorKey: 'hero', sourceKnowledgeKey: source.knowledgeKey, audience: 'private',
      recipientActorKeys: ['companion.1'], publicFieldsHash: source.publicFieldsHash }
    const input = { ...envelope, viewerKey: helper.OPEN_HUMAN_VIEWER, request,
      confirmationHash: await sharing.hashTtrpgOpenKnowledgeShareConfirmationV1({ request, viewerKey: helper.OPEN_HUMAN_VIEWER,
        baseStateHash: envelope.baseStateHash, runtimeSourceHash: fixture.runtimeSourceHash }) }
    const event = await commands.shareTtrpgOpenKnowledgeV1(input)
    return { event, duplicate: await commands.shareTtrpgOpenKnowledgeV1(input), state: await core.readProductRuntimeState(fixture.command.sessionId),
      listener: (await actors.loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.command.sessionId, actorKey: 'companion.1' })).view.knowledge,
      outsider: (await actors.loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.command.sessionId, actorKey: 'companion.2' })).view.knowledge }
  }, initial)
  expect(shared.duplicate).toEqual(shared.event)
  expect(shared.listener).toHaveLength(1)
  expect(shared.listener[0].reliability).toBe('hearsay')
  expect(shared.outsider).toEqual([])
  expect(shared.state.ttrpg.openRun.knowledge[0]).toEqual(initial.state.ttrpg.openRun.knowledge[0])
  expect(shared.state.entities).toEqual(initial.state.entities)
  expect(shared.state.ttrpg.openRun.worldTime).toEqual(initial.state.ttrpg.openRun.worldTime)
  await page.reload()
  const final = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId)
  }, initial.command.sessionId)
  expect(final).toEqual(shared.state)
})

test('a human discovery cost choice persists across reload before one causal settlement', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-knowledge.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const env = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const fixture = await helper.setup({ cost: true, private: true }, (pkg: any) => {
      const cost = pkg.ttrpg.campaign.effectPlanTemplates.find((t: any) => t.planKey === 'plan.discovery.cost')
      cost.alternatives = [{ alternativeKey: 'pay', title: '支付代价', effects: cost.effects }, { alternativeKey: 'other', title: '另一个代价', effects: cost.effects }]
      cost.effects = []
    })
    const command = await helper.start(fixture), resourceKey = fixture.runtimePackage.ttrpg.rulePack.content.resources[0].key
    const before = await core.readProductRuntimeState(fixture.sessionId), waiting = await api.resumeTtrpgOpenOperationV1(command)
    const state = await core.readProductRuntimeState(fixture.sessionId), op = state.ttrpg.openRun.operations[0]
    const disclosure = await api.prepareTtrpgOpenPrivateChoiceDisclosureV1({ sessionId: fixture.sessionId,operationKey: op.operationKey,frozenPlanHash: op.planHash,viewerKey: env.OPEN_HUMAN_VIEWER,kind: 'knowledge',templateKey: 'plan.discovery.cost' })
    await api.discloseTtrpgOpenPrivateChoiceV1({ ...await env.openEnvelopeV1(fixture.sessionId,await api.ttrpgOpenOperationCommandIdV1(state.ttrpg.sessionKey,op.operationKey,`private-disclosure.${disclosure.reviewHash}`)),operationKey: op.operationKey,frozenPlanHash: op.planHash,viewerKey: env.OPEN_HUMAN_VIEWER,kind: 'knowledge',templateKey: 'plan.discovery.cost',reviewHash: disclosure.reviewHash })
    const input = { ...await env.openEnvelopeV1(fixture.sessionId, await api.ttrpgOpenOperationCommandIdV1(state.ttrpg.sessionKey, op.operationKey, 'knowledge-choice.plan.discovery.cost')),
      ...command, templateKey: 'plan.discovery.cost', alternativeKey: 'pay', riskHash: op.riskHash,disclosureHash: disclosure.reviewHash }
    const event = await api.selectTtrpgOpenDiscoveryEffectV1(input)
    return { command, resourceKey, beforeResource: before.entities.hero.attributes[`resource.${resourceKey}`], waiting, event,
      state: await core.readProductRuntimeState(fixture.sessionId) }
  })
  expect(initial.waiting).toMatchObject({ status: 'awaiting-choice', nextStepKey: 'knowledge' })
  expect(initial.state.ttrpg.openRun.knowledge).toEqual([])
  expect(initial.state.entities.hero.attributes[`resource.${initial.resourceKey}`]).toBe(initial.beforeResource)
  await page.reload()
  const resumed = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const before = await core.readProductRuntimeState(fixture.command.sessionId)
    const result = await api.resumeTtrpgOpenOperationV1(fixture.command)
    const after = await core.readProductRuntimeState(fixture.command.sessionId)
    await api.resumeTtrpgOpenOperationV1(fixture.command)
    return { before, result, after, repeated: await core.readProductRuntimeState(fixture.command.sessionId) }
  }, initial)
  expect(resumed.before).toEqual(initial.state)
  expect(resumed.result).toEqual({ status: 'awaiting-owner', nextStepKey: 'pressure' })
  expect(resumed.after.ttrpg.openRun.knowledge).toHaveLength(1)
  expect(resumed.after.entities.hero.attributes[`resource.${initial.resourceKey}`]).toBe(initial.beforeResource - 1)
  expect(resumed.repeated).toEqual(resumed.after)
})
