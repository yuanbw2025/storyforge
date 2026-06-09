/**
 * Phase 32 — 真实与幻想（世界规则体系）
 *
 * 三级树结构：L1 大类 → L2 子类 → L3 提示标签
 * 每个节点（L1/L2）可独立设置「📜取自真实 / ✨架空改造 / ⚖️冲突优先」
 * L3 仅作为编辑区的灰色提示，不单独存数据
 */

// ── 冲突优先级 ──────────────────────────────────────────────

export type ConflictPriority = 'historical' | 'fictional' | 'balanced'

export const CONFLICT_PRIORITY_LABELS: Record<ConflictPriority, string> = {
  historical: '史实优先',
  balanced: '均衡',
  fictional: '架空优先',
}

// ── 树节点定义（预定义 + 用户自定义） ──────────────────────────

/** 预定义树节点 */
export interface WorldRuleNodeDef {
  /** 点分 ID，如 'politics', 'politics.central' */
  id: string
  /** 中文标签 */
  label: string
  /** emoji 图标 */
  icon: string
  /** L3 提示标签（仅 L2 节点有） */
  hints?: string[]
  /** 子节点（L1 → L2） */
  children?: WorldRuleNodeDef[]
}

/** 用户自定义节点 */
export interface CustomWorldRuleNode {
  /** 唯一 ID，如 'custom_1694000000000' */
  id: string
  /** 父节点 ID，null = L1 顶级 */
  parentId: string | null
  /** 中文标签 */
  label: string
  /** emoji 图标（可选） */
  icon?: string
  /** L3 提示标签 */
  hints?: string[]
}

// ── 用户填写的节点数据 ────────────────────────────────────────

/** 单节点的用户设定数据 */
export interface WorldRuleEntry {
  /** 📜 取自真实 */
  historicalAnchors: string
  /** ✨ 架空改造 */
  fictionalAdaptations: string
  /** ⚖️ 冲突时优先 */
  priority: ConflictPriority
}

// ── 项目世界规则 Profile（projectId + worldGroupId） ─────────────

export interface WorldRulesProfile {
  id?: number
  projectId: number
  /** 所属世界组；null = 单世界/默认主世界 */
  worldGroupId?: number | null
  /** 节点数据，key = nodeId（预定义或自定义），只存非空节点 */
  entries: Record<string, WorldRuleEntry>
  /** 用户自定义节点列表 */
  customNodes: CustomWorldRuleNode[]
  /** 全局补充说明（对 AI 的额外约束） */
  globalNote?: string
  createdAt: number
  updatedAt: number
}

export type CreateWorldRulesInput = Omit<WorldRulesProfile, 'id' | 'createdAt' | 'updatedAt'>

// ── 预定义三级树 ──────────────────────────────────────────────

export const WORLD_RULE_TREE: WorldRuleNodeDef[] = [
  {
    id: 'era', label: '时代背景', icon: '🕰️',
    children: [
      { id: 'era.period', label: '历史时期', icon: '📜', hints: ['朝代', '纪年', '年号'] },
      { id: 'era.divergence', label: '架空起点', icon: '🦋', hints: ['蝴蝶效应边界', '分岔点', '架空程度'] },
      { id: 'era.calendar', label: '历法时间', icon: '📅', hints: ['历法', '节气', '时辰'] },
    ],
  },
  {
    id: 'events', label: '重大事件', icon: '⚡',
    hints: ['与历史年表联动', '📜史实事件自动成为锚点', '✨虚构事件为作者规划'],
    children: [],
  },
  {
    id: 'geography', label: '地理疆域', icon: '🗺️',
    children: [
      { id: 'geography.admin', label: '行政区划', icon: '📐', hints: ['省/府/州/县', '边疆与内地'] },
      { id: 'geography.terrain', label: '地形地貌', icon: '⛰️', hints: ['山脉', '平原', '盆地', '沙漠', '高原'] },
      { id: 'geography.cities', label: '城市重镇', icon: '🏰', hints: ['都城布局', '军事要塞', '商业都会', '城墙城门'] },
      { id: 'geography.water', label: '水系', icon: '🌊', hints: ['河流', '湖泊', '运河', '漕运路线', '水利工程'] },
      { id: 'geography.roads', label: '道路交通', icon: '🛤️', hints: ['官道', '驿站', '栈道', '关隘', '海路'] },
    ],
  },
  {
    id: 'climate', label: '气候环境', icon: '🌦️',
    children: [
      { id: 'climate.weather', label: '气候特征', icon: '☀️', hints: ['季节', '温度', '降水'] },
      { id: 'climate.disaster', label: '自然灾害', icon: '🌪️', hints: ['旱涝', '地震', '瘟疫', '蝗灾'] },
      { id: 'climate.ecology', label: '生态物种', icon: '🌿', hints: ['动物', '植物', '特殊物产'] },
    ],
  },
  {
    id: 'politics', label: '政治制度', icon: '🏛️',
    children: [
      { id: 'politics.system', label: '政体形态', icon: '👑', hints: ['君主制/共和', '集权程度', '分权制衡'] },
      { id: 'politics.central', label: '中央官制', icon: '📋', hints: ['宰辅', '部院', '寺监', '内阁/军机'] },
      { id: 'politics.local', label: '地方官制', icon: '🏠', hints: ['州牧/刺史/知府', '藩镇', '地方自治'] },
      { id: 'politics.selection', label: '选官制度', icon: '🎓', hints: ['科举', '荐举', '九品中正', '世袭'] },
      { id: 'politics.nobility', label: '爵位封号', icon: '🎖️', hints: ['公侯伯子男', '封国', '食邑'] },
      { id: 'politics.law', label: '法律刑罚', icon: '⚖️', hints: ['律令格式', '刑罚种类', '审判流程', '监狱'] },
      { id: 'politics.diplomacy', label: '外交', icon: '🤝', hints: ['朝贡', '邦交', '和亲', '质子', '国书'] },
    ],
  },
  {
    id: 'military', label: '军事', icon: '⚔️',
    children: [
      { id: 'military.organization', label: '军制编制', icon: '🪖', hints: ['兵种', '军衔', '编制单位', '府兵/募兵'] },
      { id: 'military.weapons', label: '武器装备', icon: '🗡️', hints: ['兵器', '铠甲', '攻城器械'] },
      { id: 'military.tactics', label: '战术战法', icon: '🗺️', hints: ['阵法', '骑兵/步兵/水师', '攻城/守城'] },
      { id: 'military.fortification', label: '防御工事', icon: '🏰', hints: ['城池', '关隘', '长城', '烽燧', '堡寨'] },
    ],
  },
  {
    id: 'economy', label: '经济', icon: '💰',
    children: [
      { id: 'economy.tax', label: '赋税制度', icon: '📊', hints: ['田赋', '徭役', '商税', '两税法/一条鞭法'] },
      { id: 'economy.currency', label: '货币金融', icon: '🪙', hints: ['铜钱', '银两', '纸钞', '钱庄', '飞钱'] },
      { id: 'economy.trade', label: '商业贸易', icon: '🏪', hints: ['坊市', '行商坐贾', '丝路/海贸', '行会'] },
      { id: 'economy.agriculture', label: '农业', icon: '🌾', hints: ['耕作方式', '作物种类', '灌溉', '田制'] },
      { id: 'economy.crafts', label: '手工业', icon: '🔨', hints: ['织造', '冶炼', '陶瓷', '造纸', '印刷'] },
      { id: 'economy.resources', label: '资源物产', icon: '💎', hints: ['盐铁茶马', '矿产', '地方特产', '战略物资'] },
    ],
  },
  {
    id: 'society', label: '社会结构', icon: '👥',
    children: [
      { id: 'society.hierarchy', label: '阶层等级', icon: '📶', hints: ['士农工商', '贵族/平民/贱民', '社会流动性'] },
      { id: 'society.clan', label: '宗族家族', icon: '🏠', hints: ['家谱', '祠堂', '嫡庶/长幼', '分家/继承'] },
      { id: 'society.gender', label: '性别秩序', icon: '⚤', hints: ['婚嫁制度', '贞操观', '女性地位'] },
      { id: 'society.servitude', label: '依附关系', icon: '🔗', hints: ['奴婢', '佃户', '家仆', '人身依附'] },
      { id: 'society.organizations', label: '民间组织', icon: '🤫', hints: ['帮会', '秘密社团', '商帮', '会馆'] },
    ],
  },
  {
    id: 'technology', label: '科技生产力', icon: '⚙️',
    children: [
      { id: 'technology.engineering', label: '工程建筑', icon: '🏗️', hints: ['建筑', '桥梁', '水利', '营造法式'] },
      { id: 'technology.medicine', label: '医药', icon: '🏥', hints: ['医学体系', '药材', '瘟疫防治', '巫医'] },
      { id: 'technology.astronomy', label: '天文历算', icon: '🔭', hints: ['星象', '占卜', '数学', '历法编制'] },
      { id: 'technology.transport', label: '交通工具', icon: '🚢', hints: ['车马', '船舶', '轿子', '造船技术'] },
      { id: 'technology.communication', label: '通信', icon: '📨', hints: ['驿传', '烽火', '飞鸽', '信使'] },
      { id: 'technology.tools', label: '生产工具', icon: '🔧', hints: ['农具', '纺织机', '冶炼炉', '技术边界'] },
    ],
  },
  {
    id: 'culture', label: '文化思想', icon: '📚',
    children: [
      { id: 'culture.philosophy', label: '主流思想', icon: '🧠', hints: ['儒', '释', '道', '法', '墨', '理学/心学'] },
      { id: 'culture.arts', label: '文学艺术', icon: '🎨', hints: ['诗词', '话本', '戏曲', '书画', '音乐'] },
      { id: 'culture.education', label: '教育', icon: '🎓', hints: ['私塾', '官学', '书院', '太学', '典籍'] },
    ],
  },
  {
    id: 'religion', label: '宗教信仰', icon: '🙏',
    children: [
      { id: 'religion.official', label: '官方宗教', icon: '⛪', hints: ['国教', '祭天', '宗庙', '宗教政策'] },
      { id: 'religion.folk', label: '民间信仰', icon: '🏮', hints: ['土地', '灶神', '妈祖', '关帝', '祈福禳灾'] },
      { id: 'religion.funeral', label: '丧葬祭祀', icon: '🪦', hints: ['葬制', '祭祖', '招魂', '忌日', '陵墓'] },
      { id: 'religion.taboo', label: '禁忌避讳', icon: '🚫', hints: ['名讳', '字号', '文字狱', '吉凶观念'] },
    ],
  },
  {
    id: 'ethnicity', label: '民族族群', icon: '🌏',
    children: [
      { id: 'ethnicity.main', label: '主体民族', icon: '🏘️', hints: ['民族特征', '文化认同'] },
      { id: 'ethnicity.neighbors', label: '周边民族', icon: '🏕️', hints: ['游牧/渔猎', '华夷关系'] },
      { id: 'ethnicity.interaction', label: '民族互动', icon: '🔄', hints: ['战争', '融合', '同化', '边疆政策'] },
      { id: 'ethnicity.foreign', label: '外国势力', icon: '🌐', hints: ['外来文化', '传教士', '通商'] },
    ],
  },
  {
    id: 'language', label: '语言称谓', icon: '💬',
    children: [
      { id: 'language.spoken', label: '口语风格', icon: '🗣️', hints: ['时代语感', '方言', '雅俗分野'] },
      { id: 'language.titles', label: '称谓体系', icon: '📛', hints: ['官职称呼', '亲属称谓', '自称/敬称/贱称'] },
      { id: 'language.written', label: '书面语', icon: '✒️', hints: ['文言/白话', '奏折/公文/信函格式'] },
      { id: 'language.taboo', label: '忌讳用语', icon: '🤐', hints: ['避讳字', '委婉语', '时代特有表达'] },
    ],
  },
  {
    id: 'daily', label: '日常生活', icon: '🍵',
    children: [
      { id: 'daily.food', label: '饮食', icon: '🍜', hints: ['主食', '菜肴', '饮品', '烹饪方式', '饮食礼仪'] },
      { id: 'daily.clothing', label: '服饰', icon: '👘', hints: ['材质', '款式', '颜色', '等级标识'] },
      { id: 'daily.housing', label: '居住', icon: '🏠', hints: ['民居', '府邸', '宫殿', '客栈', '家具'] },
      { id: 'daily.travel', label: '出行', icon: '🐎', hints: ['日常交通', '出行礼仪', '路费盘缠'] },
      { id: 'daily.measures', label: '度量衡', icon: '📏', hints: ['长度', '重量', '容量', '货币换算'] },
      { id: 'daily.time', label: '时间观念', icon: '⏳', hints: ['十二时辰', '更鼓', '日出而作'] },
      { id: 'daily.entertainment', label: '娱乐', icon: '🎲', hints: ['棋牌', '蹴鞠', '斗鸡', '宴饮'] },
      { id: 'daily.festivals', label: '节庆', icon: '🎊', hints: ['春节', '清明', '端午', '中秋', '重阳'] },
      { id: 'daily.etiquette', label: '社交礼仪', icon: '🎩', hints: ['拜帖', '宴请', '送礼', '官场/民间礼仪'] },
    ],
  },
  {
    id: 'supernatural', label: '力量与超自然', icon: '✨',
    children: [
      { id: 'supernatural.system', label: '力量体系', icon: '🔥', hints: ['修炼等级', '规则限制', '晋升路径'] },
      { id: 'supernatural.beings', label: '超自然存在', icon: '👹', hints: ['神明', '妖魔', '鬼怪', '仙人'] },
      { id: 'supernatural.artifacts', label: '灵材法器', icon: '💎', hints: ['法宝', '丹药', '灵石', '阵法'] },
      { id: 'supernatural.impact', label: '力量与社会', icon: '⚡', hints: ['修士vs凡人', '力量vs权力', '管理制度'] },
    ],
  },
]

// ── 辅助函数 ──────────────────────────────────────────────────

/** 获取所有预定义节点的 ID 列表（含 L1 + L2） */
export function getAllPredefinedIds(): string[] {
  const ids: string[] = []
  for (const l1 of WORLD_RULE_TREE) {
    ids.push(l1.id)
    if (l1.children) {
      for (const l2 of l1.children) {
        ids.push(l2.id)
      }
    }
  }
  return ids
}

/** 判断一个 entry 是否为空（两个文本都为空） */
export function isEntryEmpty(entry: WorldRuleEntry | undefined): boolean {
  if (!entry) return true
  return !entry.historicalAnchors.trim() && !entry.fictionalAdaptations.trim()
}

/** 统计已填节点数 */
export function countFilledEntries(entries: Record<string, WorldRuleEntry>): number {
  return Object.values(entries).filter(e => !isEntryEmpty(e)).length
}

/** 创建空的 entry */
export function createEmptyEntry(): WorldRuleEntry {
  return { historicalAnchors: '', fictionalAdaptations: '', priority: 'balanced' }
}

/** 创建空的 profile */
export function createEmptyProfile(projectId: number): CreateWorldRulesInput {
  return {
    projectId,
    entries: {},
    customNodes: [],
    globalNote: '',
  }
}
