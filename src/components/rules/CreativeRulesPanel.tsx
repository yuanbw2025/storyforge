import { useState, useEffect, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import { useCreativeRulesStore } from '../../stores/creative-rules'
import type { Project, NarrativePOV } from '../../lib/types'

const POV_OPTIONS: { value: NarrativePOV; label: string; desc: string }[] = [
  { value: 'first-person', label: '第一人称', desc: '以"我"的视角叙述' },
  { value: 'third-limited', label: '第三人称有限', desc: '跟随某个角色的视角' },
  { value: 'third-omniscient', label: '第三人称全知', desc: '上帝视角，可看到所有角色内心' },
  { value: 'multi-pov', label: '多视角', desc: '在多个角色视角间切换' },
]

interface Props {
  project: Project
}

export default function CreativeRulesPanel({ project }: Props) {
  const { creativeRules, loadAll, save } = useCreativeRulesStore()
  const [writingStyle, setWritingStyle] = useState('')
  const [narrativePOV, setNarrativePOV] = useState<NarrativePOV>('third-limited')
  const [toneAndMood, setToneAndMood] = useState('')
  const [prohibitions, setProhibitions] = useState<string[]>([])
  const [consistencyRules, setConsistencyRules] = useState<string[]>([])
  const [specialRequirements, setSpecialRequirements] = useState('')
  const [referenceWorks, setReferenceWorks] = useState<string[]>([])

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  useEffect(() => {
    if (creativeRules) {
      setWritingStyle(creativeRules.writingStyle || '')
      setNarrativePOV(creativeRules.narrativePOV || 'third-limited')
      setToneAndMood(creativeRules.toneAndMood || '')
      setSpecialRequirements(creativeRules.specialRequirements || '')
      try { setProhibitions(JSON.parse(creativeRules.prohibitions || '[]')) } catch { setProhibitions([]) }
      try { setConsistencyRules(JSON.parse(creativeRules.consistencyRules || '[]')) } catch { setConsistencyRules([]) }
      try { setReferenceWorks(JSON.parse(creativeRules.referenceWorks || '[]')) } catch { setReferenceWorks([]) }
    }
  }, [creativeRules])

  const saveField = useCallback(async (data: Record<string, unknown>) => {
    await save({ projectId: project.id!, ...data })
  }, [project.id, save])

  /* ---- 列表操作通用 ---- */
  const handleAddToList = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    field: string,
  ) => {
    const updated = [...list, '']
    setList(updated)
    saveField({ [field]: JSON.stringify(updated) })
  }

  const handleUpdateListItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    _field: string,
    index: number,
    value: string,
  ) => {
    const updated = [...list]
    updated[index] = value
    setList(updated)
    // 仅 blur 时保存，这里先更新本地
  }

  const handleBlurListItem = (
    list: string[],
    field: string,
  ) => {
    saveField({ [field]: JSON.stringify(list) })
  }

  const handleRemoveListItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    field: string,
    index: number,
  ) => {
    const updated = list.filter((_, i) => i !== index)
    setList(updated)
    saveField({ [field]: JSON.stringify(updated) })
  }

  /* ---- 列表渲染 ---- */
  const renderList = (
    title: string,
    placeholder: string,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    field: string,
  ) => (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-text-secondary">{title} ({list.length})</label>
        <button
          onClick={() => handleAddToList(list, setList, field)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          添加
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-text-muted text-xs py-3 text-center border border-dashed border-border rounded-lg">暂无内容</p>
      ) : (
        <div className="space-y-1.5">
          {list.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={item}
                onChange={e => handleUpdateListItem(list, setList, field, idx, e.target.value)}
                onBlur={() => handleBlurListItem(list, field)}
                placeholder={placeholder}
                className="flex-1 px-2 py-1.5 bg-bg-surface border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => handleRemoveListItem(list, setList, field, idx)}
                className="p-1 text-text-muted hover:text-red-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">📐 创作规则</h2>

      {/* 写作风格 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">写作风格</label>
        <textarea
          value={writingStyle}
          onChange={e => setWritingStyle(e.target.value)}
          onBlur={() => saveField({ writingStyle })}
          placeholder="描述期望的写作风格，如：简洁凌厉、文笔华丽、幽默诙谐、冷峻写实..."
          className="w-full h-24 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 叙事视角 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-2">叙事视角</label>
        <div className="grid grid-cols-2 gap-2">
          {POV_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => {
                setNarrativePOV(opt.value)
                saveField({ narrativePOV: opt.value })
              }}
              className={`p-3 rounded-lg border text-left transition-all ${
                narrativePOV === opt.value
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg-surface hover:border-text-muted'
              }`}
            >
              <div className="text-sm font-medium text-text-primary">{opt.label}</div>
              <div className="text-xs text-text-muted mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 基调和氛围 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">基调和氛围</label>
        <textarea
          value={toneAndMood}
          onChange={e => setToneAndMood(e.target.value)}
          onBlur={() => saveField({ toneAndMood })}
          placeholder="描述作品的整体基调和氛围，如：黑暗压抑、热血激昂、温馨治愈..."
          className="w-full h-20 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 禁止事项 */}
      {renderList('禁止事项', '如：不能出现现代用语', prohibitions, setProhibitions, 'prohibitions')}

      {/* 一致性规则 */}
      {renderList('一致性规则', '如：修炼体系必须遵循金木水火土五行', consistencyRules, setConsistencyRules, 'consistencyRules')}

      {/* 参考作品 */}
      {renderList('参考作品', '如：《凡人修仙传》', referenceWorks, setReferenceWorks, 'referenceWorks')}

      {/* 特殊创作要求 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">特殊创作要求</label>
        <textarea
          value={specialRequirements}
          onChange={e => setSpecialRequirements(e.target.value)}
          onBlur={() => saveField({ specialRequirements })}
          placeholder="其他需要 AI 遵守的特殊创作要求..."
          className="w-full h-24 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>
    </div>
  )
}
