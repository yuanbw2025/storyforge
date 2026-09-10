import { describe, expect, it } from 'vitest'
import type { ProductProductionBriefV3 } from '../../src/lib/types'
import {
  parseTextAdventureCastBibleArtifactV1,
  parseTextAdventureNarrativeArcPlanArtifactV1,
  parseTextAdventureQuestPlanArtifactV1,
  parseTextAdventureQuestScriptArtifactV2,
  parseTextAdventureSourceDecisionArtifactV1,
  parseTextAdventureSourceSufficiencyArtifactV1,
  parseTextAdventureStoryBibleArtifactV1,
  parseTextAdventureMediaAnchorDecisionArtifactV1,
  parseTextAdventureVisualBibleArtifactV1,
} from '../../src/lib/adventure/production-artifacts-v2'
import {
  assembleTextAdventureNarrativeFromSceneScriptsV1,
  parseTextAdventureSceneScriptBundleArtifactV1,
  textAdventureNarrativeSkeletonV1,
  validateTextAdventureCommercialEndingNarrativeV1,
} from '../../src/lib/adventure/scene-script'
import {
  applyTextAdventureDialoguePassV1,
  parseTextAdventureDialoguePassArtifactV1,
} from '../../src/lib/adventure/dialogue-pass'
import {
  parseTextAdventureAutoplayReportV1,
  parseTextAdventurePlaytestStrategyArtifactV1,
  TEXT_ADVENTURE_PLAYTEST_ROUTE_KINDS_V1,
} from '../../src/lib/adventure/autoplay'
import {
  canonicalizeTextAdventureChoiceLocationsV1,
  validateTextAdventureNarrativeLocationPlanV1,
} from '../../src/lib/adventure/narrative-location-plan'

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
  it('商业候选结局必须逐项兑现冻结后果，并包含正式 NPC 的角色回响', () => {
    const beats = [{
      beatKey: 'beat.ending.001', kind: 'dialogue' as const,
      speakerKey: 'character.npc.1', text: '我会离开，但港城终于知道了真相。', order: 0,
    }]
    expect(() => validateTextAdventureCommercialEndingNarrativeV1({
      endingKey: 'ending.001', endingText: '港城知情，同伴离开。', beats,
      requiredConsequences: ['港城知情', '同伴离开'],
      nonPlayerSpeakerKeys: ['character.npc.1'],
    })).not.toThrow()
    expect(() => validateTextAdventureCommercialEndingNarrativeV1({
      endingKey: 'ending.001', endingText: '港城知情。', beats,
      requiredConsequences: ['港城知情', '同伴离开'],
      nonPlayerSpeakerKeys: ['character.npc.1'],
    })).toThrow('未兑现冻结结局后果')
    expect(() => validateTextAdventureCommercialEndingNarrativeV1({
      endingKey: 'ending.001', endingText: '港城知情，同伴离开。',
      beats: [{ ...beats[0], speakerKey: 'character.player' }],
      requiredConsequences: ['港城知情', '同伴离开'],
      nonPlayerSpeakerKeys: ['character.npc.1'],
    })).toThrow('缺少正式 NPC 的角色回响')
  })

  it('自动游玩报告必须绑定当前 Build/package，试玩总监不能自行批准发布', () => {
    const packageHash = 'a'.repeat(64)
    const autoplay = {
      schema: 'storyforge.text-adventure-autoplay-report', version: 1,
      buildNumber: 3, packageHash, seed: `storyforge-autoplay-v1:${packageHash}`, passed: true,
      cases: [
        'golden-route', 'ending-coverage', 'alternate-route', 'failure-forward',
        'state-roundtrip', 'branch-isolation', 'ai-offline', 'media-offline',
      ].map(kind => ({
        caseKey: `autoplay.${kind}`, kind, passed: true, endingKeys: ['ending.001'],
        choiceCount: 3, actionCount: 3, evidence: ['passed'],
      })),
      routeSummary: {
        enumeratedRouteCount: 2, reachableEndingKeys: ['ending.001'], truncated: false,
        minimumRouteTextUnits: 3_000, estimatedMinimumRouteMinutes: 20,
      },
      manualRequiredKinds: ['refresh-resume'],
    }
    expect(parseTextAdventureAutoplayReportV1(autoplay, { buildNumber: 3, packageHash })).toMatchObject({
      passed: true, buildNumber: 3,
    })
    expect(() => parseTextAdventureAutoplayReportV1(autoplay, {
      buildNumber: 4, packageHash,
    })).toThrow('未绑定当前 Build/package')

    const strategy = {
      schema: 'storyforge.text-adventure-playtest-strategy-artifact', version: 1,
      routeCases: TEXT_ADVENTURE_PLAYTEST_ROUTE_KINDS_V1.map(kind => ({
        caseKey: `playtest.${kind}`, kind,
        executionMode: 'real-browser', objective: `验证 ${kind}`,
        steps: ['执行用例'], expectedAssertions: ['保留证据'], evidenceRefs: ['quality.autoplay'], required: true,
      })),
      humanSessions: [{
        sessionKey: 'human.golden', participantRole: 'independent-player', routeKind: 'golden-route',
        timingRequired: true, prompts: ['记录体验'], passCriteria: ['完整通关'],
      }, {
        sessionKey: 'human.failure', participantRole: 'author', routeKind: 'failure-forward',
        timingRequired: false, prompts: ['检查失败推进'], passCriteria: ['没有死路'],
      }],
      blockingRisks: [], recommendation: 'eligible-for-human-validation',
    }
    expect(parseTextAdventurePlaytestStrategyArtifactV1({
      value: strategy, buildNumber: 3, autoplayPassed: false, qualityReleaseReady: true,
    })).toMatchObject({ buildNumber: 3, recommendation: 'blocked' })
    const missingRoute = structuredClone(strategy)
    missingRoute.routeCases.pop()
    expect(() => parseTextAdventurePlaytestStrategyArtifactV1({
      value: missingRoute, buildNumber: 3, autoplayPassed: true, qualityReleaseReady: true,
    })).toThrow('全部必需路线类型')
  })

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

  it('来源决策回执必须绑定审计 hash，并完整接受当次私域补充清单', () => {
    const sourceAudit = parseTextAdventureSourceSufficiencyArtifactV1({
      value: {
        schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
        decision: 'ready-with-private-additions', adaptationStrategy: 'expand-sparse',
        coverage: [{ domain: 'characters', status: 'partial', resourceKeys: ['world.character.0'], rationale: '主角充分，配角需要产品私域补充。' }],
        gaps: [{ key: 'gap.supporting-cast', severity: 'warning', description: '缺少两个支线配角。', affectedStages: ['content.cast-bible'] }],
        privateAdditions: [{ key: 'addition.supporting-cast', kind: 'character', title: '补充支线配角', rationale: '仅服务本游戏任务，不改变世界事实。' }],
        authorDecisionRequired: true,
      },
      brief: brief(), allowedResourceKeys: ['world.character.0'],
    })
    const value = {
      schema: 'storyforge.text-adventure-source-decision-artifact', version: 1,
      sourceAuditHash: 'a'.repeat(64), decision: 'accept-product-private-expansion',
      acceptedPrivateAdditionKeys: ['addition.supporting-cast'],
      authorCommandId: 'author.accept-source-expansion', authorNote: '已审查并接受。',
    }
    expect(parseTextAdventureSourceDecisionArtifactV1({
      value, sourceAudit, sourceAuditHash: 'a'.repeat(64),
    })).toMatchObject({ decision: 'accept-product-private-expansion' })
    expect(() => parseTextAdventureSourceDecisionArtifactV1({
      value: { ...value, acceptedPrivateAdditionKeys: [] },
      sourceAudit, sourceAuditHash: 'a'.repeat(64),
    })).toThrow('未完整接受')
    expect(() => parseTextAdventureSourceDecisionArtifactV1({
      value, sourceAudit, sourceAuditHash: 'b'.repeat(64),
    })).toThrow('未绑定当前来源审计')
  })

  it('视觉圣经逐字绑定角色圣经，商业出图回执必须确认全部角色且绑定当前 hash', () => {
    const cast = castBible('commercial-candidate')
    const visualBible = parseTextAdventureVisualBibleArtifactV1({
      value: {
        schema: 'storyforge.text-adventure-visual-bible-artifact', version: 1,
        style: '克制的雾港写实插画，角色先于环境统一定稿。',
        palette: ['#172033', '#52647A', '#D8C6A0'],
        compositionRules: ['正文留出稳定文字安全区', '关键抉择使用近景强化人物关系'],
        continuityRules: ['角色跨场景保持身份和年龄段', '服装与标志物保持一致', '环境光照服从场景时刻'],
        characterAnchors: cast.characters.map(character => ({
          characterKey: character.key, name: character.name, role: character.role,
          identity: character.publicIdentity, visualAnchor: character.visualAnchor,
          requirementArtifactKeys: character.role === 'player' ? ['media.visual.001'] : [],
          palette: ['#172033', '#52647A', '#D8C6A0'],
          hardConstraints: ['保持角色身份和年龄段', `身份:${character.publicIdentity}`, `锚点:${character.visualAnchor}`],
        })),
        assetRequirements: [{
          artifactKey: 'media.visual.001', mediaKind: 'character-pose',
          sceneTag: 'scene.opening', beatKey: 'beat.opening',
        }],
      },
      cast,
      expectedAssetKeys: ['media.visual.001'],
    })
    const visualBibleHash = 'a'.repeat(64)
    const decision = {
      schema: 'storyforge.text-adventure-media-anchor-decision-artifact', version: 1,
      visualBibleHash, decision: 'confirm-character-anchors',
      confirmedCharacterKeys: cast.characters.map(character => character.key),
      authorCommandId: 'author.confirm-anchors', authorNote: '已逐项核对并确认。',
    }
    expect(parseTextAdventureMediaAnchorDecisionArtifactV1({
      value: decision, visualBible, visualBibleHash, confirmationRequired: true,
    }).confirmedCharacterKeys).toHaveLength(6)
    expect(() => parseTextAdventureMediaAnchorDecisionArtifactV1({
      value: { ...decision, confirmedCharacterKeys: decision.confirmedCharacterKeys.slice(1) },
      visualBible, visualBibleHash, confirmationRequired: true,
    })).toThrow('缺少完整作者确认')
    expect(() => parseTextAdventureVisualBibleArtifactV1({
      value: {
        ...visualBible,
        characterAnchors: visualBible.characterAnchors.map((anchor, index) => index === 0
          ? { ...anchor, visualAnchor: '模型擅自改写的视觉身份' } : anchor),
      },
      cast,
      expectedAssetKeys: ['media.visual.001'],
    })).toThrow('未逐字绑定角色圣经')
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

  it('玩家可没有额外禁止知识，但 NPC 仍必须声明知识边界', () => {
    const characters = structuredClone(castBible('commercial-candidate').characters)
    characters[0].forbiddenKnowledge = []
    expect(parseTextAdventureCastBibleArtifactV1({
      value: { schema: 'storyforge.text-adventure-cast-bible-artifact', version: 1, characters },
      brief: brief('commercial-candidate'),
      allowedResourceKeys: ['world.character.0', 'world.character.1'],
    }).characters[0].forbiddenKnowledge).toEqual([])
    characters[1].forbiddenKnowledge = []
    expect(() => parseTextAdventureCastBibleArtifactV1({
      value: { schema: 'storyforge.text-adventure-cast-bible-artifact', version: 1, characters },
      brief: brief('commercial-candidate'),
      allowedResourceKeys: ['world.character.0', 'world.character.1'],
    })).toThrow('forbiddenKnowledge 数量无效')
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
    const richerArchitectureValue = structuredClone(value)
    richerArchitectureValue.acts[0].sceneCards[0].title = '潮门·开场'
    richerArchitectureValue.acts[1].sceneCards[0].title = '旧仓街·转折'
    richerArchitectureValue.acts[2].sceneCards[0].title = '外海灯塔·高潮'
    richerArchitectureValue.acts[2].sceneCards[0].locationOrdinal = 3
    expect(parseTextAdventureNarrativeArcPlanArtifactV1({
      value: richerArchitectureValue,
      brief: brief(),
      cast,
      storyBible: story,
      locationTitles: ['潮门', '旧仓街', '外海灯塔'],
    }).acts[2].sceneCards[0].locationOrdinal).toBe(3)
    const mismatchedFrozenLocation = structuredClone(richerArchitectureValue)
    mismatchedFrozenLocation.acts[2].sceneCards[0].locationOrdinal = 2
    expect(() => parseTextAdventureNarrativeArcPlanArtifactV1({
      value: mismatchedFrozenLocation,
      brief: brief(),
      cast,
      storyBible: story,
      locationTitles: ['潮门', '旧仓街', '外海灯塔'],
    })).toThrow('必须为冻结映射 3')
    const crossLocationSetup = structuredClone(richerArchitectureValue)
    crossLocationSetup.acts[2].sceneCards[0].purpose = '回收潮门留下的伏笔，并在外海灯塔完成最终抉择'
    expect(parseTextAdventureNarrativeArcPlanArtifactV1({
      value: crossLocationSetup,
      brief: brief(),
      cast,
      storyBible: story,
      locationTitles: ['潮门', '旧仓街', '外海灯塔'],
    }).acts[2].sceneCards[0]).toMatchObject({ locationOrdinal: 3 })
    const broken = structuredClone(value)
    broken.decisions[0].options[0].echoSceneKeys = ['scene.002']
    expect(() => parseTextAdventureNarrativeArcPlanArtifactV1({ value: broken, brief: brief(), cast, storyBible: story }))
      .toThrow('数量无效')
    const pastEcho = structuredClone(value)
    pastEcho.decisions[0].options[0].echoSceneKeys = ['scene.001', 'scene.002']
    expect(() => parseTextAdventureNarrativeArcPlanArtifactV1({
      value: pastEcho, brief: brief(), cast, storyBible: story,
    })).toThrow('回响必须位于决定场景之后')
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
      schema: 'storyforge.text-adventure-quest-script-artifact', version: 2,
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
    const script = parseTextAdventureQuestScriptArtifactV2({
      value: questScriptValue, brief: brief(), mainQuestPlan: parsed,
      systems: { abilities: [{ key: 'ability.perception' }] } as never,
      sideQuests: { entries: [] } as never, ambientEvents: { entries: [] } as never,
    })
    expect(script.mainObjectiveScripts[0].alternatives[0].resolution.mode).toBe('automatic')
    const illegalCheck = JSON.parse(JSON.stringify(questScriptValue))
    illegalCheck.mainObjectiveScripts[0].alternatives[0].resolution = {
      mode: 'check', abilityKey: 'ability.unknown', difficulty: 10, costlySuccessFloor: 6,
    }
    expect(() => parseTextAdventureQuestScriptArtifactV2({
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
    const compactDialoguePass = parseTextAdventureDialoguePassArtifactV1({
      value: {
        schema: dialoguePassValue.schema, version: dialoguePassValue.version,
        actKey: dialoguePassValue.actKey,
        characterAssessments: dialoguePassValue.characterAssessments,
        keptBeatKeys: [], beatReviews: dialoguePassValue.beatReviews,
        keptChoiceKeys: dialoguePassValue.choiceReviews.map(review => review.choiceKey),
        choiceReviews: [], summary: dialoguePassValue.summary,
      },
      brief: inputBrief, cast, bundles: [bundles[0]],
    })
    expect(compactDialoguePass.beatReviews).toHaveLength(dialogueBeats.length)
    expect(compactDialoguePass.choiceReviews).toHaveLength(choices.length)
    expect(compactDialoguePass.choiceReviews.every(review => review.verdict === 'keep')).toBe(true)
    const ordinalCompactDialoguePass = parseTextAdventureDialoguePassArtifactV1({
      value: {
        schema: dialoguePassValue.schema, version: dialoguePassValue.version,
        actKey: dialoguePassValue.actKey,
        reviewedCharacterCount: 1,
        reviewedBeatCount: dialogueBeats.length,
        reviewedChoiceCount: choices.length,
        beatReviews: [{
          beatOrdinal: 1, issueTags: ['exposition'], rationale: '删去背景朗读。',
          revisedText: '“钟只剩三响，”同伴压住灯罩，“你要真相，还是要他们先活过今晚？”',
        }],
        choiceReviews: [],
      },
      brief: inputBrief, cast, bundles: [bundles[0]],
    })
    expect(ordinalCompactDialoguePass.beatReviews).toHaveLength(dialogueBeats.length)
    expect(ordinalCompactDialoguePass.beatReviews[0].verdict).toBe('revise')
    expect(ordinalCompactDialoguePass.choiceReviews.every(review => review.verdict === 'keep')).toBe(true)
    expect(ordinalCompactDialoguePass.characterAssessments).toHaveLength(1)
    expect(ordinalCompactDialoguePass.summary).toContain(`已逐项审校 ${dialogueBeats.length} 条对白`)
    const reorderedDialoguePass = parseTextAdventureDialoguePassArtifactV1({
      value: {
        ...dialoguePassValue,
        beatReviews: [...dialoguePassValue.beatReviews].reverse(),
        choiceReviews: [...dialoguePassValue.choiceReviews].reverse(),
      },
      brief: inputBrief, cast, bundles: [bundles[0]],
    })
    expect(reorderedDialoguePass.beatReviews.map(review => review.beatKey)).toEqual(
      dialoguePass.beatReviews.map(review => review.beatKey),
    )
    expect(reorderedDialoguePass.choiceReviews.map(review => review.choiceKey)).toEqual(
      dialoguePass.choiceReviews.map(review => review.choiceKey),
    )
    const redundantKeepFields = structuredClone(dialoguePassValue)
    redundantKeepFields.beatReviews[0] = {
      ...redundantKeepFields.beatReviews[0], verdict: 'keep', issueTags: ['none'], revisedText: '',
    }
    redundantKeepFields.choiceReviews[0] = {
      ...redundantKeepFields.choiceReviews[0], revisedText: '模型夹带的非权威副本', revisedDescription: '',
    }
    const normalizedKeep = parseTextAdventureDialoguePassArtifactV1({
      value: redundantKeepFields, brief: inputBrief, cast, bundles: [bundles[0]],
    })
    expect(normalizedKeep.beatReviews[0].revisedText).toBe(dialogueBeats[0].text)
    expect(normalizedKeep.choiceReviews[0]).toMatchObject({
      revisedText: choices[0].text, revisedDescription: choices[0].description,
    })
    const flaggedNoOp = structuredClone(dialoguePassValue)
    flaggedNoOp.beatReviews[0].revisedText = dialogueBeats[0].text
    flaggedNoOp.choiceReviews[0] = {
      ...flaggedNoOp.choiceReviews[0], verdict: 'revise', issueTags: ['player-intent'],
      revisedText: choices[0].text, revisedDescription: choices[0].description,
    }
    const normalizedNoOp = parseTextAdventureDialoguePassArtifactV1({
      value: flaggedNoOp, brief: inputBrief, cast, bundles: [bundles[0]],
    })
    expect(normalizedNoOp.beatReviews[0]).toMatchObject({ verdict: 'keep', issueTags: ['none'] })
    expect(normalizedNoOp.beatReviews[0].rationale).toContain('exposition')
    expect(normalizedNoOp.choiceReviews[0]).toMatchObject({ verdict: 'keep', issueTags: ['none'] })
    expect(normalizedNoOp.choiceReviews[0].rationale).toContain('player-intent')
    expect(parseTextAdventureDialoguePassArtifactV1({
      value: normalizedNoOp, brief: inputBrief, cast, bundles: [bundles[0]],
    })).toEqual(normalizedNoOp)
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
    const locationNodes = [
      { key: 'scene.a', kind: 'entry' as const, title: '起点', summary: '冰窟渔村', conditionJson: '{}', effectsJson: '[]', successorKeys: ['scene.b'] },
      { key: 'scene.b', kind: 'scene' as const, title: '中段', summary: '冰窟渔村', conditionJson: '{}', effectsJson: '[]', successorKeys: ['scene.c'] },
      { key: 'scene.c', kind: 'scene' as const, title: '终段', summary: '观潮台废墟', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
    ]
    const alignedChoices = canonicalizeTextAdventureChoiceLocationsV1({
      nodes: locationNodes,
      choices: [{
        choiceKey: 'choice.location-drift', sourceNodeKey: 'scene.b', targetNodeKey: 'scene.c',
        text: '赶往冰窟渔村', description: '去冰窟渔村完成最后的选择。', unavailableReason: '',
        displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
      }],
      locationTitles: ['冰窟渔村', '观潮台废墟'],
    })
    expect(alignedChoices[0]).toMatchObject({
      text: '赶往观潮台废墟', description: '去观潮台废墟完成最后的选择。',
    })
    expect(validateTextAdventureNarrativeLocationPlanV1({
      nodes: locationNodes, beats: [], choices: alignedChoices,
      locationTitles: ['冰窟渔村', '观潮台废墟'],
    })).toEqual([])
    const omittedCosmeticOrder = bundleValue(0)
    delete omittedCosmeticOrder.scenes[0].beats[0].order
    delete omittedCosmeticOrder.choices[0].order
    delete omittedCosmeticOrder.choices[0].unavailableReason
    const normalizedOrder = parseTextAdventureSceneScriptBundleArtifactV1({
      value: omittedCosmeticOrder, brief: inputBrief, actIndex: 0,
      allowedSpeakerKeys: cast.characters.map(character => character.key),
      locationTitles, expectedModuleTitle: story.title, sceneTitles, endingTitles,
    })
    expect(normalizedOrder.scenes[0].beats[0].order).toBe(0)
    expect(normalizedOrder.choices[0].order).toBe(skeleton.edges[0].order)
    expect(normalizedOrder.choices[0].unavailableReason).toBe('当前状态不满足此行动条件。')
    const scopedBrief = {
      ...inputBrief,
      textAdventure: {
        ...inputBrief.textAdventure!,
        narrative: { ...inputBrief.textAdventure!.narrative, targetSceneCount: 6 },
      },
    }
    const scopedSkeleton = textAdventureNarrativeSkeletonV1(scopedBrief)
    const scopedSceneTitles = Object.fromEntries(scopedSkeleton.sceneKeys.map((sceneKey, index) => (
      [sceneKey, `场景${index + 1}`]
    )))
    const wholeActWithNestedChoices = {
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
      actKey: 'act.1', moduleTitle: story.title,
      scenes: ['scene.001', 'scene.002'].map((sceneKey, sceneIndex) => ({
        sceneKey, title: scopedSceneTitles[sceneKey], summary: `潮门广场内的第${sceneIndex + 1}个场景。`,
        beats: [{
          beatKey: `beat.scope.${sceneIndex + 1}`, kind: 'narration', speakerKey: null,
          text: `潮门广场的钟声推动第${sceneIndex + 1}个场景。`, order: 0,
        }],
        choices: scopedSkeleton.edges.filter(edge => edge.sourceNodeKey === sceneKey).map(edge => ({
          ...edge, text: `选择${edge.choiceKey}`, description: `执行${edge.choiceKey}并承担后果。`,
          unavailableReason: '当前目标尚未完成。',
        })),
      })),
      choices: [], endings: [],
    }
    const scopedPart = parseTextAdventureSceneScriptBundleArtifactV1({
      value: wholeActWithNestedChoices, brief: scopedBrief, actIndex: 0,
      allowedSpeakerKeys: cast.characters.map(character => character.key),
      locationTitles, expectedModuleTitle: story.title,
      sceneTitles: scopedSceneTitles, endingTitles, expectedSceneKeys: ['scene.001'],
    })
    expect(scopedPart.scenes.map(scene => scene.sceneKey)).toEqual(['scene.001'])
    expect(scopedPart.choices.map(choice => choice.choiceKey)).toEqual(
      scopedSkeleton.edges.filter(edge => edge.sourceNodeKey === 'scene.001').map(edge => edge.choiceKey),
    )
    expect(Object.keys(scopedPart.scenes[0])).toEqual(['sceneKey', 'title', 'summary', 'beats'])
    const providerNestedOnly = structuredClone(wholeActWithNestedChoices)
    delete (providerNestedOnly as { choices?: unknown }).choices
    delete (providerNestedOnly as { endings?: unknown }).endings
    expect(parseTextAdventureSceneScriptBundleArtifactV1({
      value: providerNestedOnly, brief: scopedBrief, actIndex: 0,
      allowedSpeakerKeys: cast.characters.map(character => character.key),
      locationTitles, expectedModuleTitle: story.title,
      sceneTitles: scopedSceneTitles, endingTitles, expectedSceneKeys: ['scene.001'],
    }).choices.map(choice => choice.choiceKey)).toEqual(
      scopedSkeleton.edges.filter(edge => edge.sourceNodeKey === 'scene.001').map(edge => edge.choiceKey),
    )
    const canonicalLocationFallback = structuredClone(wholeActWithNestedChoices)
    canonicalLocationFallback.scenes[0].summary = '玩家在此处察觉到钟声有异。'
    canonicalLocationFallback.scenes[0].beats[0].text = '远处的钟声推动局势变化。'
    const normalizedLocation = parseTextAdventureSceneScriptBundleArtifactV1({
      value: canonicalLocationFallback, brief: scopedBrief, actIndex: 0,
      allowedSpeakerKeys: cast.characters.map(character => character.key),
      locationTitles, expectedModuleTitle: story.title,
      sceneTitles: scopedSceneTitles, endingTitles, expectedSceneKeys: ['scene.001'],
    })
    expect(normalizedLocation.scenes[0].summary).toBe('潮门广场｜玩家在此处察觉到钟声有异。')
    const providerRenamedScene = structuredClone(wholeActWithNestedChoices)
    providerRenamedScene.scenes[0].title = '模型擅自改的标题'
    expect(parseTextAdventureSceneScriptBundleArtifactV1({
      value: providerRenamedScene, brief: scopedBrief, actIndex: 0,
      allowedSpeakerKeys: cast.characters.map(character => character.key),
      locationTitles, expectedModuleTitle: story.title,
      sceneTitles: scopedSceneTitles, endingTitles, expectedSceneKeys: ['scene.001'],
    }).scenes[0].title).toBe(scopedSceneTitles['scene.001'])
    const conflictingNestedChoice = structuredClone(wholeActWithNestedChoices)
    conflictingNestedChoice.choices = [{
      ...conflictingNestedChoice.scenes[0].choices[0], text: '与 scene 内副本冲突的选择',
    }]
    expect(() => parseTextAdventureSceneScriptBundleArtifactV1({
      value: conflictingNestedChoice, brief: scopedBrief, actIndex: 0,
      allowedSpeakerKeys: cast.characters.map(character => character.key),
      locationTitles, expectedModuleTitle: story.title,
      sceneTitles: scopedSceneTitles, endingTitles, expectedSceneKeys: ['scene.001'],
    })).toThrow('根级与 scene 内的重复内容冲突')
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
