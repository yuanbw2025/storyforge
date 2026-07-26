/**
 * 势力面板 —— 镜像已升级的角色生成页布局
 *
 * 两级 Tab：
 * 1. 势力档案：六列网格 + 详情弹窗（含成员角色勾选器）+ AI 设计势力
 * 2. 关系图：SVG 节点-边图 + 关系列表 + AI 设计关系
 */
import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Trash2, X, Users, CheckSquare, Square,
  Sparkles, Loader2, ChevronDown, Settings2,
} from 'lucide-react'
import { useFactionStore } from '../../stores/faction'
import { useCharacterStore } from '../../stores/character'
import { useAIConfigStore } from '../../stores/ai-config'
import { useAIStream, type UseAIStreamReturn } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'
import { InlineInput, InlineTextarea } from '../shared/InlineEdit'
import { CInput, CTextarea } from '../shared/CompositionInput'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import {
  buildFactionGeneratePrompt,
  buildFactionRelationsPrompt,
  parseFactionStructured,
  parseFactionRelationsStructured,
  resolveMemberCharacterIds,
} from '../../lib/ai/adapters/faction-adapter'
import { assembleContext } from '../../lib/registry/assemble-context'
import { db } from '../../lib/db/schema'
import type { Project, Faction, FactionRelation } from '../../lib/types'
import {
  FACTION_TYPES, FACTION_STATUSES, FACTION_RELATION_TYPES,
  type FactionType, type FactionStatus, type FactionRelationType,
} from '../../lib/types/faction'

interface Props {
  project: Project
}

type Tab = 'factions' | 'relations'

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16']

export default function FactionPanel({ project }: Props) {
  const { factions, factionRelations, loadAll, addFaction, updateFaction, deleteFaction, addFactionRelation, updateFactionRelation, deleteFactionRelation } = useFactionStore()
  const { characters, loadAll: loadCharacters } = useCharacterStore()
  const { config: aiConfig } = useAIConfigStore()
  const { confirm } = useDialog()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('factions')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [typeFilter, setTypeFilter] = useState<FactionType | 'all'>('all')

  // ── AI 生成势力相关状态 ─────────────────────────────────
  const aiFactions = useAIStream(createAISessionKey(project.id!, 'faction.generate', 'project'))
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({ count: 4, tone: '严肃', detailLevel: '中等' })
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [showParams, setShowParams] = useState(false)
  const [adopting, setAdopting] = useState(false)

  // ── AI 生成关系相关状态 ─────────────────────────────────
  const aiRelations = useAIStream(createAISessionKey(project.id!, 'faction.relations', 'project'))
  const [relHint, setRelHint] = useState('')
  const [relParams, setRelParams] = useState<Record<string, unknown>>({ count: 6, tone: '权谋', detailLevel: '中等' })
  const [relSysOverride, setRelSysOverride] = useState<string | null>(null)
  const [relUserOverride, setRelUserOverride] = useState<string | null>(null)
  const [showRelParams, setShowRelParams] = useState(false)

  useEffect(() => { loadAll(project.id!); loadCharacters(project.id!) }, [project.id])

  const factionName = useMemo(() => new Map(factions.filter(f => f.id != null).map(f => [f.id!, f.name])), [factions])

  const filtered = useMemo(() => {
    return factions
      .filter(f => typeFilter === 'all' || f.type === typeFilter)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id! - b.id!))
  }, [factions, typeFilter])

  const detailFaction = detailId != null ? factions.find(f => f.id === detailId) : null

  const typeCounts = useMemo(() => {
    const m: Record<string, number> = { all: factions.length }
    for (const t of FACTION_TYPES) m[t.value] = factions.filter(f => f.type === t.value).length
    return m
  }, [factions])

  // ── 多选操作 ─────────────────────────────────────────────
  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(f => f.id!)))
  }
  const handleMultiDelete = async () => {
    if (selected.size === 0) return
    const count = selected.size
    const ok = await confirm({
      title: `删除 ${count} 个势力`,
      message: '将同时删除这些势力之间的所有关系。此操作不可撤销。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    for (const id of selected) await deleteFaction(id)
    setSelected(new Set())
    setMultiSelect(false)
    toast('success', `已删除 ${count} 个势力`)
  }

  // ── 添加势力（手动空模板） ──────────────────────────────
  const handleAdd = async () => {
    const id = await addFaction({
      projectId: project.id!,
      worldGroupId: null,
      name: '新势力',
      type: 'organization',
      ideology: '',
      leader: '',
      memberCharacterIds: [],
      baseLocation: '',
      power: '',
      resources: '',
      secret: '',
      status: 'rising',
      color: COLORS[factions.length % COLORS.length],
      sortOrder: factions.length,
    })
    setDetailId(id)
  }

  // ── AI 生成势力 ─────────────────────────────────────────
  const handleAIGenerate = async () => {
    // 组装上下文
    const existing = factions.length
      ? factions.map(f => `${f.name}（${FACTION_TYPES.find(t => t.value === f.type)?.label ?? f.type}/${FACTION_STATUSES.find(s => s.value === f.status)?.label ?? f.status}）`).join('、')
      : ''
    const charContext = characters.length
      ? characters.map(c => `${c.name}（${c.roleWeight}）`).join('、')
      : '（暂无角色）'
    const assembled = await assembleContext({
      projectId: project.id!,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: ['worldview', 'storyCore', 'characters'],
    })
    const opts = {
      parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
      overrides: (systemOverride != null || userOverride != null) ? {
        systemPrompt: systemOverride ?? undefined,
        userPromptTemplate: userOverride ?? undefined,
      } : undefined,
    }
    const messages = buildFactionGeneratePrompt(
      project.name, project.genre ?? '', assembled.text, charContext, existing, opts, hint,
    )
    aiFactions.start(messages, undefined, { category: 'faction.generate', projectId: project.id! })
  }

  // ── 采纳 AI 生成的势力 ─────────────────────────────────
  const handleAdoptFactionsFromAI = async (text: string) => {
    const structured = parseFactionStructured(text)
    if (structured.length === 0) {
      toast('error', '未能从 AI 输出解析出势力，请检查输出格式')
      return
    }
    setAdopting(true)
    try {
      let success = 0
      const existingCount = useFactionStore.getState().factions.length
      for (const f of structured) {
        const memberCharacterIds = await resolveMemberCharacterIds(project.id!, f.memberNames)
        await addFaction({
          projectId: project.id!,
          worldGroupId: null,
          name: f.name,
          type: f.type,
          ideology: f.ideology,
          leader: f.leader,
          memberCharacterIds,
          baseLocation: f.baseLocation,
          power: f.power,
          resources: f.resources,
          secret: f.secret,
          status: f.status,
          color: COLORS[(existingCount + success) % COLORS.length],
          sortOrder: existingCount + success,
        })
        success++
      }
      toast('success', `已采纳 ${success} 个势力`)
      aiFactions.reset()
    } finally {
      setAdopting(false)
    }
  }

  // ── AI 生成势力关系 ────────────────────────────────────
  const handleAIGenerateRelations = async () => {
    if (factions.length === 0) {
      toast('info', '请先创建势力再生成关系')
      return
    }
    const factionsList = factions.map(f =>
      `${f.name}（${FACTION_TYPES.find(t => t.value === f.type)?.label ?? f.type}/${FACTION_STATUSES.find(s => s.value === f.status)?.label ?? f.status}，首领:${f.leader || '未定'}，根据地:${f.baseLocation || '未定'}）`,
    ).join('\n')
    const opts = {
      parameterValues: Object.keys(relParams).length > 0 ? relParams : undefined,
      overrides: (relSysOverride != null || relUserOverride != null) ? {
        systemPrompt: relSysOverride ?? undefined,
        userPromptTemplate: relUserOverride ?? undefined,
      } : undefined,
    }
    const messages = buildFactionRelationsPrompt(
      project.name, project.genre ?? '', factionsList, opts, relHint,
    )
    aiRelations.start(messages, undefined, { category: 'faction.relations', projectId: project.id! })
  }

  // ── 采纳 AI 生成的势力关系 ─────────────────────────────
  const handleAdoptRelationsFromAI = async (text: string) => {
    const structured = parseFactionRelationsStructured(text)
    if (structured.length === 0) {
      toast('error', '未能从 AI 输出解析出势力关系，请检查输出格式')
      return
    }
    setAdopting(true)
    try {
      // 按名匹配已入库的 factions
      const allFactions = await db.factions.where('projectId').equals(project.id!).toArray()
      const nameToId = new Map(allFactions.filter(f => f.id != null).map(f => [f.name, f.id!]))
      let success = 0
      for (const r of structured) {
        const fromFactionId = nameToId.get(r.fromFactionName)
        const toFactionId = nameToId.get(r.toFactionName)
        if (!fromFactionId || !toFactionId) continue
        await addFactionRelation({
          projectId: project.id!,
          fromFactionId,
          toFactionId,
          relationType: r.relationType,
          label: r.label,
          description: r.description,
          isBidirectional: r.isBidirectional,
          intensity: r.intensity,
        })
        success++
      }
      toast('success', `已采纳 ${success} 条势力关系`)
      aiRelations.reset()
    } finally {
      setAdopting(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶部 Tab */}
      <div className="border-b border-border flex items-center gap-1 px-3 shrink-0">
        <button
          onClick={() => setTab('factions')}
          className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === 'factions' ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}
        >
          势力档案（{factions.length}）
        </button>
        <button
          onClick={() => setTab('relations')}
          className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === 'relations' ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}
        >
          关系图（{factionRelations.length}）
        </button>
      </div>

      {tab === 'factions' && (
        <div className="flex-1 overflow-y-auto p-4">
          {/* 工具栏 */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <button onClick={handleAdd} className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent/80 transition-colors">
              <Plus className="w-3.5 h-3.5" /> 新建势力
            </button>
            <button
              onClick={() => { setMultiSelect(!multiSelect); setSelected(new Set()) }}
              className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs border transition-colors ${multiSelect ? 'bg-warning/15 border-warning text-warning' : 'border-border text-text-secondary hover:bg-bg-hover'}`}
            >
              {multiSelect ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              {multiSelect ? '退出多选' : '多选删除'}
            </button>
            {/* 类型筛选 */}
            <div className="flex items-center gap-1 ml-2 flex-wrap">
              <FilterChip label="全部" count={typeCounts.all} active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
              {FACTION_TYPES.map(t => (
                <FilterChip key={t.value} label={t.label} count={typeCounts[t.value] ?? 0} active={typeFilter === t.value} onClick={() => setTypeFilter(t.value)} />
              ))}
            </div>
          </div>

          {/* AI 生成区 */}
          <div className="mb-4 border border-border rounded-lg bg-bg-surface p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-text-muted shrink-0">参考内容：</span>
              <CInput
                value={hint}
                onChange={e => setHint(e.target.value)}
                placeholder="如：3 个敌对势力围攻 1 个主角势力 / 参考三国格局 / 主角属于衰落门派..."
                className="flex-1 min-w-[200px] px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => setShowParams(!showParams)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded-md hover:text-accent transition-colors border border-border"
                title="调参 / 临时改 prompt"
              >
                <Settings2 className="w-3 h-3" /> 参数
                {Object.keys(parameterValues).length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 bg-accent text-white rounded text-[10px]">
                    {String(parameterValues.count ?? '?')}
                  </span>
                )}
                <ChevronDown className={`w-3 h-3 transition-transform ${showParams ? 'rotate-180' : ''}`} />
              </button>
              <button
                onClick={handleAIGenerate}
                disabled={aiFactions.isStreaming || adopting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded-md hover:text-accent disabled:opacity-50 transition-colors border border-border hover:border-accent/50"
              >
                {aiFactions.isStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {aiFactions.isStreaming ? '生成中...' : 'AI 设计势力'}
              </button>
            </div>

            {/* 参数面板 */}
            {showParams && (
              <PromptRunPanel
                moduleKey="faction.generate"
                parameterValues={parameterValues}
                onParamChange={setParameterValues}
                systemOverride={systemOverride}
                onSystemOverrideChange={setSystemOverride}
                userOverride={userOverride}
                onUserOverrideChange={setUserOverride}
                defaultOpen
              />
            )}
          </div>

          {/* AI 流式输出 */}
          {(aiFactions.output || aiFactions.isStreaming || aiFactions.error) && (
            <div className="mb-4">
              <AIStreamOutput
                output={aiFactions.output}
                isStreaming={aiFactions.isStreaming}
                error={aiFactions.error}
                tokenUsage={aiFactions.tokenUsage}
                onStop={aiFactions.stop}
                onAccept={handleAdoptFactionsFromAI}
                onRetry={handleAIGenerate}
                onDismiss={() => aiFactions.reset()}
                placeholder="等待 AI 设计势力..."
                moduleKey="faction.generate"
              />
            </div>
          )}

          {/* 多选操作栏 */}
          {multiSelect && (
            <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-warning/10 border border-warning/30 rounded text-xs">
              <button onClick={toggleSelectAll} className="text-text-secondary hover:text-text-primary">
                {selected.size === filtered.length && filtered.length > 0 ? '取消全选' : '全选'}
              </button>
              <span className="text-text-muted">已选 {selected.size} / {filtered.length}</span>
              <button
                onClick={handleMultiDelete}
                disabled={selected.size === 0}
                className="ml-auto flex items-center gap-1 px-2.5 py-1 bg-danger text-white rounded hover:bg-danger/80 disabled:opacity-40 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> 删除选中
              </button>
            </div>
          )}

          {/* 网格 */}
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-text-muted text-sm">
              {factions.length === 0 ? '还没有势力，点击「新建势力」开始，或用「AI 设计势力」一键生成' : '当前类型下没有势力'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {filtered.map(f => (
                <button
                  key={f.id}
                  onClick={() => multiSelect ? toggleSelect(f.id!) : setDetailId(f.id!)}
                  className={`group relative p-2.5 rounded-lg border text-left transition-all ${
                    multiSelect && selected.has(f.id!)
                      ? 'border-warning ring-1 ring-warning/40 bg-warning/5'
                      : 'border-border bg-bg-surface hover:border-accent/40 hover:bg-bg-hover'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: f.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{f.name}</p>
                      <p className="text-[10px] text-text-muted">
                        {FACTION_TYPES.find(t => t.value === f.type)?.label ?? f.type}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-text-muted mt-1 line-clamp-2 min-h-[2.4em]">
                    {f.ideology || '（无理念）'}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
                    <span className="flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" /> {f.memberCharacterIds.length}
                    </span>
                    <span className="px-1 py-0.5 rounded bg-bg-hover">{FACTION_STATUSES.find(s => s.value === f.status)?.label ?? f.status}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'relations' && (
        <RelationsTab
          project={project}
          factions={factions}
          relations={factionRelations}
          factionName={factionName}
          onAdd={addFactionRelation}
          onUpdate={updateFactionRelation}
          onDelete={deleteFactionRelation}
          aiRelations={aiRelations}
          relHint={relHint}
          setRelHint={setRelHint}
          relParams={relParams}
          setRelParams={setRelParams}
          showRelParams={showRelParams}
          setShowRelParams={setShowRelParams}
          relSysOverride={relSysOverride}
          setRelSysOverride={setRelSysOverride}
          relUserOverride={relUserOverride}
          setRelUserOverride={setRelUserOverride}
          onAIGenerateRelations={handleAIGenerateRelations}
          onAdoptRelationsFromAI={handleAdoptRelationsFromAI}
          adopting={adopting}
        />
      )}

      {/* 详情弹窗 */}
      {detailFaction && (
        <FactionDetailDialog
          faction={detailFaction}
          characters={characters}
          onClose={() => setDetailId(null)}
          onUpdate={(data) => updateFaction(detailFaction.id!, data)}
          onDelete={async () => {
            const ok = await confirm({
              title: `删除势力「${detailFaction.name}」`,
              message: '将同时删除与该势力相关的所有关系。此操作不可撤销。',
              confirmText: '删除',
              tone: 'danger',
            })
            if (!ok) return
            await deleteFaction(detailFaction.id!)
            setDetailId(null)
            toast('success', '已删除势力')
          }}
        />
      )}
    </div>
  )
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded text-[11px] transition-colors ${active ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'}`}
    >
      {label} ({count})
    </button>
  )
}

// ── 详情弹窗 ────────────────────────────────────────────────────────────

function FactionDetailDialog({
  faction, characters, onClose, onUpdate, onDelete,
}: {
  faction: Faction
  characters: { id?: number; name: string }[]
  onClose: () => void
  onUpdate: (data: Partial<Faction>) => void
  onDelete: () => void
}) {
  const [memberSearch, setMemberSearch] = useState('')
  const memberSet = new Set(faction.memberCharacterIds)
  const filteredChars = characters.filter(c => c.id != null && c.name.toLowerCase().includes(memberSearch.toLowerCase()))

  const toggleMember = (id: number) => {
    const next = new Set(memberSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onUpdate({ memberCharacterIds: Array.from(next) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="relative bg-bg-base border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: faction.color }} />
            <span className="text-sm font-medium text-text-primary">{faction.name}</span>
            <span className="text-xs text-text-muted">[{faction.type}/{faction.status}]</span>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">势力名称</label>
              <InlineInput value={faction.name} onChange={(v: string) => onUpdate({ name: v })} />
            </div>
            <div>
              <label className="text-xs text-text-muted">首领</label>
              <InlineInput value={faction.leader} onChange={(v: string) => onUpdate({ leader: v })} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-text-muted">类型</label>
              <select
                value={faction.type}
                onChange={e => onUpdate({ type: e.target.value as FactionType })}
                className="w-full text-sm px-2 py-1 border border-border rounded bg-bg-surface"
              >
                {FACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">状态</label>
              <select
                value={faction.status}
                onChange={e => onUpdate({ status: e.target.value as FactionStatus })}
                className="w-full text-sm px-2 py-1 border border-border rounded bg-bg-surface"
              >
                {FACTION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted">颜色</label>
              <div className="flex items-center gap-1 mt-1">
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => onUpdate({ color: c })}
                    className={`w-5 h-5 rounded-full border-2 ${faction.color === c ? 'border-text-primary' : 'border-transparent'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-text-muted">核心理念</label>
            <InlineTextarea value={faction.ideology} onChange={(v: string) => onUpdate({ ideology: v })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted">根据地</label>
              <InlineInput value={faction.baseLocation} onChange={(v: string) => onUpdate({ baseLocation: v })} />
            </div>
            <div>
              <label className="text-xs text-text-muted">势力范围</label>
              <InlineInput value={faction.power} onChange={(v: string) => onUpdate({ power: v })} />
            </div>
          </div>

          <div>
            <label className="text-xs text-text-muted">资源/财富</label>
            <InlineTextarea value={faction.resources} onChange={(v: string) => onUpdate({ resources: v })} />
          </div>

          <div>
            <label className="text-xs text-text-muted">隐秘信息（暗线）</label>
            <InlineTextarea value={faction.secret} onChange={(v: string) => onUpdate({ secret: v })} />
          </div>

          {/* 成员角色勾选器 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-text-muted">成员角色（{memberSet.size}）</label>
              <input
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                placeholder="搜索角色名..."
                className="text-xs px-2 py-1 border border-border rounded bg-bg-surface w-40"
              />
            </div>
            <div className="border border-border rounded max-h-48 overflow-y-auto">
              {filteredChars.length === 0 ? (
                <p className="text-xs text-text-muted p-3 text-center">没有匹配的角色</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-2">
                  {filteredChars.map(c => (
                    <button
                      key={c.id}
                      onClick={() => toggleMember(c.id!)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${memberSet.has(c.id!) ? 'bg-accent/15 text-accent' : 'hover:bg-bg-hover text-text-secondary'}`}
                    >
                      {memberSet.has(c.id!) ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-2 border-t border-border shrink-0 flex justify-end">
          <button
            onClick={onDelete}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-danger text-white rounded hover:bg-danger/80 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> 删除势力
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 关系图 Tab ───────────────────────────────────────────────────────────

function RelationsTab({
  project, factions, relations, factionName, onAdd, onUpdate, onDelete,
  aiRelations, relHint, setRelHint, relParams, setRelParams,
  showRelParams, setShowRelParams, relSysOverride, setRelSysOverride,
  relUserOverride, setRelUserOverride, onAIGenerateRelations, onAdoptRelationsFromAI,
  adopting,
}: {
  project: Project
  factions: Faction[]
  relations: FactionRelation[]
  factionName: Map<number, string>
  onAdd: (rel: Omit<FactionRelation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  onUpdate: (id: number, data: Partial<FactionRelation>) => Promise<void>
  onDelete: (id: number) => Promise<void>
  aiRelations: UseAIStreamReturn
  relHint: string
  setRelHint: (v: string) => void
  relParams: Record<string, unknown>
  setRelParams: (v: Record<string, unknown>) => void
  showRelParams: boolean
  setShowRelParams: (v: boolean) => void
  relSysOverride: string | null
  setRelSysOverride: (v: string | null) => void
  relUserOverride: string | null
  setRelUserOverride: (v: string | null) => void
  onAIGenerateRelations: () => Promise<void>
  onAdoptRelationsFromAI: (text: string) => Promise<void>
  adopting: boolean
}) {
  const { confirm } = useDialog()
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<number | null>(null)

  // SVG 节点位置：圆形分布
  const nodePositions = useMemo(() => {
    const cx = 250, cy = 200, r = 130
    return new Map(factions.map((f, i) => {
      const angle = (i / Math.max(factions.length, 1)) * 2 * Math.PI - Math.PI / 2
      return [f.id!, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }]
    }))
  }, [factions])

  const handleAddRelation = async () => {
    if (factions.length < 2) {
      toast('info', '至少需要 2 个势力才能建立关系')
      return
    }
    const id = await onAdd({
      projectId: project.id!,
      fromFactionId: factions[0].id!,
      toFactionId: factions[1].id!,
      relationType: 'neutral',
      label: '',
      description: '',
      isBidirectional: true,
      intensity: 50,
    })
    setEditingId(id)
  }

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: '删除势力关系',
      message: '此操作不可撤销。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await onDelete(id)
    toast('success', '已删除关系')
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
      <h3 className="text-sm font-medium text-text-primary">势力关系</h3>
      <button onClick={handleAddRelation} className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent/80">
        <Plus className="w-3.5 h-3.5" /> 新建关系
      </button>
    </div>

    {/* AI 生成区 */}
    <div className="border border-border rounded-lg bg-bg-surface p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-muted shrink-0">参考内容：</span>
        <CInput
          value={relHint}
          onChange={e => setRelHint(e.target.value)}
          placeholder="如：两强相争、暗中结盟 / 围绕主角势力的三方博弈 / 复刻战国合纵连横..."
          className="flex-1 min-w-[200px] px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => setShowRelParams(!showRelParams)}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded-md hover:text-accent transition-colors border border-border"
          title="调参 / 临时改 prompt"
        >
          <Settings2 className="w-3 h-3" /> 参数
          {Object.keys(relParams).length > 0 && (
            <span className="ml-0.5 px-1.5 py-0.5 bg-accent text-white rounded text-[10px]">
              {String(relParams.count ?? '?')}
            </span>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${showRelParams ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={onAIGenerateRelations}
          disabled={aiRelations.isStreaming || adopting || factions.length < 2}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded-md hover:text-accent disabled:opacity-50 transition-colors border border-border hover:border-accent/50"
        >
          {aiRelations.isStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {aiRelations.isStreaming ? '生成中...' : 'AI 设计关系'}
        </button>
      </div>

      {/* 参数面板 */}
      {showRelParams && (
        <PromptRunPanel
          moduleKey="faction.relations"
          parameterValues={relParams}
          onParamChange={setRelParams}
          systemOverride={relSysOverride}
          onSystemOverrideChange={setRelSysOverride}
          userOverride={relUserOverride}
          onUserOverrideChange={setRelUserOverride}
          defaultOpen
        />
      )}
    </div>

    {/* AI 流式输出 */}
    {(aiRelations.output || aiRelations.isStreaming || aiRelations.error) && (
      <div>
        <AIStreamOutput
          output={aiRelations.output}
          isStreaming={aiRelations.isStreaming}
          error={aiRelations.error}
          tokenUsage={aiRelations.tokenUsage}
          onStop={aiRelations.stop}
          onAccept={onAdoptRelationsFromAI}
          onRetry={onAIGenerateRelations}
          onDismiss={() => aiRelations.reset()}
          placeholder="等待 AI 设计势力关系..."
          moduleKey="faction.relations"
        />
      </div>
    )}

    {factions.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">先在「势力档案」Tab 创建势力</div>
      ) : (
        <>
          {/* SVG 关系图 */}
          <div className="border border-border rounded-lg bg-bg-surface p-2 overflow-x-auto">
            <svg width="500" height="400" className="mx-auto">
              {/* 边 */}
              {relations.map(r => {
                const from = nodePositions.get(r.fromFactionId)
                const to = nodePositions.get(r.toFactionId)
                if (!from || !to) return null
                const color = FACTION_RELATION_TYPES.find(t => t.value === r.relationType)?.color ?? '#94a3b8'
                const width = Math.max(1, r.intensity / 25)
                const mx = (from.x + to.x) / 2
                const my = (from.y + to.y) / 2
                return (
                  <g key={r.id}>
                    <line
                      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={color} strokeWidth={width}
                      strokeDasharray={r.isBidirectional ? '' : '4 2'}
                    />
                    <text x={mx} y={my - 4} textAnchor="middle" className="fill-text-muted" fontSize="8">
                      {FACTION_RELATION_TYPES.find(t => t.value === r.relationType)?.label ?? r.relationType}
                    </text>
                    <text x={mx} y={my + 6} textAnchor="middle" className="fill-text-muted" fontSize="8">
                      {r.intensity}
                    </text>
                  </g>
                )
              })}
              {/* 节点 */}
              {factions.map(f => {
                const pos = nodePositions.get(f.id!)
                if (!pos) return null
                return (
                  <g key={f.id}>
                    <circle cx={pos.x} cy={pos.y} r="20" fill={f.color} stroke="white" strokeWidth="2" />
                    <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill="white" fontSize="10" fontWeight="600">
                      {f.name.slice(0, 2)}
                    </text>
                    <text x={pos.x} y={pos.y + 32} textAnchor="middle" className="fill-text-primary" fontSize="10">
                      {f.name.length > 6 ? f.name.slice(0, 6) + '…' : f.name}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* 关系列表 */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-text-muted">关系列表（{relations.length} 条）</h4>
            {relations.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-4">还没有势力关系</p>
            ) : (
              relations.map(r => (
                <div key={r.id} className={`border rounded p-3 ${editingId === r.id ? 'border-accent bg-accent/5' : 'border-border bg-bg-surface'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-primary">
                      {factionName.get(r.fromFactionId) ?? `#${r.fromFactionId}`}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded text-white" style={{ background: FACTION_RELATION_TYPES.find(t => t.value === r.relationType)?.color }}>
                      {FACTION_RELATION_TYPES.find(t => t.value === r.relationType)?.label ?? r.relationType}
                    </span>
                    <span className="text-xs text-text-muted">{r.isBidirectional ? '↔' : '→'}</span>
                    <span className="text-sm font-medium text-text-primary">
                      {factionName.get(r.toFactionId) ?? `#${r.toFactionId}`}
                    </span>
                    <span className="text-[10px] text-text-muted ml-2">强度 {r.intensity}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <button onClick={() => setEditingId(editingId === r.id ? null : r.id!)} className="text-xs px-2 py-1 text-text-secondary hover:text-accent">
                        {editingId === r.id ? '收起' : '编辑'}
                      </button>
                      <button onClick={() => handleDelete(r.id!)} className="text-xs px-2 py-1 text-danger hover:text-danger/80">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {editingId === r.id && (
                    <div className="mt-3 pt-3 border-t border-border space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-text-muted">源势力</label>
                          <select
                            value={String(r.fromFactionId)}
                            onChange={e => onUpdate(r.id!, { fromFactionId: Number(e.target.value) })}
                            className="w-full text-sm px-2 py-1 border border-border rounded bg-bg-surface"
                          >
                            {factions.map(f => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-text-muted">目标势力</label>
                          <select
                            value={String(r.toFactionId)}
                            onChange={e => onUpdate(r.id!, { toFactionId: Number(e.target.value) })}
                            className="w-full text-sm px-2 py-1 border border-border rounded bg-bg-surface"
                          >
                            {factions.map(f => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-text-muted">关系类型</label>
                          <select
                            value={r.relationType}
                            onChange={e => onUpdate(r.id!, { relationType: e.target.value as FactionRelationType })}
                            className="w-full text-sm px-2 py-1 border border-border rounded bg-bg-surface"
                          >
                            {FACTION_RELATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-text-muted">强度（0-100）</label>
                          <input
                            type="number" min={0} max={100}
                            value={r.intensity}
                            onChange={e => onUpdate(r.id!, { intensity: Math.max(0, Math.min(100, Number(e.target.value))) })}
                            className="w-full text-sm px-2 py-1 border border-border rounded bg-bg-surface"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-text-muted">关系标签</label>
                        <CInput value={r.label} onChange={(e) => onUpdate(r.id!, { label: (e.target as HTMLInputElement).value })} placeholder="如：世仇、主从、秘密同盟" />
                      </div>
                      <div>
                        <label className="text-xs text-text-muted">关系描述</label>
                        <CTextarea value={r.description} onChange={(e) => onUpdate(r.id!, { description: (e.target as HTMLTextAreaElement).value })} />
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={r.isBidirectional}
                          onChange={e => onUpdate(r.id!, { isBidirectional: e.target.checked })}
                        />
                        双向关系
                      </label>
                    </div>
                  )}
                  {r.label && editingId !== r.id && <p className="text-xs text-text-muted mt-1">标签：{r.label}</p>}
                  {r.description && editingId !== r.id && <p className="text-xs text-text-muted">{r.description}</p>}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
