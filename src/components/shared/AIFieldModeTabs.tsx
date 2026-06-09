import type { FieldGenerationMode } from '../../lib/ai/field-generation-context'

interface Props {
  value: FieldGenerationMode
  onChange: (mode: FieldGenerationMode) => void
}

const MODES: [FieldGenerationMode, string][] = [
  ['expand', '扩写'],
  ['rewrite', '重写'],
  ['polish', '润色'],
]

export default function AIFieldModeTabs({ value, onChange }: Props) {
  return (
    <div className="flex shrink-0 items-center rounded-lg border border-border bg-bg-base p-0.5">
      {MODES.map(([key, text]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`px-2 py-1 text-xs rounded-md transition-colors ${
            value === key ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
