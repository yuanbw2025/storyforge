import { useState, useEffect } from 'react'
import { Loader2, Sparkles, Check, ChevronRight, Layers, RotateCw, Star, StarOff, GitBranch, AlertCircle, CheckCircle } from 'lucide-react'
import type { ChunkedGenerationProgress, ChunkedGenerationResult, StoryArcCompliance } from '../../lib/outline/chunked-generator'
import type { DirectionTemplate } from '../../lib/outline/direction-template'
import { translateTrackName } from '../../lib/outline/direction-template'

// 故事线符合度显示组件
function StoryArcComplianceDisplay({ compliance }: { compliance?: StoryArcCompliance }) {
  if (!compliance) return null

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-success'
    if (score >= 60) return 'text-warning'
    return 'text-error'
  }

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-success/10'
    if (score >= 60) return 'bg-warning/10'
    return 'bg-error/10'
  }

  return (
    <div className="mt-2 pt-2 border-t border-border">
      <div className="flex items-center gap-1 text-[10px] text-accent mb-1">
        <GitBranch className="w-3 h-3" />
        <span className="font-medium">故事线符合度</span>
        {compliance.storyArcStage && (
          <span className="text-text-muted">({compliance.storyArcStage})</span>
        )}
      </div>
      
      <div className="flex items-center gap-2">
        <div className={`px-2 py-0.5 rounded text-[10px] font-medium ${getScoreBg(compliance.score)} ${getScoreColor(compliance.score)}`}>
          {compliance.score}%
        </div>
        
        {compliance.coveredEvents.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-success">
            <CheckCircle className="w-3 h-3" />
            <span>{compliance.coveredEvents.length} 个关键事件</span>
          </div>
        )}
        
        {compliance.missingEvents.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-warning">
            <AlertCircle className="w-3 h-3" />
            <span>缺 {compliance.missingEvents.length} 个</span>
          </div>
        )}
      </div>

      {compliance.missingEvents.length > 0 && (
        <div className="mt-1 text-[10px] text-warning">
          建议补充：{compliance.missingEvents.slice(0, 2).join('、')}
          {compliance.missingEvents.length > 2 && '...'}
        </div>
      )}
    </div>
  )
}

interface Props {
  progress: ChunkedGenerationProgress | null
  result: ChunkedGenerationResult | null
  onSelectChoice: (choiceId: string) => void
  onCancel: () => void
  onApplyResult: () => void
  onRegenerate: () => void
  onToggleFavorite: (choiceId: string) => void
  favorites: Set<string>
  isRunning: boolean
  isRegenerating: boolean
}

export default function ChunkedGenerationPanel({
  progress,
  result,
  onSelectChoice,
  onCancel,
  onApplyResult,
  onRegenerate,
  onToggleFavorite,
  favorites,
  isRunning,
  isRegenerating,
}: Props) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (progress?.waitingForChoice && progress.currentBlockIndex !== undefined) {
      setExpandedBlocks(prev => new Set([...prev, progress.currentBlockIndex]))
    }
  }, [progress?.waitingForChoice, progress?.currentBlockIndex])

  if (!progress && !result) return null

  if (result) {
    const totalChapters = result.totalChapters
    const completedBlocks = result.blocks.length

    return (
      <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <span className="text-sm font-medium text-text-primary">精细生成完成</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-text-muted border border-border rounded hover:text-text-primary"
            >
              取消
            </button>
            <button
              onClick={onApplyResult}
              className="px-3 py-1.5 text-xs text-white bg-accent rounded hover:bg-accent-hover"
            >
              应用结果
            </button>
          </div>
        </div>

        <div className="text-xs text-text-secondary">
          共生成 {completedBlocks} 块，{totalChapters} 章
        </div>

        <div className="space-y-2">
          {result.blocks.map((block) => {
            const expectedCount = block.chapterRange[1] - block.chapterRange[0] + 1
            const actualCount = block.chapters.length
            const countDiff = actualCount - expectedCount
            const hasDiff = countDiff !== 0

            return (
              <div key={block.blockIndex} className="border border-border rounded-md overflow-hidden">
                <button
                  onClick={() => {
                    const next = new Set(expandedBlocks)
                    if (next.has(block.blockIndex)) next.delete(block.blockIndex)
                    else next.add(block.blockIndex)
                    setExpandedBlocks(next)
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 bg-bg-surface hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-accent" />
                    <span className="text-xs font-medium text-text-primary">
                      第 {block.blockIndex + 1} 块：{block.blockLabel}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      章节 {block.chapterRange[0] + 1}-{block.chapterRange[1] + 1}
                    </span>
                    {hasDiff ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${countDiff > 0 ? 'bg-warning/10 text-warning' : 'bg-info/10 text-info'}`}>
                        预期 {expectedCount} 章 · 实际 {actualCount} 章 {countDiff > 0 ? `(+${countDiff})` : `(${countDiff})`}
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-muted">
                        · {actualCount} 章 ✓
                      </span>
                    )}
                  </div>
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-text-muted transition-transform ${
                      expandedBlocks.has(block.blockIndex) ? 'rotate-90' : ''
                    }`}
                  />
                </button>
                {expandedBlocks.has(block.blockIndex) && (
                  <div className="px-3 py-2 bg-bg-elevated border-t border-border space-y-3">
                    {block.selectedChoice && (
                      <div>
                        <div className="text-[10px] text-text-muted mb-1">选定的剧情走向</div>
                        <div className="border border-accent/30 rounded-md p-2 bg-bg-surface">
                          <div className="text-xs font-medium text-text-primary mb-1">
                            《{block.selectedChoice.title}》
                          </div>
                          <DirectionTemplateDisplay template={block.selectedChoice.template} />
                          <div className="mt-2 pt-1 border-t border-border flex items-center justify-between text-[10px]">
                            <div className="text-text-muted">
                              主轨：<span className="text-accent">{translateTrackName(block.selectedChoice.focus.mainTrack)}</span>
                            </div>
                            <TensionDisplay value={block.selectedChoice.focus.targetTension} compact />
                          </div>
                        </div>
                      </div>
                    )}
                    {block.chapters.length > 0 && (
                      <div>
                        <div className="text-[10px] text-text-muted mb-1">生成的章节（{block.chapters.length} 章）</div>
                        <div className="space-y-1 max-h-60 overflow-y-auto">
                          {block.chapters.map((ch, idx) => (
                            <div key={idx} className="border border-border rounded px-2 py-1.5 bg-bg-surface">
                              <div className="text-xs text-text-primary font-medium">
                                {ch.title}
                              </div>
                              {ch.summary && (
                                <div className="text-[10px] text-text-secondary mt-0.5 line-clamp-2">
                                  {ch.summary}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (progress) {
    const { currentBlockIndex, totalBlocks, currentBlockLabel, stage, waitingForChoice, choices } = progress

    const currentChoice = choices?.[0]
    const favoriteChoices = choices?.filter(c => favorites.has(c.id)) ?? []

    return (
      <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isRunning && !isRegenerating && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
            {isRegenerating && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
            <span className="text-sm font-medium text-text-primary">
              {waitingForChoice ? '审阅剧情走向' : '精细生成中'}
            </span>
          </div>
          {!waitingForChoice && isRunning && (
            <button
              onClick={onCancel}
              className="px-2.5 py-1 text-xs text-text-muted border border-border rounded hover:text-text-primary"
            >
              取消
            </button>
          )}
        </div>

        <div className="w-full bg-border rounded-full h-2">
          <div
            className="bg-accent h-2 rounded-full transition-all"
            style={{ width: `${((currentBlockIndex + (waitingForChoice ? 0.5 : 1)) / totalBlocks) * 100}%` }}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">进度：</span>
            <span className="text-accent font-medium">
              {currentBlockIndex + 1} / {totalBlocks}
            </span>
            <span className="text-text-muted">·</span>
            <span className="text-text-primary">{currentBlockLabel}</span>
          </div>
          <div className="text-xs text-text-secondary">{stage}</div>
        </div>

        {waitingForChoice && currentChoice && (
          <div className="space-y-3 border-t border-accent/20 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs font-medium text-text-primary">当前方案</span>
              </div>
              <div className="text-[10px] text-text-muted">
                已收藏 {favoriteChoices.length} 个方案
              </div>
            </div>

            <div className="border border-accent/30 rounded-md overflow-hidden bg-bg-surface">
              <div className="p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="text-sm font-medium text-text-primary flex-1">
                    《{currentChoice.title}》
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onToggleFavorite(currentChoice.id)}
                      className={`p-1 rounded transition-colors ${
                        favorites.has(currentChoice.id) 
                          ? 'text-yellow-500' 
                          : 'text-text-muted hover:text-yellow-500'
                      }`}
                      title={favorites.has(currentChoice.id) ? '取消收藏' : '收藏此方案'}
                    >
                      {favorites.has(currentChoice.id) ? <Star className="w-4 h-4 fill-current" /> : <StarOff className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                <DirectionTemplateDisplay template={currentChoice.template} />
                
                <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-[10px]">
                  <div className="text-text-muted">
                    主轨：<span className="text-accent">{translateTrackName(currentChoice.focus.mainTrack)}</span>
                  </div>
                  <TensionDisplay value={currentChoice.focus.targetTension} />
                </div>
                
                {/* 故事线符合度 */}
                <StoryArcComplianceDisplay compliance={currentChoice.storyArcCompliance} />
              </div>
              
              <div className="border-t border-border flex">
                <button
                  onClick={onRegenerate}
                  disabled={isRegenerating}
                  className="flex-1 py-2 text-xs text-text-muted hover:text-accent hover:bg-accent/10 transition-colors flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed border-r border-border"
                  title="重新生成一个新方案"
                >
                  <RotateCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                  {isRegenerating ? '生成中...' : '重新生成'}
                </button>
                <button
                  onClick={() => onSelectChoice(currentChoice.id)}
                  className="flex-1 py-2 text-xs text-accent hover:bg-accent/10 transition-colors flex items-center justify-center gap-1"
                  title="选定此方案"
                >
                  <Check className="w-3 h-3" />
                  选定此方案
                </button>
              </div>
            </div>

            {favoriteChoices.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-text-muted flex items-center gap-1">
                  <Star className="w-3 h-3 text-yellow-500 fill-current" />
                  收藏的候选方案
                </div>
                <div className="space-y-1.5">
                  {favoriteChoices.map((choice) => (
                    <div key={choice.id} className="border border-border rounded-md overflow-hidden bg-bg-elevated">
                      <div className="p-2">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-xs font-medium text-text-primary">
                            《{choice.title}》
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => onToggleFavorite(choice.id)}
                              className="p-0.5 rounded text-yellow-500 hover:bg-yellow-500/10"
                              title="取消收藏"
                            >
                              <Star className="w-3 h-3 fill-current" />
                            </button>
                          </div>
                        </div>
                        <div className="text-[10px] text-text-secondary line-clamp-2">
                          {choice.template.coreConflict || choice.description}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <div className="text-[10px] text-text-muted flex items-center gap-1">
                            {translateTrackName(choice.focus.mainTrack)}
                            <span className="text-text-muted">·</span>
                            <TensionDisplay value={choice.focus.targetTension} compact />
                          </div>
                          <button
                            onClick={() => onSelectChoice(choice.id)}
                            className="text-[10px] text-accent hover:underline"
                          >
                            选定
                          </button>
                        </div>
                        
                        {/* 收藏方案的故事线符合度 */}
                        <StoryArcComplianceDisplay compliance={choice.storyArcCompliance} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[10px] text-text-muted text-center">
              点击"重新生成"获取新方案，收藏满意的方案，最后"选定"开始生成章节
            </div>
          </div>
        )}

        {!waitingForChoice && !isRunning && (
          <div className="text-xs text-accent">生成中断</div>
        )}
      </div>
    )
  }

  return null
}

function TensionDisplay({ value, compact }: { value: number; compact?: boolean }) {
  const level = value > 7 ? '紧张' : value > 4 ? '中等' : '舒缓'
  const tooltip = `张力说明：\n\n当前张力值 ${value}/10 由 AI 根据本方案的剧情内容自评得出：\n• 1-3：舒缓（铺垫、日常、氛围营造）\n• 4-6：中等（推进情节、升级矛盾）\n• 7-10：紧张（冲突爆发、高潮、反转）\n\n不同走向方案的张力值不同，帮助你快速对比各方案的节奏差异。`
  
  return (
    <span
      className={`text-accent font-medium cursor-help ${compact ? '' : ''}`}
      title={tooltip}
    >
      张力：{value}/10
    </span>
  )
}

function DirectionTemplateDisplay({
  template,
}: {
  template: DirectionTemplate
}) {
  const [expanded, setExpanded] = useState(false)
  const hasContent = template.coreConflict || template.characterChange || template.keyEvents.length > 0
  
  if (!hasContent) {
    return (
      <div className="text-xs text-text-secondary line-clamp-3">
        {template.title || '（方案描述待生成）'}
      </div>
    )
  }

  return (
    <div className="text-xs text-text-secondary space-y-1">
      {template.coreConflict && (
        <div className="flex gap-1">
          <span className="text-text-muted flex-shrink-0 w-12">冲突：</span>
          <span className={expanded ? '' : 'line-clamp-2'}>{template.coreConflict}</span>
        </div>
      )}
      {template.characterChange && (
        <div className="flex gap-1">
          <span className="text-text-muted flex-shrink-0 w-12">变化：</span>
          <span className={expanded ? '' : 'line-clamp-2'}>{template.characterChange}</span>
        </div>
      )}
      {template.keyEvents.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">关键事件：</span>
            {template.keyEvents.length > 3 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[10px] text-accent hover:underline"
              >
                {expanded ? '收起' : `展开全部 (${template.keyEvents.length})`}
              </button>
            )}
          </div>
          <div className="pl-4 space-y-0.5 mt-0.5">
            {(expanded ? template.keyEvents : template.keyEvents.slice(0, 3)).map((event, i) => (
              <div key={i} className={expanded ? 'text-text-secondary' : 'text-text-secondary line-clamp-1'}>• {event}</div>
            ))}
            {!expanded && template.keyEvents.length > 3 && (
              <button
                onClick={() => setExpanded(true)}
                className="text-[10px] text-accent hover:underline mt-0.5"
              >
                显示更多 {template.keyEvents.length - 3} 个事件
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
