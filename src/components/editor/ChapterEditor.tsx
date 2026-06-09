import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Save, FileText, Eye, ClipboardList, CheckSquare, Square, BookOpenCheck, ShieldCheck, StickyNote } from 'lucide-react'
import { useChapterStore } from '../../stores/chapter'
import { useOutlineStore } from '../../stores/outline'
import { useStateCardStore } from '../../stores/state-card'
import { useAIStream } from '../../hooks/useAIStream'
import { CInput } from '../shared/CompositionInput'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { buildChapterContentPrompt, buildContinuePrompt, buildPolishPrompt, buildExpandPrompt, buildDeAIPrompt } from '../../lib/ai/adapters/chapter-adapter'
import { buildStateExtractPrompt, parseStateDiffs } from '../../lib/ai/adapters/state-extract-adapter'
import { buildSummaryPrompt } from '../../lib/ai/adapters/summary-adapter'
import { buildGenreConstraintContext } from '../../lib/ai/genre-metadata'
import { buildStylePromptInjection } from '../../lib/ai/writing-styles'
import { assembleContext } from '../../lib/registry/assemble-context'
import { useCreativeRulesStore } from '../../stores/project-singletons'
import { useStoryArcStore } from '../../stores/story-arc'
import { useForeshadowStore } from '../../stores/foreshadow'
import { htmlToPlainText, plainTextToHtml, countWords } from '../../lib/utils/html'
import AIStreamOutput from '../shared/AIStreamOutput'
import ContextBudgetBar from '../shared/ContextBudgetBar'
import { useAIConfigStore } from '../../stores/ai-config'
import { analyzeContextSegments, calculateBudget, type ContextBudget } from '../../lib/ai/context-budget'
import StateDiffModal from '../state/StateDiffModal'
import RichEditor, { type RichEditorHandle } from './RichEditor'
import EmotionBeatCard from './EmotionBeatCard'
import OutlinePreview from '../outline/OutlinePreview'
import ReviewPanel from './ReviewPanel'
import NotePanel from './NotePanel'
import FloatingToolbar from './FloatingToolbar'
import type { Project, StateDiffItem } from '../../lib/types'

/** 生成任务类型(原 memory-builder 三层记忆已被 assembleContext 取代,此类型仅用于调试日志标签) */
type MemoryTaskType = 'write' | 'plan' | 'review'

interface Props {
  project: Project
  outlineNodeId?: number | null
}

export default function ChapterEditor({ project, outlineNodeId }: Props) {
  const { chapters, currentChapter, selectChapter, addChapter, updateChapter, loadAll: loadChapters } = useChapterStore()
  const { nodes } = useOutlineStore()
  const { cards: stateCards, loadAll: loadStateCards, buildStateContext, buildSelectiveStateContext, applyDiffs } = useStateCardStore()
  const { creativeRules } = useCreativeRulesStore()
  const { loadAll: loadArcs } = useStoryArcStore()
  const { buildForeshadowContext, loadAll: loadForeshadows } = useForeshadowStore()

  // content 为 HTML 字符串；旧数据是纯文本，RichEditor 内部会自动包装
  const [content, setContent] = useState('')
  const [plainText, setPlainText] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [aiAction, setAIAction] = useState<string>('')
  const [customInstruction, setCustomInstruction] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [pendingDiffs, setPendingDiffs] = useState<StateDiffItem[] | null>(null)
  // A2: 按需召回 — 手动额外勾选/取消的状态卡 ID
  const [extraStateIds, setExtraStateIds] = useState<number[]>([])
  const [showStatePreview, setShowStatePreview] = useState(false)
  const ai = useAIStream()
  const stateAI = useAIStream()
  const summaryAI = useAIStream()
  const editorRef = useRef<RichEditorHandle>(null)
  // Phase A1: 自动流程标记
  const [autoProcessing, setAutoProcessing] = useState<'idle' | 'extracting' | 'summarizing'>('idle')
  const [showOutlinePreview, setShowOutlinePreview] = useState(false)
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const [showNotePanel, setShowNotePanel] = useState(false)
  const [contextBudget, setContextBudget] = useState<ContextBudget | null>(null)
  const aiConfig = useAIConfigStore(s => s.config)

  // 字数（基于纯文本）
  const wordCount = useMemo(() => countWords(plainText), [plainText])

  // 有未保存内容时阻止页面关闭
  useBeforeUnload(content !== savedContent && plainText.length > 0)

  useEffect(() => { loadChapters(project.id!) }, [project.id, loadChapters])
  useEffect(() => { loadStateCards(project.id!) }, [project.id, loadStateCards])
  useEffect(() => { loadArcs(project.id!) }, [project.id, loadArcs])
  useEffect(() => { loadForeshadows(project.id!) }, [project.id, loadForeshadows])

  // 如果从大纲进入，选择/创建对应章节（自动创建）
  useEffect(() => {
    if (!outlineNodeId) return
    const existing = chapters.find(c => c.outlineNodeId === outlineNodeId)
    if (existing?.id) {
      selectChapter(existing.id)
    } else {
      // 自动创建 chapter 记录
      const node = nodes.find(n => n.id === outlineNodeId)
      if (node) {
        addChapter({
          projectId: project.id!, outlineNodeId, title: node.title,
          content: '', wordCount: 0, status: 'outline', order: chapters.length, notes: '',
        })
      }
    }
  }, [outlineNodeId, chapters, selectChapter, nodes, addChapter, project.id])

  // 切换章节：同步到本地 state（RichEditor 会基于 value 重建内容）
  useEffect(() => {
    const raw = currentChapter?.content || ''
    setContent(raw)
    setPlainText(htmlToPlainText(raw))
  }, [currentChapter])

  // 切换章节时同步 savedContent（只在章节 id 变化时）
  useEffect(() => {
    setSavedContent(currentChapter?.content || '')
  }, [currentChapter?.id])

  // 自动保存
  useAutoSave(content, useCallback(async (html: string) => {
    if (currentChapter?.id) {
      const wc = countWords(htmlToPlainText(html))
      await updateChapter(currentChapter.id, { content: html, wordCount: wc })
      setSavedContent(html)
    }
  }, [currentChapter?.id, updateChapter]))

  const outlineNode = currentChapter ? nodes.find(n => n.id === currentChapter.outlineNodeId) : null
  // 多世界：沿父链找到所属卷的 worldGroupId
  const chapterWorldGroupId = useMemo(() => {
    if (!project.enableMultiWorld || !outlineNode) return null
    let cur: typeof outlineNode | undefined = outlineNode
    const guard = new Set<number>()
    while (cur && !guard.has(cur.id!)) {
      if (cur.worldGroupId != null) return cur.worldGroupId
      guard.add(cur.id!)
      cur = cur.parentId != null ? nodes.find(n => n.id === cur!.parentId) : undefined
    }
    return null
  }, [project.enableMultiWorld, outlineNode, nodes])

  const [worldCtx, setWorldCtx] = useState('')
  const [charCtx, setCharCtx] = useState('')
  useEffect(() => {
    let cancelled = false
    assembleContext({
      projectId: project.id!,
      worldGroupId: chapterWorldGroupId ?? null,
      outlineNodeId: outlineNode?.id ?? null,
      chapterId: currentChapter?.id ?? null,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: ['contextMemo', 'chapterOutline', 'worldview', 'storyCore', 'powerSystem', 'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations'],
    }).then(assembled => {
      if (cancelled) return
      const charIdx = assembled.included.indexOf('characters')
      setWorldCtx(assembled.text)
      setCharCtx(charIdx >= 0 ? assembled.segments[charIdx]?.content ?? '' : '')
    })
    return () => { cancelled = true }
  }, [project.id, chapterWorldGroupId, outlineNode?.id, currentChapter?.id, aiConfig.provider, aiConfig.model])

  // A2: 按需召回 — 根据章节大纲+标题+已有文本筛选相关状态卡
  const selectiveState = useMemo(() => {
    if (!stateCards.length) return { text: '', matchedIds: [] as number[], allIds: [] as number[] }
    const refParts: string[] = []
    if (outlineNode?.title) refParts.push(outlineNode.title)
    if (outlineNode?.summary) refParts.push(outlineNode.summary)
    if (currentChapter?.title) refParts.push(currentChapter.title)
    if (plainText) refParts.push(plainText.slice(-2000))
    const ref = refParts.join(' ')
    if (!ref.trim()) return { text: buildStateContext(), matchedIds: stateCards.map(c => c.id!), allIds: stateCards.map(c => c.id!) }
    return buildSelectiveStateContext(ref, extraStateIds)
  }, [stateCards, outlineNode?.title, outlineNode?.summary, currentChapter?.title, plainText, extraStateIds, buildSelectiveStateContext, buildStateContext])

  const handleCreateFromOutline = async () => {
    if (!outlineNodeId) return
    const node = nodes.find(n => n.id === outlineNodeId)
    if (!node) return
    await addChapter({
      projectId: project.id!, outlineNodeId, title: node.title,
      content: '', wordCount: 0, status: 'outline', order: chapters.length, notes: '',
    })
  }

  // AI 操作 —— 所有 AI 交互都基于纯文本
  // Phase A2: 使用三层记忆构建器生成完整上下文
  const buildFullWorldCtx = async (taskType: MemoryTaskType = 'write') => {
    // 引用手法注入（Phase 20）
    let citedIds: number[] = []
    try {
      citedIds = JSON.parse(creativeRules?.citedReferenceIds || '[]')
    } catch { /* ignore */ }

    // 大师洞察注入（Phase 19-d）
    let insightIds: number[] = []
    try {
      insightIds = JSON.parse(creativeRules?.citedInsightIds || '[]')
    } catch { /* ignore */ }

    const stateRef = [
      outlineNode?.title,
      outlineNode?.summary,
      currentChapter?.title,
      plainText.slice(-2000),
    ].filter(Boolean).join(' ')

    const assembled = await assembleContext({
      projectId: project.id!,
      worldGroupId: chapterWorldGroupId ?? null,
      outlineNodeId: outlineNode?.id ?? null,
      chapterId: currentChapter?.id ?? null,
      currentChapterOrder: currentChapter?.order ?? 0,
      provider: aiConfig.provider,
      model: aiConfig.model,
      citedReferenceIds: citedIds,
      masterInsightIds: insightIds,
      stateReferenceText: stateRef,
      extraStateIds,
      sourceKeys: [
        'contextMemo',
        'chapterOutline',
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
        'storyArcs',
        'emotionBeats',
        'stateCards',
        'references',
        'masterInsights',
      ],
    })

    console.log(`[assembleContext] ${taskType} 模式 — included:${assembled.included.join(',')} trimmed:${assembled.trimmed.join(',') || 'none'} tokens:${assembled.totalInputTokens}`)

    // Phase E: 题材约束 + 写作风格注入
    const genreCtx = buildGenreConstraintContext(project.genre)
    const styleCtx = project.writingStyleId ? buildStylePromptInjection(project.writingStyleId) : ''

    const parts = [assembled.text]
    if (genreCtx) parts.push(genreCtx)
    if (styleCtx) parts.push(styleCtx)
    const worldRulesIdx = assembled.included.indexOf('worldRules')
    return {
      text: parts.filter(Boolean).join('\n\n'),
      segments: assembled.segments,
      worldRulesContext: worldRulesIdx >= 0 ? assembled.segments[worldRulesIdx]?.content ?? '' : '',
    }
  }

  const handleGenerate = async () => {
    if (!outlineNode) return
    const prevChapter = chapters.filter(c => c.order < (currentChapter?.order || 0)).pop()
    const prevEnding = htmlToPlainText(prevChapter?.content || '').slice(-500)
    const { text: fullCtx, segments: assembledSegments, worldRulesContext } = await buildFullWorldCtx('write')
    const messages = buildChapterContentPrompt(
      outlineNode.title,
      outlineNode.summary,
      fullCtx,
      charCtx,
      prevEnding,
      worldRulesContext,
    )

    // Phase 21.3: 计算上下文预算
    const segments = analyzeContextSegments([
      { label: 'System Prompt', content: messages.find(m => m.role === 'system')?.content || '', layer: 'L0' },
      { label: '章节大纲', content: outlineNode.summary || '', layer: 'L1' },
      { label: '前文结尾', content: prevEnding, layer: 'L1' },
      ...assembledSegments,
      { label: 'User Prompt', content: messages.find(m => m.role === 'user')?.content || '', layer: 'L1' },
    ])
    setContextBudget(calculateBudget(aiConfig.provider, aiConfig.model, segments))

    setAIAction('generate')
    ai.start(messages, undefined, { category: 'chapter.content', projectId: project.id! })
  }

  const handleContinue = async () => {
    if (!plainText || !outlineNode) return
    const { text: fullCtx } = await buildFullWorldCtx('write')
    const messages = buildContinuePrompt(plainText, outlineNode.summary, fullCtx)
    setAIAction('continue')
    ai.start(messages, undefined, { category: 'chapter.continue', projectId: project.id! })
  }

  const handlePolish = () => {
    const selected = editorRef.current?.getSelectedText() || plainText.slice(-1000)
    if (!selected) return
    const messages = buildPolishPrompt(selected, customInstruction || '优化文笔，使表达更生动')
    setAIAction('polish')
    ai.start(messages, undefined, { category: 'chapter.polish', projectId: project.id! })
  }

  const handleExpand = () => {
    const selected = editorRef.current?.getSelectedText() || plainText.slice(-500)
    if (!selected) return
    const messages = buildExpandPrompt(selected)
    setAIAction('expand')
    ai.start(messages, undefined, { category: 'chapter.expand', projectId: project.id! })
  }

  const handleDeAI = () => {
    const selected = editorRef.current?.getSelectedText() || plainText.slice(-1000)
    if (!selected) return
    const messages = buildDeAIPrompt(selected)
    setAIAction('deai')
    ai.start(messages, undefined, { category: 'chapter.deai', projectId: project.id! })
  }

  // ── 状态提取 ──
  const handleExtractState = async () => {
    if (!currentChapter || !plainText) return
    setExtracting(true)
    try {
      const stateCtx = buildSelectiveStateContext(plainText, extraStateIds).text
      const chapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
      const messages = buildStateExtractPrompt(stateCtx, chapterTitle, plainText)
      console.log('[StateExtract] 开始提取，章节:', chapterTitle)
      const raw = await stateAI.start(messages, undefined, { category: 'state.extract', projectId: project.id! })
      const { diffs, error } = parseStateDiffs(raw)
      if (error) {
        console.error('[StateExtract] 解析失败:', error)
      }
      setPendingDiffs(diffs as StateDiffItem[])
    } catch (err) {
      console.error('[StateExtract] 提取失败:', err)
    } finally {
      setExtracting(false)
    }
  }

  const handleAcceptDiffs = async (accepted: StateDiffItem[]) => {
    try {
      await applyDiffs(project.id!, accepted, currentChapter?.id)
      console.log(`[StateExtract] ${accepted.length} 条变更已写入状态表`)
    } catch (err) {
      console.error('[StateExtract] 写入状态表失败:', err)
    }
    setPendingDiffs(null)
    stateAI.reset()
  }

  // ── Phase A3: 自动生成章节摘要 ──
  const handleAutoSummary = async (text: string) => {
    if (!currentChapter?.id) return
    setAutoProcessing('summarizing')
    try {
      const chapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
      const messages = buildSummaryPrompt(chapterTitle, text)
      console.log('[Summary] 自动生成章节摘要:', chapterTitle)
      const raw = await summaryAI.start(messages, undefined, { category: 'summary', projectId: project.id! })
      if (raw) {
        const summary = raw.trim()
        await updateChapter(currentChapter.id, { summary })
        console.log('[Summary] 摘要已保存:', summary.slice(0, 50) + '...')
      }
    } catch (err) {
      console.error('[Summary] 摘要生成失败:', err)
    } finally {
      setAutoProcessing('idle')
      summaryAI.reset()
    }
  }

  // ── Phase A1: 生成正文完成后的自动流程 ──
  // 接受AI生成的文本后，自动触发状态提取 → 摘要生成
  const handleAutoPostGenerate = async (text: string) => {
    // 1. 自动提取状态
    setAutoProcessing('extracting')
    try {
      const stateCtx = buildSelectiveStateContext(text, extraStateIds).text
      const chapterTitle = outlineNode?.title || currentChapter?.title || '未知章节'
      const messages = buildStateExtractPrompt(stateCtx, chapterTitle, text)
      console.log('[AutoPost] 自动提取状态:', chapterTitle)
      const raw = await stateAI.start(messages, undefined, { category: 'state.extract', projectId: project.id! })
      const { diffs, error } = parseStateDiffs(raw)
      if (error) {
        console.error('[AutoPost] 状态提取解析失败:', error)
      }
      if (diffs.length > 0) {
        setPendingDiffs(diffs as StateDiffItem[])
      } else {
        console.log('[AutoPost] 本章无状态变更')
      }
    } catch (err) {
      console.error('[AutoPost] 状态提取失败:', err)
    }

    // 2. 同时自动生成摘要（不等状态审核完成）
    await handleAutoSummary(text)
  }

  const handleAcceptAI = (text: string) => {
    if (!editorRef.current) return
    const html = plainTextToHtml(text)
    const shouldAutoProcess = aiAction === 'generate' || aiAction === 'continue'

    if (aiAction === 'continue') {
      editorRef.current.appendContent(html)
    } else if (aiAction === 'generate') {
      editorRef.current.setContent(html)
      // setContent 不触发 onChange，这里手动同步
      const newHtml = editorRef.current.getHTML()
      setContent(newHtml)
      setPlainText(editorRef.current.getPlainText())
    } else {
      // polish/expand/deai：替换选区（若无选区则插入在光标处）
      editorRef.current.replaceSelection(html)
    }
    ai.reset()
    setAIAction('')

    // Phase A1: 生成/续写完成后自动触发状态提取 + 摘要生成
    if (shouldAutoProcess) {
      // 获取完整正文用于分析
      const fullText = editorRef.current.getPlainText()
      handleAutoPostGenerate(fullText)
    }
  }

  // 没有选中章节
  if (!currentChapter) {
    if (outlineNodeId) {
      const node = nodes.find(n => n.id === outlineNodeId)
      return (
        <div className="max-w-4xl flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-text-muted text-sm">章节「{node?.title}」还没有正文</p>
          <button onClick={handleCreateFromOutline}
            className="px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors">
            创建章节并开始写作
          </button>
        </div>
      )
    }
    return (
      <div className="max-w-4xl">
        <h2 className="text-xl font-bold text-text-primary mb-4">✍️ 写作</h2>
        <div className="space-y-1">
          {chapters.map(ch => (
            <button key={ch.id} onClick={() => selectChapter(ch.id!)}
              className="w-full text-left px-3 py-2 rounded-md text-sm bg-bg-surface hover:bg-bg-hover text-text-secondary transition-colors">
              <span className="text-text-primary">{ch.title}</span>
              <span className="ml-2 text-text-muted text-xs">{ch.wordCount} 字</span>
            </button>
          ))}
          {chapters.length === 0 && (
            <p className="text-text-muted text-sm text-center py-12">请先在「大纲」中创建章节，然后点击写作图标进入编辑</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-text-primary">{currentChapter.title}</h2>
          <span className="text-xs text-text-muted">{wordCount} 字</span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            currentChapter.status === 'draft' ? 'bg-warning/10 text-warning' :
            currentChapter.status === 'polished' ? 'bg-success/10 text-success' :
            'bg-bg-elevated text-text-muted'
          }`}>{currentChapter.status}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowContext(!showContext)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary">
            <Eye className="w-3.5 h-3.5" /> 上下文
          </button>
          <button onClick={() => currentChapter.id && updateChapter(currentChapter.id, { content, wordCount })}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-accent">
            <Save className="w-3.5 h-3.5" /> 保存
          </button>
        </div>
      </div>

      {/* 上下文查看器 */}
      {showContext && (
        <div className="mb-3 p-3 bg-bg-elevated border border-border rounded-lg text-xs text-text-muted max-h-64 overflow-y-auto">
          <p className="font-medium text-text-secondary mb-1">📋 发送给 AI 的上下文：</p>
          <div className="whitespace-pre-wrap">
            {worldCtx && <p>【世界观】{worldCtx.slice(0, 500)}...</p>}
            {charCtx && <p>【角色】{charCtx.slice(0, 300)}...</p>}
            {outlineNode && <p>【章节大纲】{outlineNode.title}：{outlineNode.summary}</p>}
          </div>

          {/* A2: 状态卡注入预览 */}
          {stateCards.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-1">
                <p className="font-medium text-text-secondary">
                  📋 状态卡注入（{selectiveState.matchedIds.length}/{selectiveState.allIds.length}）
                </p>
                <button onClick={() => setShowStatePreview(!showStatePreview)}
                  className="text-accent hover:text-accent-hover text-xs">
                  {showStatePreview ? '收起' : '展开调整'}
                </button>
              </div>
              {showStatePreview && (
                <div className="space-y-1 mt-1">
                  {stateCards.map(card => {
                    const isMatched = selectiveState.matchedIds.includes(card.id!)
                    const isExtra = extraStateIds.includes(card.id!)
                    return (
                      <label key={card.id} className="flex items-center gap-1.5 cursor-pointer hover:bg-bg-hover rounded px-1 py-0.5">
                        <button
                          onClick={() => {
                            if (isExtra) {
                              setExtraStateIds(extraStateIds.filter(id => id !== card.id))
                            } else if (!isMatched) {
                              setExtraStateIds([...extraStateIds, card.id!])
                            } else {
                              // 已自动匹配的，不允许取消（用户可通过不勾选来忽略）
                            }
                          }}
                          className="flex-shrink-0"
                        >
                          {isMatched || isExtra
                            ? <CheckSquare className="w-3.5 h-3.5 text-accent" />
                            : <Square className="w-3.5 h-3.5 text-text-muted" />
                          }
                        </button>
                        <span className={`px-1 py-0.5 rounded text-[10px] ${
                          card.category === 'character' ? 'bg-blue-500/10 text-blue-400' :
                          card.category === 'location' ? 'bg-green-500/10 text-green-400' :
                          card.category === 'item' ? 'bg-yellow-500/10 text-yellow-400' :
                          card.category === 'faction' ? 'bg-purple-500/10 text-purple-400' :
                          'bg-red-500/10 text-red-400'
                        }`}>{card.category === 'character' ? '角色' : card.category === 'location' ? '地点' : card.category === 'item' ? '物品' : card.category === 'faction' ? '势力' : '事件'}</span>
                        <span className={isMatched || isExtra ? 'text-text-primary' : 'text-text-muted'}>{card.entityName}</span>
                        {isMatched && !isExtra && <span className="text-[10px] text-accent/60">自动匹配</span>}
                        {isExtra && <span className="text-[10px] text-warning">手动添加</span>}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI 工具栏 */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button onClick={handleGenerate} disabled={ai.isStreaming}
          className="px-3 py-1.5 bg-accent text-white text-xs rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors">
          ✨ 生成正文
        </button>
        <button onClick={handleContinue} disabled={ai.isStreaming || !plainText}
          className="px-3 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded-md hover:text-text-primary disabled:opacity-50 transition-colors">
          📝 续写
        </button>
        <button onClick={handleExpand} disabled={ai.isStreaming}
          className="px-3 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded-md hover:text-text-primary disabled:opacity-50 transition-colors">
          📖 扩写
        </button>
        <button onClick={handlePolish} disabled={ai.isStreaming}
          className="px-3 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded-md hover:text-text-primary disabled:opacity-50 transition-colors">
          💎 润色
        </button>
        <button onClick={handleDeAI} disabled={ai.isStreaming}
          className="px-3 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded-md hover:text-text-primary disabled:opacity-50 transition-colors">
          🔥 去AI味
        </button>
        <button onClick={handleExtractState} disabled={ai.isStreaming || extracting || !plainText}
          title="AI 分析本章内容，提取角色/地点/物品等状态变更"
          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-md hover:bg-emerald-500/20 disabled:opacity-50 transition-colors">
          <ClipboardList className="w-3 h-3" />
          {extracting ? '提取中...' : '提取状态'}
        </button>
        {outlineNodeId && (
          <button onClick={() => setShowOutlinePreview(!showOutlinePreview)}
            title="大纲预览"
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
              showOutlinePreview
                ? 'bg-accent/10 text-accent'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
            }`}>
            <BookOpenCheck className="w-3 h-3" />
            大纲预览
          </button>
        )}
        <button onClick={() => setShowReviewPanel(!showReviewPanel)}
          disabled={!plainText}
          title="质量审校"
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50 ${
            showReviewPanel
              ? 'bg-success/10 text-success'
              : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}>
          <ShieldCheck className="w-3 h-3" />
          质量审校
        </button>
        <button onClick={() => setShowNotePanel(!showNotePanel)}
          title="便签"
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            showNotePanel
              ? 'bg-yellow-500/10 text-yellow-600'
              : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}>
          <StickyNote className="w-3 h-3" />
          便签
        </button>
        <CInput value={customInstruction} onChange={e => setCustomInstruction(e.target.value)}
          placeholder="自定义指令..."
          className="flex-1 min-w-[150px] px-2 py-1.5 bg-bg-surface border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent" />
      </div>

      {/* D3: 大纲预览 */}
      {showOutlinePreview && outlineNodeId && (
        <div className="mb-3">
          <OutlinePreview outlineNodeId={outlineNodeId} onClose={() => setShowOutlinePreview(false)} />
        </div>
      )}

      {/* F: 质量审校面板 */}
      {showReviewPanel && (
        <div className="mb-3">
          <ReviewPanel
            chapterContent={plainText}
            chapterTitle={outlineNode?.title || currentChapter?.title || ''}
            worldContext={worldCtx}
            characterContext={charCtx}
            prevChapterSummary={(() => {
              const prev = chapters.filter(c => c.order < (currentChapter?.order || 0)).pop()
              return prev?.summary || ''
            })()}
            nextChapterSummary={(() => {
              const next = chapters.filter(c => c.order > (currentChapter?.order || 0)).shift()
              return next?.summary || ''
            })()}
            foreshadowContext={currentChapter?.id ? buildForeshadowContext(currentChapter.id) : ''}
            stateContext={stateCards.slice(0, 10).map(sc => `${sc.category}:${sc.entityName} — ${sc.fields?.slice(0, 50)}`).join('\n')}
            onClose={() => setShowReviewPanel(false)}
          />
        </div>
      )}

      {/* H3: 便签面板 */}
      {showNotePanel && (
        <div className="mb-3">
          <NotePanel projectId={project.id!} chapterId={currentChapter?.id} onClose={() => setShowNotePanel(false)} />
        </div>
      )}

      {/* AI 输出 */}
      {/* A3: 情感节拍卡 */}
      {outlineNode && currentChapter?.id && (
        <EmotionBeatCard
          projectId={project.id!}
          chapterId={currentChapter.id}
          chapterTitle={outlineNode.title || currentChapter.title}
          chapterSummary={outlineNode.summary || ''}
          worldContext={worldCtx}
          characterContext={charCtx}
          prevChapterEnding={(() => {
            const prev = chapters.filter(c => c.order < (currentChapter?.order || 0)).pop()
            return htmlToPlainText(prev?.content || '').slice(-500)
          })()}
        />
      )}

      {/* Phase 21.3: 上下文预算条 */}
      {contextBudget && (
        <div className="mb-2">
          <ContextBudgetBar budget={contextBudget} compact={ai.isStreaming} />
        </div>
      )}

      {(ai.output || ai.isStreaming || ai.error) && (
        <div className="mb-3">
          <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error} tokenUsage={ai.tokenUsage}
            onStop={ai.stop} onAccept={handleAcceptAI} onRetry={() => {
              if (aiAction === 'generate') handleGenerate()
              else if (aiAction === 'continue') handleContinue()
            }} />
        </div>
      )}

      {/* Phase A1/A3: 自动后处理状态指示 */}
      {autoProcessing !== 'idle' && (
        <div className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <ClipboardList className="w-3.5 h-3.5 animate-pulse" />
            {autoProcessing === 'extracting' && '正在自动提取状态变更...'}
            {autoProcessing === 'summarizing' && '正在自动生成章节摘要...'}
          </div>
        </div>
      )}

      {/* Phase A3: 章节摘要显示 */}
      {currentChapter?.summary && (
        <div className="mb-3 p-3 bg-bg-elevated border border-border rounded-lg">
          <p className="text-xs text-text-muted mb-1">📝 章节摘要</p>
          <p className="text-sm text-text-secondary">{currentChapter.summary}</p>
        </div>
      )}

      {/* TipTap 富文本编辑器 */}
      <RichEditor
        ref={editorRef}
        value={content}
        onChange={(html, plain) => {
          setContent(html)
          setPlainText(plain)
        }}
        placeholder="开始写作..."
        minHeight={400}
      />

      {/* Phase 24.3: 选中文本浮动工具栏 */}
      <FloatingToolbar
        getSelectedText={() => editorRef.current?.getSelectedText() || ''}
        getSelectionRect={() => {
          const sel = window.getSelection()
          if (!sel || sel.isCollapsed || !sel.rangeCount) return null
          return sel.getRangeAt(0).getBoundingClientRect()
        }}
        replaceSelectedText={(text) => {
          editorRef.current?.replaceSelection(text)
        }}
        disabled={ai.isStreaming}
      />

      {/* 作者笔记 */}
      <div className="mt-3">
        <label className="block text-xs text-text-muted mb-1">
          <FileText className="w-3 h-3 inline mr-1" />作者笔记
        </label>
        <textarea
          value={currentChapter.notes || ''}
          onChange={e => currentChapter.id && updateChapter(currentChapter.id, { notes: e.target.value })}
          placeholder="写给自己的备忘..."
          rows={2}
          className="w-full p-2 bg-bg-elevated border border-border rounded text-xs text-text-muted resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 状态变更审核弹窗 */}
      {pendingDiffs !== null && (
        <StateDiffModal
          diffs={pendingDiffs}
          chapterTitle={outlineNode?.title || currentChapter.title || ''}
          onConfirm={handleAcceptDiffs}
          onCancel={() => { setPendingDiffs(null); stateAI.reset() }}
          showSkip={autoProcessing !== 'idle'}
        />
      )}
    </div>
  )
}
