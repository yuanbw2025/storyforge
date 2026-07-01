/**
 * Phase 28.2 — 结构化分析报告查看器
 *
 * 替代原 ChunkAnalysisViewer，新增：
 *  · 左侧 TOC 侧边导航（按维度分组 + 锚点跳转）
 *  · 合并视图（去重后按维度展示）+ 分块视图（原始逐块查看）
 *  · 角色合并卡片
 *  · 全书 AI 总结展示
 *  · 每条标注 chunk 来源
 */
import { useState, useMemo, useRef, useCallback } from 'react'
import {
  ChevronDown, ChevronRight, Loader2, Sparkles,
  Users2,
} from 'lucide-react'
import type { Reference, ReferenceChunkAnalysis, AnalysisDimension } from '../../lib/types'
import { DIMENSION_LABELS } from '../../lib/types/reference'
import {
  mergeAnalysisResults, buildSummaryPrompt,
  collectCharacterCraftTexts, buildCharacterMergePrompt, parseCharacterMergeOutput,
  type MergedAnalysisResult, type MergedDimension, type AIMergedCharacter,
} from '../../lib/reference-analysis/merge-analysis'
import { chat } from '../../lib/ai/client'
import { useAIConfigStore } from '../../stores/ai-config'
import { useReferenceStore } from '../../stores/reference'
import { extractJSON } from '../../lib/ai/adapters/import-adapter'
import { useToast } from '../shared/Toast'

const DIM_COLORS: Partial<Record<AnalysisDimension, string>> = {
  narrativeStyle:     'text-blue-400',
  openingTechnique:   'text-amber-400',
  plotStructure:      'text-green-400',
  pacingControl:      'text-lime-400',
  climaxDesign:       'text-orange-400',
  conflictEscalation: 'text-red-400',
  characterCraft:     'text-purple-400',
  dialogueTechnique:  'text-fuchsia-400',
  proseStyle:         'text-pink-400',
  emotionalBeats:     'text-rose-400',
  foreshadowing:      'text-cyan-400',
  worldBuilding:      'text-teal-400',
  otherTechniques:    'text-slate-400',
  historicalContext:   'text-[#C17D5E]',
  socialInstitutions: 'text-[#B06B7B]',
  dailyLife:          'text-[#7BA08A]',
  materialCulture:    'text-[#B08B6B]',
  languageCustoms:    'text-[#8B7BB0]',
}

interface Props {
  reference: Reference
  chunks: ReferenceChunkAnalysis[]
  isHistorical: boolean
}

export default function AnalysisReportViewer({ reference, chunks, isHistorical }: Props) {
  const toast = useToast()
  const [view, setView] = useState<'merged' | 'chunks'>('merged')
  const [activeDim, setActiveDim] = useState<string | null>(null)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [aggregatingChars, setAggregatingChars] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const { updateReference } = useReferenceStore()

  // 合并分析结果（维度部分本地去重；角色部分由 AI 聚合，见下）
  const merged = useMemo(
    () => mergeAnalysisResults(chunks, isHistorical),
    [chunks, isHistorical],
  )

  // 解析已有的 AI 角色聚合结果
  const aiCharacters = useMemo<AIMergedCharacter[]>(() => {
    if (!reference.mergedCharacters) return []
    try {
      const arr = JSON.parse(reference.mergedCharacters)
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }, [reference.mergedCharacters])

  // 是否存在可供 AI 聚合的人物塑造分析
  const hasCharacterCraft = useMemo(
    () => collectCharacterCraftTexts(chunks).length > 0,
    [chunks],
  )

  // 解析已有的 AI 总结
  const summaryMap = useMemo<Record<string, string>>(() => {
    if (!reference.analysisSummary) return {}
    try { return JSON.parse(reference.analysisSummary) } catch { return {} }
  }, [reference.analysisSummary])

  // 滚动到维度锚点
  const scrollToDim = useCallback((dimId: string) => {
    setActiveDim(dimId)
    const el = document.getElementById(`dim-${dimId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // AI 全书总结
  const handleGenerateSummary = async () => {
    if (!reference.id) return
    setGeneratingSummary(true)
    try {
      const { system, user } = buildSummaryPrompt(
        reference.title, reference.author || '', merged, isHistorical,
      )
      const config = useAIConfigStore.getState().config
      if (!config.apiKey) throw new Error('未配置 AI API Key')
      const output = await chat(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        { ...config, maxTokens: 4096 },
        { category: 'reference.summary', projectId: reference.projectId },
      )
      const json = extractJSON(output)
      if (json) {
        const summaryStr = JSON.stringify(json)
        await updateReference(reference.id, { analysisSummary: summaryStr })
      }
    } catch (err) {
      toast.error(`生成总结失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGeneratingSummary(false)
    }
  }

  // AI 角色卡聚合（替代正则抠名，彻底去重）
  const handleAggregateCharacters = async () => {
    if (!reference.id) return
    setAggregatingChars(true)
    try {
      const craftTexts = collectCharacterCraftTexts(chunks)
      if (craftTexts.length === 0) throw new Error('暂无人物塑造分析可供整理')
      const config = useAIConfigStore.getState().config
      if (!config.apiKey) throw new Error('未配置 AI API Key')
      const { system, user } = buildCharacterMergePrompt(
        reference.title, reference.author || '', craftTexts,
      )
      const output = await chat(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        { ...config, maxTokens: 4096 },
        { category: 'reference.characters', projectId: reference.projectId },
      )
      const characters = parseCharacterMergeOutput(output)
      if (characters.length === 0) throw new Error('AI 未能解析出角色，请重试')
      await updateReference(reference.id, { mergedCharacters: JSON.stringify(characters) })
    } catch (err) {
      toast.error(`整理角色卡失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAggregatingChars(false)
    }
  }

  // 非空维度
  const nonEmptyDims = merged.dimensions.filter(d => d.items.length > 0)

  return (
    <div className="space-y-4" ref={contentRef}>
      {/* 顶部横向目录导航（原左侧竖栏移到上方，释放横向空间，便于阅读长分析内容） */}
      <div className="sticky top-0 z-10 -mx-0.5 px-0.5 py-2 bg-bg-base/85 backdrop-blur-sm border-b border-border flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-text-muted uppercase tracking-wider mr-0.5">目录</span>

        {/* 总结区 */}
        {Object.keys(summaryMap).length > 0 && (
          <button
            onClick={() => {
              setView('merged')
              const el = document.getElementById('section-summary')
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className="px-2 py-1 text-xs rounded-md border border-accent/30 hover:bg-accent/10 text-accent transition-colors whitespace-nowrap"
          >
            📋 全书总结
          </button>
        )}

        {/* 角色区 */}
        {(aiCharacters.length > 0 || hasCharacterCraft) && (
          <button
            onClick={() => {
              setView('merged')
              const el = document.getElementById('section-characters')
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className="px-2 py-1 text-xs rounded-md border border-purple-400/30 hover:bg-purple-500/10 text-purple-400 transition-colors whitespace-nowrap"
          >
            👤 角色卡片{aiCharacters.length > 0 ? ` (${aiCharacters.length})` : ''}
          </button>
        )}

        {/* 维度列表 */}
        {nonEmptyDims.map(d => (
          <button
            key={d.dimension}
            onClick={() => { setView('merged'); scrollToDim(d.dimension) }}
            className={`px-2 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
              activeDim === d.dimension
                ? 'bg-accent/10 text-accent border-accent/40'
                : 'border-border/60 hover:bg-bg-hover text-text-muted'
            }`}
          >
            <span className={DIM_COLORS[d.dimension] || ''}>●</span>{' '}
            {d.label}
            <span className="text-text-muted/50 ml-1">({d.items.length})</span>
          </button>
        ))}

        {/* 分块视图入口 */}
        <button
          onClick={() => setView('chunks')}
          className={`px-2 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
            view === 'chunks' ? 'bg-accent/10 text-accent border-accent/40' : 'border-border/60 hover:bg-bg-hover text-text-muted'
          }`}
        >
          📦 按分块查看 ({merged.totalChunks})
        </button>
      </div>

      {/* 内容区（全宽） */}
      <div className="space-y-4">
        {/* 视图切换 + 总结按钮 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex bg-bg-elevated rounded-lg p-0.5">
            <button
              onClick={() => setView('merged')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                view === 'merged' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              合并视图
            </button>
            <button
              onClick={() => setView('chunks')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                view === 'chunks' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              分块视图
            </button>
          </div>

          {view === 'merged' && !reference.analysisSummary && (
            <button
              onClick={handleGenerateSummary}
              disabled={generatingSummary || nonEmptyDims.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {generatingSummary
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5" />}
              {generatingSummary ? '生成中…' : 'AI 全书总结'}
            </button>
          )}
        </div>

        {view === 'merged' ? (
          <MergedView
            merged={merged}
            summaryMap={summaryMap}
            aiCharacters={aiCharacters}
            hasCharacterCraft={hasCharacterCraft}
            onAggregate={handleAggregateCharacters}
            aggregating={aggregatingChars}
          />
        ) : (
          <ChunkListView chunks={chunks} isHistorical={isHistorical} />
        )}
      </div>
    </div>
  )
}

// ── 合并视图 ─────────────────────────────────────────────────

function MergedView({
  merged, summaryMap, aiCharacters, hasCharacterCraft, onAggregate, aggregating,
}: {
  merged: MergedAnalysisResult
  summaryMap: Record<string, string>
  aiCharacters: AIMergedCharacter[]
  hasCharacterCraft: boolean
  onAggregate: () => void
  aggregating: boolean
}) {
  const hasSummary = Object.keys(summaryMap).length > 0

  return (
    <div className="space-y-4">
      {/* AI 全书总结 */}
      {hasSummary && (
        <div id="section-summary" className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-accent flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            AI 全书总结
          </h3>
          <div className="space-y-2">
            {merged.dimensions
              .filter(d => summaryMap[d.dimension])
              .map(d => (
                <div key={d.dimension} className="rounded-lg bg-bg-surface border border-border/40 p-3">
                  <div className={`text-xs font-medium mb-1 ${DIM_COLORS[d.dimension] || 'text-text-muted'}`}>
                    {d.label}
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                    {summaryMap[d.dimension]}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 角色合并卡片（AI 聚合去重） */}
      {(aiCharacters.length > 0 || hasCharacterCraft) && (
        <div id="section-characters" className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-purple-400 flex items-center gap-1.5">
              <Users2 className="w-4 h-4" />
              角色分析（AI 聚合去重）
            </h3>
            {hasCharacterCraft && (
              <button
                onClick={onAggregate}
                disabled={aggregating}
                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-purple-400/30 text-purple-400 hover:bg-purple-500/10 transition disabled:opacity-50"
              >
                {aggregating
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 整理中…</>
                  : <><Sparkles className="w-3.5 h-3.5" /> {aiCharacters.length > 0 ? '重新整理角色卡' : 'AI 整理角色卡'}</>}
              </button>
            )}
          </div>
          {aiCharacters.length > 0 ? (
            <div className="grid gap-2">
              {aiCharacters.map(card => (
                <AICharacterCard key={card.name} card={card} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted leading-relaxed rounded-lg border border-dashed border-purple-400/20 bg-bg-surface px-3 py-2.5">
              点击「AI 整理角色卡」，让 AI 阅读所有分块的人物塑造分析，自动归并同一角色（含不同称呼）并去重，生成干净的角色清单。
            </p>
          )}
        </div>
      )}

      {/* 各维度 */}
      {merged.dimensions
        .filter(d => d.items.length > 0)
        .map(d => (
          <DimensionSection key={d.dimension} dim={d} />
        ))}
    </div>
  )
}

function DimensionSection({ dim }: { dim: MergedDimension }) {
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const displayItems = showAll ? dim.items : dim.items.slice(0, 5)
  const hasMore = dim.items.length > 5

  return (
    <div id={`dim-${dim.dimension}`} className="rounded-xl border border-border bg-bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-hover transition text-left"
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
        <span className={`text-sm font-semibold ${DIM_COLORS[dim.dimension] || 'text-text-primary'}`}>
          {dim.label}
        </span>
        <span className="text-xs text-text-muted ml-auto">{dim.items.length} 条</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {displayItems.map((item, i) => (
            <div key={i} className="rounded-lg border border-border/40 bg-bg-base px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted mb-1">
                <span className="px-1.5 py-0.5 rounded bg-bg-elevated">{item.sourceLabel}</span>
              </div>
              <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{item.text}</p>
            </div>
          ))}
          {hasMore && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-accent hover:underline"
            >
              展开剩余 {dim.items.length - 5} 条…
            </button>
          )}
          {showAll && hasMore && (
            <button
              onClick={() => setShowAll(false)}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              收起
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function AICharacterCard({ card }: { card: AIMergedCharacter }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-purple-400/20 bg-bg-surface overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-hover transition text-left"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        <span className="w-7 h-7 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0">
          {card.name.charAt(0)}
        </span>
        <span className="text-sm font-medium text-text-primary shrink-0">{card.name}</span>
        {card.role && (
          <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded shrink-0">{card.role}</span>
        )}
        {card.summary && (
          <span className="text-[11px] text-text-muted truncate">{card.summary}</span>
        )}
      </button>
      {expanded && card.analysis && (
        <div className="px-3 pb-3">
          <div className="rounded bg-bg-base border border-border/30 px-2.5 py-2">
            <p className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap">{card.analysis}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 分块视图 ─────────────────────────────────────────────────

function ChunkListView({ chunks, isHistorical }: { chunks: ReferenceChunkAnalysis[]; isHistorical: boolean }) {
  const sorted = useMemo(() => [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex), [chunks])
  const [selectedChunk, setSelectedChunk] = useState(0)

  const chunk = sorted[selectedChunk]
  if (!chunk) return null

  const histDims = new Set(['historicalContext', 'socialInstitutions', 'dailyLife', 'materialCulture', 'languageCustoms'])

  const visibleDimensions = (Object.keys(DIMENSION_LABELS) as AnalysisDimension[]).filter(dim => {
    if (isHistorical) return true
    return !histDims.has(dim)
  })

  return (
    <div className="space-y-3">
      {/* 块选择器 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-muted">分块：</span>
        <div className="flex flex-wrap gap-1">
          {sorted.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setSelectedChunk(i)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                i === selectedChunk
                  ? 'bg-accent text-white'
                  : 'bg-bg-elevated text-text-muted hover:text-text-secondary'
              }`}
            >
              {c.label || `块 ${i + 1}`}
            </button>
          ))}
        </div>
      </div>

      {/* 维度内容 */}
      <div className="space-y-1">
        {visibleDimensions.map(dim => {
          const content = chunk[dim]
          if (!content || content === '本块未涉及') return null

          return (
            <div key={dim} className="border border-border/40 rounded-lg overflow-hidden">
              <div className="px-3 py-2">
                <span className={`text-xs font-medium ${DIM_COLORS[dim] || 'text-text-muted'}`}>
                  {DIMENSION_LABELS[dim]}
                </span>
              </div>
              <div className="px-3 pb-3 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                {content}
              </div>
            </div>
          )
        })}
      </div>

      {/* 精彩片段 */}
      {chunk.rawExcerpt && (
        <div className="border border-border/40 rounded-lg p-3">
          <h4 className="text-xs font-medium text-text-muted mb-1.5">精彩片段引用</h4>
          <div className="text-sm text-text-secondary italic leading-relaxed whitespace-pre-wrap">
            {chunk.rawExcerpt}
          </div>
        </div>
      )}
    </div>
  )
}
