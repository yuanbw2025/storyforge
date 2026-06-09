/**
 * Phase 25.3 — 重要地点面板
 * 树状图 / 列表双视图 + 多标签组合 + 树状父子层级
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, ChevronDown, ChevronRight, MapPin,
  GitBranch, List,
} from 'lucide-react'
import { useLocationStore } from '../../stores/location'
import type { Project, ImportantLocation, LocationTag } from '../../lib/types'
import { TAG_EMOJI } from '../../lib/types/location'
import LocationTagPicker from './LocationTagPicker'
import LocationTreeView from './LocationTreeView'

interface Props {
  project: Project
}

export default function LocationPanel({ project }: Props) {
  const {
    locations, loading, loadAll,
    addLocation, updateLocation, deleteLocation,
    getTree,
  } = useLocationStore()

  const [view, setView] = useState<'tree' | 'list'>('tree')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  const tree = getTree()

  const handleAdd = useCallback(async (parentId: number | null = null) => {
    const id = await addLocation({
      projectId: project.id!,
      name: '新地点',
      tags: '[]',
      description: '',
      significance: '',
      parentId,
      sortOrder: locations.length,
    })
    setExpandedId(id)
  }, [project.id, addLocation, locations.length])

  const handleDelete = useCallback(async (id: number) => {
    await deleteLocation(id)
    if (expandedId === id) setExpandedId(null)
    setConfirmDeleteId(null)
  }, [deleteLocation, expandedId])

  const handleUpdateTags = useCallback((id: number, tags: LocationTag[]) => {
    updateLocation(id, { tags: JSON.stringify(tags) })
  }, [updateLocation])

  const parseTags = (tagsStr: string): LocationTag[] => {
    try { return JSON.parse(tagsStr || '[]') } catch { return [] }
  }

  // 递归渲染列表项
  const renderListItem = (loc: ImportantLocation, depth: number = 0) => {
    const isExpanded = expandedId === loc.id
    const tags = parseTags(loc.tags)
    const children = locations.filter(l => l.parentId === loc.id)
    const isConfirmingDelete = confirmDeleteId === loc.id

    return (
      <div key={loc.id}>
        <div
          className="border border-border rounded-lg bg-bg-surface overflow-hidden mb-2"
          style={{ marginLeft: depth * 24 }}
        >
          {/* 头部 */}
          <button
            onClick={() => setExpandedId(isExpanded ? null : loc.id!)}
            className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-hover transition-colors"
          >
            {isExpanded
              ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
              : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />}
            <MapPin className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-medium text-text-primary flex-1 text-left truncate">
              {loc.name}
            </span>
            {/* 标签预览 */}
            <div className="flex items-center gap-1 shrink-0">
              {tags.slice(0, 3).map(tag => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 bg-bg-elevated text-text-muted rounded"
                  title={tag}
                >
                  {TAG_EMOJI[tag] || '📍'} {tag}
                </span>
              ))}
              {tags.length > 3 && (
                <span className="text-[10px] text-text-muted">+{tags.length - 3}</span>
              )}
            </div>
            {children.length > 0 && (
              <span className="text-[10px] text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded shrink-0">
                {children.length} 子地点
              </span>
            )}
          </button>

          {/* 展开编辑 */}
          {isExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
              {/* 名称 + 父地点 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">名称</label>
                  <input
                    value={loc.name}
                    onChange={e => updateLocation(loc.id!, { name: e.target.value })}
                    className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">上级地点</label>
                  <select
                    value={loc.parentId ?? ''}
                    onChange={e => updateLocation(loc.id!, { parentId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="">（顶级）</option>
                    {locations
                      .filter(l => l.id !== loc.id)
                      .map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                  </select>
                </div>
              </div>

              {/* 标签 */}
              <div>
                <label className="block text-xs text-text-muted mb-1">地点标签（可多选组合）</label>
                <LocationTagPicker
                  selected={tags}
                  onChange={newTags => handleUpdateTags(loc.id!, newTags)}
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-xs text-text-muted mb-1">描述</label>
                <textarea
                  value={loc.description}
                  onChange={e => updateLocation(loc.id!, { description: e.target.value })}
                  placeholder="地点的详细描述、外观、氛围…"
                  className="w-full h-20 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                />
              </div>

              {/* 剧情重要性 */}
              <div>
                <label className="block text-xs text-text-muted mb-1">剧情重要性</label>
                <textarea
                  value={loc.significance}
                  onChange={e => updateLocation(loc.id!, { significance: e.target.value })}
                  placeholder="此地点在故事中的作用、关键事件、与角色的关联…"
                  className="w-full h-16 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                />
              </div>

              {/* 操作栏 */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => handleAdd(loc.id!)}
                  className="flex items-center gap-1 px-3 py-1.5 text-accent hover:bg-accent/10 text-xs rounded transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加子地点
                </button>
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-400">确认删除？子地点也会一并删除</span>
                    <button
                      onClick={() => handleDelete(loc.id!)}
                      className="px-2 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600 transition-colors"
                    >
                      确认
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(loc.id!)}
                    className="flex items-center gap-1 px-3 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除地点
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 子地点递归渲染 */}
        {children.map(child => renderListItem(child, depth + 1))}
      </div>
    )
  }

  // 顶层地点
  const topLevelLocations = locations.filter(l => l.parentId === null)

  if (loading) {
    return (
      <div className="max-w-4xl animate-pulse">
        <div className="h-8 bg-bg-elevated rounded w-48 mb-6" />
        <div className="h-64 bg-bg-elevated rounded" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-1">📍 重要地点</h2>
      <p className="text-sm text-text-muted mb-4">
        管理故事中的重要场景地点，支持标签组合与树状层级
      </p>

      {/* 工具栏 */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-text-secondary">
          共 <span className="text-text-primary font-medium">{locations.length}</span> 个地点
        </div>
        <div className="flex items-center gap-2">
          {/* 视图切换 */}
          <div className="flex bg-bg-elevated rounded-lg p-0.5">
            <button
              onClick={() => setView('tree')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                view === 'tree' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" /> 树状图
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                view === 'list' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <List className="w-3.5 h-3.5" /> 列表
            </button>
          </div>
          <button
            onClick={() => handleAdd(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加地点
          </button>
        </div>
      </div>

      {/* 树状图视图 */}
      {view === 'tree' && (
        <div className="mb-6">
          <LocationTreeView
            tree={tree}
            onSelect={id => {
              setView('list')
              setExpandedId(id)
            }}
          />
          {locations.length > 0 && (
            <p className="text-xs text-text-muted mt-2 text-center">点击节点可跳转到列表编辑</p>
          )}
        </div>
      )}

      {/* 列表视图 */}
      {view === 'list' && (
        <div>
          {locations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <MapPin className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm mb-3">暂无地点</p>
              <button
                onClick={() => handleAdd(null)}
                className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加第一个地点
              </button>
            </div>
          ) : (
            topLevelLocations.map(loc => renderListItem(loc))
          )}
        </div>
      )}
    </div>
  )
}
