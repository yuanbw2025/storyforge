/**
 * AI 分块导入会话（ImportSession）
 *
 * 分块原文与归属在作者开始解析前冻结。付费原答和候选留在原 Work
 * 的 Agent Run；作者确认后正式写入并提交分块收据。
 * 本表保存本地任务、恢复进度与最终报告，不拥有已采纳的作品内容。
 */

import type { VerificationReceiptV1 } from './agent-run'
import type { WorkspaceScope } from './world-ownership'
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
  | 'failed'    // 失败或停止，仍可手动重试

/** 一个 chunk 的运行状态 */
export interface ChunkState {
  index: number              // 0-based 序号
  /** chunk 原文起始字符位置（用于 debug） */
  startChar: number
  endChar: number
  charCount: number
  /** 当前创建入口冻结的确切解析文本摘要；旧档缺失不能自动续跑。 */
  sourceTextHash?: string
  /** Local link to the only candidate Run for this frozen source attempt. */
  durableParse?: {
    claimKey: string
    runId: number | null
    confirmation?: { editedHash: string; receipt: VerificationReceiptV1 }
  }
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
    codexCandidates?: number
  }
  startedAt?: number
  finishedAt?: number
}

/** 导入会话 */
export interface ImportSession {
  id?: number
  projectId: number
  /** 新任务创建时确认的落点；旧记录仍可读取，但缺失时不得执行。 */
  targetScope?: WorkspaceScope
  /** 上传文件名 */
  filename: string
  /** 原文件的快速匹配标识；正式续跑另用逐块 SHA-256 核对原文。 */
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
  /** 历史任务兼容字段；新解析不将其送入模型。 */
  rollingContext: string
  /** 导入目标：写入当前项目 还是 项目参考 */
  importTarget: ImportTarget
  /** 项目参考模式的作品分析档位（浅/深）；project 模式无意义 */
  analysisDepth?: import('./reference').ReferenceAnalysisDepth
  /** 多世界项目导入当前项目时的目标世界；null = 单世界/默认归属 */
  targetWorldGroupId?: number | null
  /** Original atomically published reference; downstream analysis has its own lifecycle. */
  publishedReferenceId?: number
  /** Local claim for starting the published reference analysis from this import. */
  referenceAnalysisStartedAt?: number
  /** 整体状态 */
  status: ImportSessionStatus
  /** 失败时的终结错误信息 */
  fatalError?: string
  /** 跑完后的汇总文字（给 Report Modal 直接展示） */
  finalReport?: string
  /** Phase 35-c：作者确认词条候选后的写回回执；缺失表示尚未采纳。 */
  codexAdoption?: {
    adoptedAt: number
    imported: number
    updated: number
    skipped: number
  }
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
