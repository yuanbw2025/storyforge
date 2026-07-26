/**
 * 势力模块类型定义
 *
 * 独立两张表（factions + factionRelations），镜像 characters + characterRelations 模式。
 * 历史：v1 曾有 factions 表，v29 并入 codex.faction 词条后删除；
 * 本次因需表达"势力间关系图 + 势力含角色"的图结构，重新独立两张表。
 */

/** 势力类型 */
export type FactionType =
  | 'nation'        // 国家/政权
  | 'sect'          // 门派/宗门
  | 'guild'         // 公会/行会
  | 'clan'          // 家族/氏族
  | 'organization'  // 组织
  | 'military'      // 军事单位
  | 'religion'      // 宗教/信仰团体
  | 'merchant'      // 商会/财团
  | 'other'         // 其他

/** 势力状态 */
export type FactionStatus =
  | 'rising'      // 崛起中
  | 'peak'        // 鼎盛
  | 'declining'   // 衰落
  | 'destroyed'   // 已覆灭
  | 'hidden'      // 隐秘/暗中存在

/** 势力间关系类型 */
export type FactionRelationType =
  | 'alliance'   // 结盟
  | 'hostile'    // 敌对
  | 'vassal'     // 附庸/从属
  | 'trade'      // 贸易往来
  | 'covert'     // 暗中合作
  | 'rival'      // 竞争
  | 'neutral'    // 中立

/** 势力 */
export interface Faction {
  id?: number
  projectId: number
  worldGroupId: number | null
  name: string
  type: FactionType
  ideology: string              // 核心理念/宗旨
  leader: string                // 首领名（文本，不强制外键）
  memberCharacterIds: number[]  // 成员角色 id 列表（多对多，ArrayRef → characters）
  baseLocation: string         // 根据地
  power: string                 // 实力/势力范围
  resources: string            // 资源/财富
  secret: string                // 隐秘信息（暗线，玩家不可见）
  status: FactionStatus
  color: string                // UI 显示色（hex，关系图节点配色）
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** 势力间关系 */
export interface FactionRelation {
  id?: number
  projectId: number
  fromFactionId: number
  toFactionId: number
  relationType: FactionRelationType
  label: string                 // 关系标签（如"主从""世仇""秘密同盟"）
  description: string
  isBidirectional: boolean
  intensity: number             // 0-100 强度（关系图边粗细）
  createdAt: number
  updatedAt: number
}

export const FACTION_TYPES: { value: FactionType; label: string }[] = [
  { value: 'nation', label: '国家/政权' },
  { value: 'sect', label: '门派/宗门' },
  { value: 'guild', label: '公会/行会' },
  { value: 'clan', label: '家族/氏族' },
  { value: 'organization', label: '组织' },
  { value: 'military', label: '军事单位' },
  { value: 'religion', label: '宗教/信仰' },
  { value: 'merchant', label: '商会/财团' },
  { value: 'other', label: '其他' },
]

export const FACTION_STATUSES: { value: FactionStatus; label: string }[] = [
  { value: 'rising', label: '崛起中' },
  { value: 'peak', label: '鼎盛' },
  { value: 'declining', label: '衰落' },
  { value: 'destroyed', label: '已覆灭' },
  { value: 'hidden', label: '隐秘' },
]

export const FACTION_RELATION_TYPES: { value: FactionRelationType; label: string; color: string }[] = [
  { value: 'alliance', label: '结盟', color: '#22c55e' },
  { value: 'hostile', label: '敌对', color: '#ef4444' },
  { value: 'vassal', label: '附庸', color: '#a855f7' },
  { value: 'trade', label: '贸易', color: '#3b82f6' },
  { value: 'covert', label: '暗中合作', color: '#64748b' },
  { value: 'rival', label: '竞争', color: '#f59e0b' },
  { value: 'neutral', label: '中立', color: '#94a3b8' },
]
