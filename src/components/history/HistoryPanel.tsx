import { CTextarea, CInput } from '../shared/CompositionInput'
import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Trash2, ChevronDown, ChevronRight, Clock, Sparkles,
  BookOpen, Calendar, ShieldCheck, HelpCircle, Loader2, Tag, Filter
} from 'lucide-react'
import { useHistoryStore } from '../../stores/project-singletons'
import { useHistoricalStore } from '../../stores/historical'
import { useChapterStore } from '../../stores/chapter'
import { useAIStream } from '../../hooks/useAIStream'
import type { Project, HistoricalTimelineEvent, HistoricalEra, HistoricalKeyword, HistoricalKeywordCategory } from '../../lib/types'
import { HISTORICAL_ERA_LABELS, KEYWORD_CATEGORY_LABELS } from '../../lib/types/history'
import AIStreamOutput from '../shared/AIStreamOutput'

interface Props {
  project: Project
}

type TabKey = 'overview' | 'timeline' | 'keywords'

export default function HistoryPanel({ project }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('timeline')

  // ── 历史总述 Store ──
  const { history, loadAll: loadHistory, save: saveHistory } = useHistoryStore()
  const [overview, setOverview] = useState('')
  const [eraSystem, setEraSystem] = useState('')

  // ── 历史时间线与关键词 Store ──
  const {
    events, loading: loadingEvents, loadEvents, addEvent, updateEvent, deleteEvent,
    keywords, loadingKeywords, loadKeywords, addKeyword, updateKeyword, deleteKeyword
  } = useHistoricalStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()

  // ── UI 状态 ──
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedKeywordId, setExpandedKeywordId] = useState<number | null>(null)
  const [aiEventId, setAiEventId] = useState<number | null>(null)
  const [aiKeywordId, setAiKeywordId] = useState<number | null>(null)

  // ── 筛选状态 ──
  const [filterCategory, setFilterCategory] = useState<HistoricalKeywordCategory | 'all'>('all')
  const [filterEra, setFilterEra] = useState<HistoricalEra | 'all'>('all')

  const ai = useAIStream()

  useEffect(() => {
    loadHistory(project.id!)
    loadEvents(project.id!)
    loadKeywords(project.id!)
    loadChapters(project.id!)
  }, [project.id, loadHistory, loadEvents, loadKeywords, loadChapters])

  useEffect(() => {
    if (history) {
      setOverview(history.overview || '')
      setEraSystem(history.eraSystem || '')
    }
  }, [history])

  const handleSaveOverview = async () => {
    await saveHistory({ projectId: project.id!, overview })
  }

  const handleSaveEraSystem = async () => {
    await saveHistory({ projectId: project.id!, eraSystem })
  }

  // ── 时间线操作 ──
  const handleAddEvent = async () => {
    const newId = await addEvent({
      projectId: project.id!,
      era: 'custom',
      year: 0,
      date: '公元元年',
      title: '新历史事件',
      description: '描述该事件的发生过程...',
      isHistorical: true,
    })
    setExpandedId(newId)
  }

  // ── 关键词操作 ──
  const handleAddKeyword = async () => {
    const newId = await addKeyword({
      projectId: project.id!,
      keyword: '新历史关键词',
      category: 'technology',
      era: 'custom',
      description: '输入该关键词的基础概念或您想借鉴的方面...',
    })
    setExpandedKeywordId(newId)
  }

  // ── AI 历史考证 ──
  const handleAIConsult = (evt: HistoricalTimelineEvent) => {
    if (!evt.id) return
    setAiEventId(evt.id)
    setAiKeywordId(null)

    const systemPrompt = `你是一位极其严谨、甚至有些挑剔的全球历史学家与小说考证顾问。
你的首要原则是：**绝对不迎合、不顺从作者可能存在的错误假设，坚决捍卫历史真实性，杜绝时代错乱（Anachronism）**。

请根据用户提供的事件信息，严格执行以下【三步考证法】：

### 第一步：【前提真实性判定】（核心自查）
- 仔细审视事件的“标题/描述”、“历史时期/年份”、“具体时间范围/区间”与“地理位置/范围”的组合。
- 提出严厉的质疑：**在那个时代、那个地区，这个事物、技术、制度或事件真的存在吗？是否超前了？是否不符合当地的文化/科技水平？**
- **如果作者提供了【具体时间范围/区间】或【地理位置/范围】**，你必须将考证精准锁定在这一特定的时间段和地理区域内（例如：如果地理位置是“江南地区”，细节应侧重于吴越文化、水乡特色、南方经济等；如果是“君士坦丁堡”，细节应侧重于拜占庭帝国、东正教、地中海贸易等）。
- **如果发现时代错乱、地理错乱或史实硬伤**（例如：宋代出现近视眼镜、唐代出现红薯/辣椒/土豆、汉代出现铁锅炒菜、明代以前出现棉被等）：
  1. 你必须**在回答的最开头，立即、明确、严厉地指出这一错误**，并用无可辩驳的史实解释为什么不对。
  2. **绝对不能**顺着作者的错误假设去编造细节。
  3. 给出【历史替代方案】：在当时的历史条件和地理环境下，人们实际上会怎么做？
- **如果前提完全符合史实**：简要确认其真实性，并指出其在历史上的精确时间、关键人物和历史影响。

### 第二步：【时代质感与名词考证】（仅在前提合理，或提供替代方案后进行）
- 提供该事物/事件在当时、当地的专业称谓、行话、官职或细分类型（例如：如果是西方中世纪，使用符合当时封建领主制的称谓，避免中国古代官制词汇）。
- 提供 2-3 个生动的、不为人知的历史细节（如当时的服饰、器物、称谓、社会风貌），帮助作者增加小说的真实感和沉浸感。
- 提供史料出处（如《史记》《资治通鉴》《宋史 · 舆服志》或西方相关历史文献等）。

### 第三步：【历史重力下的情节冲突】
- 结合真实的历史限制（如当时的律法、技术、社会阶层、道德禁忌、地理环境），为作者提供 2 个极具张力的小说情节冲突灵感。

请使用 Markdown 格式输出，排版清晰。语言要专业、严谨、有启发性，直接输出考证结果，不要有任何客套话。`

    const eraLabel = HISTORICAL_ERA_LABELS[evt.era as HistoricalEra] || evt.era
    const userPrompt = `【事件信息】
- 标题：${evt.title}
- 历史时期：${eraLabel}
- 数字化年份：${evt.year} (公元 ${evt.year > 0 ? evt.year : '前 ' + Math.abs(evt.year)} 年)
- 时间描述：${evt.date}
${evt.customTimeRange ? `- 具体时间范围/区间：${evt.customTimeRange}` : ''}
${evt.location ? `- 地理位置/范围：${evt.location}` : ''}
- 事件描述：${evt.description}
- 是否为真实史实：${evt.isHistorical ? '是 (史实考证模式)' : '否 (虚构细节头脑风暴模式)'}
- 现有史料来源：${evt.source || '无'}`

    ai.start([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ])
  }

  // ── AI 关键词细节头脑风暴 ──
  const handleAIKeywordStorm = (kw: HistoricalKeyword) => {
    if (!kw.id) return
    setAiKeywordId(kw.id)
    setAiEventId(null)

    const systemPrompt = `你是一位极其严谨、精通全球物质文化史和文学创作的历史学家与小说顾问。
你的首要原则是：**绝对不迎合、不顺从作者可能存在的错误假设，坚决捍卫历史真实性，杜绝时代错乱（Anachronism）**。

请根据用户提供的关键词信息，严格执行以下【四步风暴法】：

### 第一步：【存在性与时代判定】（核心自查）
- 仔细审视“关键词”、“适用历史时期”、“具体时间范围/区间”与“地理位置/范围”的组合。
- 提出严厉的质疑：**在那个时代、那个地区，这个东西、技术、制度或概念真的存在吗？是否超前了？是否不符合当地的文化/科技水平？**
- **如果作者提供了【具体时间范围/区间】或【地理位置/范围】**，你必须将头脑风暴和细节精准锁定在这一特定的时间段和地理区域内（例如：如果地理位置是“江南地区”，细节应侧重于吴越文化、水乡特色、南方经济等；如果是“君士坦丁堡”，细节应侧重于拜占庭帝国、东正教、地中海贸易等）。
- **如果发现时代错乱、地理错乱或史实硬伤**（例如：两宋出现近视眼镜、唐代出现红薯/辣椒/土豆、汉代出现铁锅炒菜、明代以前出现棉被等）：
  1. 你必须**在回答的最开头，立即、明确、严厉地指出这一错误**，并用无可辩驳的史实解释为什么不对。
  2. **绝对不能**顺着作者的错误假设去编造细节。
  3. 给出【历史替代方案】：在当时的历史条件和地理环境下，最接近的替代事物是什么？
- **如果完全符合时代背景**：简要确认其在当时的普及程度和历史定位。

### 第二步：【时代质感与名词考证】（仅在前提合理，或提供替代方案后进行）
- 提供该事物在当时、当地的专业称谓、行话、相关工具或细分类型。避免任何现代词汇，并使用符合当地文化背景的词汇。
- 详细描述该事物是如何制造、运作、或该制度是如何执行的（例如：如果是织布机，描述丝织工艺、经纬线、提花楼；如果是科举，描述锁院、糊名、誊录、考棚一日三餐等）。

### 第三步：【社会与生活图景】
- 描述与该事物相关的社会阶层、日常生活、经济价值或风俗习惯（例如：机户的税负、文人对园林美学的追求、官吏的日常应酬等）。

### 第四步：【历史重力下的情节冲突】
- 结合真实的历史限制（如当时的律法、技术、社会阶层、道德禁忌、地理环境），为作者提供 2-3 个可直接写进小说的精彩场景或冲突灵感。

请使用 Markdown 格式输出，排版清晰，多用要点列表。语言要专业、生动、有画面感，直接输出头脑风暴结果，不要有任何客套话。`

    const eraLabel = HISTORICAL_ERA_LABELS[kw.era as HistoricalEra] || kw.era
    const categoryLabel = KEYWORD_CATEGORY_LABELS[kw.category as HistoricalKeywordCategory] || kw.category
    const userPrompt = `【关键词信息】
- 关键词：${kw.keyword}
- 分类：${categoryLabel}
- 适用历史时期：${eraLabel}
${kw.customTimeRange ? `- 具体时间范围/区间：${kw.customTimeRange}` : ''}
${kw.location ? `- 地理位置/范围：${kw.location}` : ''}
- 基础描述/备注：${kw.description}`

    ai.start([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ])
  }

  const handleAcceptAI = (text: string) => {
    if (aiEventId) {
      updateEvent(aiEventId, { aiBrainstorm: text })
      setAiEventId(null)
    } else if (aiKeywordId) {
      updateKeyword(aiKeywordId, { aiBrainstorm: text })
      setAiKeywordId(null)
    }
    ai.reset()
  }

  // ── 过滤关键词 ──
  const filteredKeywords = useMemo(() => {
    return keywords.filter((kw: HistoricalKeyword) => {
      const matchCategory = filterCategory === 'all' || kw.category === filterCategory
      const matchEra = filterEra === 'all' || kw.era === filterEra
      return matchCategory && matchEra
    })
  }, [keywords, filterCategory, filterEra])

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">📜 历史年表与时间线</h1>
              <p className="text-xs text-text-muted mt-0.5">
                管理真实历史背景或架空历史事件，支持 AI 历史考证与细节头脑风暴。
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-1 border-b border-border mb-6">
        <button
          onClick={() => setActiveTab('timeline')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            activeTab === 'timeline'
              ? 'border-accent text-accent font-medium'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <Clock className="w-4 h-4" />
          历史时间轴
        </button>
        <button
          onClick={() => setActiveTab('keywords')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            activeTab === 'keywords'
              ? 'border-accent text-accent font-medium'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <Tag className="w-4 h-4" />
          历史细节风暴
        </button>
        <button
          onClick={() => setActiveTab('overview')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            activeTab === 'overview'
              ? 'border-accent text-accent font-medium'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          历史总述与纪年
        </button>
      </nav>

      {/* Tab 内容：历史总述 */}
      {activeTab === 'overview' && (
        <div className="space-y-6 max-w-4xl">
          {/* 历史总述 */}
          <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-2">
            <label className="block text-sm font-medium text-text-primary">历史总述</label>
            <p className="text-xs text-text-muted">描述这个世界的整体历史脉络、重大转折、文明兴衰等...</p>
            <CTextarea
              value={overview}
              onChange={e => setOverview(e.target.value)}
              onBlur={handleSaveOverview}
              placeholder="例如：大唐开元盛世，表面歌舞升平，实则暗流涌动。藩镇割据之势已成，朝堂之上牛李党争初露端倪..."
              className="w-full h-36 p-3 bg-bg-base border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
            />
          </div>

          {/* 纪年体系 */}
          <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-2">
            <label className="block text-sm font-medium text-text-primary">纪年体系</label>
            <p className="text-xs text-text-muted">描述这个世界的纪年方式，如：年号纪年、干支纪年等...</p>
            <CTextarea
              value={eraSystem}
              onChange={e => setEraSystem(e.target.value)}
              onBlur={handleSaveEraSystem}
              placeholder="例如：采用唐代年号纪年（如开元、天宝），辅以干支纪年（如甲子、乙丑）。"
              className="w-full h-24 p-3 bg-bg-base border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {/* Tab 内容：历史时间轴 */}
      {activeTab === 'timeline' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧/中侧：时间轴列表 */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-text-secondary">
                时间轴事件 ({events.length})
              </h3>
              <button
                onClick={handleAddEvent}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:opacity-90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加事件
              </button>
            </div>

            {loadingEvents ? (
              <div className="flex items-center justify-center py-12 text-text-muted">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                加载时间线中...
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-bg-elevated/10 p-12 text-center">
                <Clock className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-40" />
                <h4 className="text-sm font-medium text-text-primary mb-1">暂无时间线事件</h4>
                <p className="text-xs text-text-muted mb-4">添加真实历史事件或虚构事件，构建完整的小说时间轴。</p>
                <button
                  onClick={handleAddEvent}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-xs rounded-lg hover:opacity-90"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加第一个事件
                </button>
              </div>
            ) : (
              <div className="relative pl-6 border-l border-border/80 space-y-4 ml-3">
                {events.map((evt) => {
                  const isExpanded = expandedId === evt.id
                  const eraLabel = HISTORICAL_ERA_LABELS[evt.era as HistoricalEra] || evt.era
                  const yearText = evt.year > 0 ? `公元 ${evt.year} 年` : `公元前 ${Math.abs(evt.year)} 年`

                  return (
                    <div key={evt.id} className="relative">
                      {/* 时间轴圆点 */}
                      <span className={`absolute -left-[31px] top-3.5 w-2.5 h-2.5 rounded-full border-2 bg-bg-base transition-colors ${
                        evt.isHistorical
                          ? 'border-blue-500 ring-4 ring-blue-500/10'
                          : 'border-purple-500 ring-4 ring-purple-500/10'
                      }`} />

                      {/* 卡片 */}
                      <div className={`rounded-xl border bg-bg-surface transition-all ${
                        isExpanded
                          ? 'border-accent/40 shadow-sm'
                          : 'border-border hover:border-border-hover'
                      }`}>
                        {/* 头部点击展开 */}
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : evt.id || null)}
                          className="w-full flex items-start gap-3 px-4 py-3.5 text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-xs font-mono font-semibold text-text-secondary">
                                {evt.date} ({yearText})
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted">
                                {eraLabel}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                evt.isHistorical
                                  ? 'border-blue-500/20 text-blue-400 bg-blue-500/5'
                                  : 'border-purple-500/20 text-purple-400 bg-purple-500/5'
                              }`}>
                                {evt.isHistorical ? '史实' : '虚构/架空'}
                              </span>
                            </div>
                            <h4 className="text-sm font-medium text-text-primary truncate">{evt.title}</h4>
                            {!isExpanded && evt.description && (
                              <p className="text-xs text-text-muted line-clamp-1 mt-1">{evt.description}</p>
                            )}
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-text-muted shrink-0 mt-1" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-text-muted shrink-0 mt-1" />
                          )}
                        </button>

                        {/* 展开编辑区 */}
                        {isExpanded && evt.id && (
                          <div className="px-4 pb-4 border-t border-border/50 pt-4 space-y-4">
                            {/* 基础字段 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">事件名称</label>
                                <CInput
                                  value={evt.title}
                                  onChange={e => updateEvent(evt.id!, { title: e.target.value })}
                                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">历史时期</label>
                                <select
                                  value={evt.era}
                                  onChange={e => updateEvent(evt.id!, { era: e.target.value as HistoricalEra })}
                                  className="w-full px-2 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                                >
                                  {Object.entries(HISTORICAL_ERA_LABELS).map(([k, v]) => (
                                    <option key={k} value={k}>{v}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">数字化年份 (排序用)</label>
                                <input
                                  type="number"
                                  value={evt.year}
                                  onChange={e => updateEvent(evt.id!, { year: parseInt(e.target.value) || 0 })}
                                  placeholder="负数表示公元前"
                                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">具体时间描述</label>
                                <CInput
                                  value={evt.date}
                                  onChange={e => updateEvent(evt.id!, { date: e.target.value })}
                                  placeholder="如：开元十三年、公元725年"
                                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">具体时间范围/区间 (可选)</label>
                                <CInput
                                  value={evt.customTimeRange || ''}
                                  onChange={e => updateEvent(evt.id!, { customTimeRange: e.target.value })}
                                  placeholder="如：公元712年-756年、18世纪中叶"
                                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">地理位置/范围 (可选)</label>
                                <CInput
                                  value={evt.location || ''}
                                  onChange={e => updateEvent(evt.id!, { location: e.target.value })}
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
                                      checked={evt.isHistorical}
                                      onChange={() => updateEvent(evt.id!, { isHistorical: true })}
                                      className="accent-blue-500"
                                    />
                                    <span className="text-text-secondary">真实史实</span>
                                  </label>
                                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                    <input
                                      type="radio"
                                      checked={!evt.isHistorical}
                                      onChange={() => updateEvent(evt.id!, { isHistorical: false })}
                                      className="accent-purple-500"
                                    />
                                    <span className="text-text-secondary">虚构/架空</span>
                                  </label>
                                </div>
                              </div>
                              <div className="md:col-span-2">
                                <label className="block text-[11px] text-text-muted mb-1">
                                  {evt.isHistorical ? '史料来源 / 考证出处' : '虚构设定备注'}
                                </label>
                                <CInput
                                  value={evt.source || ''}
                                  onChange={e => updateEvent(evt.id!, { source: e.target.value })}
                                  placeholder={evt.isHistorical ? '如：《旧唐书 · 舆服志》、《资治通鉴》卷二百' : '如：参考了宋代水车结构进行架空改动'}
                                  className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                                />
                              </div>
                            </div>

                            {/* 描述与影响 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">事件描述</label>
                                <CTextarea
                                  value={evt.description}
                                  onChange={e => updateEvent(evt.id!, { description: e.target.value })}
                                  placeholder="详细描述事件的起因、经过 and 结果..."
                                  className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">对剧情/世界的影响 (可选)</label>
                                <CTextarea
                                  value={evt.impact || ''}
                                  onChange={e => updateEvent(evt.id!, { impact: e.target.value })}
                                  placeholder="该事件如何推动主角剧情，或者对架空世界线产生什么影响..."
                                  className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                                />
                              </div>
                            </div>

                            {/* 关联章节 */}
                            <div className="grid grid-cols-1 gap-3">
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">关联章节</label>
                                <div className="flex flex-wrap gap-1 p-1.5 bg-bg-base border border-border rounded-lg min-h-[32px] max-h-20 overflow-y-auto">
                                  {chapters.length === 0 ? (
                                    <span className="text-[10px] text-text-muted">暂无章节可关联</span>
                                  ) : (
                                    chapters.map(ch => {
                                      const relatedIds = evt.relatedChapterIds || []
                                      const isRelated = relatedIds.includes(ch.id!)
                                      return (
                                        <button
                                          key={ch.id}
                                          type="button"
                                          onClick={() => {
                                            const nextIds = isRelated
                                              ? relatedIds.filter(id => id !== ch.id!)
                                              : [...relatedIds, ch.id!]
                                            updateEvent(evt.id!, { relatedChapterIds: nextIds })
                                          }}
                                          className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                                            isRelated
                                              ? 'bg-accent/10 text-accent border border-accent/20'
                                              : 'bg-bg-elevated text-text-muted hover:text-text-primary border border-transparent'
                                          }`}
                                        >
                                          {ch.title}
                                        </button>
                                      )
                                    })
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* AI 考证与头脑风暴按钮 */}
                            <div className="pt-2 border-t border-border/40 flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => handleAIConsult(evt)}
                                disabled={ai.isStreaming}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-xs font-medium rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                {evt.isHistorical ? 'AI 历史考证' : 'AI 细节头脑风暴'}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm('确定删除该历史事件？此操作不可恢复。')) {
                                    deleteEvent(evt.id!)
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded-lg transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                删除事件
                              </button>
                            </div>

                            {/* AI 结果展示 */}
                            {aiEventId === evt.id && (ai.output || ai.isStreaming || ai.error) && (
                              <div className="mt-3">
                                <AIStreamOutput
                                  output={ai.output}
                                  isStreaming={ai.isStreaming}
                                  error={ai.error}
                                  tokenUsage={ai.tokenUsage}
                                  onStop={ai.stop}
                                  onAccept={handleAcceptAI}
                                  onRetry={() => handleAIConsult(evt)}
                                />
                              </div>
                            )}

                            {/* 已保存的 AI 考证结果 */}
                            {evt.aiBrainstorm && aiEventId !== evt.id && (
                              <div className="mt-3 bg-bg-base border border-border/60 rounded-lg p-3 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-medium text-accent flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" />
                                    AI 考证与细节库
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => updateEvent(evt.id!, { aiBrainstorm: undefined })}
                                    className="text-[10px] text-text-muted hover:text-red-400"
                                  >
                                    清除
                                  </button>
                                </div>
                                <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap prose prose-invert max-h-60 overflow-y-auto">
                                  {evt.aiBrainstorm}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 右侧：考证与细节助手说明 */}
          <div className="space-y-4">
            <div className="bg-bg-surface border border-border rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-accent" />
                历史考证与细节助手
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed">
                在历史题材创作中，细节决定了小说的质感。本系统提供双重 AI 辅助模式：
              </p>
              <div className="space-y-2.5 pt-1">
                <div className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-xs shrink-0 font-bold">1</span>
                  <div>
                    <h4 className="text-xs font-medium text-text-primary">史实考证模式</h4>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      输入真实历史事件（如“玄武门之变”），AI 会帮您考证具体时间、史料出处，并提供当时社会的衣食住行细节，避免常识性硬伤。
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center text-xs shrink-0 font-bold">2</span>
                  <div>
                    <h4 className="text-xs font-medium text-text-primary">虚构细节头脑风暴</h4>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      输入虚构概念（如“主角在长安开设织布机坊”），AI 会结合唐代背景，为您头脑风暴当时的纺织工艺、行会制度、机户生活等细节，让虚构故事充满真实质感。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-bg-surface border border-border rounded-2xl p-5 space-y-2">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-text-muted" />
                使用小贴士
              </h3>
              <ul className="text-[11px] text-text-muted space-y-1.5 list-disc pl-4">
                <li>数字化年份支持负数，如输入 <code className="bg-bg-base px-1 py-0.5 rounded font-mono">-221</code> 代表公元前 221 年（秦统一六国）。</li>
                <li>时间轴会自动按照数字化年份从小到大排序，无需手动调整。</li>
                <li>关联章节后，您可以在写作时随时调阅该章节关联的历史背景。</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tab 内容：历史细节风暴 */}
      {activeTab === 'keywords' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧/中侧：关键词列表 */}
          <div className="lg:col-span-2 space-y-4">
            {/* 筛选与添加工具栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-bg-surface border border-border rounded-xl p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 text-xs text-text-muted mr-1">
                  <Filter className="w-3.5 h-3.5" />
                  筛选：
                </div>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value as any)}
                  className="px-2 py-1 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="all">所有分类</option>
                  {Object.entries(KEYWORD_CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select
                  value={filterEra}
                  onChange={e => setFilterEra(e.target.value as any)}
                  className="px-2 py-1 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="all">所有时期</option>
                  {Object.entries(HISTORICAL_ERA_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleAddKeyword}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:opacity-90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加关键词
              </button>
            </div>

            {loadingKeywords ? (
              <div className="flex items-center justify-center py-12 text-text-muted">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                加载细节库中...
              </div>
            ) : filteredKeywords.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-bg-elevated/10 p-12 text-center">
                <Tag className="w-8 h-8 text-text-muted mx-auto mb-3 opacity-40" />
                <h4 className="text-sm font-medium text-text-primary mb-1">暂无匹配的关键词</h4>
                <p className="text-xs text-text-muted mb-4">添加您想考证或头脑风暴的关键词（如“织布机”、“科举”），让 AI 帮您补充细节。</p>
                {keywords.length === 0 && (
                  <button
                    onClick={handleAddKeyword}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-xs rounded-lg hover:opacity-90"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    添加第一个关键词
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredKeywords.map((kw: HistoricalKeyword) => {
                  const isExpanded = expandedKeywordId === kw.id
                  const eraLabel = HISTORICAL_ERA_LABELS[kw.era as HistoricalEra] || kw.era
                  const categoryLabel = KEYWORD_CATEGORY_LABELS[kw.category as HistoricalKeywordCategory] || kw.category

                  return (
                    <div
                      key={kw.id}
                      className={`rounded-xl border bg-bg-surface transition-all ${
                        isExpanded
                          ? 'border-accent/40 shadow-sm'
                          : 'border-border hover:border-border-hover'
                      }`}
                    >
                      {/* 头部点击展开 */}
                      <button
                        onClick={() => setExpandedKeywordId(isExpanded ? null : kw.id || null)}
                        className="w-full flex items-start gap-3 px-4 py-3.5 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs font-semibold text-accent">
                              #{kw.keyword}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted">
                              {categoryLabel}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted">
                              {eraLabel}
                            </span>
                          </div>
                          {kw.description && !isExpanded && (
                            <p className="text-xs text-text-muted line-clamp-1 mt-1">{kw.description}</p>
                          )}
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-text-muted shrink-0 mt-1" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-text-muted shrink-0 mt-1" />
                        )}
                      </button>

                      {/* 展开编辑区 */}
                      {isExpanded && kw.id && (
                        <div className="px-4 pb-4 border-t border-border/50 pt-4 space-y-4">
                          {/* 基础字段 */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">关键词名称</label>
                              <CInput
                                value={kw.keyword}
                                onChange={e => updateKeyword(kw.id!, { keyword: e.target.value })}
                                className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">分类</label>
                              <select
                                value={kw.category}
                                onChange={e => updateKeyword(kw.id!, { category: e.target.value as HistoricalKeywordCategory })}
                                className="w-full px-2 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                              >
                                {Object.entries(KEYWORD_CATEGORY_LABELS).map(([k, v]) => (
                                  <option key={k} value={k}>{v}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">适用历史时期</label>
                              <select
                                value={kw.era}
                                onChange={e => updateKeyword(kw.id!, { era: e.target.value as HistoricalEra })}
                                className="w-full px-2 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                              >
                                {Object.entries(HISTORICAL_ERA_LABELS).map(([k, v]) => (
                                  <option key={k} value={k}>{v}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* 时间与地理范围 */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">具体时间范围/区间 (可选)</label>
                              <CInput
                                value={kw.customTimeRange || ''}
                                onChange={e => updateKeyword(kw.id!, { customTimeRange: e.target.value })}
                                placeholder="如：公元712年-756年、18世纪中叶"
                                className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">地理位置/范围 (可选)</label>
                              <CInput
                                value={kw.location || ''}
                                onChange={e => updateKeyword(kw.id!, { location: e.target.value })}
                                placeholder="如：江南地区、君士坦丁堡、中原"
                                className="w-full px-2.5 py-1.5 bg-bg-base border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
                              />
                            </div>
                          </div>

                          {/* 描述与关联章节 */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">基础描述 / 备注</label>
                              <CTextarea
                                value={kw.description}
                                onChange={e => updateKeyword(kw.id!, { description: e.target.value })}
                                placeholder="输入该关键词的基础概念，或者您想在小说中借鉴的方面..."
                                className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">关联章节</label>
                              <div className="flex flex-wrap gap-1 p-1.5 bg-bg-base border border-border rounded-lg min-h-[80px] max-h-20 overflow-y-auto">
                                {chapters.length === 0 ? (
                                  <span className="text-[10px] text-text-muted">暂无章节可关联</span>
                                ) : (
                                  chapters.map(ch => {
                                      const relatedIds = kw.relatedChapterIds || []
                                      const isRelated = relatedIds.includes(ch.id!)
                                      return (
                                        <button
                                          key={ch.id}
                                          type="button"
                                          onClick={() => {
                                            const nextIds = isRelated
                                              ? relatedIds.filter((id: number) => id !== ch.id!)
                                              : [...relatedIds, ch.id!]
                                            updateKeyword(kw.id!, { relatedChapterIds: nextIds })
                                          }}
                                        className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                                          isRelated
                                            ? 'bg-accent/10 text-accent border border-accent/20'
                                            : 'bg-bg-elevated text-text-muted hover:text-text-primary border border-transparent'
                                        }`}
                                      >
                                        {ch.title}
                                      </button>
                                    )
                                  })
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 操作按钮 */}
                          <div className="pt-2 border-t border-border/40 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => handleAIKeywordStorm(kw)}
                              disabled={ai.isStreaming}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-xs font-medium rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              AI 细节头脑风暴
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (confirm('确定删除该关键词？此操作不可恢复。')) {
                                  deleteKeyword(kw.id!)
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              删除关键词
                            </button>
                          </div>

                          {/* AI 结果展示 */}
                          {aiKeywordId === kw.id && (ai.output || ai.isStreaming || ai.error) && (
                            <div className="mt-3">
                              <AIStreamOutput
                                output={ai.output}
                                isStreaming={ai.isStreaming}
                                error={ai.error}
                                tokenUsage={ai.tokenUsage}
                                onStop={ai.stop}
                                  onAccept={handleAcceptAI}
                                onRetry={() => handleAIKeywordStorm(kw)}
                              />
                            </div>
                          )}

                          {/* 已保存的 AI 头脑风暴结果 */}
                          {kw.aiBrainstorm && aiKeywordId !== kw.id && (
                            <div className="mt-3 bg-bg-base border border-border/60 rounded-lg p-3 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium text-accent flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  AI 时代细节库
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateKeyword(kw.id!, { aiBrainstorm: undefined })}
                                  className="text-[10px] text-text-muted hover:text-red-400"
                                >
                                  清除
                                </button>
                              </div>
                              <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap prose prose-invert max-h-80 overflow-y-auto">
                                {kw.aiBrainstorm}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 右侧：细节风暴助手说明 */}
          <div className="space-y-4">
            <div className="bg-bg-surface border border-border rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-accent" />
                细节风暴助手
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed">
                没有相关历史知识？不用担心！细节风暴助手能帮您瞬间补充极具时代质感的细节：
              </p>
              <div className="space-y-2.5 pt-1 text-xs text-text-secondary">
                <p>
                  • <strong>器物与科技</strong>：输入“织布机”，AI 会为您补充丝织工艺、提花楼、经纬线等专业名词和运作细节。
                </p>
                <p>
                  • <strong>制度与官职</strong>：输入“科举”，AI 会为您补充锁院、糊名、誊录、考棚一日三餐等考试流程。
                </p>
                <p>
                  • <strong>文化与风俗</strong>：输入“避讳”，AI 会为您补充如何避皇帝名讳、长辈名讳，以及违反的后果。
                </p>
                <p>
                  • <strong>社会与经济</strong>：输入“飞钱”，AI 会为您补充唐代信用货币的运作、兑换手续和商业影响。
                </p>
                <p>
                  • <strong>地理与建筑</strong>：输入“园林”，AI 会为您补充造园美学、名贵花木、文人雅集等场景细节。
                </p>
              </div>
            </div>

            <div className="bg-bg-surface border border-border rounded-2xl p-5 space-y-2">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-text-muted" />
                使用小贴士
              </h3>
              <ul className="text-[11px] text-text-muted space-y-1.5 list-disc pl-4">
                <li>您可以随时通过顶部的分类和历史时期筛选框，快速找到需要的关键词。</li>
                <li>头脑风暴生成的结果会永久保存在本地，写作时可随时作为参考。</li>
                <li>关联章节后，这些细节会在您写作对应章节时提供强大的背景支持。</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
