/**
 * 全局协调 Toggle · 设定生成模式切换
 *
 * 在每个设定生成面板的 AI 生成区增加此切换：
 * - 🎯 仅本面板（默认）：保持现有行为，仅读取同面板内其他字段
 * - 🌐 全局协调：调用 assembleCrossSettingContext() 读取全部 14 个设定源
 */

interface Props {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

export default function CrossSettingToggle({ enabled, onChange }: Props) {
  return (
    <div className="flex shrink-0 items-center rounded-lg border border-border bg-bg-base p-0.5">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`px-2 py-1 text-xs rounded-md transition-colors ${
          !enabled ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'
        }`}
        title="仅读取本面板内其他字段作为上下文"
      >
        🎯 仅本面板
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-2 py-1 text-xs rounded-md transition-colors ${
          enabled ? 'bg-accent/15 text-accent font-medium' : 'text-text-muted hover:text-text-primary'
        }`}
        title="读取全部设定（世界观/角色/力量体系/词条/规则等）确保一致性"
      >
        🌐 全局协调
      </button>
    </div>
  )
}
