import { useState, useEffect, useMemo, useCallback } from 'react'
import { useOutlineStore } from '../../stores/outline'
import { useWorldGroupStore } from '../../stores/world-group'
import { useStoryArcStore } from '../../stores/story-arc'  // 添加导入
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { assembleContext } from '../../lib/registry/assemble-context'
import {
  parseVolumeOutlineSmart, parseChapterOutlineSmart,
  type ParsedVolume, type ParsedChapter,
} from '../../lib/ai/parse-outline-output'
import { useAIConfigStore } from '../../stores/ai-config'
import { getTopLevelVolumes } from '../../lib/outline/selectors'
import { normalizeOutlineNode } from '../../lib/outline/normalize'
import { adoptGeneratedOutlineItems, adoptGeneratedOutlineSummary } from '../../lib/outline/adopt-generation'
import PromptRunPanel from '../shared/PromptRunPanel'
import PanelLayout from '../shared/PanelLayout'
import { CInput } from '../shared/CompositionInput'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'
import type { Project, StoryStructure } from '../../lib/types'
import { STORY_STRUCTURES } from '../../lib/types/outline'
import OutlineVolumeSidebar from './OutlineVolumeSidebar'
import OutlineVolumeDetail from './OutlineVolumeDetail'
import OutlineGenerationRequestPanel from './OutlineGenerationRequestPanel'
import OutlineGenerationResultPanel from './OutlineGenerationResultPanel'
import ChunkedGenerationPanel from './ChunkedGenerationPanel'
import ChapterReviewDialog from './ChapterReviewDialog'
import { useChunkedGeneration } from './useChunkedGeneration'
import { useOutlineBatchGeneration } from './useOutlineBatchGeneration'
import { useOutlineGenerationController } from './useOutlineGenerationController'
import { useOutlineChapterCountEstimate } from './useOutlineChapterCountEstimate'
import { useOutlineChapterDrag } from './useOutlineChapterDrag'
import { decodeGenerationOperation } from '../../lib/outline/generation-request'
import type { GenerationMode, ChunkedGenerationConfig } from '../../lib/outline/generation-modes'
import { reviewChapterOutlines, rewriteChapterOutline, toReviewChapters, type ChapterReviewResult, type ChapterReviewIssue, type RewriteResult } from '../../lib/outline/chapter-reviewer'

interface Props {
  project: Project
  onOpenChapter?: (nodeId: number) => void
}

export default function OutlinePanel({ project, onOpenChapter }: Props) {
  const dialog = useDialog()
  const toast = useToast()
  const { nodes, loadAll, addNode, updateNode, deleteNode, reorderNodes, insertNodeAt, moveNodeToParent } = useOutlineStore()
  const worldGroups = useWorldGroupStore(s => s.groups)
  const aiConfig = useAIConfigStore(s => s.config)
  const storyArcStore = useStoryArcStore(s => s.buildStoryArcContext)  // 添加 useStoryArcStore 调用
  const [selectedVolId, setSelectedVolId] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [promptPanelOpen, setPromptPanelOpen] = useState(false)
  const { activeChapterDrag, beginChapterDrag, clearActiveChapterDrag, getActiveChapterDrag } = useOutlineChapterDrag()

  // 审校对话框
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)

  // 采纳预览
  const [previewVolumes, setPreviewVolumes] = useState<ParsedVolume[] | null>(null)
  const [previewChapters, setPreviewChapters] = useState<ParsedChapter[] | null>(null)
  const [previewTargetId, setPreviewTargetId] = useState<number | null>(null)
  const clearGenerationPreview = useCallback(() => {
    setPreviewVolumes(null)
    setPreviewChapters(null)
    setPreviewTargetId(null)
  }, [])

  const ai = useAIStream(createAISessionKey(project.id!, 'outline.generate'))

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const normalizedNodes = useMemo(() => nodes.map(normalizeOutlineNode), [nodes])
  const volumes = getTopLevelVolumes(normalizedNodes)
  const selectedVol = volumes.find(v => v.id === selectedVolId) || null

  useOutlineChapterCountEstimate({
    selectedVolumeId: selectedVolId,
    selectedVolumeExists: selectedVol != null,
    targetWordCount: project.targetWordCount,
    volumeCount: volumes.length,
    parameterValues,
    setParameterValues,
  })

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

  // FB-2 任意位置插入：在某章之后插入一章（同 parentId 内重排 order）
  const handleInsertChapterAfter = async (afterChapterId: number, parentId: number) => {
    const siblingIds = nodes
      .filter(n => n.parentId === parentId && n.type === 'chapter')
      .sort((a, b) => a.order - b.order)
      .map(n => n.id!)
    const index = siblingIds.indexOf(afterChapterId) + 1
    await insertNodeAt(
      { projectId: project.id!, parentId, type: 'chapter', title: '新章节', summary: '', order: 0 },
      siblingIds,
      index,
    )
  }

  const findWorldGroupForParent = (parentId: number | null): number | null => {
    if (parentId == null) return null
    const parent = normalizedNodes.find(node => node.id === parentId)
    if (!parent) return null
    if (parent.type === 'volume') return parent.worldGroupId ?? null
    if (parent.type === 'storyBlock') {
      const volume = normalizedNodes.find(node => node.id === parent.parentId && node.type === 'volume')
      return volume?.worldGroupId ?? null
    }
    return null
  }

  const canMoveChapterToParent = (chapterId: number, targetParentId: number | null): boolean => {
    if (!project.enableMultiWorld) return true
    const chapter = normalizedNodes.find(node => node.id === chapterId && node.type === 'chapter')
    if (!chapter) return false
    return findWorldGroupForParent(chapter.parentId) === findWorldGroupForParent(targetParentId)
  }

  const handleMoveChapter = async (chapterId: number, targetParentId: number, index: number) => {
    if (!canMoveChapterToParent(chapterId, targetParentId)) {
      toast.error('不能把章节拖到其它世界组的卷下。')
      return
    }
    try {
      await moveNodeToParent(chapterId, targetParentId, index)
    } catch (error) {
      console.error('[OutlinePanel] Failed to move chapter', error)
      toast.error('章节移动失败，请重试。')
    }
  }

  const handleAddStructure = async (structure: StoryStructure) => {
    if (!selectedVol) return
    const def = STORY_STRUCTURES[structure]
    const currentBlocks = normalizedNodes
      .filter(node => node.parentId === selectedVol.id && node.type === 'storyBlock')
      .sort((a, b) => a.order - b.order)
    if (structure === 'custom') {
      await addNode({
        projectId: project.id!, parentId: selectedVol.id!, type: 'storyBlock',
        title: '自定义故事块', summary: '', order: currentBlocks.length,
      })
    } else {
      for (let i = 0; i < def.blocks.length; i++) {
        await addNode({
          projectId: project.id!, parentId: selectedVol.id!, type: 'storyBlock',
          title: def.blocks[i], summary: '', order: currentBlocks.length + i,
        })
      }
    }
  }

  const generationRunOptions = useMemo(() => ({
    parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
    overrides: (systemOverride != null || userOverride != null) ? {
      systemPrompt: systemOverride ?? undefined,
      userPromptTemplate: userOverride ?? undefined,
    } : undefined,
  }), [parameterValues, systemOverride, userOverride])

  const buildOutlineAssembledContext = useCallback(async (worldGroupId: number | null, outlineNodeId?: number | null) => {
    return await assembleContext({
      projectId: project.id!,
      worldGroupId,
      outlineNodeId: outlineNodeId ?? null,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: [
        'canonAssertions',
        'worldview',
        'storyCore',
        'storyArcs',
        'characterDrivenPlan',
        'powerSystem',
        'cultivationProgress',
        'codex',
        'characters',
        'creativeRules',
        'worldRules',
        'historical',
        'locations',
        'foreshadows',
        'storyArcs',
        'storylineProgress',
        'existingVolumeOutlines',
        'writtenChapterProgress',
      ],
    })
  }, [project.id, aiConfig.provider, aiConfig.model])

  const generation = useOutlineGenerationController({
    project,
    nodes,
    volumes,
    hint,
    runOptions: generationRunOptions,
    ai,
    assembleContext: buildOutlineAssembledContext,
    openPromptPanel: () => setPromptPanelOpen(true),
    clearPreview: clearGenerationPreview,
    onInfo: toast.info,
    onError: toast.error,
  })

  const chunkedGen = useChunkedGeneration()
  const [, setPendingChunkedMode] = useState<{ mode: GenerationMode; config: ChunkedGenerationConfig } | null>(null)

  const handleAIVolumes = () => { void generation.prepare({ kind: 'volumes' }) }
  const handleAIChapters = () => {
    if (selectedVol?.id) void generation.prepare({ kind: 'chapters', volumeId: selectedVol.id })
  }

  const handleChunkedConfirm = async (mode?: GenerationMode, chunkedConfig?: ChunkedGenerationConfig) => {
    // 对于批量生成卷级大纲，直接调用 generation.confirm()
    // 因为不需要选中具体的卷
    if (!selectedVol?.id) {
      void generation.confirm(mode, chunkedConfig)
      return
    }
    
    if (mode === 'chunked' && chunkedConfig) {
      generation.cancel()
      setPendingChunkedMode({ mode, config: chunkedConfig })
      const assembled = await buildOutlineAssembledContext(null, selectedVol.id)
      const targetChapters = Number(parameterValues.chaptersPerVolume) || 20
      const storyArcContext = storyArcStore()  // 获取故事线上下文
      await chunkedGen.start({
        project,
        volumeId: selectedVol.id,
        volumeTitle: selectedVol.title,
        volumeSummary: selectedVol.summary,
        totalChapters: targetChapters,
        config: chunkedConfig,
        assembled,
        storyArcContext: storyArcContext || undefined,  // 传入故事线上下文
        onInfo: toast.info,
        onError: toast.error,
      })
      setPendingChunkedMode(null)
    } else {
      void generation.confirm(mode, chunkedConfig)
    }
  }

  const handleApplyChunkedResult = async () => {
    if (!chunkedGen.result || !selectedVol) return
    const allChapters = chunkedGen.result.blocks.flatMap(b => b.chapters)
    if (allChapters.length === 0) {
      toast.error('没有可应用的章节')
      return
    }
    setPreviewChapters(allChapters)
    chunkedGen.reset()
    toast.info('已生成章节大纲，请点击"采纳"按钮写入')
  }

  // ── 采纳预览 + 确认 ──

  const [restructuring, setRestructuring] = useState(false)
  const handlePreviewAccept = async (text: string) => {
    setRestructuring(true)
    try {
      if (generation.moduleKey === 'outline.volume') {
        const parsed = await parseVolumeOutlineSmart(text, aiConfig)
        if (parsed.length === 0) {
          toast.error('未能从 AI 输出中解析出卷级大纲，请检查输出内容或重试。')
          return
        }
        const operation = decodeGenerationOperation(ai.operation)
        if (operation?.kind === 'single-volume') {
          setPreviewTargetId(operation.volumeId)
          setPreviewVolumes(parsed.slice(0, 1))
        } else {
          setPreviewTargetId(null)
          setPreviewVolumes(parsed)
        }
      } else {
        const parsed = await parseChapterOutlineSmart(text, aiConfig)
        if (parsed.length === 0) {
          toast.error('未能从 AI 输出中解析出章节大纲，请检查输出内容或重试。')
          return
        }
        const operation = decodeGenerationOperation(ai.operation)
        if (operation?.kind === 'single-chapter') {
          setPreviewTargetId(operation.chapterId)
          setPreviewChapters(parsed.slice(0, 1))
        } else {
          setPreviewTargetId(null)
          setPreviewChapters(parsed)
        }
      }
    } finally {
      setRestructuring(false)
    }
  }

  const handleConfirmVolumes = async () => {
    if (!previewVolumes) return
    const targetId = previewTargetId
    ai.reset()
    if (targetId != null) {
      const result = await adoptGeneratedOutlineSummary(project.id!, targetId, previewVolumes[0]?.summary ?? '')
      if (!result.written) {
        toast.error(`未能写入本卷卷纲：${result.reason}`)
        return
      }
      await loadAll(project.id!)
      setPreviewVolumes(null)
      setPreviewTargetId(null)
      toast.success('本卷卷纲已写入。')
      return
    }
    const hasAnyContent = volumes.some(v => v.summary && v.summary.trim().length > 0)
    if (!hasAnyContent) {
      const emptyVolumes = volumes.filter(v => !v.summary || v.summary.trim().length === 0)
      for (const vol of emptyVolumes) {
        if (vol.id != null) {
          await deleteNode(vol.id)
        }
      }
    }
    const existingCount = hasAnyContent ? volumes.length : 0
    let result: Awaited<ReturnType<typeof adoptGeneratedOutlineItems>>
    try {
      result = await adoptGeneratedOutlineItems({
        projectId: project.id!,
        parentId: null,
        type: 'volume',
        items: previewVolumes,
        startingOrder: existingCount,
      })
    } catch (err) {
      console.error('[Outline] 写入卷失败:', err)
      toast.error(`写入卷时出错：${err instanceof Error ? err.message : '未知错误'}。请查看控制台获取详情。`)
      return
    }
    await loadAll(project.id!)
    setPreviewVolumes(null)
    setPreviewTargetId(null)
    if (result.firstId) setSelectedVolId(result.firstId)
    if (result.writtenCount === 0) {
      toast.error(`未写入任何卷。原因:${result.skippedReasons.join('；') || '与已有卷标题重复(已跳过)'}。若想替换/更新同名卷,请先删除同名卷再采纳。`)
    } else if (result.writtenCount < previewVolumes.length) {
      toast.info(`已写入 ${result.writtenCount} 个卷,另有 ${previewVolumes.length - result.writtenCount} 个被跳过(${result.skippedReasons.join('；') || '标题重复'})。`)
    } else {
      toast.success(`已写入 ${result.writtenCount} 个卷。`)
    }
  }

  const handleConfirmChapters = async () => {
    if (!previewChapters) return
    const targetId = previewTargetId
    const operation = decodeGenerationOperation(ai.operation)
    ai.reset()
    if (targetId != null) {
      const result = await adoptGeneratedOutlineSummary(project.id!, targetId, previewChapters[0]?.summary ?? '')
      if (!result.written) {
        toast.error(`未能写入本章章纲：${result.reason}`)
        return
      }
      await loadAll(project.id!)
      setPreviewChapters(null)
      setPreviewTargetId(null)
      toast.success('本章章纲已写入。')
      return
    }
    const destinationVolume = operation?.kind === 'chapters'
      ? volumes.find(volume => volume.id === operation.volumeId) ?? null
      : selectedVol
    if (!destinationVolume) return
    const existingCount = nodes.filter(node => node.parentId === destinationVolume.id && node.type === 'chapter').length
    let result: Awaited<ReturnType<typeof adoptGeneratedOutlineItems>>
    try {
      result = await adoptGeneratedOutlineItems({
        projectId: project.id!,
        parentId: destinationVolume.id!,
        type: 'chapter',
        items: previewChapters,
        startingOrder: existingCount,
      })
    } catch (err) {
      console.error('[Outline] 写入章节失败:', err)
      toast.error(`写入章节时出错：${err instanceof Error ? err.message : '未知错误'}。请查看控制台获取详情。`)
      return
    }
    await loadAll(project.id!)
    setPreviewChapters(null)
    setPreviewTargetId(null)
    if (result.writtenCount === 0) {
      toast.error(`未写入任何章节。原因:${result.skippedReasons.join('；') || '与本卷已有章节标题重复(已跳过)'}。`)
    } else if (result.writtenCount < previewChapters.length) {
      toast.info(`已写入 ${result.writtenCount} 章,另有 ${previewChapters.length - result.writtenCount} 章被跳过(${result.skippedReasons.join('；') || '标题重复'})。`)
    }
  }

  const handleDeleteSelectedVolume = async () => {
    if (!selectedVol?.id) return
    const ok = await dialog.confirm({
      title: `删除「${selectedVol.title}」及其所有章节？`,
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    deleteNode(selectedVol.id)
    setSelectedVolId(null)
  }

  // 清空当前卷所有章节
  const handleClearChapters = async () => {
    if (!selectedVol?.id) return
    const chaptersToDelete = nodes.filter(
      n => n.parentId === selectedVol.id && n.type === 'chapter'
    )
    if (chaptersToDelete.length === 0) {
      toast.info('当前卷没有章节可清空')
      return
    }
    
    const ok = await dialog.confirm({
      title: `清空「${selectedVol.title}」的所有 ${chaptersToDelete.length} 章？`,
      message: '此操作将删除当前卷的所有章节。你可以稍后手动点生成按钮重新生成。',
      confirmText: '清空',
      tone: 'danger',
    })
    if (!ok) return
    
    // 删除所有章节
    for (const chapter of chaptersToDelete) {
      await deleteNode(chapter.id!)
    }
    
    toast.success(`已清空 ${chaptersToDelete.length} 章`)
  }

  // 审校相关
  const volumeChapters = useMemo(() => {
    if (!selectedVol) return []
    return nodes
      .filter(n => n.parentId === selectedVol.id && n.type === 'chapter')
      .sort((a, b) => a.order - b.order)
  }, [nodes, selectedVol])

  const handleReviewChapters = async (userQuestion?: string): Promise<ChapterReviewResult> => {
    if (!selectedVol || volumeChapters.length === 0) {
      return { issues: [], summary: '没有可审校的章节' }
    }
    const reviewChapters = toReviewChapters(volumeChapters)
    
    // 获取设定上下文用于检查设定一致性
    const contextResult = await buildOutlineAssembledContext(selectedVol.worldGroupId ?? null)
    return reviewChapterOutlines(reviewChapters, userQuestion, contextResult.text)
  }

  const handleRewriteIssue = async (issue: ChapterReviewIssue, customSuggestion?: string): Promise<RewriteResult> => {
    const reviewChapters = toReviewChapters(volumeChapters)
    const contextResult = await buildOutlineAssembledContext(selectedVol?.worldGroupId ?? null)
    return rewriteChapterOutline(reviewChapters, issue, contextResult.text, customSuggestion)
  }

  const handleApplyRewrite = (chapterIndex: number, newSummary: string) => {
    const chapter = volumeChapters[chapterIndex]
    if (!chapter) return
    updateNode(chapter.id!, { summary: newSummary })
    toast.success(`已更新第${chapterIndex + 1}章的摘要`)
  }

  const batch = useOutlineBatchGeneration({
    projectId: project.id!,
    multiWorldEnabled: Boolean(project.enableMultiWorld),
    volumes,
    nodes,
    hint,
    assembleContext: buildOutlineAssembledContext,
    reloadOutline: () => loadAll(project.id!),
    onError: toast.error,
  })

  // ── 侧栏：卷列表 ──

  const sidebarContent = (
    <OutlineVolumeSidebar
      volumes={volumes}
      nodes={normalizedNodes}
      selectedVolumeId={selectedVolId}
      multiWorldEnabled={Boolean(project.enableMultiWorld)}
      worldGroups={worldGroups}
      aiStreaming={ai.isStreaming}
      batchRunning={batch.running}
      batchProgress={batch.progress}
      batchResult={batch.result}
      activeChapterDrag={activeChapterDrag}
      getActiveChapterDrag={getActiveChapterDrag}
      onClearActiveChapterDrag={clearActiveChapterDrag}
      onSelectVolume={setSelectedVolId}
      onAddVolume={() => { void handleAddVolume() }}
      onGenerateVolumes={handleAIVolumes}
      onGenerateAllChapters={() => { void batch.generate() }}
      onCancelBatch={batch.cancel}
      onConfirmBatch={() => { void batch.confirm() }}
      onDismissBatch={batch.dismiss}
      onReorderVolumes={reorderNodes}
      onMoveChapter={handleMoveChapter}
    />
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
          moduleKey={generation.moduleKey}
          parameterValues={parameterValues}
          onParamChange={setParameterValues}
          systemOverride={systemOverride}
          onSystemOverrideChange={setSystemOverride}
          userOverride={userOverride}
          onUserOverrideChange={setUserOverride}
          open={promptPanelOpen}
          onOpenChange={setPromptPanelOpen}
        />

        {generation.pendingRequest && !chunkedGen.isRunning && !chunkedGen.result && (
          <OutlineGenerationRequestPanel
            request={generation.pendingRequest}
            preparedContext={generation.preparedContext}
            loading={generation.contextLoading}
            error={generation.contextError}
            messages={generation.preparedNode?.messages}
            transparentMode={generation.transparentMode}
            promptReviewOpen={generation.promptReviewOpen}
            onTransparentModeChange={generation.setTransparentMode}
            onClosePromptReview={generation.closePromptReview}
            onConfirmMessages={messages => { void generation.confirmMessages(messages) }}
            onRetry={() => { void generation.prepare(generation.pendingRequest!) }}
            onCancel={generation.cancel}
            onConfirm={(mode, chunkedConfig) => { void handleChunkedConfirm(mode, chunkedConfig) }}
          />
        )}

        {(chunkedGen.isRunning || chunkedGen.result) && (
          <ChunkedGenerationPanel
            progress={chunkedGen.progress}
            result={chunkedGen.result}
            isRunning={chunkedGen.isRunning}
            isRegenerating={chunkedGen.isRegenerating}
            favorites={chunkedGen.favorites}
            onSelectChoice={(choiceId) => { void chunkedGen.selectChoice(choiceId) }}
            onRegenerate={() => { void chunkedGen.regenerateChoice() }}
            onToggleFavorite={(choiceId) => { void chunkedGen.toggleFavorite(choiceId) }}
            onCancel={() => { chunkedGen.cancel(); chunkedGen.reset() }}
            onApplyResult={() => { void handleApplyChunkedResult() }}
          />
        )}

        <OutlineGenerationResultPanel
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error}
          tokenUsage={ai.tokenUsage}
          moduleKey={generation.moduleKey}
          restructuring={restructuring}
          previewVolumes={previewVolumes}
          previewChapters={previewChapters}
          previewTargetId={previewTargetId}
          selectedVolumeTitle={selectedVol?.title}
          onStop={ai.stop}
          onAccept={handlePreviewAccept}
          onRetry={() => { void generation.retry() }}
          onConfirmVolumes={() => { void handleConfirmVolumes() }}
          onConfirmChapters={() => { void handleConfirmChapters() }}
          onCancelPreview={clearGenerationPreview}
        />

        <OutlineVolumeDetail
          volume={selectedVol}
          nodes={normalizedNodes}
          multiWorldEnabled={Boolean(project.enableMultiWorld)}
          worldGroups={worldGroups}
          aiStreaming={ai.isStreaming}
          activeChapterDrag={activeChapterDrag}
          getActiveChapterDrag={getActiveChapterDrag}
          onChapterDragStart={beginChapterDrag}
          onChapterDragEnd={clearActiveChapterDrag}
          onUpdateNode={updateNode}
          onDeleteNode={deleteNode}
          onGenerateVolume={volumeId => { void generation.prepare({ kind: 'single-volume', volumeId }) }}
          onGenerateAllChapters={handleAIChapters}
          onAddChapter={parentId => { void handleAddChapter(parentId) }}
          onDeleteVolume={() => { void handleDeleteSelectedVolume() }}
          onAddStructure={structure => { void handleAddStructure(structure) }}
          onInsertChapterAfter={(chapterId, parentId) => { void handleInsertChapterAfter(chapterId, parentId) }}
          onGenerateChapter={chapterId => { void generation.prepare({ kind: 'single-chapter', chapterId }) }}
          onOpenChapter={onOpenChapter}
          onReorderNodes={orderedIds => { void reorderNodes(orderedIds) }}
          onMoveChapter={handleMoveChapter}
          onReviewChapters={() => setReviewDialogOpen(true)}
          onClearChapters={() => { void handleClearChapters() }}
        />

        <ChapterReviewDialog
          open={reviewDialogOpen}
          onClose={() => setReviewDialogOpen(false)}
          chapters={volumeChapters.map((ch, idx) => ({ index: idx, title: ch.title || `第${idx + 1}章` }))}
          onApplyRewrite={handleApplyRewrite}
          onReview={handleReviewChapters}
          onRewrite={handleRewriteIssue}
        />
      </div>
    </PanelLayout>
  )
}
