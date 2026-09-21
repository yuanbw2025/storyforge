import type {
  AdventureContentV2,
  FrozenProductNarrativeV1,
  ProductRuntimePackageV1,
} from '../types'

export interface TextAdventureRouteEvidenceV1 {
  endingNodeKey: string
  nodeKeys: string[]
  choiceKeys: string[]
  visibleTextUnits: number
  dialogueTurns: number
  narrativeChoices: number
  branchPoints: number
  statefulDecisions: number
  estimatedMinutes: number
}

export interface TextAdventureCopyIssueV1 {
  kind: 'placeholder' | 'instruction-leak' | 'mixed-language' | 'oversized-action-label'
  surfaceKey: string
  excerpt: string
}

export interface TextAdventureRouteQualityAnalysisV1 {
  schema: 'storyforge.text-adventure-route-quality-analysis'
  version: 1
  routes: TextAdventureRouteEvidenceV1[]
  truncated: boolean
  reachableEndingKeys: string[]
  totalPlayableTextUnits: number
  minimumRouteTextUnits: number
  maximumRouteTextUnits: number
  minimumRouteDialogueTurns: number
  minimumRouteNarrativeChoices: number
  minimumRouteStatefulDecisions: number
  estimatedMinimumRouteMinutes: number
  authoredNpcCount: number
  talkActionCount: number
  mainQuestStageCount: number
  mainQuestObjectiveCount: number
  minimumMainProgressActions: number
  endingTextUnits: Array<{
    nodeKey: string
    textUnits: number
    npcDialogueTurns: number
    stateSettlement: boolean
  }>
  copyIssues: TextAdventureCopyIssueV1[]
}

const PLACEHOLDER_PATTERN = /(?:产品角色\s*\d+|generated:participant|TODO|TBD|占位(?:符|角色|文本))/iu
const INSTRUCTION_LEAK_PATTERN = /(?:本轮演化\s*[：:]|输出字段|不得省略|修复反馈|taskKey|system\s*prompt|JSON\s*对象|请按.{0,16}(?:格式|要求).{0,8}(?:输出|生成))/iu
const MIXED_LANGUAGE_PATTERN = /(?:[\p{Script=Han}]\s+[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*\s+[\p{Script=Han}]|[A-Za-z]{2,}\s+[\p{Script=Han}])/u

export function countPlayerVisibleTextUnitsV1(values: readonly string[]): number {
  const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))]
  return unique.reduce((total, value) => {
    const cjk = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
    const latin = value.match(/[\p{L}\p{N}]+/gu)?.filter(token => (
      !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token)
    )).length ?? 0
    return total + cjk + latin
  }, 0)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function hasPersistentNarrativeEffect(value: string): boolean {
  const parsed = parseJson(value)
  if (Array.isArray(parsed)) return parsed.length > 0
  return !!parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
}

function hasPersistentAdventureEffect(
  adventure: AdventureContentV2,
  effect: AdventureContentV2['actions'][number]['successEffects'][number],
): boolean {
  if (effect.op === 'enter-location') return false
  return effect.op !== 'change-resource' || effect.resourceKey !== adventure.clock.resourceKey
}

function actionCreatesPersistentDifference(
  adventure: AdventureContentV2,
  choiceKey: string,
): boolean {
  return adventure.actions.some(action => action.narrativeChoiceKey === choiceKey && [
    ...action.successEffects, ...action.costlySuccessEffects, ...action.failureEffects,
  ].some(effect => hasPersistentAdventureEffect(adventure, effect)))
}

function reachableNarrativeNodeKeys(
  narrative: FrozenProductNarrativeV1,
  startNodeKey: string,
): Set<string> {
  const successorsByNode = new Map(narrative.nodes.map(node => [node.key, new Set(node.successorKeys)]))
  for (const choice of narrative.choices) {
    const successors = successorsByNode.get(choice.sourceNodeKey) ?? new Set<string>()
    successors.add(choice.targetNodeKey)
    successorsByNode.set(choice.sourceNodeKey, successors)
  }
  const reachable = new Set<string>()
  const pending = [startNodeKey]
  while (pending.length > 0) {
    const nodeKey = pending.shift()!
    if (reachable.has(nodeKey)) continue
    reachable.add(nodeKey)
    pending.push(...(successorsByNode.get(nodeKey) ?? []))
  }
  return reachable
}

function choiceHasObservableLaterEchoes(
  narrative: FrozenProductNarrativeV1,
  adventure: AdventureContentV2,
  choice: FrozenProductNarrativeV1['choices'][number],
): boolean {
  const persistentConditionKeys = new Set(adventure.actions
    .filter(action => action.narrativeChoiceKey === choice.choiceKey)
    .flatMap(action => [
      ...action.successEffects, ...action.costlySuccessEffects, ...action.failureEffects,
    ])
    .flatMap(effect => effect.op === 'apply-condition' ? [effect.conditionKey] : []))
  if (persistentConditionKeys.size === 0) return false

  const reachableAfterChoice = reachableNarrativeNodeKeys(narrative, choice.targetNodeKey)
  reachableAfterChoice.delete(choice.sourceNodeKey)
  const sourceNodeIndex = narrative.nodes.findIndex(node => node.key === choice.sourceNodeKey)
  const echoNodeKeys = new Set<string>()
  for (const action of adventure.actions) {
    if (!action.successText.trim()) continue
    const echoNodeKey = action.requirements.find(requirement => (
      requirement.narrativePath === '__storyforge.currentNarrativeNodeKey'
      && typeof requirement.narrativeEquals === 'string'
    ))?.narrativeEquals
    const echoNodeIndex = typeof echoNodeKey === 'string'
      ? narrative.nodes.findIndex(node => node.key === echoNodeKey) : -1
    if (typeof echoNodeKey !== 'string' || echoNodeIndex <= sourceNodeIndex
      || !reachableAfterChoice.has(echoNodeKey)) continue
    if (!action.requirements.some(requirement => (
      requirement.conditionPresent === true
      && requirement.conditionKey != null
      && persistentConditionKeys.has(requirement.conditionKey)
    ))) continue
    echoNodeKeys.add(echoNodeKey)
  }
  return echoNodeKeys.size >= 2
}

function collectCopyIssues(runtimePackage: ProductRuntimePackageV1): TextAdventureCopyIssueV1[] {
  const adventure = runtimePackage.adventure
  const surfaces: Array<{ surfaceKey: string; text: string; actionLabel?: boolean }> = [
    { surfaceKey: 'definition.title', text: runtimePackage.definition.title },
    { surfaceKey: 'definition.description', text: runtimePackage.definition.description },
    ...runtimePackage.narrative.nodes.flatMap(node => [
      { surfaceKey: `node.${node.key}.title`, text: node.title },
      { surfaceKey: `node.${node.key}.summary`, text: node.summary },
    ]),
    ...runtimePackage.narrative.beats.map(beat => ({ surfaceKey: `beat.${beat.beatKey}`, text: beat.text })),
    ...runtimePackage.narrative.choices.flatMap(choice => [
      { surfaceKey: `choice.${choice.choiceKey}.text`, text: choice.text },
      { surfaceKey: `choice.${choice.choiceKey}.description`, text: choice.description },
    ]),
    ...(adventure ? [
      ...(adventure.playerIdentity ? [
        { surfaceKey: 'adventure.player.name', text: adventure.playerIdentity.name },
        { surfaceKey: 'adventure.player.description', text: adventure.playerIdentity.description },
      ] : []),
      ...adventure.actions.flatMap(action => [
        { surfaceKey: `action.${action.key}.label`, text: action.label, actionLabel: true },
        { surfaceKey: `action.${action.key}.description`, text: action.description },
        { surfaceKey: `action.${action.key}.success`, text: action.successText },
        { surfaceKey: `action.${action.key}.costly-success`, text: action.costlySuccessText },
        { surfaceKey: `action.${action.key}.failure`, text: action.failureText },
        { surfaceKey: `action.${action.key}.unavailable`, text: action.unavailableText },
      ]),
    ] : []),
  ]
  const issues: TextAdventureCopyIssueV1[] = []
  for (const surface of surfaces) {
    const excerpt = surface.text.trim().slice(0, 120)
    if (!excerpt) continue
    if (PLACEHOLDER_PATTERN.test(surface.text)) issues.push({ kind: 'placeholder', surfaceKey: surface.surfaceKey, excerpt })
    if (INSTRUCTION_LEAK_PATTERN.test(surface.text)) issues.push({ kind: 'instruction-leak', surfaceKey: surface.surfaceKey, excerpt })
    if (MIXED_LANGUAGE_PATTERN.test(surface.text)) issues.push({ kind: 'mixed-language', surfaceKey: surface.surfaceKey, excerpt })
    if (surface.actionLabel && countPlayerVisibleTextUnitsV1([surface.text]) > 32) {
      issues.push({ kind: 'oversized-action-label', surfaceKey: surface.surfaceKey, excerpt })
    }
  }
  return issues
}

function narrativeRoutes(
  narrative: FrozenProductNarrativeV1,
  adventure: AdventureContentV2,
  maximumRoutes: number,
): { routes: TextAdventureRouteEvidenceV1[]; truncated: boolean } {
  const nodes = new Map(narrative.nodes.map(node => [node.key, node]))
  const beatsByNode = new Map<string, typeof narrative.beats>()
  const choicesByNode = new Map<string, typeof narrative.choices>()
  for (const beat of narrative.beats) {
    const beats = beatsByNode.get(beat.nodeKey) ?? []
    beats.push(beat); beatsByNode.set(beat.nodeKey, beats)
  }
  for (const choice of narrative.choices) {
    const choices = choicesByNode.get(choice.sourceNodeKey) ?? []
    choices.push(choice); choicesByNode.set(choice.sourceNodeKey, choices)
  }
  for (const choices of choicesByNode.values()) choices.sort((left, right) => left.order - right.order)

  const routes: TextAdventureRouteEvidenceV1[] = []
  let truncated = false
  const maximumDepth = Math.max(8, narrative.nodes.length * 3)
  const visit = (input: {
    nodeKey: string
    nodeKeys: string[]
    choiceKeys: string[]
    visibleTexts: string[]
    dialogueTurns: number
    branchPoints: number
    statefulDecisions: number
    visits: Map<string, number>
  }) => {
    if (routes.length >= maximumRoutes) { truncated = true; return }
    const node = nodes.get(input.nodeKey)
    if (!node) return
    const visitCount = input.visits.get(node.key) ?? 0
    if (visitCount >= 2 || input.nodeKeys.length >= maximumDepth) { truncated = true; return }
    const visits = new Map(input.visits); visits.set(node.key, visitCount + 1)
    const beats = [...(beatsByNode.get(node.key) ?? [])].sort((left, right) => left.order - right.order)
    const nodeKeys = [...input.nodeKeys, node.key]
    const visibleTexts = [...input.visibleTexts, ...beats.map(beat => beat.text)]
    const dialogueTurns = input.dialogueTurns + beats.filter(beat => beat.kind === 'dialogue').length
    if (node.kind === 'ending') {
      const visibleTextUnits = countPlayerVisibleTextUnitsV1(visibleTexts)
      const narrativeChoices = input.choiceKeys.length
      routes.push({
        endingNodeKey: node.key, nodeKeys, choiceKeys: input.choiceKeys,
        visibleTextUnits, dialogueTurns, narrativeChoices,
        branchPoints: input.branchPoints, statefulDecisions: input.statefulDecisions,
        estimatedMinutes: Number((visibleTextUnits / 220 + narrativeChoices * 0.25).toFixed(1)),
      })
      return
    }
    const choices = choicesByNode.get(node.key) ?? []
    if (choices.length === 0) {
      const representedTargets = new Set<string>()
      for (const successorKey of node.successorKeys) {
        if (representedTargets.has(successorKey)) continue
        representedTargets.add(successorKey)
        visit({ ...input, nodeKey: successorKey, nodeKeys, visibleTexts, dialogueTurns, visits })
      }
      return
    }
    for (const choice of choices) {
      const laterNodeCapacity = maximumDepth - nodeKeys.length
      const stateful = choices.length > 1 && laterNodeCapacity >= 2 && (
        hasPersistentNarrativeEffect(choice.effectsJson)
        || actionCreatesPersistentDifference(adventure, choice.choiceKey)
      ) && choiceHasObservableLaterEchoes(narrative, adventure, choice)
      visit({
        nodeKey: choice.targetNodeKey,
        nodeKeys,
        choiceKeys: [...input.choiceKeys, choice.choiceKey],
        visibleTexts: [...visibleTexts, choice.text, choice.description],
        dialogueTurns,
        branchPoints: input.branchPoints + Number(choices.length > 1),
        statefulDecisions: input.statefulDecisions + Number(stateful),
        visits,
      })
    }
  }
  visit({
    nodeKey: narrative.entryNodeKey, nodeKeys: [], choiceKeys: [], visibleTexts: [],
    dialogueTurns: 0, branchPoints: 0, statefulDecisions: 0, visits: new Map(),
  })
  return { routes, truncated }
}

export function analyzeTextAdventureRouteQualityV1(
  runtimePackage: ProductRuntimePackageV1,
  options: { maximumRoutes?: number } = {},
): TextAdventureRouteQualityAnalysisV1 {
  if (runtimePackage.productType !== 'text-adventure' || runtimePackage.adventure?.version !== 2) {
    throw new Error('[text-adventure-quality] 只接受 AdventureContentV2 文字冒险发布包')
  }
  const adventure = runtimePackage.adventure
  const routeResult = narrativeRoutes(runtimePackage.narrative, adventure, options.maximumRoutes ?? 512)
  const routeValues = <K extends keyof TextAdventureRouteEvidenceV1>(key: K): number[] => (
    routeResult.routes.map(route => Number(route[key]))
  )
  const minimum = (values: number[]) => values.length > 0 ? Math.min(...values) : 0
  const maximum = (values: number[]) => values.length > 0 ? Math.max(...values) : 0
  const profiles = runtimePackage.interaction?.profiles ?? []
  const playerProfile = profiles.find(profile => profile.name === adventure.playerIdentity.name) ?? null
  const npcCharacterKeys = new Set(profiles.filter(profile => (
    profile.participantKey !== playerProfile?.participantKey
    && !profile.characterKey.startsWith('generated:')
    && !PLACEHOLDER_PATTERN.test(profile.name)
  )).map(profile => profile.characterKey))
  const appliedConditionKeys = new Set(adventure.actions.flatMap(action => [
    ...action.successEffects, ...action.costlySuccessEffects, ...action.failureEffects,
  ]).flatMap(effect => effect.op === 'apply-condition' ? [effect.conditionKey] : []))
  const endingKeys = new Set(runtimePackage.narrative.nodes.filter(node => node.kind === 'ending').map(node => node.key))
  const endingTextUnits = [...endingKeys].sort().map(nodeKey => {
    const endingBeats = runtimePackage.narrative.beats.filter(beat => beat.nodeKey === nodeKey)
    const ending = adventure.endings.find(item => item.narrativeNodeKey === nodeKey)
    const settlementConditionKeys = ending?.requirements.flatMap(requirement => (
      requirement.conditionPresent === true && requirement.conditionKey != null
        ? [requirement.conditionKey] : []
    )) ?? []
    return {
      nodeKey,
      textUnits: countPlayerVisibleTextUnitsV1(endingBeats.map(beat => beat.text)),
      npcDialogueTurns: endingBeats.filter(beat => (
        beat.kind === 'dialogue' && beat.speakerKey != null && npcCharacterKeys.has(beat.speakerKey)
      )).length,
      stateSettlement: settlementConditionKeys.length > 0
        && settlementConditionKeys.every(conditionKey => appliedConditionKeys.has(conditionKey)),
    }
  })
  const narrativePlayableTexts = [
    ...runtimePackage.narrative.beats.map(beat => beat.text),
    ...runtimePackage.narrative.choices.flatMap(choice => [choice.text, choice.description]),
  ]
  const actionPlayableTexts = adventure.actions.flatMap(action => [
    action.successText, action.costlySuccessText, action.failureText,
  ])
  const playerParticipantKey = playerProfile?.participantKey ?? null
  const authoredNpcCount = profiles.filter(profile => (
    profile.participantKey !== playerParticipantKey
    && !profile.characterKey.startsWith('generated:')
    && !PLACEHOLDER_PATTERN.test(profile.name)
  )).length
  const mainQuests = adventure.quests.filter(quest => quest.category === 'main')
  const requiredMainObjectiveKeys = new Set(mainQuests.flatMap(quest => (
    quest.objectives.filter(objective => !objective.optional).map(objective => `${quest.key}:${objective.key}`)
  )))
  const mainObjectiveActionBindings = adventure.actions.flatMap(action => {
    const objectiveKeys = [...action.successEffects, ...action.costlySuccessEffects, ...action.failureEffects]
      .flatMap(effect => effect.op === 'complete-objective'
        ? [`${effect.questKey}:${effect.objectiveKey}`] : [])
      .filter(objectiveKey => requiredMainObjectiveKeys.has(objectiveKey))
    if (objectiveKeys.length === 0) return []
    const narrativeNodeKeys = action.requirements.flatMap(requirement => (
      requirement.narrativePath === '__storyforge.currentNarrativeNodeKey'
        && typeof requirement.narrativeEquals === 'string'
        ? [requirement.narrativeEquals] : []
    ))
    return [{ objectiveKeys, narrativeNodeKeys }]
  })
  const mappedNarrativeChoiceKeys = new Set(adventure.actions.flatMap(action => (
    action.narrativeChoiceKey == null ? [] : [action.narrativeChoiceKey]
  )))
  const minimumMappedNarrativeActions = minimum(routeResult.routes.map(route => (
    route.choiceKeys.filter(choiceKey => mappedNarrativeChoiceKeys.has(choiceKey)).length
  )))
  const minimumRouteMainObjectiveActions = minimum(routeResult.routes.map(route => {
    const routeNodeKeys = new Set(route.nodeKeys)
    return new Set(mainObjectiveActionBindings.flatMap(binding => (
      binding.narrativeNodeKeys.length === 0
        || binding.narrativeNodeKeys.some(nodeKey => routeNodeKeys.has(nodeKey))
        ? binding.objectiveKeys : []
    ))).size
  }))
  const minimumNarrativeChoices = minimum(routeValues('narrativeChoices'))
  return {
    schema: 'storyforge.text-adventure-route-quality-analysis', version: 1,
    routes: routeResult.routes, truncated: routeResult.truncated,
    reachableEndingKeys: [...new Set(routeResult.routes.map(route => route.endingNodeKey))].sort(),
    totalPlayableTextUnits: countPlayerVisibleTextUnitsV1([...narrativePlayableTexts, ...actionPlayableTexts]),
    minimumRouteTextUnits: minimum(routeValues('visibleTextUnits')),
    maximumRouteTextUnits: maximum(routeValues('visibleTextUnits')),
    minimumRouteDialogueTurns: minimum(routeValues('dialogueTurns')),
    minimumRouteNarrativeChoices: minimumNarrativeChoices,
    minimumRouteStatefulDecisions: minimum(routeValues('statefulDecisions')),
    estimatedMinimumRouteMinutes: minimum(routeValues('estimatedMinutes')),
    authoredNpcCount,
    talkActionCount: adventure.actions.filter(action => action.kind === 'talk').length,
    mainQuestStageCount: mainQuests.reduce((total, quest) => total + quest.stages.length, 0),
    mainQuestObjectiveCount: mainQuests.reduce((total, quest) => total + quest.objectives.filter(objective => !objective.optional).length, 0),
    minimumMainProgressActions: minimumRouteMainObjectiveActions + minimumMappedNarrativeActions,
    endingTextUnits,
    copyIssues: collectCopyIssues(runtimePackage),
  }
}
