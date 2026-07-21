import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { Plus, Trash2, Sparkles, ChevronRight, ChevronDown, Check, X, LayoutList, Layers, Loader2, GripVertical, CornerDownRight, CheckSquare, Square } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useDragReorder, type ItemDnD } from './useDragReorder'
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

const OUTLINE_CHAPTER_DRAG_MIME = 'application/x-storyforge-outline-chapter'

interface ChapterDragPayload {
  chapterId: number
  sourceParentId: number | null
}

function readChapterDragPayload(event: ReactDragEvent): ChapterDragPayload | null {
  const raw = event.dataTransfer?.getData(OUTLINE_CHAPTER_DRAG_MIME) ?? ''
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ChapterDragPayload>
    const chapterId = Number(parsed.chapterId)
    const sourceParentId = parsed.sourceParentId == null ? null : Number(parsed.sourceParentId)
    if (!Number.isFinite(chapterId)) return null
    if (sourceParentId != null && !Number.isFinite(sourceParentId)) return null
    return { chapterId, sourceParentId }
  } catch {
    const legacyId = Number(raw)
    return Number.isFinite(legacyId) ? { chapterId: legacyId, sourceParentId: null } : null
  }
}

function hasChapterDragPayload(event: ReactDragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(OUTLINE_CHAPTER_DRAG_MIME)
}

type GetActiveChapterDrag = () => ChapterDragPayload | null

export function chapterDropProps({
  targetParentId,
  targetIndex,
  onMoveChapter,
  getActiveChapterDrag,
  clearActiveChapterDrag,
}: {
  targetParentId: number
  targetIndex: number
  onMoveChapter: (chapterId: number, targetParentId: number, index: number) => Promise<void>
  getActiveChapterDrag: GetActiveChapterDrag
  clearActiveChapterDrag: () => void
}) {
  return {
    onDragOver: (event: ReactDragEvent) => {
      if (!getActiveChapterDrag() && !hasChapterDragPayload(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    onDrop: async (event: ReactDragEvent) => {
      const payload = readChapterDragPayload(event) ?? getActiveChapterDrag()
      if (!payload) return
      event.preventDefault()
      event.stopPropagation()
      try {
        await onMoveChapter(payload.chapterId, targetParentId, targetIndex)
      } finally {
        clearActiveChapterDrag()
      }
    },
  }
}

interface Props {
  project: Project
  onOpenChapter?: (nodeId: number) => void
}

type OutlineGenerationRequest =
  | { kind: 'volumes' }
  | { kind: 'chapters'; volumeId: number }
  | { kind: 'single-volume'; volumeId: number }
  | { kind: 'single-chapter'; chapterId: number }

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
  const [promptPanelOpen, setPromptPanelOpen] = useState(false)
  const [activeChapterDrag, setActiveChapterDrag] = useState<ChapterDragPayload | null>(null)
  const [chapterDropTargetId, setChapterDropTargetId] = useState<number | null>(null)
  const activeChapterDragRef = useRef<ChapterDragPayload | null>(null)

  // ── 多选删除：卷 ──
  const [volumeMultiSelect, setVolumeMultiSelect] = useState(false)
  const [selectedVolumeIds, setSelectedVolumeIds] = useState<Set<number>>(new Set())

  // ── 多选删除：章节（覆盖直挂章节 + 故事块内章节） ──
  const [chapterMultiSelect, setChapterMultiSelect] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<number>>(new Set())

  const beginChapterDrag = useCallback((payload: ChapterDragPayload) => {
    activeChapterDragRef.current = payload
    setActiveChapterDrag(payload)
  }, [])

  const clearActiveChapterDrag = useCallback(() => {
    activeChapterDragRef.current = null
    setActiveChapterDrag(null)
    setChapterDropTargetId(null)
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

  // FB-2 拖动排序：卷列表（侧栏）、直挂章节列表各一套
  const volumeDnD = useDragReorder(volumes.map(v => v.id), (ids) => reorderNodes(ids))
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

  const prepareGeneration = (request: OutlineGenerationRequest) => {
    const moduleKey = request.kind === 'volumes' || request.kind === 'single-volume'
      ? 'outline.volume'
      : 'outline.chapter'
    setActiveModuleKey(moduleKey)
    setPendingGeneration(request)
    setPromptPanelOpen(true)
    setPreviewVolumes(null)
    setPreviewChapters(null)
    setPreviewTargetId(null)
  }

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

  const executeGeneration = async (request: OutlineGenerationRequest) => {
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
      const assembled = await buildOutlineAssembledContext(targetVolume?.worldGroupId ?? null, targetVolume?.id)
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
    const assembled = await buildOutlineAssembledContext(volume.worldGroupId ?? null, volume.id)
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

  const handleAIVolumes = () => prepareGeneration({ kind: 'volumes' })
  const handleAIChapters = () => {
    if (selectedVol?.id) prepareGeneration({ kind: 'chapters', volumeId: selectedVol.id })
  }
  const handleConfirmGeneration = () => {
    if (!pendingGeneration) return
    const request = pendingGeneration
    setPendingGeneration(null)
    void executeGeneration(request)
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
  }, [batchResult, nodes, addOutlineNodeByAdopt, loadAll, project.id])

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

  // ── 多选删除：卷 ──

  const toggleVolumeSelect = (volId: number) => {
    setSelectedVolumeIds(prev => {
      const next = new Set(prev)
      if (next.has(volId)) next.delete(volId)
      else next.add(volId)
      return next
    })
  }

  const toggleVolumeSelectAll = () => {
    setSelectedVolumeIds(prev => {
      if (prev.size === volumes.length) return new Set()
      return new Set(volumes.map(v => v.id!))
    })
  }

  const handleEnterVolumeMultiSelect = () => {
    setVolumeMultiSelect(true)
    setSelectedVolumeIds(new Set())
  }

  const handleExitVolumeMultiSelect = () => {
    setVolumeMultiSelect(false)
    setSelectedVolumeIds(new Set())
  }

  const handleBatchDeleteVolumes = async () => {
    if (selectedVolumeIds.size === 0) return
    const ok = await dialog.confirm({
      title: `删除选中的 ${selectedVolumeIds.size} 个卷？`,
      message: '这些卷连同其下所有章节和故事块都会被删除，此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    const ids = Array.from(selectedVolumeIds)
    for (const id of ids) {
      deleteNode(id)
    }
    if (selectedVolId != null && selectedVolumeIds.has(selectedVolId)) {
      setSelectedVolId(null)
    }
    setSelectedVolumeIds(new Set())
    setVolumeMultiSelect(false)
    toast.success(`已删除 ${ids.length} 个卷。`)
  }

  // ── 多选删除：章节 ──

  const toggleChapterSelect = (chapterId: number) => {
    setSelectedChapterIds(prev => {
      const next = new Set(prev)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  const handleEnterChapterMultiSelect = () => {
    setChapterMultiSelect(true)
    setSelectedChapterIds(new Set())
  }

  const handleExitChapterMultiSelect = () => {
    setChapterMultiSelect(false)
    setSelectedChapterIds(new Set())
  }

  // 「全选当前可见章节」——包括直挂章节 + 所有故事块内章节
  const visibleChapterIds = useMemo(() => {
    if (!selectedVol) return [] as number[]
    const direct = selectedVolChapters.map(c => c.id!)
    const inBlocks = selectedVolBlocks.flatMap(b =>
      normalizedNodes
        .filter(n => n.parentId === b.id && n.type === 'chapter')
        .map(n => n.id!),
    )
    return [...direct, ...inBlocks]
  }, [selectedVol, selectedVolChapters, selectedVolBlocks, normalizedNodes])

  const toggleChapterSelectAll = () => {
    setSelectedChapterIds(prev => {
      if (prev.size === visibleChapterIds.length && visibleChapterIds.length > 0) return new Set()
      return new Set(visibleChapterIds)
    })
  }

  const handleBatchDeleteChapters = async () => {
    if (selectedChapterIds.size === 0) return
    const ok = await dialog.confirm({
      title: `删除选中的 ${selectedChapterIds.size} 个章节？`,
      message: '这些章节将被一次性删除，此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    const ids = Array.from(selectedChapterIds)
    for (const id of ids) {
      deleteNode(id)
    }
    setSelectedChapterIds(new Set())
    setChapterMultiSelect(false)
    toast.success(`已删除 ${ids.length} 个章节。`)
  }

  const handleCancelPreview = () => {
    setPreviewVolumes(null)
    setPreviewChapters(null)
    setPreviewTargetId(null)
  }

  // ── 侧栏：卷列表 ──

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* 操作栏 */}
      <div className="p-2 space-y-1.5">
        {!volumeMultiSelect ? (
          <button onClick={handleEnterVolumeMultiSelect} disabled={volumes.length === 0}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-elevated text-text-secondary rounded-md hover:text-error border border-border disabled:opacity-40 transition-colors">
            <CheckSquare className="w-3.5 h-3.5" /> 多选删除
          </button>
        ) : (
          <button onClick={handleExitVolumeMultiSelect}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-elevated text-text-secondary rounded-md hover:text-text-primary border border-border transition-colors">
            <X className="w-3.5 h-3.5" /> 退出多选
          </button>
        )}
        <button onClick={handleAddVolume} disabled={volumeMultiSelect}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-elevated text-text-secondary rounded-md hover:text-text-primary border border-border disabled:opacity-40 transition-colors">
          <Plus className="w-3.5 h-3.5" /> 添加卷
        </button>
        <button onClick={handleAIVolumes} disabled={ai.isStreaming || batchRunning || volumeMultiSelect}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors">
          <Sparkles className="w-3.5 h-3.5" /> 批量生成卷级大纲
        </button>
        {volumes.length >= 2 && (
          <button onClick={handleBatchGenerate} disabled={ai.isStreaming || batchRunning || volumeMultiSelect}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-bg-elevated text-accent rounded-md hover:bg-accent/10 border border-accent/30 disabled:opacity-50 transition-colors">
            <Layers className="w-3.5 h-3.5" /> 批量生成所有卷的章节
          </button>
        )}
      </div>

      {/* 多选模式：操作栏 */}
      {volumeMultiSelect && (
        <div className="px-2 pb-2 space-y-1.5">
          <button
            onClick={toggleVolumeSelectAll}
            disabled={volumes.length === 0}
            className="w-full flex items-center justify-between gap-1.5 px-2 py-1.5 text-xs bg-bg-surface border border-border rounded-md hover:border-accent/50 disabled:opacity-40 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              {selectedVolumeIds.size === volumes.length && volumes.length > 0
                ? <CheckSquare className="w-3.5 h-3.5 text-accent" />
                : <Square className="w-3.5 h-3.5 text-text-muted" />}
              {selectedVolumeIds.size === volumes.length && volumes.length > 0 ? '取消全选' : '全选'}
            </span>
            <span className="text-text-muted">已选 {selectedVolumeIds.size}/{volumes.length}</span>
          </button>
          <button
            onClick={handleBatchDeleteVolumes}
            disabled={selectedVolumeIds.size === 0}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-error/10 text-error border border-error/40 rounded-md hover:bg-error/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> 删除选中 ({selectedVolumeIds.size})
          </button>
        </div>
      )}

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
          const blockIds = new Set(nodes.filter(n => n.parentId === vol.id && n.type === 'storyBlock').map(n => n.id))
          const childCount = nodes.filter(n =>
            n.type === 'chapter'
            && (n.parentId === vol.id || blockIds.has(n.parentId ?? undefined)),
          ).length
          const active = selectedVolId === vol.id
          const d = volumeDnD.itemDnD(vol.id)
          const dropToVolumeProps = chapterDropProps({
            targetParentId: vol.id!,
            targetIndex: normalizedNodes.filter(n => n.parentId === vol.id && n.type === 'chapter').length,
            onMoveChapter: handleMoveChapter,
            getActiveChapterDrag,
            clearActiveChapterDrag,
          })
          const isChapterDropTarget = chapterDropTargetId === vol.id && activeChapterDrag != null
          const checked = vol.id != null && selectedVolumeIds.has(vol.id)
          // 多选模式下：禁用拖拽 drop、点击卷名切换选中而非切显示
          const dragDisabled = volumeMultiSelect
          return (
            <div
              key={vol.id}
              {...(dragDisabled ? {} : d.dropProps)}
              data-outline-volume-id={vol.id}
              data-chapter-drop-target={!dragDisabled && isChapterDropTarget ? 'true' : undefined}
              onDragEnter={(event) => {
                if (dragDisabled) return
                d.dropProps.onDragEnter()
                if (getActiveChapterDrag() || hasChapterDragPayload(event)) setChapterDropTargetId(vol.id!)
              }}
              onDragLeave={(event) => {
                if (dragDisabled) return
                d.dropProps.onDragLeave()
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setChapterDropTargetId(current => current === vol.id ? null : current)
                }
              }}
              onDragOver={(event) => {
                if (dragDisabled) return
                if (getActiveChapterDrag() || hasChapterDragPayload(event)) {
                  setChapterDropTargetId(vol.id!)
                  dropToVolumeProps.onDragOver(event)
                  return
                }
                d.dropProps.onDragOver(event)
              }}
              onDrop={(event) => {
                if (dragDisabled) return
                if (getActiveChapterDrag() || hasChapterDragPayload(event)) {
                  void dropToVolumeProps.onDrop(event)
                  return
                }
                d.dropProps.onDrop(event)
              }}
              className={`group/vol flex items-center rounded-lg mb-0.5 transition-all ${
                volumeMultiSelect
                  ? checked
                    ? 'bg-accent/10 border-l-2 border-accent'
                    : 'hover:bg-bg-hover border-l-2 border-transparent'
                  : active
                    ? 'bg-accent/8 border-l-2 border-accent'
                    : 'hover:bg-bg-hover border-l-2 border-transparent'
              } ${d.isDragging ? 'opacity-40' : ''} ${d.isOver || isChapterDropTarget ? 'ring-1 ring-accent/60 bg-accent/10' : ''}`}
            >
              {/* 多选模式下显示复选框；非多选模式显示拖拽手柄 */}
              {volumeMultiSelect ? (
                <button
                  onClick={() => vol.id != null && toggleVolumeSelect(vol.id)}
                  className="shrink-0 pl-1.5 pr-1 py-2 text-text-muted hover:text-accent"
                  title={checked ? '取消选中' : '选中'}
                >
                  {checked
                    ? <CheckSquare className="w-4 h-4 text-accent" />
                    : <Square className="w-4 h-4" />}
                </button>
              ) : (
                <span
                  {...d.dragHandleProps}
                  title="拖动调整卷顺序"
                  className="shrink-0 pl-1 pr-0.5 py-2 cursor-grab active:cursor-grabbing text-text-muted/40 group-hover/vol:text-text-muted"
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </span>
              )}
              <button
                onClick={() => {
                  if (volumeMultiSelect) {
                    if (vol.id != null) toggleVolumeSelect(vol.id)
                  } else {
                    setSelectedVolId(vol.id!)
                  }
                }}
                className="min-w-0 flex-1 text-left px-1 py-2"
              >
                <p className={`text-sm font-medium truncate ${volumeMultiSelect ? (checked ? 'text-accent' : 'text-text-primary') : (active ? 'text-accent' : 'text-text-primary')}`}>
                  {project.enableMultiWorld && vol.worldGroupId != null && (
                    <span className="mr-1">{worldGroups.find(g => g.id === vol.worldGroupId)?.icon || '🌐'}</span>
                  )}
                  {vol.title}
                </p>
                <p className="text-[10px] text-text-muted">
                  {childCount} 章{vol.summary ? ` · ${vol.summary.slice(0, 20)}...` : ''}
                </p>
              </button>
            </div>
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
          <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
            <div className="text-xs text-text-secondary">
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
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setPendingGeneration(null)}
                className="px-2.5 py-1 text-xs text-text-muted border border-border rounded hover:text-text-primary"
              >
                取消
              </button>
              <button
                onClick={handleConfirmGeneration}
                className="px-2.5 py-1 text-xs text-white bg-accent rounded hover:bg-accent-hover"
              >
                确认生成
              </button>
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
          <PreviewPanel
            label={previewTargetId != null ? '将补全当前卷的卷纲' : `将创建 ${previewVolumes.length} 个卷`}
            items={previewVolumes}
            onConfirm={handleConfirmVolumes}
            onCancel={handleCancelPreview}
          />
        )}

        {/* 采纳预览：章节 */}
        {previewChapters && (
          <PreviewPanel
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
                    onClick={() => prepareGeneration({ kind: 'single-volume', volumeId: selectedVol.id! })}
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
                <div className="flex items-center gap-2">
                  {visibleChapterIds.length > 0 && (
                    !chapterMultiSelect ? (
                      <button
                        onClick={handleEnterChapterMultiSelect}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-error border border-border rounded-md transition-colors"
                        title="进入章节多选删除"
                      >
                        <CheckSquare className="w-3.5 h-3.5" /> 多选删除
                      </button>
                    ) : (
                      <button
                        onClick={handleExitChapterMultiSelect}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary border border-border rounded-md transition-colors"
                      >
                        <X className="w-3.5 h-3.5" /> 退出多选
                      </button>
                    )
                  )}
                  {!hasBlocks && !chapterMultiSelect && (
                    <StructureMenu onSelect={handleAddStructure} />
                  )}
                </div>
              </div>

              {/* 章节多选操作栏 */}
              {chapterMultiSelect && (
                <div className="flex items-center justify-between gap-2 mb-2 px-3 py-2 bg-bg-surface border border-border rounded-md">
                  <button
                    onClick={toggleChapterSelectAll}
                    disabled={visibleChapterIds.length === 0}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary hover:text-accent disabled:opacity-40"
                  >
                    {selectedChapterIds.size === visibleChapterIds.length && visibleChapterIds.length > 0
                      ? <CheckSquare className="w-3.5 h-3.5 text-accent" />
                      : <Square className="w-3.5 h-3.5 text-text-muted" />}
                    {selectedChapterIds.size === visibleChapterIds.length && visibleChapterIds.length > 0 ? '取消全选' : '全选'}
                  </button>
                  <span className="text-xs text-text-muted">已选 {selectedChapterIds.size}/{visibleChapterIds.length}</span>
                  <button
                    onClick={handleBatchDeleteChapters}
                    disabled={selectedChapterIds.size === 0}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-error bg-error/10 border border-error/40 rounded hover:bg-error/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> 删除选中 ({selectedChapterIds.size})
                  </button>
                </div>
              )}

              {/* 故事块模式 */}
              {hasBlocks && (
                <div className="space-y-3 mb-3">
                  {selectedVolBlocks.map(block => {
                    const blockChapters = normalizedNodes.filter(n => n.parentId === block.id && n.type === 'chapter').sort((a, b) => a.order - b.order)
                    return (
                      <StoryBlockSection
                        key={block.id}
                        block={block}
                        chapters={blockChapters}
                        onUpdateNode={updateNode}
                        onDeleteNode={deleteNode}
                        onAddChapter={() => handleAddChapter(block.id!)}
                        onOpenChapter={onOpenChapter}
                        onReorder={(ids) => reorderNodes(ids)}
                        onInsertAfter={(chId) => handleInsertChapterAfter(chId, block.id!)}
                        onGenerateChapter={(chapterId) => prepareGeneration({ kind: 'single-chapter', chapterId })}
                        onMoveChapter={handleMoveChapter}
                        activeChapterDrag={activeChapterDrag}
                        getActiveChapterDrag={getActiveChapterDrag}
                        onChapterDragStart={beginChapterDrag}
                        onChapterDragEnd={clearActiveChapterDrag}
                        chapterMultiSelect={chapterMultiSelect}
                        selectedChapterIds={selectedChapterIds}
                        onToggleChapterSelect={toggleChapterSelect}
                      />
                    )
                  })}
                  {!chapterMultiSelect && (
                    <button onClick={() => handleAddStructure('custom')}
                      className="w-full py-2 text-xs text-text-muted border border-dashed border-border rounded-lg hover:text-accent hover:border-accent/50 transition-colors">
                      + 添加故事块
                    </button>
                  )}
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
                      <ChapterRow
                        key={ch.id} ch={ch} idx={idx}
                        onUpdate={updateNode} onDelete={deleteNode} onOpen={onOpenChapter}
                        dnd={directChaptersDnD.itemDnD(ch.id)}
                        onInsertAfter={() => handleInsertChapterAfter(ch.id!, selectedVol.id!)}
                        onGenerate={() => prepareGeneration({ kind: 'single-chapter', chapterId: ch.id! })}
                        parentId={selectedVol.id!}
                        onMoveChapter={handleMoveChapter}
                        activeChapterDrag={activeChapterDrag}
                        getActiveChapterDrag={getActiveChapterDrag}
                        onChapterDragStart={beginChapterDrag}
                        onChapterDragEnd={clearActiveChapterDrag}
                        chapterMultiSelect={chapterMultiSelect}
                        checked={ch.id != null && selectedChapterIds.has(ch.id)}
                        onToggleSelect={() => ch.id != null && toggleChapterSelect(ch.id)}
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

function ChapterRow({
  ch,
  idx,
  onUpdate,
  onDelete,
  onOpen,
  dnd,
  onInsertAfter,
  onGenerate,
  parentId,
  onMoveChapter,
  activeChapterDrag,
  getActiveChapterDrag,
  onChapterDragStart,
  onChapterDragEnd,
  chapterMultiSelect,
  checked,
  onToggleSelect,
}: {
  ch: { id?: number; title: string; summary: string }
  idx: number
  onUpdate: (id: number, patch: Record<string, string>) => void
  onDelete: (id: number) => void
  onOpen?: (id: number) => void
  dnd?: ItemDnD
  onInsertAfter?: () => void
  onGenerate?: () => void
  parentId?: number
  onMoveChapter?: (chapterId: number, targetParentId: number, index: number) => Promise<void>
  activeChapterDrag: ChapterDragPayload | null
  getActiveChapterDrag: GetActiveChapterDrag
  onChapterDragStart: (payload: ChapterDragPayload) => void
  onChapterDragEnd: () => void
  chapterMultiSelect?: boolean
  checked?: boolean
  onToggleSelect?: () => void
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

  const multiSelectActive = !!chapterMultiSelect
  const crossParentDrop = !multiSelectActive && parentId != null && onMoveChapter
    ? chapterDropProps({
      targetParentId: parentId,
      targetIndex: idx,
      onMoveChapter,
      getActiveChapterDrag,
      clearActiveChapterDrag: onChapterDragEnd,
    })
    : null
  const baseDropProps = !multiSelectActive ? dnd?.dropProps : undefined
  const isCrossParentTarget = !multiSelectActive && activeChapterDrag != null && activeChapterDrag.sourceParentId !== parentId
  const isOver = !multiSelectActive && (dnd?.isOver || isCrossParentTarget)

  return (
    <div
      {...(baseDropProps ?? {})}
      onDragOver={(event) => {
        if (multiSelectActive) return
        if (isCrossParentTarget) {
          crossParentDrop?.onDragOver(event)
          return
        }
        baseDropProps?.onDragOver(event)
      }}
      onDrop={(event) => {
        if (multiSelectActive) return
        const payload = readChapterDragPayload(event) ?? getActiveChapterDrag()
        if (crossParentDrop && payload && payload.sourceParentId !== parentId) {
          void crossParentDrop.onDrop(event)
          return
        }
        baseDropProps?.onDrop(event)
      }}
      className={`flex items-start gap-1 px-2 py-2 bg-bg-surface border rounded-md group transition-colors ${
        multiSelectActive && checked
          ? 'border-accent ring-1 ring-accent/40 bg-accent/5'
          : isOver
            ? 'border-accent ring-1 ring-accent/50'
            : 'border-border hover:border-accent/30'
      } ${dnd?.isDragging ? 'opacity-40' : ''}`}
    >
      {/* 多选模式下显示复选框；否则显示拖拽手柄 */}
      {multiSelectActive ? (
        <button
          onClick={() => onToggleSelect?.()}
          className="shrink-0 mt-1 text-text-muted hover:text-accent"
          title={checked ? '取消选中' : '选中'}
        >
          {checked
            ? <CheckSquare className="w-4 h-4 text-accent" />
            : <Square className="w-4 h-4" />}
        </button>
      ) : dnd && (
        <span
          {...dnd.dragHandleProps}
          onDragStart={(event) => {
            dnd.dragHandleProps.onDragStart(event)
            if (ch.id != null) {
              const payload = {
                chapterId: ch.id,
                sourceParentId: parentId ?? null,
              } satisfies ChapterDragPayload
              onChapterDragStart(payload)
              event.dataTransfer.setData(OUTLINE_CHAPTER_DRAG_MIME, JSON.stringify(payload))
            }
          }}
          onDragEnd={() => {
            dnd.dragHandleProps.onDragEnd()
            onChapterDragEnd()
          }}
          data-outline-chapter-id={ch.id}
          title="拖动调整章节顺序"
          className="shrink-0 mt-1 cursor-grab active:cursor-grabbing text-text-muted/40 group-hover:text-text-muted"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>
      )}
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
      {/* 多选模式下隐藏右侧操作按钮 */}
      {!multiSelectActive && (
        <div className={`flex items-center gap-0.5 transition-opacity shrink-0 mt-1 ${
          !ch.summary.trim() && onGenerate ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          {!ch.summary.trim() && onGenerate && (
            <button onClick={onGenerate} className="p-1 text-text-muted hover:text-accent rounded" title="AI 生成本章章纲">
              <Sparkles className="w-3.5 h-3.5" />
            </button>
          )}
          {onInsertAfter && (
            <button onClick={onInsertAfter} className="p-1 text-text-muted hover:text-accent rounded" title="在此章下方插入一章">
              <CornerDownRight className="w-3.5 h-3.5" />
            </button>
          )}
          {onOpen && (
            <button onClick={() => onOpen(ch.id!)} className="p-1 text-text-muted hover:text-accent rounded" title="编辑章节">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => onDelete(ch.id!)} className="p-1 text-text-muted hover:text-error rounded">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── 故事块区域 ──

function StoryBlockSection({
  block,
  chapters,
  onUpdateNode,
  onDeleteNode,
  onAddChapter,
  onOpenChapter,
  onReorder,
  onInsertAfter,
  onGenerateChapter,
  onMoveChapter,
  activeChapterDrag,
  getActiveChapterDrag,
  onChapterDragStart,
  onChapterDragEnd,
  chapterMultiSelect,
  selectedChapterIds,
  onToggleChapterSelect,
}: {
  block: { id?: number; title: string; summary: string }
  chapters: { id?: number; title: string; summary: string }[]
  onUpdateNode: (id: number, patch: Record<string, string>) => void
  onDeleteNode: (id: number) => void
  onAddChapter: () => void
  onOpenChapter?: (id: number) => void
  onReorder: (orderedIds: number[]) => void
  onInsertAfter: (chapterId: number) => void
  onGenerateChapter: (chapterId: number) => void
  onMoveChapter: (chapterId: number, targetParentId: number, index: number) => Promise<void>
  activeChapterDrag: ChapterDragPayload | null
  getActiveChapterDrag: GetActiveChapterDrag
  onChapterDragStart: (payload: ChapterDragPayload) => void
  onChapterDragEnd: () => void
  chapterMultiSelect?: boolean
  selectedChapterIds?: Set<number>
  onToggleChapterSelect?: (chapterId: number) => void
}) {
  const dialog = useDialog()
  const [expanded, setExpanded] = useState(true)
  const blockChaptersDnD = useDragReorder(chapters.map(c => c.id), onReorder)
  const handleDeleteBlock = async () => {
    if (!block.id) return
    const ok = await dialog.confirm({
      title: `删除故事块「${block.title}」？`,
      message: '其下章节也会被删除，此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (ok) onDeleteNode(block.id)
  }
  const multiSelectActive = !!chapterMultiSelect
  const dropToBlockEnd = !multiSelectActive && block.id != null
    ? chapterDropProps({
      targetParentId: block.id,
      targetIndex: chapters.length,
      onMoveChapter,
      getActiveChapterDrag,
      clearActiveChapterDrag: onChapterDragEnd,
    })
    : null

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* 故事块头 */}
      <div
        onDragOver={(event) => { if (!multiSelectActive) dropToBlockEnd?.onDragOver(event) }}
        onDrop={(event) => { if (!multiSelectActive && dropToBlockEnd) void dropToBlockEnd.onDrop(event) }}
        className="flex items-center gap-2 px-3 py-2 bg-bg-elevated"
      >
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
        {!multiSelectActive && (
          <>
            <button onClick={onAddChapter} className="p-1 text-text-muted hover:text-accent rounded" title="添加章节">
              <Plus className="w-3 h-3" />
            </button>
            <button onClick={() => { void handleDeleteBlock() }} className="p-1 text-text-muted hover:text-error rounded">
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
      {/* 故事块摘要（多选模式下隐藏，节省空间） */}
      {!multiSelectActive && (
        <CInput
          value={block.summary}
          onChange={e => onUpdateNode(block.id!, { summary: e.target.value })}
          placeholder="故事块描述..."
          className="w-full px-3 py-1.5 bg-bg-surface text-text-muted text-xs border-b border-border focus:outline-none"
        />
      )}
      {/* 章节列表 */}
      {expanded && (
        <div className="p-2 space-y-1">
          {chapters.length === 0 ? (
            multiSelectActive ? (
              <div className="text-center py-3 text-text-muted text-xs">无章节</div>
            ) : (
              <div
                onDragOver={(event) => dropToBlockEnd?.onDragOver(event)}
                onDrop={(event) => { if (dropToBlockEnd) void dropToBlockEnd.onDrop(event) }}
                className="text-center py-3 text-text-muted text-xs border border-dashed border-transparent hover:border-accent/40 rounded"
              >
                点击 + 添加章节
              </div>
            )
          ) : (
            chapters.map((ch, idx) => (
              <ChapterRow
                key={ch.id} ch={ch} idx={idx}
                onUpdate={onUpdateNode} onDelete={onDeleteNode} onOpen={onOpenChapter}
                dnd={blockChaptersDnD.itemDnD(ch.id)}
                onInsertAfter={() => onInsertAfter(ch.id!)}
                onGenerate={() => onGenerateChapter(ch.id!)}
                parentId={block.id!}
                onMoveChapter={onMoveChapter}
                activeChapterDrag={activeChapterDrag}
                getActiveChapterDrag={getActiveChapterDrag}
                onChapterDragStart={onChapterDragStart}
                onChapterDragEnd={onChapterDragEnd}
                chapterMultiSelect={chapterMultiSelect}
                checked={ch.id != null && selectedChapterIds?.has(ch.id)}
                onToggleSelect={() => ch.id != null && onToggleChapterSelect?.(ch.id)}
              />
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
