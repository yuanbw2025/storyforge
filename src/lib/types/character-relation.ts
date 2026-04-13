/** 角色关系类型 */
export type RelationType =
  | 'family'       // 亲属
  | 'lover'        // 恋人
  | 'friend'       // 朋友
  | 'rival'        // 对手
  | 'enemy'        // 敌人
  | 'master'       // 师徒（师）
  | 'student'      // 师徒（徒）
  | 'ally'         // 盟友
  | 'subordinate'  // 上下级
  | 'other'        // 其他

/** 角色关系 */
export interface CharacterRelation {
  id?: number
  projectId: number
  fromCharacterId: number   // 角色 A
  toCharacterId: number     // 角色 B
  relationType: RelationType
  label: string             // 关系标签（如"父子"、"宿敌"）
  description: string       // 详细描述
  isBidirectional: boolean  // 是否双向关系
  createdAt: number
  updatedAt: number
}
