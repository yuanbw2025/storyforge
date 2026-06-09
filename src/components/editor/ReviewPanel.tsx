/**
 * 质量审校面板 — Phase F
 *
 * 集成三套质量检测：审校(F1)、去AI味(F2)、追读力(F3)
 */
import { useState } from 'react'
import { X, ShieldCheck, Bot, TrendingUp, Loader2, AlertTriangle, AlertCircle, Info } from 'lucide-react'
import { useAIStream } from '../../hooks/useAIStream'
import { buildReviewPrompt, parseReviewResult, REVIEW_DIMENSION_LABELS, type ReviewResult } from '../../lib/ai/adapters/review-adapter'
import { buildAntiAIPrompt, parseAntiAIResult, ANTI_AI_DIMENSION_LABELS, extractHighFreqWords, type AntiAIResult } from '../../lib/ai/adapters/anti-ai-adapter'
import { buildReadabilityPrompt, parseReadabilityResult, READABILITY_DIMENSION_LABELS, type ReadabilityResult } from '../../lib/ai/adapters/readability-adapter'

interface Props {
  chapterContent: string
  chapterTitle: string
  worldContext: string
  characterContext: string
  prevChapterSummary: string
  nextChapterSummary: string
  foreshadowContext: string
  stateContext: string
  onClose: () => void
}

type TabType = 'review' | 'antiAI' | 'readability'

const TABS: { key: TabType; label: string; icon: typeof ShieldCheck }[] = [
  { key: 'review', label: '审校', icon: ShieldCheck },
  { key: 'antiAI', label: '去AI味', icon: Bot },
  { key: 'readability', label: '追读力', icon: TrendingUp },
]

export default function ReviewPanel(props: Props) {
  const { chapterContent, chapterTitle, worldContext, characterContext,
    prevChapterSummary, nextChapterSummary, foreshadowContext, stateContext, onClose } = props

  const [activeTab, setActiveTab] = useState<TabType>('review')
  const ai = useAIStream()

  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [antiAIResult, setAntiAIResult] = useState<AntiAIResult | null>(null)
  const [readabilityResult, setReadabilityResult] = useState<ReadabilityResult | null>(null)

  const handleRunReview = async () => {
    const messages = buildReviewPrompt(
      chapterContent, chapterTitle, worldContext,
      characterContext, prevChapterSummary, foreshadowContext, stateContext
    )
    const output = await ai.start(messages)
    const result = parseReviewResult(output)
    if (result) setReviewResult(result)
  }

  const handleRunAntiAI = async () => {
    const highFreq = extractHighFreqWords(chapterContent)
    const messages = buildAntiAIPrompt(chapterContent, highFreq.map(w => w.replace(/\(\d+次\)/, '')))
    const output = await ai.start(messages)
    const result = parseAntiAIResult(output)
    if (result) setAntiAIResult(result)
  }

  const handleRunReadability = async () => {
    const messages = buildReadabilityPrompt(
      chapterContent, chapterTitle, prevChapterSummary, nextChapterSummary
    )
    const output = await ai.start(messages)
    const result = parseReadabilityResult(output)
    if (result) setReadabilityResult(result)
  }

  const handleRun = () => {
    if (activeTab === 'review') handleRunReview()
    else if (activeTab === 'antiAI') handleRunAntiAI()
    else handleRunReadability()
  }

  const currentResult = activeTab === 'review' ? reviewResult
    : activeTab === 'antiAI' ? antiAIResult : readabilityResult

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden shadow-lg">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border">
        <div className="flex items-center gap-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={ai.isStreaming || !chapterContent}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {ai.isStreaming ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {ai.isStreaming ? '检测中...' : '开始检测'}
          </button>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-4 max-h-[50vh] overflow-y-auto">
        {ai.error && (
          <div className="text-xs text-error bg-error/10 px-3 py-2 rounded-lg mb-3">{ai.error}</div>
        )}

        {!currentResult && !ai.isStreaming && (
          <div className="text-center py-8 text-text-muted text-sm">
            点击「开始检测」运行{activeTab === 'review' ? '审校' : activeTab === 'antiAI' ? '去AI味检测' : '追读力评估'}
          </div>
        )}

        {ai.isStreaming && (
          <div className="flex items-center justify-center py-8 gap-2 text-text-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            AI 正在分析...
            {ai.output.length > 0 && (
              <span className="text-xs">≈ ~{Math.round(ai.output.length * 1.5).toLocaleString()} tokens</span>
            )}
          </div>
        )}
        {ai.tokenUsage && !ai.isStreaming && (
          <div className="text-[10px] text-text-muted mb-2" title={`输入 ${ai.tokenUsage.inputTokens} + 输出 ${ai.tokenUsage.outputTokens}`}>
            Token: ↑{ai.tokenUsage.inputTokens.toLocaleString()} ↓{ai.tokenUsage.outputTokens.toLocaleString()}
          </div>
        )}

        {/* F1: 审校结果 */}
        {activeTab === 'review' && reviewResult && !ai.isStreaming && (
          <ReviewResultView result={reviewResult} />
        )}

        {/* F2: 去AI味结果 */}
        {activeTab === 'antiAI' && antiAIResult && !ai.isStreaming && (
          <AntiAIResultView result={antiAIResult} />
        )}

        {/* F3: 追读力结果 */}
        {activeTab === 'readability' && readabilityResult && !ai.isStreaming && (
          <ReadabilityResultView result={readabilityResult} />
        )}
      </div>
    </div>
  )
}

// ── 评分徽章 ──

function ScoreBadge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  const color = score >= 80 ? 'text-success bg-success/10'
    : score >= 60 ? 'text-warning bg-warning/10'
    : 'text-error bg-error/10'

  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-lg font-bold px-3 py-1.5'

  return <span className={`rounded-full ${color} ${sizeClass}`}>{score}</span>
}

// ── 严重度图标 ──

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <AlertCircle className="w-3.5 h-3.5 text-error" />
  if (severity === 'warning') return <AlertTriangle className="w-3.5 h-3.5 text-warning" />
  return <Info className="w-3.5 h-3.5 text-info" />
}

// ── F1: 审校结果视图 ──

function ReviewResultView({ result }: { result: ReviewResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScoreBadge score={result.overallScore} />
        <span className="text-sm text-text-primary font-medium">综合评分</span>
      </div>

      {result.issues.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">发现的问题</h4>
          {result.issues.map((issue, idx) => (
            <div key={idx} className="flex items-start gap-2 bg-bg-base rounded-lg p-3">
              <SeverityIcon severity={issue.severity} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-elevated rounded text-text-muted">
                    {REVIEW_DIMENSION_LABELS[issue.dimension] || issue.dimension}
                  </span>
                </div>
                <p className="text-xs text-text-primary mt-1">{issue.description}</p>
                {issue.quote && (
                  <p className="text-[10px] text-text-muted mt-1 italic border-l-2 border-border pl-2">{issue.quote}</p>
                )}
                <p className="text-xs text-accent mt-1">💡 {issue.suggestion}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {result.suggestions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">总体建议</h4>
          <ul className="space-y-1">
            {result.suggestions.map((s, i) => (
              <li key={i} className="text-xs text-text-secondary flex items-start gap-1.5">
                <span className="text-accent mt-0.5">•</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── F2: 去AI味结果视图 ──

function AntiAIResultView({ result }: { result: AntiAIResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScoreBadge score={result.overallScore} />
        <span className="text-sm text-text-primary font-medium">人味指数（越高越好）</span>
      </div>

      {result.dimensions.length > 0 && (
        <div className="space-y-2">
          {result.dimensions.map((dim, idx) => (
            <div key={idx} className="bg-bg-base rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-text-primary">
                  {ANTI_AI_DIMENSION_LABELS[dim.dimension] || dim.dimension}
                </span>
                <ScoreBadge score={dim.score} size="sm" />
              </div>
              {dim.markers.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {dim.markers.slice(0, 5).map((m, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 bg-error/10 text-error rounded">
                      {m.slice(0, 30)}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-accent">💡 {dim.suggestion}</p>
            </div>
          ))}
        </div>
      )}

      {result.highFreqWords.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">高频词警告</h4>
          <div className="flex flex-wrap gap-1">
            {result.highFreqWords.map((w, i) => (
              <span key={i} className="text-[10px] px-2 py-1 bg-warning/10 text-warning rounded-full">{w}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── F3: 追读力结果视图 ──

function ReadabilityResultView({ result }: { result: ReadabilityResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScoreBadge score={result.overallScore} />
        <span className="text-sm text-text-primary font-medium">追读力评分</span>
      </div>

      {result.dimensions.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {result.dimensions.map((dim, idx) => {
            const meta = READABILITY_DIMENSION_LABELS[dim.dimension]
            return (
              <div key={idx} className="bg-bg-base rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-text-primary">
                    {meta?.emoji} {meta?.label || dim.dimension}
                  </span>
                  <ScoreBadge score={dim.score} size="sm" />
                </div>
                <p className="text-[10px] text-text-muted">{dim.description}</p>
                <p className="text-[10px] text-accent mt-1">💡 {dim.suggestion}</p>
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {result.highlights.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-success mb-1">✨ 亮点</h4>
            <ul className="space-y-0.5">
              {result.highlights.map((h, i) => (
                <li key={i} className="text-[10px] text-text-secondary">• {h}</li>
              ))}
            </ul>
          </div>
        )}
        {result.weaknesses.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-warning mb-1">⚠️ 薄弱</h4>
            <ul className="space-y-0.5">
              {result.weaknesses.map((w, i) => (
                <li key={i} className="text-[10px] text-text-secondary">• {w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
