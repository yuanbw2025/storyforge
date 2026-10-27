/** Bounded metadata retrieval. Body text still enters the model exclusively through Context Gateway. */
import type { ContextResourceDescriptorV1, FrozenResourceScopeV1 } from '../registry/types'
import type { AgentSkillDefinitionV1 } from '../agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { selectContextResourcesV1 } from '../context-gateway/selector'
import { createContextAccessPolicyForExecutionV1 } from '../context-gateway/skill-policy'

function queries(text: string) {
  type SegmenterConstructor = new (locale: string, options: { granularity: 'word' }) => { segment(text: string): Iterable<{ segment: string; isWordLike?: boolean }> }
  const Segmenter = Reflect.get(Intl, 'Segmenter') as SegmenterConstructor | undefined
  const words = typeof Segmenter === 'function'
    ? [...new Segmenter('zh', { granularity: 'word' }).segment(text)].filter(row => row.isWordLike).map(row => row.segment)
    : text.match(/[\p{L}\p{N}._-]+/gu) ?? []
  const unique = [...new Set([text, ...words].filter(word => word.length >= 2))]
  // Bound search work, sampling the whole request rather than dropping its tail.
  if (unique.length <= 24) return unique
  return [...new Set(Array.from({ length: 24 }, (_, i) => unique[Math.round(i * (unique.length - 1) / 23)]!))]
}

export async function selectTtrpgOpenMemoryResourcesV1(input: {
  scope: FrozenResourceScopeV1; skill: AgentSkillDefinitionV1; rows: readonly ContextResourceDescriptorV1[]; rawInput: string; budgetTokens: number
}): Promise<Set<string>> {
  if (!input.rows.length) return new Set()
  const byKey = new Map(input.rows.map(row => [row.resourceKey, row]))
  const matches = new Map<string, Set<string>>()
  for (const sourceKey of new Set(input.rows.map(row => row.sourceKey))) {
    const registered = CONTEXT_SOURCE_BY_KEY.get(sourceKey)?.resources
    if (!registered) throw new Error('[ttrpg-memory] 记忆检索缺少登记来源')
    const snapshot = await registered.openReadSession?.(input.scope), provider = snapshot?.provider ?? registered
    for (const query of queries(input.rawInput)) {
      let cursor: string | undefined
      do {
        const page = await provider.searchMetadata({ scope: input.scope, query, limit: 1000, cursor })
        for (const row of page.items) if (byKey.has(row.resourceKey)) {
          const terms = matches.get(row.resourceKey) ?? new Set<string>()
          terms.add(query); matches.set(row.resourceKey, terms)
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
    }
    await snapshot?.assertCurrent()
  }
  // Search hits are ranking evidence only. Final resources and manifests keep their actual descriptors and bytes.
  const descriptors = input.rows.map(row => ({ ...row, shortSummary: `${row.shortSummary} ${[...(matches.get(row.resourceKey) ?? [])].join(' ')}` }))
  const policy = createContextAccessPolicyForExecutionV1(input.skill)
  const selected = await selectContextResourcesV1({ taskKind: input.skill.contextTaskKind,
    // The mandatory memory contract is selected by the outer planner; no individual note is mandatory.
    accessPolicy: { ...policy, mandatorySourceKeys: [] }, scope: input.scope,
    descriptors, query: input.rawInput, budgetTokens: input.budgetTokens, readsAllowed: false })
  return new Set(selected.selected.map(row => row.resourceKey))
}
