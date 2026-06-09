/**
 * AI 分块导入会话（ImportSession）
 *
 * 2026-05-11 新增 — Phase 18 大文档分块流水线。
 *
 * 一部超大文档（几十万字～千万字）一次性塞给 AI 必然被 maxTokens 截断；
 * 这里把文档按章节/段落切成若干 chunk，串行让 AI 解析，每块即时写 DB，
 * 失败自动重试 3 次，可暂停/恢复/断点续跑，每 10 块做一次 AI 跨块角色合并。
 *
 * 这张表存「任务本身」—— 文档哈希、chunk 列表、累计解析结果、状态；
 * 解析出来的具体数据照常写入 worldviews / characters / outlineNodes 表。
 */

import type { UnifiedParseResult } from './import-session-data'

/** 导入目标 */
export type ImportTarget = 'project' | 'reference'

/** 会话状态 */
export type ImportSessionStatus =
  | 'pending'    // 已创建、还没跑
  | 'running'    // 正在跑
  | 'paused'     // 用户暂停
  | 'failed'     // 所有重试都失败、被整体终止（仍可恢复）
  | 'done'       // 全部 chunk 处理完
  | 'cancelled'  // 用户放弃

/** 单个 chunk 的状态 */
export type ChunkStatus =
  | 'pending'   // 等待处理
  | 'running'   // 处理中
  | 'done'      // 成功
  | 'failed'    // 重试 3 次仍失败

/** 一个 chunk 的运行状态 */
export interface ChunkState {
  index: number              // 0-based 序号
  /** chunk 原文起始字符位置（用于 debug） */
  startChar: number
  endChar: number
  charCount: number
  /** 章节/段落标题（如识别到的"第X章"）— 仅展示用 */
  label?: string
  status: ChunkStatus
  /** 重试次数 */
  attempts: number
  /** 最近一次错误信息 */
  errorMessage?: string
  /** 本块解析出了多少东西（给用户看进度） */
  extractedCounts?: {
    worldviewFields?: number
    characters?: number
    outlineNodes?: number
  }
  startedAt?: number
  finishedAt?: number
}

/** 导入会话 */
export interface ImportSession {
  id?: number
  projectId: number
  /** 上传文件名 */
  filename: string
  /** 文件 SHA256（8 位前缀用作 id 显示） */
  fileHash: string
  /** 原文总字数 */
  totalChars: number
  /** 拆成多少 chunk */
  totalChunks: number
  /** 每个 chunk 的目标字符数（用户可调） */
  chunkSize: number
  /** chunk 列表（按顺序） */
  chunks: ChunkState[]
  /** 累计合并后的解析结果（给用户看 + 恢复时做上下文） */
  merged: UnifiedParseResult
  /** 滚动上下文（~1500 字已识别角色 + 关键词），AI 续跑时塞回 prompt */
  rollingContext: string
  /** 导入目标：写入当前项目 还是 项目参考 */
  importTarget: ImportTarget
  /** 多世界项目导入当前项目时的目标世界；null = 单世界/默认归属 */
  targetWorldGroupId?: number | null
  /** 整体状态 */
  status: ImportSessionStatus
  /** 失败时的终结错误信息 */
  fatalError?: string
  /** 跑完后的汇总文字（给 Report Modal 直接展示） */
  finalReport?: string
  createdAt: number
  updatedAt: number
}

/** 解析活动日志（滚动写 indexedDB，给用户看/复盘用） */
export type ImportLogLevel = 'info' | 'warn' | 'error' | 'success'

export interface ImportLog {
  id?: number
  sessionId: number
  level: ImportLogLevel
  /** 关联的 chunk index（无关的操作填 -1） */
  chunkIndex: number
  message: string
  createdAt: number
}
