/**
 * Phase 32.4 — 世界规则面板（真实与幻想）
 *
 * 三列布局：L1 大类导航 → L2 子类列表 → 编辑区（双文本框 + 优先级）
 * 底部：规则预览 + Token 估算
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, Eye, EyeOff, X, Check } from 'lucide-react'
import { useWorldRulesStore } from '../../stores/world-rules'
import { useWorldGroupStore } from '../../stores/world-group'
import {
  WORLD_RULE_TREE,
  CONFLICT_PRIORITY_LABELS,
  isEntryEmpty,
  createEmptyEntry,
} from '../../lib/types/world-rules'
import type {
  WorldRuleNodeDef,
  CustomWorldRuleNode,
  ConflictPriority,
  WorldRuleEntry,
} from '../../lib/types/world-rules'
import {
  buildWorldRulesManifest,
  estimateManifestTokens,
} from '../../lib/ai/world-rules-manifest'
import type { Project } from '../../lib/types'
import type { HistoricalTimelineEvent, HistoricalKeyword } from '../../lib/types/history'
import { db } from '../../lib/db/schema'

interface Props {
  project: Project
}

// ── 辅助 ──────────────────────────────────────────────────────────

/** 获取 L1 节点下所有 L2 子节点（预定义 + 自定义） */
function getL2Nodes(
  l1Id: string,
  predefined: WorldRuleNodeDef | undefined,
  customNodes: CustomWorldRuleNode[],
): { id: string; label: string; icon: string; hints?: string[]; isCustom: boolean }[] {
  const result: { id: string; label: string; icon: string; hints?: string[]; isCustom: boolean }[] = []
  // 预定义 L2
  if (predefined?.children) {
    for (const l2 of predefined.children) {
      result.push({ id: l2.id, label: l2.label, icon: l2.icon, hints: l2.hints, isCustom: false })
    }
  }
  // 自定义 L2（parentId = l1Id）
  for (const n of customNodes) {
    if (n.parentId === l1Id) {
      result.push({ id: n.id, label: n.label, icon: n.icon || '🔖', hints: n.hints, isCustom: true })
    }
  }
  return result
}

// ── 主面板 ─────────────────────────────────────────────────────────

export default function WorldRulesPanel({ project }: Props) {
  const {
    profile, loading, loadProfile,
    updateEntry, deleteEntry,
    updateGlobalNote,
    addCustomNode, deleteCustomNode,
    filledCount,
  } = useWorldRulesStore()
  const {
    groups: worldGroups,
    activeGroupId,
    loadAll: loadWorldGroups,
  } = useWorldGroupStore()

  const [selectedL1, setSelectedL1] = useState<string>(WORLD_RULE_TREE[0].id)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewText, setPreviewText] = useState('')
  const [previewTokens, setPreviewTokens] = useState(0)
  const [worldTab, setWorldTab] = useState<number | null>(null)

  // 自定义节点新增
  const [addingL1, setAddingL1] = useState(false)
  const [addingL2, setAddingL2] = useState(false)
  const [newNodeLabel, setNewNodeLabel] = useState('')

  // 时间线 & 关键词（用于预览）
  const [timelineEvents, setTimelineEvents] = useState<HistoricalTimelineEvent[]>([])
  const [keywords, setKeywords] = useState<HistoricalKeyword[]>([])

  const projectWorldGroups = useMemo(
    () => worldGroups.filter(group => group.projectId === project.id),
    [project.id, worldGroups],
  )

  // 多世界项目先加载世界组，再按当前世界加载规则 profile。
  useEffect(() => {
    if (!project.enableMultiWorld) return
    loadWorldGroups(project.id!)
  }, [project.id, project.enableMultiWorld, loadWorldGroups])

  useEffect(() => {
    if (!project.enableMultiWorld) {
      setWorldTab(null)
      return
    }
    if (worldTab != null) return
    const activeGroupBelongsToProject = projectWorldGroups.some(group => group.id === activeGroupId)
    const nextWorldGroupId = activeGroupBelongsToProject ? activeGroupId : projectWorldGroups[0]?.id ?? null
    if (nextWorldGroupId != null) setWorldTab(nextWorldGroupId)
  }, [activeGroupId, project.enableMultiWorld, projectWorldGroups, worldTab])

  useEffect(() => {
    if (project.enableMultiWorld && worldTab == null) return
    loadProfile(project.id!, project.enableMultiWorld ? worldTab : null)
  }, [project.id, project.enableMultiWorld, worldTab, loadProfile])

  useEffect(() => {
    const loadExtras = async () => {
      const events = await db.historicalTimelineEvents
        .where('projectId').equals(project.id!)
        .sortBy('year')
      setTimelineEvents(events)
      const kws = await db.historicalKeywords
        .where('projectId').equals(project.id!)
        .toArray()
      setKeywords(kws)
    }
    loadExtras()
  }, [project.id])

  const scopedTimelineEvents = useMemo(() => {
    if (!project.enableMultiWorld) return timelineEvents
    return timelineEvents.filter(e => (e.worldGroupId ?? null) === (worldTab ?? null))
  }, [project.enableMultiWorld, timelineEvents, worldTab])

  const scopedKeywords = useMemo(() => {
    if (!project.enableMultiWorld) return keywords
    return keywords.filter(k => (k.worldGroupId ?? null) === (worldTab ?? null))
  }, [project.enableMultiWorld, keywords, worldTab])

  // 所有 L1 节点（预定义 + 自定义顶级）
  const l1Nodes = useMemo(() => {
    const nodes: { id: string; label: string; icon: string; isCustom: boolean; hints?: string[] }[] = []
    for (const l1 of WORLD_RULE_TREE) {
      nodes.push({ id: l1.id, label: l1.label, icon: l1.icon, isCustom: false, hints: l1.hints })
    }
    // 自定义 L1（parentId = null）
    if (profile) {
      for (const n of profile.customNodes) {
        if (!n.parentId) {
          nodes.push({ id: n.id, label: n.label, icon: n.icon || '🔖', isCustom: true, hints: n.hints })
        }
      }
    }
    return nodes
  }, [profile])

  // 当前 L1 下的 L2 列表
  const l2Nodes = useMemo(() => {
    const predefined = WORLD_RULE_TREE.find(l1 => l1.id === selectedL1)
    return getL2Nodes(selectedL1, predefined, profile?.customNodes || [])
  }, [selectedL1, profile])

  // 当前选中节点的 entry
  const currentEntry = useMemo<WorldRuleEntry>(() => {
    if (!selectedNode || !profile) return createEmptyEntry()
    return profile.entries[selectedNode] || createEmptyEntry()
  }, [selectedNode, profile])

  // 当前选中节点的 hints
  const currentHints = useMemo<string[]>(() => {
    if (!selectedNode) return []
    // L1 级别
    const l1 = WORLD_RULE_TREE.find(n => n.id === selectedNode)
    if (l1?.hints) return l1.hints
    // L2 预定义
    for (const l1Node of WORLD_RULE_TREE) {
      const l2 = l1Node.children?.find(n => n.id === selectedNode)
      if (l2?.hints) return l2.hints
    }
    // 自定义
    const custom = profile?.customNodes.find(n => n.id === selectedNode)
    if (custom?.hints) return custom.hints
    return []
  }, [selectedNode, profile])

  // 当前选中节点的标签
  const currentLabel = useMemo<string>(() => {
    if (!selectedNode) return ''
    // L1
    const l1 = WORLD_RULE_TREE.find(n => n.id === selectedNode)
    if (l1) return `${l1.icon} ${l1.label}`
    // L2 预定义
    for (const l1Node of WORLD_RULE_TREE) {
      const l2 = l1Node.children?.find(n => n.id === selectedNode)
      if (l2) return `${l2.icon} ${l2.label}`
    }
    // 自定义
    const custom = profile?.customNodes.find(n => n.id === selectedNode)
    if (custom) return `${custom.icon || '🔖'} ${custom.label}`
    return selectedNode
  }, [selectedNode, profile])

  // 统计某个 L1 下已填节点数
  const countL1Filled = useCallback((l1Id: string): number => {
    if (!profile) return 0
    let count = 0
    // L1 自身
    if (!isEntryEmpty(profile.entries[l1Id])) count++
    // L2 预定义
    const predefined = WORLD_RULE_TREE.find(l1 => l1.id === l1Id)
    if (predefined?.children) {
      for (const l2 of predefined.children) {
        if (!isEntryEmpty(profile.entries[l2.id])) count++
      }
    }
    // 自定义 L2
    for (const n of profile.customNodes) {
      if (n.parentId === l1Id && !isEntryEmpty(profile.entries[n.id])) count++
    }
    return count
  }, [profile])

  // 保存字段
  const handleFieldChange = useCallback(async (
    field: keyof WorldRuleEntry,
    value: string | ConflictPriority,
  ) => {
    if (!selectedNode) return
    await updateEntry(selectedNode, field, value)
  }, [selectedNode, updateEntry])

  // 预览清单
  const handleTogglePreview = useCallback(async () => {
    if (showPreview) {
      setShowPreview(false)
      return
    }
    const text = buildWorldRulesManifest(profile, {
      timelineEvents: scopedTimelineEvents,
      keywords: scopedKeywords,
    })
    setPreviewText(text)
    setPreviewTokens(estimateManifestTokens(text))
    setShowPreview(true)
  }, [showPreview, profile, scopedTimelineEvents, scopedKeywords])

  const handleSwitchWorld = useCallback((worldGroupId: number) => {
    setWorldTab(worldGroupId)
    setSelectedNode(null)
    setShowPreview(false)
  }, [])

  // 新增自定义 L1
  const handleAddL1 = useCallback(async () => {
    if (!newNodeLabel.trim()) return
    await addCustomNode({ parentId: null, label: newNodeLabel.trim(), icon: '🔖' })
    setNewNodeLabel('')
    setAddingL1(false)
  }, [newNodeLabel, addCustomNode])

  // 新增自定义 L2
  const handleAddL2 = useCallback(async () => {
    if (!newNodeLabel.trim()) return
    const id = await addCustomNode({ parentId: selectedL1, label: newNodeLabel.trim(), icon: '📝' })
    setNewNodeLabel('')
    setAddingL2(false)
    if (id) setSelectedNode(id)
  }, [newNodeLabel, addCustomNode, selectedL1])

  // 检查节点是否为自定义节点
  const isCustomNode = useCallback((nodeId: string): boolean => {
    return profile?.customNodes.some(n => n.id === nodeId) || false
  }, [profile])

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-text-muted">加载中...</span>
      </div>
    )
  }

  const filled = filledCount()

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <span>⚖️</span> 真实与幻想
          </h2>
          <p className="text-sm text-text-muted mt-1">
            按维度声明哪些设定取自真实历史、哪些是架空改造，AI 生成时会严格遵守这些约束。
            <span className="ml-2 text-accent">{filled} 个维度已设定</span>
          </p>
        </div>
        <button
          onClick={handleTogglePreview}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary transition-colors"
        >
          {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showPreview ? '关闭预览' : 'AI 清单预览'}
        </button>
      </div>

      {project.enableMultiWorld && projectWorldGroups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {projectWorldGroups.map(group => (
            <button
              key={group.id}
              onClick={() => group.id && handleSwitchWorld(group.id)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                worldTab === group.id
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-bg-base border-border text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <span className="mr-1">{group.icon || '🌐'}</span>
              {group.name}
            </button>
          ))}
        </div>
      )}

      {/* 三列布局 */}
      <div className="flex gap-0 border border-border rounded-xl overflow-hidden bg-bg-base" style={{ minHeight: 520 }}>
        {/* ── 第一列：L1 大类导航 ─────────────────────────── */}
        <div className="w-48 shrink-0 bg-bg-elevated border-r border-border overflow-y-auto">
          <div className="p-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider px-3 pt-3">
            大类
          </div>
          {l1Nodes.map(l1 => {
            const count = countL1Filled(l1.id)
            const active = l1.id === selectedL1
            return (
              <button
                key={l1.id}
                onClick={() => { setSelectedL1(l1.id); setSelectedNode(null) }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                  active
                    ? 'bg-accent/10 text-accent font-medium border-r-2 border-accent'
                    : 'text-text-secondary hover:bg-bg-hover'
                }`}
              >
                <span className="text-base">{l1.icon}</span>
                <span className="flex-1 truncate">{l1.label}</span>
                {count > 0 && (
                  <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
                    {count}
                  </span>
                )}
              </button>
            )
          })}
          {/* 新增自定义 L1 */}
          {addingL1 ? (
            <div className="px-2 py-1.5 flex gap-1">
              <input
                autoFocus
                value={newNodeLabel}
                onChange={e => setNewNodeLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddL1(); if (e.key === 'Escape') setAddingL1(false) }}
                placeholder="新大类名称"
                className="flex-1 text-xs px-2 py-1 rounded border border-border bg-bg-base text-text-primary"
              />
              <button onClick={handleAddL1} className="text-green-500 hover:text-green-400"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={() => setAddingL1(false)} className="text-text-muted hover:text-text-primary"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button
              onClick={() => { setAddingL1(true); setNewNodeLabel('') }}
              className="w-full text-left px-3 py-2 text-xs text-text-muted hover:text-accent flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> 添加大类
            </button>
          )}
        </div>

        {/* ── 第二列：L2 子类列表 ──────────────────────────── */}
        <div className="w-52 shrink-0 border-r border-border overflow-y-auto">
          <div className="p-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider px-3 pt-3 flex items-center justify-between">
            <span>子类</span>
          </div>
          {/* L1 自身也可编辑（如果有 hints 或是自定义节点） */}
          <button
            onClick={() => setSelectedNode(selectedL1)}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
              selectedNode === selectedL1
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-text-secondary hover:bg-bg-hover'
            }`}
          >
            <span className="text-base">📋</span>
            <span className="flex-1 truncate">总览</span>
            {!isEntryEmpty(profile.entries[selectedL1]) && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </button>
          {l2Nodes.map(l2 => {
            const active = selectedNode === l2.id
            const hasFill = !isEntryEmpty(profile.entries[l2.id])
            return (
              <button
                key={l2.id}
                onClick={() => setSelectedNode(l2.id)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors group ${
                  active
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-text-secondary hover:bg-bg-hover'
                }`}
              >
                <span className="text-base">{l2.icon}</span>
                <span className="flex-1 truncate">{l2.label}</span>
                {hasFill && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                {l2.isCustom && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`确定删除「${l2.label}」及其设定？`)) {
                        deleteCustomNode(l2.id)
                        if (selectedNode === l2.id) setSelectedNode(null)
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </button>
            )
          })}
          {/* 新增自定义 L2 */}
          {addingL2 ? (
            <div className="px-2 py-1.5 flex gap-1">
              <input
                autoFocus
                value={newNodeLabel}
                onChange={e => setNewNodeLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddL2(); if (e.key === 'Escape') setAddingL2(false) }}
                placeholder="新子类名称"
                className="flex-1 text-xs px-2 py-1 rounded border border-border bg-bg-base text-text-primary"
              />
              <button onClick={handleAddL2} className="text-green-500 hover:text-green-400"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={() => setAddingL2(false)} className="text-text-muted hover:text-text-primary"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button
              onClick={() => { setAddingL2(true); setNewNodeLabel('') }}
              className="w-full text-left px-3 py-2 text-xs text-text-muted hover:text-accent flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> 添加子类
            </button>
          )}
        </div>

        {/* ── 第三列：编辑区 ───────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5">
          {selectedNode ? (
            <div className="space-y-5">
              {/* 节点标题 + 删除按钮 */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-text-primary">{currentLabel}</h3>
                <div className="flex items-center gap-2">
                  {isCustomNode(selectedNode) && (
                    <button
                      onClick={() => {
                        if (confirm('确定删除这个自定义节点？')) {
                          deleteCustomNode(selectedNode)
                          setSelectedNode(null)
                        }
                      }}
                      className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> 删除节点
                    </button>
                  )}
                  {!isEntryEmpty(currentEntry) && (
                    <button
                      onClick={() => {
                        if (confirm('确定清空此节点的所有设定？')) deleteEntry(selectedNode)
                      }}
                      className="text-xs text-text-muted hover:text-red-400 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> 清空
                    </button>
                  )}
                </div>
              </div>

              {/* L3 提示标签 */}
              {currentHints.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {currentHints.map(h => (
                    <span key={h} className="text-xs px-2 py-0.5 rounded-full bg-bg-elevated text-text-muted border border-border">
                      {h}
                    </span>
                  ))}
                </div>
              )}

              {/* 📜 取自真实 */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  📜 取自真实（历史考据 / 现实原型）
                </label>
                <textarea
                  value={currentEntry.historicalAnchors}
                  onChange={e => handleFieldChange('historicalAnchors', e.target.value)}
                  placeholder="这个维度中有哪些内容是取自真实历史或现实的？例如：使用唐朝开元年间真实官制三省六部"
                  rows={5}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg-base text-text-primary placeholder:text-text-muted/50 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
                />
              </div>

              {/* ✨ 架空改造 */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  ✨ 架空改造（虚构 / 改编 / 原创设定）
                </label>
                <textarea
                  value={currentEntry.fictionalAdaptations}
                  onChange={e => handleFieldChange('fictionalAdaptations', e.target.value)}
                  placeholder="这个维度中有哪些内容是虚构或改编的？例如：在真实官制基础上增设灵修院，专管修士事务"
                  rows={5}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg-base text-text-primary placeholder:text-text-muted/50 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
                />
              </div>

              {/* ⚖️ 冲突优先级 */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  ⚖️ 当真实与架空冲突时
                </label>
                <div className="flex gap-2">
                  {(Object.entries(CONFLICT_PRIORITY_LABELS) as [ConflictPriority, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => handleFieldChange('priority', value)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        currentEntry.priority === value
                          ? value === 'historical'
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                            : value === 'fictional'
                              ? 'bg-purple-500/20 border-purple-500/40 text-purple-400'
                              : 'bg-accent/20 border-accent/40 text-accent'
                          : 'border-border text-text-muted hover:border-text-muted'
                      }`}
                    >
                      {value === 'historical' ? '📜 ' : value === 'fictional' ? '✨ ' : '⚖️ '}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <span className="text-4xl mb-3">⚖️</span>
              <p className="text-sm">选择左侧的子类开始设定</p>
              <p className="text-xs mt-1">或点击「总览」设定大类级别的规则</p>
            </div>
          )}
        </div>
      </div>

      {/* 全局补充说明 */}
      <div className="border border-border rounded-xl p-4 bg-bg-base">
        <label className="block text-sm font-medium text-text-secondary mb-1.5">
          📝 全局补充说明（对 AI 的额外约束，适用于所有维度）
        </label>
        <textarea
          value={profile.globalNote || ''}
          onChange={e => updateGlobalNote(e.target.value)}
          placeholder="例如：本作以唐代为蓝本但加入仙侠元素，凡是涉及朝堂制度的一律遵循史实，力量体系完全虚构。"
          rows={3}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg-base text-text-primary placeholder:text-text-muted/50 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
        />
      </div>

      {/* 预览面板 */}
      {showPreview && (
        <div className="border border-border rounded-xl p-4 bg-bg-elevated">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-text-secondary">
              AI 清单预览
            </h3>
            <span className="text-xs text-text-muted">
              约 {previewTokens.toLocaleString()} tokens（{previewText.length.toLocaleString()} 字符）
            </span>
          </div>
          {previewText ? (
            <pre className="text-xs text-text-primary/80 whitespace-pre-wrap font-mono bg-bg-base rounded-lg p-3 max-h-96 overflow-y-auto border border-border">
              {previewText}
            </pre>
          ) : (
            <p className="text-sm text-text-muted italic">暂无设定内容。填写上方维度后，这里会显示注入 AI 的结构化清单。</p>
          )}
        </div>
      )}
    </div>
  )
}
