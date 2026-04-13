/** 道具类型 */
export type ItemType =
  | 'weapon'    // 武器
  | 'armor'     // 防具
  | 'artifact'  // 法宝
  | 'pill'      // 丹药
  | 'material'  // 材料
  | 'manual'    // 功法秘籍
  | 'formation' // 阵法
  | 'special'   // 特殊物品
  | 'other'     // 其他

/** 单个道具 */
export interface Item {
  id: string           // 内部唯一标识
  name: string
  type: ItemType
  rank: string         // 品级/等级
  description: string
  abilities: string    // 能力/效果
  origin: string       // 来历
  owner: string        // 当前持有者
  significance: string // 剧情重要性
  order: number
}

/** 道具系统 */
export interface ItemSystem {
  id?: number
  projectId: number
  overview: string         // 道具体系总述
  items: string            // Item[] JSON string
  createdAt: number
  updatedAt: number
}
