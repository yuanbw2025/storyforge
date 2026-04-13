import { useState, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/prompts/worldview'
import { buildExistingWorldview } from '../../lib/ai/context-builder'
import AIStreamOutput from '../shared/AIStreamOutput'
import type { Project } from '../../lib/types'

const DIMENSIONS = [
  { key: 'geography', label: '🌍 地理环境' },
  { key: 'history', label: '📜 历史年表' },
  { key: 'society', label: '🏛️ 社会结构' },
  { key: 'culture', label: '🎭 文化宗教' },
  { key: 'economy', label: '💰 经济体系' },
  { key: 'rules', label: '⚡ 世界规则' },
  { key: 'summary', label: '📋 精华摘要' },
] as const

type DimensionKey = typeof DIMENSIONS[number]['key']

interface Props {
  project: Project
}

export default function WorldviewPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const [activeTab, setActiveTab] = useState<DimensionKey>('geography')
  const [editValue, setEditValue] = useState('')
  const [hint, setHint] = useState('')
  const ai = useAIStream()

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  useEffect(() => {
    if (worldview) {
      setEditValue((worldview[activeTab] as string) || '')
    }
  }, [activeTab, worldview])

  const handleSave = async () => {
    await saveWorldview({
      projectId: project.id!,
      [activeTab]: editValue,
    })
  }

  const handleGenerate = async () => {
    const messages = buildWorldviewPrompt(
      activeTab,
      project.name,
      project.genre,
      buildExistingWorldview(worldview),
      hint,
    )
    ai.start(messages)
  }

  const handleAccept = async (text: string) => {
    setEditValue(text)
    await saveWorldview({
      projectId: project.id!,
      [activeTab]: text,
    })
    ai.reset()
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">🌍 世界观构建</h2>

      {/* Tab 栏 */}
      <div className="flex flex-wrap gap-1 mb-4">
        {DIMENSIONS.map(d => (
          <button
            key={d.key}
            onClick={() => { setActiveTab(d.key); ai.reset() }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === d.key
                ? 'bg-accent text-white'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* 编辑区 */}
      <div className="space-y-3">
        <textarea
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleSave}
          placeholder={`在此编辑${DIMENSIONS.find(d => d.key === activeTab)?.label || ''}内容...`}
          className="w-full h-48 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />

        {/* AI 生成区 */}
        <div className="flex gap-2 items-end">
          <input
            value={hint}
            onChange={e => setHint(e.target.value)}
            placeholder="给 AI 的补充说明（可选）"
            className="flex-1 px-3 py-2 bg-bg-surface border border-border rounded-md text-text-primary text-sm focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleGenerate}
            disabled={ai.isStreaming}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            AI 生成
          </button>
        </div>

        {/* AI 输出 */}
        {(ai.output || ai.isStreaming || ai.error) && (
          <AIStreamOutput
            output={ai.output}
            isStreaming={ai.isStreaming}
            error={ai.error}
            onStop={ai.stop}
            onAccept={handleAccept}
            onRetry={handleGenerate}
          />
        )}
      </div>
    </div>
  )
}
