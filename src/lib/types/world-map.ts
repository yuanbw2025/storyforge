/** 二维坐标点 */
export type Point2D = [number, number]

/** 地形类型 */
export type TerrainType =
  | 'ocean' | 'deepocean' | 'coast'
  | 'plains' | 'forest' | 'dense-forest'
  | 'desert' | 'tundra' | 'swamp' | 'mountain-region'
  | 'hills' | 'volcanic' | 'ice' | 'grassland'

/** 地图区域（大陆/海洋/子区域）— 用不规则多边形定义 */
export interface MapRegion {
  id: string
  name: string
  type: TerrainType
  /** 不规则多边形顶点坐标（顺时针） */
  polygon: Point2D[]
  /** 填充色 */
  color: string
  /** 是否为大陆级（影响渲染层级） */
  isContinent?: boolean
  /** 区域层级：0=海洋底层 1=大陆 2=子区域 */
  zIndex: number
}

/** 山脉 */
export interface MapMountainRange {
  id: string
  name: string
  /** 山脊线路径点 */
  ridgeLine: Point2D[]
  /** 山脉宽度（像素） */
  width: number
  /** 高度等级影响山峰绘制 */
  height: 'low' | 'medium' | 'high' | 'epic'
}

/** 河流 */
export interface MapRiver {
  id: string
  name: string
  /** 河流路径点（贝塞尔控制点） */
  path: Point2D[]
  /** 河宽（像素） */
  width: number
  /** 是否为暗河/地下河（虚线） */
  underground?: boolean
  /** 支流 */
  tributaries?: { path: Point2D[]; width: number }[]
}

/** 道路/商路 */
export interface MapRoad {
  id: string
  name: string
  path: Point2D[]
  type: 'major' | 'minor' | 'trade' | 'ancient'
}

/** 城市/标记点类型 */
export type MarkerType =
  | 'capital' | 'city' | 'town' | 'village'
  | 'sect' | 'fortress' | 'port' | 'academy'
  | 'ruin' | 'dungeon' | 'oasis' | 'bridge'
  | 'lighthouse' | 'mine' | 'shrine' | 'custom'

/** 城市/标记点 */
export interface MapMarker {
  id: string
  name: string
  x: number
  y: number
  type: MarkerType
  /** 所属势力/阵营 */
  faction?: string
  /** 简短说明 */
  note?: string
  /** 图标 emoji（可自定义） */
  icon?: string
  /** 重要度 1-5（影响图标大小和文字显示） */
  importance: number
  /** 是否为用户手动添加 */
  userAdded?: boolean
}

/** 文字标注（区域名、海洋名等） */
export interface MapLabel {
  id: string
  text: string
  x: number
  y: number
  fontSize: number
  color: string
  rotation?: number
  fontStyle?: 'normal' | 'italic'
}

/** 世界地图完整数据 */
export interface WorldMapData {
  /** 地图标题 */
  title: string
  /** Canvas 宽度 */
  width: number
  /** Canvas 高度 */
  height: number
  /** 区域（海洋 + 大陆 + 子地形） */
  regions: MapRegion[]
  /** 山脉 */
  mountains: MapMountainRange[]
  /** 河流 */
  rivers: MapRiver[]
  /** 道路 */
  roads: MapRoad[]
  /** 城市/标记点 */
  markers: MapMarker[]
  /** 文字标注 */
  labels: MapLabel[]
  /** 地图版本号 */
  version: number
  /** 上次 AI 生成时的输入文本指纹 */
  sourceHash?: string
}
