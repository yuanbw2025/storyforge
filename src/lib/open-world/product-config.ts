export const TEXT_OPEN_WORLD_CALIBRATION_DECISION_IDS_V1 = [
  'OW-CAL-001-default-content-scale',
  'OW-CAL-002-relationship-thresholds',
  'OW-CAL-003-protected-quest-ui',
  'OW-CAL-004-random-task-expression',
  'OW-CAL-005-ai-budget-guardrails',
] as const

export interface TextOpenWorldCalibrationConfigV1 {
  schema: 'storyforge.text-open-world.calibration'
  version: 1
  decisionIds: typeof TEXT_OPEN_WORLD_CALIBRATION_DECISION_IDS_V1
  defaultScale: {
    regions: number
    namedLocations: { minimum: number; maximum: number }
    mainlineStages: { minimum: number; maximum: number }
    endings: number
    significantStorylines: number
    ordinaryQuests: { minimum: number; maximum: number }
    taskTemplates: { minimum: number; maximum: number }
    randomEvents: { minimum: number; maximum: number }
    requiredPlayMinutes: { minimum: number; maximum: number }
    optionalInventoryMinutes: { minimum: number; maximum: number }
  }
  relationships: {
    morality: { minimum: number; maximum: number; initial: number }
    factionAffinity: { minimum: number; maximum: number; initial: number }
    attitude: {
      badMaximum: number
      goodMinimum: number
      moralityWeight: number
      factionWeight: number
      explicitStoryModifierCap: number
    }
    passiveDecayPerWorldDay: number
  }
  protectedQuestUi: {
    actionPresentation: 'disabled-with-explanation'
    explanation: string
  }
  randomTaskExpression: {
    buildVariantsPerTemplate: number
    runtimeMode: 'governed-candidate'
    fallback: 'build-variant-or-blank'
  }
  aiBudget: {
    production: {
      maximumCalls: number
      maximumInputTokens: number
      maximumOutputTokens: number
      maximumEstimatedCostUsd: number
    }
    runtimePerPlayHour: {
      maximumCalls: number
      maximumInputTokens: number
      maximumOutputTokens: number
      maximumEstimatedCostUsd: number
    }
    requireProviderPriceQuote: true
    stopWhenPriceUnknown: true
    stopWhenResultUnknown: true
  }
}

export const DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1: TextOpenWorldCalibrationConfigV1 = {
  schema: 'storyforge.text-open-world.calibration',
  version: 1,
  decisionIds: TEXT_OPEN_WORLD_CALIBRATION_DECISION_IDS_V1,
  defaultScale: {
    regions: 2,
    namedLocations: { minimum: 8, maximum: 12 },
    mainlineStages: { minimum: 6, maximum: 8 },
    endings: 2,
    significantStorylines: 2,
    ordinaryQuests: { minimum: 6, maximum: 10 },
    taskTemplates: { minimum: 4, maximum: 6 },
    randomEvents: { minimum: 12, maximum: 20 },
    requiredPlayMinutes: { minimum: 90, maximum: 120 },
    optionalInventoryMinutes: { minimum: 180, maximum: 300 },
  },
  relationships: {
    morality: { minimum: -100, maximum: 100, initial: 0 },
    factionAffinity: { minimum: -100, maximum: 100, initial: 0 },
    attitude: {
      badMaximum: -25,
      goodMinimum: 25,
      moralityWeight: 0.4,
      factionWeight: 0.6,
      explicitStoryModifierCap: 20,
    },
    passiveDecayPerWorldDay: 0,
  },
  protectedQuestUi: {
    actionPresentation: 'disabled-with-explanation',
    explanation: '主线和重要故事线属于本次游戏的核心内容，当前版本不能放弃。',
  },
  randomTaskExpression: {
    buildVariantsPerTemplate: 3,
    runtimeMode: 'governed-candidate',
    fallback: 'build-variant-or-blank',
  },
  aiBudget: {
    production: {
      maximumCalls: 200,
      maximumInputTokens: 1_200_000,
      maximumOutputTokens: 360_000,
      maximumEstimatedCostUsd: 30,
    },
    runtimePerPlayHour: {
      maximumCalls: 60,
      maximumInputTokens: 180_000,
      maximumOutputTokens: 45_000,
      maximumEstimatedCostUsd: 1.5,
    },
    requireProviderPriceQuote: true,
    stopWhenPriceUnknown: true,
    stopWhenResultUnknown: true,
  },
}

type JsonRecord = Record<string, unknown>

function fail(message: string): never {
  throw new Error(`[text-open-world-config] ${message}`)
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 不是对象`)
  return value as JsonRecord
}

function exact(value: JsonRecord, keys: readonly string[], label: string) {
  const unknown = Object.keys(value).filter(key => !keys.includes(key))
  const missing = keys.filter(key => !(key in value))
  if (unknown.length || missing.length) fail(`${label} 字段不匹配:unknown=${unknown.join(',')};missing=${missing.join(',')}`)
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} 必须在 ${minimum} 到 ${maximum} 之间`)
  }
  return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = finite(value, label, minimum, maximum)
  if (!Number.isInteger(parsed)) fail(`${label} 必须是整数`)
  return parsed
}

function range(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = record(value, label)
  exact(parsed, ['minimum', 'maximum'], label)
  const lower = integer(parsed.minimum, `${label}.minimum`, minimum, maximum)
  const upper = integer(parsed.maximum, `${label}.maximum`, minimum, maximum)
  if (lower > upper) fail(`${label} minimum 不能大于 maximum`)
  return { minimum: lower, maximum: upper }
}

function meter(value: unknown, label: string) {
  const parsed = record(value, label)
  exact(parsed, ['minimum', 'maximum', 'initial'], label)
  const minimum = finite(parsed.minimum, `${label}.minimum`, -10_000, 10_000)
  const maximum = finite(parsed.maximum, `${label}.maximum`, -10_000, 10_000)
  const initial = finite(parsed.initial, `${label}.initial`, -10_000, 10_000)
  if (minimum >= maximum || initial < minimum || initial > maximum) fail(`${label} 范围或初始值无效`)
  return { minimum, maximum, initial }
}

function budget(value: unknown, label: string) {
  const parsed = record(value, label)
  exact(parsed, ['maximumCalls', 'maximumInputTokens', 'maximumOutputTokens', 'maximumEstimatedCostUsd'], label)
  return {
    maximumCalls: integer(parsed.maximumCalls, `${label}.maximumCalls`, 1, 10_000),
    maximumInputTokens: integer(parsed.maximumInputTokens, `${label}.maximumInputTokens`, 1, 100_000_000),
    maximumOutputTokens: integer(parsed.maximumOutputTokens, `${label}.maximumOutputTokens`, 1, 100_000_000),
    maximumEstimatedCostUsd: finite(parsed.maximumEstimatedCostUsd, `${label}.maximumEstimatedCostUsd`, 0.01, 100_000),
  }
}

export function parseTextOpenWorldCalibrationConfigV1(value: unknown): TextOpenWorldCalibrationConfigV1 {
  const root = record(value, 'config')
  exact(root, ['schema', 'version', 'decisionIds', 'defaultScale', 'relationships', 'protectedQuestUi', 'randomTaskExpression', 'aiBudget'], 'config')
  if (root.schema !== 'storyforge.text-open-world.calibration' || root.version !== 1) fail('schema/version 无效')
  if (!Array.isArray(root.decisionIds)
    || root.decisionIds.length !== TEXT_OPEN_WORLD_CALIBRATION_DECISION_IDS_V1.length
    || root.decisionIds.some((item, index) => item !== TEXT_OPEN_WORLD_CALIBRATION_DECISION_IDS_V1[index])) {
    fail('decisionIds 必须完整且有序')
  }

  const scale = record(root.defaultScale, 'defaultScale')
  exact(scale, ['regions', 'namedLocations', 'mainlineStages', 'endings', 'significantStorylines', 'ordinaryQuests', 'taskTemplates', 'randomEvents', 'requiredPlayMinutes', 'optionalInventoryMinutes'], 'defaultScale')
  const relationships = record(root.relationships, 'relationships')
  exact(relationships, ['morality', 'factionAffinity', 'attitude', 'passiveDecayPerWorldDay'], 'relationships')
  const attitude = record(relationships.attitude, 'relationships.attitude')
  exact(attitude, ['badMaximum', 'goodMinimum', 'moralityWeight', 'factionWeight', 'explicitStoryModifierCap'], 'relationships.attitude')
  const badMaximum = finite(attitude.badMaximum, 'relationships.attitude.badMaximum', -10_000, 10_000)
  const goodMinimum = finite(attitude.goodMinimum, 'relationships.attitude.goodMinimum', -10_000, 10_000)
  const moralityWeight = finite(attitude.moralityWeight, 'relationships.attitude.moralityWeight', 0, 1)
  const factionWeight = finite(attitude.factionWeight, 'relationships.attitude.factionWeight', 0, 1)
  if (badMaximum >= goodMinimum) fail('三档态度阈值顺序无效')
  if (Math.abs(moralityWeight + factionWeight - 1) > 0.000001) fail('关系权重之和必须为1')

  const questUi = record(root.protectedQuestUi, 'protectedQuestUi')
  exact(questUi, ['actionPresentation', 'explanation'], 'protectedQuestUi')
  if (questUi.actionPresentation !== 'disabled-with-explanation'
    || typeof questUi.explanation !== 'string' || !questUi.explanation.trim() || questUi.explanation.length > 500) {
    fail('protectedQuestUi 无效')
  }
  const random = record(root.randomTaskExpression, 'randomTaskExpression')
  exact(random, ['buildVariantsPerTemplate', 'runtimeMode', 'fallback'], 'randomTaskExpression')
  if (random.runtimeMode !== 'governed-candidate' || random.fallback !== 'build-variant-or-blank') fail('randomTaskExpression 策略无效')
  const ai = record(root.aiBudget, 'aiBudget')
  exact(ai, ['production', 'runtimePerPlayHour', 'requireProviderPriceQuote', 'stopWhenPriceUnknown', 'stopWhenResultUnknown'], 'aiBudget')
  if (ai.requireProviderPriceQuote !== true || ai.stopWhenPriceUnknown !== true || ai.stopWhenResultUnknown !== true) {
    fail('AI预算必须在价格或结果未知时fail-closed')
  }

  return {
    schema: 'storyforge.text-open-world.calibration', version: 1,
    decisionIds: TEXT_OPEN_WORLD_CALIBRATION_DECISION_IDS_V1,
    defaultScale: {
      regions: integer(scale.regions, 'defaultScale.regions', 1, 100),
      namedLocations: range(scale.namedLocations, 'defaultScale.namedLocations', 1, 10_000),
      mainlineStages: range(scale.mainlineStages, 'defaultScale.mainlineStages', 1, 1_000),
      endings: integer(scale.endings, 'defaultScale.endings', 1, 100),
      significantStorylines: integer(scale.significantStorylines, 'defaultScale.significantStorylines', 0, 1_000),
      ordinaryQuests: range(scale.ordinaryQuests, 'defaultScale.ordinaryQuests', 0, 10_000),
      taskTemplates: range(scale.taskTemplates, 'defaultScale.taskTemplates', 0, 10_000),
      randomEvents: range(scale.randomEvents, 'defaultScale.randomEvents', 0, 100_000),
      requiredPlayMinutes: range(scale.requiredPlayMinutes, 'defaultScale.requiredPlayMinutes', 1, 1_000_000),
      optionalInventoryMinutes: range(scale.optionalInventoryMinutes, 'defaultScale.optionalInventoryMinutes', 0, 1_000_000),
    },
    relationships: {
      morality: meter(relationships.morality, 'relationships.morality'),
      factionAffinity: meter(relationships.factionAffinity, 'relationships.factionAffinity'),
      attitude: {
        badMaximum, goodMinimum, moralityWeight, factionWeight,
        explicitStoryModifierCap: finite(attitude.explicitStoryModifierCap, 'relationships.attitude.explicitStoryModifierCap', 0, 10_000),
      },
      passiveDecayPerWorldDay: finite(relationships.passiveDecayPerWorldDay, 'relationships.passiveDecayPerWorldDay', 0, 10_000),
    },
    protectedQuestUi: {
      actionPresentation: 'disabled-with-explanation',
      explanation: questUi.explanation.trim(),
    },
    randomTaskExpression: {
      buildVariantsPerTemplate: integer(random.buildVariantsPerTemplate, 'randomTaskExpression.buildVariantsPerTemplate', 1, 100),
      runtimeMode: 'governed-candidate', fallback: 'build-variant-or-blank',
    },
    aiBudget: {
      production: budget(ai.production, 'aiBudget.production'),
      runtimePerPlayHour: budget(ai.runtimePerPlayHour, 'aiBudget.runtimePerPlayHour'),
      requireProviderPriceQuote: true, stopWhenPriceUnknown: true, stopWhenResultUnknown: true,
    },
  }
}
