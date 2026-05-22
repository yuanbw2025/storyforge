import { useMemo } from 'react'
import { X, CheckCircle2, AlertTriangle, RotateCcw, FileText, Trash2 } from 'lucide-react'
import type { ImportSession } from '../../../lib/types/import-session'

interface Props {
  session: ImportSession
  onRetryFailed: () => void
  onClose: () => void
  onDiscard: () => void
}

/**
 * 解析结束后汇报弹窗 —— Phase 18「事后汇报」。
 *
 * 无论全部成功还是部分失败，都弹一次，告诉用户：
 *   · 最终入库了多少东西
 *   · 哪些块失败了、原因是什么
 *   · 要不要对失败块单独重试
 */
export default function ImportReportModal({
  session, onRetryFailed, onClose, onDiscard,
}: Props) {
  const { done, failed, totalWv, totalChars, totalOl, failedChunks } = useMemo(() => {
    const done = session.chunks.filter(c => c.status === 'done').length
    const failed = session.chunks.filter(c => c.status === 'failed').length
    const totalWv = session.chunks.reduce(
      (a, c) => a + (c.extractedCounts?.worldviewFields || 0), 0,
    )
    const totalChars = session.chunks.reduce(
      (a, c) => a + (c.extractedCounts?.characters || 0), 0,
    )
    const totalOl = session.chunks.reduce(
      (a, c) => a + (c.extractedCounts?.outlineNodes || 0), 0,
    )
    const failedChunks = session.chunks.filter(c => c.status === 'failed')
    return { done, failed, totalWv, totalChars, totalOl, failedChunks }
  }, [session])

  const allSuccess = failed === 0

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b border-border ${
          allSuccess ? 'bg-success/10' : 'bg-warn/10'
        }`}>
          <div className="flex items-center gap-2">
            {allSuccess
              ? <CheckCircle2 className="w-5 h-5 text-success" />
              : <AlertTriangle className="w-5 h-5 text-warn" />}
            <h3 className="text-base font-semibold text-text-primary">
              {allSuccess ? '✓ 全部解析完成' : `⚠ 解析完成（${failed} 块失败）`}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 文件信息 */}
          <div className="bg-bg-base border border-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-text-muted mb-1">
              <FileText className="w-3 h-3" /> 文件
            </div>
            <div className="text-sm text-text-primary font-medium break-all">{session.filename}</div>
            <div className="text-xs text-text-muted mt-1">
              {session.totalChars.toLocaleString()} 字 · {session.totalChunks} 块 ·
              每块 {session.chunkSize.toLocaleString()} 字
            </div>
          </div>

          {/* 结果摘要 */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="成功块" value={done} color="text-success" />
            <StatCard label="失败块" value={failed} color={failed > 0 ? 'text-error' : 'text-text-muted'} />
            <StatCard label="世界观字段+" value={totalWv} color="text-accent" />
            <StatCard label="累计角色+" value={totalChars} color="text-accent" />
          </div>
          <div className="text-xs text-text-muted">
            大纲节点累计 +{totalOl} 个（跨块合并已自动处理别名去重）。
          </div>

          {/* finalReport 详文 */}
          {session.finalReport && (
            <div className="bg-bg-base border border-border rounded-lg p-3">
              <div className="text-xs text-text-secondary mb-1.5">任务汇报</div>
              <pre className="text-xs text-text-primary font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                {session.finalReport}
              </pre>
            </div>
          )}

          {/* 失败块明细 */}
          {failedChunks.length > 0 && (
            <div className="bg-error/5 border border-error/30 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-error mb-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                <strong>{failedChunks.length} 个块重试 3 次后仍失败</strong>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 text-xs">
                {failedChunks.map(c => (
                  <div key={c.index} className="bg-bg-base p-2 rounded border border-error/20">
                    <div className="text-text-primary font-medium">
                      第 {c.index + 1} 块{c.label ? ` · ${c.label}` : ''}
                    </div>
                    <div className="text-text-muted mt-0.5 break-all">
                      {c.errorMessage || '未知错误'}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-text-muted leading-relaxed">
                点击下方「重试失败块」，仅会重新解析这 {failedChunks.length} 个块；已成功的块不会重复写入。
              </div>
            </div>
          )}

          {session.fatalError && !failedChunks.length && (
            <div className="bg-error/10 border border-error/30 rounded-lg p-3 text-xs text-error">
              <AlertTriangle className="inline w-3 h-3 mr-1" />
              {session.fatalError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-bg-base">
          <button
            onClick={onDiscard}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-error hover:bg-error/10 rounded"
            title="删除本次会话记录（不影响已入库的数据）"
          >
            <Trash2 className="w-3.5 h-3.5" /> 清理会话
          </button>
          <div className="flex items-center gap-2">
            {failedChunks.length > 0 && (
              <button
                onClick={onRetryFailed}
                className="flex items-center gap-1.5 px-4 py-2 bg-warn text-white text-sm rounded hover:bg-warn/90"
              >
                <RotateCcw className="w-4 h-4" /> 重试失败块（{failedChunks.length}）
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: {
  label: string; value: number; color: string
}) {
  return (
    <div className="bg-bg-base border border-border rounded-lg p-3 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
    </div>
  )
}
