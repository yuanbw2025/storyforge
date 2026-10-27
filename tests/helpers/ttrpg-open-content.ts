import type { RulePackV1, TtrpgCharacterTemplateV1 } from '../../src/lib/types'
import type { RulePackV2, TtrpgCampaignContentV2, TtrpgOpenAuthoringV1, TtrpgOpenFactPolicyV1 } from '../../src/lib/ttrpg/open-contract'
import { OPEN_FACT_PREDICATES } from '../../src/lib/ttrpg/open-contract'
import { STORYFORGE_RULE_PACK_V1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { evaluateRuleNumberExpressionV1 } from '../../src/lib/ttrpg/rule-pack'

const HASH = 'a'.repeat(64)
export function openRuleFixture(): RulePackV2 {
  const core = structuredClone(STORYFORGE_RULE_PACK_V1)
  const check = core.checks[0]
  const factPolicy: TtrpgOpenFactPolicyV1[] = OPEN_FACT_PREDICATES.map(predicateKey => {
    const owner = predicateKey === 'owns' ? 'inventory'
      : ['allied-with', 'hostile-to', 'owes'].includes(predicateKey) ? 'social-ledger'
        : ['located-at', 'damaged', 'destroyed', 'blocked', 'open'].includes(predicateKey) ? 'entity' : 'semantic-fact'
    const valueType = ['exists', 'destroyed', 'blocked', 'open', 'allied-with', 'hostile-to', 'knows'].includes(predicateKey) ? 'boolean'
      : ['located-at', 'owns'].includes(predicateKey) ? 'entity-ref' : ['owes', 'damaged'].includes(predicateKey) ? 'number' : 'string'
    return { predicateKey, valueType, cardinality: ['knows', 'allied-with', 'hostile-to', 'owes', 'promised'].includes(predicateKey) ? 'many' : 'one',
      allowedKinds: ['entity', 'relation', 'state', 'event-truth', 'location', 'item'],
      mutuallyExclusiveWith: predicateKey === 'open' ? ['blocked'] : predicateKey === 'blocked' ? ['open']
        : predicateKey === 'allied-with' ? ['hostile-to'] : predicateKey === 'hostile-to' ? ['allied-with'] : [],
      authority: { invariant: owner === 'semantic-fact' ? owner : null, initialState: owner, session: owner }, allowNewSubjects: false }
  })
  return { ...core, version: 2, runFormat: 'open', factPolicy,
    oracles: [{ oracleKey: 'oracle.yes', title: '可能性', kind: 'yes-no', diceModelKey: core.diceModels[0].key,
      audience: 'party', chaosCoupled: false,
      likelihood: { tiers: [{ tierKey: 'even', label: '均等', yesAtOrAbove: 7, yesButBand: 1, noButBand: 1 }], defaultTierKey: 'even' },
      entries: null, interpretation: { mustRespect: ['遵守冻结事实'], forbiddenScopes: ['world-fact', 'rule-change', 'player-decision', 'retcon'], maxNewEntities: 0 },
      tests: [{ testKey: 'oracle.fixture', seed: 'open.seed', nonce: 'open.nonce', chaosValue: null, likelihoodTierKey: 'even', expectedRawResult: 'yes', expectedEntryKey: null }],
      sourceRefs: [core.ruleSystemId] }],
    genericChecks: [{ checkKey: check.key, title: '通用观察', actorAttributeKey: check.attributeKeys[0], diceModelKey: check.diceModelKey, difficulty: 10,
      preconditions: [], targetKinds: ['self'], effectPlanByDegree: { 'critical-success': null, 'extreme-success': null, 'hard-success': null, success: 'plan.success', 'partial-success': null, failure: null, 'critical-failure': null },
      riskFactRefs: ['fact.harbor'], resourceCosts: [], timeCostWorldTurns: 1, audience: 'party', sourceRefs: [core.ruleSystemId] }],
    socialTierMappings: [{ mappingKey: 'social.trust', balanceKey: 'trust', oracleKey: 'oracle.yes', defaultTierKey: 'even',
      ranges: [{ minimum: -100, maximum: 100, minimumInclusive: true, maximumInclusive: true, tierKey: 'even' }] }],
    timePolicy: { existingAction: 1, genericCheck: 1, noRoll: 1, outOfCharacter: 0, view: 0, rulesQuestion: 0, preflight: 0, oracleConsultation: 0, actionOverrides: [] } }
}
function actorFixture(characterKey: string, controller: 'human' | 'ai' | 'gm', core: RulePackV1): TtrpgCharacterTemplateV1 {
  const attributes = Object.fromEntries(core.attributes.map(a => [a.key, a.defaultValue]))
  const template: Omit<TtrpgCharacterTemplateV1, 'characterSheet'> = {
    characterKey, seatKey: controller === 'gm' ? null : `seat.${characterKey}`, name: characterKey, description: '守护港口的调查者。',
    sourceRefs: [], role: controller === 'gm' ? 'npc' : 'player', controller, attributes,
    attributeMappings: Object.fromEntries(core.attributes.map(a => [a.key, { value: a.defaultValue, derivationRule: '冻结规则默认值', sourceRefs: [], authorConfirmed: true }])),
    skills: {}, resources: Object.fromEntries(core.resources.map(r => [r.key, r.initialMode === 'maximum' ? evaluateRuleNumberExpressionV1(r.maximumFormula, attributes) : 0])),
    itemKeys: [], actionKeys: core.actions.map(a => a.key), portraitAssetKey: null,
    playerProfile: controller === 'gm' ? null : { privateGoal: '保护灯塔', secret: '曾经离开港口', portrayal: '直接发问' },
    gmProfile: controller === 'gm' ? { objective: '保住灯塔', leverage: '掌握钥匙', secret: '害怕洪水', portrayal: '谨慎', escalation: '向队伍求助' } : null,
  }
  return { ...template, characterSheet: createCompleteTtrpgCharacterSheetV2({ template, rulePack: core }) }
}
/** Independent open fixture: no scripted scene graph is fabricated or passed to V1. */
export function openCampaignFixture(): TtrpgCampaignContentV2 {
  const core = structuredClone(STORYFORGE_RULE_PACK_V1)
  const actionKey = core.actions[0].key
  const characters = [actorFixture('hero', 'human', core), actorFixture('companion.1', 'ai', core), actorFixture('companion.2', 'ai', core), actorFixture('keeper', 'gm', core)]
  return {
    schema: 'storyforge.ttrpg-campaign', version: 2, runFormat: 'open', campaignKey: 'campaign.open.harbor', title: '开放港口', pitch: '潮水逼近时调查灯塔。',
    playerCount: { minimum: 1, maximum: 5 }, estimatedMinutes: 60, tags: ['调查'], difficulty: 'standard', contentWarnings: [],
    gmMode: 'ai', sessionZero: { premise: '一起调查', consentChecklist: ['尊重玩家决定'], lines: [], veils: [], pauseSignal: '暂停', openDoor: true },
    informationPolicy: { characterPrivateChannels: true, gmSecrets: true, hiddenNpcState: true, hiddenDice: 'gm-only', interPlayerWhispers: true, revealAuditTrail: true },
    bible: { premise: '暴雨将至', background: '灯塔停摆', coreConflict: '谁掌握钥匙', themes: ['信任'], canonInvariants: ['港口确实存在'], sourceRefs: ['world.harbor'] },
    sourceWorld: { contentHash: HASH, bundleHash: HASH },
    designProvenance: { origin: 'author-guided', proposalKeys: ['proposal.a', 'proposal.b'], baseProposalKey: 'proposal.a',
      sectionSources: { background: 'proposal.a', coreConflict: 'proposal.a', opening: 'proposal.a', fronts: 'proposal.a', secrets: 'proposal.b', endings: 'proposal.b' },
      lockedSections: [], candidateHash: null },
    openingSceneKey: null, characterTemplates: characters, scenes: [], clues: [], quests: [], endings: [], handouts: [], advancementMilestones: [], secrets: [], tabletop: null,
    visualBible: { schema: 'storyforge.ttrpg-visual-bible', version: 1,
      style: { description: '朴素港口', medium: '水彩', composition: '宽景', colorPalette: ['灰蓝'], era: '近代', prohibitedElements: [], referenceLicense: '原创' },
      characters: [], locations: [], provenancePolicy: { rightsPolicyVersion: '1', allowedSources: ['original'], requirePromptReceipt: true, requireHumanAdoptionForRelease: true } },
    mediaManifest: { schema: 'storyforge.ttrpg-media-manifest', version: 1, slots: [], runtimePolicy: { enabled: false, networkPolicy: 'disabled',
      maximumSessionCostUsd: 0, maximumConcurrentRequests: 1, maximumAttempts: 1, maximumGeneratedAssets: 0, allowProviderFallback: false } },
    frozenWorldPredicateIndex: { worldReleaseHash: HASH, indexHash: HASH, entries: [{
      factKey: 'fact.harbor', subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, canonicalValue: true, authority: 'invariant', owner: 'semantic-fact',
      audience: 'public', knownByActorKeys: [], sourceResourceRefs: ['world.harbor'],
      sourceFieldRefs: [{ resourceKey: 'world.harbor', fieldPath: 'identity.exists', contentHash: HASH }],
    }] },
    canonInvariantPredicates: [{ op: 'world-fact', subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, value: true }],
    entityBindings: [{ bindingKey: 'harbor', sourceResourceRef: 'world.harbor', kind: 'location', templateKey: 'harbor', initialLocationRef: null,
      initialInventoryRefs: [], sourceFieldRefs: [{ resourceKey: 'world.harbor', fieldPath: 'identity.exists', contentHash: HASH }], audience: 'public', knownByActorKeys: [] },
    ...characters.map(a => ({ bindingKey: a.characterKey, sourceResourceRef: null, kind: 'actor' as const, templateKey: a.characterKey, initialLocationRef: 'harbor',
      initialInventoryRefs: [], sourceFieldRefs: [], audience: 'party' as const, knownByActorKeys: [] }))],
    dynamicEntityTemplates: [],
    effectPlanTemplates: [{ planKey: 'plan.success', degree: 'success', ruleRef: core.ruleSystemId, reason: '得到喘息', audience: 'party',
      parameters: [{ parameterKey: 'actor', entityKinds: ['actor'], allowedRefs: ['hero'], allowDynamicFromTemplateKeys: [], required: true }],
      effects: [{ effectKey: 'effect.heal', family: 'numeric', operation: 'healing', targetRef: 'parameter:actor', valueKey: core.resources[0].key, amount: 1 }], alternatives: [] }],
    clocks: [{ clockKey: 'flood', title: '涨潮', description: '海水逼近', initialValue: 0, maximum: 6, advanceTriggers: [],
      autoAdvance: { onFailedCheck: 1, onIdleWorldTurns: 2, onOracleNo: 1, onStageClose: 0 }, onComplete: '洪水抵达', onCompleteEffectPlanRef: 'plan.success',
      visibility: 'party', sourceRefs: ['world.harbor'] }],
    fronts: [{ frontKey: 'storm', title: '暴风雨', goal: '淹没码头', participantKeys: ['keeper'], clockKeys: ['flood'], escalation: ['海浪冲上岸'],
      escalationStages: [{ stageKey: 'rising', clockKey: 'flood', atClockValue: 3, effectPlanRef: null, newSituationTemplateKey: 'situation.lighthouse' }],
      telegraph: [{ telegraphKey: 'wind', beforeStageKey: 'rising', signalText: '风更大了', audience: 'party', mediaSlotKey: null, minLeadWorldTurns: 1 }],
      defeatConditions: ['坚持到黎明'], defeatPredicates: [{ op: 'world-turn-at-least', value: 10 }], sourceRefs: ['world.harbor'] }],
    situationTemplates: [{ templateKey: 'situation.lighthouse', title: '灯塔钥匙', motive: 'protection', driverBinding: { kind: 'npc', characterKey: 'keeper' },
      driverGoal: '重启灯塔', driverBeliefs: [{ factRef: 'fact.harbor', belief: '港口需要灯塔', isMistaken: false }], preconditions: [],
      obstacles: [{ obstacleKey: 'door', kind: 'physical', ref: 'harbor', predicate: { op: 'world-turn-at-least', value: 1 }, dependsOn: [] },
        { obstacleKey: 'lamp', kind: 'informational', ref: null, predicate: { op: 'world-turn-at-least', value: 2 }, dependsOn: ['door'] }],
      interventionPoints: ['door', 'lamp'].map(k => ({ pointKey: `point.${k}`, visibleTo: 'party', knownByActorKeys: [], affordanceHint: '可以检查这里',
        requiresPredicate: null, suggestedActionKeys: [actionKey], targetsObstacleKeys: [k] })),
      evidence: ['door', 'lamp'].map((k, i) => ({ clueRef: `evidence.${k}`, title: '磨损的标记', description: '有人刚刚来过',
        sourceFactRefs: ['fact.harbor'], sourceResourceRefs: ['world.harbor'], discoverableBy: [actionKey], coversObstacleKeys: [k],
        audience: 'party', knownByActorKeys: [], isRequired: i === 0,
        discoveryPolicy: { preconditions: [], paths: [{ kind: 'action', key: actionKey, interventionPointKey: `point.${k}` }],
          failForwardEffectPlanRef: null, costEffectPlanRef: null, allowedAudience: 'party', recipientActorKeys: [], requiresPlayerConfirmation: false } })),
      whyNowRefs: ['world:harbor:exists', 'clock:flood'], noInterventionOutcome: { afterWorldTurns: 3, description: '潮水上涨', effectPlanRef: null, advancesClockKeys: ['flood'] },
      consequences: [{ scope: 'location', ref: 'harbor', effectPlanRef: 'plan.success', nextSituationTemplateKey: null, audience: 'party' }], sourceRefs: ['world.harbor'] }],
    openingSituationKeys: ['situation.lighthouse'],
    companionPolicy: { minimumCompanions: 2, maximumCompanions: 3, preauthorizedActionKinds: ['observe', 'assist'],
      approvalBindings: ['companion.1', 'companion.2'].map(companionActorKey => ({
        companionActorKey, approverSeatKeys: ['seat.hero'], partyResourceApprovalAllowed: false,
      })),
      confirmationRequiredKinds: ['irreversible', 'resource-spend', 'party-relation-change', 'secret-reveal'] },
    stageClosurePolicy: { triggers: [{ triggerKey: 'dawn', predicate: { op: 'world-turn-at-least', value: 10 }, summaryPrompt: '总结黎明的港口' }],
      maximumWorldTurns: 30, continuation: 'author-confirmed-opening' },
    runtimePolicy: { enabled: false, maximumCallsPerEpoch: 6, maxAiActions: 2, maximumOutputTokens: 1000, maximumEpochTokens: 10_000,
      maximumEpochCostUsd: 1, maximumRepairAttempts: 1, failurePolicy: 'pause', unknownResultPolicy: 'pause-and-reconcile', outputMode: 'text' },
  }
}
/** Real V2 content with a hybrid companion approving the other companion. */
export function openHybridCampaignFixture(): TtrpgCampaignContentV2 {
  const campaign = openCampaignFixture()
  campaign.characterTemplates[1].controller = 'hybrid'
  campaign.companionPolicy.approvalBindings[1].approverSeatKeys = ['seat.companion.1']
  return campaign
}
export function emptyOpenAuthoringFixture(): TtrpgOpenAuthoringV1 {
  return { factPolicy: [], situationTemplates: [], openingSituationKeys: [], effectPlanTemplates: [], pressure: { clocks: [], fronts: [] },
    companionPolicy: null, stageClosurePolicy: null, dynamicEntityTemplates: [], runtimePolicy: null }
}

export function openPublicationCampaignFixture() {
  const campaign = structuredClone(openCampaignFixture())
  campaign.sessionZero.consentChecklist = ['尊重玩家决定', '允许暂停', '确认边界']
  campaign.situationTemplates = Array.from({ length: 3 }, (_, index) => {
    const template = structuredClone(campaign.situationTemplates[0])
    const suffix = index === 0 ? '' : `.${index + 1}`
    template.templateKey = `situation.lighthouse${suffix}`
    template.whyNowRefs = ['world:harbor:exists', 'clock:flood']
    template.obstacles = template.obstacles.map(obstacle => ({
      ...obstacle,
      obstacleKey: `${obstacle.obstacleKey}${suffix}`,
      dependsOn: obstacle.dependsOn.map(key => `${key}${suffix}`),
    }))
    template.interventionPoints = template.interventionPoints.map(point => ({
      ...point,
      pointKey: `${point.pointKey}${suffix}`,
      targetsObstacleKeys: point.targetsObstacleKeys.map(key => `${key}${suffix}`),
    }))
    template.evidence = template.evidence.map(evidence => ({
      ...evidence,
      clueRef: `${evidence.clueRef}${suffix}`,
      coversObstacleKeys: evidence.coversObstacleKeys.map(key => `${key}${suffix}`),
      discoveryPolicy: {
        ...evidence.discoveryPolicy,
        paths: evidence.discoveryPolicy.paths.map(path => ({
          ...path,
          interventionPointKey: `${path.interventionPointKey}${suffix}`,
        })),
      },
    }))
    return template
  })
  campaign.effectPlanTemplates[0].effects[0].targetRef = 'parameter:actor'
  return campaign
}
