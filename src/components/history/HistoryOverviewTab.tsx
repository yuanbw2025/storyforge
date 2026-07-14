import { CTextarea } from '../shared/CompositionInput'

interface Props {
  overview: string
  eraSystem: string
  onOverviewChange: (value: string) => void
  onEraSystemChange: (value: string) => void
  onSaveOverview: () => void
  onSaveEraSystem: () => void
}

export default function HistoryOverviewTab({
  overview,
  eraSystem,
  onOverviewChange,
  onEraSystemChange,
  onSaveOverview,
  onSaveEraSystem,
}: Props) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-2">
        <label className="block text-sm font-medium text-text-primary">历史总述</label>
        <p className="text-xs text-text-muted">描述这个世界的整体历史脉络、重大转折、文明兴衰等...</p>
        <CTextarea
          value={overview}
          onChange={event => onOverviewChange(event.target.value)}
          onBlur={onSaveOverview}
          placeholder="例如：大唐开元盛世，表面歌舞升平，实则暗流涌动。藩镇割据之势已成，朝堂之上牛李党争初露端倪..."
          className="w-full h-36 p-3 bg-bg-base border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-2">
        <label className="block text-sm font-medium text-text-primary">纪年体系</label>
        <p className="text-xs text-text-muted">描述这个世界的纪年方式，如：年号纪年、干支纪年等...</p>
        <CTextarea
          value={eraSystem}
          onChange={event => onEraSystemChange(event.target.value)}
          onBlur={onSaveEraSystem}
          placeholder="例如：采用唐代年号纪年（如开元、天宝），辅以干支纪年（如甲子、乙丑）。"
          className="w-full h-24 p-3 bg-bg-base border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>
    </div>
  )
}
