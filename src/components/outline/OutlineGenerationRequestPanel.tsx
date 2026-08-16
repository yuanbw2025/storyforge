import { useState, useEffect } from 'react'
import { Settings2 } from 'lucide-react'
import type { PreparedGenerationContext, OutlineGenerationRequest } from '../../lib/outline/generation-request'
import type { GenerationMode, ChunkedGenerationConfig } from '../../lib/outline/generation-modes'
import { DEFAULT_CHUNKED_CONFIG, GENERATION_MODE_LABELS } from '../../lib/outline/generation-modes'
import type { ChatMessage } from '../../lib/types'
import PromptPreviewGate from '../shared/PromptPreviewGate'
import OutlineGenerationBasis from './OutlineGenerationBasis'

interface Props {
  request: OutlineGenerationRequest
  preparedContext: PreparedGenerationContext | null
  loading: boolean
  error: string
  onRetry: () => void
  onCancel: () => void
  onConfirm: (mode?: GenerationMode, chunkedConfig?: ChunkedGenerationConfig) => void
  messages?: ChatMessage[] | null
  transparentMode?: boolean
  promptReviewOpen?: boolean
  onTransparentModeChange?: (enabled: boolean) => void
  onClosePromptReview?: () => void
  onConfirmMessages?: (messages: ChatMessage[]) => void
}

function requestTitle(request: OutlineGenerationRequest): string {
  if (request.kind === 'volumes') return '批量生成卷级大纲'
  if (request.kind === 'chapters') return '生成本卷所有章节'
  if (request.kind === 'single-volume') return 'AI 生成本卷卷纲'
  return 'AI 生成本章章纲'
}

export default function OutlineGenerationRequestPanel({
  request,
  preparedContext,
  loading,
  error,
  onRetry,
  onCancel,
  onConfirm,
  messages = null,
  transparentMode = false,
  promptReviewOpen = false,
  onTransparentModeChange,
  onClosePromptReview,
  onConfirmMessages,
}: Props) {
  const isChapterBatch = request.kind === 'chapters'
  const chapterRequest = isChapterBatch ? request : null
  const [mode, setMode] = useState<GenerationMode>(chapterRequest?.mode ?? 'quick')
  const [chunkedConfig, setChunkedConfig] = useState<ChunkedGenerationConfig>(
    chapterRequest?.chunkedConfig ?? DEFAULT_CHUNKED_CONFIG
  )

  useEffect(() => {
    const isChapter = request.kind === 'chapters'
    setMode(isChapter ? request.mode ?? 'quick' : 'quick')
    setChunkedConfig(isChapter ? request.chunkedConfig ?? DEFAULT_CHUNKED_CONFIG : DEFAULT_CHUNKED_CONFIG)
  }, [request])

  if (promptReviewOpen && messages && onClosePromptReview && onConfirmMessages) {
    return (
      <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
        <PromptPreviewGate
          messages={messages}
          onBack={onClosePromptReview}
          onConfirm={onConfirmMessages}
        />
      </div>
    )
  }

  const handleConfirm = () => {
    if (isChapterBatch) {
      onConfirm(mode, chunkedConfig)
    } else {
      onConfirm()
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-xs leading-5 text-text-secondary">
          <span className="font-medium text-text-primary">{requestTitle(request)}</span>
          <span className="ml-2">
            {request.kind === 'single-chapter'
              ? '单章补全固定只生成当前 1 章；上方"本卷章节数"不参与本次调用。确认后才会调用 API。'
              : '请先调整上方参数，确认后才会调用 API。'}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {error && (
            <button
              onClick={onRetry}
              className="px-2.5 py-1 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10"
            >
              重新读取
            </button>
          )}
          <button
            onClick={onCancel}
            className="px-2.5 py-1 text-xs text-text-muted border border-border rounded hover:text-text-primary"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || Boolean(error) || !preparedContext}
            className="px-2.5 py-1 text-xs text-white bg-accent rounded hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {transparentMode ? '预览最终提示词' : '确认生成'}
          </button>
        </div>
      </div>

      {isChapterBatch && (
        <div className="border-t border-accent/20 pt-3 space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Settings2 className="w-3.5 h-3.5 text-accent" />
              <span className="text-xs font-medium text-text-primary">生成模式</span>
            </div>
            <div className="flex gap-2">
              {(Object.keys(GENERATION_MODE_LABELS) as GenerationMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 px-3 py-2 rounded-md border text-left transition-colors ${ 
                    mode === m
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg-surface text-text-secondary hover:border-accent/50'
                  }`}
                >
                  <div className="text-xs font-medium">{GENERATION_MODE_LABELS[m].label}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">{GENERATION_MODE_LABELS[m].description}</div>
                </button>
              ))}
            </div>
          </div>

          {mode === 'chunked' && (
            <div className="bg-bg-surface border border-border rounded-md p-3 space-y-3">
              <div className="text-xs font-medium text-text-primary">精细模式参数</div>
              <div className="space-y-2">
                <label className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-muted">分块数</span>
                    <span className="text-[10px] text-accent font-medium">{chunkedConfig.blockCount} 块</span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={7}
                    step={1}
                    value={chunkedConfig.blockCount}
                    onChange={e => setChunkedConfig(prev => ({ ...prev, blockCount: Number(e.target.value) }))}
                    className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <div className="flex justify-between text-[10px] text-text-muted">
                    <span>3 块</span>
                    <span>5 块（推荐）</span>
                    <span>7 块</span>
                  </div>
                </label>
                <label className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-muted">生成模式</span>
                    <span className="text-[10px] text-accent font-medium">单方案迭代</span>
                  </div>
                  <div className="text-[10px] text-text-muted leading-tight">
                    每次生成一个方案，可不断收藏或重新生成，最后选定
                  </div>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={chunkedConfig.enableNarrativeEngine}
                    onChange={e => setChunkedConfig(prev => ({ ...prev, enableNarrativeEngine: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded border-border text-accent focus:ring-accent"
                  />
                  <div className="flex flex-col">
                    <span className="text-[10px] text-text-muted whitespace-nowrap">启用5轨引擎</span>
                    <span className="text-[9px] text-text-muted/70 leading-tight">在生成章节细纲时按叙事侧重控制节奏</span>
                  </div>
                </label>
              </div>
              <div className="text-[10px] text-text-muted">注：每章字数由上方参数统一控制</div>
            </div>
          )}
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-2 rounded border border-border/70 bg-bg-base/60 px-2.5 py-2 text-xs">
        <input
          type="checkbox"
          checked={transparentMode}
          onChange={event => onTransparentModeChange?.(event.target.checked)}
          className="mt-0.5 accent-accent"
        />
        <span>
          <span className="font-medium text-text-secondary">透明模式（高级）</span>
          <span className="ml-2 text-[10px] text-text-muted">
            发送前查看并临时编辑拼接后的最终消息；默认关闭，本次编辑不会保存。
          </span>
        </span>
      </label>
      <div className="border-t border-accent/20 pt-3">
        <OutlineGenerationBasis
          context={preparedContext?.assembled ?? null}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  )
}
