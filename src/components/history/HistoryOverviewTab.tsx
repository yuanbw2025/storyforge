import { HistoryTextAIButton } from './HistoryTextAuthoring'
import { inputAreaLayoutV1 } from '../../lib/input-area-layout'
import { InlineTextarea, type InlineSave } from '../shared/InlineEdit'
import { useWorldSettingsLayout } from '../longform/WorldSettingsLayout'

import type { LocalSaveContractV1 } from '../../lib/authoring/local-save-evidence'

interface Props {
  resizableInputs?: boolean
  overview: string
  eraSystem: string
  onSaveOverview: InlineSave
  onSaveEraSystem: InlineSave
  localSaves?: Partial<Record<'overview' | 'eraSystem', LocalSaveContractV1>>
}

export default function HistoryOverviewTab({
  resizableInputs = false, localSaves,
  overview,
  eraSystem,
  onSaveOverview,
  onSaveEraSystem,
}: Props) {
  const compact = useWorldSettingsLayout()
  return (
    <div className={compact ? 'lf-world-field space-y-4' : 'space-y-6 max-w-4xl'}>
      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-2">
        <label className="block text-sm font-medium text-text-primary">历史总述<HistoryTextAIButton field="overview"/></label>
        <p className="text-xs text-text-muted">描述这个世界的整体历史脉络、重大转折、文明兴衰等...</p>
        <InlineTextarea markdownRead minRows={5}
          inputAreaLayout={inputAreaLayoutV1(resizableInputs, 'history.overview')}
          localSave={localSaves?.overview}
          value={overview}
          onChange={onSaveOverview}
          placeholder="例如：大唐开元盛世，表面歌舞升平，实则暗流涌动。藩镇割据之势已成，朝堂之上牛李党争初露端倪..."
          className="w-full h-36 p-3 bg-bg-base border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-2">
        <label className="block text-sm font-medium text-text-primary">纪年体系<HistoryTextAIButton field="eraSystem"/></label>
        <p className="text-xs text-text-muted">描述这个世界的纪年方式，如：年号纪年、干支纪年等...</p>
        <InlineTextarea markdownRead minRows={3}
          inputAreaLayout={inputAreaLayoutV1(resizableInputs, 'history.eraSystem')}
          localSave={localSaves?.eraSystem}
          value={eraSystem}
          onChange={onSaveEraSystem}
          placeholder="例如：采用唐代年号纪年（如开元、天宝），辅以干支纪年（如甲子、乙丑）。"
          className="w-full h-24 p-3 bg-bg-base border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>
    </div>
  )
}
