/** 角色定位 */
export type CharacterRole =
  | 'protagonist'    // 主角
  | 'antagonist'     // 反派
  | 'supporting'     // 重要配角
  | 'minor'          // 次要角色

/** 角色 */
export interface Character {
  id?: number
  projectId: number
  name: string
  role: CharacterRole
  shortDescription: string   // 一句话简介
  appearance: string         // 外貌
  personality: string        // 性格
  background: string         // 背景故事
  motivation: string         // 动机
  abilities: string          // 能力
  relationships: string      // 关系描述（JSON string）
  arc: string                // 角色弧光/成长线
  createdAt: number
  updatedAt: number
}

/** 势力 */
export interface Faction {
  id?: number
  projectId: number
  name: string
  description: string
  leader: string             // 领导者
  members: string            // 核心成员
  goals: string              // 目标
  resources: string          // 资源/实力
  relationships: string      // 与其他势力关系
  createdAt: number
  updatedAt: number
}
