import type {
  ProductProductionBriefV3,
  TextOpenWorldCreatorProductionEstimateV1,
  TextOpenWorldProductionBudgetProfileV1,
} from '../types'
import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from './product-config'

/** These are authorization ceilings, never a promise of provider consumption.
 * Keep the legacy profile unchanged so old Start/Plan hashes still rebuild. */
export const TEXT_OPEN_WORLD_PRODUCTION_RESOURCE_PROFILES_V1 = Object.freeze({
  'standard-v1': {
    ...DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1.aiBudget.production,
    maximumDurationMs: 7_200_000,
    maximumStorageBytes: 200_000_000,
  },
  'bounded-repair-v1': {
    maximumCalls: 400,
    maximumInputTokens: 6_000_000,
    maximumOutputTokens: 1_800_000,
    maximumEstimatedCostUsd: 100,
    maximumDurationMs: 21_600_000,
    maximumStorageBytes: 200_000_000,
  },
})

export function textOpenWorldProductionResourceProfileV1(profile: TextOpenWorldProductionBudgetProfileV1) {
  if (!Object.prototype.hasOwnProperty.call(TEXT_OPEN_WORLD_PRODUCTION_RESOURCE_PROFILES_V1, profile)) {
    throw new Error('[text-open-world-production-budget] 未登记的生产预算档位')
  }
  return { ...TEXT_OPEN_WORLD_PRODUCTION_RESOURCE_PROFILES_V1[profile] }
}

export function textOpenWorldProductionEstimateProfileV1(
  estimate: TextOpenWorldCreatorProductionEstimateV1,
): TextOpenWorldProductionBudgetProfileV1 {
  if (estimate.version === 1) return 'standard-v1'
  if (estimate.version === 2 && estimate.resourceProfile === 'bounded-repair-v1') return estimate.resourceProfile
  throw new Error('[text-open-world-production-budget] 生产预算版本或档位无效')
}

/** A formal execution Brief must carry every ceiling from the explicitly
 * selected profile; a single inflated field cannot opt into a larger cap. */
export function hasTextOpenWorldBoundedRepairBudgetV1(
  budget: ProductProductionBriefV3['productionBudget'],
): boolean {
  const profile = textOpenWorldProductionResourceProfileV1('bounded-repair-v1')
  return budget.maximumModelCalls === profile.maximumCalls
    && budget.maximumInputTokens === profile.maximumInputTokens
    && budget.maximumOutputTokens === profile.maximumOutputTokens
    && budget.maximumCostUsd === profile.maximumEstimatedCostUsd
    && budget.maximumDurationMs === profile.maximumDurationMs
    && budget.maximumStorageBytes === profile.maximumStorageBytes
}
