import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { createCurrentTtrpgRuntimePackageFixture } from '../helpers/current-ttrpg-runtime-package'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import * as scenarioFixtures from '../helpers/ttrpg-authored-scenario'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { parseRulePackV1 } from '../../src/lib/ttrpg/rule-pack'
import { assertInitialTtrpgProductStateV1 } from '../../src/lib/ttrpg/runtime'
import { createTtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'
import {
  advanceTtrpgCharacterV1, commitTtrpgDeterministicFallbackV1, commitTtrpgEffectPlanV2,
  commitTtrpgHumanGmNarrationV1, completeTtrpgSessionZero, openTtrpgCampaignScene, resolveTtrpgRuleAction,
} from '../../src/lib/ttrpg/runtime-commands'
import {
  applyProductRuntimeEvent, branchProductRuntimeSession, parseProductRuntimeState, readProductRuntimeState, readProductRuntimeStateVersion,
  readSessionEvents, replayProductRuntimeEvents,
} from '../../src/lib/product/runtime-core'

async function ready(origin: 'builtin-storyforge' | 'builtin-d20-fantasy' = 'builtin-storyforge', actions = 1, phase?: 'free' | 'reaction' | 'downtime', legacyNpcSheet = false) {
  const owner = await seedCurrentProductWorld('SFQA scripted command controls')
  const release = owner.release
  if (!release.id) throw new Error('Expected a real frozen world')
  const worldRelease = { ...release, id: release.id }
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({ scope: owner.scope, worldReleaseId: release.id, productType: 'ttrpg' })
  let runtimePackage = await createCurrentTtrpgRuntimePackageFixture({ scope: owner.scope, worldRelease,
    sourceCatalog, playerController: 'human', gmMode: 'human', authoredScenario: true, ruleOrigin: origin })
  if (!runtimePackage.ttrpg) throw new Error('Expected scripted TTRPG content')
  // Author a legal frozen multi-action variant before creating the Build.
  // The application rule/receipt parsers still validate every byte and hash.
  if (actions !== 1 || phase) {
    runtimePackage.ttrpg.rulePack.content.turnStructure.actionsPerTurn = actions
    if (phase) {
      const action = runtimePackage.ttrpg.rulePack.content.actions.find(action => action.phase === 'action' && action.target === 'scene' && action.effects.some(effect => effect.kind === 'check'))
      if (!action) throw new Error('Expected an existing check action to author the legal phase variant')
      action.phase = phase
    }
    runtimePackage.ttrpg.rulePack.content = parseRulePackV1(runtimePackage.ttrpg.rulePack.content)
    runtimePackage.ttrpg.rulePack.contentHash = await hashProductProductionValueV2(runtimePackage.ttrpg.rulePack.content)
    runtimePackage = parseProductRuntimePackageV1(runtimePackage)
  }
  if (legacyNpcSheet) {
    if (!runtimePackage.ttrpg) throw new Error('Expected the validated TTRPG package')
    for (const actor of runtimePackage.ttrpg.campaign.characterTemplates.filter(actor => actor.role === 'npc')) {
      if (!actor.characterSheet) throw new Error('Expected the original generated NPC sheet')
      actor.characterSheet.rules.progression.level = 1
    }
    runtimePackage = parseProductRuntimePackageV1(runtimePackage)
  }
  const ttrpg = runtimePackage.ttrpg
  if (!ttrpg) throw new Error('Expected validated scripted TTRPG content')
  const made = await seedCurrentProductBuild({ scope: owner.scope, worldRelease, runtimePackage,
    title: 'SFQA scripted command controls', seed: 'sfqa-scripted-deterministic' })
  const sessionId = made.session.id
  if (!sessionId) throw new Error('Expected a real product instance')
  const envelope = async (commandId: string) => {
    const version = await readProductRuntimeStateVersion(sessionId)
    return { sessionId, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash }
  }
  const initial = await readProductRuntimeState(sessionId)
  if (!initial.ttrpg) throw new Error('Expected scripted runtime state')
  await completeTtrpgSessionZero({ ...await envelope('scripted.zero'), acceptedItemKeys: initial.ttrpg.product.sessionZero.requiredItemKeys,
    selectedCharacterKeys: ttrpg.campaign.characterTemplates.filter(actor => actor.role === 'player').map(actor => actor.characterKey), completedBy: 'viewer.gm' })
  await openTtrpgCampaignScene({ ...await envelope('scripted.scene'), sceneKey: ttrpg.campaign.openingSceneKey })
  return { ...owner, ...made, runtimePackage, ttrpg, sessionId, envelope }
}
type Fixture = Awaited<ReturnType<typeof ready>>

async function act(f: Fixture, commandId = 'scripted.action') {
  const state = await readProductRuntimeState(f.sessionId)
  const actorKey = state.ttrpg?.activeActorKey
  const scene = f.ttrpg.campaign.scenes.find(row => row.sceneKey === state.ttrpg?.scene?.sceneKey)
  if (!actorKey || !scene) throw new Error('Expected an active actor and scene')
  const actionKey = scene.actionKeys.find(key => f.ttrpg.rulePack.content.actions.some(action => action.key === key && action.target === 'scene' && action.phase === 'action'))
  if (!actionKey) throw new Error('Expected an authored legal scene action')
  return resolveTtrpgRuleAction({ ...await f.envelope(commandId), actorKey, actionKey, targetKey: null })
}
async function assertReplayAndReopen(f: Fixture) {
  const state = await readProductRuntimeState(f.sessionId)
  const session = await db.productRuntimeSessions.get(f.sessionId)
  if (!session) throw new Error('Expected the original instance')
  expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), await readSessionEvents(session))).toEqual(state)
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
}
async function awardXp(f: Fixture, characterKey: string) {
  const state = await readProductRuntimeState(f.sessionId)
  const envelope = await f.envelope('scripted.xp')
  return commitTtrpgEffectPlanV2({ ...envelope, plan: {
    schema: 'storyforge.ttrpg-effect-plan', version: 2, planKey: 'scripted.xp-award',
    sourceEventId: `event.${state.lastSequence}`, ruleRef: 'scripted.manual-award', degree: 'success',
    reason: 'Explicit deterministic GM experience award', audience: 'party', status: 'immediate',
    effects: [{ effectKey: 'scripted.xp', family: 'advancement', operation: 'xp', advancementKey: 'xp', targetRef: characterKey, amount: 50 }],
    idempotencyKey: envelope.commandId,
  } })
}

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No real model or network authorized') }))
})
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() }
})

describe('SFQA074/075/076 real scripted command and replay closure', () => {
  it.each(['human-gm', 'deterministic-fallback'] as const)('074: the existing %s command commits an explicit empty model ledger', async source => {
    const f = await ready()
    const action = await act(f)
    const before = await readProductRuntimeState(f.sessionId)
    const event = source === 'human-gm'
      ? await commitTtrpgHumanGmNarrationV1({ ...await f.envelope('scripted.human'), actionSequence: action.sequence, gmKey: 'gm', text: '角色根据已经结算的结果作出回应。' })
      : await commitTtrpgDeterministicFallbackV1({ ...await f.envelope('scripted.fallback'), actionSequence: action.sequence })
    expect(JSON.parse(event.payloadJson)).toMatchObject({ source, modelEvidence: null, modelCalls: [], repairApplied: false })
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.ttrpg?.product.gmNarrations).toHaveLength(1)
    expect(after.entities).toEqual(before.entities)
    expect(after.ttrpg?.product.actionHistory).toEqual(before.ttrpg?.product.actionHistory)
    await assertReplayAndReopen(f)
  })

  it('075: the first of two authorized actions retains the actor and its remaining action', async () => {
    const f = await ready('builtin-storyforge', 2)
    const before = await readProductRuntimeState(f.sessionId)
    const actorKey = before.ttrpg?.activeActorKey
    if (!actorKey) throw new Error('Expected the active actor')
    const event = await act(f)
    expect(JSON.parse(event.payloadJson).result.nextActorKey).toBeNull()
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.ttrpg?.activeActorKey).toBe(actorKey)
    expect(after.ttrpg?.round).toBe(before.ttrpg?.round)
    expect(after.ttrpg?.product.actionEconomy.budgets[actorKey]?.actionsRemaining).toBe(1)
    await assertReplayAndReopen(f)
  })

  it('076: paid d20 advancement updates the real entity level and resource mechanics with progression', async () => {
    const f = await ready('builtin-d20-fantasy')
    const characterKey = f.ttrpg.campaign.characterTemplates.find(actor => actor.role === 'player')?.characterKey
    if (!characterKey) throw new Error('Expected the selected player')
    await awardXp(f, characterKey)
    const before = await readProductRuntimeState(f.sessionId)
    const progression = before.ttrpg?.product.characterProgression[characterKey]
    const cost = f.ttrpg.rulePack.content.advancement.levelIncreaseCost
    if (progression?.level == null || cost == null) throw new Error('Expected d20 level progression')
    for (let index = 0; index < 2; index++) await advanceTtrpgCharacterV1({ ...await f.envelope(`scripted.level.${index}`), characterKey, kind: 'level', targetKey: 'level' })
    const after = await readProductRuntimeState(f.sessionId)
    const level = progression.level + 2
    const attributes = after.entities[characterKey].attributes
    expect(after.ttrpg?.product.characterProgression[characterKey]).toMatchObject({ level, spentCurrency: progression.spentCurrency + cost * 2 })
    expect(attributes.level).toBe(level)
    expect(attributes['resourceMax.vigor']).toBe(8 + level * 5 + Math.floor((Number(attributes.constitution) - 10) / 2))
    expect(attributes['resourceMax.heroic-dice']).toBe(1 + Math.floor(level / 4))
    await assertReplayAndReopen(f)
  })

  it('074 additional: AI responses still require a model ledger and an existing zero-model decision remains idempotent', async () => {
    const f = await ready(), action = await act(f)
    const before = await readProductRuntimeState(f.sessionId)
    const input = { ...await f.envelope('scripted.narration.once'), actionSequence: action.sequence }
    const event = await commitTtrpgDeterministicFallbackV1(input)
    const payload: Record<string, unknown> = JSON.parse(event.payloadJson)
    delete payload.modelCalls
    payload.source = 'ai-confirmed'; payload.candidateHash = 'a'.repeat(64); payload.runId = 1
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/缺少模型调用账本/)
    const after = await readProductRuntimeState(f.sessionId)
    expect(await commitTtrpgDeterministicFallbackV1(input)).toEqual(event)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
    await expect(commitTtrpgHumanGmNarrationV1({ ...await f.envelope('scripted.narration.duplicate'), actionSequence: action.sequence, gmKey: 'gm', text: '这是一份重复反馈。' })).rejects.toThrow(/已经有正式 GM 叙事/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  })

  it.each([1, 2, 3])('075 additional: a whole authorized turn with %i actions rotates only after its last action', async actions => {
    const f = await ready('builtin-storyforge', actions)
    const before = await readProductRuntimeState(f.sessionId)
    const original = before.ttrpg
    if (!original?.activeActorKey) throw new Error('Expected an active turn')
    const actorKey = original.activeActorKey
    const nextIndex = (original.turnOrder.indexOf(actorKey) + 1) % original.turnOrder.length
    for (let index = 0; index < actions; index++) {
      const event = await act(f, `scripted.turn.${index}`)
      const after = await readProductRuntimeState(f.sessionId)
      const result = JSON.parse(event.payloadJson).result
      if (index < actions - 1) {
        expect(result.nextActorKey).toBeNull()
        expect(after.ttrpg?.activeActorKey).toBe(actorKey)
        expect(after.ttrpg?.round).toBe(original.round)
        expect(after.ttrpg?.product.actionEconomy.budgets[actorKey]?.actionsRemaining).toBe(actions - index - 1)
      } else {
        expect(result.nextActorKey).toBe(original.turnOrder[nextIndex])
        expect(after.ttrpg?.activeActorKey).toBe(result.nextActorKey)
        expect(after.ttrpg?.round).toBe(original.round + (nextIndex === 0 ? 1 : 0))
      }
    }
    await assertReplayAndReopen(f)
  })

  it('075 additional: a real stale action conflict leaves no new event or mechanical write', async () => {
    const f = await ready('builtin-storyforge', 2)
    const stale = await f.envelope('scripted.stale-action')
    const event = await act(f)
    const result = JSON.parse(event.payloadJson).result
    const after = await readProductRuntimeState(f.sessionId)
    await expect(resolveTtrpgRuleAction({ ...stale, actorKey: result.actorKey, actionKey: result.actionKey, targetKey: null })).rejects.toThrow(/已变化/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
    expect(await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).count()).toBe(after.lastSequence)
  })

  it('076 additional: progression crosses level4/5 mechanics, preserves current resources and charges each intent once across reopen and branch', async () => {
    const f = await ready('builtin-d20-fantasy')
    const characterKey = f.ttrpg.campaign.characterTemplates.find(actor => actor.role === 'player')?.characterKey
    if (!characterKey) throw new Error('Expected the selected player')
    await awardXp(f, characterKey)
    const before = await readProductRuntimeState(f.sessionId)
    const original = before.ttrpg?.product.characterProgression[characterKey]
    const cost = f.ttrpg.rulePack.content.advancement.levelIncreaseCost
    if (original?.level == null || cost == null) throw new Error('Expected d20 progression')
    let first: Parameters<typeof advanceTtrpgCharacterV1>[0] | undefined
    let firstEvent: Awaited<ReturnType<typeof advanceTtrpgCharacterV1>> | undefined
    for (let level = original.level + 1; level <= 5; level++) {
      const input = { ...await f.envelope(`scripted.level-boundary.${level}`), characterKey, kind: 'level' as const, targetKey: 'level' }
      const event = await advanceTtrpgCharacterV1(input)
      if (!first) { first = input; firstEvent = event }
      const state = await readProductRuntimeState(f.sessionId), attributes = state.entities[characterKey].attributes
      expect(attributes.level).toBe(level)
      expect(attributes.proficiency).toBe(2 + Math.floor((level - 1) / 4))
      expect(attributes['strength-check']).toBe(Math.floor((Number(attributes.strength) - 10) / 2) + 2 + Math.floor((level - 1) / 4))
      expect(attributes['resourceMax.heroic-dice']).toBe(1 + Math.floor(level / 4))
      expect(attributes['resource.vigor']).toBe(before.entities[characterKey].attributes['resource.vigor'])
      expect(attributes['resource.heroic-dice']).toBe(before.entities[characterKey].attributes['resource.heroic-dice'])
    }
    if (!first || !firstEvent) throw new Error('Expected at least one level purchase')
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.ttrpg?.product.characterProgression[characterKey].spentCurrency).toBe(original.spentCurrency + cost * (5 - original.level))
    const actor = createTtrpgViewerProjectionV1({ state: after, campaign: f.ttrpg.campaign, rulePack: f.ttrpg.rulePack.content,
      role: 'player', actorKey: characterKey }).actors.find(actor => actor.actorKey === characterKey)
    expect(actor?.attributes.find(attribute => attribute.key === 'level')?.value).toBe(5)
    expect(actor?.characterSheet.rules.progression?.level).toBe(5)
    expect(actor?.characterSheet.rules.attributes.level).toBe(5)
    expect(actor?.resources.find(resource => resource.key === 'vigor')).toMatchObject({
      current: after.entities[characterKey].attributes['resource.vigor'], maximum: after.entities[characterKey].attributes['resourceMax.vigor'] })
    expect(actor?.resources.find(resource => resource.key === 'heroic-dice')).toMatchObject({
      current: after.entities[characterKey].attributes['resource.heroic-dice'], maximum: after.entities[characterKey].attributes['resourceMax.heroic-dice'] })
    expect(await advanceTtrpgCharacterV1(first)).toEqual(firstEvent)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
    await assertReplayAndReopen(f)
    const branch = await branchProductRuntimeSession({ parentSessionId: f.sessionId, title: 'Scripted advancement branch', throughSequence: after.lastSequence })
    if (!branch.id) throw new Error('Expected the branch session')
    const child = await readProductRuntimeState(branch.id)
    expect(child.entities[characterKey].attributes).toEqual(after.entities[characterKey].attributes)
    expect(child.ttrpg?.product.characterProgression[characterKey]).toEqual(after.ttrpg?.product.characterProgression[characterKey])
  })

  it('076 additional: insufficient experience and an incompatible growth model still reject without writes', async () => {
    const f = await ready('builtin-d20-fantasy')
    const characterKey = f.ttrpg.campaign.characterTemplates.find(actor => actor.role === 'player')?.characterKey
    if (!characterKey) throw new Error('Expected the selected player')
    const before = await readProductRuntimeState(f.sessionId)
    await expect(advanceTtrpgCharacterV1({ ...await f.envelope('scripted.no-xp'), characterKey, kind: 'level', targetKey: 'level' })).rejects.toThrow(/不足/)
    await expect(advanceTtrpgCharacterV1({ ...await f.envelope('scripted.wrong-model'), characterKey, kind: 'rank', targetKey: 'rank' })).rejects.toThrow(/不是阶位制/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).count()).toBe(before.lastSequence)
  })

  it('076 compatibility: historical ledger-only events keep their original mechanical projection', async () => {
    const f = await ready('builtin-d20-fantasy')
    const characterKey = f.ttrpg.campaign.characterTemplates.find(actor => actor.role === 'player')?.characterKey
    if (!characterKey) throw new Error('Expected the selected player')
    await awardXp(f, characterKey)
    const before = await readProductRuntimeState(f.sessionId)
    const event = await advanceTtrpgCharacterV1({ ...await f.envelope('scripted.legacy-shape'), characterKey, kind: 'level', targetKey: 'level' })
    const payload = JSON.parse(event.payloadJson)
    const legacyEvent = { ...event, payloadJson: JSON.stringify({ ...payload, entityAttributes: {} }) }
    const legacy = applyProductRuntimeEvent(before, legacyEvent)
    expect(legacy.entities).toEqual(before.entities)
    expect(legacy.ttrpg?.product.characterProgression[characterKey]).toEqual({
      ...before.ttrpg?.product.characterProgression[characterKey],
      level: payload.after, spentCurrency: payload.cost,
      history: [{ eventSequence: event.sequence, kind: 'level', targetKey: 'level', before: payload.before, after: payload.after, cost: payload.cost }],
    })
    expect(() => assertInitialTtrpgProductStateV1({ state: legacy, content: f.ttrpg, allowProgress: true })).not.toThrow()
    expect(() => assertInitialTtrpgProductStateV1({ state: legacy, content: f.ttrpg })).toThrow()
  })

  it('076 guards: malformed or decreasing new level postimages and mixed derived states cannot pass growth or branch validation', async () => {
    const f = await ready('builtin-d20-fantasy')
    const characterKey = f.ttrpg.campaign.characterTemplates.find(actor => actor.role === 'player')?.characterKey
    if (!characterKey) throw new Error('Expected the selected player')
    await awardXp(f, characterKey)
    const before = await readProductRuntimeState(f.sessionId)
    const event = await advanceTtrpgCharacterV1({ ...await f.envelope('scripted.invalid-postimage'), characterKey, kind: 'level', targetKey: 'level' })
    const payload = JSON.parse(event.payloadJson)
    for (const level of ['2', payload.after + 1, null]) {
      const invalid = { ...event, payloadJson: JSON.stringify({ ...payload, entityAttributes: { ...payload.entityAttributes, level } }) }
      expect(() => applyProductRuntimeEvent(before, invalid)).toThrow(/等级实体投影/)
    }
    const decreasing = structuredClone(before)
    decreasing.entities[characterKey].attributes.level = payload.after + 1
    expect(() => applyProductRuntimeEvent(decreasing, event)).toThrow(/等级实体投影/)
    const after = await readProductRuntimeState(f.sessionId)
    const invalidLevel = structuredClone(before)
    invalidLevel.entities[characterKey].attributes.level = Number(before.entities[characterKey].attributes.level) + 1
    expect(() => assertInitialTtrpgProductStateV1({ state: invalidLevel, content: f.ttrpg, allowProgress: true })).toThrow(/严格绑定/)
    const invalidDerived = structuredClone(after)
    invalidDerived.entities[characterKey].attributes.proficiency = Number(after.entities[characterKey].attributes.proficiency) + 1
    expect(() => assertInitialTtrpgProductStateV1({ state: invalidDerived, content: f.ttrpg, allowProgress: true })).toThrow(/严格绑定/)
    const inventedHistory = structuredClone(before)
    const progression = inventedHistory.ttrpg?.product.characterProgression[characterKey]
    if (!progression) throw new Error('Expected the original progression')
    progression.level = payload.after
    progression.spentCurrency = payload.cost
    progression.history.push({ eventSequence: event.sequence, kind: 'level', targetKey: 'level', before: payload.before, after: payload.after, cost: payload.cost })
    inventedHistory.entities[characterKey].attributes.level = payload.after + 1
    expect(() => assertInitialTtrpgProductStateV1({ state: inventedHistory, content: f.ttrpg, allowProgress: true })).toThrow(/严格绑定/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  })

  it.each(['free', 'reaction', 'downtime'] as const)('075 phase: the frozen %s variant spends only its authorized budget through the actual command and replay', async phase => {
    const f = await ready('builtin-storyforge', 2, phase)
    const before = await readProductRuntimeState(f.sessionId), ttrpg = before.ttrpg
    if (!ttrpg?.activeActorKey) throw new Error('Expected the actual active scene')
    const actorKey = phase === 'reaction' ? ttrpg.turnOrder.find(key => key !== ttrpg.activeActorKey) : ttrpg.activeActorKey
    const actionKey = f.ttrpg.rulePack.content.actions.find(action => action.phase === phase && action.target === 'scene')?.key
    if (!actorKey || !actionKey) throw new Error('Expected a real authorized scene action')
    const input = { ...await f.envelope(`scripted.phase.${phase}`), actorKey, actionKey, targetKey: null }
    const event = await resolveTtrpgRuleAction(input)
    const after = await readProductRuntimeState(f.sessionId)
    expect(JSON.parse(event.payloadJson).result.nextActorKey).toBeNull()
    expect(after.ttrpg?.activeActorKey).toBe(ttrpg.activeActorKey)
    expect(after.ttrpg?.round).toBe(ttrpg.round)
    const budget = ttrpg.product.actionEconomy.budgets[actorKey]
    expect(after.ttrpg?.product.actionEconomy.budgets[actorKey]).toEqual({
      actionsRemaining: budget.actionsRemaining - (phase === 'downtime' ? 1 : 0),
      reactionsRemaining: budget.reactionsRemaining - (phase === 'reaction' ? 1 : 0),
      freeActionsRemaining: budget.freeActionsRemaining - (phase === 'free' ? 1 : 0),
    })
    expect(await resolveTtrpgRuleAction(input)).toEqual(event)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
    if (phase !== 'downtime') {
      await expect(resolveTtrpgRuleAction({ ...await f.envelope(`scripted.phase.${phase}.exhausted`), actorKey, actionKey, targetKey: null })).rejects.toThrow(/次数已经耗尽/)
      expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
    }
    await assertReplayAndReopen(f)
  })

  it('076 initial: new mapped NPC cards and the first real player purchase agree with frozen mechanical levels', async () => {
    const f = await ready('builtin-d20-fantasy')
    const initial = await readProductRuntimeState(f.sessionId)
    const npcs = f.ttrpg.campaign.characterTemplates.filter(actor => actor.role === 'npc')
    if (!npcs.length) throw new Error('Expected real production NPCs')
    if (process.env.SFQA_B_CAPTURE_OLD_NPC === '1') console.info('SFQA076 original mapped NPC sample', JSON.stringify(npcs))
    for (const npc of npcs) {
      expect(npc.characterSheet?.rules.progression.level).toBe(npc.attributes.level)
      expect(initial.entities[npc.characterKey].attributes.level).toBe(npc.attributes.level)
    }
    const player = f.ttrpg.campaign.characterTemplates.find(actor => actor.role === 'player')
    if (!player) throw new Error('Expected the actual selected player')
    const level = initial.entities[player.characterKey].attributes.level
    if (typeof level !== 'number') throw new Error('Expected the declared d20 mechanical level')
    expect(initial.ttrpg?.product.characterProgression[player.characterKey].level).toBe(level)
    await awardXp(f, player.characterKey)
    await advanceTtrpgCharacterV1({ ...await f.envelope('scripted.first-level'), characterKey: player.characterKey, kind: 'level', targetKey: 'level' })
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.ttrpg?.product.characterProgression[player.characterKey].level).toBe(level + 1)
    expect(after.entities[player.characterKey].attributes.level).toBe(level + 1)
    const npcView = createTtrpgViewerProjectionV1({ state: after, campaign: f.ttrpg.campaign, rulePack: f.ttrpg.rulePack.content, role: 'gm' })
    for (const npc of npcs) expect(npcView.actors.find(actor => actor.actorKey === npc.characterKey)?.characterSheet.rules.progression.level).toBe(npc.attributes.level)
    await assertReplayAndReopen(f)
  })

  it('076 legacy: an already frozen mismatched NPC card stays unchanged and cannot buy player growth', async () => {
    const f = await ready('builtin-d20-fantasy', 1, undefined, true)
    const npc = f.ttrpg.campaign.characterTemplates.find(actor => actor.role === 'npc' && actor.attributes.level !== 1)
    if (!npc?.characterSheet) throw new Error('Expected the explicit historical mismatched card')
    const before = await readProductRuntimeState(f.sessionId), builds = await db.productBuilds.toArray()
    const session = await db.productRuntimeSessions.get(f.sessionId)
    expect(npc.characterSheet.rules.progression.level).toBe(1)
    expect(before.entities[npc.characterKey].attributes.level).toBe(npc.attributes.level)
    await expect(advanceTtrpgCharacterV1({ ...await f.envelope('scripted.npc-is-not-player'), characterKey: npc.characterKey, kind: 'level', targetKey: 'level' })).rejects.toThrow(/本局玩家角色/)
    await assertReplayAndReopen(f)
    expect(await db.productBuilds.toArray()).toEqual(builds)
    expect((await db.productRuntimeSessions.get(f.sessionId))?.initialStateJson).toBe(session?.initialStateJson)
    const visible = createTtrpgViewerProjectionV1({ state: await readProductRuntimeState(f.sessionId), campaign: f.ttrpg.campaign, rulePack: f.ttrpg.rulePack.content, role: 'gm' })
    expect(visible.actors.find(actor => actor.actorKey === npc.characterKey)?.characterSheet.rules.progression.level).toBe(1)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })

  it('076 frozen: an authored player strength cannot change the author-confirmed initial level or create a Build', async () => {
    const actual = scenarioFixtures.authoredScenarioFixture
    vi.spyOn(scenarioFixtures, 'authoredScenarioFixture').mockImplementation(input => {
      const candidate = actual(input), player = candidate.characters.find(actor => actor.seatKey !== null)
      if (!player) throw new Error('Expected the actual authored player candidate')
      // Retain the formerly accepted fault input as a real compiler negative.
      player.strengthAttributeKey = 'level'; player.weaknessAttributeKey = 'strength'
      return candidate
    })
    await expect(ready('builtin-d20-fantasy')).rejects.toThrow(/不能改写已确认的玩家初始等级/)
    expect(await db.productBuilds.count()).toBe(0)
    expect(await db.productRuntimeSessions.count()).toBe(0)
    expect(await db.worldReleases.count()).toBeGreaterThan(0)
  })
})
