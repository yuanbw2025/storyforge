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
  createdAt: number
  updatedAt: number
}
