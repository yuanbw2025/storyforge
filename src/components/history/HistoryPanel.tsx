import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Plus, Clock,
  BookOpen, Calendar, Loader2, Tag, Filter
} from 'lucide-react'
import { useHistoryStore } from '../../stores/project-singletons'
import { useHistoricalStore } from '../../stores/historical'
import { useChapterStore } from '../../stores/chapter'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIConfigStore } from '../../stores/ai-config'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import type { Project, HistoricalTimelineEvent, HistoricalEra, HistoricalKeyword, HistoricalKeywordCategory } from '../../lib/types'
import { HISTORICAL_ERA_LABELS, KEYWORD_CATEGORY_LABELS } from '../../lib/types/history'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'
import { KeywordHistoryHelp, TimelineHistoryHelp } from './HistoryHelpPanels'
import HistoryOverviewTab from './HistoryOverviewTab'
import HistoryKeywordCard from './HistoryKeywordCard'
import HistoryTimelineEventCard from './HistoryTimelineEventCard'
import { useHistoryAI } from './useHistoryAI'

interface Props {
  project: Project
}

type TabKey = 'overview' | 'timeline' | 'keywords'

export default function HistoryPanel({ project }: Props) {
  const dialog = useDialog()
  const toast = useToast()
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
  // ── 筛选状态 ──
  const [filterCategory, setFilterCategory] = useState<HistoricalKeywordCategory | 'all'>('all')
  const [filterEra, setFilterEra] = useState<HistoricalEra | 'all'>('all')

  const historySessionScope = scopeGroupId ?? 'project'
  const consultAI = useAIStream(createAISessionKey(project.id!, 'history.consult', historySessionScope))
  const stormAI = useAIStream(createAISessionKey(project.id!, 'history.storm', historySessionScope))
  const aiConfig = useAIConfigStore(state => state.config)
  const historyAI = useHistoryAI({
    projectId: project.id!,
    worldGroupId: scopeGroupId,
    provider: aiConfig.provider,
    model: aiConfig.model,
    overview,
    eraSystem,
    consultAI,
    stormAI,
    reloadEvents: () => loadEvents(project.id!),
    reloadKeywords: () => loadKeywords(project.id!),
    onError: toast.error,
  })

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
    setOverview(history?.overview || '')
    setEraSystem(history?.eraSystem || '')
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

  const handleAIConsult = (event: HistoricalTimelineEvent) => { void historyAI.run('consult', { kind: 'event', item: event }) }
  const handleAIStorm = (event: HistoricalTimelineEvent) => { void historyAI.run('storm', { kind: 'event', item: event }) }
  const handleAIKeywordConsult = (keyword: HistoricalKeyword) => { void historyAI.run('consult', { kind: 'keyword', item: keyword }) }
  const handleAIKeywordStorm = (keyword: HistoricalKeyword) => { void historyAI.run('storm', { kind: 'keyword', item: keyword }) }
  const handleAcceptConsult = (text: string) => { void historyAI.accept('consult', text) }
  const handleAcceptStorm = (text: string) => { void historyAI.accept('storm', text) }

  const {
    consultEventId,
    stormEventId,
    consultKeywordId,
    stormKeywordId,
  } = historyAI

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
        <HistoryOverviewTab
          overview={overview}
          eraSystem={eraSystem}
          onOverviewChange={setOverview}
          onEraSystemChange={setEraSystem}
          onSaveOverview={() => { void handleSaveOverview() }}
          onSaveEraSystem={() => { void handleSaveEraSystem() }}
        />
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
                {scopedEvents.map(event => {
                  const expanded = expandedId === event.id
                  const group = event.worldGroupId != null
                    ? groups.find(candidate => candidate.id === event.worldGroupId)
                    : undefined
                  const worldBadge = isMW && worldTab === 'all' && event.worldGroupId != null
                    ? { icon: group?.icon || '🌐', name: group?.name || '未知世界' }
                    : undefined
                  return (
                    <HistoryTimelineEventCard
                      key={event.id}
                      event={event}
                      chapters={chapters}
                      expanded={expanded}
                      canEdit={canEdit}
                      worldBadge={worldBadge}
                      consultActive={consultEventId === event.id}
                      stormActive={stormEventId === event.id}
                      consultPreparing={historyAI.consultPreparing}
                      stormPreparing={historyAI.stormPreparing}
                      consultAI={consultAI}
                      stormAI={stormAI}
                      onToggle={() => setExpandedId(expanded ? null : event.id || null)}
                      onChange={patch => {
                        if (event.id) void updateEvent(event.id, patch)
                      }}
                      onConsult={() => handleAIConsult(event)}
                      onStorm={() => handleAIStorm(event)}
                      onDelete={() => {
                        if (event.id) void handleDeleteEvent(event.id)
                      }}
                      onAcceptConsult={handleAcceptConsult}
                      onAcceptStorm={handleAcceptStorm}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <TimelineHistoryHelp />
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
                {filteredKeywords.map((keyword: HistoricalKeyword) => {
                  const expanded = expandedKeywordId === keyword.id
                  return (
                    <HistoryKeywordCard
                      key={keyword.id}
                      keyword={keyword}
                      chapters={chapters}
                      expanded={expanded}
                      canEdit={canEdit}
                      consultActive={consultKeywordId === keyword.id}
                      stormActive={stormKeywordId === keyword.id}
                      consultPreparing={historyAI.consultPreparing}
                      stormPreparing={historyAI.stormPreparing}
                      consultAI={consultAI}
                      stormAI={stormAI}
                      onToggle={() => setExpandedKeywordId(expanded ? null : keyword.id || null)}
                      onChange={patch => {
                        if (keyword.id) void updateKeyword(keyword.id, patch)
                      }}
                      onConsult={() => handleAIKeywordConsult(keyword)}
                      onStorm={() => handleAIKeywordStorm(keyword)}
                      onDelete={() => {
                        if (keyword.id) void handleDeleteKeyword(keyword.id)
                      }}
                      onAcceptConsult={handleAcceptConsult}
                      onAcceptStorm={handleAcceptStorm}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <KeywordHistoryHelp />
        </div>
      )}
    </div>
  )
}
