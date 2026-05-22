/** 历史事件 */
export interface HistoricalEvent {
  id: string           // 内部唯一标识
  era: string          // 所属纪元/年代
  date: string         // 具体时间
  title: string        // 事件名称
  description: string  // 事件描述
  impact: string       // 对世界的影响
  order: number        // 时间线排序
}

/** 历史年表 */
export interface History {
  id?: number
  projectId: number
  overview: string         // 历史总述
  eraSystem: string        // 纪年体系描述
  events: string           // HistoricalEvent[] JSON string
  createdAt: number
  updatedAt: number
}
