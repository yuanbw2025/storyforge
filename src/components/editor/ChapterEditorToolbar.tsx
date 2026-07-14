import { BookOpenCheck, ClipboardList, ShieldCheck, StickyNote } from 'lucide-react'
import { CInput } from '../shared/CompositionInput'

interface Props {
  isStreaming: boolean
  hasText: boolean
  extractingState: boolean
  extractingFacts: boolean
  factStreaming: boolean
  analyzingImpact: boolean
  impactInfo: string | null
  hasOutline: boolean
  showOutlinePreview: boolean
  showReviewPanel: boolean
  showNotePanel: boolean
  customInstruction: string
  onGenerate: () => void
  onContinue: () => void
  onExpand: () => void
  onPolish: () => void
  onDeAI: () => void
  onExtractState: () => void
  onExtractFacts: () => void
  onAnalyzeImpact: () => void
  onDismissImpact: () => void
  onToggleOutlinePreview: () => void
  onToggleReviewPanel: () => void
  onToggleNotePanel: () => void
  onCustomInstructionChange: (value: string) => void
}

export default function ChapterEditorToolbar({
  isStreaming,
  hasText,
  extractingState,
  extractingFacts,
  factStreaming,
  analyzingImpact,
  impactInfo,
  hasOutline,
  showOutlinePreview,
  showReviewPanel,
  showNotePanel,
  customInstruction,
  onGenerate,
  onContinue,
  onExpand,
  onPolish,
  onDeAI,
  onExtractState,
  onExtractFacts,
  onAnalyzeImpact,
  onDismissImpact,
  onToggleOutlinePreview,
  onToggleReviewPanel,
  onToggleNotePanel,
  onCustomInstructionChange,
}: Props) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-border/60 bg-bg-surface/35 px-6 py-3">
      <button onClick={onGenerate} disabled={isStreaming}
        className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors">
        ✨ 生成正文
      </button>
      <button onClick={onContinue} disabled={isStreaming || !hasText}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
        📝 续写
      </button>
      <button onClick={onExpand} disabled={isStreaming}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
        📖 扩写
      </button>
      <button onClick={onPolish} disabled={isStreaming}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
        💎 润色
      </button>
      <button onClick={onDeAI} disabled={isStreaming}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
        🔥 去AI味
      </button>
      <button onClick={onExtractState} disabled={isStreaming || extractingState || !hasText}
        title="AI 分析本章内容，提取角色/地点/物品等状态变更"
        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-md hover:bg-emerald-500/20 disabled:opacity-50 transition-colors">
        <ClipboardList className="w-3 h-3" />
        {extractingState ? '提取中...' : '提取状态'}
      </button>
      <button onClick={onExtractFacts} disabled={factStreaming || extractingFacts || !hasText}
        title="NS-4：AI 从本章正文抽取受控事实，落入事实账本候选（作者确认后注回后续生成，长期一致性）"
        className="flex items-center gap-1 px-3 py-1.5 bg-sky-500/10 text-sky-400 text-xs rounded-md hover:bg-sky-500/20 disabled:opacity-50 transition-colors">
        <ClipboardList className="w-3 h-3" />
        {extractingFacts ? '抽取中...' : '提取事实'}
      </button>
      <button onClick={onAnalyzeImpact} disabled={analyzingImpact || !hasText}
        title="NS-6：改了历史章后，检查源自本章的事实证据是否失效（失效则降级待复核），并列出需复核的后续章节。不会自动改正文。"
        className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/10 text-amber-400 text-xs rounded-md hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
        <ClipboardList className="w-3 h-3" />
        {analyzingImpact ? '分析中...' : '影响分析'}
      </button>
      {impactInfo && (
        <span className="flex items-center gap-2 px-2 py-1 text-xs text-amber-300/90 bg-amber-500/5 rounded-md">
          {impactInfo}
          <button onClick={onDismissImpact} aria-label="关闭影响分析结果" className="text-text-muted hover:text-text-primary">×</button>
        </span>
      )}
      {hasOutline && (
        <button onClick={onToggleOutlinePreview}
          title="大纲预览"
          aria-pressed={showOutlinePreview}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            showOutlinePreview
              ? 'bg-accent/10 text-accent'
              : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}>
          <BookOpenCheck className="w-3 h-3" />
          大纲预览
        </button>
      )}
      <button onClick={onToggleReviewPanel}
        disabled={!hasText}
        title="质量审校"
        aria-pressed={showReviewPanel}
        className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50 ${
          showReviewPanel
            ? 'bg-success/10 text-success'
            : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
        }`}>
        <ShieldCheck className="w-3 h-3" />
        质量审校
      </button>
      <button onClick={onToggleNotePanel}
        title="便签"
        aria-pressed={showNotePanel}
        className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
          showNotePanel
            ? 'bg-yellow-500/10 text-yellow-600'
            : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
        }`}>
        <StickyNote className="w-3 h-3" />
        便签
      </button>
      <CInput value={customInstruction} onChange={event => onCustomInstructionChange(event.target.value)}
        placeholder="自定义指令..."
        className="min-w-[220px] flex-1 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent" />
    </div>
  )
}
