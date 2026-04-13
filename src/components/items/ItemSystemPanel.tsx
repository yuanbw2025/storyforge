import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Gem } from 'lucide-react'
import { useItemSystemStore } from '../../stores/item-system'
import type { Project, Item, ItemType } from '../../lib/types'
import { nanoid } from '../../lib/utils/id'

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: 'weapon', label: '武器' },
  { value: 'armor', label: '防具' },
  { value: 'artifact', label: '法宝' },
  { value: 'pill', label: '丹药' },
  { value: 'material', label: '材料' },
  { value: 'manual', label: '功法秘籍' },
  { value: 'formation', label: '阵法' },
  { value: 'special', label: '特殊物品' },
  { value: 'other', label: '其他' },
]

interface Props {
  project: Project
}

export default function ItemSystemPanel({ project }: Props) {
  const { itemSystem, loadAll, save } = useItemSystemStore()
  const [overview, setOverview] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  useEffect(() => {
    if (itemSystem) {
      setOverview(itemSystem.overview || '')
      try {
        setItems(JSON.parse(itemSystem.items || '[]'))
      } catch {
        setItems([])
      }
    }
  }, [itemSystem])

  const saveItems = useCallback(async (newItems: Item[]) => {
    setItems(newItems)
    await save({
      projectId: project.id!,
      items: JSON.stringify(newItems),
    })
  }, [project.id, save])

  const handleSaveOverview = async () => {
    await save({ projectId: project.id!, overview })
  }

  const handleAddItem = () => {
    const newItem: Item = {
      id: nanoid(),
      name: '新道具',
      type: 'other',
      rank: '',
      description: '',
      abilities: '',
      origin: '',
      owner: '',
      significance: '',
      order: items.length,
    }
    const updated = [...items, newItem]
    setExpandedId(newItem.id)
    saveItems(updated)
  }

  const handleUpdateItem = (id: string, data: Partial<Item>) => {
    const updated = items.map(i => i.id === id ? { ...i, ...data } : i)
    saveItems(updated)
  }

  const handleDeleteItem = (id: string) => {
    const updated = items.filter(i => i.id !== id)
    saveItems(updated)
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">💎 道具系统</h2>

      {/* 道具体系总述 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">道具体系总述</label>
        <textarea
          value={overview}
          onChange={e => setOverview(e.target.value)}
          onBlur={handleSaveOverview}
          placeholder="描述这个世界的道具体系、品级划分、获取方式等..."
          className="w-full h-28 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 道具列表 */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-text-primary">道具列表 ({items.length})</h3>
        <button
          onClick={handleAddItem}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加道具
        </button>
      </div>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">暂无道具，点击上方按钮添加</p>
        ) : (
          items.map(item => {
            const isExpanded = expandedId === item.id
            return (
              <div key={item.id} className="border border-border rounded-lg bg-bg-surface overflow-hidden">
                {/* 头部 */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-hover transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
                  <Gem className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium text-text-primary flex-1 text-left">{item.name}</span>
                  {item.rank && (
                    <span className="text-xs text-amber-400 mr-1">{item.rank}</span>
                  )}
                  <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded">
                    {ITEM_TYPES.find(t => t.value === item.type)?.label || item.type}
                  </span>
                </button>

                {/* 展开编辑 */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">名称</label>
                        <input
                          value={item.name}
                          onChange={e => handleUpdateItem(item.id, { name: e.target.value })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">类型</label>
                        <select
                          value={item.type}
                          onChange={e => handleUpdateItem(item.id, { type: e.target.value as ItemType })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        >
                          {ITEM_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">品级/等级</label>
                        <input
                          value={item.rank}
                          onChange={e => handleUpdateItem(item.id, { rank: e.target.value })}
                          placeholder="如：天阶上品"
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">描述</label>
                      <textarea
                        value={item.description}
                        onChange={e => handleUpdateItem(item.id, { description: e.target.value })}
                        className="w-full h-20 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">能力/效果</label>
                      <textarea
                        value={item.abilities}
                        onChange={e => handleUpdateItem(item.id, { abilities: e.target.value })}
                        placeholder="描述该道具的特殊能力或效果..."
                        className="w-full h-16 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">来历</label>
                        <input
                          value={item.origin}
                          onChange={e => handleUpdateItem(item.id, { origin: e.target.value })}
                          placeholder="道具的来源或铸造者"
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">当前持有者</label>
                        <input
                          value={item.owner}
                          onChange={e => handleUpdateItem(item.id, { owner: e.target.value })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">剧情重要性</label>
                      <input
                        value={item.significance}
                        onChange={e => handleUpdateItem(item.id, { significance: e.target.value })}
                        className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除道具
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
