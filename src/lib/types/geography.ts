/** 地点类型 */
export type LocationType =
  | 'continent'   // 大陆
  | 'country'     // 国家
  | 'city'        // 城市
  | 'sect'        // 门派驻地
  | 'secret'      // 秘境
  | 'ruin'        // 遗迹
  | 'battlefield' // 战场
  | 'nature'      // 自然景观
  | 'building'    // 建筑
  | 'other'       // 其他

/** 地点 */
export interface Location {
  id: string           // 内部唯一标识（uuid-like）
  name: string
  type: LocationType
  description: string
  significance: string  // 剧情重要性
  parentId: string | null  // 上级地点 ID（层级关系）
  order: number
}

/** 地理环境 */
export interface Geography {
  id?: number
  projectId: number
  overview: string          // 世界地理总述
  locations: string         // Location[] JSON string
  worldMapData?: string     // WorldMapData JSON string（Phase 20）
  createdAt: number
  updatedAt: number
}

// ── 多世界 / 世界树 ──────────────────────────────────

/** 传送门/通道：连接两个世界 */
export interface WorldPortal {
  /** 传送门名称 */
  name: string
  /** 目标世界节点 ID */
  targetWorldId: number
  /** 在本世界地图上的 x 坐标 */
  x: number
  /** 在本世界地图上的 y 坐标 */
  y: number
  /** 描述 */
  description?: string
}

/** 世界节点 — 世界树中的一个世界/位面 */
export interface WorldNode {
  id?: number
  /** 所属项目 */
  projectId: number
  /** 父世界 ID（null = 根世界） */
  parentId: number | null
  /** 世界名称 */
  name: string
  /** 世界描述 */
  description: string
  /** 该世界独立的地图配置 JSON（MapGenConfig） */
  mapConfigJSON?: string
  /** 已生成的地图数据缓存 JSON（VoronoiMapData 的序列化，不含 TypedArray） */
  mapCacheJSON?: string
  /** 传送门列表 JSON（WorldPortal[]） */
  portalsJSON?: string
  /** 同级排序 */
  sortOrder: number
  /** 图标 emoji */
  icon?: string
  createdAt: number
  updatedAt: number
}
