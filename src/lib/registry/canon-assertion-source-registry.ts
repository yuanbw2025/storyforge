/**
 * CONSISTENCY-3 · 世界宪法设定来源注册表。
 *
 * 模型只能引用本表登记的 table/field/predicate 闭集。这里不保存用户数据，只定义
 * 哪些现有设定字段可以成为可追溯 Canon 的证据来源。
 */
export type CanonAssertionSourceTable =
  | 'worldviews'
  | 'powerSystems'
  | 'cultivationSystems'
  | 'storyCores'
  | 'characters'

export interface CanonAssertionSourceFieldSpec {
  field: string
  label: string
  predicates: readonly string[]
}

export interface CanonAssertionSourceSpec {
  table: CanonAssertionSourceTable
  label: string
  fields: readonly CanonAssertionSourceFieldSpec[]
}

export const CANON_ASSERTION_SOURCE_REGISTRY: readonly CanonAssertionSourceSpec[] = Object.freeze([
  {
    table: 'worldviews',
    label: '世界观',
    fields: [
      { field: 'worldOrigin', label: '世界来源', predicates: ['magicSource', 'creationOrigin', 'deityAuthority', 'technologyLevel'] },
      { field: 'powerHierarchy', label: '力量体系', predicates: ['magicSource', 'deityAuthority', 'powerCeiling'] },
      { field: 'divineDesign', label: '神明设定', predicates: ['deityAuthority'] },
      { field: 'worldStructure', label: '世界结构', predicates: ['technologyLevel'] },
      { field: 'politicsOverview', label: '政治制度', predicates: ['technologyLevel'] },
      { field: 'economyOverview', label: '经济制度', predicates: ['technologyLevel'] },
      { field: 'cultureOverview', label: '文化制度', predicates: ['technologyLevel'] },
    ],
  },
  {
    table: 'powerSystems',
    label: '力量体系',
    fields: [
      { field: 'description', label: '体系描述', predicates: ['magicSource'] },
      { field: 'levels', label: '力量等级', predicates: ['powerCeiling'] },
      { field: 'rules', label: '体系规则', predicates: ['magicSource', 'deityAuthority', 'powerCeiling'] },
    ],
  },
  {
    table: 'cultivationSystems',
    label: '修炼体系',
    fields: [
      { field: 'description', label: '流派描述', predicates: ['magicSource', 'powerCeiling'] },
      { field: 'stages', label: '境界图谱', predicates: ['powerCeiling'] },
    ],
  },
  {
    table: 'storyCores',
    label: '故事核心',
    fields: [
      { field: 'logline', label: '一句话故事', predicates: ['parentStatus', 'characterOrigin', 'trueIdentity'] },
      { field: 'concept', label: '故事概念', predicates: ['parentStatus', 'characterOrigin', 'trueIdentity'] },
      { field: 'mainPlot', label: '故事主线', predicates: ['parentStatus', 'characterOrigin', 'trueIdentity'] },
    ],
  },
  {
    table: 'characters',
    label: '角色档案',
    fields: [
      { field: 'background', label: '背景故事', predicates: ['parentStatus', 'characterOrigin', 'trueIdentity'] },
      { field: 'relationships', label: '关系描述', predicates: ['parentStatus'] },
      { field: 'identity', label: '身份', predicates: ['characterOrigin', 'trueIdentity'] },
    ],
  },
])

const SOURCE_BY_TABLE = new Map(CANON_ASSERTION_SOURCE_REGISTRY.map(item => [item.table, item]))

export function getCanonAssertionSourceField(
  table: string,
  field: string,
): CanonAssertionSourceFieldSpec | undefined {
  return SOURCE_BY_TABLE.get(table as CanonAssertionSourceTable)?.fields.find(item => item.field === field)
}

export function isAllowedCanonAssertionSource(
  table: string,
  field: string,
  predicate: string,
): boolean {
  return getCanonAssertionSourceField(table, field)?.predicates.includes(predicate) === true
}
