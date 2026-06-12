/**
 * Phase 35-a — 词条系统（Codex）数据模型
 *
 * 设计见 docs/CODEX-REDESIGN.md 第三章。
 * 用「通用词条表 + 分类树 + 字段 schema」承载自然物产/人工器物/种族/势力/城池等可枚举实体，
 * 取代分散的自由文本字段；天然支持用户自定义分类与字段。
 */

/** 词条所属领域 */
export type CodexDomain = 'natural' | 'humanity' | 'origin'

export const CODEX_DOMAIN_LABELS: Record<CodexDomain, string> = {
  natural: '自然环境',
  humanity: '人文环境',
  origin: '世界起源',
}

/** 字段类型 */
export type CodexFieldType = 'text' | 'longtext' | 'select' | 'number' | 'ref'

/** 字段定义（驱动词条详情表单的渲染） */
export interface CodexFieldDef {
  /** 内部键 */
  key: string
  /** 显示名（外观/品级/功效…） */
  label: string
  type: CodexFieldType
  /** select 选项 */
  options?: string[]
  /** ref 字段：建议指向哪类词条的 builtInKey（软提示，选择器仍可跨类） */
  refCategory?: string
  /** ref 字段是否允许多选（默认 true） */
  refMulti?: boolean
  required?: boolean
  /** 占位/说明 */
  placeholder?: string
}

/** 内置分类稳定标识 */
export type BuiltInCodexKey =
  | 'mineral'   // 矿物灵材
  | 'herb'      // 灵植草药
  | 'beast'     // 灵兽异兽
  | 'race'      // 种族民族
  | 'faction'   // 势力
  | 'city'      // 城池重镇
  | 'artifact'  // 人工器物
  // 世界观各方面的"全貌+词条"分类（每个面板子页一个）
  | 'natStructure' | 'natDimension' | 'natTerrain' | 'natWater' | 'natClimate' // 自然环境各方面
  | 'humEra' | 'humEvent' | 'humSociety' | 'humConflict'                       // 人文环境各方面
  | 'originPower' | 'originDeity'                                              // 世界起源:力量体系/神明信仰

/** 词条分类（树状，内置 + 用户自定义） */
export interface CodexCategory {
  id?: number
  projectId: number
  domain: CodexDomain
  /** 父分类 id（null = 顶层大类）；支持多级大类→小类 */
  parentId: number | null
  name: string
  icon?: string
  /** 内置分类的稳定标识（自定义分类为 undefined）；用于代码识别内置类 */
  builtInKey?: BuiltInCodexKey
  /** 该分类下词条的字段 schema（CodexFieldDef[] 序列化） */
  fieldSchema: string
  /** 是否隐藏（内置分类不可删，但可隐藏） */
  hidden?: boolean
  order: number
  /** 多世界：所属世界组（null = 主世界/单世界） */
  worldGroupId?: number | null
  createdAt: number
  updatedAt: number
}

/** 一条词条 */
export interface CodexEntry {
  id?: number
  projectId: number
  categoryId: number
  name: string
  icon?: string
  /** 一句话简介 */
  summary: string
  /** 详细描述（自由文本） */
  description: string
  /** 按所属分类 fieldSchema 填的结构化字段（JSON：{ [key]: string }） */
  fields: string
  /** 与其它词条的关联（JSON：{ [fieldKey]: entryId[] }） */
  refs?: string
  /**
   * 重要度星级（1-5）。主要用于「地点」类词条标记重要程度，
   * 也可用于任意词条。未设/0 表示未标记。非索引字段，零 DB 迁移。
   */
  importance?: number
  order: number
  worldGroupId?: number | null
  createdAt: number
  updatedAt: number
}

// ── 工具函数 ──────────────────────────────────────────────────

export function parseFieldSchema(json: string | undefined): CodexFieldDef[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function stringifyFieldSchema(defs: CodexFieldDef[]): string {
  return JSON.stringify(defs)
}

export function parseEntryFields(json: string | undefined): Record<string, string> {
  if (!json) return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function stringifyEntryFields(fields: Record<string, string>): string {
  return JSON.stringify(fields)
}

export function parseEntryRefs(json: string | undefined): Record<string, number[]> {
  if (!json) return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function stringifyEntryRefs(refs: Record<string, number[]>): string {
  return JSON.stringify(refs)
}

// ── 内置分类与字段 schema（预置 seed，见设计文档 3.2） ──────────────

/** 内置分类的种子定义（不含 projectId/时间，落库时补全） */
export interface BuiltInCategorySeed {
  domain: CodexDomain
  builtInKey: BuiltInCodexKey
  name: string
  icon: string
  fields: CodexFieldDef[]
}

const PIN_JI_OPTIONS = ['凡品', '下品', '中品', '上品', '极品', '神品']

export const BUILTIN_CATEGORIES: BuiltInCategorySeed[] = [
  // ── 自然环境 ──
  {
    domain: 'natural', builtInKey: 'mineral', name: '矿物灵材', icon: '⛏️',
    fields: [
      { key: 'appearance', label: '外观', type: 'longtext', placeholder: '形状 / 颜色 / 质感' },
      { key: 'rank', label: '品级品阶', type: 'select', options: PIN_JI_OPTIONS },
      { key: 'effect', label: '功效作用', type: 'longtext' },
      { key: 'origin', label: '产地分布', type: 'text' },
      { key: 'rarity', label: '稀有度', type: 'select', options: ['常见', '稀少', '罕见', '珍稀', '绝世'] },
      { key: 'craftInto', label: '可炼器物', type: 'ref', refCategory: 'artifact', refMulti: true },
    ],
  },
  {
    domain: 'natural', builtInKey: 'herb', name: '灵植草药', icon: '🌿',
    fields: [
      { key: 'form', label: '形态', type: 'longtext' },
      { key: 'effect', label: '药效', type: 'longtext' },
      { key: 'rank', label: '品级', type: 'select', options: PIN_JI_OPTIONS },
      { key: 'habitat', label: '生长环境', type: 'text' },
      { key: 'maturity', label: '成熟周期', type: 'text' },
      { key: 'difficulty', label: '采集难度', type: 'select', options: ['容易', '一般', '困难', '极难'] },
      { key: 'craftInto', label: '可炼丹药', type: 'ref', refCategory: 'artifact', refMulti: true },
    ],
  },
  {
    domain: 'natural', builtInKey: 'beast', name: '灵兽异兽', icon: '🐅',
    fields: [
      { key: 'kind', label: '类别', type: 'select', options: ['走兽', '飞禽', '水族', '虫豸', '异种'] },
      // Phase 37 修炼体系落地后升级为 ref→cultivationSystems；当前以文本占位
      { key: 'cultivation', label: '修炼体系', type: 'text', placeholder: '所属修炼体系（Phase 37 后可关联）' },
      { key: 'realm', label: '当前境界', type: 'text' },
      { key: 'body', label: '体型外貌', type: 'longtext' },
      { key: 'habit', label: '习性性情', type: 'longtext' },
      { key: 'habitat', label: '栖息地', type: 'text' },
      { key: 'threat', label: '威胁等级', type: 'select', options: ['无害', '低危', '中危', '高危', '毁灭级'] },
      { key: 'ability', label: '特殊能力', type: 'longtext' },
      { key: 'drops', label: '可产出材料', type: 'ref', refCategory: 'artifact', refMulti: true },
    ],
  },
  // ── 人文环境 ──
  {
    domain: 'humanity', builtInKey: 'race', name: '种族民族', icon: '🧬',
    fields: [
      { key: 'appearance', label: '外貌特征', type: 'longtext' },
      { key: 'talent', label: '种族天赋', type: 'longtext' },
      { key: 'lifespan', label: '平均寿命', type: 'text' },
      { key: 'population', label: '人口规模', type: 'text' },
      { key: 'settlement', label: '聚居地', type: 'text' },
      { key: 'custom', label: '文化习俗', type: 'longtext' },
      { key: 'faith', label: '信仰', type: 'text' },
      { key: 'relations', label: '与其他种族关系', type: 'longtext' },
      { key: 'representatives', label: '代表人物', type: 'text' },
    ],
  },
  {
    domain: 'humanity', builtInKey: 'faction', name: '势力', icon: '⚔️',
    fields: [
      { key: 'type', label: '类型', type: 'select', options: ['门派', '朝廷', '商会', '部落', '教派', '世家', '其他'] },
      { key: 'territory', label: '势力范围', type: 'text' },
      { key: 'leader', label: '领导者', type: 'text' },
      { key: 'coreMembers', label: '核心成员', type: 'longtext' },
      { key: 'power', label: '实力等级', type: 'text' },
      { key: 'goal', label: '宗旨目标', type: 'longtext' },
      { key: 'relations', label: '敌友关系', type: 'longtext' },
      { key: 'banner', label: '标志旗帜', type: 'text' },
      { key: 'mapRegion', label: '绑定地图区域', type: 'text' },
      { key: 'color', label: '颜色', type: 'text', placeholder: '如 #C17D5E' },
    ],
  },
  {
    domain: 'humanity', builtInKey: 'city', name: '城池重镇', icon: '🏰',
    fields: [
      { key: 'faction', label: '所属势力', type: 'ref', refCategory: 'faction', refMulti: false },
      // Phase 联动后升级为 ref→importantLocations；当前文本占位
      { key: 'location', label: '地理位置', type: 'text', placeholder: '可关联「重要地点」（后续升级）' },
      { key: 'scale', label: '规模人口', type: 'text' },
      { key: 'ruler', label: '统治者', type: 'text' },
      { key: 'economy', label: '经济特产', type: 'longtext' },
      { key: 'strategic', label: '战略地位', type: 'longtext' },
      { key: 'style', label: '城市风貌', type: 'longtext' },
      { key: 'landmark', label: '地标建筑', type: 'text' },
    ],
  },
  {
    domain: 'humanity', builtInKey: 'artifact', name: '人工器物', icon: '🗡️',
    fields: [
      { key: 'type', label: '类别', type: 'select', options: ['武器', '防具', '法器', '丹药', '功法秘籍', '阵法', '材料', '其他'] },
      { key: 'rank', label: '品级品阶', type: 'select', options: PIN_JI_OPTIONS },
      { key: 'appearance', label: '外观', type: 'longtext' },
      { key: 'effect', label: '能力效果', type: 'longtext' },
      { key: 'craft', label: '炼制方式', type: 'longtext' },
      { key: 'materials', label: '所需材料', type: 'ref', refCategory: 'mineral', refMulti: true },
      { key: 'origin', label: '来历', type: 'longtext' },
      { key: 'owner', label: '当前持有者', type: 'text' },
    ],
  },

  // ── 自然环境各方面（全貌写在面板字段,这里逐条细化具体词条） ──
  {
    domain: 'natural', builtInKey: 'natStructure', name: '世界结构', icon: '🌐',
    fields: [
      { key: 'type', label: '层级类型', type: 'text', placeholder: '如 星球 / 大陆 / 位面 / 平行空间' },
      { key: 'scope', label: '范围', type: 'text' },
      { key: 'feature', label: '特征说明', type: 'longtext' },
    ],
  },
  {
    domain: 'natural', builtInKey: 'natDimension', name: '疆域版图', icon: '📐',
    fields: [
      { key: 'scale', label: '尺度范围', type: 'text' },
      { key: 'feature', label: '区域特征', type: 'longtext' },
    ],
  },
  {
    domain: 'natural', builtInKey: 'natTerrain', name: '地貌', icon: '🗺️',
    fields: [
      { key: 'type', label: '类型', type: 'select', options: ['大陆', '山脉', '高原', '平原', '盆地', '丘陵', '峡谷', '沙漠', '森林', '其他'] },
      { key: 'location', label: '位置', type: 'text' },
      { key: 'feature', label: '地形特征', type: 'longtext' },
    ],
  },
  {
    domain: 'natural', builtInKey: 'natWater', name: '山川水系', icon: '⛰️',
    fields: [
      { key: 'type', label: '类型', type: 'select', options: ['山脉', '山峰', '河流', '湖泊', '海洋', '运河', '瀑布', '其他'] },
      { key: 'scale', label: '规模', type: 'text' },
      { key: 'feature', label: '特征', type: 'longtext' },
    ],
  },
  {
    domain: 'natural', builtInKey: 'natClimate', name: '气候带', icon: '🌦️',
    fields: [
      { key: 'region', label: '所在区域', type: 'text' },
      { key: 'type', label: '气候类型', type: 'text', placeholder: '如 温带 / 苦寒 / 湿热' },
      { key: 'hazard', label: '季节/自然灾害', type: 'longtext' },
    ],
  },

  // ── 人文环境各方面 ──
  {
    domain: 'humanity', builtInKey: 'humEra', name: '历史时代', icon: '📜',
    fields: [
      { key: 'period', label: '时间/纪年', type: 'text' },
      { key: 'feature', label: '时代特征/大事', type: 'longtext' },
    ],
  },
  {
    domain: 'humanity', builtInKey: 'humEvent', name: '重大事件', icon: '📅',
    fields: [
      { key: 'type', label: '类型', type: 'select', options: ['战争', '王朝兴替', '灾劫', '变法', '发现', '其他'] },
      { key: 'time', label: '发生时间', type: 'text' },
      { key: 'impact', label: '影响', type: 'longtext' },
    ],
  },
  {
    domain: 'humanity', builtInKey: 'humSociety', name: '政经文化', icon: '🏛️',
    fields: [
      { key: 'type', label: '类别', type: 'select', options: ['政体', '货币', '赋税', '阶层制度', '宗教信仰', '风俗节庆', '其他'] },
      { key: 'detail', label: '说明', type: 'longtext' },
    ],
  },
  {
    domain: 'humanity', builtInKey: 'humConflict', name: '矛盾冲突', icon: '🔥',
    fields: [
      { key: 'type', label: '类型', type: 'text', placeholder: '如 阶级 / 种族 / 信仰 / 资源' },
      { key: 'sides', label: '对立方', type: 'text' },
      { key: 'tension', label: '张力/根源', type: 'longtext' },
    ],
  },

  // ── 世界起源：力量体系 / 神明信仰 ──
  {
    domain: 'origin', builtInKey: 'originPower', name: '力量层级', icon: '⚡',
    fields: [
      { key: 'rank', label: '等级/层级', type: 'text' },
      { key: 'mark', label: '核心标志', type: 'longtext' },
      { key: 'condition', label: '晋升条件', type: 'longtext' },
    ],
  },
  {
    domain: 'origin', builtInKey: 'originDeity', name: '神明信仰', icon: '🌟',
    fields: [
      { key: 'type', label: '类型', type: 'select', options: ['主神', '次神', '半神', '国教', '民间信仰', '邪神', '其他'] },
      { key: 'title', label: '名号/职司', type: 'text' },
      { key: 'rule', label: '规则/禁忌', type: 'longtext' },
    ],
  },
]

/** 通用字段标签（所有词条共有，固定在表单顶部，不进 fieldSchema） */
export const CODEX_COMMON_LABELS = {
  name: '名称',
  icon: '图标',
  summary: '一句话简介',
  description: '详细描述',
}
