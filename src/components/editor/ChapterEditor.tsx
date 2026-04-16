import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Save, FileText, Eye } from 'lucide-react'
import { useChapterStore } from '../../stores/chapter'
import { useOutlineStore } from '../../stores/outline'
import { useWorldviewStore } from '../../stores/worldview'
import { useCharacterStore } from '../../stores/character'
import { useAIStream } from '../../hooks/useAIStream'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { buildChapterContentPrompt, buildContinuePrompt, buildPolishPrompt, buildExpandPrompt, buildDeAIPrompt } from '../../lib/ai/prompts/chapter'
import { buildWorldContext, buildCharacterContext } from '../../lib/ai/context-builder'
import { htmlToPlainText, plainTextToHtml, countWords } from '../../lib/utils/html'
import AIStreamOutput from '../shared/AIStreamOutput'
import RichEditor, { type RichEditorHandle } from './RichEditor'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
  outlineNodeId?: number | null
}

export default function ChapterEditor({ project, outlineNodeId }: Props) {
  const { chapters, currentChapter, selectChapter, addChapter, updateChapter, loadAll: loadChapters } = useChapterStore()
  const { nodes } = useOutlineStore()
  const { worldview, storyCore, powerSystem } = useWorldviewStore()
  const { characters } = useCharacterStore()

  // content 为 HTML 字符串；旧数据是纯文本，RichEditor 内部会自动包装
  const [content, setContent] = useState('')
  const [plainText, setPlainText] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [aiAction, setAIAction] = useState<string>('')
  const [customInstruction, setCustomInstruction] = useState('')
  const ai = useAIStream()
  const editorRef = useRef<RichEditorHandle>(null)

  // 字数（基于纯文本）
  const wordCount = useMemo(() => countWords(plainText), [plainText])

  // 有未保存内容时阻止页面关闭
  useBeforeUnload(content !== savedContent && plainText.length > 0)

  useEffect(() => { loadChapters(project.id!) }, [project.id, loadChapters])

  // 如果从大纲进入，选择/创建对应章节
  useEffect(() => {
    if (!outlineNodeId) return
    const existing = chapters.find(c => c.outlineNodeId === outlineNodeId)
    if (existing?.id) {
      selectChapter(existing.id)
    }
  }, [outlineNodeId, chapters, selectChapter])

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
  const worldCtx = buildWorldContext(worldview, storyCore, powerSystem)
  const charCtx = buildCharacterContext(characters)

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
  const handleGenerate = () => {
    if (!outlineNode) return
    const prevChapter = chapters.filter(c => c.order < (currentChapter?.order || 0)).pop()
    const prevEnding = htmlToPlainText(prevChapter?.content || '').slice(-500)
    const messages = buildChapterContentPrompt(outlineNode.title, outlineNode.summary, worldCtx, charCtx, prevEnding)
    setAIAction('generate')
    ai.start(messages)
  }

  const handleContinue = () => {
    if (!plainText || !outlineNode) return
    const messages = buildContinuePrompt(plainText, outlineNode.summary, worldCtx)
    setAIAction('continue')
    ai.start(messages)
  }

  const handlePolish = () => {
    const selected = editorRef.current?.getSelectedText() || plainText.slice(-1000)
    if (!selected) return
    const messages = buildPolishPrompt(selected, customInstruction || '优化文笔，使表达更生动')
    setAIAction('polish')
    ai.start(messages)
  }

  const handleExpand = () => {
    const selected = editorRef.current?.getSelectedText() || plainText.slice(-500)
    if (!selected) return
    const messages = buildExpandPrompt(selected)
    setAIAction('expand')
    ai.start(messages)
  }

  const handleDeAI = () => {
    const selected = editorRef.current?.getSelectedText() || plainText.slice(-1000)
    if (!selected) return
    const messages = buildDeAIPrompt(selected)
    setAIAction('deai')
    ai.start(messages)
  }

  const handleAcceptAI = (text: string) => {
    if (!editorRef.current) return
    const html = plainTextToHtml(text)

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
        <div className="mb-3 p-3 bg-bg-elevated border border-border rounded-lg text-xs text-text-muted max-h-48 overflow-y-auto whitespace-pre-wrap">
          <p className="font-medium text-text-secondary mb-1">📋 发送给 AI 的上下文：</p>
          {worldCtx && <p>【世界观】{worldCtx.slice(0, 500)}...</p>}
          {charCtx && <p>【角色】{charCtx.slice(0, 300)}...</p>}
          {outlineNode && <p>【章节大纲】{outlineNode.title}：{outlineNode.summary}</p>}
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
        <input value={customInstruction} onChange={e => setCustomInstruction(e.target.value)}
          placeholder="自定义指令..."
          className="flex-1 min-w-[150px] px-2 py-1.5 bg-bg-surface border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent" />
      </div>

      {/* AI 输出 */}
      {(ai.output || ai.isStreaming || ai.error) && (
        <div className="mb-3">
          <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error}
            onStop={ai.stop} onAccept={handleAcceptAI} onRetry={() => {
              if (aiAction === 'generate') handleGenerate()
              else if (aiAction === 'continue') handleContinue()
            }} />
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
    </div>
  )
}
