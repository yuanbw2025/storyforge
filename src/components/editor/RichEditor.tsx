import { forwardRef, useCallback, useImperativeHandle, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  BackgroundColor,
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from '@tiptap/extension-text-style'
import { toHtml, countWords } from '../../lib/utils/html'
import { loadEditorTypography, saveEditorTypography, applyEditorTypography, type EditorTypography } from '../../lib/editor-typography'
import {
  filterEditorEntityReferences,
  type EditorEntityReference,
} from '../../lib/editor/entity-reference'
import {
  BlockSpacing,
  normalizeThemeAdaptiveColorHtml,
  resolveColorForInput,
  type PendingTextStyle,
} from '../../lib/editor/rich-editor-theme'
import RichEditorEntityOverlays from './RichEditorEntityOverlays'
import RichEditorToolbar from './RichEditorToolbar'

export interface RichEditorHandle {
  /** 在光标位置插入 HTML 内容（若有选区则替换选区） */
  insertContent: (html: string) => void
  /** 将内容追加到文档末尾 */
  appendContent: (html: string) => void
  /** 替换当前选区为 HTML 内容 */
  replaceSelection: (html: string) => void
  /** 获取选中文字（纯文本） */
  getSelectedText: () => string
  /** 获取全部 HTML */
  getHTML: () => string
  /** 获取全部纯文本 */
  getPlainText: () => string
  /** 获取字数（去空白字符） */
  getWordCount: () => number
  /** 设置全部内容（HTML 或纯文本皆可，内部会自动转换） */
  setContent: (content: string) => void
  /** 聚焦编辑器 */
  focus: () => void
  /** 获取底层 editor 实例（高级用法） */
  getEditor: () => Editor | null
}

interface Props {
  /** 受控值：HTML 字符串（兼容旧纯文本数据） */
  value: string
  /** 内容变化回调（HTML） */
  onChange: (html: string, plainText: string) => void
  placeholder?: string
  className?: string
  /** 最小高度 px（默认 400） */
  minHeight?: number
  /** 是否禁用 */
  disabled?: boolean
  /** 是否显示格式工具栏；只读对照视图可关闭。 */
  showToolbar?: boolean
  /** 项目实体档案；提供 @ 补全和正文内悬浮查看，不写入正文 HTML。 */
  entityReferences?: readonly EditorEntityReference[]
  /** 工具栏与正文之间的内容（例如章节标题）；用于让格式工具栏固定在最上方 */
  contentHeader?: ReactNode
}

/**
 * TipTap 富文本编辑器 + 工具栏
 * - 通过 ref 暴露命令式 API，便于与 AI 流式输出、选区操作集成
 * - value 允许传入旧的纯文本（自动包装为 <p>），新内容以 HTML 保存
 */
const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { value, onChange, placeholder = '开始写作...', className = '', minHeight = 400, disabled = false, showToolbar = true, entityReferences = [], contentHeader },
  ref,
) {
  // 避免 onChange 引起 editor 重建
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const pendingTextStyleRef = useRef<PendingTextStyle>({})
  const [pendingTextStyle, setPendingTextStyle] = useState<PendingTextStyle>({})
  const [, setThemeRevision] = useState(0)
  const [entityMenu, setEntityMenu] = useState<{ query: string; from: number; to: number; x: number; y: number } | null>(null)
  const [entityMenuIndex, setEntityMenuIndex] = useState(0)
  const [hoveredEntity, setHoveredEntity] = useState<{ reference: EditorEntityReference; x: number; y: number } | null>(null)
  const entityReferencesRef = useRef(entityReferences)
  entityReferencesRef.current = entityReferences
  const entityCandidates = useMemo(
    () => entityMenu ? filterEditorEntityReferences(entityReferences, entityMenu.query) : [],
    [entityMenu, entityReferences],
  )

  // 全局排版偏好(字体/字号/行距/段距):跨章保持、刷新不丢、不写进正文、不移动光标/滚动。
  const [typography, setTypography] = useState<EditorTypography>(loadEditorTypography)
  useEffect(() => { applyEditorTypography(loadEditorTypography()) }, [])
  const setTypo = (patch: Partial<EditorTypography>) => {
    setTypography(prev => {
      const next = { ...prev, ...patch }
      saveEditorTypography(next)
      return next
    })
  }

  const updatePendingTextStyle = (patch: PendingTextStyle) => {
    const next: PendingTextStyle = {
      ...pendingTextStyleRef.current,
      ...patch,
    }

    for (const key of Object.keys(next) as Array<keyof PendingTextStyle>) {
      if (!next[key]) delete next[key]
    }

    pendingTextStyleRef.current = next
    setPendingTextStyle(next)
  }

  const insertPendingStyledText = (
    view: EditorView,
    from: number,
    to: number,
    text: string,
  ) => {
    const attrs = pendingTextStyleRef.current
    if (!attrs.color && !attrs.backgroundColor && !attrs.fontFamily && !attrs.fontSize) {
      return false
    }

    const textStyleMark = view.state.schema.marks.textStyle
    if (!textStyleMark) return false

    const tr = view.state.tr.insertText(text, from, to)
    tr.addMark(from, from + text.length, textStyleMark.create(attrs))
    view.dispatch(tr)
    return true
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
      TextStyle,
      Color,
      BackgroundColor,
      FontFamily,
      FontSize,
      BlockSpacing,
      Placeholder.configure({ placeholder }),
    ],
    content: normalizeThemeAdaptiveColorHtml(toHtml(value)),
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          'tiptap-editor prose prose-invert max-w-none focus:outline-none px-4 py-3 text-text-primary text-sm leading-relaxed',
        spellcheck: 'false',
      },
      handleTextInput: (view, from, to, text) => insertPendingStyledText(view, from, to, text),
      handleDOMEvents: {
        beforeinput: (view, event) => {
          const inputEvent = event as InputEvent
          if (inputEvent.inputType !== 'insertText' || !inputEvent.data) return false

          const { from, to } = view.state.selection
          const handled = insertPendingStyledText(view, from, to, inputEvent.data)
          if (handled) event.preventDefault()
          return handled
        },
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      const plain = editor.getText()
      onChangeRef.current(html, plain)
      updateEntityMenu(editor)
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection
      savedSelectionRef.current = { from, to }
      updateEntityMenu(editor)
    },
  })

  function updateEntityMenu(currentEditor: Editor) {
    if (disabled || entityReferencesRef.current.length === 0) {
      setEntityMenu(null)
      return
    }
    const { from, empty } = currentEditor.state.selection
    if (!empty) { setEntityMenu(null); return }
    const before = currentEditor.state.doc.textBetween(Math.max(0, from - 40), from, '\n', '\0')
    const match = before.match(/(?:^|[\s，。！？；：、(（])@([^@\s，。！？；：、()（）]{0,20})$/)
    if (!match) { setEntityMenu(null); return }
    const query = match[1] ?? ''
    const start = from - query.length - 1
    const coords = currentEditor.view.coordsAtPos(from)
    setEntityMenu({ query, from: start, to: from, x: coords.left, y: coords.bottom + 6 })
    setEntityMenuIndex(0)
  }

  useEffect(() => {
    if (!editor) return
    const pluginKey = new PluginKey('storyforgeEntityReferences')
    const plugin = new Plugin({
      key: pluginKey,
      props: {
        decorations(state) {
          if (entityReferencesRef.current.length === 0) return DecorationSet.empty
          const decorations: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return
            const matches = entityReferencesRef.current
              .filter(reference => reference.name.length >= 2 && node.text!.includes(reference.name))
              .sort((a, b) => b.name.length - a.name.length)
            const occupied = new Set<number>()
            for (const reference of matches) {
              let index = node.text.indexOf(reference.name)
              while (index >= 0) {
                const end = index + reference.name.length
                const overlaps = [...Array(end - index).keys()].some(offset => occupied.has(index + offset))
                if (!overlaps) {
                  for (let offset = index; offset < end; offset++) occupied.add(offset)
                  decorations.push(Decoration.inline(pos + index, pos + end, {
                    class: `sf-entity-ref sf-entity-ref-${reference.kind}`,
                    'data-entity-id': reference.id,
                  }))
                }
                index = node.text.indexOf(reference.name, end)
              }
            }
          })
          return DecorationSet.create(state.doc, decorations)
        },
        handleDOMEvents: {
          mouseover: (_view, event) => {
            const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-entity-id]') : null
            const reference = target ? entityReferencesRef.current.find(item => item.id === target.dataset.entityId) : null
            if (!target || !reference) return false
            const rect = target.getBoundingClientRect()
            setHoveredEntity({ reference, x: rect.left, y: rect.bottom + 6 })
            return false
          },
          mouseout: (_view, event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-entity-id]') : null
            if (target) setHoveredEntity(null)
            return false
          },
        },
      },
    })
    editor.registerPlugin(plugin)
    return () => { editor.unregisterPlugin(pluginKey) }
  }, [editor, entityReferences])

  const insertEntityReference = useCallback((reference: EditorEntityReference) => {
    if (!editor || !entityMenu) return
    editor.chain().focus().deleteRange({ from: entityMenu.from, to: entityMenu.to }).insertContent({
      type: 'text',
      text: reference.name,
    }).run()
    setEntityMenu(null)
  }, [editor, entityMenu])

  useEffect(() => {
    if (!editor || !entityMenu || entityCandidates.length === 0) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setEntityMenuIndex(index => (index + 1) % entityCandidates.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setEntityMenuIndex(index => (index - 1 + entityCandidates.length) % entityCandidates.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        insertEntityReference(entityCandidates[entityMenuIndex] ?? entityCandidates[0])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setEntityMenu(null)
      }
    }
    // Capture before ProseMirror's own keydown handler so Enter selects a candidate
    // instead of first inserting a paragraph into the manuscript.
    editor.view.dom.addEventListener('keydown', handleKeyDown, true)
    return () => editor.view.dom.removeEventListener('keydown', handleKeyDown, true)
  }, [editor, entityMenu, entityCandidates, entityMenuIndex, insertEntityReference])

  // 外部 value 变化（切换章节、AI 整段替换）时同步编辑器内容
  // 但避免每次 onChange 触发的 value 回流导致光标丢失
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const incoming = normalizeThemeAdaptiveColorHtml(toHtml(value))
    if (incoming !== current) {
      editor.commands.setContent(incoming, { emitUpdate: false })
    }
  }, [value, editor])

  // 同步 editable 状态
  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    const rerenderForTheme = () => setThemeRevision(revision => revision + 1)
    window.addEventListener('themechange', rerenderForTheme)
    return () => window.removeEventListener('themechange', rerenderForTheme)
  }, [])

  useImperativeHandle(
    ref,
    (): RichEditorHandle => ({
      insertContent: (html) => {
        editor?.chain().focus().insertContent(toHtml(html)).run()
      },
      appendContent: (html) => {
        if (!editor) return
        const end = editor.state.doc.content.size
        editor.chain().focus().insertContentAt(end, toHtml(html)).run()
      },
      replaceSelection: (html) => {
        if (!editor) return
        const { from, to } = editor.state.selection
        if (from === to) {
          // 无选区 → 直接插入
          editor.chain().focus().insertContent(toHtml(html)).run()
        } else {
          editor
            .chain()
            .focus()
            .deleteRange({ from, to })
            .insertContent(toHtml(html))
            .run()
        }
      },
      getSelectedText: () => {
        if (!editor) return ''
        const { from, to, empty } = editor.state.selection
        if (empty) return ''
        return editor.state.doc.textBetween(from, to, '\n')
      },
      getHTML: () => editor?.getHTML() ?? '',
      getPlainText: () => editor?.getText() ?? '',
      getWordCount: () => countWords(editor?.getText() ?? ''),
      setContent: (content) => {
        editor?.commands.setContent(toHtml(content), { emitUpdate: false })
      },
      focus: () => editor?.commands.focus(),
      getEditor: () => editor,
    }),
    [editor],
  )

  if (!editor) {
    return (
      <div
        className={`w-full bg-bg-surface border border-border rounded-lg ${className}`}
        style={{ minHeight }}
      />
    )
  }

  const rememberSelection = () => {
    const { from, to } = editor.state.selection
    savedSelectionRef.current = { from, to }
  }

  const startInlineCommand = () => {
    const chain = editor.chain().focus()
    const selection = savedSelectionRef.current
    if (!selection) return chain

    const docSize = editor.state.doc.content.size
    const from = Math.max(0, Math.min(selection.from, docSize))
    const to = Math.max(from, Math.min(selection.to, docSize))
    return chain.setTextSelection({ from, to })
  }

  const textStyleAttrs = editor.getAttributes('textStyle') as {
    backgroundColor?: string | null
    color?: string | null
    fontFamily?: string | null
    fontSize?: string | null
  }

  const currentColor = textStyleAttrs.color ?? ''
  const currentBackgroundColor = textStyleAttrs.backgroundColor ?? ''
  const selection = savedSelectionRef.current ?? editor.state.selection
  const hasSavedRange = selection.from !== selection.to
  const displayColor = currentColor || pendingTextStyle.color || 'var(--editor-ink-primary)'
  const displayBackgroundColor = currentBackgroundColor || pendingTextStyle.backgroundColor || '#00000000'
  const colorInputValue = resolveColorForInput(displayColor, '#f5e6d3')
  const backgroundColorInputValue = resolveColorForInput(
    displayBackgroundColor === '#00000000' ? 'var(--editor-mark-yellow)' : displayBackgroundColor,
    '#ffe45c',
  )

  const applyTextColor = (color: string) => {
    updatePendingTextStyle({ color })

    if (hasSavedRange) {
      startInlineCommand().setColor(color).run()
      return
    }

    startInlineCommand().setColor(color).run()
  }

  const clearTextColor = () => {
    if (hasSavedRange) {
      startInlineCommand().unsetColor().run()
      return
    }

    updatePendingTextStyle({ color: undefined })
    startInlineCommand().unsetColor().run()
  }

  const setTextBackgroundColor = (color: string) => {
    if (color === '#00000000') {
      updatePendingTextStyle({ backgroundColor: undefined })
      startInlineCommand().unsetBackgroundColor().run()
      return
    }

    updatePendingTextStyle({ backgroundColor: color })
    startInlineCommand().setBackgroundColor(color).run()
  }

  return (
    <div
      className={`w-full bg-bg-surface border border-border rounded-lg overflow-hidden focus-within:border-accent transition-colors ${className}`}
    >
      {/* 工具栏 */}
      {showToolbar && (
        <RichEditorToolbar
          typography={typography}
          colorInputValue={colorInputValue}
          backgroundColorInputValue={backgroundColorInputValue}
          wordCount={countWords(editor.getText())}
          active={{
            bold: editor.isActive('bold'),
            italic: editor.isActive('italic'),
            strike: editor.isActive('strike'),
            heading2: editor.isActive('heading', { level: 2 }),
            heading3: editor.isActive('heading', { level: 3 }),
            bulletList: editor.isActive('bulletList'),
            orderedList: editor.isActive('orderedList'),
            blockquote: editor.isActive('blockquote'),
          }}
          canUndo={editor.can().undo()}
          canRedo={editor.can().redo()}
          onMouseDownCapture={rememberSelection}
          onTypographyChange={setTypo}
          onTextColorChange={applyTextColor}
          onClearTextColor={clearTextColor}
          onBackgroundColorChange={setTextBackgroundColor}
          onBold={() => startInlineCommand().toggleBold().run()}
          onItalic={() => startInlineCommand().toggleItalic().run()}
          onStrike={() => startInlineCommand().toggleStrike().run()}
          onHeading2={() => startInlineCommand().toggleHeading({ level: 2 }).run()}
          onHeading3={() => startInlineCommand().toggleHeading({ level: 3 }).run()}
          onBulletList={() => startInlineCommand().toggleBulletList().run()}
          onOrderedList={() => startInlineCommand().toggleOrderedList().run()}
          onBlockquote={() => startInlineCommand().toggleBlockquote().run()}
          onHorizontalRule={() => startInlineCommand().setHorizontalRule().run()}
          onUndo={() => editor.chain().focus().undo().run()}
          onRedo={() => editor.chain().focus().redo().run()}
        />
      )}

      {contentHeader}

      {/* 编辑区 */}
      <div
        className="overflow-y-auto resize-y"
        style={{ minHeight }}
        onClick={() => editor.commands.focus()}
      >
        <EditorContent editor={editor} />
      </div>
      <RichEditorEntityOverlays
        menu={entityMenu}
        candidates={entityCandidates}
        activeIndex={entityMenuIndex}
        hovered={hoveredEntity}
        onInsert={insertEntityReference}
      />
    </div>
  )
})

export default RichEditor
