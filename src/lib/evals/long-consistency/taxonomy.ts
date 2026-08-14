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
  operationalDefinitionZh: string
  decisionBoundaryZh: string
}

// Source of record: Lost in Stories, Table 2 (arXiv:2603.05890).
export const LONG_CONSISTENCY_TAXONOMY_V1: readonly LongConsistencyTaxonomyEntryV1[] = Object.freeze([
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'absolute-time-contradiction',
    subtypeLabel: 'Absolute Time Contradictions',
    operationalDefinitionZh: '同一事件、状态或记录被赋予互不相容的日期、年份、钟点或明确时间点。',
    decisionBoundaryZh: '只看绝对时间点；行程或过程长短归 duration，同一时刻分身归 simultaneity。',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'duration-contradiction',
    subtypeLabel: 'Duration Contradictions',
    operationalDefinitionZh: '已声明的最短、最长或实际持续时长，与后文给出的经过时间不能同时成立。',
    decisionBoundaryZh: '核心是时间区间长度，不是日历日期，也不是同一时刻出现在两处。',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'simultaneity-contradiction',
    subtypeLabel: 'Simultaneity Contradictions',
    operationalDefinitionZh: '同一实体在明确相同的时刻处于两个互斥地点、动作或状态。',
    decisionBoundaryZh: '必须有同时性和互斥性；只有先后时间写错归 absolute-time 或 causal-logic。',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'causeless-effect',
    subtypeLabel: 'Causeless Effects',
    operationalDefinitionZh: '文本已建立某结果所必需的唯一原因或前提，但又明确说明该原因未发生，结果却出现。',
    decisionBoundaryZh: '必要原因缺席才归此类；原因存在但顺序、条件或推导错误归 causal-logic。',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'causal-logic-violation',
    subtypeLabel: 'Causal Logic Violations',
    operationalDefinitionZh: '已建立的因果顺序、条件关系或推导链与后续事件的发生顺序或条件相冲突。',
    decisionBoundaryZh: '原因后来发生、顺序颠倒或条件推导错误归此类；原因始终明确缺席归 causeless-effect。',
  },
  {
    category: 'timeline-plot-logic',
    categoryLabel: 'Timeline & Plot Logic',
    subtype: 'abandoned-plot-element',
    subtypeLabel: 'Abandoned Plot Elements',
    operationalDefinitionZh: '带明确期限、后果或承诺的任务、威胁、物件或情节线越过兑现点后被无解释遗忘。',
    decisionBoundaryZh: '核心是已引入情节义务没有收束，不是某条规则被直接违反或因果顺序写错。',
  },
  {
    category: 'characterization',
    categoryLabel: 'Characterization',
    subtype: 'memory-contradiction',
    subtypeLabel: 'Memory Contradictions',
    operationalDefinitionZh: '同一角色对自己是否记得同一经历、话语或信息作出互不相容的陈述。',
    decisionBoundaryZh: '角色曾记得又否认记得归此类；没有获知渠道却知道信息归 knowledge。',
  },
  {
    category: 'characterization',
    categoryLabel: 'Characterization',
    subtype: 'knowledge-contradiction',
    subtypeLabel: 'Knowledge Contradictions',
    operationalDefinitionZh: '角色在没有观察、传递、推理或其它已建立渠道时掌握了受限信息。',
    decisionBoundaryZh: '关注信息来源和可知性；对自己既有记忆前后矛盾归 memory。',
  },
  {
    category: 'characterization',
    categoryLabel: 'Characterization',
    subtype: 'skill-fluctuation',
    subtypeLabel: 'Skill Fluctuations',
    operationalDefinitionZh: '角色的能力水平从不会到会、从弱到强或反向变化，却没有训练、受伤、外力或其它发展依据。',
    decisionBoundaryZh: '能力水平本身发生反转归此类；已有能力仍在、关键时刻却像忘了可用手段归 forgotten-ability。',
  },
  {
    category: 'characterization',
    categoryLabel: 'Characterization',
    subtype: 'forgotten-ability',
    subtypeLabel: 'Forgotten Abilities',
    operationalDefinitionZh: '角色已稳定掌握并可用于当前情境的能力，后文却无解释地忽略它或声称没有任何办法。',
    decisionBoundaryZh: '能力未被写成消失，只是被遗忘或不用；若能力水平直接反转归 skill-fluctuation。',
  },
  {
    category: 'world-building-setting',
    categoryLabel: 'World-building & Setting',
    subtype: 'core-rules-violation',
    subtypeLabel: 'Core Rules Violations',
    operationalDefinitionZh: '行动或事件直接违反作品已建立的物理、魔法、制度底层机制或不可例外的世界规则。',
    decisionBoundaryZh: '世界如何运作的硬规则归此类；礼仪、文化、执法惯例或群体规范归 social-norms。',
  },
  {
    category: 'world-building-setting',
    categoryLabel: 'World-building & Setting',
    subtype: 'social-norms-violation',
    subtypeLabel: 'Social Norms Violations',
    operationalDefinitionZh: '已明确为强制的礼仪、文化禁令、身份秩序或社会执行规则被公开违反，却无人解释或响应。',
    decisionBoundaryZh: '人与制度如何反应的规范归此类；自然、魔法或世界机制不可能发生归 core-rules。',
  },
  {
    category: 'world-building-setting',
    categoryLabel: 'World-building & Setting',
    subtype: 'geographical-contradiction',
    subtypeLabel: 'Geographical Contradictions',
    operationalDefinitionZh: '地点之间已建立的方向、邻接、距离或空间关系与后续移动或描述冲突。',
    decisionBoundaryZh: '关注稳定空间关系；仅行程耗时不可能归 duration，物件数量不符归 quantitative。',
  },
  {
    category: 'factual-detail-consistency',
    categoryLabel: 'Factual & Detail Consistency',
    subtype: 'appearance-mismatch',
    subtypeLabel: 'Appearance Mismatches',
    operationalDefinitionZh: '同一角色、物件或地点的稳定颜色、形态、身体特征或可见细节前后不一致。',
    decisionBoundaryZh: '实体身份不变而外观属性冲突归此类；两个名称或指代被交换归 nomenclature。',
  },
  {
    category: 'factual-detail-consistency',
    categoryLabel: 'Factual & Detail Consistency',
    subtype: 'nomenclature-confusion',
    subtypeLabel: 'Nomenclature Confusions',
    operationalDefinitionZh: '已定义的专名、称谓或实体指代在后文被交换、错配或指向另一对象。',
    decisionBoundaryZh: '关注名字与对象的绑定；同一对象只是外观变化归 appearance。',
  },
  {
    category: 'factual-detail-consistency',
    categoryLabel: 'Factual & Detail Consistency',
    subtype: 'quantitative-mismatch',
    subtypeLabel: 'Quantitative Mismatches',
    operationalDefinitionZh: '库存、人数、次数、金额或其它可计数值的初始量、变化量和剩余量无法同时成立。',
    decisionBoundaryZh: '关注数值守恒或明确计数；时间区间归 duration，空间距离或方向归 geographical。',
  },
  {
    category: 'narrative-style',
    categoryLabel: 'Narrative & Style',
    subtype: 'perspective-confusion',
    subtypeLabel: 'Perspective Confusions',
    operationalDefinitionZh: '叙事没有提示或意图说明便越过既定视角权限，例如限制视角直接知道他人未表达的内心。',
    decisionBoundaryZh: '关注谁有权感知或叙述信息；角色在情节内无渠道知道事实归 knowledge。',
  },
  {
    category: 'narrative-style',
    categoryLabel: 'Narrative & Style',
    subtype: 'tone-inconsistency',
    subtypeLabel: 'Tone Inconsistencies',
    operationalDefinitionZh: '同一场景的情绪基调、庄重程度或喜剧/悲剧姿态无叙事依据地突变。',
    decisionBoundaryZh: '语言形式可以相同但情绪姿态冲突；文本载体或句法形式突变归 style-shift。',
  },
  {
    category: 'narrative-style',
    categoryLabel: 'Narrative & Style',
    subtype: 'style-shift',
    subtypeLabel: 'Style Shifts',
    operationalDefinitionZh: '正文的体裁、叙述形式或语言组织无说明地切换，例如散文突然变成剧本提要。',
    decisionBoundaryZh: '关注表达形式而非场景情绪；只发生气氛或庄重程度突变归 tone-inconsistency。',
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
