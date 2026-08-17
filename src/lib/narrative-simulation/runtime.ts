import type {
  NarrativeSimulationActionDefinition,
  NarrativeSimulationActorActionDefinition,
  NarrativeSimulationAtomicEffect,
  NarrativeSimulationCondition,
  NarrativeSimulationContentV1,
  NarrativeSimulationEffect,
  NarrativeSimulationEndingDefinition,
  NarrativeSimulationIssueDefinition,
  NarrativeSimulationModifierDefinition,
  NarrativeSimulationPresentationCandidateV1,
  NarrativeSimulationReport,
  NarrativeSimulationScheduledEffect,
  NarrativeSimulationValidationReport,
  SimulationEvent,
  SimulationEventType,
  SimulationNarrativeSimulationState,
} from '../types'

type Row = Record<string, unknown>
type SimulationEventDescriptor = {
  type: Extract<SimulationEventType, `simulation.${string}`>
  actorKey: string | null
  targetKey: string | null
  payload: Record<string, unknown>
  commandEnvelope?: boolean
}

const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/
const MAX_SAFE_VALUE = 1_000_000_000

function fail(message: string): never { throw new Error(`[textsim] ${message}`) }
function row(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Row
}
function exact(value: Row, keys: readonly string[], label: string) {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) fail(`${label} 字段不在白名单`)
}
function key(value: unknown, label: string): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > 160 || !STABLE_KEY.test(result)) fail(`${label} 不是稳定 key`)
  return result
}
function text(value: unknown, label: string, maximum = 10_000, allowEmpty = false): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((!allowEmpty && !result) || result.length > maximum) fail(`${label} 无效`)
  return result
}
function finite(value: unknown, label: string, minimum = -MAX_SAFE_VALUE, maximum = MAX_SAFE_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} 无效`)
  return value
}
function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 无效`)
  return Number(value)
}
function array(value: unknown, label: string, maximum = 500): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 必须是有限数组`)
  return value
}
function keys(value: unknown, label: string, maximum = 100): string[] {
  const result = array(value, label, maximum).map((item, index) => key(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label} 不能重复`)
  return result
}
function stringValues(value: unknown, label: string, maximum = 100): string[] {
  const result = array(value, label, maximum).map((item, index) => text(item, `${label}[${index}]`, 160))
  if (new Set(result).size !== result.length) fail(`${label} 不能重复`)
  return result
}

function parseCondition(value: unknown, label: string): NarrativeSimulationCondition {
  const source = row(value, label)
  const sourceKind = source.source
  if (sourceKind === 'turn') {
    exact(source, ['source', 'operator', 'value'], label)
    if (!['eq', 'gte', 'lte'].includes(String(source.operator))) fail(`${label}.operator 无效`)
    return { source: 'turn', operator: source.operator as 'eq', value: integer(source.value, `${label}.value`, 1, 100_000) }
  }
  exact(source, ['source', 'key', 'operator', 'value'], label)
  const targetKey = key(source.key, `${label}.key`)
  if (!['eq', 'gte', 'lte'].includes(String(source.operator))) fail(`${label}.operator 无效`)
  const operator = source.operator as 'eq' | 'gte' | 'lte'
  if (sourceKind === 'resource' || sourceKind === 'metric') {
    return { source: sourceKind, key: targetKey, operator, value: finite(source.value, `${label}.value`) }
  }
  if (!['issue-stage', 'decision-count', 'modifier-active', 'actor-stance'].includes(String(sourceKind))) {
    fail(`${label}.source 无效`)
  }
  if (!['string', 'number', 'boolean'].includes(typeof source.value)) fail(`${label}.value 无效`)
  return { source: sourceKind as 'issue-stage', key: targetKey, operator, value: source.value as string | number | boolean }
}

function parseAtomicEffect(value: unknown, label: string): NarrativeSimulationAtomicEffect {
  const source = row(value, label)
  if (source.op === 'change-value') {
    exact(source, ['op', 'target', 'key', 'delta'], label)
    if (source.target !== 'resource' && source.target !== 'metric') fail(`${label}.target 无效`)
    return { op: 'change-value', target: source.target, key: key(source.key, `${label}.key`), delta: finite(source.delta, `${label}.delta`) }
  }
  if (source.op === 'change-issue-pressure') {
    exact(source, ['op', 'issueKey', 'delta'], label)
    return { op: 'change-issue-pressure', issueKey: key(source.issueKey, `${label}.issueKey`), delta: finite(source.delta, `${label}.delta`) }
  }
  if (source.op === 'create-report') {
    exact(source, ['op', 'reportKey', 'observerKey', 'visibility', 'text', 'confidence', 'expiresAfterTurns'], label)
    if (!['player', 'actor', 'debug'].includes(String(source.visibility))) fail(`${label}.visibility 无效`)
    return {
      op: 'create-report', reportKey: key(source.reportKey, `${label}.reportKey`),
      observerKey: key(source.observerKey, `${label}.observerKey`),
      visibility: source.visibility as 'player', text: text(source.text, `${label}.text`, 10_000),
      confidence: finite(source.confidence, `${label}.confidence`, 0, 1),
      expiresAfterTurns: source.expiresAfterTurns == null ? null : integer(source.expiresAfterTurns, `${label}.expiresAfterTurns`, 1, 10_000),
    }
  }
  fail(`${label}.op 无效`)
}

function parseEffect(value: unknown, label: string): NarrativeSimulationEffect {
  const source = row(value, label)
  if (source.op === 'apply-modifier') {
    exact(source, ['op', 'modifierKey'], label)
    return { op: 'apply-modifier', modifierKey: key(source.modifierKey, `${label}.modifierKey`) }
  }
  return parseAtomicEffect(source, label)
}

function parseConditions(value: unknown, label: string) {
  return array(value, label, 64).map((item, index) => parseCondition(item, `${label}[${index}]`))
}
function parseAtomicEffects(value: unknown, label: string) {
  return array(value, label, 128).map((item, index) => parseAtomicEffect(item, `${label}[${index}]`))
}
function parseEffects(value: unknown, label: string) {
  return array(value, label, 128).map((item, index) => parseEffect(item, `${label}[${index}]`))
}

function parseAction(value: unknown, label: string): NarrativeSimulationActionDefinition {
  const source = row(value, label)
  exact(source, ['key', 'title', 'description', 'category', 'requirements', 'costs', 'immediateEffects', 'delayedEffects', 'cooldownTurns', 'conflictsWith', 'tags'], label)
  if (source.category !== 'decision' && source.category !== 'policy') fail(`${label}.category 无效`)
  const costs = array(source.costs, `${label}.costs`, 32).map((item, index) => {
    const effect = parseAtomicEffect(item, `${label}.costs[${index}]`)
    if (effect.op !== 'change-value' || effect.target !== 'resource' || effect.delta >= 0) fail(`${label}.costs 只能消耗资源`)
    return effect
  })
  return {
    key: key(source.key, `${label}.key`), title: text(source.title, `${label}.title`, 300),
    description: text(source.description, `${label}.description`, 5_000, true), category: source.category,
    requirements: parseConditions(source.requirements, `${label}.requirements`), costs,
    immediateEffects: parseEffects(source.immediateEffects, `${label}.immediateEffects`),
    delayedEffects: array(source.delayedEffects, `${label}.delayedEffects`, 32).map((item, index) => {
      const delayed = row(item, `${label}.delayedEffects[${index}]`)
      exact(delayed, ['afterTurns', 'effects'], `${label}.delayedEffects[${index}]`)
      return { afterTurns: integer(delayed.afterTurns, `${label}.delayedEffects[${index}].afterTurns`, 1, 10_000), effects: parseAtomicEffects(delayed.effects, `${label}.delayedEffects[${index}].effects`) }
    }),
    cooldownTurns: integer(source.cooldownTurns, `${label}.cooldownTurns`, 0, 10_000),
    conflictsWith: keys(source.conflictsWith, `${label}.conflictsWith`), tags: stringValues(source.tags, `${label}.tags`),
  }
}

function parseActorAction(value: unknown, label: string): NarrativeSimulationActorActionDefinition {
  const source = row(value, label)
  exact(source, ['key', 'title', 'requirements', 'effects', 'weight'], label)
  return {
    key: key(source.key, `${label}.key`), title: text(source.title, `${label}.title`, 300),
    requirements: parseConditions(source.requirements, `${label}.requirements`),
    effects: parseAtomicEffects(source.effects, `${label}.effects`), weight: integer(source.weight, `${label}.weight`, 1, 10_000),
  }
}

function parseContent(value: unknown): NarrativeSimulationContentV1 {
  const source = row(value, '模拟内容')
  exact(source, ['version', 'turnLimit', 'actionBudget', 'resources', 'metrics', 'actors', 'actions', 'modifiers', 'issues', 'endings', 'themes'], '模拟内容')
  if (source.version !== 1) fail('不支持的内容版本')
  const resources = array(source.resources, 'resources', 100).map((item, index) => {
    const value = row(item, `resources[${index}]`)
    exact(value, ['key', 'title', 'description', 'initial', 'minimum', 'maximum', 'conserved'], `resources[${index}]`)
    const minimum = finite(value.minimum, `resources[${index}].minimum`)
    const maximum = finite(value.maximum, `resources[${index}].maximum`, minimum)
    return { key: key(value.key, `resources[${index}].key`), title: text(value.title, `resources[${index}].title`, 300), description: text(value.description, `resources[${index}].description`, 5_000, true), initial: finite(value.initial, `resources[${index}].initial`, minimum, maximum), minimum, maximum, conserved: Boolean(value.conserved) }
  })
  const metrics = array(source.metrics, 'metrics', 100).map((item, index) => {
    const value = row(item, `metrics[${index}]`)
    exact(value, ['key', 'title', 'description', 'initial', 'minimum', 'maximum', 'conserved', 'levels'], `metrics[${index}]`)
    const minimum = finite(value.minimum, `metrics[${index}].minimum`)
    const maximum = finite(value.maximum, `metrics[${index}].maximum`, minimum)
    const levels = array(value.levels, `metrics[${index}].levels`, 32).map((levelValue, levelIndex) => {
      const level = row(levelValue, `metrics[${index}].levels[${levelIndex}]`)
      exact(level, ['key', 'label', 'minimum'], `metrics[${index}].levels[${levelIndex}]`)
      return { key: key(level.key, `metrics[${index}].levels[${levelIndex}].key`), label: text(level.label, `metrics[${index}].levels[${levelIndex}].label`, 200), minimum: finite(level.minimum, `metrics[${index}].levels[${levelIndex}].minimum`, minimum, maximum) }
    }).sort((left, right) => left.minimum - right.minimum)
    return { key: key(value.key, `metrics[${index}].key`), title: text(value.title, `metrics[${index}].title`, 300), description: text(value.description, `metrics[${index}].description`, 5_000, true), initial: finite(value.initial, `metrics[${index}].initial`, minimum, maximum), minimum, maximum, conserved: Boolean(value.conserved), levels }
  })
  const actors = array(source.actors, 'actors', 100).map((item, index) => {
    const value = row(item, `actors[${index}]`)
    exact(value, ['key', 'title', 'description', 'kind', 'stance', 'capabilities', 'observationKeys', 'strategyActions'], `actors[${index}]`)
    if (value.kind !== 'actor' && value.kind !== 'organization') fail(`actors[${index}].kind 无效`)
    const strategyActions = array(value.strategyActions, `actors[${index}].strategyActions`, 32)
      .map((action, actionIndex) => parseActorAction(action, `actors[${index}].strategyActions[${actionIndex}]`))
    return { key: key(value.key, `actors[${index}].key`), title: text(value.title, `actors[${index}].title`, 300), description: text(value.description, `actors[${index}].description`, 5_000, true), kind: value.kind as 'actor' | 'organization', stance: finite(value.stance, `actors[${index}].stance`, -100, 100), capabilities: stringValues(value.capabilities, `actors[${index}].capabilities`), observationKeys: keys(value.observationKeys, `actors[${index}].observationKeys`), strategyActions }
  })
  const actions = array(source.actions, 'actions', 200).map((item, index) => parseAction(item, `actions[${index}]`))
  const modifiers = array(source.modifiers, 'modifiers', 100).map((item, index): NarrativeSimulationModifierDefinition => {
    const value = row(item, `modifiers[${index}]`)
    exact(value, ['key', 'title', 'description', 'durationTurns', 'stackMode', 'recurringEffects'], `modifiers[${index}]`)
    if (!['replace', 'refresh', 'stack'].includes(String(value.stackMode))) fail(`modifiers[${index}].stackMode 无效`)
    return { key: key(value.key, `modifiers[${index}].key`), title: text(value.title, `modifiers[${index}].title`, 300), description: text(value.description, `modifiers[${index}].description`, 5_000, true), durationTurns: integer(value.durationTurns, `modifiers[${index}].durationTurns`, 1, 10_000), stackMode: value.stackMode as 'replace', recurringEffects: parseAtomicEffects(value.recurringEffects, `modifiers[${index}].recurringEffects`) }
  })
  const issues = array(source.issues, 'issues', 100).map((item, index): NarrativeSimulationIssueDefinition => {
    const value = row(item, `issues[${index}]`)
    exact(value, ['key', 'title', 'description', 'initialPressure', 'minimumPressure', 'maximumPressure', 'driftPerTurn', 'stages', 'affectedActorKeys', 'crisis'], `issues[${index}]`)
    const minimumPressure = finite(value.minimumPressure, `issues[${index}].minimumPressure`)
    const maximumPressure = finite(value.maximumPressure, `issues[${index}].maximumPressure`, minimumPressure)
    const stages = array(value.stages, `issues[${index}].stages`, 32).map((stageValue, stageIndex) => {
      const stage = row(stageValue, `issues[${index}].stages[${stageIndex}]`)
      exact(stage, ['key', 'title', 'minimumPressure', 'description'], `issues[${index}].stages[${stageIndex}]`)
      return { key: key(stage.key, `issues[${index}].stages[${stageIndex}].key`), title: text(stage.title, `issues[${index}].stages[${stageIndex}].title`, 300), minimumPressure: finite(stage.minimumPressure, `issues[${index}].stages[${stageIndex}].minimumPressure`, minimumPressure, maximumPressure), description: text(stage.description, `issues[${index}].stages[${stageIndex}].description`, 5_000, true) }
    }).sort((left, right) => left.minimumPressure - right.minimumPressure)
    return { key: key(value.key, `issues[${index}].key`), title: text(value.title, `issues[${index}].title`, 300), description: text(value.description, `issues[${index}].description`, 5_000, true), initialPressure: finite(value.initialPressure, `issues[${index}].initialPressure`, minimumPressure, maximumPressure), minimumPressure, maximumPressure, driftPerTurn: finite(value.driftPerTurn, `issues[${index}].driftPerTurn`), stages, affectedActorKeys: keys(value.affectedActorKeys, `issues[${index}].affectedActorKeys`), crisis: Boolean(value.crisis) }
  })
  const endings = array(source.endings, 'endings', 32).map((item, index): NarrativeSimulationEndingDefinition => {
    const value = row(item, `endings[${index}]`)
    exact(value, ['key', 'title', 'description', 'narrativeNodeKey', 'priority', 'conditions'], `endings[${index}]`)
    return { key: key(value.key, `endings[${index}].key`), title: text(value.title, `endings[${index}].title`, 300), description: text(value.description, `endings[${index}].description`, 5_000, true), narrativeNodeKey: key(value.narrativeNodeKey, `endings[${index}].narrativeNodeKey`), priority: integer(value.priority, `endings[${index}].priority`, 0, 10_000), conditions: parseConditions(value.conditions, `endings[${index}].conditions`) }
  })
  const themes = array(source.themes, 'themes', 16).map((item, index) => {
    const value = row(item, `themes[${index}]`)
    exact(value, ['key', 'title', 'roleLabel', 'resourceLabel', 'issueLabel'], `themes[${index}]`)
    return { key: key(value.key, `themes[${index}].key`), title: text(value.title, `themes[${index}].title`, 300), roleLabel: text(value.roleLabel, `themes[${index}].roleLabel`, 100), resourceLabel: text(value.resourceLabel, `themes[${index}].resourceLabel`, 100), issueLabel: text(value.issueLabel, `themes[${index}].issueLabel`, 100) }
  })
  return { version: 1, turnLimit: integer(source.turnLimit, 'turnLimit', 1, 10_000), actionBudget: integer(source.actionBudget, 'actionBudget', 1, 20), resources, metrics, actors, actions, modifiers, issues, endings, themes }
}

export function parseNarrativeSimulationContent(value: string | unknown): NarrativeSimulationContentV1 {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { fail('内容不是合法 JSON') }
  }
  return structuredClone(parseContent(parsed))
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>(); const duplicate = new Set<string>()
  for (const value of values) { if (seen.has(value)) duplicate.add(value); else seen.add(value) }
  return [...duplicate].sort()
}

function effectReferences(effect: NarrativeSimulationEffect | NarrativeSimulationAtomicEffect) {
  if (effect.op === 'change-value') return [`${effect.target}:${effect.key}`]
  if (effect.op === 'change-issue-pressure') return [`issue:${effect.issueKey}`]
  if (effect.op === 'apply-modifier') return [`modifier:${effect.modifierKey}`]
  return []
}

export function validateNarrativeSimulationContent(input: {
  content: NarrativeSimulationContentV1 | string
  narrativeNodeKeys?: readonly string[]
}): NarrativeSimulationValidationReport {
  const content = parseNarrativeSimulationContent(input.content)
  const errors: string[] = []; const warnings: string[] = []; const missing = new Set<string>()
  const duplicateKeys = [
    ...duplicates(content.resources.map(item => item.key)).map(key => `resource:${key}`),
    ...duplicates(content.metrics.map(item => item.key)).map(key => `metric:${key}`),
    ...duplicates(content.actors.map(item => item.key)).map(key => `actor:${key}`),
    ...duplicates(content.actions.map(item => item.key)).map(key => `action:${key}`),
    ...duplicates(content.modifiers.map(item => item.key)).map(key => `modifier:${key}`),
    ...duplicates(content.issues.map(item => item.key)).map(key => `issue:${key}`),
    ...duplicates(content.endings.map(item => item.key)).map(key => `ending:${key}`),
    ...duplicates(content.themes.map(item => item.key)).map(key => `theme:${key}`),
    ...content.actors.flatMap(actor => duplicates(actor.strategyActions.map(action => action.key)).map(key => `actor-action:${actor.key}:${key}`)),
  ]
  if (duplicateKeys.length) errors.push(`稳定 key 重复:${duplicateKeys.join(',')}`)
  const values = new Set([...content.resources.map(item => `resource:${item.key}`), ...content.metrics.map(item => `metric:${item.key}`)])
  const conservedValues = new Set([
    ...content.resources.filter(item => item.conserved).map(item => `resource:${item.key}`),
    ...content.metrics.filter(item => item.conserved).map(item => `metric:${item.key}`),
  ])
  const conservedMutationKeys = new Set<string>()
  const actorKeys = new Set(content.actors.map(item => item.key)); const actionKeys = new Set(content.actions.map(item => item.key))
  const modifierKeys = new Set(content.modifiers.map(item => item.key)); const issueKeys = new Set(content.issues.map(item => item.key))
  const issueStages = new Map(content.issues.map(issue => [issue.key, new Set(issue.stages.map(stage => stage.key))]))
  const checkCondition = (condition: NarrativeSimulationCondition) => {
    if ((condition.source === 'resource' || condition.source === 'metric') && !values.has(`${condition.source}:${condition.key}`)) missing.add(`${condition.source}:${condition.key}`)
    if (condition.source === 'issue-stage' && !issueStages.get(condition.key)?.has(String(condition.value))) missing.add(`issue-stage:${condition.key}:${String(condition.value)}`)
    if (condition.source === 'decision-count' && !actionKeys.has(condition.key)) missing.add(`action:${condition.key}`)
    if (condition.source === 'modifier-active' && !modifierKeys.has(condition.key)) missing.add(`modifier:${condition.key}`)
    if (condition.source === 'actor-stance' && !actorKeys.has(condition.key)) missing.add(`actor:${condition.key}`)
  }
  const checkEffect = (effect: NarrativeSimulationEffect | NarrativeSimulationAtomicEffect) => {
    for (const ref of effectReferences(effect)) {
      if (ref.startsWith('resource:') || ref.startsWith('metric:')) { if (!values.has(ref)) missing.add(ref) }
      else if (ref.startsWith('issue:')) { if (!issueKeys.has(ref.slice(6))) missing.add(ref) }
      else if (ref.startsWith('modifier:')) { if (!modifierKeys.has(ref.slice(9))) missing.add(ref) }
    }
    if (effect.op === 'change-value' && effect.delta !== 0 && conservedValues.has(`${effect.target}:${effect.key}`)) {
      conservedMutationKeys.add(`${effect.target}:${effect.key}`)
    }
    if (effect.op === 'create-report' && effect.observerKey !== 'player' && !actorKeys.has(effect.observerKey)) missing.add(`observer:${effect.observerKey}`)
  }
  for (const action of content.actions) {
    action.requirements.forEach(checkCondition); action.costs.forEach(checkEffect); action.immediateEffects.forEach(checkEffect)
    action.delayedEffects.flatMap(item => item.effects).forEach(checkEffect)
    action.conflictsWith.forEach(other => { if (!actionKeys.has(other)) missing.add(`action:${other}`) })
  }
  for (const modifier of content.modifiers) modifier.recurringEffects.forEach(checkEffect)
  for (const actor of content.actors) {
    actor.observationKeys.forEach(ref => { if (!values.has(ref) && !issueKeys.has(ref)) missing.add(`observation:${actor.key}:${ref}`) })
    for (const action of actor.strategyActions) { action.requirements.forEach(checkCondition); action.effects.forEach(checkEffect) }
  }
  for (const issue of content.issues) {
    if (!issue.stages.length || issue.stages[0]?.minimumPressure !== issue.minimumPressure) errors.push(`问题阶段未覆盖最小压力:${issue.key}`)
    issue.affectedActorKeys.forEach(actor => { if (!actorKeys.has(actor)) missing.add(`actor:${actor}`) })
  }
  const nodeKeys = input.narrativeNodeKeys ? new Set(input.narrativeNodeKeys) : null
  for (const ending of content.endings) {
    ending.conditions.forEach(checkCondition)
    if (nodeKeys && !nodeKeys.has(ending.narrativeNodeKey)) missing.add(`narrative-node:${ending.narrativeNodeKey}`)
  }
  if (!content.resources.length || !content.metrics.length || !content.actions.length || !content.actors.length || !content.issues.length || !content.endings.length) errors.push('模拟至少需要资源、指标、主体、行动、问题和结局')
  if (!content.themes.length) errors.push('至少需要一套题材映射')
  const unboundedGrowthKeys = new Set<string>()
  for (const action of content.actions.filter(item => item.cooldownTurns === 0 && item.costs.length === 0)) {
    for (const effect of action.immediateEffects) if (effect.op === 'change-value' && effect.delta > 0) unboundedGrowthKeys.add(`${effect.target}:${effect.key}`)
  }
  const signature = (action: NarrativeSimulationActionDefinition) => JSON.stringify({ requirements: action.requirements, immediateEffects: action.immediateEffects, delayedEffects: action.delayedEffects, cooldownTurns: action.cooldownTurns })
  const dominatedActionKeys = content.actions.filter((action, index, actions) => actions.some((other, otherIndex) => otherIndex !== index && signature(action) === signature(other)
    && action.costs.reduce((sum, cost) => sum - cost.delta, 0) > other.costs.reduce((sum, cost) => sum - cost.delta, 0))).map(item => item.key)
  const unsolvedCrisisKeys = content.issues.filter(issue => issue.crisis && ![
    ...content.actions.flatMap(action => [...action.immediateEffects, ...action.delayedEffects.flatMap(item => item.effects)]),
    ...content.modifiers.flatMap(modifier => modifier.recurringEffects),
    ...content.actors.flatMap(actor => actor.strategyActions.flatMap(action => action.effects)),
  ].some(effect => effect.op === 'change-issue-pressure' && effect.issueKey === issue.key && effect.delta < 0)).map(issue => issue.key)
  const bounds = new Map([
    ...content.resources.map(value => [`resource:${value.key}`, value] as const),
    ...content.metrics.map(value => [`metric:${value.key}`, value] as const),
  ])
  const unreachableEndingKeys = content.endings.filter(ending => ending.conditions.some(condition => {
    if (condition.source === 'turn') return condition.operator === 'gte' && condition.value > content.turnLimit
    if (condition.source === 'resource' || condition.source === 'metric') {
      const definition = bounds.get(`${condition.source}:${condition.key}`)
      if (!definition) return true
      return condition.operator === 'gte' ? condition.value > definition.maximum : condition.operator === 'lte' ? condition.value < definition.minimum : condition.value < definition.minimum || condition.value > definition.maximum
    }
    return false
  })).map(item => item.key)
  if (missing.size) errors.push(`引用缺失:${[...missing].sort().join(',')}`)
  if (conservedMutationKeys.size) errors.push(`守恒值不得被规则修改:${[...conservedMutationKeys].sort().join(',')}`)
  if (unsolvedCrisisKeys.length) errors.push(`危机没有缓解路径:${unsolvedCrisisKeys.join(',')}`)
  if (unreachableEndingKeys.length) errors.push(`结局条件不可达:${unreachableEndingKeys.join(',')}`)
  if (dominatedActionKeys.length) warnings.push(`行动被严格支配:${dominatedActionKeys.join(',')}`)
  if (unboundedGrowthKeys.size) warnings.push(`零成本无限增长风险:${[...unboundedGrowthKeys].join(',')}`)
  return { valid: errors.length === 0, errors, warnings, duplicateKeys, missingReferences: [...missing].sort(), dominatedActionKeys, unboundedGrowthKeys: [...unboundedGrowthKeys].sort(), conservedMutationKeys: [...conservedMutationKeys].sort(), unsolvedCrisisKeys, unreachableEndingKeys }
}

function issueStage(issue: NarrativeSimulationIssueDefinition, pressure: number) {
  return [...issue.stages].sort((left, right) => right.minimumPressure - left.minimumPressure)
    .find(stage => pressure >= stage.minimumPressure) ?? issue.stages[0]
}

export function createInitialNarrativeSimulationState(contentInput: NarrativeSimulationContentV1 | string, contentHash: string): SimulationNarrativeSimulationState {
  const content = parseNarrativeSimulationContent(contentInput)
  if (!/^[a-f0-9]{64}$/.test(contentHash)) fail('contentHash 无效')
  return {
    schema: 'storyforge.narrative-simulation', version: 1, contentHash, turn: 1, turnLimit: content.turnLimit,
    phase: 'planning', actionBudget: content.actionBudget,
    resources: Object.fromEntries(content.resources.map(item => [item.key, item.initial])),
    metrics: Object.fromEntries(content.metrics.map(item => [item.key, item.initial])),
    actorStances: Object.fromEntries(content.actors.map(item => [item.key, item.stance])), activeModifiers: [],
    issues: content.issues.map(issue => ({ issueKey: issue.key, pressure: issue.initialPressure, stageKey: issueStage(issue, issue.initialPressure)?.key ?? '', resolved: false, lastChangedSequence: 0 })),
    reports: [], schedules: [], cooldowns: {}, decisionHistory: [], actorActionHistory: [], qualifiedEndingKey: null,
    lastTurnEventSequences: [],
  }
}

export function parseNarrativeSimulationState(value: unknown): SimulationNarrativeSimulationState | null {
  if (value == null) return null
  const state = row(value, '模拟状态') as unknown as SimulationNarrativeSimulationState
  if (state.schema !== 'storyforge.narrative-simulation' || state.version !== 1 || !/^[a-f0-9]{64}$/.test(state.contentHash)) fail('模拟状态版本或内容哈希无效')
  integer(state.turn, 'state.turn', 1, 10_000); integer(state.turnLimit, 'state.turnLimit', 1, 10_000); integer(state.actionBudget, 'state.actionBudget', 1, 20)
  if (!['planning', 'resolving', 'ended'].includes(state.phase)) fail('模拟阶段无效')
  for (const [name, values] of [['resources', state.resources], ['metrics', state.metrics], ['actorStances', state.actorStances]] as const) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) fail(`${name} 无效`)
    for (const [entryKey, entry] of Object.entries(values)) { key(entryKey, `${name}.key`); finite(entry, `${name}.${entryKey}`) }
  }
  if (!Array.isArray(state.activeModifiers) || !Array.isArray(state.issues) || !Array.isArray(state.reports)
    || !Array.isArray(state.schedules) || !Array.isArray(state.decisionHistory) || !Array.isArray(state.actorActionHistory)
    || !Array.isArray(state.lastTurnEventSequences) || !state.cooldowns || typeof state.cooldowns !== 'object') fail('模拟状态集合无效')
  return structuredClone(state)
}

function eventPayload(event: SimulationEvent): Row {
  try { return row(JSON.parse(event.payloadJson), `${event.type}.payload`) } catch (error) { if (error instanceof SyntaxError) fail(`${event.type}.payload 不是 JSON`); throw error }
}

function requireState(current: SimulationNarrativeSimulationState | null): SimulationNarrativeSimulationState {
  const state = parseNarrativeSimulationState(current)
  if (!state) fail('事件缺少 narrative-simulation 状态')
  return state
}

export function applyNarrativeSimulationEvent(current: SimulationNarrativeSimulationState | null, event: SimulationEvent): SimulationNarrativeSimulationState {
  const state = requireState(current); const payload = eventPayload(event)
  const turn = () => integer(payload.turn, `${event.type}.turn`, 1, state.turnLimit)
  const remember = () => { if (!state.lastTurnEventSequences.includes(event.sequence)) state.lastTurnEventSequences.push(event.sequence) }
  switch (event.type) {
    case 'simulation.turn.started': {
      if (state.phase !== 'planning' || turn() !== state.turn || state.qualifiedEndingKey) fail('回合不能开始')
      const decisionKeys = keys(payload.decisionKeys, 'decisionKeys', state.actionBudget)
      if (decisionKeys.length > state.actionBudget) fail('行动预算超限')
      state.phase = 'resolving'; state.lastTurnEventSequences = [event.sequence]; break
    }
    case 'simulation.decision.committed': {
      if (state.phase !== 'resolving' || turn() !== state.turn) fail('决策不在结算阶段')
      const actionKey = key(payload.actionKey, 'actionKey'); const availableTurn = integer(payload.availableTurn, 'availableTurn', state.turn, state.turnLimit + 10_000)
      if (state.decisionHistory.some(item => item.eventSequence === event.sequence)) fail('决策事件重复')
      state.decisionHistory.push({ eventSequence: event.sequence, turn: state.turn, actionKey, actorKey: 'player' }); state.cooldowns[actionKey] = availableTurn; remember(); break
    }
    case 'simulation.decision.rejected': remember(); break
    case 'simulation.resource.changed':
    case 'simulation.metric.changed': {
      if (state.phase !== 'resolving') fail('数值只能在结算阶段变化')
      const target = event.type === 'simulation.resource.changed' ? state.resources : state.metrics
      const targetKey = key(payload.key, 'value.key'); const before = finite(payload.before, 'value.before'); const delta = finite(payload.delta, 'value.delta'); const after = finite(payload.after, 'value.after')
      if (target[targetKey] !== before || before + delta !== after) fail('数值变化证据与状态不一致')
      target[targetKey] = after; remember(); break
    }
    case 'simulation.modifier.applied': {
      const modifier = row(payload.modifier, 'modifier') as unknown as SimulationNarrativeSimulationState['activeModifiers'][number]
      key(modifier.instanceKey, 'modifier.instanceKey'); key(modifier.modifierKey, 'modifier.modifierKey'); integer(modifier.remainingTurns, 'modifier.remainingTurns', 1, 10_000); integer(modifier.stacks, 'modifier.stacks', 1, 1_000)
      const index = state.activeModifiers.findIndex(item => item.instanceKey === modifier.instanceKey)
      if (index >= 0) state.activeModifiers[index] = structuredClone(modifier); else state.activeModifiers.push(structuredClone(modifier)); remember(); break
    }
    case 'simulation.modifier.ticked': {
      const instanceKey = key(payload.instanceKey, 'modifier.instanceKey'); const remainingTurns = integer(payload.remainingTurns, 'modifier.remainingTurns', 1, 10_000)
      const modifier = state.activeModifiers.find(item => item.instanceKey === instanceKey); if (!modifier || remainingTurns !== modifier.remainingTurns - 1) fail('modifier tick 无效')
      modifier.remainingTurns = remainingTurns; remember(); break
    }
    case 'simulation.modifier.expired':
    case 'simulation.modifier.removed': {
      const instanceKey = key(payload.instanceKey, 'modifier.instanceKey'); const before = state.activeModifiers.length
      state.activeModifiers = state.activeModifiers.filter(item => item.instanceKey !== instanceKey); if (state.activeModifiers.length === before) fail('modifier 不存在'); remember(); break
    }
    case 'simulation.effect.scheduled': {
      const schedule = row(payload.schedule, 'schedule') as unknown as NarrativeSimulationScheduledEffect
      key(schedule.scheduleId, 'schedule.scheduleId'); integer(schedule.dueTurn, 'schedule.dueTurn', state.turn + 1, state.turnLimit + 10_000)
      if (state.schedules.some(item => item.scheduleId === schedule.scheduleId)) fail('延迟效果重复')
      state.schedules.push(structuredClone(schedule)); remember(); break
    }
    case 'simulation.effect.settled': {
      const scheduleId = key(payload.scheduleId, 'scheduleId'); const schedule = state.schedules.find(item => item.scheduleId === scheduleId)
      if (!schedule || schedule.status !== 'pending' || schedule.dueTurn > state.turn) fail('延迟效果尚未到期或已结算')
      schedule.status = 'settled'; schedule.settledSequence = event.sequence; remember(); break
    }
    case 'simulation.actor.action-resolved': {
      const actorKey = key(payload.actorKey, 'actorKey'); const actionKey = key(payload.actionKey, 'actionKey')
      if (turn() !== state.turn) fail('主体行动回合不一致')
      state.actorActionHistory.push({ eventSequence: event.sequence, turn: state.turn, actorKey, actionKey }); remember(); break
    }
    case 'simulation.issue.created': {
      const issueKey = key(payload.issueKey, 'issueKey'); if (state.issues.some(item => item.issueKey === issueKey)) fail('问题已存在')
      state.issues.push({ issueKey, pressure: finite(payload.pressure, 'pressure'), stageKey: key(payload.stageKey, 'stageKey'), resolved: false, lastChangedSequence: event.sequence }); remember(); break
    }
    case 'simulation.issue.stage-changed': {
      const issueKey = key(payload.issueKey, 'issueKey'); const issue = state.issues.find(item => item.issueKey === issueKey); if (!issue) fail('问题不存在')
      const beforePressure = finite(payload.beforePressure, 'beforePressure'); const afterPressure = finite(payload.afterPressure, 'afterPressure')
      if (issue.pressure !== beforePressure) fail('问题压力证据不一致')
      issue.pressure = afterPressure; issue.stageKey = key(payload.toStageKey, 'toStageKey'); issue.lastChangedSequence = event.sequence; remember(); break
    }
    case 'simulation.issue.resolved': {
      const issueKey = key(payload.issueKey, 'issueKey'); const issue = state.issues.find(item => item.issueKey === issueKey); if (!issue || issue.resolved) fail('问题不存在或已解决')
      issue.resolved = true; issue.lastChangedSequence = event.sequence; remember(); break
    }
    case 'simulation.report.created': {
      const report = row(payload.report, 'report') as unknown as NarrativeSimulationReport
      key(report.reportId, 'report.reportId'); if (state.reports.some(item => item.reportId === report.reportId)) fail('报告重复')
      if (!Array.isArray(report.sourceEventSequences) || report.sourceEventSequences.some(sequence => !Number.isInteger(sequence) || sequence < 1 || sequence >= event.sequence)) fail('报告证据无效')
      state.reports.push(structuredClone(report)); state.reports = state.reports.slice(-240); remember(); break
    }
    case 'simulation.ending.qualified': {
      if (state.qualifiedEndingKey) fail('结局已确定')
      state.qualifiedEndingKey = key(payload.endingKey, 'endingKey'); remember(); break
    }
    case 'simulation.narrative.synced': remember(); break
    case 'simulation.turn.ended': {
      if (state.phase !== 'resolving' || turn() !== state.turn) fail('回合尚未开始')
      const nextTurn = integer(payload.nextTurn, 'nextTurn', state.turn, state.turnLimit + 1)
      if (nextTurn !== state.turn + (state.qualifiedEndingKey ? 0 : 1)) fail('下一回合无效')
      const sequences = array(payload.eventSequences, 'eventSequences', 10_000).map((value, index) => integer(value, `eventSequences[${index}]`, 1, event.sequence))
      if (!sequences.includes(event.sequence)) sequences.push(event.sequence)
      state.lastTurnEventSequences = [...new Set(sequences)].sort((left, right) => left - right)
      state.turn = nextTurn; state.phase = state.qualifiedEndingKey ? 'ended' : 'planning'; break
    }
    default: fail(`未知 narrative-simulation 事件:${event.type}`)
  }
  return state
}

function compare(actual: string | number | boolean, operator: 'eq' | 'gte' | 'lte', expected: string | number | boolean): boolean {
  if (operator === 'eq') return actual === expected
  if (typeof actual !== 'number' || typeof expected !== 'number') return false
  return operator === 'gte' ? actual >= expected : actual <= expected
}

export function evaluateNarrativeSimulationCondition(condition: NarrativeSimulationCondition, state: SimulationNarrativeSimulationState): boolean {
  if (condition.source === 'turn') return compare(state.turn, condition.operator, condition.value)
  if (condition.source === 'resource') return compare(state.resources[condition.key] ?? Number.NaN, condition.operator, condition.value)
  if (condition.source === 'metric') return compare(state.metrics[condition.key] ?? Number.NaN, condition.operator, condition.value)
  if (condition.source === 'issue-stage') return compare(state.issues.find(item => item.issueKey === condition.key)?.stageKey ?? '', condition.operator, condition.value)
  if (condition.source === 'decision-count') return compare(state.decisionHistory.filter(item => item.actionKey === condition.key).length, condition.operator, condition.value)
  if (condition.source === 'modifier-active') return compare(state.activeModifiers.some(item => item.modifierKey === condition.key), condition.operator, condition.value)
  return compare(state.actorStances[condition.key] ?? Number.NaN, condition.operator, condition.value)
}

export function availableNarrativeSimulationActions(contentInput: NarrativeSimulationContentV1 | string, stateInput: SimulationNarrativeSimulationState) {
  const content = parseNarrativeSimulationContent(contentInput); const state = requireState(stateInput)
  return content.actions.map(action => {
    const failed = action.requirements.find(condition => !evaluateNarrativeSimulationCondition(condition, state))
    const cooling = (state.cooldowns[action.key] ?? 1) > state.turn
    const unaffordable = action.costs.find(cost => (state.resources[cost.key] ?? Number.NaN) + cost.delta < (content.resources.find(item => item.key === cost.key)?.minimum ?? 0))
    return { action, available: state.phase === 'planning' && !state.qualifiedEndingKey && !failed && !cooling && !unaffordable, reason: state.phase !== 'planning' ? '当前不在决策阶段' : state.qualifiedEndingKey ? '本局已进入结局' : failed ? '前置条件未满足' : cooling ? `冷却至第 ${state.cooldowns[action.key]} 回合` : unaffordable ? '资源不足' : '' }
  })
}

function hash32(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619) }
  return result >>> 0
}

function chooseActorAction(actions: NarrativeSimulationActorActionDefinition[], seed: string, turn: number, actorKey: string) {
  const available = actions.filter(action => action.weight > 0)
  const total = available.reduce((sum, action) => sum + action.weight, 0); if (!total) return null
  let cursor = hash32(`${seed}\u0000${turn}\u0000${actorKey}`) % total
  for (const action of available) { if (cursor < action.weight) return action; cursor -= action.weight }
  return available[available.length - 1] ?? null
}

function valueDefinition(content: NarrativeSimulationContentV1, target: 'resource' | 'metric', targetKey: string) {
  return (target === 'resource' ? content.resources : content.metrics).find(item => item.key === targetKey)
}

export interface PlanNarrativeSimulationTurnInput {
  content: NarrativeSimulationContentV1 | string
  state: SimulationNarrativeSimulationState
  decisionKeys: string[]
  seed: string
  startingSequence: number
}

export function planNarrativeSimulationTurn(input: PlanNarrativeSimulationTurnInput): {
  descriptors: SimulationEventDescriptor[]
  projected: SimulationNarrativeSimulationState
  ending: NarrativeSimulationEndingDefinition | null
} {
  const content = parseNarrativeSimulationContent(input.content); let projected = requireState(input.state)
  if (projected.phase !== 'planning' || projected.qualifiedEndingKey) fail('当前不能结算回合')
  if (!Array.isArray(input.decisionKeys) || input.decisionKeys.length > projected.actionBudget || new Set(input.decisionKeys).size !== input.decisionKeys.length) fail('决策队列无效或超过预算')
  const availability = new Map(availableNarrativeSimulationActions(content, projected).map(item => [item.action.key, item]))
  for (const actionKey of input.decisionKeys) if (!availability.get(actionKey)?.available) fail(`行动不可用:${actionKey}:${availability.get(actionKey)?.reason ?? '未登记'}`)
  for (const actionKey of input.decisionKeys) {
    const action = availability.get(actionKey)!.action
    if (action.conflictsWith.some(other => input.decisionKeys.includes(other))) fail(`行动互斥:${actionKey}`)
  }
  const descriptors: SimulationEventDescriptor[] = []
  const emit = (type: SimulationEventDescriptor['type'], payload: Record<string, unknown>, actorKey: string | null = null, targetKey: string | null = null, commandEnvelope = false) => {
    const descriptor = { type, payload, actorKey, targetKey, commandEnvelope }; descriptors.push(descriptor)
    const sequence = input.startingSequence + descriptors.length
    projected = applyNarrativeSimulationEvent(projected, { projectId: 0, sessionId: 0, sequence, type, actorKey, targetKey, payloadJson: JSON.stringify(payload), createdAt: 0 })
    return sequence
  }
  const turn = projected.turn
  emit('simulation.turn.started', { turn, decisionKeys: input.decisionKeys }, 'player', null, true)
  const applyAtomic = (effect: NarrativeSimulationAtomicEffect, sourceKey: string) => {
    if (effect.op === 'change-value') {
      const target = effect.target === 'resource' ? projected.resources : projected.metrics
      const definition = valueDefinition(content, effect.target, effect.key); const before = target[effect.key]
      if (!definition || before == null) fail(`数值不存在:${effect.target}:${effect.key}`)
      const after = before + effect.delta
      if (!Number.isFinite(after) || after < definition.minimum || after > definition.maximum) fail(`数值越界:${effect.target}:${effect.key}`)
      emit(effect.target === 'resource' ? 'simulation.resource.changed' : 'simulation.metric.changed', { turn, key: effect.key, before, delta: effect.delta, after, sourceKey }, null, effect.key)
    } else if (effect.op === 'change-issue-pressure') {
      const definition = content.issues.find(item => item.key === effect.issueKey); const issue = projected.issues.find(item => item.issueKey === effect.issueKey)
      if (!definition || !issue) fail(`问题不存在:${effect.issueKey}`)
      const after = Math.max(definition.minimumPressure, Math.min(definition.maximumPressure, issue.pressure + effect.delta)); const nextStage = issueStage(definition, after)
      if (after !== issue.pressure || nextStage?.key !== issue.stageKey) emit('simulation.issue.stage-changed', { turn, issueKey: issue.issueKey, beforePressure: issue.pressure, afterPressure: after, fromStageKey: issue.stageKey, toStageKey: nextStage?.key ?? issue.stageKey, sourceKey }, null, issue.issueKey)
      if (after === definition.minimumPressure && !projected.issues.find(item => item.issueKey === issue.issueKey)?.resolved) emit('simulation.issue.resolved', { turn, issueKey: issue.issueKey, sourceKey }, null, issue.issueKey)
    } else {
      const sourceEventSequences = [...projected.lastTurnEventSequences]
      const report: NarrativeSimulationReport = { reportId: `${effect.reportKey}:${turn}:${input.startingSequence + descriptors.length + 1}`, reportKey: effect.reportKey, turn, observerKey: effect.observerKey, visibility: effect.visibility, text: effect.text, confidence: effect.confidence, sourceEventSequences, expiresAtTurn: effect.expiresAfterTurns == null ? null : turn + effect.expiresAfterTurns }
      emit('simulation.report.created', { turn, report }, effect.observerKey === 'player' ? 'system' : effect.observerKey, effect.reportKey)
    }
  }
  for (const schedule of projected.schedules.filter(item => item.status === 'pending' && item.dueTurn <= turn)) {
    for (const effect of schedule.effects) applyAtomic(effect, `schedule:${schedule.scheduleId}`)
    emit('simulation.effect.settled', { turn, scheduleId: schedule.scheduleId }, null, schedule.scheduleId)
  }
  for (const active of [...projected.activeModifiers]) {
    const modifier = content.modifiers.find(item => item.key === active.modifierKey); if (!modifier) fail(`冻结 modifier 缺失:${active.modifierKey}`)
    for (let stack = 0; stack < active.stacks; stack += 1) for (const effect of modifier.recurringEffects) applyAtomic(effect, `modifier:${active.instanceKey}`)
    if (active.remainingTurns <= 1) emit('simulation.modifier.expired', { turn, instanceKey: active.instanceKey }, null, active.instanceKey)
    else emit('simulation.modifier.ticked', { turn, instanceKey: active.instanceKey, remainingTurns: active.remainingTurns - 1 }, null, active.instanceKey)
  }
  const applyEffect = (effect: NarrativeSimulationEffect, sourceActionKey: string) => {
    if (effect.op !== 'apply-modifier') { applyAtomic(effect, `action:${sourceActionKey}`); return }
    const definition = content.modifiers.find(item => item.key === effect.modifierKey); if (!definition) fail(`modifier 不存在:${effect.modifierKey}`)
    const same = projected.activeModifiers.filter(item => item.modifierKey === definition.key)
    const instanceKey = definition.stackMode === 'stack' ? `${definition.key}:${turn}:${same.length + 1}` : definition.key
    const previous = same.find(item => item.instanceKey === instanceKey)
    emit('simulation.modifier.applied', { turn, modifier: { instanceKey, modifierKey: definition.key, sourceActionKey, appliedTurn: turn, remainingTurns: definition.durationTurns, stacks: definition.stackMode === 'stack' ? 1 : definition.stackMode === 'refresh' ? (previous?.stacks ?? 1) : 1 } }, null, instanceKey)
  }
  for (const actionKey of input.decisionKeys) {
    const action = content.actions.find(item => item.key === actionKey)!
    emit('simulation.decision.committed', { turn, actionKey, availableTurn: Math.min(content.turnLimit + 1, turn + action.cooldownTurns + 1) }, 'player', actionKey)
    for (const cost of action.costs) applyAtomic(cost, `cost:${actionKey}`)
    for (const effect of action.immediateEffects) applyEffect(effect, actionKey)
    action.delayedEffects.forEach((delayed, index) => {
      const schedule: NarrativeSimulationScheduledEffect = { scheduleId: `${actionKey}:${turn}:${index}`, sourceActionKey: actionKey, dueTurn: turn + delayed.afterTurns, effects: delayed.effects, status: 'pending', createdSequence: input.startingSequence + descriptors.length + 1, settledSequence: null }
      emit('simulation.effect.scheduled', { turn, schedule }, 'player', schedule.scheduleId)
    })
  }
  for (const actor of content.actors) {
    const available = actor.strategyActions.filter(action => action.requirements.every(condition => evaluateNarrativeSimulationCondition(condition, projected)))
    const action = chooseActorAction(available, input.seed, turn, actor.key); if (!action) continue
    const actionSequence = emit('simulation.actor.action-resolved', { turn, actorKey: actor.key, actionKey: action.key, strategyEvidence: `fnv1a:${input.seed}:${turn}:${actor.key}` }, actor.key, action.key)
    for (const effect of action.effects) applyAtomic(effect, `actor-action:${actionSequence}`)
  }
  for (const issue of content.issues) if (!projected.issues.find(item => item.issueKey === issue.key)?.resolved && issue.driftPerTurn !== 0) applyAtomic({ op: 'change-issue-pressure', issueKey: issue.key, delta: issue.driftPerTurn }, `issue-drift:${issue.key}`)
  const summaryEvidence = projected.lastTurnEventSequences.filter(sequence => sequence > input.startingSequence)
  emit('simulation.report.created', { turn, report: { reportId: `turn-summary:${turn}`, reportKey: 'turn-summary', turn, observerKey: 'player', visibility: 'player', text: `第 ${turn} 回合已结算：${input.decisionKeys.length ? input.decisionKeys.join('、') : '未安排主动决策'}。`, confidence: 1, sourceEventSequences: summaryEvidence, expiresAtTurn: null } satisfies NarrativeSimulationReport }, 'system', 'turn-summary')
  const ending = [...content.endings].sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key))
    .find(candidate => candidate.conditions.every(condition => evaluateNarrativeSimulationCondition(condition, projected))) ?? null
  if (ending) emit('simulation.ending.qualified', { turn, endingKey: ending.key, narrativeNodeKey: ending.narrativeNodeKey, evidenceSequences: [...projected.lastTurnEventSequences] }, null, ending.key)
  emit('simulation.narrative.synced', { turn, projection: narrativeSimulationProjection(projected) })
  const nextSequence = input.startingSequence + descriptors.length + 1
  emit('simulation.turn.ended', { turn, nextTurn: ending ? turn : turn + 1, eventSequences: [...projected.lastTurnEventSequences, nextSequence] })
  return { descriptors, projected, ending }
}

export function narrativeSimulationProjection(stateInput: SimulationNarrativeSimulationState) {
  const state = requireState(stateInput)
  return { turn: state.turn, resources: structuredClone(state.resources), metrics: structuredClone(state.metrics), issueStages: Object.fromEntries(state.issues.map(issue => [issue.issueKey, issue.stageKey])), endingKey: state.qualifiedEndingKey }
}

export function visibleNarrativeSimulationReports(stateInput: SimulationNarrativeSimulationState, observerKey = 'player') {
  const state = requireState(stateInput)
  return state.reports.filter(report => (report.visibility === 'player' || (report.visibility === 'actor' && report.observerKey === observerKey))
    && (report.expiresAtTurn == null || report.expiresAtTurn >= state.turn))
}

/** A branch starts a new local event stream at sequence zero. Preserve the
 * semantic snapshot while clearing parent-stream sequence references; parent
 * provenance remains on SimulationSession.parentThroughSequence. */
export function rebaseNarrativeSimulationStateForBranch(
  stateInput: SimulationNarrativeSimulationState,
): SimulationNarrativeSimulationState {
  const state = requireState(stateInput)
  return {
    ...state,
    activeModifiers: state.activeModifiers.map(item => ({ ...item })),
    issues: state.issues.map(item => ({ ...item, lastChangedSequence: 0 })),
    reports: state.reports.map(item => ({ ...item, sourceEventSequences: [] })),
    schedules: state.schedules.map(item => ({ ...item, createdSequence: 0, settledSequence: null })),
    decisionHistory: state.decisionHistory.map(item => ({ ...item, eventSequence: 0 })),
    actorActionHistory: state.actorActionHistory.map(item => ({ ...item, eventSequence: 0 })),
    lastTurnEventSequences: [],
  }
}

export function validateNarrativeSimulationPresentationCandidate(input: {
  candidate: NarrativeSimulationPresentationCandidateV1
  state: SimulationNarrativeSimulationState
  events: readonly SimulationEvent[]
}): NarrativeSimulationPresentationCandidateV1 {
  const state = requireState(input.state); const candidate = structuredClone(input.candidate)
  if (!['turn-briefing', 'advisor-performance', 'outcome-narration', 'actor-action-suggestion'].includes(candidate.kind)
    || !candidate.text.trim() || candidate.text.length > 20_000 || !Array.isArray(candidate.evidenceEventSequences)
    || new Set(candidate.evidenceEventSequences).size !== candidate.evidenceEventSequences.length) fail('AI 表现候选结构无效')
  const evidence = new Map(input.events.map(event => [event.sequence, event]))
  if (!candidate.evidenceEventSequences.length || candidate.evidenceEventSequences.some(sequence => !evidence.get(sequence)?.type.startsWith('simulation.'))) fail('AI 表现候选引用了不存在或越界事件')
  for (const fact of candidate.assertedFacts) {
    let actual: string | number | null
    if (fact.source === 'resource') actual = state.resources[fact.key] ?? null
    else if (fact.source === 'metric') actual = state.metrics[fact.key] ?? null
    else if (fact.source === 'issue-stage') actual = state.issues.find(issue => issue.issueKey === fact.key)?.stageKey ?? null
    else actual = state.qualifiedEndingKey
    if (actual !== fact.value) fail(`AI 表现候选事实冲突:${fact.source}:${fact.key}`)
  }
  return candidate
}

export function runNarrativeSimulationBatch(input: {
  content: NarrativeSimulationContentV1 | string
  contentHash: string
  seed: string
  turns: number
  decide: (state: SimulationNarrativeSimulationState, availableActionKeys: string[]) => string[]
}) {
  const content = parseNarrativeSimulationContent(input.content); let state = createInitialNarrativeSimulationState(content, input.contentHash)
  let sequence = 0; const events: SimulationEvent[] = []
  for (let index = 0; index < input.turns && state.phase !== 'ended'; index += 1) {
    const available = availableNarrativeSimulationActions(content, state).filter(item => item.available).map(item => item.action.key)
    const plan = planNarrativeSimulationTurn({ content, state, decisionKeys: input.decide(structuredClone(state), available), seed: input.seed, startingSequence: sequence })
    for (const descriptor of plan.descriptors) {
      sequence += 1
      events.push({ projectId: 0, sessionId: 0, sequence, type: descriptor.type, actorKey: descriptor.actorKey, targetKey: descriptor.targetKey, payloadJson: JSON.stringify(descriptor.payload), createdAt: 0 })
    }
    state = plan.projected
  }
  return { state, events }
}
