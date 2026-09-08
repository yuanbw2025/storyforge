import { describe, expect, it } from 'vitest'
import {
  createTextOpenWorldSceneScriptsModelContextV1,
  type TextOpenWorldSceneScriptsInputContextV1,
} from '../../src/lib/open-world/scene-scripts-production'
import {
  assertTextOpenWorldSceneDemandCapacityV1,
  countTextOpenWorldSceneDemandsV1,
} from '../../src/lib/open-world/scene-demand-capacity'

describe('R-OPEN-WORLD-G4-11A · P9 governed-v3 model disclosure', () => {
  it('proves the shared P8F/P9 deterministic Scene capacity at 127 and rejects 128', () => {
    const atLimit = {
      quests: Array.from({ length: 30 }),
      objectives: Array.from({ length: 60 }),
      actors: Array.from({ length: 4 }),
      interactions: Array.from({ length: 2 }),
      randomEvents: Array.from({ length: 1 }),
    }
    expect(countTextOpenWorldSceneDemandsV1(atLimit)).toBe(127)
    expect(assertTextOpenWorldSceneDemandCapacityV1(atLimit)).toBe(127)
    expect(() => assertTextOpenWorldSceneDemandCapacityV1({
      ...atLimit,
      randomEvents: Array.from({ length: 2 }),
    })).toThrow(/场景数超过硬上限:128\/127/)
  })

  it('keeps the durable v2 envelope but sends the runner only a deterministic safe projection', async () => {
    const context = {
      schema: 'storyforge.text-open-world-scene-scripts-input',
      version: 2,
      modelDisclosureContract: 'governed-v3',
      productInstanceKey: 'tow.disclosure.fixture',
      sourceLedger: {
        entries: [{ statement: 'LEAK_SOURCE_STATEMENT', evidence: ['LEAK_SOURCE_EVIDENCE'] }],
      },
      experienceContract: {
        toneGuide: ['克制、清晰'],
        freedom: { acceptedInputs: ['system-action', 'fixed-choice', 'natural-language'] },
      },
      storyArc: { summary: 'LEAK_STORY_ARC_PROSE' },
      regionNarrativePacks: {
        packs: [{
          regionKey: 'region.001',
          characterRequirements: [{
            key: 'actor.001', roleTitle: 'LEAK_ROLE_TITLE', narrativeFunction: 'LEAK_CHARACTER_NARRATIVE_FUNCTION',
            homeLocationKey: 'location.001', routine: 'LEAK_CHARACTER_ROUTINE', serviceNeeds: ['LEAK_CHARACTER_SERVICE_NEED'],
          }],
          taskTemplateSeeds: [{
            key: 'template-seed.001', title: '港口委托模板', storyFrame: '居民提出一个可当场解决的港口难题。',
            variationAxes: ['委托人', '目标物'], eligibilitySummary: '玩家已经抵达港口。', cooldownIntent: '避免连续出现同类委托。',
          }],
        }],
      },
      questSkeletons: {
        quests: [{
          key: 'quest.001', source: { kind: 'template-seed', sourceKey: 'template-seed.001' }, stageKeys: [],
        }],
        stages: [],
      },
      npcRuntimeCatalog: {
        factions: [{ key: 'faction.001', title: '公开势力', publicGoal: '保护当地居民' }],
        actors: [{
          key: 'actor.001', name: '公开角色', factionKey: 'faction.001',
          regionKey: 'region.001', homeLocationKey: 'location.001',
          biography: 'LEAK_NPC_BIOGRAPHY', portrayal: 'LEAK_NPC_PORTRAYAL',
        }],
      },
      mapInteractionCatalog: {
        regions: [{ key: 'region.001', title: '公开地区', description: '一处繁忙的公开港区。', theme: '海港边境' }],
        locations: [{
          key: 'location.001', regionKey: 'region.001', title: '公开地点',
          description: '可供调查的港口广场。', purpose: '承载当前调查。',
        }],
        interactions: [],
      },
      questDesignDocuments: {
        governance: { knowledgeProgressReady: true },
        knowledgeBindings: [{ truthSummary: 'LEAK_HIDDEN_TRUTH' }],
        quests: [{ key: 'quest.001', type: 'template', title: '公开任务' }],
        objectives: [{
          key: 'objective.current', title: '当前目标', description: '检查港口广场留下的公开痕迹。',
        }, {
          key: 'objective.second', title: '第二场目标', description: '向守望者核对已经公开的调查记录。',
        }, {
          key: 'objective.future.001', title: 'LEAK_FUTURE_OBJECTIVE_TITLE', description: 'LEAK_FUTURE_OBJECTIVE_PROSE',
        }],
        actions: [{
          key: 'action.current', category: 'talk', label: 'LEAK_ACTION_LABEL', description: 'LEAK_NPC_PORTRAYAL_VIA_ACTION',
          actorScope: 'player', targetScope: 'actor', locationKeys: ['location.001'],
          requirementConditionKeys: [], confirmationPolicy: 'none', actionDefinitionHash: 'b'.repeat(64),
        }, {
          key: 'action.future', category: 'quest-action', label: 'LEAK_FUTURE_ACTION_LABEL', description: 'LEAK_FUTURE_ACTION_DESCRIPTION',
          actorScope: 'player', targetScope: 'none', locationKeys: ['location.001'],
          requirementConditionKeys: [], confirmationPolicy: 'always', actionDefinitionHash: 'c'.repeat(64),
        }],
      },
      directorDecks: {
        randomEvents: [{
          key: 'event.director.rumor.001', title: '公开传闻入口', description: 'LEAK_HIDDEN_RUMOR_TEXT',
          kind: 'clue', rumorKey: 'rumor.001', regionKeys: ['region.001'], locationKeys: ['location.001'],
        }],
      },
      knowledgeBoundaries: [{
        key: 'knowledge-boundary.001',
        allowedKnowledgeClaimKeys: ['knowledge.001'],
        forbiddenFutureObjectiveKeys: ['objective.future.001'],
      }],
      sceneDemands: [{
        sceneNumber: 1,
        sceneKey: 'scene.objective.current',
        sourceKind: 'quest-objective',
        sourceKey: 'objective.current',
        suggestedTitle: 'LEAK_FUTURE_OBJECTIVE_TITLE',
        purpose: 'LEAK_FUTURE_OBJECTIVE_PROSE',
        regionKey: 'region.001',
        locationKey: 'location.001',
        questKey: 'quest.001',
        stageKey: 'stage.001',
        objectiveKey: 'objective.current',
        actorKey: 'actor.001',
        interactionKey: null,
        randomEventKey: null,
        participantKeys: ['actor.001'],
        actionKeys: ['action.current'],
        choiceCount: 1,
        knowledgeBoundaryKey: 'knowledge-boundary.001',
        availabilityConditionKeys: ['condition.current'],
      }, {
        sceneNumber: 2,
        sceneKey: 'scene.objective.second',
        sourceKind: 'quest-objective',
        sourceKey: 'objective.second',
        suggestedTitle: 'UNSAFE_RAW_SECOND_TITLE',
        purpose: 'UNSAFE_RAW_SECOND_PURPOSE',
        regionKey: 'region.001',
        locationKey: 'location.001',
        questKey: 'quest.001',
        stageKey: 'stage.002',
        objectiveKey: 'objective.second',
        actorKey: 'actor.001',
        interactionKey: null,
        randomEventKey: null,
        participantKeys: ['actor.001'],
        actionKeys: ['action.current'],
        choiceCount: 1,
        knowledgeBoundaryKey: 'knowledge-boundary.001',
        availabilityConditionKeys: ['condition.current'],
      }],
      actionLanguageDemands: [
        { actionNumber: 1, actionKey: 'action.current' },
        { actionNumber: 2, actionKey: 'action.future' },
      ],
      templateVariantDemands: [{
        variantNumber: 1,
        requirementKey: 'presentation-requirement.001',
        templateKey: 'template.001',
        questKey: 'quest.001',
        regionKeys: ['region.001'],
      }, {
        variantNumber: 2,
        requirementKey: 'presentation-requirement.002',
        templateKey: 'template.001',
        questKey: 'quest.001',
        regionKeys: ['region.001'],
      }, {
        variantNumber: 3,
        requirementKey: 'presentation-requirement.003',
        templateKey: 'template.001',
        questKey: 'quest.001',
        regionKeys: ['region.001'],
      }],
      randomEventPresentationDemands: [{
        eventNumber: 1,
        randomEventKey: 'event.director.rumor.001',
        title: 'LEAK_EVENT_TITLE',
        kind: 'clue',
        regionKey: 'region.001',
        locationKeys: ['location.001'],
        rumorRequirementKey: 'rumor-requirement.001',
        sourceClaimKeys: ['source.claim.001'],
      }],
      knowledgePresentationDemands: [{
        knowledgeNumber: 1,
        knowledgeKey: 'knowledge.001',
        kind: 'quest-clue',
        publicSubjectLabel: '公开线索',
      }],
      achievementPresentationDemands: [{
        achievementNumber: 1,
        achievementKey: 'achievement.quest.001',
        sourceKind: 'quest-reward-claim',
        publicSourceLabel: '公开任务',
      }],
      contextSelectionHash: 'a'.repeat(64),
    } as unknown as TextOpenWorldSceneScriptsInputContextV1

    const firstScene = await createTextOpenWorldSceneScriptsModelContextV1(context, { kind: 'scene', sceneIndex: 0 })
    const firstSceneAgain = await createTextOpenWorldSceneScriptsModelContextV1(context, { kind: 'scene', sceneIndex: 0 })
    const secondScene = await createTextOpenWorldSceneScriptsModelContextV1(context, { kind: 'scene', sceneIndex: 1 })
    const actorContext = {
      ...context,
      sceneDemands: [...context.sceneDemands, {
        ...context.sceneDemands[0]!,
        sceneNumber: 3,
        sceneKey: 'scene.actor.current',
        sourceKind: 'actor-dialogue' as const,
        sourceKey: 'actor.001',
        questKey: null,
        stageKey: null,
        objectiveKey: null,
      }],
    }
    const actorDialogue = await createTextOpenWorldSceneScriptsModelContextV1(actorContext, { kind: 'scene', sceneIndex: 2 })
    const shared = await createTextOpenWorldSceneScriptsModelContextV1(context, { kind: 'shared-presentations' })
    const calls = [firstScene, secondScene, actorDialogue, shared] as Array<Record<string, unknown>>

    await expect(createTextOpenWorldSceneScriptsModelContextV1(context))
      .rejects.toThrow(/必须使用场景或共享表现硬隔离切片/)
    expect(firstScene).toEqual(firstSceneAgain)
    expect(firstScene).toMatchObject({
      schema: 'storyforge.text-open-world-scene-scripts-model-input',
      version: 1,
      modelDisclosureContract: 'governed-v3',
      sceneDemands: [{
        sceneNumber: 1,
        suggestedTitle: '当前目标',
        purpose: '依据currentObjective呈现当前任务目标与正式行动。',
        currentObjective: {
          objectiveKey: 'objective.current',
          title: '当前目标',
          description: '检查港口广场留下的公开痕迹。',
        },
        actionTargets: [{ actionKey: 'action.current', targetPolicy: 'fixed', targetKey: 'actor.001' }],
      }],
      knowledgeBoundaries: [{ key: 'knowledge-boundary.001' }],
      actionLanguageDemands: [],
      templateVariantDemands: [],
      randomEventPresentationDemands: [],
      knowledgePresentationDemands: [],
      achievementPresentationDemands: [],
      publicCatalogs: {
        regions: [{ regionKey: 'region.001' }],
        locations: [{ locationKey: 'location.001' }],
        factions: [{ factionKey: 'faction.001', title: '公开势力', publicGoal: '保护当地居民' }],
        actors: [{
          actorKey: 'actor.001',
          name: '公开角色',
        }],
        actions: [{ actionKey: 'action.current', label: '与公开角色交谈', targetScope: 'actor' }],
      },
    })
    expect(secondScene).toMatchObject({
      sceneDemands: [{
        sceneNumber: 1,
        suggestedTitle: '第二场目标',
        purpose: '依据currentObjective呈现当前任务目标与正式行动。',
        currentObjective: {
          objectiveKey: 'objective.second',
          title: '第二场目标',
          description: '向守望者核对已经公开的调查记录。',
        },
        actionTargets: [{ actionKey: 'action.current', targetPolicy: 'fixed', targetKey: 'actor.001' }],
      }],
      actionLanguageDemands: [],
      templateVariantDemands: [],
      randomEventPresentationDemands: [],
    })
    expect(shared).toMatchObject({
      sceneDemands: [],
      knowledgeBoundaries: [],
      publicCatalogs: {
        regions: [{ regionKey: 'region.001' }],
        locations: [{ locationKey: 'location.001' }],
        taskTemplates: [{
          sourceSeedKey: 'template-seed.001',
          storyFrame: '居民提出一个可当场解决的港口难题。',
          variationAxes: ['委托人', '目标物'],
          eligibilitySummary: '玩家已经抵达港口。',
          cooldownIntent: '避免连续出现同类委托。',
        }],
      },
      templateVariantDemands: [
        { sourceTemplateSeedKey: 'template-seed.001' },
        { sourceTemplateSeedKey: 'template-seed.001' },
        { sourceTemplateSeedKey: 'template-seed.001' },
      ],
      knowledgePresentationDemands: [{ publicSubjectLabel: '公开线索' }],
      achievementPresentationDemands: [{ publicSourceLabel: '公开任务' }],
      actionLanguageDemands: [],
    })
    expect(actorDialogue).toMatchObject({
      sceneDemands: [{ sourceKind: 'actor-dialogue', currentObjective: null }],
      publicCatalogs: {
        actors: [{
          actorKey: 'actor.001',
          name: '公开角色',
          publicProfile: {
            roleTitle: '当地角色',
            narrativeFunction: '回应当前场景列出的公开交互与正式行动。',
            routine: '在当前地点按已公开状态提供简短回应。',
            serviceNeeds: [],
          },
        }],
      },
    })
    for (const call of calls) {
      const encoded = JSON.stringify(call)
      expect(call).not.toHaveProperty('sourceLedger')
      expect(call).not.toHaveProperty('storyArc')
      expect(call).not.toHaveProperty('npcRuntimeCatalog')
      expect(call).not.toHaveProperty('questDesignDocuments')
      expect(encoded).not.toContain('writingMaterials')
      expect(encoded).not.toMatch(/LEAK_|UNSAFE_RAW/)
      expect(encoded).not.toContain('objective.future.001')
      expect(encoded).not.toContain('source.claim.001')
      expect((call.sceneDemands as unknown[]).length).toBeLessThanOrEqual(1)
      expect((call as { contextSelectionHash: string }).contextSelectionHash).toMatch(/^[a-f0-9]{64}$/)
      expect(encoded.includes('检查港口广场留下的公开痕迹。')
        && encoded.includes('向守望者核对已经公开的调查记录。')).toBe(false)
    }
    expect(JSON.stringify(firstScene).split('可供调查的港口广场。')).toHaveLength(2)
    expect(JSON.stringify(firstScene).split('与当前角色交谈，只呈现其在当前场景愿意公开的信息或服务。')).toHaveLength(2)
    expect(JSON.stringify(actorDialogue).split('回应当前场景列出的公开交互与正式行动。')).toHaveLength(2)
    expect(JSON.stringify(firstScene).split('检查港口广场留下的公开痕迹。')).toHaveLength(2)
    expect(JSON.stringify(firstScene)).not.toContain('向守望者核对已经公开的调查记录。')
    expect(JSON.stringify(secondScene)).not.toContain('检查港口广场留下的公开痕迹。')
    expect(JSON.stringify(shared).split('居民提出一个可当场解决的港口难题。')).toHaveLength(2)
    expect(JSON.stringify(shared)).not.toContain('currentObjective')

    const atLimit = {
      ...context,
      sceneDemands: Array.from({ length: 127 }, (_, index) => ({
        ...context.sceneDemands[0]!,
        sceneNumber: index + 1,
        sceneKey: `scene.limit.${String(index + 1).padStart(3, '0')}`,
      })),
    }
    await expect(createTextOpenWorldSceneScriptsModelContextV1(atLimit, { kind: 'scene', sceneIndex: 126 }))
      .resolves.toMatchObject({ sceneDemands: [{ sceneNumber: 1 }] })
    await expect(createTextOpenWorldSceneScriptsModelContextV1({
      ...atLimit,
      sceneDemands: [...atLimit.sceneDemands, {
        ...context.sceneDemands[0]!,
        sceneNumber: 128,
        sceneKey: 'scene.limit.128',
      }],
    }, { kind: 'scene', sceneIndex: 127 })).rejects.toThrow(/场景数超过硬上限:128\/127/)
  })

  it('preserves historical runner context unchanged when Knowledge governance is absent', async () => {
    const legacy = {
      questDesignDocuments: { governance: {} },
      sourceLedger: { entries: [{ statement: 'historical runner input' }] },
    } as unknown as TextOpenWorldSceneScriptsInputContextV1

    await expect(createTextOpenWorldSceneScriptsModelContextV1(legacy)).resolves.toBe(legacy)
  })
})
