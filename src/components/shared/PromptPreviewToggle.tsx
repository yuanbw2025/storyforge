/**
 * PIPELINE-1 开关：发送前预览最终提示词（默认关）
 */

import { Eye } from 'lucide-react'
import { usePromptPreviewStore } from '../../stores/prompt-preview'

export default function PromptPreviewToggle({ compact = false }: { compact?: boolean }) {
  const enabled = usePromptPreviewStore(s => s.enabled)
  const setEnabled = usePromptPreviewStore(s => s.setEnabled)

  if (compact) {
    return (
      <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none" title="开启后，正文生成/续写会先弹出最终提示词供查看与编辑">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          className="accent-accent"
        />
        <Eye className="w-3.5 h-3.5" />
        发送前预览
      </label>
    )
  }

  return (
    <label className="mt-2 flex items-start gap-2 text-[11px] text-text-secondary cursor-pointer">
      <input
        type="checkbox"
        checked={enabled}
        onChange={e => setEnabled(e.target.checked)}
        className="mt-0.5 accent-accent"
      />
      <span>
        <span className="text-text-primary font-medium">发送前提示词预览</span>
        （高级 · 默认关）正文「生成 / 续写」前弹出最终拼接提示词，可看可改；改动只影响这一次，不写回模板。
      </span>
    </label>
  )
}
