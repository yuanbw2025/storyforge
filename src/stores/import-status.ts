/**
 * 导入流水线全局状态 —— Phase 18 §用户感知基础设施。
 *
 * 所有组件（Status Bar / Progress Panel / Activity Log / Modal）都订阅这一个 store，
 * 不再依赖 ImportDocPanel 的 local state。标签切走再回来也看得见当前 session。
 *
 * 日志只保留最近 200 条在内存里给 UI 实时展示；DB 那份 importLogs 表归档用。
 */

import { create } from 'zustand'
import type { ImportLogLevel } from '../lib/types/import-session'

/** 主状态机 */
export type PipelinePhase =
  | 'idle'         // 没有任何会话
  | 'preparing'    // 读文件、切块、创建会话
  | 'running'      // 正在跑
  | 'merging'      // 正在做跨块角色合并
  | 'paused'       // 暂停
  | 'failed'       // 终结失败
  | 'done'         // 跑完

export interface ActivityEntry {
  id: string
  time: number
  level: ImportLogLevel
  message: string
  chunkIndex?: number
}

export interface ImportStatusState {
  /** 当前会话 id（对应 DB importSessions.id） */
  sessionId: number | null
  phase: PipelinePhase
  filename: string
  totalChunks: number
  finishedChunks: number
  failedChunks: number
  /** 当前正在跑的 chunk（0-based） */
  activeChunkIndex: number | null
  /** 该 chunk 已经重试了几次 */
  activeAttempts: number
  /** 最近 200 条活动日志（新 → 旧） */
  activity: ActivityEntry[]
  /** 跑到最后的全局错误（仅 phase=failed 时非空） */
  fatalError: string | null

  // ── 动作 ──────────────────────────────────────────────────────
  reset: () => void
  attachSession: (p: {
    sessionId: number
    filename: string
    totalChunks: number
    finishedChunks?: number
    failedChunks?: number
    phase: PipelinePhase
  }) => void
  setPhase: (phase: PipelinePhase) => void
  setActiveChunk: (index: number | null, attempts?: number) => void
  markChunkFinished: (args: { success: boolean }) => void
  pushActivity: (level: ImportLogLevel, message: string, chunkIndex?: number) => void
  setFatalError: (msg: string | null) => void
  /** 批量覆盖计数（从 DB 恢复时用） */
  syncCounts: (p: { finishedChunks: number; failedChunks: number; totalChunks: number }) => void
}

const INITIAL: Omit<ImportStatusState,
  'reset' | 'attachSession' | 'setPhase' | 'setActiveChunk' | 'markChunkFinished'
  | 'pushActivity' | 'setFatalError' | 'syncCounts'> = {
  sessionId: null,
  phase: 'idle',
  filename: '',
  totalChunks: 0,
  finishedChunks: 0,
  failedChunks: 0,
  activeChunkIndex: null,
  activeAttempts: 0,
  activity: [],
  fatalError: null,
}

const MAX_ACTIVITY = 200

export const useImportStatusStore = create<ImportStatusState>((set) => ({
  ...INITIAL,

  reset: () => set({ ...INITIAL }),

  attachSession: (p) => set({
    sessionId: p.sessionId,
    filename: p.filename,
    totalChunks: p.totalChunks,
    finishedChunks: p.finishedChunks ?? 0,
    failedChunks: p.failedChunks ?? 0,
    phase: p.phase,
    activeChunkIndex: null,
    activeAttempts: 0,
    fatalError: null,
  }),

  setPhase: (phase) => set({ phase }),

  setActiveChunk: (index, attempts = 0) => set({
    activeChunkIndex: index,
    activeAttempts: attempts,
  }),

  markChunkFinished: ({ success }) => set(s => ({
    finishedChunks: success ? s.finishedChunks + 1 : s.finishedChunks,
    failedChunks: success ? s.failedChunks : s.failedChunks + 1,
    activeChunkIndex: null,
    activeAttempts: 0,
  })),

  pushActivity: (level, message, chunkIndex) => set(s => ({
    activity: [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: Date.now(),
        level,
        message,
        chunkIndex,
      },
      ...s.activity,
    ].slice(0, MAX_ACTIVITY),
  })),

  setFatalError: (msg) => set({ fatalError: msg }),

  syncCounts: (p) => set({
    finishedChunks: p.finishedChunks,
    failedChunks: p.failedChunks,
    totalChunks: p.totalChunks,
  }),
}))
