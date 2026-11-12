import { useMemo, useState } from 'react'
import { X, CheckCircle2, AlertTriangle, RotateCcw, FileText, Trash2, ArrowRight, BookOpenCheck } from 'lucide-react'
import type { UnifiedParseResult } from '../../../lib/types'
import type { DocumentImportChunkCandidateV1, readDocumentImportChunkEvidenceV1 } from '../../../lib/import/document-parse-durable'
import type { ImportSession } from '../../../lib/types/import-session'

interface Props {
  session: ImportSession
  onRetryFailed: () => void
  onClose: () => void
  onDiscard: () => void
  /** 「前往查看」—— 跳到导入数据的落点（当前项目=设定库 / 项目参考页）。不传则不显示该按钮。 */
  onNavigate?: () => void
  /** Phase 35-c：进入 Codex 候选审查；候选未确认前不会入库。 */
  onReviewCodex?: () => void
  evidence?: Awaited<ReturnType<typeof readDocumentImportChunkEvidenceV1>>
  onStartAnalysis?: () => void
  review?: {
    candidate: DocumentImportChunkCandidateV1
    raw: string | null
    canConfirm: boolean
    onConfirm: (result: UnifiedParseResult) => Promise<void>
  }
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
  session, onRetryFailed, onClose, onDiscard, onNavigate, onReviewCodex, review, evidence, onStartAnalysis,
}: Props) {
  const toReference = session.importTarget === 'reference'
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

  const allSuccess = session.status === 'done'
  const observation = evidence?.observation as {
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null
    requestLifecycle?: { phase?: string; responseStatus?: number | null } | null
  } | null | undefined
  const attemptNote = observation?.usage?.totalTokens != null
    ? `已记录用量：输入 ${observation.usage.inputTokens ?? '—'}，输出 ${observation.usage.outputTokens ?? '—'}，合计 ${observation.usage.totalTokens} tokens。`
    : observation?.requestLifecycle?.phase === 'pre-dispatch' ? '请求未发送。'
      : observation?.requestLifecycle?.responseStatus ? `服务返回 HTTP ${observation.requestLifecycle.responseStatus}。` : null
  if (review) return <ImportChunkReview key={review.candidate.candidateHash} filename={session.filename} review={review} onClose={onClose} attemptNote={attemptNote} />
  const codexCandidates = session.merged?.codexCandidates?.length || 0

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b border-border ${
          allSuccess ? 'bg-success/10' : 'bg-warning/10'
        }`}>
          <div className="flex items-center gap-2">
            {allSuccess
              ? <CheckCircle2 className="w-5 h-5 text-success" />
              : <AlertTriangle className="w-5 h-5 text-warning" />}
            <h3 className="text-base font-semibold text-text-primary">
              {allSuccess ? '✓ 全部导入完成' : `导入记录（已处理 ${done} 块，失败 ${failed} 块）`}
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
          <div className="grid grid-cols-5 gap-2">
            <StatCard label="成功块" value={done} color="text-success" />
            <StatCard label="失败块" value={failed} color={failed > 0 ? 'text-error' : 'text-text-muted'} />
            <StatCard label="世界观字段+" value={totalWv} color="text-accent" />
            <StatCard label="累计角色+" value={totalChars} color="text-accent" />
            <StatCard label="词条候选" value={codexCandidates} color="text-accent" />
          </div>
          <div className="text-xs text-text-muted">
            大纲节点累计 +{totalOl} 个。异名角色请由作者核对；不会自动合并。
          </div>

          {/* 已导入提示 —— 数据在解析时已实时入库,无需再点「导入」 */}
          {done > 0 && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-1.5 text-success font-medium mb-1">
                <CheckCircle2 className="w-4 h-4" />
                {toReference ? (allSuccess ? '已存入「项目参考」' : '已确认的参考内容') : '已导入当前项目'}
              </div>
              <div className="text-text-secondary text-xs leading-relaxed">
                {toReference
                  ? allSuccess ? '可在「项目参考」中查看导入内容。' : '项目参考尚未发布；已确认的内容留在原会话中。'
                  : '可以在「设定库 / 角色设计 / 大纲」查看已导入的内容。'}
              </div>
            </div>
          )}

          {codexCandidates > 0 && (
            <div className={`border rounded-lg p-3 text-sm ${
              session.codexAdoption
                ? 'bg-success/10 border-success/30'
                : 'bg-accent/10 border-accent/30'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={`flex items-center gap-1.5 font-medium ${
                    session.codexAdoption ? 'text-success' : 'text-accent'
                  }`}>
                    <BookOpenCheck className="w-4 h-4" />
                    {session.codexAdoption
                      ? `词条审查已完成：新增 ${session.codexAdoption.imported}、补全 ${session.codexAdoption.updated}、跳过 ${session.codexAdoption.skipped}`
                      : `${codexCandidates} 条 Codex 候选等待作者审查`}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    AI 分类不会自动写库；可逐条取消、改名或改分类后再确认。
                  </div>
                </div>
                {onReviewCodex && !session.codexAdoption && (
                  <button
                    onClick={onReviewCodex}
                    className="px-3 py-2 bg-accent text-white text-xs rounded hover:bg-accent-hover shrink-0"
                  >
                    审查并选择
                  </button>
                )}
              </div>
            </div>
          )}

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
                <strong>{failedChunks.length} 个块解析失败或已停止</strong>
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
                旧尝试的结果无法核实时，不会自动发送新的请求。
              </div>
            </div>
          )}

          {evidence && !evidence.candidate && (
            <div className="bg-warning/5 border border-warning/30 rounded-lg p-3 text-sm">
              <p>本块有保留的尝试记录。打开或继续本任务不会重新发送请求。</p>
              {attemptNote && <p className="mt-1 text-xs text-text-secondary">{attemptNote}</p>}
              {evidence.raw !== null && <details className="mt-2">
                <summary>查看已保留的模型原答</summary>
                <pre className="whitespace-pre-wrap max-h-40 overflow-y-auto">{evidence.raw}</pre>
              </details>}
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
            {failedChunks.length > 0 && !evidence && (
              <button
                onClick={onRetryFailed}
                className="flex items-center gap-1.5 px-4 py-2 bg-warning text-white text-sm rounded hover:bg-warning/90"
              >
                <RotateCcw className="w-4 h-4" /> 核对并继续
              </button>
            )}
            {onStartAnalysis && <button onClick={onStartAnalysis}
              className="px-3 py-2 bg-accent text-white text-sm rounded">开始{session.analysisDepth === 'deep' ? '深层' : '浅层'}分析</button>}
            {onNavigate && done > 0 && (
              <button
                onClick={onNavigate}
                className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover"
              >
                {toReference ? '前往项目参考' : '前往设定库查看'}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm rounded ${
                onNavigate && done > 0
                  ? 'border border-border text-text-secondary hover:bg-bg-hover'
                  : 'bg-accent text-white hover:bg-accent-hover'
              }`}
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

function ImportChunkReview({ filename, review, onClose, attemptNote }: {
  filename: string
  review: NonNullable<Props['review']>
  attemptNote: string | null
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => structuredClone(review.candidate.result))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const confirm = async () => {
    if (saving || !review.canConfirm) return
    setSaving(true)
    setError('')
    try { await review.onConfirm(draft) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <section role="dialog" aria-modal="true" aria-label="审查导入候选"
        className="bg-bg-surface border border-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-text-primary">审查第 {review.candidate.chunkIndex + 1} 块</h3>
          <button aria-label="稍后审查" onClick={onClose} disabled={saving}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-text-secondary break-all">{filename}。确认后才保存本块内容，可先修改或删除不需要的内容。</p>
        <div className="space-y-2">
          {Object.entries(draft).filter(([key, value]) => key !== 'codexCandidates' && value && Object.keys(value).length > 0)
            .map(([key, value]) => (
              <details key={key} open className="rounded border border-border bg-bg-base p-3 text-sm">
                <summary className="font-medium text-text-primary">{labelForField(key)}</summary>
                <EditableImportValue value={value} label={labelForField(key)}
                  onChange={next => setDraft(current => ({ ...current, [key]: next }))} />
              </details>
            ))}
          {Boolean(draft.codexCandidates?.length) && <p className="text-sm text-text-secondary">
            另有 {draft.codexCandidates?.length} 条词条候选，完成文档导入后可单独审查。
          </p>}
          {!Object.values(draft).some(value => value && Object.keys(value).length > 0) &&
            <p className="text-sm text-text-secondary">本块没有提取到可保存的内容。确认后可继续处理下一块。</p>}
        </div>
        {attemptNote && <p className="text-xs text-text-secondary">{attemptNote}</p>}
        {review.raw !== null && <details className="text-sm text-text-secondary">
          <summary>查看模型原答</summary>
          <pre className="whitespace-pre-wrap max-h-40 overflow-y-auto mt-2">{review.raw}</pre>
        </details>}
        {!review.canConfirm && <p className="text-sm text-text-secondary">需要先恢复或重新上传相同原文件，才能确认本块。</p>}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="px-3 py-2 text-sm">稍后审查</button>
          <button onClick={confirm} disabled={saving || !review.canConfirm}
            className="px-4 py-2 rounded bg-accent text-white text-sm disabled:opacity-50">{saving ? '保存中…' : '确认保存本块'}</button>
        </div>
      </section>
    </div>
  )
}


const IMPORT_REVIEW_LABELS: Record<string, string> = {
  worldview: '世界观', geography: '地理', history: '历史', characters: '角色', outline: '大纲',
  writingTechniques: '写作技法', worldOrigin: '世界来源', overview: '概述', summary: '摘要',
  name: '名称', title: '标题', children: '下级条目', shortDescription: '角色简介',
  type: '类型', roleWeight: '角色定位', moralAxis: '道德倾向', orderAxis: '秩序倾向',
}
const labelForField = (key: string) => IMPORT_REVIEW_LABELS[key] ?? key

function EditableImportValue({ value, label, onChange, depth = 0 }: {
  value: unknown
  label: string
  onChange: (value: unknown) => void
  depth?: number
}) {
  if (depth > 8 || value == null) return null
  if (typeof value === 'string') {
    return <textarea aria-label={label} rows={Math.min(5, Math.max(1, Math.ceil(value.length / 60)))}
      value={value} onChange={event => onChange(event.target.value)}
      className="w-full bg-bg-surface border border-border rounded px-2 py-1 text-sm" />
  }
  if (Array.isArray(value)) {
    return <div className="space-y-2 mt-2">{value.map((item, index) => (
      <div key={index} className="border border-border p-2 rounded">
        <div className="flex justify-between mb-1">
          <span>{label} {index + 1}</span>
          <button aria-label={`移除 ${label} ${index + 1}`} className="text-text-muted hover:text-error"
            onClick={() => onChange(value.filter((_, position) => position !== index))}>移除</button>
        </div>
        <EditableImportValue label={`${label} ${index + 1}`} value={item} depth={depth + 1}
          onChange={next => onChange(value.map((previous, position) => position === index ? next : previous))} />
      </div>
    ))}</div>
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return <div className="grid gap-2 mt-2">{Object.entries(record).map(([key, child]) => (
      <div key={key}>
        <span className="block text-xs text-text-secondary">{labelForField(key)}</span>
        <EditableImportValue label={labelForField(key)} value={child} depth={depth + 1}
          onChange={next => onChange({ ...record, [key]: next })} />
      </div>
    ))}</div>
  }
  return <span className="text-text-secondary">{String(value)}</span>
}
