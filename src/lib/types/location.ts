import type { NarrativeDomainMetadataV1, NarrativeDomainFieldsV1 } from './narrative-domain'
import type { RagDocumentMetadata } from './rag-library'

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

/** A bad persisted value remains available for explicit author repair. */
export class LocationTagsParseError extends Error {
  constructor(message: string) {
    super(`tags：${message}`)
    this.name = 'LocationTagsParseError'
  }
}

/** Shared domain shape for model arrays and decoded storage; never rewrites it. */
export function parseLocationTagsV1(value: unknown): LocationTag[] {
  if (!Array.isArray(value)) throw new LocationTagsParseError('必须是地点标签数组。')
  const allowed = new Set<string>(ALL_LOCATION_TAGS)
  for (const tag of value) if (typeof tag !== 'string' || !allowed.has(tag)) {
    throw new LocationTagsParseError('包含非字符串或未登记标签。')
  }
  if (new Set(value).size !== value.length) throw new LocationTagsParseError('标签重复。')
  return [...value] as LocationTag[]
}

/** Stored/portable tags are an exact JSON string, including the valid empty []. */
export function readLocationTagsV1(value: unknown): LocationTag[] {
  if (typeof value !== 'string') throw new LocationTagsParseError('存储值必须是 JSON 字符串。')
  let decoded: unknown
  try { decoded = JSON.parse(value) }
  catch { throw new LocationTagsParseError('不是有效 JSON，原值已保留。') }
  return parseLocationTagsV1(decoded)
}

/** Legacy rows may omit tags. Reading that absence never fills or repairs storage. */
export function readLocationRecordTagsV1(record: object): LocationTag[] {
  return Object.prototype.hasOwnProperty.call(record, 'tags') ? readLocationTagsV1(Reflect.get(record, 'tags')) : []
}

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
type ImportantLocationNarrativeFieldsV1 = NarrativeDomainMetadataV1 & Pick<NarrativeDomainFieldsV1, 'narrativeAliasesV1'>

export interface ImportantLocation extends RagDocumentMetadata, ImportantLocationNarrativeFieldsV1 {
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
