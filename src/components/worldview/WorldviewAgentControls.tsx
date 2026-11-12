import { useState } from 'react'
import { Check, Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { PendingMasterCandidate } from '../agent/useMasterCopilot'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import AIFieldModeTabs from '../shared/AIFieldModeTabs'
import PromptRunPanel from '../shared/PromptRunPanel'
import {
  formatWorldviewFieldGenerationRequestV1,
  WORLDVIEW_FIELD_DEFAULT_OUTPUT_TOKENS_V1,
  type WorldviewAgentField,
} from '../../lib/agent/worldview-field-copilot'
import type { FieldGenerationMode } from '../../lib/ai/field-generation-context'
import type { Project } from '../../lib/types'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'
import { useAIConfigStore } from '../../stores/ai-config'
import { getModelPreset } from '../../lib/ai/context-budget'
import WorldviewFieldCandidateReview from './WorldviewFieldCandidateReview'
import CopilotGenerationStatus from '../agent/CopilotGenerationStatus'

export default function WorldviewAgentControls({
  field,
  project,
  activeGroupId,
  copilot,
  candidate,
  otherPendingWorldviewLabel,
  hasOtherPendingCandidates,
  onRunningChange,
  onAdopted,
  buttonLabel = 'AI 生成',
}: {
  field: WorldviewAgentField
  project: Project
  activeGroupId: number | null
  copilot: ReturnType<typeof useMasterCopilot>
  candidate?: PendingMasterCandidate
  otherPendingWorldviewLabel?: string
  hasOtherPendingCandidates: boolean
  onRunningChange: (running: boolean) => void
  onAdopted: (candidate: PendingMasterCandidate) => Promise<void>
  buttonLabel?: string
}) {
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [mode, setMode] = useState<FieldGenerationMode>('expand')
  const [lengthMode, setLengthMode] = useState<'default' | 'custom'>('default')
  const [customOutputTokens, setCustomOutputTokens] = useState(WORLDVIEW_FIELD_DEFAULT_OUTPUT_TOKENS_V1)
  const candidateEventId = candidate?.event.id
  const visibleDraft = copilot.readVisibleCandidateDraft(candidateEventId)
  const aiConfig = useAIConfigStore(state => state.config)
  const modelCap = getModelPreset(aiConfig.provider, aiConfig.model).maxOutput
  const configuredCap = aiConfig.maxTokens > 0 ? aiConfig.maxTokens : modelCap
  const visibleEffectiveCap = Math.min(
    modelCap,
    configuredCap,
    WORLDVIEW_FIELD_DEFAULT_OUTPUT_TOKENS_V1,
  )
  const lengthError = lengthMode === 'custom' && (
    !Number.isSafeInteger(customOutputTokens)
    || customOutputTokens < 1
    || customOutputTokens > visibleEffectiveCap
  )
    ? `当前普通单次链路最多 ${visibleEffectiveCap.toLocaleString()} tokens；更长输出尚未启用 LONGOUT 分段协议。`
    : ''

  const handleGenerate = async () => {
    onRunningChange(true)
    try {
      const request = formatWorldviewFieldGenerationRequestV1({
        field,
        mode,
        hint,
      })
      await copilot.submitTargetedRequest(request, {
        agentId: 'world-origin',
        skillId: 'world-origin.worldview-field',
        instruction: request,
        promptExecution: {
          version: 1,
          moduleKey: 'worldview.dimension',
          ...(lengthMode === 'custom' ? { maxTokens: customOutputTokens } : {}),
          ...(Object.keys(parameterValues).length ? { parameterValues } : {}),
          ...(systemOverride === null ? {} : { systemOverride }),
          ...(userOverride === null ? {} : { userOverride }),
        },
      })
    } finally {
      onRunningChange(false)
    }
  }

  const blocked = copilot.loading
    || copilot.busy
    || copilot.pendingCandidates.length > 0
    || Boolean(lengthError)
    || (project.enableMultiWorld === true && activeGroupId == null)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AIFieldModeTabs value={mode} onChange={setMode} />
        <input
          value={hint}
          onChange={event => setHint(event.target.value)}
          placeholder="给 AI 的补充说明（可选）"
          className="min-w-0 flex-1 basis-40 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={blocked}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded disabled:opacity-50 shrink-0 bg-accent/10 text-accent hover:bg-accent/20"
        >
          {copilot.busy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Sparkles className="w-3.5 h-3.5" />}
          {buttonLabel}
        </button>
      </div>

      <PromptRunPanel
        moduleKey="worldview.dimension"
        parameterValues={parameterValues}
        onParamChange={setParameterValues}
        systemOverride={systemOverride}
        onSystemOverrideChange={setSystemOverride}
        userOverride={userOverride}
        onUserOverrideChange={setUserOverride}
      />

      <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-bg-elevated px-3 py-2 text-xs">
        <span className="text-text-secondary">输出长度</span>
        <select
          value={lengthMode}
          onChange={event => setLengthMode(event.target.value as 'default' | 'custom')}
          className="min-w-0 max-w-full rounded border border-border bg-bg-base px-2 py-1 text-text-primary"
        >
          <option value="default">默认（最多 {visibleEffectiveCap.toLocaleString()} tokens）</option>
          <option value="custom">作者自定义</option>
        </select>
        {lengthMode === 'custom' && (
          <input
            aria-label="世界基座自定义输出 tokens"
            type="number"
            min={1}
            step={100}
            value={customOutputTokens}
            onChange={event => setCustomOutputTokens(Number(event.target.value))}
            className="w-28 rounded border border-border bg-bg-base px-2 py-1 text-right text-text-primary"
          />
        )}
        <span className="text-[10px] text-text-muted">
          “不限”按模型上限计算；Run 内始终冻结为有限值，不会静默截断或追加调用。
        </span>
      </div>

      {lengthError && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          {lengthError}
        </p>
      )}

      {copilot.error && (
        <p className="rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {copilot.error}
        </p>
      )}

      <CopilotGenerationStatus busy={copilot.busy && !copilot.pendingCandidates.length} onStop={copilot.stop} />

      {hasOtherPendingCandidates && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          主 Agent 还有其他待确认候选，请先在右侧副驾中处理。
        </p>
      )}

      {!candidate && otherPendingWorldviewLabel && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          “{otherPendingWorldviewLabel}”还有待确认候选，请先处理后再生成其他字段。
        </p>
      )}

      {candidate && (
        <section className="border border-accent/30 bg-bg-surface p-4 rounded-lg">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">待确认 · {candidate.payload.label}</h3>
              {candidate.payload.worldviewFieldOperation && (
                <p className="mt-0.5 text-[10px] text-text-muted">
                  模式：{{
                    create: '新建', expand: '扩写', rewrite: '重写', polish: '润色',
                  }[candidate.payload.worldviewFieldOperation]}
                  {candidate.payload.worldviewFieldOutputBudget
                    ? ` · 输出上限 ${candidate.payload.worldviewFieldOutputBudget.effectiveMaxTokens.toLocaleString()} tokens`
                    : ''}
                </p>
              )}
            </div>
            <span className="text-[11px] text-text-muted">
              {candidate.payload.contextEvidence
                ? `参考资料约 ${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens（非实际用量）`
                : `${candidate.payload.contextSources.length} 个输入来源`}
            </span>
          </div>
          <WorldviewFieldCandidateReview
            candidate={candidate}
            busy={copilot.busy || visibleDraft?.status === 'discarding'}
            visibleDraft={visibleDraft}
            onUpdate={(content, rawValue) => {
              if (candidateEventId != null) void copilot.updateCandidate(candidateEventId, content, { rawValue })
            }}
            onInvalidEdit={(rawValue, error) => {
              if (candidateEventId != null) void copilot.updateCandidate(candidateEventId, rawValue, { rawValue, error })
            }}
          />
          {visibleDraft && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <p role={visibleDraft.error ? 'alert' : 'status'} className={visibleDraft.error ? 'text-error' : 'text-text-muted'}>
                {visibleDraft.error ?? (visibleDraft.status === 'discarding' ? '正在读取已保存候选…' : '正在保存当前候选编辑…')}
              </p>
              <button type="button" className="text-text-secondary underline disabled:opacity-50"
                disabled={copilot.busy || visibleDraft.status === 'discarding'}
                onClick={() => { if (candidateEventId != null) void copilot.discardVisibleCandidateDraft(candidateEventId) }}>
                放弃未保存修改
              </button>
            </div>
          )}
          <HarnessEvidencePanel
            contextEvidence={candidate.payload.contextEvidence}
            lifecycle={candidate.lifecycle}
            promptExecutionEvidence={candidate.payload.promptExecutionEvidence}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={copilot.busy}
              onClick={() => { void copilot.rejectCandidate(candidate) }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary rounded disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              拒绝
            </button>
            <button
              type="button"
              disabled={copilot.busy || Boolean(visibleDraft)}
              onClick={() => { void onAdopted(candidate) }}
              className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
            >
              {copilot.busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
              采纳
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
