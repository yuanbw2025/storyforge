/** Transient author review uses the original task JSON and adoption command. */
import type { ProductProductionBriefV3 } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseTtrpgOpenSourceFactsArtifactV1, parseTtrpgOpenRuleSystemArtifactV1,
  type TtrpgOpenSourceFactsArtifactV1, type TtrpgOpenRuleSystemArtifactV1 } from './open-production-artifacts'

export type TtrpgOpenProductionReviewTaskV1 = 'ttrpg.open.source-facts' | 'ttrpg.open.rule-system'
type OpenBrief = NonNullable<ProductProductionBriefV3['ttrpgOpen']>
export type TtrpgOpenProductionReviewDraftV1 =
  | { kind: 'facts'; artifact: TtrpgOpenSourceFactsArtifactV1 }
  | { kind: 'rules'; artifact: TtrpgOpenRuleSystemArtifactV1 }

/** The model cannot confirm its own facts. Preserve only exact locked author facts. */
export function normalizeTtrpgOpenSourceFactsForReviewV1(value: unknown, brief: OpenBrief) {
  const facts = parseTtrpgOpenSourceFactsArtifactV1(value)
  const locked = new Set(brief.settings.openAuthoring.factPolicy.filter(item => item.authorConfirmed)
    .map(item => canonicalProductProductionJsonV2(item.fact)))
  for (const item of facts.factPolicy) item.authorConfirmed = locked.has(canonicalProductProductionJsonV2(item.fact))
  return facts
}

/** Every proposed numeric mapping requires the author's own review. */
export function normalizeTtrpgOpenRuleSystemForReviewV1(value: unknown, brief: OpenBrief) {
  const system = parseTtrpgOpenRuleSystemArtifactV1(value, brief.rulePack, brief.settings)
  for (const actor of system.characterTemplates) {
    for (const mapping of Object.values(actor.attributeMappings)) mapping.authorConfirmed = false
  }
  return system
}

export function parseTtrpgOpenProductionReviewDraftV1(taskKey: TtrpgOpenProductionReviewTaskV1,
  text: string, brief: OpenBrief): TtrpgOpenProductionReviewDraftV1 {
  if (!text.trim() || text.length > 120_000) throw new Error('任务修订稿为空或超过120000字符，请检查完整原稿。')
  const value: unknown = JSON.parse(text)
  return taskKey === 'ttrpg.open.source-facts'
    ? { kind: 'facts', artifact: parseTtrpgOpenSourceFactsArtifactV1(value) }
    : { kind: 'rules', artifact: parseTtrpgOpenRuleSystemArtifactV1(value, brief.rulePack, brief.settings) }
}
