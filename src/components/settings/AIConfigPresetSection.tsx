import { Pencil, X } from 'lucide-react'
import type { AIConfigPreset } from '../../lib/types'

interface Props {
  presets: AIConfigPreset[]
  activePresetId: string | null
  editingPreset: AIConfigPreset | null
  savingPreset: boolean
  presetName: string
  onPresetNameChange: (name: string) => void
  onStartSaving: () => void
  onCancelSaving: () => void
  onSavePreset: () => void
  onApplyPreset: (id: string) => void
  onUpdatePreset: (id: string) => void
  onRenamePreset: (id: string, name: string) => void
  onDeletePreset: (id: string, name: string) => void
}

export default function AIConfigPresetSection({
  presets,
  activePresetId,
  editingPreset,
  savingPreset,
  presetName,
  onPresetNameChange,
  onStartSaving,
  onCancelSaving,
  onSavePreset,
  onApplyPreset,
  onUpdatePreset,
  onRenamePreset,
  onDeletePreset,
}: Props) {
  return (
    <div className="mb-4 pb-4 border-b border-border/50">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm text-text-secondary">配置预设</label>
        {editingPreset && !savingPreset ? (
          <div className="flex items-center gap-1.5">
            <button onClick={() => onUpdatePreset(editingPreset.id)}
              title={`用当前表单内容覆盖「${editingPreset.name}」`}
              className="text-xs px-2.5 py-1 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors">
              保存修改到「{editingPreset.name}」
            </button>
            <button onClick={onStartSaving}
              className="text-xs px-2.5 py-1 rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-accent hover:border-accent/50 transition-colors">
              另存为新预设
            </button>
          </div>
        ) : savingPreset ? (
          <div className="flex items-center gap-1.5">
            <input autoFocus value={presetName} onChange={event => onPresetNameChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') onSavePreset()
                if (event.key === 'Escape') onCancelSaving()
              }}
              placeholder="预设名称，如「DeepSeek 主力」"
              className="px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent w-44" />
            <button onClick={onSavePreset} className="px-2 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover">保存</button>
            <button onClick={onCancelSaving} className="px-2 py-1 text-xs text-text-muted hover:text-text-primary">取消</button>
          </div>
        ) : (
          <button onClick={onStartSaving}
            className="text-xs px-2.5 py-1 rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-accent hover:border-accent/50 transition-colors">
            ＋ 保存当前为预设
          </button>
        )}
      </div>

      {presets.length === 0 ? (
        <p className="text-xs text-text-muted">还没有预设。配好一套 API 后点「保存当前为预设」，之后可一键切换。</p>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          {presets.map(preset => (
            <div key={preset.id}
              className={`group flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs rounded-full border transition-colors ${
                activePresetId === preset.id
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
              }`}>
              <button onClick={() => onApplyPreset(preset.id)} title={`${preset.config.provider} · ${preset.config.model}`}>{preset.name}</button>
              {activePresetId === preset.id && (
                <button onClick={() => onUpdatePreset(preset.id)} title="用当前配置覆盖此预设" className="opacity-70 hover:opacity-100">保存</button>
              )}
              <button onClick={() => onRenamePreset(preset.id, preset.name)} title="重命名"
                className="opacity-0 group-hover:opacity-70 hover:opacity-100" aria-label={`重命名预设 ${preset.name}`}>
                <Pencil className="h-3 w-3" />
              </button>
              <button onClick={() => onDeletePreset(preset.id, preset.name)} title="删除"
                className="opacity-0 group-hover:opacity-70 hover:opacity-100 hover:text-red-400" aria-label={`删除预设 ${preset.name}`}>
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {presets.length > 0 && (
        <p className="mt-2 text-[11px] text-text-muted">点击预设会应用整套配置，包括上下文窗口；修改表单后需点击上方按钮才会写回该预设。</p>
      )}
    </div>
  )
}
