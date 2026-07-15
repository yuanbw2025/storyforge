import { Info } from 'lucide-react'
import { FILE_LIMIT_HINTS } from '../../../lib/doc-parser'
import type { ImportSession } from '../../../lib/types/import-session'

export function ImportDocIntro({ chunkSize }: { chunkSize: number }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-1">📥 AI 分块文档解析</h2>
      <p className="text-sm text-text-muted">
        上传任意一份文档（设定集、成品小说、大纲草稿……甚至千万字长篇），AI 自动分块串行解析
        <span className="text-accent">世界观 / 角色 / 大纲章节</span>。
        开始解析前先选择写入<strong>当前项目</strong>还是<strong>项目参考</strong>；解析过程中即<strong>实时入库</strong>，
        完成后数据已就位，无需再手动导入。
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
          ✨ <strong>上传后原文会自动存档到浏览器本地 IndexedDB</strong>，即使关闭浏览器，下次打开可<strong>一键续跑</strong>，无需重新上传。
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
  onIgnore,
}: {
  session: ImportSession
  applying: boolean
  originalTextAvailable: boolean
  onApplyProject: () => void
  onApplyReference: (depth: 'quick' | 'deep') => void
  onIgnore: () => void
}) {
  return (
    <div className="rounded-lg border border-purple-400/40 bg-purple-400/5 p-3 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-purple-300 mb-1">
        📦 检测到已解析《{session.filename}》（{session.totalChars.toLocaleString()} 字 · {session.totalChunks} 块）
      </div>
      <div className="text-text-muted mb-2 leading-relaxed">
        无需重新上传或解析（不再花 AI）。可<strong className="text-accent">直接灌进当前项目设定库</strong>（世界观/角色/大纲一键入库，不用一个个手填），或存为「项目参考」做 13 维分析{!originalTextAvailable && '（原文已不在内存，深层将退回浅层；如需深层请重新上传）'}：
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={applying} onClick={onApplyProject}
          className="px-3 py-1.5 rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50 font-medium">
          📥 灌进当前项目设定库
        </button>
        <button disabled={applying} onClick={() => onApplyReference('quick')}
          className="px-3 py-1.5 rounded bg-purple-500/80 text-white hover:bg-purple-500 disabled:opacity-50">
          ♻️ 应用到 项目参考 · 浅层（免费）
        </button>
        <button disabled={applying} onClick={() => onApplyReference('deep')}
          className="px-3 py-1.5 rounded border border-purple-400/60 text-purple-200 hover:bg-purple-400/10 disabled:opacity-50">
          🔬 应用到 项目参考 · 深层
        </button>
        <button disabled={applying} onClick={onIgnore}
          className="px-3 py-1.5 rounded text-text-muted hover:bg-bg-hover">
          忽略
        </button>
      </div>
    </div>
  )
}
