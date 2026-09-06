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
import {
  assembleTextAdventureNarrativeFromSceneScriptsV1,
  parseTextAdventureSceneScriptBundleArtifactV1,
  textAdventureNarrativeSkeletonV1,
} from '../../src/lib/adventure/scene-script'
import {
  applyTextAdventureDialoguePassV1,
  parseTextAdventureDialoguePassArtifactV1,
} from '../../src/lib/adventure/dialogue-pass'

function brief(qualityProfile: ProductProductionBriefV3['qualityProfile'] = 'internal') {
  return {
    qualityProfile,
    intent: { productType: 'text-adventure' },
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
      { key: 'ending.001', title: '真相', dramaticAnswer: '公开事实并承担代价。', requiredConsequences: ['港城知情', '同伴离开'] },
      { key: 'ending.002', title: '庇护', dramaticAnswer: '保护同伴但留下风险。', requiredConsequences: ['同伴留下', '风险延续'] },
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
    expect(story.endings.map(item => item.key)).toEqual(['ending.001', 'ending.002'])
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
          key: `scene.${String(index).padStart(3, '0')}`, title: `场景${index}`, locationOrdinal: Math.min(index, 2),
          purpose: '推进冲突', conflict: '保护与公开冲突', entryState: '进入状态', exitState: '退出状态',
          castKeys: ['character.player', 'character.npc.1'],
          setupKeys: index === 1 ? ['setup.bell', 'setup.letter'] : [],
          payoffKeys: index === 2 ? ['setup.letter'] : index === 3 ? ['setup.bell'] : [],
        }],
      })),
      decisions: [{
        key: 'decision.first', sceneKey: 'scene.001', prompt: '是否公开记录？', options: [
          { key: 'option.publish', label: '公开', cost: '同伴离开', persistentEffectKey: 'flag.truth', echoSceneKeys: ['scene.002', 'scene.003'] },
          { key: 'option.hide', label: '隐瞒', cost: '风险延续', persistentEffectKey: 'flag.shelter', echoSceneKeys: ['scene.002', 'scene.003'] },
        ],
      }],
      endings: [
        { endingKey: 'ending.001', sceneKey: 'scene.003' },
        { endingKey: 'ending.002', sceneKey: 'scene.003' },
      ],
    }
    const parsed = parseTextAdventureNarrativeArcPlanArtifactV1({ value, brief: brief(), cast, storyBible: story })
    expect(parsed.acts.flatMap(act => act.sceneCards)).toHaveLength(3)
    const broken = structuredClone(value)
    broken.decisions[0].options[0].echoSceneKeys = ['scene.002']
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
            key: `scene.${String(index).padStart(3, '0')}`, title: `场景${index}`, locationOrdinal: Math.min(index, 2),
            purpose: '推进冲突', conflict: '公开或隐瞒', entryState: '进入', exitState: '离开',
            castKeys: ['character.player', 'character.npc.1'], setupKeys: [], payoffKeys: [],
          }],
        })),
        decisions: [{
          key: 'decision.1', sceneKey: 'scene.001', prompt: '怎么做？', options: [
            { key: 'option.a', label: '公开', cost: '关系受损', persistentEffectKey: 'flag.truth', echoSceneKeys: ['scene.002', 'scene.003'] },
            { key: 'option.b', label: '隐瞒', cost: '风险延续', persistentEffectKey: 'flag.hide', echoSceneKeys: ['scene.002', 'scene.003'] },
          ],
        }],
        endings: [
          { endingKey: 'ending.001', sceneKey: 'scene.003' },
          { endingKey: 'ending.002', sceneKey: 'scene.003' },
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
          narrativePurpose: '让最后选择拥有事实依据。', sceneKeys: ['scene.001'], locationOrdinal: 1,
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
        objectiveKey: 'objective.records', sceneKey: 'scene.001',
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

  it('三幕 Scene Writer 只能填写冻结槽位，并由确定性装配器生成唯一叙事图', () => {
    const inputBrief = brief()
    const story = storyBible()
    const cast = castBible()
    const sceneTitles = {
      'scene.001': '潮门警铃',
      'scene.002': '旧仓来信',
      'scene.003': '灯塔抉择',
    }
    const endingTitles = Object.fromEntries(story.endings.map(ending => [ending.key, ending.title]))
    const skeleton = textAdventureNarrativeSkeletonV1(inputBrief)
    const locationTitles = ['潮门广场', '信号塔']
    const bundleValue = (actIndex: number) => {
      const sceneKey = `scene.00${actIndex + 1}`
      const endingKeys = actIndex === 2 ? skeleton.endingKeys : []
      return {
        schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
        actKey: `act.${actIndex + 1}`, moduleTitle: story.title,
        scenes: [{
          sceneKey, title: sceneTitles[sceneKey as keyof typeof sceneTitles],
          summary: `${actIndex < 2 ? '潮门广场' : '信号塔'}内，局势进入第${actIndex + 1}幕。`,
          beats: [{
            beatKey: `beat.act-${actIndex + 1}.001`, kind: 'dialogue', speakerKey: 'character.npc.1',
            text: '同伴把自己的条件、恐惧和能承担的代价说清楚，让玩家获得足以行动的信息。', order: 0,
          }],
        }],
        choices: skeleton.edges.filter(edge => edge.sourceNodeKey === sceneKey).map(edge => ({
          ...edge,
          text: `行动方案${edge.order + 1}`,
          description: `以第${edge.order + 1}种代价推进。`,
          unavailableReason: '需要先完成当前目标。',
        })),
        endings: endingKeys.map((endingKey, index) => ({
          endingKey, title: endingTitles[endingKey], summary: '这个结局回应了玩家此前承担的责任。',
          beats: [{
            beatKey: `beat.ending.${index + 1}`, kind: 'narration', speakerKey: null,
            text: '港城记住了守门人的决定，同伴关系与未被逃避的代价也在最后的潮声中得到清楚交代。', order: 0,
          }],
        })),
      }
    }
    const bundles = [0, 1, 2].map(actIndex => parseTextAdventureSceneScriptBundleArtifactV1({
      value: bundleValue(actIndex), brief: inputBrief, actIndex,
      allowedSpeakerKeys: cast.characters.map(character => character.key),
      locationTitles, expectedModuleTitle: story.title, sceneTitles, endingTitles,
    }))
    const dialogueBeats = bundles[0].scenes.flatMap(scene => scene.beats)
      .filter(beat => beat.kind === 'dialogue').sort((left, right) => left.beatKey.localeCompare(right.beatKey))
    const choices = bundles[0].choices
      .sort((left, right) => left.choiceKey.localeCompare(right.choiceKey))
    const dialoguePassValue = {
      schema: 'storyforge.text-adventure-dialogue-pass-artifact', version: 1,
      actKey: 'act.1',
      characterAssessments: [{
        characterKey: 'character.npc.1', voiceDistinctness: 'strong', knowledgeBoundary: 'passed',
        notes: '同伴说话克制而具体，修订后没有提前知道最终选择。',
      }],
      beatReviews: dialogueBeats.map((beat, index) => ({
        beatKey: beat.beatKey, speakerKey: beat.speakerKey,
        verdict: index === 0 ? 'revise' : 'keep',
        issueTags: index === 0 ? ['exposition'] : ['none'],
        rationale: index === 0 ? '删去角色互相朗读背景的说明书语气。' : '声音与知识边界符合角色圣经。',
        revisedText: index === 0 ? '“钟只剩三响，”同伴压住灯罩，“你要真相，还是要他们先活过今晚？”' : beat.text,
      })),
      choiceReviews: choices.map(choice => ({
        choiceKey: choice.choiceKey, verdict: 'keep', issueTags: ['none'],
        rationale: '玩家意图和代价表达清楚。', revisedText: choice.text,
        revisedDescription: choice.description,
      })),
      summary: '已逐条检查全部对白和选择措辞，并修复一处说明书式对白。',
    }
    const dialoguePass = parseTextAdventureDialoguePassArtifactV1({
      value: dialoguePassValue, brief: inputBrief, cast, bundles: [bundles[0]],
    })
    const revisedBundles = [
      ...applyTextAdventureDialoguePassV1({ bundles: [bundles[0]], dialoguePass }),
      bundles[1], bundles[2],
    ]
    const assembled = assembleTextAdventureNarrativeFromSceneScriptsV1({ brief: inputBrief, bundles: revisedBundles })
    expect(assembled.nodes.map(node => node.key)).toEqual([
      'scene.001', 'scene.002', 'scene.003', 'ending.001', 'ending.002',
    ])
    expect(assembled.choices.map(choice => choice.choiceKey)).toEqual(skeleton.edges.map(edge => edge.choiceKey))
    expect(assembled.nodes.every(node => node.conditionJson === '{}' && node.effectsJson === '[]')).toBe(true)
    expect(assembled.beats.find(beat => beat.beatKey === dialogueBeats[0].beatKey)?.text)
      .toContain('钟只剩三响')
    const incompleteDialoguePass = structuredClone(dialoguePassValue)
    incompleteDialoguePass.beatReviews.pop()
    expect(() => parseTextAdventureDialoguePassArtifactV1({
      value: incompleteDialoguePass, brief: inputBrief, cast, bundles: [bundles[0]],
    })).toThrow('beatReviews 数量无效')
    const changed = bundleValue(0)
    changed.choices[0].targetNodeKey = 'scene.003'
    expect(() => parseTextAdventureSceneScriptBundleArtifactV1({
      value: changed, brief: inputBrief, actIndex: 0,
      allowedSpeakerKeys: cast.characters.map(character => character.key),
      locationTitles, expectedModuleTitle: story.title, sceneTitles, endingTitles,
    })).toThrow('改写了冻结图骨架')
  })
})
