import { getAgentSkillV1, resolveAgentSkillContextSourceKeysV1 } from '../skill-registry'

/** The manual action and the post-adoption chain share one registered Skill.
 * New runs freeze these values; historical contracts are never rewritten. */
const skill = getAgentSkillV1('prose.organize', 'prose')
export const CHAPTER_ORGANIZATION_SOURCE_KEYS_CURRENT_V1 = Object.freeze(resolveAgentSkillContextSourceKeysV1(skill))
export const CHAPTER_ORGANIZATION_WRITE_TARGETS_CURRENT_V1 = Object.freeze(skill.writeTargets.map(target => ({
  ...target, fields: [...target.fields], mode: 'author-confirmed' as const,
})))
