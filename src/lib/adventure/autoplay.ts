import type {
  AdventureActionDefinition,
  AdventureCheckOutcome,
  AdventureContentV2,
  AdventureRuntimeState,
  ProductNarrativeRuntimeState,
  ProductRuntimePackageV1,
} from '../types'
import {
  adventureEffectiveAbilityValue,
  adventureNarrativeActionContext,
  adventureNarrativeProjection,
  applyAdventureEffects,
  availableAdventureActions,
  createInitialAdventureState,
  parseAdventureState,
} from './runtime'
import { advanceFrozenNarrativeChoice } from '../product/runtime-core'
import { evaluateNarrativeChoices } from '../product/narrative-content'
import {
  applyNarrativeEffects,
  evaluateNarrativeCondition,
  parseNarrativeCondition,
  parseNarrativeEffects,
} from '../narrative/blueprint'
import {
  buildProductRuntimeDiceResolutionV1,
  parseProductRuntimeDiceExpressionV1,
} from '../product/runtime-dice'
import { analyzeTextAdventureRouteQualityV1 } from './quality-analysis'

export const TEXT_ADVENTURE_AUTOPLAY_CASE_KINDS_V1 = [
  'golden-route',
  'ending-coverage',
  'alternate-route',
  'failure-forward',
  'state-roundtrip',
  'branch-isolation',
  'ai-offline',
  'media-offline',
] as const

export type TextAdventureAutoplayCaseKindV1 = typeof TEXT_ADVENTURE_AUTOPLAY_CASE_KINDS_V1[number]

export interface TextAdventureAutoplayCaseV1 {
  caseKey: string
  kind: TextAdventureAutoplayCaseKindV1
  passed: boolean
  endingKeys: string[]
  choiceCount: number
  actionCount: number
  evidence: string[]
}

export interface TextAdventureAutoplayReportV1 {
  schema: 'storyforge.text-adventure-autoplay-report'
  version: 1
  buildNumber: number
  packageHash: string
  seed: string
  passed: boolean
  cases: TextAdventureAutoplayCaseV1[]
  routeSummary: {
    enumeratedRouteCount: number
    reachableEndingKeys: string[]
    truncated: boolean
    minimumRouteTextUnits: number
    estimatedMinimumRouteMinutes: number
  }
  manualRequiredKinds: string[]
}

export const TEXT_ADVENTURE_PLAYTEST_ROUTE_KINDS_V1 = [
  'golden-route',
  'alternate-route',
  'failure-forward',
  'each-ending',
  'random-long-run',
  'resource-edge',
  'side-quest-skip',
  'side-quest-complete',
  'refresh-resume',
  'save-load-branch',
  'ai-offline',
  'media-offline',
  'corruption-recovery',
  'export-import',
  'delete-lifecycle',
] as const

export type TextAdventurePlaytestRouteKindV1 = typeof TEXT_ADVENTURE_PLAYTEST_ROUTE_KINDS_V1[number]

export interface TextAdventurePlaytestStrategyArtifactV1 {
  schema: 'storyforge.text-adventure-playtest-strategy-artifact'
  version: 1
  buildNumber: number
  routeCases: Array<{
    caseKey: string
    kind: TextAdventurePlaytestRouteKindV1
    executionMode: 'deterministic-autoplay' | 'real-browser' | 'human-playtest'
    objective: string
    steps: string[]
    expectedAssertions: string[]
    evidenceRefs: string[]
    required: boolean
  }>
  humanSessions: Array<{
    sessionKey: string
    participantRole: 'author' | 'independent-player'
    routeKind: 'golden-route' | 'alternate-route' | 'failure-forward'
    timingRequired: boolean
    prompts: string[]
    passCriteria: string[]
  }>
  blockingRisks: Array<{
    riskKey: string
    evidenceRef: string
    detail: string
    requiredResolution: string
  }>
  recommendation: 'eligible-for-human-validation' | 'blocked'
}

function fail(message: string): never {
  throw new Error(`[text-adventure-playtest] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不符合合同:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) fail(`${label} 无效`)
  return value.trim()
}

function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}

function strings(value: unknown, label: string, minimum = 1): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 100) fail(`${label} 无效`)
  return value.map((item, index) => text(item, `${label}[${index}]`))
}

function initialNarrativeState(runtimePackage: ProductRuntimePackageV1, packageHash: string): ProductNarrativeRuntimeState {
  const definition = runtimePackage.narrative
  const entry = definition.nodes.find(node => node.key === definition.entryNodeKey)
    ?? fail('冻结叙事入口不存在')
  const initialVariables = structuredClone(runtimePackage.definition.initialVariables)
  if (!evaluateNarrativeCondition(parseNarrativeCondition(entry.conditionJson), initialVariables)) {
    fail('冻结叙事入口条件在初始状态下不成立')
  }
  const variables = applyNarrativeEffects(parseNarrativeEffects(entry.effectsJson), initialVariables)
  const completed = entry.kind === 'ending'
  const choiceEvaluations = completed ? [] : evaluateNarrativeChoices({
    ...variables, __visitedNodeKeys: [entry.key], __selectedChoiceKeys: [],
  }, entry.key, definition.choices)
  return {
    schema: 'storyforge.product-narrative-runtime', version: 2,
    moduleKind: definition.moduleKind, moduleTitle: definition.moduleTitle,
    sourceHash: packageHash, contentHash: packageHash,
    nodes: structuredClone(definition.nodes), beats: structuredClone(definition.beats),
    choices: structuredClone(definition.choices), currentNodeKey: entry.key,
    visitedNodeKeys: [entry.key],
    availableNodeKeys: [...new Set(choiceEvaluations.filter(item => item.available).map(item => item.targetNodeKey))],
    visibleChoiceKeys: choiceEvaluations.filter(item => item.visible).map(item => item.choiceKey),
    availableChoiceKeys: choiceEvaluations.filter(item => item.available).map(item => item.choiceKey),
    choiceHistory: [], variables, completed,
    endingKey: completed ? entry.key : null, completedAtSequence: completed ? 0 : null,
    lastEnteredNodeSequence: null,
  }
}

function syncAdventureProjection(
  narrative: ProductNarrativeRuntimeState,
  adventure: AdventureRuntimeState,
): ProductNarrativeRuntimeState {
  if (!narrative.currentNodeKey || narrative.completed) return narrative
  const variables = { ...narrative.variables, adventure: adventureNarrativeProjection(adventure) }
  const evaluations = evaluateNarrativeChoices({
    ...variables,
    __visitedNodeKeys: narrative.visitedNodeKeys,
    __selectedChoiceKeys: narrative.choiceHistory.map(item => item.choiceKey),
  }, narrative.currentNodeKey, narrative.choices)
  return {
    ...narrative, variables,
    availableNodeKeys: [...new Set(evaluations.filter(item => item.available).map(item => item.targetNodeKey))],
    visibleChoiceKeys: evaluations.filter(item => item.visible).map(item => item.choiceKey),
    availableChoiceKeys: evaluations.filter(item => item.available).map(item => item.choiceKey),
  }
}

function actionOutcome(input: {
  action: AdventureActionDefinition
  content: AdventureContentV2
  state: AdventureRuntimeState
  seed: string
  sequence: number
}): AdventureCheckOutcome {
  const { action, content, state } = input
  if (action.rule.kind === 'automatic') return 'success'
  if (action.rule.kind === 'threshold') {
    return adventureEffectiveAbilityValue(content, state, action.rule.abilityKey) >= action.rule.difficulty
      ? 'success' : 'failure'
  }
  if (action.rule.kind === 'resource-payment') {
    return state.resources[action.rule.resourceKey] >= action.rule.amount ? 'success' : 'not-attempted'
  }
  const expression = parseProductRuntimeDiceExpressionV1(action.rule.expression)
  const dice = buildProductRuntimeDiceResolutionV1({
    seed: input.seed, sequence: input.sequence, expression,
    nonce: `autoplay:${action.key}:${input.sequence}`,
  })
  const total = dice.total + adventureEffectiveAbilityValue(content, state, action.rule.abilityKey)
  return total >= action.rule.difficulty
    ? 'success'
    : action.rule.costlySuccessFloor != null && total >= action.rule.costlySuccessFloor
      ? 'costly-success' : 'failure'
}

function actionEffects(action: AdventureActionDefinition, outcome: AdventureCheckOutcome) {
  if (outcome === 'not-attempted') return []
  const payment = action.rule.kind === 'resource-payment'
    ? [{ op: 'change-resource' as const, resourceKey: action.rule.resourceKey, delta: -action.rule.amount }]
    : []
  return [...payment, ...(outcome === 'success'
    ? action.successEffects
    : outcome === 'costly-success' ? action.costlySuccessEffects : action.failureEffects)]
}

function simulateRoute(input: {
  runtimePackage: ProductRuntimePackageV1
  packageHash: string
  seed: string
  choiceKeys: string[]
  forceFirstFailure?: boolean
}): { endingKey: string; actionCount: number; state: AdventureRuntimeState; evidence: string[] } {
  const content = input.runtimePackage.adventure
  if (content?.version !== 2) fail('路线模拟缺少 AdventureContentV2')
  let adventure = createInitialAdventureState(content, input.packageHash)
  let narrative = syncAdventureProjection(initialNarrativeState(input.runtimePackage, input.packageHash), adventure)
  let actionCount = 0
  let failureInjected = false
  let sequence = 0
  const evidence: string[] = []
  const executeAction = (action: AdventureActionDefinition) => {
    sequence += 1
    let outcome = actionOutcome({ action, content, state: adventure, seed: input.seed, sequence })
    if (input.forceFirstFailure && !failureInjected && action.rule.kind !== 'automatic') {
      outcome = 'failure'; failureInjected = true
    }
    if (outcome === 'not-attempted') fail(`路线公共行动无法支付资源:${action.key}`)
    adventure = applyAdventureEffects(content, adventure, actionEffects(action, outcome), sequence)
    if (!action.repeatable) adventure.completedActionKeys.push(action.key)
    adventure.actionHistory.push({
      eventSequence: sequence, commandId: `autoplay:${action.key}:${sequence}`, actionKey: action.key,
      kind: action.kind, outcome, narrative: outcome === 'success'
        ? action.successText : outcome === 'costly-success' ? action.costlySuccessText : action.failureText,
      resultingSequence: sequence,
    })
    actionCount += 1
    evidence.push(`${action.key}:${outcome}`)
    narrative = syncAdventureProjection(narrative, adventure)
  }
  input.choiceKeys.forEach((choiceKey, index) => {
    const choice = narrative.choices.find(item => item.choiceKey === choiceKey)
      ?? fail(`路线引用不存在 Choice:${choiceKey}`)
    if (choice.sourceNodeKey !== narrative.currentNodeKey || !narrative.availableChoiceKeys.includes(choiceKey)) {
      fail(`路线 Choice 当前不可用:${choiceKey}@${narrative.currentNodeKey ?? 'none'}`)
    }
    const actionTags = choice.tags.filter(tag => tag.startsWith('adventure-action:'))
    if (actionTags.length > 1) fail(`Choice 绑定多个 Adventure 行动:${choiceKey}`)
    if (actionTags.length === 1) {
      const actionKey = actionTags[0].slice('adventure-action:'.length)
      let available = availableAdventureActions(
        content, adventure, adventureNarrativeActionContext(narrative),
      ).find(item => item.action.key === actionKey)
      // The player normally resolves the current main-quest objectives before
      // the corresponding Narrative Choice becomes legal. Exercise those
      // product actions through the same pure requirement/effect functions
      // instead of pretending every graph edge is immediately clickable.
      for (let prerequisiteCount = 0; !available?.available && prerequisiteCount < content.actions.length; prerequisiteCount += 1) {
        const prerequisite = availableAdventureActions(
          content, adventure, adventureNarrativeActionContext(narrative),
        ).find(item => item.available
          && item.action.narrativeChoiceKey == null
          && item.action.key.startsWith('action.main.'))
        if (!prerequisite) break
        executeAction(prerequisite.action)
        available = availableAdventureActions(
          content, adventure, adventureNarrativeActionContext(narrative),
        ).find(item => item.action.key === actionKey)
      }
      if (!available?.available) fail(`路线公共行动不可用:${choiceKey}->${actionKey}`)
      executeAction(available.action)
    }
    narrative = advanceFrozenNarrativeChoice(narrative, choiceKey, index + 1)
  })
  if (!narrative.completed || !narrative.endingKey) fail('路线未抵达结局')
  if (input.forceFirstFailure && !failureInjected) fail('路线没有可注入的非自动失败行动')
  const roundTripped = parseAdventureState(JSON.parse(JSON.stringify(adventure)))
    ?? fail('状态往返解析失败')
  if (JSON.stringify(roundTripped) !== JSON.stringify(adventure)) fail('状态往返不等价')
  return { endingKey: narrative.endingKey, actionCount, state: adventure, evidence }
}

function caseResult(
  kind: TextAdventureAutoplayCaseKindV1,
  run: () => Omit<TextAdventureAutoplayCaseV1, 'caseKey' | 'kind' | 'passed'>,
): TextAdventureAutoplayCaseV1 {
  try {
    return { caseKey: `autoplay.${kind}`, kind, passed: true, ...run() }
  } catch (cause) {
    return {
      caseKey: `autoplay.${kind}`, kind, passed: false, endingKeys: [], choiceCount: 0, actionCount: 0,
      evidence: [cause instanceof Error ? cause.message : String(cause)],
    }
  }
}

/**
 * Executes the deterministic, persistence-free part of the release playtest.
 * Real browser refresh, IndexedDB lifecycle and human timing deliberately stay
 * outside this report and are listed as required follow-up evidence.
 */
export function runTextAdventureAutoplayV1(input: {
  runtimePackage: ProductRuntimePackageV1
  buildNumber: number
  packageHash: string
}): TextAdventureAutoplayReportV1 {
  if (input.runtimePackage.productType !== 'text-adventure' || input.runtimePackage.adventure?.version !== 2) {
    fail('只接受 AdventureContentV2 文字冒险运行包')
  }
  const content = input.runtimePackage.adventure
  const quality = analyzeTextAdventureRouteQualityV1(input.runtimePackage)
  const routes = quality.routes
  const seed = `storyforge-autoplay-v1:${input.packageHash}`
  const golden = [...routes].sort((left, right) => (
    right.visibleTextUnits - left.visibleTextUnits || left.endingNodeKey.localeCompare(right.endingNodeKey)
  ))[0]
  const alternate = routes.find(route => golden && route.choiceKeys.join('\n') !== golden.choiceKeys.join('\n'))
  const endingRoutes = quality.reachableEndingKeys.map(endingKey => (
    routes.find(route => route.endingNodeKey === endingKey)
  )).filter((route): route is NonNullable<typeof route> => !!route)
  const failedCandidate = content.actions.some(action => (
    action.key.startsWith('action.main.') && action.rule.kind !== 'automatic'
  )) ? routes[0] : undefined
  const cases: TextAdventureAutoplayCaseV1[] = [
    caseResult('golden-route', () => {
      if (!golden) fail('没有可达路线')
      const result = simulateRoute({ ...input, seed, choiceKeys: golden.choiceKeys })
      return { endingKeys: [result.endingKey], choiceCount: golden.choiceKeys.length, actionCount: result.actionCount,
        evidence: [`route=${golden.choiceKeys.join('>')}`, ...result.evidence] }
    }),
    caseResult('ending-coverage', () => {
      if (endingRoutes.length !== quality.reachableEndingKeys.length) fail('存在没有可执行路线的可达结局')
      const results = endingRoutes.map(route => simulateRoute({ ...input, seed, choiceKeys: route.choiceKeys }))
      return { endingKeys: results.map(result => result.endingKey).sort(),
        choiceCount: endingRoutes.reduce((sum, route) => sum + route.choiceKeys.length, 0),
        actionCount: results.reduce((sum, result) => sum + result.actionCount, 0),
        evidence: results.map(result => `${result.endingKey}:passed`) }
    }),
    caseResult('alternate-route', () => {
      if (!alternate) fail('没有与黄金路线不同的替代路线')
      const result = simulateRoute({ ...input, seed, choiceKeys: alternate.choiceKeys })
      return { endingKeys: [result.endingKey], choiceCount: alternate.choiceKeys.length,
        actionCount: result.actionCount, evidence: [`route=${alternate.choiceKeys.join('>')}`, ...result.evidence] }
    }),
    caseResult('failure-forward', () => {
      if (!failedCandidate) fail('没有可验证失败推进的非自动行动路线')
      const result = simulateRoute({ ...input, seed, choiceKeys: failedCandidate.choiceKeys, forceFirstFailure: true })
      return { endingKeys: [result.endingKey], choiceCount: failedCandidate.choiceKeys.length,
        actionCount: result.actionCount, evidence: ['injectedOutcome=failure', ...result.evidence] }
    }),
    caseResult('state-roundtrip', () => {
      if (!golden) fail('没有可用于状态往返的路线')
      const result = simulateRoute({ ...input, seed, choiceKeys: golden.choiceKeys })
      return { endingKeys: [result.endingKey], choiceCount: golden.choiceKeys.length,
        actionCount: result.actionCount, evidence: ['AdventureRuntimeState JSON roundtrip=equivalent'] }
    }),
    caseResult('branch-isolation', () => {
      if (!golden || !alternate) fail('分支隔离需要两条不同路线')
      const left = simulateRoute({ ...input, seed, choiceKeys: golden.choiceKeys })
      const snapshot = JSON.stringify(left.state)
      const right = simulateRoute({ ...input, seed, choiceKeys: alternate.choiceKeys })
      if (JSON.stringify(left.state) !== snapshot) fail('另一分支污染已完成分支状态')
      return { endingKeys: [...new Set([left.endingKey, right.endingKey])].sort(),
        choiceCount: golden.choiceKeys.length + alternate.choiceKeys.length,
        actionCount: left.actionCount + right.actionCount,
        evidence: ['independent-clones=true', `stateDifference=${snapshot !== JSON.stringify(right.state)}`] }
    }),
    caseResult('ai-offline', () => {
      if (!golden) fail('没有离线可执行路线')
      const result = simulateRoute({ ...input, seed, choiceKeys: golden.choiceKeys })
      return { endingKeys: [result.endingKey], choiceCount: golden.choiceKeys.length,
        actionCount: result.actionCount, evidence: ['providerCalls=0', 'runtimeAuthority=deterministic'] }
    }),
    caseResult('media-offline', () => {
      if (content.media.fallback !== 'text-only') fail('媒资失败没有完整纯文字降级')
      if (!golden) fail('没有纯文字可执行路线')
      const result = simulateRoute({ ...input, seed, choiceKeys: golden.choiceKeys })
      return { endingKeys: [result.endingKey], choiceCount: golden.choiceKeys.length,
        actionCount: result.actionCount, evidence: ['mediaLoaded=false', 'fallback=text-only'] }
    }),
  ]
  return {
    schema: 'storyforge.text-adventure-autoplay-report', version: 1,
    buildNumber: input.buildNumber, packageHash: input.packageHash, seed,
    passed: cases.every(item => item.passed), cases,
    routeSummary: {
      enumeratedRouteCount: routes.length,
      reachableEndingKeys: quality.reachableEndingKeys,
      truncated: quality.truncated,
      minimumRouteTextUnits: quality.minimumRouteTextUnits,
      estimatedMinimumRouteMinutes: quality.estimatedMinimumRouteMinutes,
    },
    manualRequiredKinds: [
      'random-long-run', 'resource-edge', 'side-quest-skip', 'side-quest-complete',
      'refresh-resume', 'save-load-branch', 'corruption-recovery', 'export-import',
      'delete-lifecycle', 'human-timed-golden-route', 'human-alternate-or-failure-route',
    ],
  }
}

export function parseTextAdventureAutoplayReportV1(
  value: unknown,
  expected?: { buildNumber: number; packageHash: string },
): TextAdventureAutoplayReportV1 {
  const row = record(value, 'autoplayReport')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'packageHash', 'seed', 'passed', 'cases',
    'routeSummary', 'manualRequiredKinds',
  ], 'autoplayReport')
  if (row.schema !== 'storyforge.text-adventure-autoplay-report' || row.version !== 1
    || !Number.isInteger(row.buildNumber) || typeof row.packageHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(row.packageHash) || typeof row.seed !== 'string'
    || !row.seed.startsWith('storyforge-autoplay-v1:') || typeof row.passed !== 'boolean'
    || !Array.isArray(row.cases) || !Array.isArray(row.manualRequiredKinds)) {
    fail('autoplayReport 基础字段无效')
  }
  if (expected && (row.buildNumber !== expected.buildNumber || row.packageHash !== expected.packageHash)) {
    fail('autoplayReport 未绑定当前 Build/package')
  }
  const cases = row.cases.map((value, index) => {
    const item = record(value, `autoplayReport.cases[${index}]`)
    exactKeys(item, ['caseKey', 'kind', 'passed', 'endingKeys', 'choiceCount', 'actionCount', 'evidence'], `autoplayReport.cases[${index}]`)
    if (!TEXT_ADVENTURE_AUTOPLAY_CASE_KINDS_V1.includes(item.kind as TextAdventureAutoplayCaseKindV1)
      || typeof item.passed !== 'boolean' || !Number.isInteger(item.choiceCount)
      || Number(item.choiceCount) < 0 || !Number.isInteger(item.actionCount) || Number(item.actionCount) < 0
      || !Array.isArray(item.endingKeys)) fail(`autoplayReport.cases[${index}] 无效`)
    return {
      caseKey: key(item.caseKey, `autoplayReport.cases[${index}].caseKey`),
      kind: item.kind as TextAdventureAutoplayCaseKindV1,
      passed: item.passed,
      endingKeys: item.endingKeys.map((ending, endingIndex) => key(ending, `autoplayReport.cases[${index}].endingKeys[${endingIndex}]`)),
      choiceCount: Number(item.choiceCount), actionCount: Number(item.actionCount),
      evidence: strings(item.evidence, `autoplayReport.cases[${index}].evidence`),
    }
  })
  const kinds = cases.map(item => item.kind)
  if (cases.length !== TEXT_ADVENTURE_AUTOPLAY_CASE_KINDS_V1.length
    || new Set(kinds).size !== kinds.length
    || TEXT_ADVENTURE_AUTOPLAY_CASE_KINDS_V1.some(kind => !kinds.includes(kind))) {
    fail('autoplayReport cases 未不重不漏覆盖登记类型')
  }
  const routeSummary = record(row.routeSummary, 'autoplayReport.routeSummary')
  exactKeys(routeSummary, [
    'enumeratedRouteCount', 'reachableEndingKeys', 'truncated', 'minimumRouteTextUnits',
    'estimatedMinimumRouteMinutes',
  ], 'autoplayReport.routeSummary')
  if (!Number.isInteger(routeSummary.enumeratedRouteCount) || Number(routeSummary.enumeratedRouteCount) < 0
    || !Number.isInteger(routeSummary.minimumRouteTextUnits) || Number(routeSummary.minimumRouteTextUnits) < 0
    || typeof routeSummary.estimatedMinimumRouteMinutes !== 'number'
    || !Number.isFinite(routeSummary.estimatedMinimumRouteMinutes)
    || Number(routeSummary.estimatedMinimumRouteMinutes) < 0
    || typeof routeSummary.truncated !== 'boolean' || !Array.isArray(routeSummary.reachableEndingKeys)) {
    fail('autoplayReport.routeSummary 无效')
  }
  const expectedPassed = cases.every(item => item.passed)
  if (row.passed !== expectedPassed) fail('autoplayReport.passed 与 case 证据不一致')
  return {
    schema: 'storyforge.text-adventure-autoplay-report', version: 1,
    buildNumber: Number(row.buildNumber), packageHash: row.packageHash,
    seed: row.seed, passed: expectedPassed, cases,
    routeSummary: {
      enumeratedRouteCount: Number(routeSummary.enumeratedRouteCount),
      reachableEndingKeys: routeSummary.reachableEndingKeys.map((ending, index) => key(ending, `autoplayReport.routeSummary.reachableEndingKeys[${index}]`)),
      truncated: routeSummary.truncated,
      minimumRouteTextUnits: Number(routeSummary.minimumRouteTextUnits),
      estimatedMinimumRouteMinutes: Number(routeSummary.estimatedMinimumRouteMinutes),
    },
    manualRequiredKinds: strings(row.manualRequiredKinds, 'autoplayReport.manualRequiredKinds'),
  }
}

export function parseTextAdventurePlaytestStrategyArtifactV1(input: {
  value: unknown
  buildNumber: number
  autoplayPassed: boolean
  qualityReleaseReady: boolean
}): TextAdventurePlaytestStrategyArtifactV1 {
  const row = record(input.value, 'playtestStrategy')
  exactKeys(row, [
    'schema', 'version', 'routeCases', 'humanSessions', 'blockingRisks', 'recommendation',
  ], 'playtestStrategy')
  if (row.schema !== 'storyforge.text-adventure-playtest-strategy-artifact' || row.version !== 1
    || !Array.isArray(row.routeCases)
    || !Array.isArray(row.humanSessions) || !Array.isArray(row.blockingRisks)
    || !['eligible-for-human-validation', 'blocked'].includes(String(row.recommendation))) {
    fail('playtestStrategy 基础字段无效')
  }
  const routeCases = row.routeCases.map((value, index) => {
    const item = record(value, `routeCases[${index}]`)
    exactKeys(item, [
      'caseKey', 'kind', 'executionMode', 'objective', 'steps', 'expectedAssertions', 'evidenceRefs', 'required',
    ], `routeCases[${index}]`)
    if (!TEXT_ADVENTURE_PLAYTEST_ROUTE_KINDS_V1.includes(item.kind as TextAdventurePlaytestRouteKindV1)
      || !['deterministic-autoplay', 'real-browser', 'human-playtest'].includes(String(item.executionMode))
      || typeof item.required !== 'boolean') fail(`routeCases[${index}] 枚举或 required 无效`)
    return {
      caseKey: key(item.caseKey, `routeCases[${index}].caseKey`),
      kind: item.kind as TextAdventurePlaytestRouteKindV1,
      executionMode: item.executionMode as TextAdventurePlaytestStrategyArtifactV1['routeCases'][number]['executionMode'],
      objective: text(item.objective, `routeCases[${index}].objective`),
      steps: strings(item.steps, `routeCases[${index}].steps`),
      expectedAssertions: strings(item.expectedAssertions, `routeCases[${index}].expectedAssertions`),
      evidenceRefs: strings(item.evidenceRefs, `routeCases[${index}].evidenceRefs`),
      required: item.required,
    }
  })
  const kinds = routeCases.map(item => item.kind)
  if (routeCases.length !== TEXT_ADVENTURE_PLAYTEST_ROUTE_KINDS_V1.length
    || new Set(kinds).size !== kinds.length
    || TEXT_ADVENTURE_PLAYTEST_ROUTE_KINDS_V1.some(kind => !kinds.includes(kind))
    || routeCases.some(item => !item.required)) fail('routeCases 必须不重不漏覆盖全部必需路线类型')
  const humanSessions = row.humanSessions.map((value, index) => {
    const item = record(value, `humanSessions[${index}]`)
    exactKeys(item, [
      'sessionKey', 'participantRole', 'routeKind', 'timingRequired', 'prompts', 'passCriteria',
    ], `humanSessions[${index}]`)
    if (!['author', 'independent-player'].includes(String(item.participantRole))
      || !['golden-route', 'alternate-route', 'failure-forward'].includes(String(item.routeKind))
      || typeof item.timingRequired !== 'boolean') fail(`humanSessions[${index}] 枚举或 timingRequired 无效`)
    return {
      sessionKey: key(item.sessionKey, `humanSessions[${index}].sessionKey`),
      participantRole: item.participantRole as 'author' | 'independent-player',
      routeKind: item.routeKind as 'golden-route' | 'alternate-route' | 'failure-forward',
      timingRequired: item.timingRequired,
      prompts: strings(item.prompts, `humanSessions[${index}].prompts`),
      passCriteria: strings(item.passCriteria, `humanSessions[${index}].passCriteria`),
    }
  })
  if (humanSessions.length < 2 || !humanSessions.some(item => item.participantRole === 'independent-player'
    && item.routeKind === 'golden-route' && item.timingRequired)
    || !humanSessions.some(item => item.routeKind !== 'golden-route')) {
    fail('humanSessions 必须包含独立玩家计时黄金路线及替代/失败路线')
  }
  const blockingRisks = row.blockingRisks.map((value, index) => {
    const item = record(value, `blockingRisks[${index}]`)
    exactKeys(item, ['riskKey', 'evidenceRef', 'detail', 'requiredResolution'], `blockingRisks[${index}]`)
    return {
      riskKey: key(item.riskKey, `blockingRisks[${index}].riskKey`),
      evidenceRef: text(item.evidenceRef, `blockingRisks[${index}].evidenceRef`, 500),
      detail: text(item.detail, `blockingRisks[${index}].detail`),
      requiredResolution: text(item.requiredResolution, `blockingRisks[${index}].requiredResolution`),
    }
  })
  if (blockingRisks.length > 50) fail('blockingRisks 超出上限')
  const recommendation = input.autoplayPassed && input.qualityReleaseReady && blockingRisks.length === 0
    ? 'eligible-for-human-validation' as const : 'blocked' as const
  return {
    schema: 'storyforge.text-adventure-playtest-strategy-artifact', version: 1,
    buildNumber: input.buildNumber, routeCases, humanSessions, blockingRisks, recommendation,
  }
}
