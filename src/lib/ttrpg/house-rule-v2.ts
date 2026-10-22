import type { TtrpgHouseRuleOverlayV2 } from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'
import type { RulePackV2 } from './open-contract'
import { parseRulePackV2, projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
import { runRulePackFixturesV1 } from './rule-pack'
import { applyTtrpgHouseRulePatchesV2, parseTtrpgHouseRuleOverlayV2 } from './house-rule'

/** Existing Overlay V2 targets RulePack V1. Open rules require an explicit new envelope. */
export interface TtrpgHouseRuleOverlayV3 extends Omit<TtrpgHouseRuleOverlayV2, 'version'> {
  version: 3
  baseRulePackVersion: 2
}

export function parseTtrpgHouseRuleOverlayV3(value: unknown): TtrpgHouseRuleOverlayV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[ttrpg-house-rule] Overlay 必须是对象')
  }
  const { version, baseRulePackVersion, ...body } = value as Record<string, unknown>
  if (version !== 3 || baseRulePackVersion !== 2) {
    throw new Error('[ttrpg-house-rule] Overlay version/baseRulePackVersion 无效')
  }
  // Reuse the existing strict metadata and patch whitelist, never a rule projection.
  const parsed = parseTtrpgHouseRuleOverlayV2({ ...body, version: 2 })
  return { ...parsed, version: 3, baseRulePackVersion: 2 }
}

export async function applyTtrpgHouseRuleOverlayV3(input: {
  baseRulePack: RulePackV2
  overlay: TtrpgHouseRuleOverlayV3
}) {
  const base = parseRulePackV2(input.baseRulePack)
  const overlay = parseTtrpgHouseRuleOverlayV3(input.overlay)
  const baseHash = await hashProductProductionValueV2(base)
  if (overlay.baseRuleSystemId !== base.ruleSystemId
    || overlay.baseRuleSystemVersion !== base.ruleSystemVersion
    || overlay.baseContentHash !== baseHash) {
    throw new Error('[ttrpg-house-rule] Overlay 基线规则或 hash 已变化')
  }
  const next = structuredClone(base)
  const diff = applyTtrpgHouseRulePatchesV2(next, overlay.patches)
  const rulePack = parseRulePackV2(next)
  runRulePackFixturesV1(projectTtrpgRulePackMechanicalCoreV1(rulePack))
  return { rulePack, contentHash: await hashProductProductionValueV2(rulePack), diff }
}
