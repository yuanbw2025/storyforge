/** 世界观 */
export interface Worldview {
  id?: number
  projectId: number
  geography: string       // 地理环境
  history: string         // 历史年表
  society: string         // 社会结构
  culture: string         // 文化宗教
  economy: string         // 经济体系
  rules: string           // 世界规则/物理法则
  summary: string         // 世界观精华摘要（用于 AI 上下文）
  createdAt: number
  updatedAt: number
}

/** 故事核心 */
export interface StoryCore {
  id?: number
  projectId: number
  theme: string           // 主题
  centralConflict: string // 核心冲突
  plotPattern: string     // 情节模式
  storyLines: string      // 故事线
  createdAt: number
  updatedAt: number
}

/** 力量体系 */
export interface PowerSystem {
  id?: number
  projectId: number
  name: string            // 体系名称
  description: string     // 体系描述
  levels: string          // 等级列表（JSON string）
  rules: string           // 体系规则
  createdAt: number
  updatedAt: number
}
