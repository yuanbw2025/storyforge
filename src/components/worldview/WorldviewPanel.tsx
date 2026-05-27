import { useState, useEffect } from 'react'
import { Sparkles, ShieldCheck, Compass } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useProjectStore } from '../../stores/project'
import { useAIStream } from '../../hooks/useAIStream'
import { buildWorldviewPrompt } from '../../lib/ai/adapters/worldview-adapter'
import { buildExistingWorldview } from '../../lib/ai/context-builder'
import AIStreamOutput from '../shared/AIStreamOutput'
import type { Project, CreativeMode } from '../../lib/types'

const FANTASY_DIMENSIONS = [
  { key: 'geography', label: '🌍 地理环境' },
  { key: 'history', label: '📜 历史年表' },
  { key: 'society', label: '🏛️ 社会结构' },
  { key: 'culture', label: '🎭 文化宗教' },
  { key: 'economy', label: '💰 经济体系' },
  { key: 'rules', label: '⚡ 世界规则' },
  { key: 'summary', label: '📋 精华摘要' },
] as const

const HISTORICAL_DIMENSIONS = [
  { key: 'geography', label: '🗺️ 真实地理与地名考据' },
  { key: 'history', label: '📜 历史时期与架空度' },
  { key: 'society', label: '🏛️ 社会等级与官职' },
  { key: 'culture', label: '🎭 宗教与民间信仰' },
  { key: 'economy', label: '💰 经济与赋税制度' },
  { key: 'rules', label: '⚡ 时代科技与生产力' },
  { key: 'summary', label: '📋 精华摘要' },
] as const

type DimensionKey = typeof FANTASY_DIMENSIONS[number]['key']

interface Props {
  project: Project
}

export default function WorldviewPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const { updateProject } = useProjectStore()
  const [activeTab, setActiveTab] = useState<DimensionKey>('geography')
  const [editValue, setEditValue] = useState('')
  const [hint, setHint] = useState('')
  const ai = useAIStream()

  const creativeMode: CreativeMode = project.creativeMode || 'fantasy'
  const dimensions = creativeMode === 'historical' ? HISTORICAL_DIMENSIONS : FANTASY_DIMENSIONS

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

  const handleModeChange = async (mode: CreativeMode) => {
    if (confirm(`确定切换到「${mode === 'historical' ? '历史考证' : '幻想设定'}」模式？这会改变 AI 生成世界观时的考证倾向。`)) {
      await updateProject(project.id!, { creativeMode: mode })
      ai.reset()
    }
  }

  const handleGenerate = async () => {
    const messages = buildWorldviewPrompt(
      activeTab,
      project.name,
      project.genre,
      buildExistingWorldview(worldview),
      hint,
      {
        parameterValues: {
          creativeMode,
        }
      }
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
      {/* 头部与模式切换 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-text-primary">🌍 世界观构建</h2>
          <p className="text-xs text-text-muted mt-0.5">
            {creativeMode === 'historical'
              ? '当前处于历史考证模式，AI 将严格遵循历史真实性进行细节推导。'
              : '当前处于幻想设定模式，支持天马行空的创世神话与力量体系。'}
          </p>
        </div>

        {/* 模式切换开关 */}
        <div className="flex bg-bg-elevated rounded-lg p-1 shrink-0 border border-border/40">
          <button
            onClick={() => handleModeChange('fantasy')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
              creativeMode === 'fantasy'
                ? 'bg-accent text-white shadow-sm font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            幻想设定
          </button>
          <button
            onClick={() => handleModeChange('historical')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
              creativeMode === 'historical'
                ? 'bg-amber-500 text-white shadow-sm font-medium'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            历史考证
          </button>
        </div>
      </div>

      {/* Tab 栏 */}
      <div className="flex flex-wrap gap-1 mb-4">
        {dimensions.map(d => (
          <button
            key={d.key}
            onClick={() => { setActiveTab(d.key); ai.reset() }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === d.key
                ? creativeMode === 'historical'
                  ? 'bg-amber-500 text-white'
                  : 'bg-accent text-white'
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
          placeholder={`在此编辑${dimensions.find(d => d.key === activeTab)?.label || ''}内容...`}
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
            error={ai.error} tokenUsage={ai.tokenUsage}
            onStop={ai.stop}
            onAccept={handleAccept}
            onRetry={handleGenerate}
          />
        )}
      </div>
    </div>
  )
}
