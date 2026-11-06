import { Info } from 'lucide-react'
import { FILE_LIMIT_HINTS } from '../../../lib/doc-parser'
import type { ImportSession } from '../../../lib/types/import-session'

export function ImportDocIntro({ chunkSize }: { chunkSize: number }) {
  return (
    <div>
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
