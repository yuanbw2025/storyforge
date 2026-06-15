import { CTextarea, CInput } from '../shared/CompositionInput'
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Plus, Trash2, ChevronDown, ChevronRight, Clock, Sparkles,
  BookOpen, Calendar, ShieldCheck, HelpCircle, Loader2, Tag, Filter
} from 'lucide-react'
import { useHistoryStore } from '../../stores/project-singletons'
import { useHistoricalStore } from '../../stores/historical'
import { useChapterStore } from '../../stores/chapter'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import { usePromptStore } from '../../stores/prompt'
import { useAIStream } from '../../hooks/useAIStream'
import { renderPrompt } from '../../lib/ai/prompt-engine'
import type { Project, HistoricalTimelineEvent, HistoricalEra, HistoricalKeyword, HistoricalKeywordCategory } from '../../lib/types'
import { HISTORICAL_ERA_LABELS, KEYWORD_CATEGORY_LABELS } from '../../lib/types/history'
import AIStreamOutput from '../shared/AIStreamOutput'
import { useDialog } from '../shared/Dialog'

interface Props {
  project: Project
}

type TabKey = 'overview' | 'timeline' | 'keywords'

export default function HistoryPanel({ project }: Props) {
  const dialog = useDialog()
  const [activeTab, setActiveTab] = useState<TabKey>('timeline')

  // ── 多世界：世界标签 ──
  const { groups, activeGroupId } = useWorldGroupStore()
  const isMW = !!project.enableMultiWorld && groups.length > 1
  const [worldTab, setWorldTab] = useState<number | 'all'>('all')
  const worldTabInited = useRef(false)
  useEffect(() => {
    // 多世界首次进入默认落在当前活跃世界（之后尊重用户选择，含「一览」）
    if (isMW && !worldTabInited.current && activeGroupId != null) {
      setWorldTab(activeGroupId)
      worldTabInited.current = true
    }
  }, [isMW, activeGroupId])
  /** 当前编辑作用域的世界组 id（一览/单世界时为 null） */
  const scopeGroupId: number | null = isMW && typeof worldTab === 'number' ? worldTab : null
  /** 一览标签为只读（避免新建项归属不明） */
  const canEdit = !isMW || worldTab !== 'all'

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

  const handleDeleteEvent = async (id: number) => {
    const ok = await dialog.confirm({
      title: '删除该历史事件？',
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (ok) deleteEvent(id)
  }

  const handleDeleteKeyword = async (id: number) => {
    const ok = await dialog.confirm({
      title: '删除该关键词？',
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (ok) deleteKeyword(id)
  }

  // ── UI 状态 ──
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedKeywordId, setExpandedKeywordId] = useState<number | null>(null)
  // 双 agent 各自维护一个流：consult = 历史考据；storm = 头脑风暴
  const [consultEventId, setConsultEventId] = useState<number | null>(null)
  const [stormEventId, setStormEventId] = useState<number | null>(null)
  const [consultKeywordId, setConsultKeywordId] = useState<number | null>(null)
  const [stormKeywordId, setStormKeywordId] = useState<number | null>(null)

  // ── 筛选状态 ──
  const [filterCategory, setFilterCategory] = useState<HistoricalKeywordCategory | 'all'>('all')
  const [filterEra, setFilterEra] = useState<HistoricalEra | 'all'>('all')

  const consultAI = useAIStream()
  const stormAI = useAIStream()
  const { worldview, loadAll: loadWorldview } = useWorldviewStore()

  // 多世界：让 worldview store 跟随当前世界标签，保证历史 AI 考证读到对的世界设定
  useEffect(() => {
    if (isMW) loadWorldview(project.id!, scopeGroupId)
  }, [isMW, scopeGroupId, project.id, loadWorldview])

  /** 从世界观 store 提取与历史相关的上下文，供 AI 参考 */
  const getWorldContext = (): string => {
    if (!worldview) return ''
    const parts: string[] = []
    if (worldview.worldOrigin)    parts.push(`【世界来源】${worldview.worldOrigin.slice(0, 200)}`)
    if (worldview.powerHierarchy) parts.push(`【力量体系】${worldview.powerHierarchy.slice(0, 150)}`)
    if (worldview.historyLine)    parts.push(`【世界历史线】${worldview.historyLine.slice(0, 200)}`)
    if (worldview.worldEvents)    parts.push(`【世界大事记】${worldview.worldEvents.slice(0, 200)}`)
    if (worldview.races)          parts.push(`【种族与民族】${worldview.races.slice(0, 100)}`)
    if (worldview.factionLayout)  parts.push(`【势力分布】${worldview.factionLayout.slice(0, 100)}`)
    if (overview)                 parts.push(`【历史总述】${overview.slice(0, 200)}`)
    if (eraSystem)                parts.push(`【纪年体系】${eraSystem.slice(0, 150)}`)
    return parts.length
      ? `\n\n=== 本项目世界观设定（请结合这些背景进行分析）===\n${parts.join('\n')}`
      : ''
  }

  // 事件/关键词/章节按项目整体加载（一次），在组件内按世界过滤
  useEffect(() => {
    loadEvents(project.id!)
    loadKeywords(project.id!)
    loadChapters(project.id!)
  }, [project.id, loadEvents, loadKeywords, loadChapters])

  // 历史概述单例：随当前世界标签加载（一览/单世界为 null）
  useEffect(() => {
    loadHistory(project.id!, scopeGroupId)
  }, [project.id, scopeGroupId, loadHistory])

  // 按当前世界标签过滤事件/关键词（一览或单世界 = 全部）
  const scopedEvents = useMemo(() => (
    (!isMW || worldTab === 'all') ? events : events.filter(e => e.worldGroupId === worldTab)
  ), [events, isMW, worldTab])
  const scopedKeywords = useMemo(() => (
    (!isMW || worldTab === 'all') ? keywords : keywords.filter(k => k.worldGroupId === worldTab)
  ), [keywords, isMW, worldTab])

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
    if (!canEdit) return
    const newId = await addEvent({
      projectId: project.id!,
      era: 'custom',
      year: 0,
      date: '公元元年',
      title: '新历史事件',
      description: '描述该事件的发生过程...',
      isHistorical: true,
      ...(scopeGroupId != null ? { worldGroupId: scopeGroupId } : {}),
    })
    setExpandedId(newId)
  }

  // ── 关键词操作 ──
  const handleAddKeyword = async () => {
    if (!canEdit) return
    const newId = await addKeyword({
      projectId: project.id!,
      keyword: '新历史关键词',
      category: 'technology',
      era: 'custom',
      description: '输入该关键词的基础概念或您想借鉴的方面...',
      ...(scopeGroupId != null ? { worldGroupId: scopeGroupId } : {}),
    })
    setExpandedKeywordId(newId)
  }

  // ── AI 历史考据（consult agent）——
  // System / user prompt 来自「提示词库」history.consult 模板，作者在提示词库可编辑。
  const handleAIConsult = (evt: HistoricalTimelineEvent) => {
    if (!evt.id) return
    setConsultEventId(evt.id)

    const eraLabel = HISTORICAL_ERA_LABELS[evt.era as HistoricalEra] || evt.era
    const itemMeta = [
      `- 标题：${evt.title}`,
      `- 历史时期：${eraLabel}`,
      `- 数字化年份：${evt.year} (公元 ${evt.year > 0 ? evt.year : '前 ' + Math.abs(evt.year)} 年)`,
      `- 时间描述：${evt.date}`,
      evt.customTimeRange ? `- 具体时间范围/区间：${evt.customTimeRange}` : '',
      evt.location ? `- 地理位置/范围：${evt.location}` : '',
      `- 是否标记为真实史实：${evt.isHistorical ? '是' : '否（作者已声明为虚构 / 架空）'}`,
      `- 现有史料来源：${evt.source || '无'}`,
    ].filter(Boolean).join('\n')

    const tpl = usePromptStore.getState().getActive('history.consult')
    const { messages } = renderPrompt(tpl, {
      itemMeta,
      finalText: evt.description || '（条目定稿暂未填写）',
      conceptNote: (evt.conceptNote || '').trim(),
      consultPrompt: (evt.consultPrompt || '').trim(),
      worldContext: getWorldContext().replace(/^\n\n=== [^\n]+ ===\n/, ''),
    })

    consultAI.start(messages, undefined, { category: 'history.consult', projectId: project.id! })
  }

  // ── AI 头脑风暴（storm agent）——
  const handleAIStorm = (evt: HistoricalTimelineEvent) => {
    if (!evt.id) return
    setStormEventId(evt.id)

    const eraLabel = HISTORICAL_ERA_LABELS[evt.era as HistoricalEra] || evt.era
    const itemMeta = [
      `- 标题：${evt.title}`,
      `- 历史时期：${eraLabel}`,
      `- 数字化年份：${evt.year} (公元 ${evt.year > 0 ? evt.year : '前 ' + Math.abs(evt.year)} 年)`,
      `- 时间描述：${evt.date}`,
      evt.customTimeRange ? `- 具体时间范围/区间：${evt.customTimeRange}` : '',
      evt.location ? `- 地理位置/范围：${evt.location}` : '',
      `- 作者标记：${evt.isHistorical ? '基于真实史实' : '虚构 / 架空，发散自由度更高'}`,
    ].filter(Boolean).join('\n')

    const tpl = usePromptStore.getState().getActive('history.storm')
    const { messages } = renderPrompt(tpl, {
      itemMeta,
      finalText: evt.description || '（条目定稿暂未填写）',
      conceptNote: (evt.conceptNote || '').trim(),
      stormPrompt: (evt.stormPrompt || '').trim(),
      worldContext: getWorldContext().replace(/^\n\n=== [^\n]+ ===\n/, ''),
    })

    stormAI.start(messages, undefined, { category: 'history.storm', projectId: project.id! })
  }

  // ── AI 关键词历史考据 ──
  const handleAIKeywordConsult = (kw: HistoricalKeyword) => {
    if (!kw.id) return
    setConsultKeywordId(kw.id)

    const eraLabel = HISTORICAL_ERA_LABELS[kw.era as HistoricalEra] || kw.era
    const categoryLabel = KEYWORD_CATEGORY_LABELS[kw.category as HistoricalKeywordCategory] || kw.category
    const itemMeta = [
      `- 关键词：${kw.keyword}`,
      `- 分类：${categoryLabel}`,
      `- 适用历史时期：${eraLabel}`,
      kw.customTimeRange ? `- 具体时间范围/区间：${kw.customTimeRange}` : '',
      kw.location ? `- 地理位置/范围：${kw.location}` : '',
    ].filter(Boolean).join('\n')

    const tpl = usePromptStore.getState().getActive('history.consult')
    const { messages } = renderPrompt(tpl, {
      itemMeta,
      finalText: kw.description || '（条目定稿暂未填写）',
      conceptNote: (kw.conceptNote || '').trim(),
      consultPrompt: (kw.consultPrompt || '').trim(),
      worldContext: getWorldContext().replace(/^\n\n=== [^\n]+ ===\n/, ''),
    })

    consultAI.start(messages, undefined, { category: 'history.consult', projectId: project.id! })
  }

  // ── AI 关键词头脑风暴 ──
  const handleAIKeywordStorm = (kw: HistoricalKeyword) => {
    if (!kw.id) return
    setStormKeywordId(kw.id)

    const eraLabel = HISTORICAL_ERA_LABELS[kw.era as HistoricalEra] || kw.era
    const categoryLabel = KEYWORD_CATEGORY_LABELS[kw.category as HistoricalKeywordCategory] || kw.category
    const itemMeta = [
      `- 关键词：${kw.keyword}`,
      `- 分类：${categoryLabel}`,
      `- 适用历史时期：${eraLabel}`,
      kw.customTimeRange ? `- 具体时间范围/区间：${kw.customTimeRange}` : '',
      kw.location ? `- 地理位置/范围：${kw.location}` : '',
    ].filter(Boolean).join('\n')

    const tpl = usePromptStore.getState().getActive('history.storm')
    const { messages } = renderPrompt(tpl, {
      itemMeta,
      finalText: kw.description || '（条目定稿暂未填写）',
      conceptNote: (kw.conceptNote || '').trim(),
      stormPrompt: (kw.stormPrompt || '').trim(),
      worldContext: getWorldContext().replace(/^\n\n=== [^\n]+ ===\n/, ''),
    })

    stormAI.start(messages, undefined, { category: 'history.storm', projectId: project.id! })
  }

  const handleAcceptConsult = (text: string) => {
    if (consultEventId) {
      updateEvent(consultEventId, { aiConsult: text })
      setConsultEventId(null)
    } else if (consultKeywordId) {
      updateKeyword(consultKeywordId, { aiConsult: text })
      setConsultKeywordId(null)
    }
    consultAI.reset()
  }

  const handleAcceptStorm = (text: string) => {
    if (stormEventId) {
      updateEvent(stormEventId, { aiBrainstorm: text })
      setStormEventId(null)
    } else if (stormKeywordId) {
      updateKeyword(stormKeywordId, { aiBrainstorm: text })
      setStormKeywordId(null)
    }
    stormAI.reset()
  }

  // ── 过滤关键词 ──
  const filteredKeywords = useMemo(() => {
    return scopedKeywords.filter((kw: HistoricalKeyword) => {
      const matchCategory = filterCategory === 'all' || kw.category === filterCategory
      const matchEra = filterEra === 'all' || kw.era === filterEra
      return matchCategory && matchEra
    })
  }, [scopedKeywords, filterCategory, filterEra])

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

      {/* 多世界：世界标签 */}
      {isMW && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => setWorldTab(g.id!)}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                worldTab === g.id
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
              }`}
            >
              <span>{g.icon || '🌐'}</span>{g.name}
            </button>
          ))}
          <button
            onClick={() => setWorldTab('all')}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              worldTab === 'all'
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
            }`}
            title="并排查看所有世界的历史，只读"
          >
            📋 一览
          </button>
        </div>
      )}

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
                时间轴事件 ({scopedEvents.length})
                {isMW && worldTab === 'all' && <span className="ml-1 text-text-muted">· 一览（只读）</span>}
              </h3>
              {canEdit && (
                <button
                  onClick={handleAddEvent}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:opacity-90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加事件
                </button>
              )}
            </div>

            {loadingEvents ? (
              <div className="flex items-center justify-center py-12 text-text-muted">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                加载时间线中...
              </div>
            ) : scopedEvents.length === 0 ? (
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
                {scopedEvents.map((evt) => {
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
                                {evt.isHistorical ? '⚓ 史实锚点' : '✨ 虚构/架空'}
                              </span>
                              {evt.isHistorical && (
                                <span className="text-[10px] text-amber-400/70" title="此事件为史实锚点，AI 生成时不可违反">
                                  AI 不可违反
                                </span>
                              )}
                              {/* 一览模式：显示事件所属世界 */}
                              {isMW && worldTab === 'all' && evt.worldGroupId != null && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                                  {groups.find(g => g.id === evt.worldGroupId)?.icon || '🌐'}
                                  {groups.find(g => g.id === evt.worldGroupId)?.name || '未知世界'}
                                </span>
                              )}
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

                            {/* ── 四个解耦的文本窗口 ── */}
                            {/* 1. 条目定稿（写作中实际使用；AI agent 不读取，避免污染） */}
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">
                                📒 条目定稿（写作时会进入小说上下文；考据 / 风暴 agent <span className="text-amber-500">不会</span> 读取此字段）
                              </label>
                              <CTextarea
                                value={evt.description}
                                onChange={e => updateEvent(evt.id!, { description: e.target.value })}
                                placeholder="作者打磨好的最终条目内容，将作为 AI 写作的历史背景注入。例如：『公元 712 年，李隆基即位为唐玄宗，开元之治始。』"
                                className="w-full h-24 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                              />
                            </div>

                            {/* 对剧情/世界的影响（属于条目定稿的语义补充，紧跟其后；放在 AI 工作区之上） */}
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">对剧情/世界的影响 (可选)</label>
                              <CTextarea
                                value={evt.impact || ''}
                                onChange={e => updateEvent(evt.id!, { impact: e.target.value })}
                                placeholder="该事件如何推动主角剧情，或者对架空世界线产生什么影响..."
                                className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                              />
                            </div>

                            {/* 关联章节（紧跟「条目定稿」，因为它属于条目定稿的归档元数据；放在 AI 工作区之上） */}
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

                            {/* 2. 概念与创作思路（AI agent 会读，作者迭代修正） */}
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">
                                🧭 概念与创作思路（提交给 AI 之前的初步设定；得到 agent 反馈后可在此处修正）
                              </label>
                              <CTextarea
                                value={evt.conceptNote || ''}
                                onChange={e => updateEvent(evt.id!, { conceptNote: e.target.value })}
                                placeholder="描述你为这条事件想达到的效果、能接受的艺术改造或架空范围、希望保留 / 偏离的史实点。例如：『允许把火药提前到本朝；其余制度仍按真实唐制写。』"
                                className="w-full h-24 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                              />
                            </div>

                            {/* 3 & 4. 双 agent 各自的额外指令 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">
                                  📝 给「历史考据 agent」的补充说明
                                </label>
                                <CTextarea
                                  value={evt.consultPrompt || ''}
                                  onChange={e => updateEvent(evt.id!, { consultPrompt: e.target.value })}
                                  placeholder="例：本作允许将火药提前到唐代，不必再纠结这一项；请重点检查官制称谓和时令风俗。"
                                  className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-text-muted mb-1">
                                  💡 给「头脑风暴 agent」的补充说明
                                </label>
                                <CTextarea
                                  value={evt.stormPrompt || ''}
                                  onChange={e => updateEvent(evt.id!, { stormPrompt: e.target.value })}
                                  placeholder="例：重点发散街市气味、市井人物对白、能引出主角第一次进城的可能场景。"
                                  className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                                />
                              </div>
                            </div>

                            {/* 双 agent 触发按钮 */}
                            <div className="pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleAIConsult(evt)}
                                  disabled={consultAI.isStreaming || !canEdit}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  AI 历史考据
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAIStorm(evt)}
                                  disabled={stormAI.isStreaming || !canEdit}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 text-purple-400 text-xs font-medium rounded-lg hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                                >
                                  <Sparkles className="w-3.5 h-3.5" />
                                  AI 头脑风暴
                                </button>
                              </div>

                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => { void handleDeleteEvent(evt.id!) }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded-lg transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  删除事件
                                </button>
                              )}
                            </div>

                            {/* 历史考据 agent 的输出窗 */}
                            {consultEventId === evt.id && (consultAI.output || consultAI.isStreaming || consultAI.error) && (
                              <div className="mt-3">
                                <p className="text-[10px] text-blue-400 mb-1 flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3" /> 历史考据 agent
                                </p>
                                <AIStreamOutput
                                  output={consultAI.output}
                                  isStreaming={consultAI.isStreaming}
                                  error={consultAI.error}
                                  tokenUsage={consultAI.tokenUsage}
                                  onStop={consultAI.stop}
                                  onAccept={handleAcceptConsult}
                                  onRetry={() => handleAIConsult(evt)}
                                />
                              </div>
                            )}

                            {/* 头脑风暴 agent 的输出窗 */}
                            {stormEventId === evt.id && (stormAI.output || stormAI.isStreaming || stormAI.error) && (
                              <div className="mt-3">
                                <p className="text-[10px] text-purple-400 mb-1 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" /> 头脑风暴 agent
                                </p>
                                <AIStreamOutput
                                  output={stormAI.output}
                                  isStreaming={stormAI.isStreaming}
                                  error={stormAI.error}
                                  tokenUsage={stormAI.tokenUsage}
                                  onStop={stormAI.stop}
                                  onAccept={handleAcceptStorm}
                                  onRetry={() => handleAIStorm(evt)}
                                />
                              </div>
                            )}

                            {/* 已保存的「历史考据」结果 */}
                            {evt.aiConsult && consultEventId !== evt.id && (
                              <div className="mt-3 bg-bg-base border border-blue-400/30 rounded-lg p-3 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-medium text-blue-400 flex items-center gap-1">
                                    <ShieldCheck className="w-3 h-3" />
                                    AI 历史考据结果
                                  </span>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => updateEvent(evt.id!, { aiConsult: undefined })}
                                      className="text-[10px] text-text-muted hover:text-red-400"
                                    >
                                      清除
                                    </button>
                                  )}
                                </div>
                                <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap prose prose-invert max-h-60 overflow-y-auto">
                                  {evt.aiConsult}
                                </div>
                              </div>
                            )}

                            {/* 已保存的「头脑风暴」结果 */}
                            {evt.aiBrainstorm && stormEventId !== evt.id && (
                              <div className="mt-3 bg-bg-base border border-purple-400/30 rounded-lg p-3 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-medium text-purple-400 flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" />
                                    AI 头脑风暴结果
                                  </span>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => updateEvent(evt.id!, { aiBrainstorm: undefined })}
                                      className="text-[10px] text-text-muted hover:text-red-400"
                                    >
                                      清除
                                    </button>
                                  )}
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

              {canEdit && (
                <button
                  onClick={handleAddKeyword}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:opacity-90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加关键词
                </button>
              )}
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

                          {/* ── 四个解耦的文本窗口 ── */}
                          {/* 1. 条目定稿（写作中实际使用；AI agent 不读取，避免污染） */}
                          <div>
                            <label className="block text-[11px] text-text-muted mb-1">
                              📒 条目定稿（写作时会进入小说上下文；考据 / 风暴 agent <span className="text-amber-500">不会</span> 读取此字段）
                            </label>
                            <CTextarea
                              value={kw.description}
                              onChange={e => updateKeyword(kw.id!, { description: e.target.value })}
                              placeholder="作者打磨好的最终条目内容，将作为 AI 写作的历史细节注入。例如：『飞钱：唐宪宗时期出现的汇兑凭证，由邸店或商号代为兑付。』"
                              className="w-full h-24 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                            />
                          </div>

                          {/* 关联章节（紧跟「条目定稿」，与事件卡保持一致；放在 AI 工作区之上） */}
                          <div>
                            <label className="block text-[11px] text-text-muted mb-1">关联章节</label>
                            <div className="flex flex-wrap gap-1 p-1.5 bg-bg-base border border-border rounded-lg min-h-[40px] max-h-24 overflow-y-auto">
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

                          {/* 2. 概念与创作思路 */}
                          <div>
                            <label className="block text-[11px] text-text-muted mb-1">
                              🧭 概念与创作思路（提交给 AI 之前的初步设定；得到 agent 反馈后可在此处修正）
                            </label>
                            <CTextarea
                              value={kw.conceptNote || ''}
                              onChange={e => updateKeyword(kw.id!, { conceptNote: e.target.value })}
                              placeholder="描述你想为这个关键词达到的效果、能接受的艺术改造或架空范围。例如：『允许把飞钱的普及度写得比真实高一些；想要市井使用场景。』"
                              className="w-full h-24 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                            />
                          </div>

                          {/* 3 & 4. 双 agent 各自的额外指令 */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">
                                📝 给「历史考据 agent」的补充说明
                              </label>
                              <CTextarea
                                value={kw.consultPrompt || ''}
                                onChange={e => updateKeyword(kw.id!, { consultPrompt: e.target.value })}
                                placeholder="例：本作允许把飞钱写得普及度更高；请重点检查兑付流程和涉事衙门称谓。"
                                className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">
                                💡 给「头脑风暴 agent」的补充说明
                              </label>
                              <CTextarea
                                value={kw.stormPrompt || ''}
                                onChange={e => updateKeyword(kw.id!, { stormPrompt: e.target.value })}
                                placeholder="例：重点发散市井使用场景与可能的诈骗冲突。"
                                className="w-full h-20 p-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
                              />
                            </div>
                          </div>

                          {/* 操作按钮 */}
                          <div className="pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleAIKeywordConsult(kw)}
                                disabled={consultAI.isStreaming || !canEdit}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                AI 历史考据
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAIKeywordStorm(kw)}
                                disabled={stormAI.isStreaming || !canEdit}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 text-purple-400 text-xs font-medium rounded-lg hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                AI 头脑风暴
                              </button>
                            </div>

                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => { void handleDeleteKeyword(kw.id!) }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded-lg transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                删除关键词
                              </button>
                            )}
                          </div>

                          {/* 历史考据 agent 的输出窗 */}
                          {consultKeywordId === kw.id && (consultAI.output || consultAI.isStreaming || consultAI.error) && (
                            <div className="mt-3">
                              <p className="text-[10px] text-blue-400 mb-1 flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" /> 历史考据 agent
                              </p>
                              <AIStreamOutput
                                output={consultAI.output}
                                isStreaming={consultAI.isStreaming}
                                error={consultAI.error}
                                tokenUsage={consultAI.tokenUsage}
                                onStop={consultAI.stop}
                                onAccept={handleAcceptConsult}
                                onRetry={() => handleAIKeywordConsult(kw)}
                              />
                            </div>
                          )}

                          {/* 头脑风暴 agent 的输出窗 */}
                          {stormKeywordId === kw.id && (stormAI.output || stormAI.isStreaming || stormAI.error) && (
                            <div className="mt-3">
                              <p className="text-[10px] text-purple-400 mb-1 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> 头脑风暴 agent
                              </p>
                              <AIStreamOutput
                                output={stormAI.output}
                                isStreaming={stormAI.isStreaming}
                                error={stormAI.error}
                                tokenUsage={stormAI.tokenUsage}
                                onStop={stormAI.stop}
                                onAccept={handleAcceptStorm}
                                onRetry={() => handleAIKeywordStorm(kw)}
                              />
                            </div>
                          )}

                          {/* 已保存的「历史考据」结果 */}
                          {kw.aiConsult && consultKeywordId !== kw.id && (
                            <div className="mt-3 bg-bg-base border border-blue-400/30 rounded-lg p-3 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium text-blue-400 flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3" />
                                  AI 历史考据结果
                                </span>
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => updateKeyword(kw.id!, { aiConsult: undefined })}
                                    className="text-[10px] text-text-muted hover:text-red-400"
                                  >
                                    清除
                                  </button>
                                )}
                              </div>
                              <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap prose prose-invert max-h-60 overflow-y-auto">
                                {kw.aiConsult}
                              </div>
                            </div>
                          )}

                          {/* 已保存的「头脑风暴」结果 */}
                          {kw.aiBrainstorm && stormKeywordId !== kw.id && (
                            <div className="mt-3 bg-bg-base border border-purple-400/30 rounded-lg p-3 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium text-purple-400 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  AI 时代细节库
                                </span>
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => updateKeyword(kw.id!, { aiBrainstorm: undefined })}
                                    className="text-[10px] text-text-muted hover:text-red-400"
                                  >
                                    清除
                                  </button>
                                )}
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
