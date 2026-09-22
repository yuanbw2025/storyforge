import { describe, expect, it } from 'vitest'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type { TextOpenWorldSessionProjectionV1 } from '../../src/lib/types'
import {
  createTextOpenWorldVNextFixture,
  createTextOpenWorldVNextP9Fixture,
  createTextOpenWorldVNextP9UnboundRestFixture,
} from '../helpers/text-open-world-vnext-fixture'

function p9Fixture() {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const narrative = runtimePackage.modules.narrative.payload as any
  const actions = runtimePackage.modules.actions.payload as any

  narrative.scenes.find((scene: any) => scene.key === 'scene.location.salt-port')
    .availabilityConditionKeys = ['condition.health-not-full']

  const ridgeChoice = {
    key: 'choice.return-salt-port',
    sceneKey: 'scene.location.ridge',
    label: '返回盐港',
    description: '沿盐渠维护道返回盐港。',
    actionKey: 'action.travel-ridge-port',
  }
  narrative.fixedChoices.push(ridgeChoice)
  narrative.scenes.push({
    key: 'scene.location.ridge', order: 10, sourceKind: 'location-interaction',
    sourceKey: 'interaction.ridge.return', title: '断脊维护道', purpose: '验证当前地点门控。',
    regionKey: 'region.ridge', locationKey: 'location.ridge-channel', questKey: null, stageKey: null,
    objectiveKey: null, actorKey: null, interactionKey: 'interaction.ridge.return', randomEventKey: null,
    participantKeys: [], openingText: '维护道向南延伸。', bodyText: '盐港在山脊下方。',
    successText: '你踏上返回盐港的路。', failureText: null, attitudeOpenings: null,
    allowedKnowledgeClaimKeys: [], forbiddenFutureObjectiveKeys: [], availabilityConditionKeys: [],
    actionKeys: ['action.travel-ridge-port'], fixedChoiceKeys: [ridgeChoice.key],
  })
  actions.inputBindings.actions
    .find((binding: any) => binding.actionKey === ridgeChoice.actionKey)
    .fixedChoiceKeys.push(ridgeChoice.key)
  return runtimePackage
}

function ready(projection: TextOpenWorldSessionProjectionV1) {
  const result = projectTextOpenWorldScenesV1(projection)
  expect(result.status).toBe('ready')
  if (result.status !== 'ready') throw new Error(result.message)
  return result
}

function mainQuestInstance(projection: TextOpenWorldSessionProjectionV1) {
  const instance = Object.values(projection.state.quests.instancesByKey)
    .find(candidate => candidate.definitionKey === 'quest.main.1')
  if (!instance) throw new Error('测试Fixture缺少主线任务实例')
  return instance
}

function activateMainQuest(projection: TextOpenWorldSessionProjectionV1) {
  const instance = mainQuestInstance(projection)
  instance.status = 'active'
  instance.acceptedAtWorldMinute = projection.state.time.worldMinute
  instance.currentStageKey = 'quest-stage.main.1'
  instance.objectiveStatusByKey['objective.main.1'] = 'active'
  return projection
}

describe('Text Open World G4-03 · current P9 scene projection', () => {
  it('对Narrative v1 / Action v14返回明确unsupported降级，不伪造P9场景', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())

    expect(projectTextOpenWorldScenesV1(projection)).toEqual({
      status: 'unsupported',
      reason: 'narrative-v2-and-action-v15-required',
      message: '当前冻结运行包不含P9场景与输入绑定；调用方必须使用旧版场景降级展示。',
      narrativeVersion: 1,
      actionVersion: 14,
      currentLocationKey: 'location.salt-port',
      randomEventPolicy: 'hidden-without-current-activation-evidence',
      scenes: [],
      recommendedSceneKey: null,
    })
  })

  it('只投影当前地点、条件成立且生命周期合法的场景，并按P9 order推荐', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(p9Fixture())
    const initial = ready(projection)

    expect(initial.scenes.map(scene => scene.key)).toEqual([
      'scene.offer.main',
      'scene.actor.caretaker',
    ])
    expect(initial.recommendedSceneKey).toBe('scene.offer.main')
    expect(initial.scenes.map(scene => scene.key)).not.toContain('scene.objective.main.1')
    expect(initial.scenes.map(scene => scene.key)).not.toContain('scene.resolution.main')
    expect(initial.scenes.map(scene => scene.key)).not.toContain('scene.offer.supplies')
    expect(initial.scenes.map(scene => scene.key)).not.toContain('scene.location.ridge')
    expect(initial.scenes.map(scene => scene.key)).not.toContain('scene.random.channel-rumor')
    expect(initial.randomEventPolicy).toBe('hidden-without-current-activation-evidence')

    projection.state.player.health -= 1
    const afterDamage = ready(projection)
    expect(afterDamage.scenes.map(scene => scene.key)).toEqual([
      'scene.offer.main',
      'scene.actor.caretaker',
      'scene.location.salt-port',
    ])
  })

  it('保留可用但未绑定任何P9场景的通用Action，不泄露隐藏场景Action', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(
      createTextOpenWorldVNextP9UnboundRestFixture(),
    )
    const result = ready(projection)

    expect(result.ambientActionKeys).toContain('action.rest')
    expect(result.ambientActionKeys).not.toContain('action.accept-main')
    expect(result.ambientActionKeys).not.toContain('action.talk-caretaker')
    expect(result.ambientActionKeys).not.toContain('action.investigate-channel')
  })

  it('严格按revealed、当前active目标和completed收束门控任务场景', () => {
    const initialProjection = createInitialTextOpenWorldSessionProjectionV1(p9Fixture())

    const activeProjection = activateMainQuest(structuredClone(initialProjection))
    const active = ready(activeProjection)
    expect(active.scenes.map(scene => scene.key)).toEqual([
      'scene.objective.main.1',
      'scene.actor.caretaker',
    ])

    const objectiveCompletedProjection = structuredClone(activeProjection)
    mainQuestInstance(objectiveCompletedProjection).objectiveStatusByKey['objective.main.1'] = 'completed'
    const objectiveCompleted = ready(objectiveCompletedProjection)
    expect(objectiveCompleted.scenes.map(scene => scene.key)).toEqual(['scene.actor.caretaker'])

    const completedProjection = structuredClone(objectiveCompletedProjection)
    const completedInstance = mainQuestInstance(completedProjection)
    completedInstance.status = 'completed'
    completedInstance.terminalAtWorldMinute = completedProjection.state.time.worldMinute
    const completed = ready(completedProjection)
    expect(completed.scenes.map(scene => scene.key)).toEqual([
      'scene.resolution.main',
      'scene.actor.caretaker',
    ])
    expect(completed.recommendedSceneKey).toBe('scene.resolution.main')

    completedInstance.rewardClaimKey = 'claim.reward.reward.quest-main.quest-instance.main'
    const settled = ready(completedProjection)
    expect(settled.scenes.map(scene => scene.key)).toEqual(['scene.actor.caretaker'])
    expect(settled.recommendedSceneKey).toBe('scene.actor.caretaker')
  })

  it('同一目标场景内某个Action不可用时，仍保留场景与其他合法Choice', () => {
    const runtimePackage = p9Fixture()
    const narrative = runtimePackage.modules.narrative.payload as any
    const actions = runtimePackage.modules.actions.payload as any
    const objectiveScene = narrative.scenes.find((scene: any) => scene.key === 'scene.objective.main.1')
    const unavailableChoice = {
      key: 'choice.use-tonic-during-investigation',
      sceneKey: objectiveScene.key,
      label: '使用盐露药剂',
      description: '先处理伤势，再继续检查渠壁。',
      actionKey: 'action.use-brine-tonic',
    }
    objectiveScene.actionKeys.push(unavailableChoice.actionKey)
    objectiveScene.fixedChoiceKeys.push(unavailableChoice.key)
    // Correct P9 semantics: the health predicate belongs only to the tonic
    // Action/Choice and must not be promoted to the whole scene.
    objectiveScene.availabilityConditionKeys = []
    narrative.fixedChoices.push(unavailableChoice)
    actions.inputBindings.actions
      .find((binding: any) => binding.actionKey === unavailableChoice.actionKey)
      .fixedChoiceKeys.push(unavailableChoice.key)

    const projection = activateMainQuest(createInitialTextOpenWorldSessionProjectionV1(runtimePackage))
    const scene = ready(projection).scenes.find(candidate => candidate.key === objectiveScene.key)

    expect(scene).toMatchObject({
      actionKeys: ['action.investigate-channel'],
      fixedChoiceKeys: ['choice.inspect-channel'],
    })
  })

  it('兼容归一P9 v1的条件并集及同地或异地owner，不让旧包吞掉合法目标', () => {
    const explicitActorPackage = p9Fixture()
    const explicitNarrative = explicitActorPackage.modules.narrative.payload as any
    const explicitActions = explicitActorPackage.modules.actions.payload as any
    const explicitActorScene = explicitNarrative.scenes
      .find((scene: any) => scene.key === 'scene.objective.main.1')
    const explicitActorChoice = {
      key: 'choice.ask-caretaker-during-objective', sceneKey: explicitActorScene.key,
      label: '向岑阿婆核对渠图', description: '询问这一目标所需的角色线索。',
      actionKey: 'action.talk-caretaker',
    }
    explicitActorScene.participantKeys = ['actor.caretaker']
    explicitActorScene.actionKeys.push('action.talk-caretaker')
    explicitActorScene.fixedChoiceKeys.push(explicitActorChoice.key)
    explicitNarrative.fixedChoices.push(explicitActorChoice)
    explicitActions.inputBindings.actions
      .find((binding: any) => binding.actionKey === explicitActorChoice.actionKey)
      .fixedChoiceKeys.push(explicitActorChoice.key)
    expect(ready(activateMainQuest(createInitialTextOpenWorldSessionProjectionV1(explicitActorPackage)))
      .scenes.find(scene => scene.key === explicitActorScene.key)).toMatchObject({
      participantKeys: ['actor.caretaker'],
    })

    const runtimePackage = p9Fixture()
    const narrative = runtimePackage.modules.narrative.payload as any
    const actions = runtimePackage.modules.actions.payload as any
    const objectiveScene = narrative.scenes.find((scene: any) => scene.key === 'scene.objective.main.1')
    const legacyConditionalChoice = {
      key: 'choice.legacy-use-tonic', sceneKey: objectiveScene.key, label: '使用盐露药剂',
      description: '旧P9场景中只约束此Action的条件选项。', actionKey: 'action.use-brine-tonic',
    }
    objectiveScene.participantKeys = ['actor.caretaker']
    objectiveScene.actionKeys.push(legacyConditionalChoice.actionKey)
    objectiveScene.fixedChoiceKeys.push(legacyConditionalChoice.key)
    objectiveScene.availabilityConditionKeys = ['condition.health-not-full']
    narrative.fixedChoices.push(legacyConditionalChoice)
    actions.inputBindings.actions
      .find((binding: any) => binding.actionKey === legacyConditionalChoice.actionKey)
      .fixedChoiceKeys.push(legacyConditionalChoice.key)

    // The legacy compiler also injected the quest owner when it happened to be
    // at the Objective location. Because the owner is not an explicit Actor
    // requirement, its absence must not hide the Objective scene.
    objectiveScene.participantKeys = ['actor.caretaker']
    const sameLocation = activateMainQuest(createInitialTextOpenWorldSessionProjectionV1(runtimePackage))
    Object.assign(sameLocation.state.actors['actor.caretaker'], { alive: false, present: false })
    expect(ready(sameLocation).scenes.find(scene => scene.key === objectiveScene.key)).toMatchObject({
      locationKey: 'location.salt-port',
      participantKeys: [],
      actionKeys: ['action.investigate-channel'],
    })

    objectiveScene.regionKey = 'region.ridge'
    objectiveScene.locationKey = 'location.ridge-channel'
    const crossRegion = activateMainQuest(createInitialTextOpenWorldSessionProjectionV1(runtimePackage))
    crossRegion.state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    crossRegion.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    crossRegion.state.map.currentLocationKey = 'location.ridge-channel'

    const result = ready(crossRegion)
    expect(result.scenes.find(scene => scene.key === objectiveScene.key)).toMatchObject({
      regionKey: 'region.ridge',
      locationKey: 'location.ridge-channel',
      participantKeys: [],
      actionKeys: ['action.investigate-channel'],
    })
    expect(crossRegion.state.actors['actor.caretaker']).toMatchObject({
      present: true,
      locationKey: 'location.salt-port',
    })
  })

  it('用当前NPC态度选择三档opening，并对不在场或死亡参与者fail-closed', () => {
    const neutralProjection = createInitialTextOpenWorldSessionProjectionV1(p9Fixture())
    const neutralScene = ready(neutralProjection).scenes.find(scene => scene.key === 'scene.actor.caretaker')!
    expect(neutralScene).toMatchObject({
      authoredOpeningText: '岑阿婆停下手里的活，抬眼看向你。',
      openingText: '岑阿婆礼貌地点头，等你说明来意。',
      actor: { key: 'actor.caretaker', attitude: 'neutral', greetingTone: '礼貌而保留' },
    })

    const badProjection = structuredClone(neutralProjection)
    badProjection.state.relationships.morality = -100
    badProjection.state.relationships.factionAffinityByKey['faction.canal-keepers'] = -100
    expect(ready(badProjection).scenes.find(scene => scene.key === 'scene.actor.caretaker')).toMatchObject({
      openingText: '岑阿婆把渠图收近了些，只冷淡地问你还有什么正事。',
      actor: { attitude: 'bad' },
    })

    const goodProjection = structuredClone(neutralProjection)
    goodProjection.state.relationships.morality = 100
    goodProjection.state.relationships.factionAffinityByKey['faction.canal-keepers'] = 100
    expect(ready(goodProjection).scenes.find(scene => scene.key === 'scene.actor.caretaker')).toMatchObject({
      openingText: '岑阿婆给你让出石栏边的位置，愿意把记得的细节再讲一遍。',
      actor: { attitude: 'good' },
    })

    for (const actorState of [
      { alive: true, present: false },
      { alive: false, present: false },
    ]) {
      const unavailableProjection = structuredClone(neutralProjection)
      Object.assign(unavailableProjection.state.actors['actor.caretaker'], actorState)
      const unavailable = ready(unavailableProjection)
      expect(unavailable.scenes.some(scene => scene.participantKeys.includes('actor.caretaker'))).toBe(false)
      expect(unavailable.scenes.map(scene => scene.key)).not.toContain('scene.offer.main')
    }
  })

  it('兼容归一actor-owned任务异地端点，在owner居所提供委托而不软锁', () => {
    const runtimePackage = p9Fixture()
    const offer = (runtimePackage.modules.narrative.payload as any).scenes
      .find((scene: any) => scene.key === 'scene.offer.main')
    offer.locationKey = 'location.ridge-channel'
    offer.regionKey = 'region.ridge'
    offer.openingText = '你在断脊维护道遇见了本不该离开盐港的发布者。'
    offer.bodyText = '断脊维护道的碎石在脚边滚落。'

    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const atOwnerHome = ready(projection)
    expect(atOwnerHome.scenes.find(scene => scene.key === offer.key)).toMatchObject({
      locationKey: 'location.salt-port',
      regionKey: 'region.salt-port',
      participantKeys: ['actor.caretaker'],
      presentationMode: 'legacy-endpoint-fallback',
      compatibilityNotice: expect.stringContaining('确定性兼容回退'),
    })
    expect(atOwnerHome.scenes.find(scene => scene.key === offer.key)?.authoredOpeningText)
      .not.toContain('断脊维护道')
    expect(atOwnerHome.scenes.find(scene => scene.key === offer.key)?.bodyText)
      .not.toContain('断脊维护道')

    projection.state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    projection.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    projection.state.map.currentLocationKey = 'location.ridge-channel'
    expect(ready(projection).scenes.map(scene => scene.key)).not.toContain(offer.key)
  })

  it('每个场景只输出当前可用Choice、Action及其P9自然语言映射例句', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(p9Fixture())
    const result = ready(projection)
    const offer = result.scenes.find(scene => scene.key === 'scene.offer.main')!
    const dialogue = result.scenes.find(scene => scene.key === 'scene.actor.caretaker')!

    expect(offer).toMatchObject({
      fixedChoiceKeys: ['choice.accept-main'],
      fixedChoices: [{
        key: 'choice.accept-main',
        label: '接下盐渠委托',
        actionKey: 'action.accept-main',
      }],
      actionKeys: ['action.accept-main'],
      naturalLanguageExamples: [{
        actionKey: 'action.accept-main',
        exampleUtterances: ['我接受这个任务', '接受盐渠委托'],
      }],
    })
    expect(dialogue).toMatchObject({
      fixedChoiceKeys: ['choice.talk-caretaker'],
      actionKeys: ['action.talk-caretaker'],
      naturalLanguageExamples: [{
        actionKey: 'action.talk-caretaker',
        exampleUtterances: ['和岑阿婆聊聊', '询问岑阿婆'],
      }],
    })
    for (const internalField of [
      'purpose', 'successText', 'failureText',
      'allowedKnowledgeClaimKeys', 'forbiddenFutureObjectiveKeys',
    ]) {
      expect(offer).not.toHaveProperty(internalField)
    }
  })

  it('需要数量或商品参数的制作交易Action不冒充可直接执行的场景快捷入口', () => {
    const runtimePackage = p9Fixture()
    const narrative = runtimePackage.modules.narrative.payload as any
    const actions = runtimePackage.modules.actions.payload as any
    const dialogue = narrative.scenes.find((scene: any) => scene.key === 'scene.actor.caretaker')
    const buyChoice = {
      key: 'choice.buy-from-caretaker',
      sceneKey: dialogue.key,
      label: '向岑阿婆购买物品',
      description: '交易必须先选择商品和数量。',
      actionKey: 'action.buy-caretaker',
    }
    dialogue.actionKeys.push(buyChoice.actionKey)
    dialogue.fixedChoiceKeys.push(buyChoice.key)
    narrative.fixedChoices.push(buyChoice)
    actions.inputBindings.actions
      .find((binding: any) => binding.actionKey === buyChoice.actionKey)
      .fixedChoiceKeys.push(buyChoice.key)

    const projectedDialogue = ready(createInitialTextOpenWorldSessionProjectionV1(runtimePackage))
      .scenes.find(scene => scene.key === dialogue.key)!
    expect(projectedDialogue.actionKeys).not.toContain(buyChoice.actionKey)
    expect(projectedDialogue.fixedChoiceKeys).not.toContain(buyChoice.key)
    expect(projectedDialogue.naturalLanguageExamples
      .some(binding => binding.actionKey === buyChoice.actionKey)).toBe(false)
  })
})
