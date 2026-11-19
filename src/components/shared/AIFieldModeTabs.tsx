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
    <div role="group" aria-label="AI 文字处理方式" className="flex shrink-0 items-center rounded-lg border border-border bg-bg-base p-0.5">
      {MODES.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`px-2 py-1 text-xs rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:saturate-0 ${
            value === key ? 'bg-accent font-semibold ring-1 ring-inset ring-accent-hover enabled:hover:bg-accent-hover' : 'text-text-primary enabled:hover:bg-bg-hover'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
