import { useState, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { useAIStream } from '../../hooks/useAIStream'
import AIStreamOutput from './AIStreamOutput'
import PromptRunPanel from './PromptRunPanel'
import type { ChatMessage } from '../../lib/types'
import type { PromptModuleKey } from '../../lib/types/prompt'

export interface AIFieldRunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

interface Props {
  /** emoji + 名字，如 "📜 一句话故事" */
  label: string
  /** 一句话提示，作为占位符或描述 */
  description?: string
  value: string
  onChange: (val: string) => void
  onSave: (val: string) => void
  /**
   * 构造 AI 提示词。userHint 由本组件自管。
   * Phase 14：buildMessages 接受第二个参数 options，由本组件传入运行时覆盖。
   * 调用方应把它转发给对应的 adapter。
   */
  buildMessages: (hint: string, options?: AIFieldRunOptions) => ChatMessage[]
  rows?: number
  /** 用于切换字段时清空 AI 输出（一般传字段 key） */
  resetKey?: string
  /** 使用的 moduleKey；提供后会显示「调参」浮窗 */
  moduleKey?: PromptModuleKey
}

/**
 * 通用「带 AI 生成」的字段卡片。
 * 复用：Phase 8 的 StoryCorePanel / CreativeRulesPanel / 后续任意"单字段+AI"场景。
 *
 * 与 WorldviewFieldEditor 的区别：本组件 buildMessages 由调用方传入，
 * 不绑定特定的 prompt 模板（worldview-adapter）。
 */
export default function AIFieldCard({
  label, description, value, onChange, onSave,
  buildMessages, rows = 4, resetKey, moduleKey,
}: Props) {
  const [hint, setHint] = useState('')
  const [showHint, setShowHint] = useState(false)
  // Phase 14：运行时调参 / 临时覆盖 prompt 文字
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const ai = useAIStream()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    ai.reset()
    setParameterValues({})
    setSystemOverride(null)
    setUserOverride(null)
  }, [resetKey])

  const handleGenerate = () => {
    const opts: AIFieldRunOptions = {
      parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
      overrides: (systemOverride != null || userOverride != null) ? {
        systemPrompt: systemOverride ?? undefined,
        userPromptTemplate: userOverride ?? undefined,
      } : undefined,
    }
    ai.start(buildMessages(hint, opts))
  }
  const handleAccept = (text: string) => {
    onChange(text); onSave(text); ai.reset()
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
          {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
        </div>
        <button
          onClick={() => setShowHint(v => !v)}
          className={`px-2.5 py-1 rounded text-xs flex-shrink-0 ${
            showHint ? 'bg-accent/20 text-accent' : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          {showHint ? '收起 AI 提示' : 'AI 提示...'}
        </button>
      </div>

      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        rows={rows}
        placeholder={description || `在此填写${label}内容...`}
        className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
      />

      <div className="flex items-center gap-2">
        {showHint && (
          <input
            value={hint}
            onChange={e => setHint(e.target.value)}
            placeholder="给 AI 的补充说明（可选）"
            className="flex-1 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
          />
        )}
        <button
          onClick={handleGenerate}
          disabled={ai.isStreaming}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-xs rounded hover:bg-accent/20 disabled:opacity-50 ml-auto"
        >
          <Sparkles className="w-3.5 h-3.5" /> AI 生成
        </button>
      </div>

      {/* 调参浮窗 (Phase 14) */}
      {moduleKey && (
        <PromptRunPanel
          moduleKey={moduleKey}
          parameterValues={parameterValues}
          onParamChange={setParameterValues}
          systemOverride={systemOverride}
          onSystemOverrideChange={setSystemOverride}
          userOverride={userOverride}
          onUserOverrideChange={setUserOverride}
        />
      )}

      {(ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error} tokenUsage={ai.tokenUsage}
          onStop={ai.stop}
          onAccept={handleAccept}
          onRetry={handleGenerate}
          moduleKey={moduleKey}
        />
      )}
    </div>
  )
}
