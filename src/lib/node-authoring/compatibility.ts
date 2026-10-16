import type {
  AuthoringNodeTemplate,
  AuthoringPortContract,
  AuthoringPortDefinition,
  AuthoringSemantic,
} from './contracts'

const CONTENT_SEMANTICS = new Set<AuthoringSemantic>([
  'text',
  'world.setting',
  'world.location',
  'world.history',
  'world.rule',
  'story.theme',
  'story.conflict',
  'story.arc',
  'character.profile',
  'character.list',
  'character.relation',
  'outline.volume',
  'outline.chapter',
  'outline.plan',
  'chapter.prose',
  'chapter.quality-review',
  'continuity.foreshadow',
  'continuity.location',
  'continuity.state',
  'continuity.item',
  'continuity.fact',
  'continuity.knowledge',
  'continuity.timeline',
  'continuity.report',
  'candidate',
])

function semanticCompatible(source: AuthoringSemantic, target: AuthoringSemantic): boolean {
  if (source === target || target === 'any') return true
  if (source === 'character.profile' && target === 'character.list') return true
  if (target === 'candidate' && CONTENT_SEMANTICS.has(source)) return true
  if (source === 'candidate' && CONTENT_SEMANTICS.has(target)) return false
  return false
}

export function authoringPortsCompatible(
  source: AuthoringPortContract,
  target: AuthoringPortContract,
): boolean {
  if (source.state === 'control' || target.state === 'control') {
    return source.state === 'control'
      && target.state === 'control'
      && source.semantic === target.semantic
      && source.cardinality === target.cardinality
  }
  if (target.state !== 'any' && source.state !== 'any' && source.state !== target.state) {
    return false
  }
  if (source.cardinality === 'many' && target.cardinality === 'one') return false
  return semanticCompatible(source.semantic, target.semantic)
}

export interface AuthoringConnectionSuggestion {
  template: AuthoringNodeTemplate
  port: AuthoringPortDefinition
  score: number
  reason: 'recommended' | 'same-category' | 'compatible'
}

export function suggestAuthoringConnections(input: {
  catalog: readonly AuthoringNodeTemplate[]
  anchorTemplate?: AuthoringNodeTemplate | null
  anchorPort: AuthoringPortDefinition
  direction: 'before' | 'after'
  query?: string
}): AuthoringConnectionSuggestion[] {
  const query = input.query?.trim().toLocaleLowerCase('zh-CN') ?? ''
  const recommended = new Set(
    input.direction === 'after'
      ? input.anchorTemplate?.recommendedAfter ?? []
      : input.anchorTemplate?.recommendedBefore ?? [],
  )

  const suggestions: AuthoringConnectionSuggestion[] = []
  for (const template of input.catalog) {
    const searchable = `${template.label} ${template.description} ${template.category} ${template.id}`
      .toLocaleLowerCase('zh-CN')
    if (query && !searchable.includes(query)) continue
    const ports = input.direction === 'after' ? template.inputs : template.outputs
    for (const port of ports) {
      const compatible = input.direction === 'after'
        ? authoringPortsCompatible(input.anchorPort, port)
        : authoringPortsCompatible(port, input.anchorPort)
      if (!compatible) continue
      const isRecommended = recommended.has(template.id)
      const sameCategory = input.anchorTemplate?.category === template.category
      suggestions.push({
        template,
        port,
        score: (isRecommended ? 100 : 0) + (sameCategory ? 20 : 0) + (port.required ? 5 : 0),
        reason: isRecommended ? 'recommended' : sameCategory ? 'same-category' : 'compatible',
      })
    }
  }

  return suggestions.sort((left, right) => (
    right.score - left.score
    || left.template.category.localeCompare(right.template.category, 'zh-CN')
    || left.template.label.localeCompare(right.template.label, 'zh-CN')
  ))
}
