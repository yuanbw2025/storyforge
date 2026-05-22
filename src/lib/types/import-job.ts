/**
 * AI 导入任务（ImportJob）— v3 §6 Phase 10 配套类型
 *
 * 用户上传 .docx / .xlsx / .csv / .md / .txt 或粘贴文本，
 * AI 解析为结构化 JSON，预览后批量写入对应模块。
 *
 * 本表存"任务"本身：原文 + AI 解析结果 + 状态 + 用户确认结果。
 */

export type ImportJobType =
  | 'character'       // 角色文档
  | 'worldview'       // 世界观文档
  | 'outline'         // 大纲/故事文档
  | 'mixed'           // 混合（让 AI 自动分类）

export type ImportJobStatus =
  | 'parsing'         // AI 解析中
  | 'ready'           // 解析完成，等用户确认
  | 'imported'        // 已写入 DB
  | 'discarded'       // 用户放弃
  | 'failed'          // 解析失败

export interface ImportJob {
  id?: number
  projectId: number
  type: ImportJobType
  status: ImportJobStatus
  /** 上传文件名（如有） */
  filename?: string
  /** 文件 MIME 类型（如有） */
  mimeType?: string
  /** 原始文本（解析后的纯文本，最大保留几万字） */
  rawDocument: string
  /** AI 解析出的 JSON（结构按 type 不同）— 字符串化后存储 */
  parsedJson: string
  /** 失败时的错误说明 */
  errorMessage?: string
  /** 用户确认后写入了哪些表（debug 用） */
  importedSummary?: string
  createdAt: number
  updatedAt: number
}
