import type { ProductProductionBriefV3 } from '../types'

const INTERNAL_EVOLUTION_PREFIX_V1 = /^\s*本轮演化\s*[：:]/u

/**
 * Product evolution goals are private production instructions. Older Brief
 * revisions accidentally appended them to coreExperience, so the public
 * projection must remain defensive while those immutable revisions continue
 * to exist for audit and replay.
 */
export function productPublicCoreExperienceV1(
  brief: Pick<ProductProductionBriefV3, 'intent'>,
): string[] {
  return [...new Set(brief.intent.coreExperience
    .map(value => value.trim())
    .filter(value => value.length > 0 && !INTERNAL_EVOLUTION_PREFIX_V1.test(value)))]
}

export function productPublicDescriptionV1(input: {
  moduleTitle: string
  brief: Pick<ProductProductionBriefV3, 'intent'>
}): string {
  const moduleTitle = input.moduleTitle.trim()
  const experiences = productPublicCoreExperienceV1(input.brief)
  return experiences.length > 0 ? `${moduleTitle} · ${experiences.join('；')}` : moduleTitle
}

/**
 * openingSituation describes the story opening, not the player identity. Keep
 * the authored value for healthy Briefs, but synthesize a role description for
 * immutable legacy revisions where the current evolution goal overwrote it.
 */
export function textAdventurePublicPlayerDescriptionV1(
  brief: Pick<ProductProductionBriefV3, 'intent' | 'evolution'>,
): string {
  const openingSituation = brief.intent.openingSituation.trim()
  const evolutionGoal = brief.evolution?.userGoal.trim() ?? ''
  if (openingSituation && (!evolutionGoal || openingSituation !== evolutionGoal)) return openingSituation
  const playerRole = brief.intent.playerRole.trim()
  return playerRole ? `玩家将以${playerRole}的身份进入故事并承担选择的后果。` : '玩家将进入故事并承担选择的后果。'
}
