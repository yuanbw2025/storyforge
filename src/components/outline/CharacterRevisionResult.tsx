import { AlertTriangle, Check, Clipboard, Loader2, X } from 'lucide-react'
import type { CharacterRevisionPlan } from '../../lib/story-planning/character-revision'

interface Props {
  analysis: CharacterRevisionPlan
  selectedOptionId: string | null
  selectedPatchIds: Set<number>
  applying: boolean
  onSelectOption: (id: string) => void
  onTogglePatch: (outlineNodeId: number) => void
  onCopy: () => void
  onApply: () => void
  onReject?: () => void
}

export default function CharacterRevisionResult({
  analysis,
  selectedOptionId,
  selectedPatchIds,
  applying,
  onSelectOption,
  onTogglePatch,
  onCopy,
  onApply,
  onReject,
}: Props) {
  const selectedOption = analysis.options.find(option => option.id === selectedOptionId) ?? null
  return (
    <section className="space-y-4 rounded-lg border border-border bg-bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-text-primary">影响分析结果</h3>
        <button onClick={onCopy} className="ml-auto inline-flex items-center gap-1 text-xs text-accent">
          <Clipboard className="w-3.5 h-3.5" />复制修订计划
        </button>
      </div>
      <p className="text-sm text-text-primary">{analysis.changeSummary}</p>
      <p className="text-xs text-text-muted">{analysis.scopeSummary}</p>

      {analysis.warnings.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800">
          <div className="mb-1 flex items-center gap-1 font-medium">
            <AlertTriangle className="w-3.5 h-3.5" />边界与证据提示
          </div>
          {analysis.warnings.map(warning => <p key={warning}>• {warning}</p>)}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <ResultList
          title={`受影响已写章节（${analysis.affectedWrittenChapters.length}）`}
          items={analysis.affectedWrittenChapters.map(item =>
            `第${item.ordinal}章 ${item.title}｜${item.severity}｜${item.reason}`,
          )}
          empty="未定位到需要修改的已写章节"
        />
        <ResultList
          title={`不可破坏事实（${analysis.immutableFacts.length}）`}
          items={analysis.immutableFacts.map(item =>
            `${item.sourceChapterOrdinal ? `第${item.sourceChapterOrdinal}章｜` : ''}${item.statement}`
            + (item.evidenceQuote ? `｜证据：${item.evidenceQuote}` : '｜证据不足'),
          )}
          empty="没有足够证据形成硬事实清单"
        />
        <ResultList
          title={`冲突清单（${analysis.conflicts.length}）`}
          items={analysis.conflicts.map(item => `${item.severity}｜${item.title}：${item.reason}`)}
          empty="未发现明确冲突"
        />
        <ResultList
          title={`补伏笔建议（${analysis.foreshadowSuggestions.length}）`}
          items={analysis.foreshadowSuggestions.map(item =>
            `第${item.chapterOrdinal}章 ${item.title}：${item.suggestion}`
            + (item.writtenRegion ? '（仅人工建议，不会写回）' : ''),
          )}
          empty="无需额外补伏笔"
        />
      </div>

      {analysis.mainPlotSuggestion && (
        <div className="rounded border border-border bg-bg-base p-3">
          <h4 className="mb-1 text-xs font-medium text-text-primary">主线影响建议（只读）</h4>
          <p className="text-xs text-text-muted whitespace-pre-wrap">{analysis.mainPlotSuggestion}</p>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-medium text-text-primary">选择一档后续方案</h4>
        <div className="grid gap-3 lg:grid-cols-3">
          {analysis.options.map(option => (
            <button
              key={option.id}
              onClick={() => onSelectOption(option.id)}
              className={`rounded-lg border p-3 text-left ${
                selectedOptionId === option.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg-base'
              }`}
            >
              <strong className="text-sm text-text-primary">{option.label}</strong>
              <span className="ml-2 text-[10px] text-text-muted">{option.patches.length} 个 patch</span>
              <p className="mt-1 text-xs text-text-muted">{option.summary}</p>
              {option.risks.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-700">风险：{option.risks.join('；')}</p>
              )}
            </button>
          ))}
        </div>
      </div>

      {selectedOption && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-medium text-text-primary">逐项预览和选择大纲 patch</h4>
            <span className="text-xs text-text-muted">{selectedPatchIds.size} 项待应用</span>
          </div>
          {selectedOption.patches.length === 0 ? (
            <div className="rounded border border-dashed border-border p-4 text-center text-xs text-text-muted">
              这一档没有通过安全边界的可应用 patch，可复制计划后手工处理。
            </div>
          ) : (
            <div className="space-y-2">
              {selectedOption.patches.map(patch => (
                <label key={patch.outlineNodeId} className="block rounded border border-border bg-bg-base p-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedPatchIds.has(patch.outlineNodeId)}
                      onChange={() => onTogglePatch(patch.outlineNodeId)}
                      className="mt-1 accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-text-primary">
                        第{patch.ordinal}章 · {patch.title}
                        {patch.anchorProtected && <span className="ml-2 text-amber-700">锚点</span>}
                      </div>
                      {patch.currentTitle !== patch.proposedTitle && (
                        <p className="mt-1 text-xs">
                          <span className="text-text-muted line-through">{patch.currentTitle}</span>
                          <span className="mx-1 text-accent">→</span>
                          <span className="text-text-primary">{patch.proposedTitle}</span>
                        </p>
                      )}
                      <div className="mt-1 grid gap-1 text-xs md:grid-cols-2">
                        <p className="rounded bg-red-500/5 p-2 text-text-muted whitespace-pre-wrap">
                          原：{patch.currentSummary || '无摘要'}
                        </p>
                        <p className="rounded bg-green-500/5 p-2 text-text-primary whitespace-pre-wrap">
                          新：{patch.proposedSummary || '无摘要'}
                        </p>
                      </div>
                      {patch.reason && <p className="mt-1 text-[11px] text-text-muted">原因：{patch.reason}</p>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <button
          onClick={onApply}
          disabled={!selectedPatchIds.size || applying}
          className="inline-flex items-center gap-1.5 rounded bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          应用选中 patch 到未写大纲
        </button>
        {onReject && (
          <button
            onClick={onReject}
            disabled={applying}
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 text-sm text-text-muted disabled:opacity-40"
          >
            <X className="w-4 h-4" />拒绝本次方案
          </button>
        )}
        <span className="text-xs text-text-muted">应用前会重新检查，不会改正文和 storyCore</span>
      </div>
    </section>
  )
}

function ResultList({
  title,
  items,
  empty,
}: {
  title: string
  items: string[]
  empty: string
}) {
  return (
    <div className="rounded border border-border bg-bg-base p-3">
      <h4 className="mb-2 text-xs font-medium text-text-primary">{title}</h4>
      {items.length
        ? items.map(item => <p key={item} className="mb-1 text-xs text-text-muted">• {item}</p>)
        : <p className="text-xs text-text-muted">{empty}</p>}
    </div>
  )
}
