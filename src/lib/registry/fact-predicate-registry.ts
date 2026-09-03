/**
 * NS-4 · 受控谓词注册表 `FACT_PREDICATE_REGISTRY`（设计权威：方案 §14.2）。
 *
 * 单一事实源：AI 抽取的事实候选【必须】映射到这里登记的谓词 key（或其 aliases）。
 * 未登记的谓词只能进"候选待登记"，绝不能直接写入权威账本（temporalFacts）。
 *
 * 与三注册表的关系（§14.6 / §22.8 NS-4）：本表是 AdoptionSchema 的领域子注册——
 * 事实采纳时由它驱动「谓词归一 + factKind/cardinality/conflictPolicy + FK 客体类型校验」。
 */
import type { FactPredicateSpec } from '../types/temporal-fact'

export const FACT_PREDICATE_REGISTRY: readonly FactPredicateSpec[] = Object.freeze([
  // —— state 谓词：单值、可被新值 supersede、带时序 ——
  {
    key: 'location',
    label: '所在地点',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: true,
    aliases: ['位置', '所在', '身处', '位于', '在哪'],
    conflictPolicy: 'supersede',
  },
  {
    key: 'aliveStatus',
    label: '存亡状态',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'enum',
    enums: ['alive', 'dead', 'missing', 'unknown'],
    enumAliases: {
      '在世': 'alive',
      '存活': 'alive',
      '活着': 'alive',
      '生还': 'alive',
      '死亡': 'dead',
      '已死亡': 'dead',
      '身亡': 'dead',
      '去世': 'dead',
      '阵亡': 'dead',
      '失踪': 'missing',
      '下落不明': 'missing',
      '未知': 'unknown',
      '不明': 'unknown',
    },
    cardinality: 'single',
    temporal: true,
    aliases: ['存亡', '生死', '是否在世', '死亡', '存活'],
    conflictPolicy: 'supersede',
  },
  {
    key: 'healthStatus',
    label: '健康/伤病状态',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: true,
    aliases: ['健康', '伤势', '伤病', '身体状况', '受伤'],
    conflictPolicy: 'supersede',
  },
  {
    key: 'powerStage',
    label: '力量/修为阶段',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: true,
    aliases: ['境界', '修为', '等级', '力量阶段', '段位', '实力'],
    conflictPolicy: 'supersede',
  },
  {
    key: 'goal',
    label: '当前目标/动机',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: true,
    aliases: ['目标', '动机', '意图', '打算', '想要'],
    conflictPolicy: 'supersede',
  },
  // —— 关系/事件谓词：entity-ref，客体也是实体 ——
  {
    key: 'owns',
    label: '持有物品/掌控',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'entity-ref',
    cardinality: 'multi',
    temporal: true,
    aliases: ['持有', '拥有', '掌控', '携带', '占有'],
    conflictPolicy: 'append',
    objectEntityTypes: ['codexEntry'],
  },
  {
    key: 'knows',
    label: '知晓/认知',
    subjectTypes: ['character'],
    factKind: 'event',
    valueType: 'string',
    cardinality: 'multi',
    temporal: true,
    aliases: ['知道', '得知', '知晓', '了解', '发现真相'],
    conflictPolicy: 'append',
  },
  {
    key: 'relation',
    label: '人物关系',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'entity-ref',
    cardinality: 'multi',
    temporal: true,
    aliases: ['关系', '与…的关系', '结识', '敌对', '结盟', '师徒', '亲属'],
    conflictPolicy: 'manual',
    objectEntityTypes: ['character'],
  },
  {
    key: 'migratedStateCard',
    label: '迁移状态卡字段',
    subjectTypes: ['character', 'location', 'storyArc', 'worldGroup', 'codexEntry'],
    factKind: 'state',
    valueType: 'json',
    cardinality: 'multi',
    temporal: true,
    aliases: ['迁移状态', '状态卡字段'],
    conflictPolicy: 'manual',
  },
  // —— CONSISTENCY-3 世界宪法：非时序单值主题，有异值时必须人工裁决 ——
  {
    key: 'magicSource',
    label: '超自然力量来源',
    subjectTypes: ['worldGroup'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: false,
    aliases: ['魔法来源', '力量来源', '超自然来源'],
    conflictPolicy: 'manual',
    constitution: true,
  },
  {
    key: 'creationOrigin',
    label: '世界创生来源',
    subjectTypes: ['worldGroup'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: false,
    aliases: ['创世来源', '世界起源', '创生来源'],
    conflictPolicy: 'manual',
    constitution: true,
  },
  {
    key: 'deityAuthority',
    label: '神明权柄规则',
    subjectTypes: ['worldGroup'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: false,
    aliases: ['神明权柄', '神权规则'],
    conflictPolicy: 'manual',
    constitution: true,
  },
  {
    key: 'technologyLevel',
    label: '技术基线',
    subjectTypes: ['worldGroup'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: false,
    aliases: ['科技水平', '技术水平', '文明等级'],
    conflictPolicy: 'manual',
    constitution: true,
  },
  {
    key: 'powerCeiling',
    label: '力量上限',
    subjectTypes: ['worldGroup'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: false,
    aliases: ['最高境界', '力量天花板', '修为上限'],
    conflictPolicy: 'manual',
    constitution: true,
  },
  {
    key: 'parentStatus',
    label: '父母/监护人状态',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: false,
    aliases: ['父母状态', '监护人状态', '亲属存亡'],
    conflictPolicy: 'manual',
    constitution: true,
  },
  {
    key: 'characterOrigin',
    label: '角色身世来源',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: false,
    aliases: ['角色身世', '出身来源', '身世来源'],
    conflictPolicy: 'manual',
    constitution: true,
  },
  {
    key: 'trueIdentity',
    label: '真实身份',
    subjectTypes: ['character'],
    factKind: 'state',
    valueType: 'string',
    cardinality: 'single',
    temporal: false,
    aliases: ['真正身份', '隐藏身份', '身份真相'],
    conflictPolicy: 'manual',
    constitution: true,
  },
])

const BY_KEY = new Map(FACT_PREDICATE_REGISTRY.map(p => [p.key, p]))
const BY_ALIAS = new Map<string, FactPredicateSpec>()
for (const spec of FACT_PREDICATE_REGISTRY) {
  BY_ALIAS.set(spec.key, spec)
  for (const alias of spec.aliases ?? []) BY_ALIAS.set(alias, spec)
}

/** 按 key 取谓词定义。 */
export function getFactPredicate(key: string): FactPredicateSpec | undefined {
  return BY_KEY.get(key)
}

/** 世界宪法只接受显式标记的受控主题。 */
export function isConstitutionPredicate(key: string): boolean {
  return getFactPredicate(key)?.constitution === true
}

/**
 * 把 AI 自由措辞归一到受控谓词。命中 key 或 alias 返回规范定义；
 * 未登记返回 null —— 调用方必须将其作为"候选待登记"，不得直接写权威账本。
 */
export function normalizeFactPredicate(raw: string): FactPredicateSpec | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  return BY_ALIAS.get(trimmed) ?? null
}

/**
 * 将事实值收口到谓词声明。非枚举值只去首尾空白；枚举必须命中规范值或登记别名。
 * 返回 null 表示该值不能安全写入事实账本。
 */
export function normalizeFactValue(spec: FactPredicateSpec, raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (spec.valueType !== 'enum') return value
  const normalizedKey = value.toLocaleLowerCase('zh-CN')
  if (spec.enums?.includes(normalizedKey)) return normalizedKey
  const alias = spec.enumAliases?.[value] ?? spec.enumAliases?.[normalizedKey]
  return alias && spec.enums?.includes(alias) ? alias : null
}
