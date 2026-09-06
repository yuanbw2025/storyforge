import { describe, expect, it } from 'vitest'
import type { ProductProductionBriefV3 } from '../../src/lib/types'
import {
  parseTextAdventureCastBibleArtifactV1,
  parseTextAdventureNarrativeArcPlanArtifactV1,
  parseTextAdventureQuestPlanArtifactV1,
  parseTextAdventureQuestScriptArtifactV1,
  parseTextAdventureSourceSufficiencyArtifactV1,
  parseTextAdventureStoryBibleArtifactV1,
} from '../../src/lib/adventure/production-artifacts-v2'

function brief(qualityProfile: ProductProductionBriefV3['qualityProfile'] = 'internal') {
  return {
    qualityProfile,
    scale: { targetPlayMinutes: 15, targetWordCount: 2_500, targetEndingCount: 2 },
    textAdventure: {
      narrative: { targetLocationCount: 2, targetSceneCount: 3 },
    },
  } as unknown as ProductProductionBriefV3
}

function storyBible() {
  return parseTextAdventureStoryBibleArtifactV1({
    schema: 'storyforge.text-adventure-story-bible-artifact', version: 1,
    title: '潮门', premise: '潮门关闭前必须完成选择。', playerFantasy: '承担守门职责。',
    thematicQuestion: '保护与真相能否共存？', emotionalPromise: '从迟疑走向承担。',
    centralConflict: '公开危险会伤害同伴，隐瞒又会威胁港城。',
    canonFacts: ['潮门会关闭', '港城依靠灯塔', '同伴掌握记录'],
    productPrivateFacts: ['产品私域新增一名信使'], prohibitions: ['不得改写冻结世界结局'],
    setupPayoffs: [
      { key: 'setup.bell', setup: '开场听见裂钟。', payoff: '高潮用钟声判断潮位。', introducedAct: 1, resolvedAct: 3 },
      { key: 'setup.letter', setup: '信使藏起一封信。', payoff: '信揭示同伴的动机。', introducedAct: 1, resolvedAct: 2 },
    ],
    endings: [
      { key: 'ending.truth', title: '真相', dramaticAnswer: '公开事实并承担代价。', requiredConsequences: ['港城知情', '同伴离开'] },
      { key: 'ending.shelter', title: '庇护', dramaticAnswer: '保护同伴但留下风险。', requiredConsequences: ['同伴留下', '风险延续'] },
    ],
  }, brief())
}

function castBible(qualityProfile: ProductProductionBriefV3['qualityProfile'] = 'internal') {
  const roles = qualityProfile === 'commercial-candidate'
    ? ['player', 'major-npc', 'major-npc', 'major-npc', 'major-npc', 'major-npc'] as const
    : ['player', 'major-npc'] as const
  return parseTextAdventureCastBibleArtifactV1({
    value: {
      schema: 'storyforge.text-adventure-cast-bible-artifact', version: 1,
      characters: roles.map((role, index) => ({
        key: index === 0 ? 'character.player' : `character.npc.${index}`,
        role, sourceResourceKey: index < 2 ? `world.character.${index}` : null,
        name: index === 0 ? '守门人' : `角色${index}`, publicIdentity: '港城居民',
        desire: '让港城度过潮夜', fear: '真相伤害身边的人', secret: '隐瞒过一次事故',
        motivation: '弥补过去的错误', voice: `说话特征${index}`,
        initialKnowledge: ['知道潮门时间'], forbiddenKnowledge: ['不知道最终选择'],
        relationshipArc: ['最初互不信任', '最后共同承担'], visualAnchor: `视觉锚点${index}`,
      })),
    },
    brief: brief(qualityProfile),
    allowedResourceKeys: ['world.character.0', 'world.character.1'],
  })
}

describe('TEXTADV-3 · 专业生产工件合同', () => {
  it('来源充分性只接受冻结范围内的 resource key，并由 blocking 证据派生暂停', () => {
    const parsed = parseTextAdventureSourceSufficiencyArtifactV1({
      value: {
        schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
        decision: 'blocked', adaptationStrategy: 'expand-sparse',
        coverage: [{ domain: 'characters', status: 'missing', resourceKeys: [], rationale: '没有足够角色。' }],
        gaps: [{ key: 'gap.characters', severity: 'blocking', description: '角色不足。', affectedStages: ['cast.bible'] }],
        privateAdditions: [], authorDecisionRequired: true,
      },
      brief: brief(), allowedResourceKeys: ['world.character.0'],
    })
    expect(parsed).toMatchObject({ decision: 'blocked', authorDecisionRequired: true })
    expect(() => parseTextAdventureSourceSufficiencyArtifactV1({
      value: {
        schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
        decision: 'ready', adaptationStrategy: 'adapt-rich',
        coverage: [{ domain: 'characters', status: 'sufficient', resourceKeys: ['world.character.hidden'], rationale: '越权。' }],
        gaps: [], privateAdditions: [], authorDecisionRequired: false,
      },
      brief: brief(), allowedResourceKeys: ['world.character.0'],
    })).toThrow('未授权世界资源')
  })

  it('故事与角色圣经冻结铺垫回收、结局、知识边界和独立角色身份', () => {
    const story = storyBible()
    const cast = castBible()
    expect(story.setupPayoffs).toHaveLength(2)
    expect(story.endings.map(item => item.key)).toEqual(['ending.truth', 'ending.shelter'])
    expect(cast.characters).toHaveLength(2)
    expect(cast.characters[1]).toMatchObject({ role: 'major-npc', sourceResourceKey: 'world.character.1' })
  })

  it('商业候选的角色圣经拒绝一个 Agent 用单薄角色表继续生产', () => {
    expect(() => parseTextAdventureCastBibleArtifactV1({
      value: {
        schema: 'storyforge.text-adventure-cast-bible-artifact', version: 1,
        characters: castBible().characters,
      },
      brief: brief('commercial-candidate'),
      allowedResourceKeys: ['world.character.0', 'world.character.1'],
    })).toThrow('characters 数量无效')
    expect(castBible('commercial-candidate').characters.filter(item => item.role !== 'player')).toHaveLength(5)
  })

  it('叙事弧把每个有效决定绑定持久效果和至少两个后续回响场景', () => {
    const cast = castBible()
    const story = storyBible()
    const value = {
      schema: 'storyforge.text-adventure-narrative-arc-plan-artifact', version: 1,
      acts: [1, 2, 3].map(index => ({
        key: `act.${index}`, title: `第${index}幕`, targetMinutes: 5,
        goal: `完成第${index}幕目标`, irreversibleTurn: `第${index}幕不可逆转折`,
        sceneCards: [{
          key: `scene.${index}`, title: `场景${index}`, locationOrdinal: Math.min(index, 2),
          purpose: '推进冲突', conflict: '保护与公开冲突', entryState: '进入状态', exitState: '退出状态',
          castKeys: ['character.player', 'character.npc.1'],
          setupKeys: index === 1 ? ['setup.bell', 'setup.letter'] : [],
          payoffKeys: index === 2 ? ['setup.letter'] : index === 3 ? ['setup.bell'] : [],
        }],
      })),
      decisions: [{
        key: 'decision.first', sceneKey: 'scene.1', prompt: '是否公开记录？', options: [
          { key: 'option.publish', label: '公开', cost: '同伴离开', persistentEffectKey: 'flag.truth', echoSceneKeys: ['scene.2', 'scene.3'] },
          { key: 'option.hide', label: '隐瞒', cost: '风险延续', persistentEffectKey: 'flag.shelter', echoSceneKeys: ['scene.2', 'scene.3'] },
        ],
      }],
      endings: [
        { endingKey: 'ending.truth', sceneKey: 'scene.3' },
        { endingKey: 'ending.shelter', sceneKey: 'scene.3' },
      ],
    }
    const parsed = parseTextAdventureNarrativeArcPlanArtifactV1({ value, brief: brief(), cast, storyBible: story })
    expect(parsed.acts.flatMap(act => act.sceneCards)).toHaveLength(3)
    const broken = structuredClone(value)
    broken.decisions[0].options[0].echoSceneKeys = ['scene.2']
    expect(() => parseTextAdventureNarrativeArcPlanArtifactV1({ value: broken, brief: brief(), cast, storyBible: story }))
      .toThrow('数量无效')
  })

  it('主线任务计划把阶段、目标、场景、通用解法与持久后果精确闭合', () => {
    const cast = castBible()
    const story = storyBible()
    const arc = parseTextAdventureNarrativeArcPlanArtifactV1({
      value: {
        schema: 'storyforge.text-adventure-narrative-arc-plan-artifact', version: 1,
        acts: [1, 2, 3].map(index => ({
          key: `act.${index}`, title: `第${index}幕`, targetMinutes: 5, goal: '推进主线', irreversibleTurn: '形成不可逆后果',
          sceneCards: [{
            key: `scene.${index}`, title: `场景${index}`, locationOrdinal: Math.min(index, 2),
            purpose: '推进冲突', conflict: '公开或隐瞒', entryState: '进入', exitState: '离开',
            castKeys: ['character.player', 'character.npc.1'], setupKeys: [], payoffKeys: [],
          }],
        })),
        decisions: [{
          key: 'decision.1', sceneKey: 'scene.1', prompt: '怎么做？', options: [
            { key: 'option.a', label: '公开', cost: '关系受损', persistentEffectKey: 'flag.truth', echoSceneKeys: ['scene.2', 'scene.3'] },
            { key: 'option.b', label: '隐瞒', cost: '风险延续', persistentEffectKey: 'flag.hide', echoSceneKeys: ['scene.2', 'scene.3'] },
          ],
        }],
        endings: [
          { endingKey: 'ending.truth', sceneKey: 'scene.3' },
          { endingKey: 'ending.shelter', sceneKey: 'scene.3' },
        ],
      },
      brief: brief(), cast, storyBible: story,
    })
    const value = {
      schema: 'storyforge.text-adventure-quest-plan-artifact', version: 1, bundleKind: 'main',
      quests: [{
        key: 'quest.main', title: '守住潮门', description: '完成一次有代价的选择。',
        characterKeys: ['character.player', 'character.npc.1'],
        stages: [{ key: 'stage.opening', title: '确认局势', objectiveKeys: ['objective.records'] }],
        objectives: [{
          key: 'objective.records', stageKey: 'stage.opening', title: '取得记录',
          narrativePurpose: '让最后选择拥有事实依据。', sceneKeys: ['scene.1'], locationOrdinal: 1,
          alternatives: [{
            key: 'route.talk', actionKind: 'talk', targetCharacterKey: 'character.npc.1', cost: '关系承压',
            successConsequence: '同伴交出记录。', failureForwardConsequence: '同伴拒绝，但留下了仓库钥匙。',
            persistentEffectKeys: ['flag.records-known'],
          }],
        }],
      }],
    }
    const parsed = parseTextAdventureQuestPlanArtifactV1({
      value, brief: brief(), arcPlan: arc, cast, expectedKind: 'main', expectedQuestCount: 1,
    })
    expect(parsed.quests[0].objectives[0].alternatives[0]).toMatchObject({ actionKind: 'talk' })
    const broken = structuredClone(value)
    broken.quests[0].stages[0].objectiveKeys = ['objective.missing']
    expect(() => parseTextAdventureQuestPlanArtifactV1({
      value: broken, brief: brief(), arcPlan: arc, cast, expectedKind: 'main', expectedQuestCount: 1,
    })).toThrow('未精确覆盖')

    const questScriptValue = {
      schema: 'storyforge.text-adventure-quest-script-artifact', version: 1,
      mainObjectiveScripts: [{
        objectiveKey: 'objective.records', sceneKey: 'scene.1',
        alternatives: [{
          alternativeKey: 'route.talk',
          resolution: { mode: 'automatic', abilityKey: null, difficulty: null, costlySuccessFloor: null },
          timeCostMinutes: 5, successText: '同伴最终交出了记录。',
          costlySuccessText: '同伴交出记录，但关系明显承压。',
          failureForwardText: '同伴拒绝交付，却留下了通往仓库的钥匙。',
        }],
      }],
      sideQuestScripts: [], ambientEventScripts: [],
    }
    const script = parseTextAdventureQuestScriptArtifactV1({
      value: questScriptValue, brief: brief(), mainQuestPlan: parsed,
      systems: { abilities: [{ key: 'ability.perception' }] } as never,
      sideQuests: { entries: [] } as never, ambientEvents: { entries: [] } as never,
    })
    expect(script.mainObjectiveScripts[0].alternatives[0].resolution.mode).toBe('automatic')
    const illegalCheck = JSON.parse(JSON.stringify(questScriptValue))
    illegalCheck.mainObjectiveScripts[0].alternatives[0].resolution = {
      mode: 'check', abilityKey: 'ability.unknown', difficulty: 10, costlySuccessFloor: 6,
    }
    expect(() => parseTextAdventureQuestScriptArtifactV1({
      value: illegalCheck, brief: brief(), mainQuestPlan: parsed,
      systems: { abilities: [{ key: 'ability.perception' }] } as never,
      sideQuests: { entries: [] } as never, ambientEvents: { entries: [] } as never,
    })).toThrow('已登记能力')
  })
})
