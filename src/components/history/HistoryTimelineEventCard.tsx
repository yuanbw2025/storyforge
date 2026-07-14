import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Chapter, HistoricalEra, HistoricalTimelineEvent } from '../../lib/types'
import { HISTORICAL_ERA_LABELS } from '../../lib/types/history'
import { formatHistoricalYear } from '../../lib/history/year'
import { CInput, CTextarea } from '../shared/CompositionInput'
import HistoryAgentWorkspace, { type HistoryAgentViewState } from './HistoryAgentWorkspace'
import HistoryChapterPicker from './HistoryChapterPicker'

interface Props {
  event: HistoricalTimelineEvent
  chapters: Chapter[]
  expanded: boolean
  canEdit: boolean
  worldBadge?: { icon: string; name: string }
  consultActive: boolean
  stormActive: boolean
  consultPreparing: boolean
  stormPreparing: boolean
  consultAI: HistoryAgentViewState
  stormAI: HistoryAgentViewState
  onToggle: () => void
  onChange: (patch: Partial<HistoricalTimelineEvent>) => void
  onConsult: () => void
  onStorm: () => void
  onDelete: () => void
  onAcceptConsult: (text: string) => void
  onAcceptStorm: (text: string) => void
}

export default function HistoryTimelineEventCard({
  event,
  chapters,
  expanded,
  canEdit,
  worldBadge,
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
  const eraLabel = HISTORICAL_ERA_LABELS[event.era as HistoricalEra] || event.era
  const yearText = formatHistoricalYear(event.year)

  return (
    <div className="relative">
      <span className={`absolute -left-[31px] top-3.5 w-2.5 h-2.5 rounded-full border-2 bg-bg-base transition-colors ${
        event.isHistorical
          ? 'border-blue-500 ring-4 ring-blue-500/10'
          : 'border-purple-500 ring-4 ring-purple-500/10'
      }`} />

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
              <span className="text-xs font-mono font-semibold text-text-secondary">
                {event.date} ({yearText})
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted">
                {eraLabel}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                event.isHistorical
                  ? 'border-blue-500/20 text-blue-400 bg-blue-500/5'
                  : 'border-purple-500/20 text-purple-400 bg-purple-500/5'
              }`}>
                {event.isHistorical ? '⚓ 史实锚点' : '✨ 虚构/架空'}
              </span>
              {event.isHistorical && (
                <span className="text-[10px] text-amber-400/70" title="此事件为史实锚点，AI 生成时不可违反">
                  AI 不可违反
                </span>
              )}
              {worldBadge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                  {worldBadge.icon}{worldBadge.name}
                </span>
              )}
            </div>
            <h4 className="text-sm font-medium text-text-primary truncate">{event.title}</h4>
            {!expanded && event.description && (
              <p className="text-xs text-text-muted line-clamp-1 mt-1">{event.description}</p>
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
                <label className="block text-[11px] text-text-muted mb-1">事件名称</label>
                <CInput
                  value={event.title}
                  onChange={change => onChange({ title: change.target.value })}
                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">历史时期</label>
                <select
                  aria-label="历史时期"
                  value={event.era}
                  onChange={change => onChange({ era: change.target.value as HistoricalEra })}
                  className="w-full px-2 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                >
                  {Object.entries(HISTORICAL_ERA_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">数字化年份 (排序用)</label>
                <input
                  aria-label="数字化年份"
                  type="number"
                  value={event.year}
                  onChange={change => onChange({ year: parseInt(change.target.value) || 0 })}
                  placeholder="负数表示公元前"
                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1">具体时间描述</label>
                <CInput
                  value={event.date}
                  onChange={change => onChange({ date: change.target.value })}
                  placeholder="如：开元十三年、公元725年"
                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">具体时间范围/区间 (可选)</label>
                <CInput
                  value={event.customTimeRange || ''}
                  onChange={change => onChange({ customTimeRange: change.target.value })}
                  placeholder="如：公元712年-756年、18世纪中叶"
                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">地理位置/范围 (可选)</label>
                <CInput
                  value={event.location || ''}
                  onChange={change => onChange({ location: change.target.value })}
                  placeholder="如：江南地区、君士坦丁堡、中原"
                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1">事件属性</label>
                <div className="flex gap-2 h-[30px] items-center">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      checked={event.isHistorical}
                      onChange={() => onChange({ isHistorical: true })}
                      className="accent-blue-500"
                    />
                    <span className="text-text-secondary">真实史实</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      checked={!event.isHistorical}
                      onChange={() => onChange({ isHistorical: false })}
                      className="accent-purple-500"
                    />
                    <span className="text-text-secondary">虚构/架空</span>
                  </label>
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] text-text-muted mb-1">
                  {event.isHistorical ? '史料来源 / 考证出处' : '虚构设定备注'}
                </label>
                <CInput
                  value={event.source || ''}
                  onChange={change => onChange({ source: change.target.value })}
                  placeholder={event.isHistorical ? '如：《旧唐书 · 舆服志》、《资治通鉴》卷二百' : '如：参考了宋代水车结构进行架空改动'}
                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-text-muted mb-1">
                📒 条目定稿（写作时会进入小说上下文；考据 / 风暴 agent 会读取作为核验或发散对象，但<span className="text-amber-500">不会直接覆盖</span>）
              </label>
              <CTextarea
                value={event.description}
                onChange={change => onChange({ description: change.target.value })}
                placeholder="作者打磨好的最终条目内容，将作为 AI 写作的历史背景注入。例如：『公元 712 年，李隆基即位为唐玄宗，开元之治始。』"
                className="w-full h-24 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-[11px] text-text-muted mb-1">对剧情/世界的影响 (可选)</label>
              <CTextarea
                value={event.impact || ''}
                onChange={change => onChange({ impact: change.target.value })}
                placeholder="该事件如何推动主角剧情，或者对架空世界线产生什么影响..."
                className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-[11px] text-text-muted mb-1">关联章节</label>
              <HistoryChapterPicker
                chapters={chapters}
                relatedChapterIds={event.relatedChapterIds}
                onChange={relatedChapterIds => onChange({ relatedChapterIds })}
              />
            </div>

            <div>
              <label className="block text-[11px] text-text-muted mb-1">
                🧭 概念与创作思路（提交给 AI 之前的初步设定；得到 agent 反馈后可在此处修正）
              </label>
              <CTextarea
                value={event.conceptNote || ''}
                onChange={change => onChange({ conceptNote: change.target.value })}
                placeholder="描述你为这条事件想达到的效果、能接受的艺术改造或架空范围、希望保留 / 偏离的史实点。例如：『允许把火药提前到本朝；其余制度仍按真实唐制写。』"
                className="w-full h-24 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1">
                  📝 给「历史考据 agent」的补充说明
                </label>
                <CTextarea
                  value={event.consultPrompt || ''}
                  onChange={change => onChange({ consultPrompt: change.target.value })}
                  placeholder="例：本作允许将火药提前到唐代，不必再纠结这一项；请重点检查官制称谓和时令风俗。"
                  className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">
                  💡 给「头脑风暴 agent」的补充说明
                </label>
                <CTextarea
                  value={event.stormPrompt || ''}
                  onChange={change => onChange({ stormPrompt: change.target.value })}
                  placeholder="例：重点发散街市气味、市井人物对白、能引出主角第一次进城的可能场景。"
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
              savedConsult={event.aiConsult}
              savedStorm={event.aiBrainstorm}
              savedStormLabel="AI 头脑风暴结果"
              deleteLabel="删除事件"
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
    </div>
  )
}
