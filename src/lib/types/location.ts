/**
 * Phase 25.3 — 重要地点模块
 * 取代旧的「地理环境」面板，使用多标签组合替代单选下拉
 */

/** 自然地形标签 */
export const TERRAIN_TAGS = [
  '大陆', '半岛', '岛屿', '群岛', '高原', '平原', '盆地', '丘陵',
  '峡谷', '山脉', '山峰', '火山', '戈壁', '沙漠', '冰原', '草原',
  '森林', '雨林', '沼泽', '绿洲', '洞穴', '海洋', '海峡', '海湾',
  '湖泊', '河流', '瀑布', '温泉', '冰川', '浮空岛', '虚空', '异界裂隙',
] as const

/** 人文场所标签 */
export const PLACE_TAGS = [
  '村庄', '城镇', '城市', '都城', '部落', '营地', '关隘', '要塞',
  '军营', '战场', '神殿', '寺庙', '学院', '集市', '酒楼', '拍卖行',
  '黑市', '矿场', '港口', '驿站', '废墟', '遗迹', '古墓', '迷宫',
  '禁地', '秘境', '宗门', '洞府', '灵脉',
] as const

export type TerrainTag = typeof TERRAIN_TAGS[number]
export type PlaceTag = typeof PLACE_TAGS[number]
export type LocationTag = TerrainTag | PlaceTag

/** 所有标签（合并） */
export const ALL_LOCATION_TAGS: readonly LocationTag[] = [...TERRAIN_TAGS, ...PLACE_TAGS]

/** 标签分类信息 */
export const TAG_CATEGORIES = [
  { label: '自然地形', tags: TERRAIN_TAGS, color: '#14b8a6' },
  { label: '人文场所', tags: PLACE_TAGS, color: '#f59e0b' },
] as const

/** 标签对应的 emoji */
export const TAG_EMOJI: Partial<Record<LocationTag, string>> = {
  // 自然
  '大陆': '🌍', '半岛': '🏝️', '岛屿': '🏝️', '群岛': '🏝️',
  '高原': '🏔️', '平原': '🌾', '盆地': '🏞️', '丘陵': '⛰️',
  '峡谷': '🏜️', '山脉': '🏔️', '山峰': '⛰️', '火山': '🌋',
  '戈壁': '🏜️', '沙漠': '🏜️', '冰原': '🧊', '草原': '🌿',
  '森林': '🌲', '雨林': '🌴', '沼泽': '💧', '绿洲': '🌴',
  '洞穴': '🕳️', '海洋': '🌊', '海峡': '🌊', '海湾': '🏖️',
  '湖泊': '💎', '河流': '🏞️', '瀑布': '💦', '温泉': '♨️',
  '冰川': '🧊', '浮空岛': '☁️', '虚空': '🌌', '异界裂隙': '🌀',
  // 人文
  '村庄': '🏘️', '城镇': '🏘️', '城市': '🏙️', '都城': '🏯',
  '部落': '⛺', '营地': '🏕️', '关隘': '🚧', '要塞': '🏰',
  '军营': '⚔️', '战场': '🔥', '神殿': '⛩️', '寺庙': '🛕',
  '学院': '🏫', '集市': '🛒', '酒楼': '🍶', '拍卖行': '🔨',
  '黑市': '🕶️', '矿场': '⛏️', '港口': '⚓', '驿站': '🐴',
  '废墟': '🏚️', '遗迹': '🗿', '古墓': '⚰️', '迷宫': '🌀',
  '禁地': '⛔', '秘境': '✨', '宗门': '🏯', '洞府': '🕳️', '灵脉': '💎',
}

/** 重要地点 */
export interface ImportantLocation {
  id?: number
  projectId: number
  /** 地点名称 */
  name: string
  /** 标签组合（自然地形 + 人文场所可混搭） */
  tags: string            // JSON string: LocationTag[]
  /** 地点描述 */
  description: string
  /** 剧情重要性 / 在故事中的作用 */
  significance: string
  /** 父地点 ID（支持树状层级） */
  parentId: number | null
  /** 同级排序 */
  sortOrder: number
  createdAt: number
  updatedAt: number
}
