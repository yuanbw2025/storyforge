export const LONG_CONSISTENCY_TAXONOMY_VERSION_V1 = 'constory-bench-19-v1'

export const LONG_CONSISTENCY_CATEGORIES_V1 = [
  'timeline-plot-logic',
  'characterization',
  'world-building-setting',
  'factual-detail-consistency',
  'narrative-style',
] as const

export type LongConsistencyCategoryV1 = typeof LONG_CONSISTENCY_CATEGORIES_V1[number]

export const LONG_CONSISTENCY_SUBTYPES_V1 = [
  'absolute-time-contradiction',
  'duration-contradiction',
  'simultaneity-contradiction',
  'causeless-effect',
  'causal-logic-violation',
  'abandoned-plot-element',
  'memory-contradiction',
  'knowledge-contradiction',
  'skill-fluctuation',
  'forgotten-ability',
  'core-rules-violation',
  'social-norms-violation',
  'geographical-contradiction',
  'appearance-mismatch',
  'nomenclature-confusion',
  'quantitative-mismatch',
  'perspective-confusion',
  'tone-inconsistency',
  'style-shift',
] as const

export type LongConsistencySubtypeV1 = typeof LONG_CONSISTENCY_SUBTYPES_V1[number]

export interface LongConsistencyTaxonomyEntryV1 {
  category: LongConsistencyCategoryV1
  categoryLabel: string
  subtype: LongConsistencySubtypeV1
  subtypeLabel: string
}

// Source of record: Lost in Stories, Table 2 (arXiv:2603.05890).
export const LONG_CONSISTENCY_TAXONOMY_V1: readonly LongConsistencyTaxonomyEntryV1[] = Object.freeze([
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'absolute-time-contradiction',
    subtypeLabel: 'Absolute Time Contradictions',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'duration-contradiction',
    subtypeLabel: 'Duration Contradictions',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'simultaneity-contradiction',
    subtypeLabel: 'Simultaneity Contradictions',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'causeless-effect',
    subtypeLabel: 'Causeless Effects',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'causal-logic-violation',
    subtypeLabel: 'Causal Logic Violations',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'abandoned-plot-element',
    subtypeLabel: 'Abandoned Plot Elements',
  },
  {
    category: 'characterization',
    categoryLabel: 'Characterization',
    subtype: 'memory-contradiction',
    subtypeLabel: 'Memory Contradictions',
  },
  {
    category: 'characterization',
    categoryLabel: 'Characterization',
    subtype: 'knowledge-contradiction',
    subtypeLabel: 'Knowledge Contradictions',
  },
  {
    category: 'characterization',
    categoryLabel: 'Characterization',
    subtype: 'skill-fluctuation',
    subtypeLabel: 'Skill Fluctuations',
  },
  {
    category: 'characterization',
    categoryLabel: 'Characterization',
    subtype: 'forgotten-ability',
    subtypeLabel: 'Forgotten Abilities',
  },
  {
    category: 'world-building-setting',
    categoryLabel: 'World-building & Setting',
    subtype: 'core-rules-violation',
    subtypeLabel: 'Core Rules Violations',
  },
  {
    category: 'world-building-setting',
    categoryLabel: 'World-building & Setting',
    subtype: 'social-norms-violation',
    subtypeLabel: 'Social Norms Violations',
  },
  {
    category: 'world-building-setting',
    categoryLabel: 'World-building & Setting',
    subtype: 'geographical-contradiction',
    subtypeLabel: 'Geographical Contradictions',
  },
  {
    category: 'factual-detail-consistency',
    categoryLabel: 'Factual & Detail Consistency',
    subtype: 'appearance-mismatch',
    subtypeLabel: 'Appearance Mismatches',
  },
  {
    category: 'factual-detail-consistency',
    categoryLabel: 'Factual & Detail Consistency',
    subtype: 'nomenclature-confusion',
    subtypeLabel: 'Nomenclature Confusions',
  },
  {
    category: 'factual-detail-consistency',
    categoryLabel: 'Factual & Detail Consistency',
    subtype: 'quantitative-mismatch',
    subtypeLabel: 'Quantitative Mismatches',
  },
  {
    category: 'narrative-style',
    categoryLabel: 'Narrative & Style',
    subtype: 'perspective-confusion',
    subtypeLabel: 'Perspective Confusions',
  },
  {
    category: 'narrative-style',
    categoryLabel: 'Narrative & Style',
    subtype: 'tone-inconsistency',
    subtypeLabel: 'Tone Inconsistencies',
  },
  {
    category: 'narrative-style',
    categoryLabel: 'Narrative & Style',
    subtype: 'style-shift',
    subtypeLabel: 'Style Shifts',
  },
])

const TAXONOMY_BY_SUBTYPE = new Map(
  LONG_CONSISTENCY_TAXONOMY_V1.map(entry => [entry.subtype, entry] as const),
)

export function getLongConsistencyTaxonomyEntryV1(
  subtype: LongConsistencySubtypeV1,
): LongConsistencyTaxonomyEntryV1 {
  const entry = TAXONOMY_BY_SUBTYPE.get(subtype)
  if (!entry) throw new Error(`Unknown long-consistency subtype: ${subtype}`)
  return entry
}
