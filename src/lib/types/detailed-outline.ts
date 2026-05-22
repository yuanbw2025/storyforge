/**
 * 细纲（DetailedOutline）— v3 §2.1 创作区新模块
 *
 * 大纲（OutlineNode）→ 细纲（DetailedOutline）→ 章节正文（Chapter）
 *
 * 一个章节大纲展开为若干场景（scene），每个场景包含人物、地点、冲突、节奏。
 */

/** 场景节奏标签（用于 AI 写正文时判断笔墨分配） */
export type ScenePace =
  | 'slow'      // 慢节奏：心理/环境描写多
  | 'medium'    // 中节奏：对话/铺垫
  | 'fast'      // 快节奏：冲突/动作
  | 'climax'    // 高潮：决战/反转

/** 场景 */
export interface DetailedScene {
  /** UUID（前端生成） */
  sceneId: string
  title: string
  summary: string             // 一句话场景概要
  characterIds: number[]      // 涉及的角色 id（指向 characters 表）
  location: string            // 发生地点（自由文本，未来可关联 worldview.geography）
  conflict: string            // 本场景的核心冲突
  pace: ScenePace
  estimatedWords: number      // 估算字数
  notes: string               // 作者备注
}

/** 细纲表行 */
export interface DetailedOutline {
  id?: number
  projectId: number
  /** 关联的章节大纲节点（对应 outlineNodes 表中 type='chapter' 的节点） */
  outlineNodeId: number
  /** 场景列表（按顺序） */
  scenes: DetailedScene[]
  createdAt: number
  updatedAt: number
}
