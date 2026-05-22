/**
 * MapMarkerEditor — 地图标记属性编辑面板（右侧）
 * 选中一个 marker 后显示，可编辑名称、类型、重要度、备注等
 */

import { useState, useEffect } from 'react'
import { X, Trash2 } from 'lucide-react'
import type { MapMarker, MarkerType } from '../../lib/types/world-map'

const MARKER_TYPE_OPTIONS: { value: MarkerType; label: string; icon: string }[] = [
  { value: 'capital', label: '首都/皇城', icon: '🏰' },
  { value: 'city', label: '城市', icon: '🏙️' },
  { value: 'town', label: '城镇', icon: '🏘️' },
  { value: 'village', label: '村庄', icon: '🏕️' },
  { value: 'sect', label: '宗门/门派', icon: '⚔️' },
  { value: 'fortress', label: '要塞/城堡', icon: '🏯' },
  { value: 'port', label: '港口', icon: '⚓' },
  { value: 'academy', label: '学院', icon: '📚' },
  { value: 'ruin', label: '废墟', icon: '🏚️' },
  { value: 'dungeon', label: '地下城', icon: '💀' },
  { value: 'oasis', label: '绿洲', icon: '🌴' },
  { value: 'bridge', label: '桥梁', icon: '🌉' },
  { value: 'lighthouse', label: '灯塔', icon: '🗼' },
  { value: 'mine', label: '矿山', icon: '⛏️' },
  { value: 'shrine', label: '神殿/祠堂', icon: '⛩️' },
  { value: 'custom', label: '自定义', icon: '📍' },
]

interface Props {
  marker: MapMarker
  onUpdate: (markerId: string, changes: Partial<MapMarker>) => void
  onDelete: (markerId: string) => void
  onClose: () => void
}

export default function MapMarkerEditor({ marker, onUpdate, onDelete, onClose }: Props) {
  const [name, setName] = useState(marker.name)
  const [note, setNote] = useState(marker.note || '')
  const [faction, setFaction] = useState(marker.faction || '')

  // 当选中不同 marker 时重置本地状态
  useEffect(() => {
    setName(marker.name)
    setNote(marker.note || '')
    setFaction(marker.faction || '')
  }, [marker.id, marker.name, marker.note, marker.faction])

  const handleBlurName = () => {
    if (name.trim() && name !== marker.name) {
      onUpdate(marker.id, { name: name.trim() })
    }
  }

  const handleBlurNote = () => {
    if (note !== (marker.note || '')) {
      onUpdate(marker.id, { note })
    }
  }

  const handleBlurFaction = () => {
    if (faction !== (marker.faction || '')) {
      onUpdate(marker.id, { faction })
    }
  }

  return (
    <div className="w-72 border-l border-border bg-bg-surface flex flex-col h-full overflow-y-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary">标记属性</h3>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {/* 名称 */}
        <div>
          <label className="block text-xs text-text-muted mb-1">名称</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={handleBlurName}
            className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        {/* 类型 */}
        <div>
          <label className="block text-xs text-text-muted mb-1">类型</label>
          <select
            value={marker.type}
            onChange={e => onUpdate(marker.id, { type: e.target.value as MarkerType })}
            className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            {MARKER_TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.icon} {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 重要度 */}
        <div>
          <label className="block text-xs text-text-muted mb-1">
            重要度 <span className="text-accent">{marker.importance}</span>
          </label>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={marker.importance}
            onChange={e => onUpdate(marker.id, { importance: Number(e.target.value) })}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
            <span>1 路边</span>
            <span>3 一般</span>
            <span>5 核心</span>
          </div>
        </div>

        {/* 势力 */}
        <div>
          <label className="block text-xs text-text-muted mb-1">所属势力</label>
          <input
            value={faction}
            onChange={e => setFaction(e.target.value)}
            onBlur={handleBlurFaction}
            placeholder="如：天龙帝国、无主之地"
            className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        {/* 备注 */}
        <div>
          <label className="block text-xs text-text-muted mb-1">备注</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={handleBlurNote}
            placeholder="关于这个地点的补充说明..."
            className="w-full h-24 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
          />
        </div>

        {/* 坐标 (只读) */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-text-muted mb-1">X</label>
            <input
              value={Math.round(marker.x)}
              readOnly
              className="w-full px-2 py-1.5 bg-bg-elevated border border-border rounded text-xs text-text-muted"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Y</label>
            <input
              value={Math.round(marker.y)}
              readOnly
              className="w-full px-2 py-1.5 bg-bg-elevated border border-border rounded text-xs text-text-muted"
            />
          </div>
        </div>

        {/* 标签 */}
        {marker.userAdded && (
          <div className="text-[10px] text-accent bg-accent/10 rounded px-2 py-1 inline-block">
            用户手动添加
          </div>
        )}
      </div>

      {/* 删除按钮 */}
      <div className="p-4 border-t border-border">
        <button
          onClick={() => onDelete(marker.id)}
          className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-red-400 hover:bg-red-500/10 text-xs rounded border border-red-500/20 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除标记
        </button>
      </div>
    </div>
  )
}
