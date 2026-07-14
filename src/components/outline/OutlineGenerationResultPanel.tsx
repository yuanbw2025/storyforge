import { Loader2 } from 'lucide-react'
import type { ParsedChapter, ParsedVolume } from '../../lib/ai/parse-outline-output'
import type { TokenUsage } from '../../lib/ai/logger'
import AIStreamOutput from '../shared/AIStreamOutput'
import OutlinePreviewPanel from './OutlinePreviewPanel'

interface Props {
  output: string
  isStreaming: boolean
  error: string | null
  tokenUsage?: TokenUsage | null
  moduleKey: 'outline.volume' | 'outline.chapter'
  restructuring: boolean
  previewVolumes: ParsedVolume[] | null
  previewChapters: ParsedChapter[] | null
  previewTargetId: number | null
  selectedVolumeTitle?: string
  onStop: () => void
  onAccept: (text: string) => void
  onRetry: () => void
  onConfirmVolumes: () => void
  onConfirmChapters: () => void
  onCancelPreview: () => void
}

export default function OutlineGenerationResultPanel({
  output,
  isStreaming,
  error,
  tokenUsage,
  moduleKey,
  restructuring,
  previewVolumes,
  previewChapters,
  previewTargetId,
  selectedVolumeTitle,
  onStop,
  onAccept,
  onRetry,
  onConfirmVolumes,
  onConfirmChapters,
  onCancelPreview,
}: Props) {
  return (
    <>
      {(output || isStreaming || error) && (
        <AIStreamOutput
          output={output}
          isStreaming={isStreaming}
          error={error}
          tokenUsage={tokenUsage}
          onStop={onStop}
          onAccept={onAccept}
          onRetry={onRetry}
          moduleKey={moduleKey}
        />
      )}

      {restructuring && (
        <div className="flex items-center gap-2 text-xs text-accent">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> 正在用 AI 整理大纲结构…
        </div>
      )}

      {previewVolumes && (
        <OutlinePreviewPanel
          label={previewTargetId != null ? '将补全当前卷的卷纲' : `将创建 ${previewVolumes.length} 个卷`}
          items={previewVolumes}
          onConfirm={onConfirmVolumes}
          onCancel={onCancelPreview}
        />
      )}

      {previewChapters && (
        <OutlinePreviewPanel
          label={previewTargetId != null
            ? '将补全当前章节的章纲'
            : `将在「${selectedVolumeTitle}」下创建 ${previewChapters.length} 个章节`}
          items={previewChapters}
          onConfirm={onConfirmChapters}
          onCancel={onCancelPreview}
        />
      )}
    </>
  )
}
