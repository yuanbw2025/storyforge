import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, MapPin } from 'lucide-react'
import { useGeographyStore } from '../../stores/geography'
import type { Project, Location, LocationType } from '../../lib/types'
import { nanoid } from '../../lib/utils/id'

const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: 'continent', label: '大陆' },
  { value: 'country', label: '国家' },
  { value: 'city', label: '城市' },
  { value: 'sect', label: '门派驻地' },
  { value: 'secret', label: '秘境' },
  { value: 'ruin', label: '遗迹' },
  { value: 'battlefield', label: '战场' },
  { value: 'nature', label: '自然景观' },
  { value: 'building', label: '建筑' },
  { value: 'other', label: '其他' },
]

interface Props {
  project: Project
}

export default function GeographyPanel({ project }: Props) {
  const { geography, loadAll, save } = useGeographyStore()
  const [overview, setOverview] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  useEffect(() => {
    if (geography) {
      setOverview(geography.overview || '')
      try {
        setLocations(JSON.parse(geography.locations || '[]'))
      } catch {
        setLocations([])
      }
    }
  }, [geography])

  const saveLocations = useCallback(async (newLocations: Location[]) => {
    setLocations(newLocations)
    await save({
      projectId: project.id!,
      locations: JSON.stringify(newLocations),
    })
  }, [project.id, save])

  const handleSaveOverview = async () => {
    await save({ projectId: project.id!, overview })
  }

  const handleAddLocation = () => {
    const newLoc: Location = {
      id: nanoid(),
      name: '新地点',
      type: 'other',
      description: '',
      significance: '',
      parentId: null,
      order: locations.length,
    }
    const updated = [...locations, newLoc]
    setExpandedId(newLoc.id)
    saveLocations(updated)
  }

  const handleUpdateLocation = (id: string, data: Partial<Location>) => {
    const updated = locations.map(l => l.id === id ? { ...l, ...data } : l)
    saveLocations(updated)
  }

  const handleDeleteLocation = (id: string) => {
    const updated = locations.filter(l => l.id !== id && l.parentId !== id)
    saveLocations(updated)
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">🗺️ 地理环境</h2>

      {/* 总述 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">地理总述</label>
        <textarea
          value={overview}
          onChange={e => setOverview(e.target.value)}
          onBlur={handleSaveOverview}
          placeholder="描述这个世界的整体地理面貌、大陆分布、气候特征等..."
          className="w-full h-32 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 地点列表 */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-text-primary">地点列表 ({locations.length})</h3>
        <button
          onClick={handleAddLocation}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加地点
        </button>
      </div>

      <div className="space-y-2">
        {locations.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">暂无地点，点击上方按钮添加</p>
        ) : (
          locations.map(loc => {
            const isExpanded = expandedId === loc.id
            return (
              <div key={loc.id} className="border border-border rounded-lg bg-bg-surface overflow-hidden">
                {/* 头部 */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : loc.id)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-hover transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
                  <MapPin className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium text-text-primary flex-1 text-left">{loc.name}</span>
                  <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded">
                    {LOCATION_TYPES.find(t => t.value === loc.type)?.label || loc.type}
                  </span>
                </button>

                {/* 展开编辑 */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">名称</label>
                        <input
                          value={loc.name}
                          onChange={e => handleUpdateLocation(loc.id, { name: e.target.value })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">类型</label>
                        <select
                          value={loc.type}
                          onChange={e => handleUpdateLocation(loc.id, { type: e.target.value as LocationType })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        >
                          {LOCATION_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">描述</label>
                      <textarea
                        value={loc.description}
                        onChange={e => handleUpdateLocation(loc.id, { description: e.target.value })}
                        className="w-full h-20 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">剧情重要性</label>
                      <input
                        value={loc.significance}
                        onChange={e => handleUpdateLocation(loc.id, { significance: e.target.value })}
                        className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleDeleteLocation(loc.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除地点
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
