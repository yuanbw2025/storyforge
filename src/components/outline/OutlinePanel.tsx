import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Loader2, Plus, Trash2, Sparkles } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useDragReorder } from './useDragReorder'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import {
  buildVolumeOutlinePrompt,
  buildChapterOutlinePrompt,
  buildSingleChapterOutlinePrompt,
} from '../../lib/ai/adapters/outline-adapter'
import { assembleContext } from '../../lib/registry/assemble-context'
import {
  parseVolumeOutlineSmart, parseChapterOutlineSmart,
  type ParsedVolume, type ParsedChapter,
} from '../../lib/ai/parse-outline-output'
import { useAIConfigStore } from '../../stores/ai-config'
import { runBatchOutlineGeneration, type BatchOutlineProgress } from '../../lib/ai/batch-outline-runner'
import { adopt } from '../../lib/registry/adopt'
import { getTopLevelVolumes, estimateChaptersPerVolume, DEFAULT_WORDS_PER_CHAPTER } from '../../lib/outline/selectors'
import { normalizeOutlineNode } from '../../lib/outline/normalize'
import type { AssembleContextResult } from '../../lib/registry/types'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import PanelLayout from '../shared/PanelLayout'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'
import { CInput } from '../shared/CompositionInput'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'
import type { Project, StoryStructure } from '../../lib/types'
import { STORY_STRUCTURES } from '../../lib/types/outline'
import OutlineGenerationBasis from './OutlineGenerationBasis'
import OutlinePreviewPanel from './OutlinePreviewPanel'
import OutlineStructureMenu from './OutlineStructureMenu'
import { OutlineChapterRow, OutlineStoryBlockSection } from './OutlineChapterTree'
import OutlineVolumeSidebar from './OutlineVolumeSidebar'
import type { ChapterDragPayload } from './chapter-drag'

interface Props {
  project: Project
  onOpenChapter?: (nodeId: number) => void
}

type OutlineGenerationRequest =
  | { kind: 'volumes' }
  | { kind: 'chapters'; volumeId: number }
  | { kind: 'single-volume'; volumeId: number }
  | { kind: 'single-chapter'; chapterId: number }

interface PreparedGenerationContext {
  operation: string
  assembled: AssembleContextResult
}

function encodeGenerationOperation(request: OutlineGenerationRequest): string {
  if (request.kind === 'volumes') return 'outline.volume:batch'
  if (request.kind === 'chapters') return `outline.chapter:batch:${request.volumeId}`
  if (request.kind === 'single-volume') return `outline.volume:single:${request.volumeId}`
  return `outline.chapter:single:${request.chapterId}`
}

function decodeGenerationOperation(operation: string | null): OutlineGenerationRequest | null {
  if (!operation) return null
  if (operation === 'outline.volume' || operation === 'outline.volume:batch') return { kind: 'volumes' }
  const parts = operation.split(':')
  const id = Number(parts[2])
  if (!Number.isFinite(id)) return null
  if (parts[0] === 'outline.volume' && parts[1] === 'single') return { kind: 'single-volume', volumeId: id }
  if (parts[0] === 'outline.chapter' && parts[1] === 'batch') return { kind: 'chapters', volumeId: id }
  if (parts[0] === 'outline.chapter' && parts[1] === 'single') return { kind: 'single-chapter', chapterId: id }
  return null
}

export default function OutlinePanel({ project, onOpenChapter }: Props) {
  const dialog = useDialog()
  const toast = useToast()
  const { nodes, loadAll, addNode, updateNode, deleteNode, reorderNodes, insertNodeAt, moveNodeToParent } = useOutlineStore()
  const worldGroups = useWorldGroupStore(s => s.groups)
  const aiConfig = useAIConfigStore(s => s.config)
  const [selectedVolId, setSelectedVolId] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [activeModuleKey, setActiveModuleKey] = useState<'outline.volume' | 'outline.chapter'>('outline.volume')
  const [pendingGeneration, setPendingGeneration] = useState<OutlineGenerationRequest | null>(null)
  const [preparedContext, setPreparedContext] = useState<PreparedGenerationContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState('')
  const [promptPanelOpen, setPromptPanelOpen] = useState(false)
  const [activeChapterDrag, setActiveChapterDrag] = useState<ChapterDragPayload | null>(null)
  const activeChapterDragRef = useRef<ChapterDragPayload | null>(null)
  const contextRequestRef = useRef(0)

  const beginChapterDrag = useCallback((payload: ChapterDragPayload) => {
    activeChapterDragRef.current = payload
    setActiveChapterDrag(payload)
  }, [])

  const clearActiveChapterDrag = useCallback(() => {
    activeChapterDragRef.current = null
    setActiveChapterDrag(null)
  }, [])

  const getActiveChapterDrag = useCallback(() => activeChapterDragRef.current, [])

  // 采纳预览
  const [previewVolumes, setPreviewVolumes] = useState<ParsedVolume[] | null>(null)
  const [previewChapters, setPreviewChapters] = useState<ParsedChapter[] | null>(null)
  const [previewTargetId, setPreviewTargetId] = useState<number | null>(null)

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

  const ai = useAIStream(createAISessionKey(project.id!, 'outline.generate'))
  const sessionModuleKey: 'outline.volume' | 'outline.chapter' =
    pendingGeneration
      ? (pendingGeneration.kind === 'volumes' || pendingGeneration.kind === 'single-volume' ? 'outline.volume' : 'outline.chapter')
      : ai.operation?.startsWith('outline.chapter') ? 'outline.chapter'
      : ai.operation?.startsWith('outline.volume') ? 'outline.volume'
        : activeModuleKey

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const normalizedNodes = useMemo(() => nodes.map(normalizeOutlineNode), [nodes])
  const volumes = getTopLevelVolumes(normalizedNodes)
  const selectedVol = volumes.find(v => v.id === selectedVolId) || null

  // 修复「长卷被压成 ~20 章」：选中卷 / 改「每章字数」时，按「卷字数 ÷ 每章字数」自动估算
  // 「本卷章节数」的智能默认值。用 ref 记住上次的估算值以区分：
  //  · 当前章节数 == 上次估算值（用户没手动改）→ 用新估算覆盖（改每章字数能联动重算）；
  //  · 当前章节数 ≠ 上次估算值（用户手动滑/填过）→ 保留用户值，绝不覆盖。
  // 这样既有智能默认避坑，又完全尊重用户自定义。
  const lastChapterEstimateRef = useRef<number | null>(null)
  useEffect(() => {
    if (!selectedVol) return
    const wpc = Number(parameterValues.wordsPerChapter) || DEFAULT_WORDS_PER_CHAPTER
    const est = estimateChaptersPerVolume(project.targetWordCount, volumes.length, wpc)
    setParameterValues(prev => {
      const cur = prev.chaptersPerVolume
      const untouched = cur == null || cur === '' || cur === lastChapterEstimateRef.current
      if (!untouched) return prev
      lastChapterEstimateRef.current = est
      return { ...prev, chaptersPerVolume: est }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVolId, parameterValues.wordsPerChapter])

  // 故事块和章节层级
  const selectedVolBlocks = useMemo(() => {
    if (!selectedVol) return []
    return normalizedNodes.filter(n => n.parentId === selectedVol.id && n.type === 'storyBlock').sort((a, b) => a.order - b.order)
  }, [normalizedNodes, selectedVol])

  // 直接挂在卷下的章节（无故事块归属）
  const selectedVolChapters = useMemo(() => {
    if (!selectedVol) return []
    return normalizedNodes.filter(n => n.parentId === selectedVol.id && n.type === 'chapter').sort((a, b) => a.order - b.order)
  }, [normalizedNodes, selectedVol])

  // 是否使用故事块模式
  const hasBlocks = selectedVolBlocks.length > 0

  // FB-2 拖动排序：直挂章节列表；卷列表由 OutlineVolumeSidebar 管理
  const directChaptersDnD = useDragReorder(
    selectedVolChapters.map(c => c.id),
    (ids) => reorderNodes(ids),
  )

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
        'foreshadows',
        'existingVolumeOutlines',
        'writtenChapterProgress',
      ],
    })
  }, [project.id, aiConfig.provider, aiConfig.model])

  const contextPart = (assembled: AssembleContextResult, key: string): string => {
    const idx = assembled.included.indexOf(key)
    return idx >= 0 ? assembled.segments[idx]?.content ?? '' : ''
  }

  // ── AI 生成 ──

  const findVolumeForChapter = (chapterId: number) => {
    const chapter = nodes.find(node => node.id === chapterId && node.type === 'chapter')
    if (!chapter) return null
    const parent = nodes.find(node => node.id === chapter.parentId)
    if (parent?.type === 'volume') return parent
    if (parent?.type === 'storyBlock') {
      return nodes.find(node => node.id === parent.parentId && node.type === 'volume') ?? null
    }
    return null
  }

  const prepareGeneration = async (request: OutlineGenerationRequest) => {
    const requestId = contextRequestRef.current + 1
    contextRequestRef.current = requestId
    const moduleKey = request.kind === 'volumes' || request.kind === 'single-volume'
      ? 'outline.volume'
      : 'outline.chapter'
    const operation = encodeGenerationOperation(request)
    setActiveModuleKey(moduleKey)
    setPendingGeneration(request)
    setPreparedContext(null)
    setContextLoading(true)
    setContextError('')
    setPromptPanelOpen(true)
    setPreviewVolumes(null)
    setPreviewChapters(null)
    setPreviewTargetId(null)

    try {
      const targetVolume = request.kind === 'single-volume' || request.kind === 'chapters'
        ? volumes.find(volume => volume.id === request.volumeId) ?? null
        : request.kind === 'single-chapter'
          ? findVolumeForChapter(request.chapterId)
          : null
      const assembled = await buildOutlineAssembledContext(
        targetVolume?.worldGroupId ?? null,
        targetVolume?.id,
      )
      if (contextRequestRef.current !== requestId) return
      setPreparedContext({ operation, assembled })
    } catch (error) {
      if (contextRequestRef.current !== requestId) return
      setContextError((error as Error).message || '未知错误')
    } finally {
      if (contextRequestRef.current === requestId) setContextLoading(false)
    }
  }

  const executeGeneration = async (
    request: OutlineGenerationRequest,
    contextSnapshot?: AssembleContextResult | null,
  ) => {
    const moduleKey = request.kind === 'volumes' || request.kind === 'single-volume'
      ? 'outline.volume'
      : 'outline.chapter'
    setActiveModuleKey(moduleKey)
    ai.setOperation(encodeGenerationOperation(request))
    setPreviewVolumes(null)
    setPreviewChapters(null)
    setPreviewTargetId(null)

    if (request.kind === 'volumes' || request.kind === 'single-volume') {
      const explicitCount = Number(parameterValues.volumeCount)
      if (
        request.kind === 'volumes' &&
        parameterValues.volumeCount !== '' &&
        parameterValues.volumeCount != null &&
        Number.isFinite(explicitCount) &&
        explicitCount > 0 &&
        explicitCount <= volumes.length
      ) {
        ai.reset()
        toast.info(`当前已有 ${volumes.length} 卷，已达到你设定的 ${Math.floor(explicitCount)} 卷，无需继续生成。`)
        return
      }
      const targetVolume = request.kind === 'single-volume'
        ? volumes.find(volume => volume.id === request.volumeId)
        : null
      if (request.kind === 'single-volume' && !targetVolume) {
        toast.error('要补全的卷不存在，请重新选择。')
        return
      }
      const assembled = contextSnapshot
        ?? await buildOutlineAssembledContext(targetVolume?.worldGroupId ?? null, targetVolume?.id)
      const messages = buildVolumeOutlinePrompt(
        project.name,
        project.genre,
        assembled.text,
        contextPart(assembled, 'storyCore'),
        project.targetWordCount || 500000,
        hint,
        buildOpts(),
        contextPart(assembled, 'characters'),
        contextPart(assembled, 'worldRules'),
        {
          existingVolumesContext: contextPart(assembled, 'existingVolumeOutlines'),
          existingVolumeCount: volumes.length,
          targetVolumeTitle: targetVolume?.title,
        },
      )
      await ai.start(messages, undefined, { category: 'outline.volume', projectId: project.id! })
      return
    }

    const volume = request.kind === 'chapters'
      ? volumes.find(item => item.id === request.volumeId)
      : findVolumeForChapter(request.chapterId)
    if (!volume) {
      toast.error('要生成章纲的卷不存在，请重新选择。')
      return
    }
    const assembled = contextSnapshot
      ?? await buildOutlineAssembledContext(volume.worldGroupId ?? null, volume.id)
    const volIdx = volumes.indexOf(volume)
    const prevSummary = volIdx > 0 ? volumes[volIdx - 1].summary : ''
    const charCtx = contextPart(assembled, 'characters')
    const rulesCtx = contextPart(assembled, 'worldRules')
    const messages = request.kind === 'single-chapter'
      ? (() => {
        const chapter = nodes.find(node => node.id === request.chapterId && node.type === 'chapter')!
        const siblings = nodes
          .filter(node => node.type === 'chapter' && node.parentId === chapter.parentId && node.id !== chapter.id)
          .sort((a, b) => a.order - b.order)
        const siblingContext = siblings.length
          ? `同级已有章节：\n${siblings.map(item => `- ${item.title}${item.summary ? `：${item.summary}` : ''}`).join('\n')}`
          : ''
        return buildSingleChapterOutlinePrompt(
          volume.title,
          volume.summary,
          chapter.title,
          siblingContext,
          assembled.text,
          prevSummary,
          hint,
          buildOpts(),
          charCtx,
          rulesCtx,
        )
      })()
      : buildChapterOutlinePrompt(
        volume.title,
        volume.summary,
        assembled.text,
        prevSummary,
        hint,
        buildOpts(),
        charCtx,
        rulesCtx,
      )
    await ai.start(messages, undefined, { category: 'outline.chapter', projectId: project.id! })
  }

  const handleAIVolumes = () => { void prepareGeneration({ kind: 'volumes' }) }
  const handleAIChapters = () => {
    if (selectedVol?.id) void prepareGeneration({ kind: 'chapters', volumeId: selectedVol.id })
  }
  const handleConfirmGeneration = () => {
    if (!pendingGeneration || contextLoading || contextError) return
    const request = pendingGeneration
    const operation = encodeGenerationOperation(request)
    const contextSnapshot = preparedContext?.operation === operation ? preparedContext.assembled : null
    if (!contextSnapshot) return
    setPendingGeneration(null)
    setPreparedContext(null)
    void executeGeneration(request, contextSnapshot)
  }
  const handleRetryGeneration = () => {
    const request = decodeGenerationOperation(ai.operation)
    if (request) void executeGeneration(request)
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
      toast.error(`批量写入章节时出错：${err instanceof Error ? err.message : '未知错误'}。请查看控制台获取详情。`)
      return
    }
    await loadAll(project.id!)
    setBatchResult(null)
    setBatchProgress(null)
  }, [batchResult, nodes, addOutlineNodeByAdopt, loadAll, project.id, toast])

  // ── 采纳预览 + 确认 ──

  const [restructuring, setRestructuring] = useState(false)
  const handlePreviewAccept = async (text: string) => {
    setRestructuring(true)
    try {
      if (sessionModuleKey === 'outline.volume') {
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
      const result = await adopt({
        projectId: project.id!,
        target: 'outlineNodes',
        recordId: targetId,
        mode: 'replace',
        data: { summary: previewVolumes[0]?.summary ?? '' },
      })
      if (result.written.length === 0) {
        toast.error(`未能写入本卷卷纲：${result.skipped[0]?.reason ?? '结果为空'}`)
        return
      }
      await loadAll(project.id!)
      setPreviewVolumes(null)
      setPreviewTargetId(null)
      toast.success('本卷卷纲已写入。')
      return
    }
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
      toast.error(`写入卷时出错：${err instanceof Error ? err.message : '未知错误'}。请查看控制台获取详情。`)
      return
    }
    await loadAll(project.id!)
    setPreviewVolumes(null)
    setPreviewTargetId(null)
    if (firstId) setSelectedVolId(firstId)
    // FB-10:不再静默——全跳过/部分跳过都明确告知用户原因
    if (written === 0) {
      toast.error(`未写入任何卷。原因:${[...skipReasons].join('；') || '与已有卷标题重复(已跳过)'}。若想替换/更新同名卷,请先删除同名卷再采纳。`)
    } else if (written < previewVolumes.length) {
      toast.info(`已写入 ${written} 个卷,另有 ${previewVolumes.length - written} 个被跳过(${[...skipReasons].join('；') || '标题重复'})。`)
    } else {
      toast.success(`已写入 ${written} 个卷。`)
    }
  }

  const handleConfirmChapters = async () => {
    if (!previewChapters) return
    const targetId = previewTargetId
    const operation = decodeGenerationOperation(ai.operation)
    ai.reset()
    if (targetId != null) {
      const result = await adopt({
        projectId: project.id!,
        target: 'outlineNodes',
        recordId: targetId,
        mode: 'replace',
        data: { summary: previewChapters[0]?.summary ?? '' },
      })
      if (result.written.length === 0) {
        toast.error(`未能写入本章章纲：${result.skipped[0]?.reason ?? '结果为空'}`)
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
    let written = 0
    const skipReasons = new Set<string>()
    try {
      for (let i = 0; i < previewChapters.length; i++) {
        const r = await addOutlineNodeByAdopt({
          parentId: destinationVolume.id!, type: 'chapter',
          title: previewChapters[i].title, summary: previewChapters[i].summary,
          order: existingCount + i,
        })
        if (r.id != null) written++
        else if (r.reason) skipReasons.add(r.reason)
      }
    } catch (err) {
      console.error('[Outline] 写入章节失败:', err)
      toast.error(`写入章节时出错：${err instanceof Error ? err.message : '未知错误'}。请查看控制台获取详情。`)
      return
    }
    await loadAll(project.id!)
    setPreviewChapters(null)
    setPreviewTargetId(null)
    if (written === 0) {
      toast.error(`未写入任何章节。原因:${[...skipReasons].join('；') || '与本卷已有章节标题重复(已跳过)'}。`)
    } else if (written < previewChapters.length) {
      toast.info(`已写入 ${written} 章,另有 ${previewChapters.length - written} 章被跳过(${[...skipReasons].join('；') || '标题重复'})。`)
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

  const handleCancelPreview = () => {
    setPreviewVolumes(null)
    setPreviewChapters(null)
    setPreviewTargetId(null)
  }

  // ── 侧栏：卷列表 ──

  const sidebarContent = (
    <OutlineVolumeSidebar
      volumes={volumes}
      nodes={normalizedNodes}
      selectedVolumeId={selectedVolId}
      multiWorldEnabled={Boolean(project.enableMultiWorld)}
      worldGroups={worldGroups}
      aiStreaming={ai.isStreaming}
      batchRunning={batchRunning}
      batchProgress={batchProgress}
      batchResult={batchResult}
      activeChapterDrag={activeChapterDrag}
      getActiveChapterDrag={getActiveChapterDrag}
      onClearActiveChapterDrag={clearActiveChapterDrag}
      onSelectVolume={setSelectedVolId}
      onAddVolume={() => { void handleAddVolume() }}
      onGenerateVolumes={handleAIVolumes}
      onGenerateAllChapters={() => { void handleBatchGenerate() }}
      onCancelBatch={handleBatchCancel}
      onConfirmBatch={() => { void handleBatchConfirm() }}
      onDismissBatch={() => { setBatchResult(null); setBatchProgress(null) }}
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
          moduleKey={sessionModuleKey}
          parameterValues={parameterValues}
          onParamChange={setParameterValues}
          systemOverride={systemOverride}
          onSystemOverrideChange={setSystemOverride}
          userOverride={userOverride}
          onUserOverrideChange={setUserOverride}
          open={promptPanelOpen}
          onOpenChange={setPromptPanelOpen}
        />

        {pendingGeneration && (
          <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="text-xs leading-5 text-text-secondary">
                <span className="font-medium text-text-primary">
                  {pendingGeneration.kind === 'volumes' && '批量生成卷级大纲'}
                  {pendingGeneration.kind === 'chapters' && '生成本卷所有章节'}
                  {pendingGeneration.kind === 'single-volume' && 'AI 生成本卷卷纲'}
                  {pendingGeneration.kind === 'single-chapter' && 'AI 生成本章章纲'}
                </span>
                <span className="ml-2">
                  {pendingGeneration.kind === 'single-chapter'
                    ? '单章补全固定只生成当前 1 章；上方“本卷章节数”不参与本次调用。确认后才会调用 API。'
                    : '请先调整上方参数，确认后才会调用 API。'}
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {contextError && (
                  <button
                    onClick={() => { void prepareGeneration(pendingGeneration) }}
                    className="px-2.5 py-1 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10"
                  >
                    重新读取
                  </button>
                )}
                <button
                  onClick={() => {
                    contextRequestRef.current += 1
                    setPendingGeneration(null)
                    setPreparedContext(null)
                    setContextLoading(false)
                    setContextError('')
                  }}
                  className="px-2.5 py-1 text-xs text-text-muted border border-border rounded hover:text-text-primary"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmGeneration}
                  disabled={contextLoading || !!contextError || !preparedContext}
                  className="px-2.5 py-1 text-xs text-white bg-accent rounded hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  确认生成
                </button>
              </div>
            </div>
            <div className="border-t border-accent/20 pt-3">
              <OutlineGenerationBasis
                context={preparedContext?.assembled ?? null}
                loading={contextLoading}
                error={contextError}
              />
            </div>
          </div>
        )}

        {/* AI 输出（就地显示） */}
        {(ai.output || ai.isStreaming || ai.error) && (
          <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error} tokenUsage={ai.tokenUsage}
            onStop={ai.stop}
            onAccept={handlePreviewAccept}
            onRetry={handleRetryGeneration}
            moduleKey={sessionModuleKey} />
        )}

        {restructuring && (
          <div className="flex items-center gap-2 text-xs text-accent">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 正在用 AI 整理大纲结构…
          </div>
        )}

        {/* 采纳预览：卷 */}
        {previewVolumes && (
          <OutlinePreviewPanel
            label={previewTargetId != null ? '将补全当前卷的卷纲' : `将创建 ${previewVolumes.length} 个卷`}
            items={previewVolumes}
            onConfirm={handleConfirmVolumes}
            onCancel={handleCancelPreview}
          />
        )}

        {/* 采纳预览：章节 */}
        {previewChapters && (
          <OutlinePreviewPanel
            label={previewTargetId != null
              ? '将补全当前章节的章纲'
              : `将在「${selectedVol?.title}」下创建 ${previewChapters.length} 个章节`}
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
                {!selectedVol.summary.trim() && (
                  <button
                    onClick={() => { void prepareGeneration({ kind: 'single-volume', volumeId: selectedVol.id! }) }}
                    disabled={ai.isStreaming}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-bg-elevated text-accent rounded-md hover:bg-accent/10 border border-accent/30 disabled:opacity-50 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> AI 生成本卷卷纲
                  </button>
                )}
                <button onClick={handleAIChapters} disabled={ai.isStreaming}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors">
                  <Sparkles className="w-3.5 h-3.5" /> 生成本卷所有章节
                </button>
                <button onClick={() => handleAddChapter()}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-bg-elevated text-text-secondary rounded-md hover:text-text-primary border border-border transition-colors">
                  <Plus className="w-3.5 h-3.5" /> 添加章节
                </button>
                <button onClick={() => { void handleDeleteSelectedVolume() }} className="p-1.5 text-text-muted hover:text-error rounded transition-colors">
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
                  <span className="text-text-muted font-normal ml-1">（{selectedVolChapters.length + normalizedNodes.filter(n => selectedVolBlocks.some(b => b.id === n.parentId) && n.type === 'chapter').length} 章）</span>
                </h3>
                {!hasBlocks && (
                  <OutlineStructureMenu onSelect={handleAddStructure} />
                )}
              </div>

              {/* 故事块模式 */}
              {hasBlocks && (
                <div className="space-y-3 mb-3">
                  {selectedVolBlocks.map(block => {
                    const blockChapters = normalizedNodes.filter(n => n.parentId === block.id && n.type === 'chapter').sort((a, b) => a.order - b.order)
                    return (
                      <OutlineStoryBlockSection
                        key={block.id}
                        block={block}
                        chapters={blockChapters}
                        onUpdateNode={updateNode}
                        onDeleteNode={deleteNode}
                        onAddChapter={() => handleAddChapter(block.id!)}
                        onOpenChapter={onOpenChapter}
                        onReorder={(ids) => reorderNodes(ids)}
                        onInsertAfter={(chId) => handleInsertChapterAfter(chId, block.id!)}
                        onGenerateChapter={(chapterId) => { void prepareGeneration({ kind: 'single-chapter', chapterId }) }}
                        onMoveChapter={handleMoveChapter}
                        activeChapterDrag={activeChapterDrag}
                        getActiveChapterDrag={getActiveChapterDrag}
                        onChapterDragStart={beginChapterDrag}
                        onChapterDragEnd={clearActiveChapterDrag}
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
                    还没有章节，点击「生成本卷所有章节」或「添加章节」
                  </div>
                ) : (
                  <div className="space-y-1">
                    {selectedVolChapters.map((ch, idx) => (
                      <OutlineChapterRow
                        key={ch.id} ch={ch} idx={idx}
                        onUpdate={updateNode} onDelete={deleteNode} onOpen={onOpenChapter}
                        dnd={directChaptersDnD.itemDnD(ch.id)}
                        onInsertAfter={() => handleInsertChapterAfter(ch.id!, selectedVol.id!)}
                        onGenerate={() => { void prepareGeneration({ kind: 'single-chapter', chapterId: ch.id! }) }}
                        parentId={selectedVol.id!}
                        onMoveChapter={handleMoveChapter}
                        activeChapterDrag={activeChapterDrag}
                        getActiveChapterDrag={getActiveChapterDrag}
                        onChapterDragStart={beginChapterDrag}
                        onChapterDragEnd={clearActiveChapterDrag}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
            <div className="text-4xl opacity-20">📖</div>
            <p className="text-sm">选择左侧的卷开始编辑，或点击「批量生成卷级大纲」</p>
          </div>
        )}
      </div>
    </PanelLayout>
  )
}
