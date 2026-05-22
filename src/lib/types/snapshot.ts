/** 项目快照 — 自动/手动备份 */
export interface Snapshot {
  id?: number
  projectId: number
  /** 快照名称（自动备份 / 手动命名） */
  label: string
  /** 快照类型 */
  type: 'auto' | 'manual'
  /** 序列化后的完整项目数据（JSON string） */
  data: string
  /** 数据大小（字节） */
  size: number
  createdAt: number
}
