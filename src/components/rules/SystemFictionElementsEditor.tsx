import { useId } from 'react'
import { CTextarea } from '../shared/CompositionInput'
import { SYSTEM_FICTION_ELEMENT_FIELDS } from '../../lib/prose/system-fiction-contract'
import type { SystemFictionElementsV1 } from '../../lib/types/creative-rules'

/** 同一个原生结构编辑器用于作者资料与未采纳候选，不以 JSON 编辑作为普通操作。 */
export default function SystemFictionElementsEditor({ value, onChange, disabled, label = '系统文元素' }: {
  value: SystemFictionElementsV1
  onChange: (value: SystemFictionElementsV1) => void
  disabled?: boolean
  label?: string
}) {
  const id = useId()
  return (
    <fieldset disabled={disabled} aria-label={label} className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} />
        启用这些系统文作者要求
      </label>
      <p className="text-xs text-text-muted">允许留白。奖励与成长是写作计划，实际获得的物品和进度仍以已确认正文为准。</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SYSTEM_FICTION_ELEMENT_FIELDS.map(({ key, label: fieldLabel, placeholder }) => (
          <div key={key}>
            <label htmlFor={`${id}-${key}`} className="mb-1 block text-sm text-text-secondary">{fieldLabel}</label>
            <CTextarea
              id={`${id}-${key}`}
              aria-label={`${label} · ${fieldLabel}`}
              value={value[key]}
              onChange={event => onChange({ ...value, [key]: event.target.value })}
              placeholder={placeholder}
              className="min-h-24 w-full resize-y rounded-lg border border-border bg-bg-surface p-3 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        ))}
      </div>
    </fieldset>
  )
}
