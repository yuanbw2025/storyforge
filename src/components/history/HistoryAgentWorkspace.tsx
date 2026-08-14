import { Loader2, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import type { HistoryAgentLaneState } from './useHistoryAI'

export type HistoryAgentViewState = HistoryAgentLaneState

interface Props {
  canEdit: boolean
  consultActive: boolean
  stormActive: boolean
  consultAI: HistoryAgentViewState
  stormAI: HistoryAgentViewState
  savedConsult?: string
  savedStorm?: string
  savedStormLabel: string
  savedStormMaxHeight?: '60' | '80'
  deleteLabel: string
  onConsult: () => void
  onStorm: () => void
  onDelete: () => void
  onAcceptConsult: () => void
  onAcceptStorm: () => void
  onRejectConsult: () => void
  onRejectStorm: () => void
  onRetryConsult: () => void
  onRetryStorm: () => void
  onClearConsult: () => void
  onClearStorm: () => void
}
export default function HistoryAgentWorkspace({
  canEdit,
  consultActive,
  stormActive,
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
  onRejectConsult,
  onRejectStorm,
  onRetryConsult,
  onRetryStorm,
  onClearConsult,
  onClearStorm,
}: Props) {
  const consultBlocked = consultAI.busy || consultAI.candidate != null || consultAI.unsafeRunId != null
  const stormBlocked = stormAI.busy || stormAI.candidate != null || stormAI.unsafeRunId != null

  return (
    <>
      <div className="pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onConsult}
            disabled={consultBlocked || !canEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          >
            {consultAI.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            AI 历史考据
          </button>
          <button
            type="button"
            onClick={onStorm}
            disabled={stormBlocked || !canEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 text-purple-400 text-xs font-medium rounded-lg hover:bg-purple-500/20 transition-colors disabled:opacity-50"
          >
            {stormAI.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
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

      {consultActive && consultAI.candidate && (
        <CandidateResult
          mode="consult"
          state={consultAI}
          onAccept={onAcceptConsult}
          onReject={onRejectConsult}
          onRetry={onRetryConsult}
        />
      )}

      {stormActive && stormAI.candidate && (
        <CandidateResult
          mode="storm"
          state={stormAI}
          onAccept={onAcceptStorm}
          onReject={onRejectStorm}
          onRetry={onRetryStorm}
        />
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

function CandidateResult({
  mode,
  state,
  onAccept,
  onReject,
  onRetry,
}: {
  mode: 'consult' | 'storm'
  state: HistoryAgentLaneState
  onAccept: () => void
  onReject: () => void
  onRetry: () => void
}) {
  const isConsult = mode === 'consult'
  const Icon = isConsult ? ShieldCheck : Sparkles
  return (
    <div className={`mt-3 rounded-lg border p-3 ${isConsult ? 'border-blue-400/30' : 'border-purple-400/30'} bg-bg-base`}>
      <div className={`mb-2 flex items-center gap-1 text-[10px] font-medium ${isConsult ? 'text-blue-400' : 'text-purple-400'}`}>
        <Icon className="h-3 w-3" />
        {isConsult ? '历史考据持久候选' : '头脑风暴持久候选'}
      </div>
      <div className="max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
        {state.candidate?.result}
      </div>
      {state.message && <p className="mt-2 text-[10px] text-text-muted">{state.message}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={state.busy}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {state.busy ? '处理中…' : state.adoptionPending ? '继续确认与终验' : '确认写入'}
        </button>
        {!state.adoptionPending && (
          <>
            <button
              type="button"
              onClick={onReject}
              disabled={state.busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-50"
            >
              拒绝候选
            </button>
            <button
              type="button"
              onClick={onRetry}
              disabled={state.busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-50"
            >
              拒绝并重试
            </button>
          </>
        )}
      </div>
    </div>
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
          <button type="button" onClick={onClear} className="text-[10px] text-text-muted hover:text-red-400">
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
