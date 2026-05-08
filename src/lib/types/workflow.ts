/**
 * 提示词工作流（PromptWorkflow）— v3 §3.7
 *
 * 用户的真实创作流程是链式的：
 *   想法 → 故事核心 → 世界观 → 卷大纲 → 章节大纲 → 章节正文 → 润色
 *
 * 工作流让用户一键跑完整条链，每步可以审核 / 修改 / 跳过 / 重生成。
 */
import type { PromptModuleKey } from './prompt'

/**
 * 步骤输出的"自动写回"目标（Phase 17）
 *
 * 工作流跑完一步后，输出文本可以自动保存到当前项目的对应数据：
 * - worldview-field: 写到 worldview[field]（如 worldOrigin、historyLine）
 * - storyCore-field: 写到 storyCore[field]（如 logline、theme）
 * - chapter-content: 写到指定章节的 content（需要 chapterId 或 outlineNodeId）
 * - none: 不自动写，仅复制到剪贴板（默认）
 *
 * 复杂目标（角色/大纲多节点）需要 AI 输出结构化 JSON，留待后续 Phase。
 */
export type SaveTarget =
  | { type: 'worldview-field'; field: string; mode?: 'replace' | 'append' }
  | { type: 'storyCore-field'; field: string; mode?: 'replace' | 'append' }
  | { type: 'creativeRules-field'; field: string; mode?: 'replace' | 'append' }

export interface PromptWorkflowStep {
  /** UUID（前端生成） */
  stepId: string
  /** 用户可见的步骤名 */
  label: string
  /** 用哪个模板（按 moduleKey 找当前激活的） */
  promptModuleKey: PromptModuleKey
  /** 指定具体模板版本；不指定时用当前激活模板 */
  templateId?: number
  /**
   * 上一步输出如何映射到本步变量。
   * { previousOutput: 'worldContext' } 表示上一步的输出文本
   * 作为本步 ctx.worldContext 传入。
   */
  inputMapping?: Record<string, string>
  /** 本步执行前是否暂停让用户确认参数 */
  userConfirmRequired?: boolean
  /** 用户调整运行时参数（在 Runner 里设置） */
  parameterValues?: Record<string, unknown>
  /** 给 AI 的额外提示（每步可独立设置） */
  userHint?: string
  /** Phase 17：本步输出的自动写回目标 */
  saveTarget?: SaveTarget
}

export interface PromptWorkflow {
  id?: number
  scope: 'system' | 'user'
  name: string
  description: string
  /** 适用题材标签（与 PromptTemplate.genres 对齐） */
  genres?: string[]
  steps: PromptWorkflowStep[]
  /** 是否为默认推荐 */
  isDefault?: boolean
  createdAt: number
  updatedAt: number
}

/** 工作流执行实例（运行时使用，不持久化） */
export interface WorkflowRunState {
  workflowId: number
  currentStepIndex: number
  stepOutputs: Map<string, string>  // stepId → output
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted'
  error?: string
}
