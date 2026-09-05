import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1,
  parseTextOpenWorldCalibrationConfigV1,
  TEXT_OPEN_WORLD_CALIBRATION_DECISION_IDS_V1,
} from '../../src/lib/open-world/product-config'

describe('TEXTWORLD-2 · frozen first-release calibration', () => {
  it('把五项剩余校准集中为可解析配置而不是散落在Prompt', () => {
    const parsed = parseTextOpenWorldCalibrationConfigV1(structuredClone(DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1))
    expect(parsed.decisionIds).toEqual(TEXT_OPEN_WORLD_CALIBRATION_DECISION_IDS_V1)
    expect(parsed.defaultScale).toMatchObject({
      regions: 2,
      namedLocations: { minimum: 8, maximum: 12 },
      mainlineStages: { minimum: 6, maximum: 8 },
      endings: 2,
      requiredPlayMinutes: { minimum: 90, maximum: 120 },
      optionalInventoryMinutes: { minimum: 180, maximum: 300 },
    })
    expect(parsed.relationships).toMatchObject({
      morality: { minimum: -100, maximum: 100, initial: 0 },
      factionAffinity: { minimum: -100, maximum: 100, initial: 0 },
      passiveDecayPerWorldDay: 0,
    })
    expect(parsed.protectedQuestUi.actionPresentation).toBe('disabled-with-explanation')
    expect(parsed.randomTaskExpression).toMatchObject({ buildVariantsPerTemplate: 3, runtimeMode: 'governed-candidate' })
    expect(parsed.aiBudget).toMatchObject({
      requireProviderPriceQuote: true, stopWhenPriceUnknown: true, stopWhenResultUnknown: true,
    })
  })

  it('拒绝未知字段、错误态度阈值和未封闭的AI预算', () => {
    expect(() => parseTextOpenWorldCalibrationConfigV1({
      ...structuredClone(DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1), surprise: true,
    })).toThrow('字段不匹配')

    const thresholds = structuredClone(DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1)
    thresholds.relationships.attitude.badMaximum = 30
    expect(() => parseTextOpenWorldCalibrationConfigV1(thresholds)).toThrow('阈值顺序无效')

    const budget = structuredClone(DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1) as any
    budget.aiBudget.stopWhenPriceUnknown = false
    expect(() => parseTextOpenWorldCalibrationConfigV1(budget)).toThrow('fail-closed')
  })
})
