/**
 * Phase 32.4 — 世界规则面板（真实与幻想）
 *
 * 三列布局：L1 大类导航 → L2 子类列表 → 编辑区（双文本框 + 优先级）
 * 底部：规则预览 + Token 估算
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useWorldRulesStore } from '../../stores/world-rules'
import { useWorldGroupStore } from '../../stores/world-group'
import {
  WORLD_RULE_TREE,
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
import { useDialog } from '../shared/Dialog'
import WorldRuleEntryEditor from './WorldRuleEntryEditor'
import WorldRulesNavigation from './WorldRulesNavigation'
import type { WorldRuleNavigationNode } from './WorldRulesNavigation'

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
  const result: WorldRuleNavigationNode[] = []
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
  const dialog = useDialog()
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
    const nodes: WorldRuleNavigationNode[] = []
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

  const handleDeleteCustomNode = useCallback(async (nodeId: string, label: string) => {
    const ok = await dialog.confirm({
      title: `删除「${label}」及其设定？`,
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    deleteCustomNode(nodeId)
    if (selectedNode === nodeId) setSelectedNode(null)
  }, [deleteCustomNode, dialog, selectedNode])

  const handleClearEntry = useCallback(async (nodeId: string) => {
    const ok = await dialog.confirm({
      title: '清空此节点的所有设定？',
      message: '此操作不可恢复。',
      confirmText: '清空',
      tone: 'danger',
    })
    if (ok) deleteEntry(nodeId)
  }, [deleteEntry, dialog])

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
  const handleAddL1 = useCallback(async (label: string) => {
    await addCustomNode({ parentId: null, label, icon: '🔖' })
  }, [addCustomNode])

  // 新增自定义 L2
  const handleAddL2 = useCallback(async (label: string) => {
    const id = await addCustomNode({ parentId: selectedL1, label, icon: '📝' })
    if (id) setSelectedNode(id)
  }, [addCustomNode, selectedL1])

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
        <WorldRulesNavigation
          l1Nodes={l1Nodes}
          l2Nodes={l2Nodes}
          entries={profile.entries}
          selectedL1={selectedL1}
          selectedNode={selectedNode}
          countL1Filled={countL1Filled}
          onSelectL1={l1Id => { setSelectedL1(l1Id); setSelectedNode(null) }}
          onSelectNode={setSelectedNode}
          onAddL1={handleAddL1}
          onAddL2={handleAddL2}
          onDeleteCustomNode={(nodeId, label) => { void handleDeleteCustomNode(nodeId, label) }}
        />
        <WorldRuleEntryEditor
          selectedNode={selectedNode}
          currentLabel={currentLabel}
          currentHints={currentHints}
          currentEntry={currentEntry}
          isCustomNode={selectedNode ? isCustomNode(selectedNode) : false}
          onFieldChange={(field, value) => { void handleFieldChange(field, value) }}
          onDeleteNode={() => { if (selectedNode) void handleDeleteCustomNode(selectedNode, currentLabel) }}
          onClearEntry={() => { if (selectedNode) void handleClearEntry(selectedNode) }}
        />
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
