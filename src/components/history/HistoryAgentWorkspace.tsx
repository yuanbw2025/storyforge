import { ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import AIStreamOutput from '../shared/AIStreamOutput'

type AgentViewState = Pick<
  UseAIStreamReturn,
  'output' | 'isStreaming' | 'error' | 'tokenUsage' | 'stop'
>

interface Props {
  canEdit: boolean
  consultActive: boolean
  stormActive: boolean
  consultPreparing: boolean
  stormPreparing: boolean
  consultAI: AgentViewState
  stormAI: AgentViewState
  savedConsult?: string
  savedStorm?: string
  savedStormLabel: string
  savedStormMaxHeight?: '60' | '80'
  deleteLabel: string
  onConsult: () => void
  onStorm: () => void
  onDelete: () => void
  onAcceptConsult: (text: string) => void
  onAcceptStorm: (text: string) => void
  onClearConsult: () => void
  onClearStorm: () => void
}

export default function HistoryAgentWorkspace({
  canEdit,
  consultActive,
  stormActive,
  consultPreparing,
  stormPreparing,
  consultAI,
  stormAI,
  savedConsult,
  savedStorm,
  savedStormLabel,
  savedStormMaxHeight = '60',
  deleteLabel,
  onConsult,
  onStorm,
  onDelete,
  onAcceptConsult,
  onAcceptStorm,
  onClearConsult,
  onClearStorm,
}: Props) {
  const showConsultOutput = consultActive && !!(consultAI.output || consultAI.isStreaming || consultAI.error)
  const showStormOutput = stormActive && !!(stormAI.output || stormAI.isStreaming || stormAI.error)

  return (
    <>
      <div className="pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onConsult}
            disabled={consultAI.isStreaming || consultPreparing || !canEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            AI 历史考据
          </button>
          <button
            type="button"
            onClick={onStorm}
            disabled={stormAI.isStreaming || stormPreparing || !canEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 text-purple-400 text-xs font-medium rounded-lg hover:bg-purple-500/20 transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI 头脑风暴
          </button>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deleteLabel}
          </button>
        )}
      </div>

      {showConsultOutput && (
        <div className="mt-3">
          <p className="text-[10px] text-blue-400 mb-1 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> 历史考据 agent
          </p>
          <AIStreamOutput
            output={consultAI.output}
            isStreaming={consultAI.isStreaming}
            error={consultAI.error}
            tokenUsage={consultAI.tokenUsage}
            onStop={consultAI.stop}
            onAccept={onAcceptConsult}
            onRetry={onConsult}
          />
        </div>
      )}

      {showStormOutput && (
        <div className="mt-3">
          <p className="text-[10px] text-purple-400 mb-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> 头脑风暴 agent
          </p>
          <AIStreamOutput
            output={stormAI.output}
            isStreaming={stormAI.isStreaming}
            error={stormAI.error}
            tokenUsage={stormAI.tokenUsage}
            onStop={stormAI.stop}
            onAccept={onAcceptStorm}
            onRetry={onStorm}
          />
        </div>
      )}

      {savedConsult && !consultActive && (
        <SavedAgentResult
          mode="consult"
          label="AI 历史考据结果"
          text={savedConsult}
          canEdit={canEdit}
          onClear={onClearConsult}
        />
      )}

      {savedStorm && !stormActive && (
        <SavedAgentResult
          mode="storm"
          label={savedStormLabel}
          text={savedStorm}
          canEdit={canEdit}
          maxHeight={savedStormMaxHeight}
          onClear={onClearStorm}
        />
      )}
    </>
  )
}

function SavedAgentResult({
  mode,
  label,
  text,
  canEdit,
  maxHeight = '60',
  onClear,
}: {
  mode: 'consult' | 'storm'
  label: string
  text: string
  canEdit: boolean
  maxHeight?: '60' | '80'
  onClear: () => void
}) {
  const isConsult = mode === 'consult'
  const Icon = isConsult ? ShieldCheck : Sparkles
  return (
    <div className={`mt-3 bg-bg-base border ${isConsult ? 'border-blue-400/30' : 'border-purple-400/30'} rounded-lg p-3 space-y-1.5`}>
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-medium ${isConsult ? 'text-blue-400' : 'text-purple-400'} flex items-center gap-1`}>
          <Icon className="w-3 h-3" />
          {label}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-text-muted hover:text-red-400"
          >
            清除
          </button>
        )}
      </div>
      <div className={`text-xs text-text-secondary leading-relaxed whitespace-pre-wrap prose prose-invert ${maxHeight === '80' ? 'max-h-80' : 'max-h-60'} overflow-y-auto`}>
        {text}
      </div>
    </div>
  )
}
