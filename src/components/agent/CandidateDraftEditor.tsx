import { useMemo, useState } from 'react'
import { FIELD_REGISTRY } from '../../lib/registry/field-registry'
import { MORAL_AXIS_LABELS, ORDER_AXIS_LABELS, ROLE_WEIGHT_LABELS } from '../../lib/character/character-axes'
import type { MasterCandidatePayload } from '../../lib/agent/orchestrator'

const ENUM_LABELS: Record<string, Record<string, string>> = {
  roleWeight: ROLE_WEIGHT_LABELS,
  moralAxis: MORAL_AXIS_LABELS,
  orderAxis: ORDER_AXIS_LABELS,
}

/** A view of the existing candidate, never a second adoption/field mapping. */
export default function CandidateDraftEditor({
  payload,
  value,
  disabled,
  onChange,
}: {
  payload: MasterCandidatePayload
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const [raw, setRaw] = useState(false)
  const table =
    payload.skillId === 'character.create'
      ? 'characters'
      : payload.agentId === 'outline' && payload.outlineMode
        ? 'outlineNodes'
        : null
  const parsed = useMemo(() => {
    if (!table) return null
    try {
      const result: unknown = JSON.parse(value)
      const rows = Array.isArray(result) ? result : [result]
      if (
        !rows.length ||
        !rows.every(
          (row) =>
            row &&
            typeof row === 'object' &&
            !Array.isArray(row) &&
            Object.entries(row).every(
              ([key, entry]) =>
                typeof entry === 'string' &&
                FIELD_REGISTRY.some((spec) => spec.target === table && spec.field === key),
            ),
        )
      )
        return null
      return { rows: rows as Record<string, string>[], array: Array.isArray(result) }
    } catch {
      return null
    }
  }, [table, value])
  const [primaryFields] = useState(
    () =>
      new Set(
        parsed?.rows.flatMap((row, index) =>
          Object.entries(row)
            .filter(([key, text]) => text || key === 'name' || key === 'title')
            .map(([key]) => `${index}:${key}`),
        ) ?? [],
      ),
  )
  const changeField = (index: number, key: string, text: string) => {
    if (!parsed) return
    const rows = parsed.rows.map((row, at) => (at === index ? { ...row, [key]: text } : row))
    onChange(JSON.stringify(parsed.array ? rows : rows[0], null, 2))
  }
  return (
    <div>
      {parsed && (
        <button
          type="button"
          className="mb-2 text-xs text-accent"
          onClick={() => setRaw((current) => !current)}
        >
          {raw ? '返回内容编辑' : '查看原始结构'}
        </button>
      )}
      {parsed && !raw ? (
        <div className="space-y-4" aria-label={`${payload.label}候选内容`}>
          {parsed.rows.map((row, index) => (
            <fieldset key={index} className="space-y-3 rounded border border-border p-3" disabled={disabled}>
              <legend className="px-1 text-xs text-text-muted">
                {parsed.array ? `第 ${index + 1} 项` : '角色内容'}
              </legend>
              {Object.entries(row).map(([key, text]) => {
                const spec = FIELD_REGISTRY.find((item) => item.target === table && item.field === key)!
                const label = spec.labels?.[0] ?? key
                const field = (
                  <label className="block text-xs text-text-secondary">
                    <span>{label}</span>
                    {spec.type === 'enum' ? (
                      <select
                        aria-label={`${label} · 候选 ${index + 1}`}
                        value={text}
                        onChange={(event) => changeField(index, key, event.target.value)}
                        className="mt-1 w-full"
                      >
                        {spec.enums?.map((option) => (
                          <option key={option} value={option}>
                            {ENUM_LABELS[key]?.[option] ?? option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <textarea
                        aria-label={`${label} · 候选 ${index + 1}`}
                        value={text}
                        rows={key === 'title' || key === 'name' ? 1 : 3}
                        onChange={(event) => changeField(index, key, event.target.value)}
                        className="mt-1 w-full resize-y rounded border border-border p-2 text-sm leading-6"
                      />
                    )}
                  </label>
                )
                return primaryFields.has(`${index}:${key}`) ? (
                  <div key={key}>{field}</div>
                ) : (
                  <details key={key}>
                    <summary className="cursor-pointer text-xs text-text-muted">{label} · 留白，可选</summary>
                    {field}
                  </details>
                )
              })}
              {parsed.array && parsed.rows.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-text-muted"
                  onClick={() =>
                    onChange(
                      JSON.stringify(
                        parsed.rows.filter((_, at) => at !== index),
                        null,
                        2,
                      ),
                    )
                  }
                >
                  移除此项候选
                </button>
              )}
            </fieldset>
          ))}
        </div>
      ) : (
        <textarea
          aria-label={`${payload.label}候选内容`}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="agent-candidate-editor w-full resize-y rounded border border-border bg-bg-surface p-3 text-sm leading-7 text-text-primary outline-none focus:border-accent disabled:opacity-60"
        />
      )}
    </div>
  )
}
