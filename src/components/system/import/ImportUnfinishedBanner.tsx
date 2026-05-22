import { History, HardDrive, PlayCircle } from 'lucide-react'
import type { ImportSession } from '../../../lib/types/import-session'

interface Props {
  unfinished: ImportSession
  restoringBlob: boolean
  blobRestored: boolean
  /** 当前文本框里是否已经有原文（用于判断兜底续跑按钮是否可点） */
  hasRawText: boolean
  onResume: () => void
  onResumeWithUploaded: () => void
  onShowDetail: () => void
  onDiscard: () => void | Promise<void>
}

/**
 * 未完成会话横幅：打开面板时如果项目内有未完成任务，
 * 展示续跑入口与放弃按钮。从 ImportDocPanel.tsx 抽出。
 */
export default function ImportUnfinishedBanner({
  unfinished,
  restoringBlob,
  blobRestored,
  hasRawText,
  onResume,
  onResumeWithUploaded,
  onShowDetail,
  onDiscard,
}: Props) {
  const remaining = unfinished.chunks.filter(c => c.status !== 'done').length

  return (
    <div className="bg-warn/5 border border-warn/30 rounded-xl p-4 flex items-start gap-3">
      <History className="w-5 h-5 text-warn mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="text-sm font-semibold text-warn mb-1">
          发现未完成的解析任务
        </div>
        <div className="text-xs text-text-secondary leading-relaxed">
          文件「<strong>{unfinished.filename}</strong>」还剩 {remaining} 块未解析
          （共 {unfinished.totalChunks} 块 · 状态：{unfinished.status}）。
        </div>
        {restoringBlob && (
          <div className="mt-1.5 text-[11px] text-text-muted flex items-center gap-1">
            <HardDrive className="w-3 h-3 animate-pulse" />
            正在从本地存档恢复原文...
          </div>
        )}
        {!restoringBlob && blobRestored && (
          <div className="mt-1.5 text-[11px] text-accent flex items-center gap-1">
            <HardDrive className="w-3 h-3" />
            已从本地存档恢复原文，可直接续跑
          </div>
        )}
        <div className="flex items-center gap-2 mt-2">
          {blobRestored ? (
            <button
              onClick={onResume}
              className="flex items-center gap-1 px-3 py-1.5 bg-warn text-white text-xs rounded hover:bg-warn/90"
            >
              <PlayCircle className="w-3.5 h-3.5" /> 立即续跑
            </button>
          ) : hasRawText ? (
            <button
              onClick={onResumeWithUploaded}
              className="flex items-center gap-1 px-3 py-1.5 bg-warn text-white text-xs rounded hover:bg-warn/90"
            >
              <PlayCircle className="w-3.5 h-3.5" /> 用当前文件续跑
            </button>
          ) : !restoringBlob ? (
            <span className="text-xs text-text-muted">
              ⚠ 本地存档丢失（可能已清理浏览器数据），请在下方重新上传同一文件
            </span>
          ) : null}
          <button
            onClick={onShowDetail}
            className="px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover rounded"
          >
            查看详情
          </button>
          <button
            onClick={() => onDiscard()}
            className="px-3 py-1.5 text-xs text-text-muted hover:text-error rounded"
          >
            放弃
          </button>
        </div>
      </div>
    </div>
  )
}
