/**
 * 角色维度描述符 · 单一事实源(呈现 + 生成勾选层)。
 *
 * 注意分工:
 * - 「能不能写」由 FIELD_REGISTRY 管(每个 key 都已在 field-registry 注册,AI 输出经 adopt() 写回);
 * - 本文件只管「怎么呈现 / 生成时默认勾哪些」——label、分组、textarea 行高、各戏份默认勾选集。
 * - 四个角色面板、维度勾选器、补全动作全部读这一份 → 加一个维度只改这里 + FIELD_REGISTRY 一行,
 *   生成/写回/四页展示/导出全部自动覆盖(「改一处,所有相关功能受益」)。
 *
 * relationships 走「关系网」面板,不在此重复。
 */
import type { Character, CharacterRoleWeight } from '../types/character'

export type CharacterDimensionKey =
  | 'shortDescription' | 'identity' | 'profile' | 'appearance' | 'location'
  | 'personality' | 'values' | 'strengths' | 'weaknesses' | 'fears'
  | 'motivation' | 'goals' | 'innerConflict'
  | 'background' | 'keyEvents'
  | 'abilities' | 'powerLevel'
  | 'speechStyle' | 'habits' | 'signatureItem'
  | 'arc' | 'storyRole' | 'ending'

export interface CharacterDimensionSpec {
  key: CharacterDimensionKey
  label: string
  group: string
  rows: number
  /** 该维度在哪些戏份下默认勾选(main 始终默认全选,不必列) */
  defaultFor: CharacterRoleWeight[]
}

const ALL: CharacterRoleWeight[] = ['secondary', 'npc', 'extra']

export const CHARACTER_DIMENSIONS: CharacterDimensionSpec[] = [
  // 身份
  { key: 'shortDescription', label: '一句话简介', group: '身份', rows: 2, defaultFor: ALL },
  { key: 'identity',  label: '身份/职业/势力', group: '身份', rows: 2, defaultFor: ['secondary', 'npc'] },
  { key: 'profile',   label: '年龄·性别·种族', group: '身份', rows: 1, defaultFor: ['secondary'] },
  { key: 'appearance', label: '外貌',          group: '身份', rows: 3, defaultFor: ALL },
  { key: 'location',  label: '常驻地点',        group: '身份', rows: 1, defaultFor: ['npc', 'extra'] },
  // 性格内核
  { key: 'personality', label: '性格',          group: '性格内核', rows: 3, defaultFor: ['secondary', 'npc'] },
  { key: 'values',     label: '价值观/信念',     group: '性格内核', rows: 2, defaultFor: ['secondary'] },
  { key: 'strengths',  label: '优点/长处',       group: '性格内核', rows: 2, defaultFor: [] },
  { key: 'weaknesses', label: '缺点/性格弱点',    group: '性格内核', rows: 2, defaultFor: ['secondary'] },
  { key: 'fears',      label: '恐惧/软肋',       group: '性格内核', rows: 2, defaultFor: [] },
  // 驱动力
  { key: 'motivation',   label: '动机/欲望',      group: '驱动力', rows: 2, defaultFor: ['secondary', 'npc'] },
  { key: 'goals',        label: '目标(短/长期)',  group: '驱动力', rows: 2, defaultFor: ['secondary'] },
  { key: 'innerConflict', label: '核心矛盾/内心冲突', group: '驱动力', rows: 2, defaultFor: [] },
  // 背景
  { key: 'background', label: '背景故事',        group: '背景', rows: 4, defaultFor: ['secondary', 'npc'] },
  { key: 'keyEvents',  label: '关键经历/转折',    group: '背景', rows: 3, defaultFor: [] },
  // 能力
  { key: 'abilities',  label: '能力/金手指',      group: '能力', rows: 2, defaultFor: ['secondary'] },
  { key: 'powerLevel', label: '实力定位/境界',    group: '能力', rows: 1, defaultFor: [] },
  // 鲜活细节
  { key: 'speechStyle',  label: '语言风格/口头禅', group: '鲜活细节', rows: 2, defaultFor: ['npc'] },
  { key: 'habits',       label: '习惯/小动作/癖好', group: '鲜活细节', rows: 2, defaultFor: [] },
  { key: 'signatureItem', label: '标志性物品/符号', group: '鲜活细节', rows: 1, defaultFor: [] },
  // 成长
  { key: 'arc', label: '角色弧光/成长线', group: '成长', rows: 2, defaultFor: ['secondary'] },
  // 剧情功能
  { key: 'storyRole', label: '在故事中的作用', group: '剧情功能', rows: 2, defaultFor: ALL },
  { key: 'ending',    label: '结局走向',        group: '剧情功能', rows: 2, defaultFor: ['extra'] },
]

/** 某戏份默认勾选的维度 key 集（main = 全选）。 */
export function defaultDimensionsForWeight(weight: CharacterRoleWeight): CharacterDimensionKey[] {
  if (weight === 'main') return CHARACTER_DIMENSIONS.map(d => d.key)
  return CHARACTER_DIMENSIONS.filter(d => d.defaultFor.includes(weight)).map(d => d.key)
}

/** 已填(非空)的维度 key 集。 */
export function filledDimensions(c: Character): CharacterDimensionKey[] {
  return CHARACTER_DIMENSIONS.filter(d => typeof c[d.key] === 'string' && c[d.key]!.trim()).map(d => d.key)
}

/** 按分组归类(供面板分组渲染)。 */
export function dimensionsByGroup(): Array<{ group: string; dims: CharacterDimensionSpec[] }> {
  const order: string[] = []
  const map = new Map<string, CharacterDimensionSpec[]>()
  for (const d of CHARACTER_DIMENSIONS) {
    if (!map.has(d.group)) { map.set(d.group, []); order.push(d.group) }
    map.get(d.group)!.push(d)
  }
  return order.map(group => ({ group, dims: map.get(group)! }))
}
