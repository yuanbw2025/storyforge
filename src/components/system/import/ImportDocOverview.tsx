import { useSyncExternalStore } from 'react'
import { Info } from 'lucide-react'
import { FILE_LIMIT_HINTS } from '../../../lib/doc-parser'
import type { CsvGridV1 } from '../../../lib/import/csv-grid'
import type { ImportSession } from '../../../lib/types/import-session'

/** 032-L1-a：恢复钩子与介绍区都在授权写集内，用一个只读外部快照把
 * 固定提示送到真实界面；不要求修改 ImportDocPanel，也不新增平行入口。 */
let textLayerNoticeV1: string | null = null
const textLayerListeners = new Set<() => void>()
export function publishTextLayerNoticeV1(notice: string | null) {
  if (textLayerNoticeV1 === notice) return
  textLayerNoticeV1 = notice
  for (const listener of textLayerListeners) listener()
}
function subscribeTextLayerNoticeV1(listener: () => void) {
  textLayerListeners.add(listener)
  return () => { textLayerListeners.delete(listener) }
}
function readTextLayerNoticeV1() { return textLayerNoticeV1 }
export function useTextLayerNoticeV1() {
  return useSyncExternalStore(subscribeTextLayerNoticeV1, readTextLayerNoticeV1, readTextLayerNoticeV1)
}

/** 032-L1-c：仅 csv 上传成功时出现的只读对照侧车快照；不进 AI/adopt/persistence。
 * ImportDocIntro 通过 useCsvGridViewV1() 订阅，recovery/prep hook 通过 publishCsvGridViewV1() 发布。 */
let csvGridViewV1: CsvGridV1 | null = null
const csvGridListeners = new Set<() => void>()
export function publishCsvGridViewV1(grid: CsvGridV1 | null) {
  csvGridViewV1 = grid
  for (const fn of csvGridListeners) fn()
}
function subscribeCsvGridViewV1(fn: () => void) { csvGridListeners.add(fn); return () => { csvGridListeners.delete(fn) } }
export function useCsvGridViewV1() {
  const snap = useSyncExternalStore(subscribeCsvGridViewV1, () => csvGridViewV1, () => csvGridViewV1)
  return snap
}

export function ImportDocIntro({ chunkSize }: { chunkSize: number }) {
  const textLayerNotice = useTextLayerNoticeV1()
  const csvGrid = useCsvGridViewV1()
  return (
    <div>
      {textLayerNotice && <div role="status" className="mb-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">{textLayerNotice}</div>}
      {csvGrid && <CsvPreviewCardV1 grid={csvGrid} />}
      <h2 className="text-xl font-bold text-text-primary mb-1">📥 AI 分块文档解析</h2>
      <p className="text-sm text-text-muted">
        上传任意一份文档（设定集、成品小说、大纲草稿……甚至千万字长篇），AI 自动分块串行解析
        <span className="text-accent">世界观 / 角色 / 大纲章节 / Codex 实体候选</span>。
        开始解析前先选择写入<strong>当前项目</strong>还是<strong>项目参考</strong>；
        每块结果先由你审查、修改并确认。项目导入的词条可在最后单独审查。
      </p>
      <div className="mt-2 bg-bg-surface border border-border rounded-lg p-3 text-xs text-text-secondary">
        <div className="flex items-center gap-1.5 mb-1.5 text-text-primary">
          <Info className="w-3.5 h-3.5 text-accent" />
          <span className="font-medium">支持的文件格式与大小上限</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {FILE_LIMIT_HINTS.map(hint => (
            <div key={hint.ext} className="text-center px-2 py-1.5 bg-bg-base rounded">
              <div className="text-xs font-mono text-accent">.{hint.ext}</div>
              <div className="text-[10px] text-text-muted">{hint.label}</div>
              <div className="text-xs text-text-primary font-medium">≤ {hint.mb} MB</div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-text-muted leading-relaxed">
          ⚠️ 大文档会自动按「章节边界」或「段落 / 字符数」切块，每块约 {chunkSize.toLocaleString()} 字，AI 串行处理。<br />
          🔍 扫描件或图片型 PDF 没有可复制文本层时不会进入解析：结果会明确提示「未识别到可复制文本，已保留原件」，原件仍可查看/下载，补上可复制文本后再开始。<br />
          ✨ <strong>上传后原文会自动存档到浏览器本地 IndexedDB</strong>，存档成功后，回到原世界和作品可以续跑；存档缺失时须重新上传同一文件。
        </div>
      </div>
    </div>
  )
}

export function ImportReusableSessionBanner({
  session,
  applying,
  originalTextAvailable,
  onApplyProject,
  onApplyReference,
  onReviewCodex,
  onShowReport,
  onRestoreOriginal,
  onIgnore,
}: {
  session: ImportSession
  applying: boolean
  originalTextAvailable: boolean
  onApplyProject: () => void
  onApplyReference: (depth: 'quick' | 'deep') => void
  onReviewCodex?: () => void
  onShowReport: () => void
  onRestoreOriginal?: () => void
  onIgnore: () => void
}) {
  const confirmed = session.chunks.every(chunk => chunk.durableParse?.confirmation)
  return (
    <div className="rounded-lg border border-purple-400/40 bg-purple-400/5 p-3 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-purple-300 mb-1">
        📦 检测到已解析《{session.filename}》（{session.totalChars.toLocaleString()} 字 · {session.totalChunks} 块）
      </div>
      <div className="text-text-muted mb-2 leading-relaxed">
        {confirmed ? '可以查看确认结果，或按需将已审查的内容应用到其他模块。' : '这是旧版解析记录，可查看原报告。'}
        {!originalTextAvailable && confirmed && ' 深层分析需要恢复原文件。'}
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={applying} onClick={onShowReport}
          className="px-3 py-1.5 rounded border border-purple-400/60 text-purple-200 hover:bg-purple-400/10 disabled:opacity-50">
          查看导入记录
        </button>
        {onRestoreOriginal && <button onClick={onRestoreOriginal} disabled={applying}
          className="px-3 py-1.5 rounded border border-purple-400/60 text-purple-200 hover:bg-purple-400/10">
          用当前文件恢复原文
        </button>}
        {confirmed && session.importTarget === 'reference' && <button disabled={applying} onClick={onApplyProject}
          className="px-3 py-1.5 rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50 font-medium">
          采用到当前项目设定库
        </button>}
        {confirmed && session.importTarget === 'project' && <button disabled={applying} onClick={() => onApplyReference('quick')}
          className="px-3 py-1.5 rounded bg-purple-500/80 text-white hover:bg-purple-500 disabled:opacity-50">
          保存为项目参考 · 浅层
        </button>}
        {confirmed && session.importTarget === 'project' && originalTextAvailable && <button disabled={applying} onClick={() => onApplyReference('deep')}
          className="px-3 py-1.5 rounded border border-purple-400/60 text-purple-200 hover:bg-purple-400/10 disabled:opacity-50">
          保存为项目参考 · 深层
        </button>}
        {confirmed && onReviewCodex && (session.merged?.codexCandidates?.length || 0) > 0 && !session.codexAdoption && (
          <button disabled={applying} onClick={onReviewCodex}
            className="px-3 py-1.5 rounded border border-accent/60 text-accent hover:bg-accent/10 disabled:opacity-50">
            📚 审查 {session.merged?.codexCandidates?.length} 条词条候选
          </button>
        )}
        <button disabled={applying} onClick={onIgnore}
          className="px-3 py-1.5 rounded text-text-muted hover:bg-bg-hover">
          忽略
        </button>
      </div>
    </div>
  )
}

/** 032-L1-c：CSV 行列只读对照卡片（仅展示，不写入任何持久化或 AI 链）。最多前 10 行 + 列数/ragged 提示。 */
function CsvPreviewCardV1({ grid }: { grid: import('../../../lib/import/csv-grid').CsvGridV1 }) {
  const previewRows = grid.rows.slice(0, 10)
  return (
    <div role="status" className="mb-2 rounded-lg border border-border bg-bg-surface p-3 text-xs">
      <div className="flex items-center gap-2 mb-1.5 text-text-primary font-medium">
        <span>📊 CSV 对照预览</span>
        <span className="text-text-muted">共 {grid.columnCount} 列 · {grid.rows.length} 行</span>
        {grid.hasHeaderRow && <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px]">表头行已识别</span>}
      </div>
      {grid.raggedRows.length > 0 && (
        <p className="mb-1 text-warning">⚠️ 下列行字段数与多数不一致（可能 ragged）：{grid.raggedRows.join(', ')}</p>
      )}
      {grid.quoteErrors && <p className="mb-1 text-warning">⚠️ 检测到未闭合引号字段，原文仍保留。</p>}
      <table className="w-full border-collapse">
        <thead>
          <tr>{previewRows[0]?.map((cell, ci) => (
            <th key={ci} className="border border-border px-2 py-1 text-left text-[11px] text-text-muted bg-bg-base font-mono">{cell || '—'}</th>
          ))}</tr>
        </thead>
        <tbody>
          {(grid.hasHeaderRow ? previewRows.slice(1) : previewRows).map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => (
              <td key={ci} className="border border-border px-2 py-1 text-text-secondary font-mono whitespace-pre-wrap max-w-[220px] align-top">{cell || ''}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
      {grid.rows.length > 10 && <p className="mt-1 text-text-muted">仅展示前 10 行；完整原文仍在 IndexedDB 中，可继续下载。</p>}
    </div>
  )
}
