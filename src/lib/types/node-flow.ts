export interface NodeFlow {
  id?: number
  projectId: number
  worldGroupId?: number | null
  name: string
  description: string
  graphJson: string
  createdAt: number
  updatedAt: number
}

export type NodeRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface NodeRunRecord {
  id?: number
  projectId: number
  flowId: number
  status: NodeRunStatus
  /** 冻结每个节点的实际入参、来源与 token 估算，保证“输入可见”。 */
  inputSnapshotsJson: string
  /** 每个节点的输出、错误与 gate，保证刷新后“输出可见”。 */
  nodeResultsJson: string
  /** FLOW-3E：冻结本次拓扑顺序、调用上限与断点进度，不包含 API Key。 */
  executionPlanJson?: string
  /** FLOW-3E：恢复前校验图版本；只保存编排，不复制 Canon 正文。 */
  graphSnapshotJson?: string
  startedAt: number
  updatedAt: number
  completedAt?: number | null
}
