import { useState, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/adapters/worldview-adapter'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import AIFieldModeTabs from '../shared/AIFieldModeTabs'
import type { Project } from '../../lib/types'
import type { FieldGenerationMode } from '../../lib/ai/field-generation-context'

interface Props {
  label: string                 // emoji + 名称，如 "🌌 世界来源"
  description?: string          // 一句话说明（占位符也用）
  value: string
  onChange: (val: string) => void
  onSave: (val: string) => void
  project: Project
  /** 给 AI 的"已有上下文"（其他字段拼接的摘要） */
  contextSummary: string
  rows?: number
}

/**
 * 世界观面板的字段编辑行：
 * 标签 + textarea（auto-save on blur）+ AI 生成按钮 + 流式输出 + 接受/重试
 *
 * 复用：WorldviewOriginPanel（3 行）/ WorldviewNaturalPanel（多行）/ 后续 P6 人文环境
 */
export default function WorldviewFieldEditor({
  label, description, value, onChange, onSave,
  project, contextSummary, rows = 4,
}: Props) {
  const [hint, setHint] = useState('')
  const [showHintBox, setShowHintBox] = useState(false)
  // Phase 14：运行时调参 / 临时覆盖
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [mode, setMode] = useState<FieldGenerationMode>('expand')
  const ai = useAIStream()

  // 切换字段时清空 AI 流 + 重置临时覆盖
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    ai.reset()
    setParameterValues({})
    setSystemOverride(null)
    setUserOverride(null)
  }, [project.id, label])

  const handleGenerate = async () => {
    const opts = {
      parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
      overrides: (systemOverride != null || userOverride != null) ? {
        systemPrompt: systemOverride ?? undefined,
        userPromptTemplate: userOverride ?? undefined,
      } : undefined,
    }
    // 直接传中文标签作为 dimension（adapter 的 fallback 会用这个）
    const messages = buildWorldviewPrompt(
      label.replace(/^[^a-zA-Z一-龥]+/, ''), // 去前面 emoji
      project.name,
      project.genre || '',
      contextSummary,
      hint,
      opts,
      value,
      mode,
    )
    ai.start(messages)
  }

  const handleAccept = (text: string) => {
    onChange(text)
    onSave(text)
    ai.reset()
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-text-muted">{description}</p>
          )}
        </div>
        <button
          onClick={() => setShowHintBox(v => !v)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors flex-shrink-0 ${
            showHintBox ? 'bg-accent/20 text-accent' : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          {showHintBox ? '收起 AI 提示' : 'AI 提示...'}
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
        <AIFieldModeTabs value={mode} onChange={setMode} />
        {showHintBox && (
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
          <Sparkles className="w-3.5 h-3.5" />
          AI 生成
        </button>
      </div>

      {/* 调参浮窗 (Phase 14) */}
      <PromptRunPanel
        moduleKey="worldview.dimension"
        parameterValues={parameterValues}
        onParamChange={setParameterValues}
        systemOverride={systemOverride}
        onSystemOverrideChange={setSystemOverride}
        userOverride={userOverride}
        onUserOverrideChange={setUserOverride}
      />

      {(ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error} tokenUsage={ai.tokenUsage}
          onStop={ai.stop}
          onAccept={handleAccept}
          onRetry={handleGenerate}
          moduleKey="worldview.dimension"
        />
      )}
    </div>
  )
}
