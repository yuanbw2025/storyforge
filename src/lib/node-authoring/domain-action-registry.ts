import type { AuthoringNodeTemplate } from './contracts'

export type AuthoringDomainActionIdV1 =
  | 'worldview-field-copilot'
  | 'story-core-field-copilot'
  | 'character-profile-copilot'
  | 'character-supplement-copilot'
  | 'character-relationship-durable'
  | 'story-arc-copilot'
  | 'outline-copilot'
  | 'detailed-outline-copilot'
  | 'prose-copilot'
  | 'chapter-organization-durable'
  | 'fact-extraction-durable'

export interface FormalAuthoringDomainActionBindingV1 {
  version: 1
  mode: 'formal-domain-action'
  actionId: AuthoringDomainActionIdV1
  skillId: string
  adoptionBoundary: string
}

export interface ExperimentalAuthoringDraftBindingV1 {
  version: 1
  mode: 'experimental-draft'
  actionId: 'generic-draft-generation'
  skillId: null
  adoptionBoundary: 'candidate-only'
}

export type AuthoringDomainActionBindingV1 =
  | FormalAuthoringDomainActionBindingV1
  | ExperimentalAuthoringDraftBindingV1

const FORMAL_EXACT = new Map<string, Omit<FormalAuthoringDomainActionBindingV1, 'version' | 'mode'>>([
  ['character.profile', {
    actionId: 'character-profile-copilot',
    skillId: 'character.create',
    adoptionBoundary: 'adoptCharacterCopilotCandidate',
  }],
  ['character.relation', {
    actionId: 'character-relationship-durable',
    skillId: 'character.relationships',
    adoptionBoundary: 'adoptCharacterRelationshipCandidateV1',
  }],
  ['story.arc', {
    actionId: 'story-arc-copilot',
    skillId: 'outline.story-arcs',
    adoptionBoundary: 'adoptRestoredStoryArcCandidate',
  }],
  ['continuity.storyline', {
    actionId: 'story-arc-copilot',
    skillId: 'outline.story-arcs',
    adoptionBoundary: 'adoptRestoredStoryArcCandidate',
  }],
  ['outline.volume', {
    actionId: 'outline-copilot',
    skillId: 'outline.volumes',
    adoptionBoundary: 'adoptRestoredOutlineCandidate',
  }],
  ['outline.chapter', {
    actionId: 'outline-copilot',
    skillId: 'outline.chapters',
    adoptionBoundary: 'adoptRestoredOutlineCandidate',
  }],
  ['outline.plan', {
    actionId: 'detailed-outline-copilot',
    skillId: 'outline.details',
    adoptionBoundary: 'adoptChapterOutlineWorkshopResult',
  }],
  ['chapter.prose', {
    actionId: 'prose-copilot',
    skillId: 'prose.generate',
    adoptionBoundary: 'adoptRestoredProseCandidate',
  }],
  ['chapter.organize', {
    actionId: 'chapter-organization-durable',
    skillId: 'prose.organize',
    adoptionBoundary: 'adoptChapterOrganizationSelection',
  }],
  ['continuity.fact', {
    actionId: 'fact-extraction-durable',
    skillId: 'prose.organize',
    adoptionBoundary: 'adoptFactCandidates',
  }],
])

const STORY_FIELDS = new Set([
  'story.logline', 'story.concept', 'story.theme', 'story.conflict',
  'story.pattern', 'story.main-plot', 'story.sub-plots',
])

/**
 * ARCH-06 single source of truth: maps a visual node to the same domain action,
 * Skill and adoption boundary used by the step-by-step product. It does not
 * contain prompts or persistence logic.
 */
export function authoringDomainActionBindingV1(
  template: Pick<AuthoringNodeTemplate, 'id' | 'capability'>,
): AuthoringDomainActionBindingV1 | null {
  if (template.capability !== 'generate-field' && template.capability !== 'generate-collection') return null
  const exact = FORMAL_EXACT.get(template.id)
  if (exact) return { version: 1, mode: 'formal-domain-action', ...exact }
  if (template.id.startsWith('world.')) return {
    version: 1,
    mode: 'formal-domain-action',
    actionId: 'worldview-field-copilot',
    skillId: 'world-origin.worldview-field',
    adoptionBoundary: 'adoptRestoredWorldviewFieldCandidate',
  }
  if (STORY_FIELDS.has(template.id)) return {
    version: 1,
    mode: 'formal-domain-action',
    actionId: 'story-core-field-copilot',
    skillId: 'world-origin.story-core',
    adoptionBoundary: 'adoptRestoredStoryCoreCandidate',
  }
  if (template.id.startsWith('character.field.')) return {
    version: 1,
    mode: 'formal-domain-action',
    actionId: 'character-supplement-copilot',
    skillId: 'character.supplement',
    adoptionBoundary: 'adoptRestoredCharacterSupplementCandidateV1',
  }
  return {
    version: 1,
    mode: 'experimental-draft',
    actionId: 'generic-draft-generation',
    skillId: null,
    adoptionBoundary: 'candidate-only',
  }
}

export function assertOfficialAuthoringGraphUsesFormalActionsV1(input: {
  templateId: string
  nodes: Array<{ templateId: string }>
  catalog: ReadonlyMap<string, AuthoringNodeTemplate>
}): void {
  const gaps: string[] = []
  for (const node of input.nodes) {
    const template = input.catalog.get(node.templateId)
    if (!template) {
      gaps.push(`${node.templateId}:missing-template`)
      continue
    }
    const binding = authoringDomainActionBindingV1(template)
    if (binding?.mode === 'experimental-draft') gaps.push(`${node.templateId}:experimental-draft`)
  }
  if (gaps.length) {
    throw new Error(`[node-same-source] 官方模板 ${input.templateId} 含未同源节点:${gaps.join('、')}`)
  }
}
