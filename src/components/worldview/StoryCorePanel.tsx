import { useState, useEffect } from 'react'
import { useWorldviewStore } from '../../stores/worldview'
import type { Project } from '../../lib/types'

const FIELDS = [
  { key: 'theme', label: '🎯 主题', placeholder: '如：成长与救赎、权力的代价...' },
  { key: 'centralConflict', label: '⚔️ 核心冲突', placeholder: '如：主角与命运的抗争...' },
  { key: 'plotPattern', label: '📊 情节模式', placeholder: '如：英雄之旅、复仇线...' },
  { key: 'storyLines', label: '📝 故事线', placeholder: '主线 + 副线描述...' },
] as const

type FieldKey = typeof FIELDS[number]['key']

interface Props {
  project: Project
}

export default function StoryCorePanel({ project }: Props) {
  const { storyCore, saveStoryCore, loadAll } = useWorldviewStore()
  const [values, setValues] = useState<Record<FieldKey, string>>({
    theme: '', centralConflict: '', plotPattern: '', storyLines: '',
  })

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  useEffect(() => {
    if (storyCore) {
      setValues({
        theme: storyCore.theme || '',
        centralConflict: storyCore.centralConflict || '',
        plotPattern: storyCore.plotPattern || '',
        storyLines: storyCore.storyLines || '',
      })
    }
  }, [storyCore])

  const handleSave = async (key: FieldKey, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }))
    await saveStoryCore({ projectId: project.id!, [key]: value })
  }

  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">✨ 故事核心</h2>
      <div className="space-y-4">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {f.label}
            </label>
            <textarea
              value={values[f.key]}
              onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
              onBlur={e => handleSave(f.key, e.target.value)}
              placeholder={f.placeholder}
              rows={f.key === 'storyLines' ? 5 : 3}
              className="w-full p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
