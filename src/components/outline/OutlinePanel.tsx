import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Plus, Trash2, Sparkles, ChevronRight, ChevronDown, Check, X, LayoutList, Layers, Loader2 } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIStream } from '../../hooks/useAIStream'
import { buildVolumeOutlinePrompt, buildChapterOutlinePrompt } from '../../lib/ai/adapters/outline-adapter'
import { assembleContext } from '../../lib/registry/assemble-context'
import {
  parseVolumeOutlineSmart, parseChapterOutlineSmart,
  type ParsedVolume, type ParsedChapter,
} from '../../lib/ai/parse-outline-output'
import { useAIConfigStore } from '../../stores/ai-config'
import { runBatchOutlineGeneration, type BatchOutlineProgress } from '../../lib/ai/batch-outline-runner'
import { adopt } from '../../lib/registry/adopt'
import type { AssembleContextResult } from '../../lib/registry/types'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import PanelLayout from '../shared/PanelLayout'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'
import { CInput } from '../shared/CompositionInput'
import type { Project, StoryStructure } from '../../lib/types'
import { STORY_STRUCTURES } from '../../lib/types/outline'

interface Props {
  project: Project
  onOpenChapter?: (nodeId: number) => void
}

export default function OutlinePanel({ project, onOpenChapter }: Props) {
  const { nodes, loadAll, addNode, updateNode, deleteNode } = useOutlineStore()
  const { storyCore } = useWorldviewStore()
  const worldGroups = useWorldGroupStore(s => s.groups)
  const aiConfig = useAIConfigStore(s => s.config)
  const [selectedVolId, setSelectedVolId] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [activeModuleKey, setActiveModuleKey] = useState<'outline.volume' | 'outline.chapter'>('outline.volume')

  // 采纳预览
  const [previewVolumes, setPreviewVolumes] = useState<ParsedVolume[] | null>(null)
  const [previewChapters, setPreviewChapters] = useState<ParsedChapter[] | null>(null)

  // D1: 批量生成状态
  const [batchProgress, setBatchProgress] = useState<BatchOutlineProgress | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)
  const batchAbortRef = useRef<AbortController | null>(null)

  const addOutlineNodeByAdopt = useCallback(async (node: {
    parentId: number | null
    type: 'volume' | 'chapter'
    title: string
    summary: string
    order: number
  }): Promise<{ id: number | null; reason?: string }> => {
    // FB-10 修复:返回 skip 原因,供调用方反馈(此前 adopt 命中去重/必填/FK 失败时
    // 进 skipped 静默不写、不报错,导致"点采纳却没写入也没提示")
    const result = await adopt({
      projectId: project.id!,
      target: 'outlineNodes',
      mode: 'add',
      data: node,
    })
    const id = result.written[0]?.id ?? null
    return { id, reason: id == null ? (result.skipped[0]?.reason ?? '未知原因') : undefined }
  }, [project.id])
  const [batchResult, setBatchResult] = useState<Map<number, ParsedChapter[]> | null>(null)

  const ai = useAIStream()

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  // 用 `== null`(宽松)而非 `=== null`:既匹配新写入的 parentId:null,也修复存量坏数据
  // (FB-10b 修复前采纳的顶层卷 parentId 被存成 undefined,严格相等会把它们永远藏起)。
  const volumes = nodes.filter(n => n.type === 'volume' && n.parentId == null).sort((a, b) => a.order - b.order)
  const selectedVol = volumes.find(v => v.id === selectedVolId) || null

  // 故事块和章节层级
  const selectedVolBlocks = useMemo(() => {
    if (!selectedVol) return []
    return nodes.filter(n => n.parentId === selectedVol.id && n.type === 'storyBlock').sort((a, b) => a.order - b.order)
  }, [nodes, selectedVol])

  // 直接挂在卷下的章节（无故事块归属）
  const selectedVolChapters = useMemo(() => {
    if (!selectedVol) return []
    return nodes.filter(n => n.parentId === selectedVol.id && n.type === 'chapter').sort((a, b) => a.order - b.order)
  }, [nodes, selectedVol])

  // 是否使用故事块模式
  const hasBlocks = selectedVolBlocks.length > 0

  // 自动选中第一个卷
  useEffect(() => {
    if (selectedVolId === null && volumes.length > 0) {
      setSelectedVolId(volumes[0].id!)
    }
  }, [volumes, selectedVolId])

  const handleAddVolume = async () => {
    const id = await addNode({
      projectId: project.id!, parentId: null, type: 'volume',
      title: `第${volumes.length + 1}卷`, summary: '', order: volumes.length,
    })
    setSelectedVolId(id)
  }

  const handleAddChapter = async (parentId?: number) => {
    const pid = parentId ?? selectedVol?.id
    if (!pid) return
    const siblings = nodes.filter(n => n.parentId === pid && n.type === 'chapter')
    await addNode({
      projectId: project.id!, parentId: pid, type: 'chapter',
      title: `第${siblings.length + 1}章`, summary: '', order: siblings.length,
    })
  }

  const handleAddStructure = async (structure: StoryStructure) => {
    if (!selectedVol) return
    const def = STORY_STRUCTURES[structure]
    if (structure === 'custom') {
      await addNode({
        projectId: project.id!, parentId: selectedVol.id!, type: 'storyBlock',
        title: '自定义故事块', summary: '', order: selectedVolBlocks.length,
      })
    } else {
      for (let i = 0; i < def.blocks.length; i++) {
        await addNode({
          projectId: project.id!, parentId: selectedVol.id!, type: 'storyBlock',
          title: def.blocks[i], summary: '', order: selectedVolBlocks.length + i,
        })
      }
    }
  }

  const buildOpts = () => ({
    parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
    overrides: (systemOverride != null || userOverride != null) ? {
      systemPrompt: systemOverride ?? undefined,
      userPromptTemplate: userOverride ?? undefined,
    } : undefined,
  })

  const buildOutlineAssembledContext = useCallback(async (worldGroupId: number | null, outlineNodeId?: number | null) => {
    return await assembleContext({
      projectId: project.id!,
      worldGroupId,
      outlineNodeId: outlineNodeId ?? null,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: [
        'worldview',
        'storyCore',
        'powerSystem',
        'codex',
        'characters',
        'creativeRules',
        'worldRules',
        'historical',
        'locations',
      ],
    })
  }, [project.id, aiConfig.provider, aiConfig.model])

  const contextPart = (assembled: AssembleContextResult, key: string): string => {
    const idx = assembled.included.indexOf(key)
    return idx >= 0 ? assembled.segments[idx]?.content ?? '' : ''
  }

  // ── AI 生成 ──

  const handleAIVolumes = async () => {
    setActiveModuleKey('outline.volume')
    setPreviewVolumes(null)
    setPreviewChapters(null)
    const assembled = await buildOutlineAssembledContext(null)
    const worldCtx = assembled.text
    const scCtx = storyCore ? `主题：${storyCore.theme}\n冲突：${storyCore.centralConflict}\n主线：${storyCore.mainPlot || storyCore.storyLines || ''}${storyCore.subPlots ? `\n复线：${storyCore.subPlots}` : ''}` : ''
    const charCtx = contextPart(assembled, 'characters')
    const rulesCtx = contextPart(assembled, 'worldRules')
    const messages = buildVolumeOutlinePrompt(project.name, project.genre, worldCtx, scCtx, project.targetWordCount || 500000, hint, buildOpts(), charCtx, rulesCtx)
    ai.start(messages, undefined, { category: 'outline.volume', projectId: project.id! })
  }

  const handleAIChapters = async () => {
    if (!selectedVol) return
    setActiveModuleKey('outline.chapter')
    setPreviewVolumes(null)
    setPreviewChapters(null)
    const assembled = await buildOutlineAssembledContext(selectedVol.worldGroupId ?? null, selectedVol.id)
    const worldCtx = assembled.text
    const volIdx = volumes.indexOf(selectedVol)
    const prevSummary = volIdx > 0 ? volumes[volIdx - 1].summary : ''
    const charCtx = contextPart(assembled, 'characters')
    const rulesCtx = contextPart(assembled, 'worldRules')
    const messages = buildChapterOutlinePrompt(selectedVol.title, selectedVol.summary, worldCtx, prevSummary, hint, buildOpts(), charCtx, rulesCtx)
    ai.start(messages, undefined, { category: 'outline.chapter', projectId: project.id! })
  }

  // ── D1: 批量生成 ──

  const handleBatchGenerate = useCallback(async () => {
    if (volumes.length === 0) return
    setBatchRunning(true)
    setBatchResult(null)
    setBatchProgress(null)

    const controller = new AbortController()
    batchAbortRef.current = controller

    const assembled = await buildOutlineAssembledContext(null)
    const worldCtx = assembled.text
    const charCtx = contextPart(assembled, 'characters')
    const rulesCtx = contextPart(assembled, 'worldRules')

    try {
      const result = await runBatchOutlineGeneration({
        volumes,
        worldContext: worldCtx,
        // 多世界：逐卷用本卷所属世界的上下文
        worldContextResolver: project.enableMultiWorld
          ? async (volId) => {
            const vol = nodes.find(n => n.id === volId)
            const resolved = await buildOutlineAssembledContext(vol?.worldGroupId ?? null, volId)
            return resolved.text
          }
          : undefined,
        worldRulesContextResolver: project.enableMultiWorld
          ? async (volId) => {
            const vol = nodes.find(n => n.id === volId)
            const resolved = await buildOutlineAssembledContext(vol?.worldGroupId ?? null, volId)
            return contextPart(resolved, 'worldRules')
          }
          : undefined,
        userHint: hint || undefined,
        characterContext: charCtx,
        worldRulesContext: rulesCtx,
        signal: controller.signal,
        onProgress: setBatchProgress,
      })
      if (!result.cancelled) {
        setBatchResult(result.chaptersByVolume)
      }
    } catch (err) {
      console.error('[BatchOutline] 失败:', err)
    } finally {
      setBatchRunning(false)
      batchAbortRef.current = null
    }
  }, [volumes, nodes, project.enableMultiWorld, hint, buildOutlineAssembledContext])

  const handleBatchCancel = useCallback(() => {
    batchAbortRef.current?.abort()
    batchAbortRef.current = null
    setBatchRunning(false)
  }, [])

  const handleBatchConfirm = useCallback(async () => {
    if (!batchResult) return
    try {
      for (const [volId, chapters] of batchResult) {
        const existingCount = nodes.filter(n => n.parentId === volId && n.type === 'chapter').length
        for (let i = 0; i < chapters.length; i++) {
          await addOutlineNodeByAdopt({
            parentId: volId, type: 'chapter',
            title: chapters[i].title, summary: chapters[i].summary,
            order: existingCount + i,
          })
        }
      }
    } catch (err) {
      console.error('[Outline] 批量写入章节失败:', err)
      alert(`批量写入章节时出错：${err instanceof Error ? err.message : '未知错误'}。\n请查看控制台获取详情。`)
      return
    }
    await loadAll(project.id!)
    setBatchResult(null)
    setBatchProgress(null)
  }, [batchResult, nodes, addOutlineNodeByAdopt, loadAll, project.id])

  // ── 采纳预览 + 确认 ──

  const [restructuring, setRestructuring] = useState(false)
  const handlePreviewAccept = async (text: string) => {
    setRestructuring(true)
    try {
      if (activeModuleKey === 'outline.volume') {
        const parsed = await parseVolumeOutlineSmart(text, aiConfig)
        if (parsed.length === 0) {
          alert('未能从 AI 输出中解析出卷级大纲，请检查输出内容或重试。')
          return
        }
        setPreviewVolumes(parsed)
      } else {
        const parsed = await parseChapterOutlineSmart(text, aiConfig)
        if (parsed.length === 0) {
          alert('未能从 AI 输出中解析出章节大纲，请检查输出内容或重试。')
          return
        }
        setPreviewChapters(parsed)
      }
    } finally {
      setRestructuring(false)
    }
  }

  const handleConfirmVolumes = async () => {
    if (!previewVolumes) return
    ai.reset()
    const existingCount = volumes.length
    let firstId: number | null = null
    let written = 0
    const skipReasons = new Set<string>()
    try {
      for (let i = 0; i < previewVolumes.length; i++) {
        const r = await addOutlineNodeByAdopt({
          parentId: null, type: 'volume',
          title: previewVolumes[i].title, summary: previewVolumes[i].summary,
          order: existingCount + i,
        })
        if (r.id != null) { written++; if (firstId == null) firstId = r.id }
        else if (r.reason) skipReasons.add(r.reason)
      }
    } catch (err) {
      console.error('[Outline] 写入卷失败:', err)
      alert(`写入卷时出错：${err instanceof Error ? err.message : '未知错误'}。\n请查看控制台获取详情。`)
      return
    }
    await loadAll(project.id!)
    setPreviewVolumes(null)
    if (firstId) setSelectedVolId(firstId)
    // FB-10:不再静默——全跳过/部分跳过都明确告知用户原因
    if (written === 0) {
      alert(`未写入任何卷。原因:${[...skipReasons].join('；') || '与已有卷标题重复(已跳过)'}。\n若想替换/更新同名卷,请先删除同名卷再采纳。`)
    } else if (written < previewVolumes.length) {
      alert(`已写入 ${written} 个卷,另有 ${previewVolumes.length - written} 个被跳过(${[...skipReasons].join('；') || '标题重复'})。`)
    }
  }

  const handleConfirmChapters = async () => {
    if (!previewChapters || !selectedVol) return
    ai.reset()
    const existingCount = selectedVolChapters.length
    let written = 0
    const skipReasons = new Set<string>()
    try {
      for (let i = 0; i < previewChapters.length; i++) {
        const r = await addOutlineNodeByAdopt({
          parentId: selectedVol.id!, type: 'chapter',
          title: previewChapters[i].title, summary: previewChapters[i].summary,
          order: existingCount + i,
        })
        if (r.id != null) written++
        else if (r.reason) skipReasons.add(r.reason)
      }
    } catch (err) {
      console.error('[Outline] 写入章节失败:', err)
      alert(`写入章节时出错：${err instanceof Error ? err.message : '未知错误'}。\n请查看控制台获取详情。`)
      return
    }
    await loadAll(project.id!)
    setPreviewChapters(null)
    if (written === 0) {
      alert(`未写入任何章节。原因:${[...skipReasons].join('；') || '与本卷已有章节标题重复(已跳过)'}。`)
    } else if (written < previewChapters.length) {
      alert(`已写入 ${written} 章,另有 ${previewChapters.length - written} 章被跳过(${[...skipReasons].join('；') || '标题重复'})。`)
    }
  }

  const handleCancelPreview = () => {
    setPreviewVolumes(null)
    setPreviewChapters(null)
  }

  // ── 侧栏：卷列表 ──

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* 操作栏 */}
      <div className="p-2 space-y-1.5">
        <button onClick={handleAddVolume}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-elevated text-text-secondary rounded-md hover:text-text-primary border border-border transition-colors">
          <Plus className="w-3.5 h-3.5" /> 添加卷
        </button>
        <button onClick={handleAIVolumes} disabled={ai.isStreaming || batchRunning}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors">
          <Sparkles className="w-3.5 h-3.5" /> AI 生成卷级大纲
        </button>
        {volumes.length >= 2 && (
          <button onClick={handleBatchGenerate} disabled={ai.isStreaming || batchRunning}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-elevated text-accent rounded-md hover:bg-accent/10 border border-accent/30 disabled:opacity-50 transition-colors">
            <Layers className="w-3.5 h-3.5" /> 批量生成所有章节
          </button>
        )}
      </div>

      {/* 批量生成进度 */}
      {(batchRunning || batchResult) && (
        <div className="px-2 pb-2">
          <div className="bg-bg-surface border border-border rounded-lg p-2 space-y-1.5">
            {batchRunning && batchProgress && (
              <>
                <div className="flex items-center gap-1.5 text-xs text-accent">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{batchProgress.completedVolumes}/{batchProgress.totalVolumes} 卷</span>
                </div>
                <div className="w-full bg-border rounded-full h-1.5">
                  <div
                    className="bg-accent h-1.5 rounded-full transition-all"
                    style={{ width: `${(batchProgress.completedVolumes / batchProgress.totalVolumes) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-text-muted truncate">{batchProgress.stage}</p>
                <button onClick={handleBatchCancel}
                  className="w-full px-2 py-1 text-[10px] text-error border border-error/30 rounded hover:bg-error/10 transition-colors">
                  取消
                </button>
              </>
            )}
            {!batchRunning && batchResult && (
              <>
                <p className="text-xs text-success">
                  批量生成完成：{Array.from(batchResult.values()).reduce((s, chs) => s + chs.length, 0)} 章
                </p>
                <div className="flex gap-1">
                  <button onClick={handleBatchConfirm}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] bg-accent text-white rounded hover:bg-accent-hover transition-colors">
                    <Check className="w-3 h-3" /> 全部写入
                  </button>
                  <button onClick={() => { setBatchResult(null); setBatchProgress(null) }}
                    className="px-2 py-1 text-[10px] text-text-muted border border-border rounded hover:text-text-primary transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 卷列表 */}
      <div className="flex-1 overflow-y-auto px-1">
        {volumes.map(vol => {
          const childCount = nodes.filter(n => n.parentId === vol.id).length
          const active = selectedVolId === vol.id
          return (
            <button
              key={vol.id}
              onClick={() => setSelectedVolId(vol.id!)}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-all mb-0.5 ${
                active
                  ? 'bg-accent/8 border-l-2 border-accent'
                  : 'hover:bg-bg-hover border-l-2 border-transparent'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium truncate ${active ? 'text-accent' : 'text-text-primary'}`}>
                  {project.enableMultiWorld && vol.worldGroupId != null && (
                    <span className="mr-1">{worldGroups.find(g => g.id === vol.worldGroupId)?.icon || '🌐'}</span>
                  )}
                  {vol.title}
                </p>
                <p className="text-[10px] text-text-muted">
                  {childCount} 章{vol.summary ? ` · ${vol.summary.slice(0, 20)}...` : ''}
                </p>
              </div>
            </button>
          )
        })}
        {volumes.length === 0 && (
          <div className="text-center py-8 text-text-muted text-xs">
            还没有卷
          </div>
        )}
      </div>
    </div>
  )

  // ── 右侧编辑区 ──

  return (
    <PanelLayout
      sidebar={sidebarContent}
      sidebarTitle="📖 大纲"
      defaultWidth={220}
      minWidth={160}
      maxWidth={360}
      className="h-[calc(100vh-8rem)]"
    >
      <div className="p-4 space-y-4">
        {/* 调参 + 提示 */}
        <CInput value={hint} onChange={e => setHint(e.target.value)} placeholder="给 AI 的补充说明（可选）"
          className="w-full px-3 py-2 bg-bg-surface border border-border rounded-md text-text-primary text-sm focus:outline-none focus:border-accent" />

        <PromptRunPanel
          moduleKey={activeModuleKey}
          parameterValues={parameterValues}
          onParamChange={setParameterValues}
          systemOverride={systemOverride}
          onSystemOverrideChange={setSystemOverride}
          userOverride={userOverride}
          onUserOverrideChange={setUserOverride}
        />

        {/* AI 输出（就地显示） */}
        {(ai.output || ai.isStreaming || ai.error) && (
          <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error} tokenUsage={ai.tokenUsage}
            onStop={ai.stop}
            onAccept={handlePreviewAccept}
            onRetry={activeModuleKey === 'outline.volume' ? handleAIVolumes : handleAIChapters}
            moduleKey={activeModuleKey} />
        )}

        {restructuring && (
          <div className="flex items-center gap-2 text-xs text-accent">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 正在用 AI 整理大纲结构…
          </div>
        )}

        {/* 采纳预览：卷 */}
        {previewVolumes && (
          <PreviewPanel
            label={`将创建 ${previewVolumes.length} 个卷`}
            items={previewVolumes}
            onConfirm={handleConfirmVolumes}
            onCancel={handleCancelPreview}
          />
        )}

        {/* 采纳预览：章节 */}
        {previewChapters && (
          <PreviewPanel
            label={`将在「${selectedVol?.title}」下创建 ${previewChapters.length} 个章节`}
            items={previewChapters}
            onConfirm={handleConfirmChapters}
            onCancel={handleCancelPreview}
          />
        )}

        {/* ── 选中卷的详情编辑 ── */}
        {selectedVol ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <CInput
                value={selectedVol.title}
                onChange={e => updateNode(selectedVol.id!, { title: e.target.value })}
                className="text-lg font-bold bg-transparent text-text-primary outline-none flex-1"
              />
              <div className="flex items-center gap-1.5">
                <button onClick={handleAIChapters} disabled={ai.isStreaming}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors">
                  <Sparkles className="w-3.5 h-3.5" /> AI 生成章节
                </button>
                <button onClick={() => handleAddChapter()}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-bg-elevated text-text-secondary rounded-md hover:text-text-primary border border-border transition-colors">
                  <Plus className="w-3.5 h-3.5" /> 添加章节
                </button>
                <button onClick={() => {
                  if (confirm(`确定删除「${selectedVol.title}」及其所有章节？`)) {
                    deleteNode(selectedVol.id!)
                    setSelectedVolId(null)
                  }
                }} className="p-1.5 text-text-muted hover:text-error rounded transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 多世界：本卷所属世界 */}
            {project.enableMultiWorld && worldGroups.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-muted">本卷所属世界</label>
                <select
                  value={selectedVol.worldGroupId ?? ''}
                  onChange={e => updateNode(selectedVol.id!, { worldGroupId: e.target.value ? Number(e.target.value) : null })}
                  className="px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent cursor-pointer"
                >
                  <option value="">未指定</option>
                  {worldGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.icon || '🌐'} {g.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 卷摘要 */}
            <div>
              <label className="text-xs text-text-muted mb-1 block">卷情节摘要</label>
              <AutoResizeTextarea
                value={selectedVol.summary}
                onChange={e => updateNode(selectedVol.id!, { summary: e.target.value })}
                placeholder="描述本卷的核心冲突、关键转折和主要情节..."
                minRows={3}
                maxRows={10}
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-md text-text-secondary text-sm focus:outline-none focus:border-accent"
              />
            </div>

            {/* 故事结构 + 章节列表 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-text-primary">
                  {hasBlocks ? '故事结构' : '章节列表'}
                  <span className="text-text-muted font-normal ml-1">（{selectedVolChapters.length + nodes.filter(n => selectedVolBlocks.some(b => b.id === n.parentId) && n.type === 'chapter').length} 章）</span>
                </h3>
                {!hasBlocks && (
                  <StructureMenu onSelect={handleAddStructure} />
                )}
              </div>

              {/* 故事块模式 */}
              {hasBlocks && (
                <div className="space-y-3 mb-3">
                  {selectedVolBlocks.map(block => {
                    const blockChapters = nodes.filter(n => n.parentId === block.id && n.type === 'chapter').sort((a, b) => a.order - b.order)
                    return (
                      <StoryBlockSection
                        key={block.id}
                        block={block}
                        chapters={blockChapters}
                        onUpdateNode={updateNode}
                        onDeleteNode={deleteNode}
                        onAddChapter={() => handleAddChapter(block.id!)}
                        onOpenChapter={onOpenChapter}
                      />
                    )
                  })}
                  <button onClick={() => handleAddStructure('custom')}
                    className="w-full py-2 text-xs text-text-muted border border-dashed border-border rounded-lg hover:text-accent hover:border-accent/50 transition-colors">
                    + 添加故事块
                  </button>
                </div>
              )}

              {/* 无故事块：直接章节列表 */}
              {!hasBlocks && (
                selectedVolChapters.length === 0 ? (
                  <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded-lg">
                    还没有章节，点击「AI 生成章节」或「添加章节」
                  </div>
                ) : (
                  <div className="space-y-1">
                    {selectedVolChapters.map((ch, idx) => (
                      <ChapterRow key={ch.id} ch={ch} idx={idx} onUpdate={updateNode} onDelete={deleteNode} onOpen={onOpenChapter} />
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
            <div className="text-4xl opacity-20">📖</div>
            <p className="text-sm">选择左侧的卷开始编辑，或点击「AI 生成卷级大纲」</p>
          </div>
        )}
      </div>
    </PanelLayout>
  )
}

// ── 预览面板 ──

function PreviewPanel({
  label, items, onConfirm, onCancel,
}: {
  label: string
  items: { title: string; summary: string }[]
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="border border-accent/50 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-accent/10">
        <span className="text-sm font-medium text-accent">{label}</span>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded transition-colors">
            <X className="w-3 h-3" /> 取消
          </button>
          <button onClick={onConfirm}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors">
            <Check className="w-3 h-3" /> 确认写入
          </button>
        </div>
      </div>
      <div className="divide-y divide-border max-h-60 overflow-y-auto">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-2 bg-bg-surface">
            <div className="text-sm font-medium text-text-primary">{item.title}</div>
            {item.summary && (
              <div className="text-xs text-text-muted mt-1 line-clamp-2">{item.summary}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 章节行 ──

function ChapterRow({ ch, idx, onUpdate, onDelete, onOpen }: {
  ch: { id?: number; title: string; summary: string }
  idx: number
  onUpdate: (id: number, patch: Record<string, string>) => void
  onDelete: (id: number) => void
  onOpen?: (id: number) => void
}) {
  // FB-3:章节摘要(章节大纲)由单行 input 升级为多行自增 textarea —— 单行下改 1-2 句大纲很难受
  //       (横向滚、看不全、改中间费劲)。本地草稿 + 失焦保存(IME 安全:组合输入结束后才 onBlur 写库)。
  const [summaryDraft, setSummaryDraft] = useState(ch.summary || '')
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setSummaryDraft(ch.summary || '') }, [ch.summary])
  useEffect(() => {
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px` }
  }, [summaryDraft])

  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-bg-surface border border-border rounded-md hover:border-accent/30 group transition-colors">
      <span className="text-xs text-text-muted mt-1.5 shrink-0 w-5 text-right">{idx + 1}</span>
      <div className="flex-1 min-w-0">
        <CInput
          value={ch.title}
          onChange={e => onUpdate(ch.id!, { title: e.target.value })}
          className="w-full bg-transparent text-text-primary text-sm font-medium outline-none"
        />
        <textarea
          ref={taRef}
          value={summaryDraft}
          onChange={e => setSummaryDraft(e.target.value)}
          onBlur={() => { if (ch.id != null && summaryDraft !== (ch.summary || '')) onUpdate(ch.id, { summary: summaryDraft }) }}
          rows={1}
          placeholder="章节摘要（可编辑，失焦自动保存）"
          className="w-full bg-transparent text-text-muted text-xs outline-none mt-0.5 resize-none overflow-hidden leading-relaxed"
        />
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1">
        {onOpen && (
          <button onClick={() => onOpen(ch.id!)} className="p-1 text-text-muted hover:text-accent rounded" title="编辑章节">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={() => onDelete(ch.id!)} className="p-1 text-text-muted hover:text-error rounded">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── 故事块区域 ──

function StoryBlockSection({ block, chapters, onUpdateNode, onDeleteNode, onAddChapter, onOpenChapter }: {
  block: { id?: number; title: string; summary: string }
  chapters: { id?: number; title: string; summary: string }[]
  onUpdateNode: (id: number, patch: Record<string, string>) => void
  onDeleteNode: (id: number) => void
  onAddChapter: () => void
  onOpenChapter?: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* 故事块头 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated">
        <button onClick={() => setExpanded(!expanded)} className="text-text-muted hover:text-text-primary">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <LayoutList className="w-3.5 h-3.5 text-accent/60" />
        <CInput
          value={block.title}
          onChange={e => onUpdateNode(block.id!, { title: e.target.value })}
          className="flex-1 bg-transparent text-text-primary text-sm font-medium outline-none"
        />
        <span className="text-[10px] text-text-muted">{chapters.length} 章</span>
        <button onClick={onAddChapter} className="p-1 text-text-muted hover:text-accent rounded" title="添加章节">
          <Plus className="w-3 h-3" />
        </button>
        <button onClick={() => {
          if (confirm(`删除故事块「${block.title}」？其下章节也会被删除。`))
            onDeleteNode(block.id!)
        }} className="p-1 text-text-muted hover:text-error rounded">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      {/* 故事块摘要 */}
      <CInput
        value={block.summary}
        onChange={e => onUpdateNode(block.id!, { summary: e.target.value })}
        placeholder="故事块描述..."
        className="w-full px-3 py-1.5 bg-bg-surface text-text-muted text-xs border-b border-border focus:outline-none"
      />
      {/* 章节列表 */}
      {expanded && (
        <div className="p-2 space-y-1">
          {chapters.length === 0 ? (
            <div className="text-center py-3 text-text-muted text-xs">
              点击 + 添加章节
            </div>
          ) : (
            chapters.map((ch, idx) => (
              <ChapterRow key={ch.id} ch={ch} idx={idx} onUpdate={onUpdateNode} onDelete={onDeleteNode} onOpen={onOpenChapter} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── 故事结构选择菜单 ──

function StructureMenu({ onSelect }: { onSelect: (s: StoryStructure) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-accent border border-border rounded-md transition-colors">
        <LayoutList className="w-3 h-3" /> 添加故事结构
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-bg-elevated border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
            {(Object.entries(STORY_STRUCTURES) as [StoryStructure, { label: string; blocks: string[] }][]).map(([key, def]) => (
              <button key={key} onClick={() => { onSelect(key); setOpen(false) }}
                className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-hover transition-colors">
                <span className="font-medium">{def.label}</span>
                {def.blocks.length > 0 && (
                  <span className="text-text-muted ml-1">（{def.blocks.length} 块）</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
