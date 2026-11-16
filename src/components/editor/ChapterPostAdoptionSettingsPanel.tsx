import type { ResolvedPostAdoptionSettingsV1 } from '../../lib/prose/post-adoption-policy'

interface Props {
  settings: ResolvedPostAdoptionSettingsV1
  onPersist: (settings: ResolvedPostAdoptionSettingsV1) => Promise<void>
}

export default function ChapterPostAdoptionSettingsPanel({ settings, onPersist }: Props) {
  return (
    <details className="mb-3 rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-secondary">
      <summary className="cursor-pointer font-medium text-text-primary">正文采纳后的演化策略</summary>
      <div className="mt-3 space-y-3">
        <label className="flex flex-wrap items-center gap-2">
          <span>运行方式</span>
          <select
            value={settings.policy}
            onChange={event => void onPersist({
              ...settings,
              policy: event.target.value as ResolvedPostAdoptionSettingsV1['policy'],
            })}
            className="rounded border border-border bg-bg-base px-2 py-1 text-text-primary"
          >
            <option value="off">关闭（只做本地失效标记）</option>
            <option value="suggest">建议（默认，确认后运行）</option>
            <option value="auto-with-budget">预算内自动运行</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          {(['organization', 'memory', 'retrieval', 'consistency'] as const).map(taskType => (
            <label key={taskType} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={settings.taskTypes.includes(taskType)}
                onChange={event => void onPersist({
                  ...settings,
                  taskTypes: event.target.checked
                    ? [...settings.taskTypes, taskType]
                    : settings.taskTypes.filter(item => item !== taskType),
                })}
                className="accent-accent"
              />
              {taskType === 'organization' ? '七域候选'
                : taskType === 'memory' ? '章节记忆'
                  : taskType === 'retrieval' ? '检索重建'
                    : '一致性守卫'}
            </label>
          ))}
        </div>
        {settings.policy === 'auto-with-budget' && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ['maxModelCalls', '调用上限', 1],
              ['maxInputTokens', '输入 token', 1000],
              ['maxOutputTokens', '输出 token', 1000],
              ['maxCostUsd', '费用上限 USD', 0.01],
            ] as const).map(([key, label, step]) => (
              <label key={key} className="space-y-1">
                <span className="block text-text-muted">{label}</span>
                <input
                  type="number"
                  min={0}
                  step={step}
                  defaultValue={settings.budget[key]}
                  onBlur={event => void onPersist({
                    ...settings,
                    budget: { ...settings.budget, [key]: Number(event.target.value) },
                  })}
                  className="w-full rounded border border-border bg-bg-base px-2 py-1 text-text-primary"
                />
              </label>
            ))}
            <label className="col-span-2 inline-flex items-center gap-2 sm:col-span-4">
              <input
                type="checkbox"
                checked={settings.budget.allowUnknownCost}
                onChange={event => void onPersist({
                  ...settings,
                  budget: { ...settings.budget, allowUnknownCost: event.target.checked },
                })}
                className="accent-accent"
              />
              允许免费或尚无可信价格表的模型在其它预算通过时自动运行
            </label>
          </div>
        )}
        <p className="text-text-muted">检索依赖章节记忆，一致性守卫依赖检索；保存时会自动补齐必要前置任务。</p>
      </div>
    </details>
  )
}
