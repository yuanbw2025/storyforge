import { useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import { workCoverAgnesBaseV1 } from '../../lib/work-cover/image-recipes'

export default function WorkCoverConnection() {
  const { presets, workCoverPresetId, activePresetId, setWorkCoverPresetId } = useAIConfigStore()
  const [error, setError] = useState('')
  const eligible = presets.filter(preset => { try { workCoverAgnesBaseV1(preset.config); return true } catch { return false } })
  return <div className="mb-4 rounded-lg border border-border bg-bg-base p-3">
    <label className="text-sm text-text-secondary flex flex-wrap items-center gap-2">作品封面图片连接
      <select aria-label="作品封面图片连接" value={workCoverPresetId ?? ''} onChange={event => {
        try { setWorkCoverPresetId(event.target.value || null); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      }} className="min-w-0 max-w-full rounded border border-border bg-bg-surface px-2 py-1 text-sm">
        <option value="">使用当前已选择的预设{activePresetId ? '' : '（尚未选择）'}</option>
        {eligible.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
    </label>
    <p className="text-xs text-text-muted mt-2">复用 Agnes 官方连接，图片型号 agnes-image-2.1-flash。文字连接测试不代表已获图片权限；仅点击作品卡片的生成按钮才请求一张图片，费用未知。</p>
    {!eligible.length && <p className="text-xs text-text-muted mt-2">先将 Agnes 官方连接保存为预设，再在这里选择；已有图片仍可手动上传。</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
