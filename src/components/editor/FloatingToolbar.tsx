/**
 * 选中文本浮动工具栏 — Phase 24.3
 *
 * 用户选中编辑器中的文字后，弹出浮动工具栏：
 * 润色 / 扩写 / 缩写 / 改写 / 查漏
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Wand2, Expand, Minimize2, RefreshCw, Search, X, Loader2, Check } from 'lucide-react'
import { useAIStream } from '../../hooks/useAIStream'
import { buildPolishPrompt, buildExpandPrompt } from '../../lib/ai/adapters/chapter-adapter'
import type { ChatMessage } from '../../lib/types'

interface Props {
  /** 获取当前选中文本 */
  getSelectedText: () => string
  /** 获取选中文本的位置（用于定位工具栏） */
  getSelectionRect: () => DOMRect | null
  /** 替换选中文本 */
  replaceSelectedText: (text: string) => void
  /** 是否禁用（如正在 AI 生成时） */
  disabled?: boolean
}

type ActionType = 'polish' | 'expand' | 'condense' | 'rewrite' | 'check'

const ACTIONS: { type: ActionType; icon: typeof Wand2; label: string; desc: string }[] = [
  { type: 'polish',   icon: Wand2,      label: '润色', desc: '优化文笔' },
  { type: 'expand',   icon: Expand,     label: '扩写', desc: '丰富细节' },
  { type: 'condense', icon: Minimize2,  label: '缩写', desc: '精简内容' },
  { type: 'rewrite',  icon: RefreshCw,  label: '改写', desc: '换种写法' },
  { type: 'check',    icon: Search,     label: '查漏', desc: '检查问题' },
]

export default function FloatingToolbar({
  getSelectedText, getSelectionRect, replaceSelectedText, disabled,
}: Props) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [result, setResult] = useState<string | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const ai = useAIStream()
  const toolbarRef = useRef<HTMLDivElement>(null)

  // 监听选区变化
  const handleSelectionChange = useCallback(() => {
    if (disabled || ai.isStreaming) return
    const text = getSelectedText()
    if (text && text.length > 5 && text.length < 5000) {
      const rect = getSelectionRect()
      if (rect) {
        setPosition({
          top: rect.top - 45, // 工具栏在选区上方
          left: rect.left + rect.width / 2,
        })
        setSelectedText(text)
        setVisible(true)
        setResult(null)
      }
    } else {
      // 延迟隐藏，避免点击工具栏时闪烁
      setTimeout(() => {
        if (!ai.isStreaming) {
          setVisible(false)
        }
      }, 200)
    }
  }, [getSelectedText, getSelectionRect, disabled, ai.isStreaming])

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [handleSelectionChange])

  const handleAction = async (action: ActionType) => {
    if (!selectedText) return
    let messages: ChatMessage[]

    switch (action) {
      case 'polish':
        messages = buildPolishPrompt(selectedText, '优化文笔，使表达更生动优美')
        break
      case 'expand':
        messages = buildExpandPrompt(selectedText)
        break
      case 'condense':
        messages = [
          { role: 'system', content: '你是一位精炼文字的编辑。请在保留核心意思的前提下，将以下文字压缩到原来的 60-70% 长度。直接输出结果。' },
          { role: 'user', content: selectedText },
        ]
        break
      case 'rewrite':
        messages = [
          { role: 'system', content: '你是一位创意写作者。请用完全不同的表达方式改写以下文字，保留核心意思但换种写法。直接输出结果。' },
          { role: 'user', content: selectedText },
        ]
        break
      case 'check':
        messages = [
          { role: 'system', content: '你是一位严谨的审稿编辑。请检查以下文字中的问题（逻辑矛盾、用词不当、语法错误、前后不一致等）。用简短的列表指出问题，如果没有问题就说"未发现问题"。' },
          { role: 'user', content: selectedText },
        ]
        break
    }

    const output = await ai.start(messages)
    if (output) {
      setResult(output)
    }
  }

  const handleAccept = () => {
    if (result) {
      replaceSelectedText(result)
      setResult(null)
      setVisible(false)
      ai.reset()
    }
  }

  const handleDismiss = () => {
    setResult(null)
    setVisible(false)
    ai.reset()
  }

  if (!visible && !ai.isStreaming) return null

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 transform -translate-x-1/2"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      {/* 工具栏按钮行 */}
      {!result && !ai.isStreaming && (
        <div className="flex items-center gap-0.5 bg-bg-elevated border border-border rounded-lg shadow-lg px-1 py-0.5">
          {ACTIONS.map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              onClick={() => handleAction(type)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-text-secondary hover:text-accent hover:bg-accent/10 rounded transition-colors"
              title={label}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
          <button
            onClick={handleDismiss}
            className="p-1.5 text-text-muted hover:text-text-primary rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* AI 生成中 */}
      {ai.isStreaming && (
        <div className="bg-bg-elevated border border-accent/30 rounded-lg shadow-lg px-3 py-2 min-w-[200px]">
          <div className="flex items-center gap-2 text-xs text-accent">
            <Loader2 className="w-3 h-3 animate-spin" />
            AI 处理中...
          </div>
          {ai.output && (
            <p className="mt-1 text-xs text-text-secondary max-h-20 overflow-y-auto whitespace-pre-wrap">
              {ai.output.slice(0, 200)}{ai.output.length > 200 ? '...' : ''}
            </p>
          )}
        </div>
      )}

      {/* 结果展示 */}
      {result && !ai.isStreaming && (
        <div className="bg-bg-elevated border border-border rounded-lg shadow-lg p-3 max-w-md">
          <p className="text-xs text-text-primary whitespace-pre-wrap max-h-40 overflow-y-auto mb-2">
            {result}
          </p>
          {ai.tokenUsage && (
            <p className="text-[10px] text-text-muted mb-2">
              Token: ↑{ai.tokenUsage.inputTokens.toLocaleString()} ↓{ai.tokenUsage.outputTokens.toLocaleString()}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button onClick={handleAccept}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover">
              <Check className="w-3 h-3" /> 替换
            </button>
            <button onClick={handleDismiss}
              className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded hover:bg-bg-hover">
              <X className="w-3 h-3" /> 取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
