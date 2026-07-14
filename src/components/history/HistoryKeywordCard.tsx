import { ChevronDown, ChevronRight } from 'lucide-react'
import type {
  Chapter,
  HistoricalEra,
  HistoricalKeyword,
  HistoricalKeywordCategory,
} from '../../lib/types'
import { HISTORICAL_ERA_LABELS, KEYWORD_CATEGORY_LABELS } from '../../lib/types/history'
import { CInput, CTextarea } from '../shared/CompositionInput'
import HistoryAgentWorkspace, { type HistoryAgentViewState } from './HistoryAgentWorkspace'
import HistoryChapterPicker from './HistoryChapterPicker'

interface Props {
  keyword: HistoricalKeyword
  chapters: Chapter[]
  expanded: boolean
  canEdit: boolean
  consultActive: boolean
  stormActive: boolean
  consultPreparing: boolean
  stormPreparing: boolean
  consultAI: HistoryAgentViewState
  stormAI: HistoryAgentViewState
  onToggle: () => void
  onChange: (patch: Partial<HistoricalKeyword>) => void
  onConsult: () => void
  onStorm: () => void
  onDelete: () => void
  onAcceptConsult: (text: string) => void
  onAcceptStorm: (text: string) => void
}

export default function HistoryKeywordCard({
  keyword,
  chapters,
  expanded,
  canEdit,
  consultActive,
  stormActive,
  consultPreparing,
  stormPreparing,
  consultAI,
  stormAI,
  onToggle,
  onChange,
  onConsult,
  onStorm,
  onDelete,
  onAcceptConsult,
  onAcceptStorm,
}: Props) {
  const eraLabel = HISTORICAL_ERA_LABELS[keyword.era as HistoricalEra] || keyword.era
  const categoryLabel = KEYWORD_CATEGORY_LABELS[keyword.category] || keyword.category

  return (
    <div className={`rounded-xl border bg-bg-surface transition-all ${
      expanded
        ? 'border-accent/40 shadow-sm'
        : 'border-border hover:border-border-hover'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-4 py-3.5 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold text-accent">#{keyword.keyword}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted">
              {categoryLabel}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted">
              {eraLabel}
            </span>
          </div>
          {keyword.description && !expanded && (
            <p className="text-xs text-text-muted line-clamp-1 mt-1">{keyword.description}</p>
          )}
        </div>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0 mt-1" />
          : <ChevronRight className="w-4 h-4 text-text-muted shrink-0 mt-1" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-text-muted mb-1">关键词名称</label>
              <CInput
                value={keyword.keyword}
                onChange={event => onChange({ keyword: event.target.value })}
                className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-1">分类</label>
              <select
                aria-label="关键词分类"
                value={keyword.category}
                onChange={event => onChange({ category: event.target.value as HistoricalKeywordCategory })}
                className="w-full px-2 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                {Object.entries(KEYWORD_CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-1">适用历史时期</label>
              <select
                aria-label="适用历史时期"
                value={keyword.era}
                onChange={event => onChange({ era: event.target.value as HistoricalEra })}
                className="w-full px-2 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                {Object.entries(HISTORICAL_ERA_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-text-muted mb-1">具体时间范围/区间 (可选)</label>
              <CInput
                value={keyword.customTimeRange || ''}
                onChange={event => onChange({ customTimeRange: event.target.value })}
                placeholder="如：公元712年-756年、18世纪中叶"
                className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-1">地理位置/范围 (可选)</label>
              <CInput
                value={keyword.location || ''}
                onChange={event => onChange({ location: event.target.value })}
                placeholder="如：江南地区、君士坦丁堡、中原"
                className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-text-muted mb-1">
              📒 条目定稿（写作时会进入小说上下文；考据 / 风暴 agent 会读取作为核验或发散对象，但<span className="text-amber-500">不会直接覆盖</span>）
            </label>
            <CTextarea
              value={keyword.description}
              onChange={event => onChange({ description: event.target.value })}
              placeholder="作者打磨好的最终条目内容，将作为 AI 写作的历史细节注入。例如：『飞钱：唐宪宗时期出现的汇兑凭证，由邸店或商号代为兑付。』"
              className="w-full h-24 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-[11px] text-text-muted mb-1">关联章节</label>
            <HistoryChapterPicker
              chapters={chapters}
              relatedChapterIds={keyword.relatedChapterIds}
              spacious
              onChange={relatedChapterIds => onChange({ relatedChapterIds })}
            />
          </div>

          <div>
            <label className="block text-[11px] text-text-muted mb-1">
              🧭 概念与创作思路（提交给 AI 之前的初步设定；得到 agent 反馈后可在此处修正）
            </label>
            <CTextarea
              value={keyword.conceptNote || ''}
              onChange={event => onChange({ conceptNote: event.target.value })}
              placeholder="描述你想为这个关键词达到的效果、能接受的艺术改造或架空范围。例如：『允许把飞钱的普及度写得比真实高一些；想要市井使用场景。』"
              className="w-full h-24 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-text-muted mb-1">
                📝 给「历史考据 agent」的补充说明
              </label>
              <CTextarea
                value={keyword.consultPrompt || ''}
                onChange={event => onChange({ consultPrompt: event.target.value })}
                placeholder="例：本作允许把飞钱写得普及度更高；请重点检查兑付流程和涉事衙门称谓。"
                className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-1">
                💡 给「头脑风暴 agent」的补充说明
              </label>
              <CTextarea
                value={keyword.stormPrompt || ''}
                onChange={event => onChange({ stormPrompt: event.target.value })}
                placeholder="例：重点发散市井使用场景与可能的诈骗冲突。"
                className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <HistoryAgentWorkspace
            canEdit={canEdit}
            consultActive={consultActive}
            stormActive={stormActive}
            consultPreparing={consultPreparing}
            stormPreparing={stormPreparing}
            consultAI={consultAI}
            stormAI={stormAI}
            savedConsult={keyword.aiConsult}
            savedStorm={keyword.aiBrainstorm}
            savedStormLabel="AI 时代细节库"
            savedStormMaxHeight="80"
            deleteLabel="删除关键词"
            onConsult={onConsult}
            onStorm={onStorm}
            onDelete={onDelete}
            onAcceptConsult={onAcceptConsult}
            onAcceptStorm={onAcceptStorm}
            onClearConsult={() => onChange({ aiConsult: undefined })}
            onClearStorm={() => onChange({ aiBrainstorm: undefined })}
          />
        </div>
      )}
    </div>
  )
}
