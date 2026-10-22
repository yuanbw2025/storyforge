/** Registered, versioned task projection. The complete original Brief and SourcePlan remain authoritative. */
import type { ProductProductionBriefV3 } from '../types'
import type { TtrpgOpenProductionTaskKeyV3 } from './open-production-bindings'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { hashProductProductionValueV2 } from '../product-production/hash'

export type TtrpgOpenProjectedTaskKeyV1 = TtrpgOpenProductionTaskKeyV3

/** Full required values, without duplicated orchestration policy. Never a
 * substitute for SourcePlan authorization, Gateway reads or output validation. */
export async function projectTtrpgOpenProductionTaskBriefV1(input: {
  brief: ProductProductionBriefV3; briefHash: string; briefRevision: number
  productionKey: string; taskKey: TtrpgOpenProjectedTaskKeyV1
}) {
  const brief = parseProductProductionBriefV3(input.brief), content = brief.ttrpgOpen
  if (!content || brief.ttrpg || brief.intent.productType !== 'ttrpg'
    || await hashProductProductionValueV2(brief) !== input.briefHash
    || !Number.isSafeInteger(input.briefRevision) || input.briefRevision < 1
    || !input.productionKey.trim()) throw new Error('[ttrpg-task-brief] 原授权 Brief 身份不一致')
  const { openAuthoring, ...settings } = content.settings
  const common = { schema: 'storyforge.ttrpg-open-production-task-brief', version: 1,
    taskKey: input.taskKey,
    original: { productionKey: input.productionKey, briefRevision: input.briefRevision,
      briefHash: input.briefHash, settingsRevision: content.settingsRevision,
      worldReference: content.worldReference, sourcePlanHash: content.sourcePlan.planHash,
      rulePackHash: content.rulePackHash },
    intent: brief.intent, scale: brief.scale, qualityProfile: brief.qualityProfile }
  switch (input.taskKey) {
    case 'ttrpg.open.source-facts': return { ...common,
      confirmedFacts: openAuthoring.factPolicy,
      ruleFactPolicy: { ruleSystemId: content.rulePack.ruleSystemId,
        ruleSystemVersion: content.rulePack.ruleSystemVersion, factPolicy: content.rulePack.factPolicy } }
    case 'ttrpg.open.rule-system': return { ...common, settings,
      companionPolicy: openAuthoring.companionPolicy, rulePack: content.rulePack }
    case 'ttrpg.open.situation-layer': {
      const { factPolicy: _factsProvidedByAcceptedUpstream, ...authoring } = openAuthoring
      return { ...common, settings, authoring, rulePack: content.rulePack, media: brief.media }
    }
    case 'ttrpg.open.media-plan': return { schema: common.schema, version: common.version, taskKey: common.taskKey,
      original: common.original, media: brief.media, qualityProfile: brief.qualityProfile,
      consentBoundaries: { lines: settings.wizard.linesText, veils: settings.wizard.veilsText },
      externalDataPolicy: brief.externalDataPolicy, fallbackPolicy: brief.fallbackPolicy }
    default: throw new Error('[ttrpg-task-brief] 未登记的任务不能取得投影')
  }
}
