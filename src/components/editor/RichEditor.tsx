import { forwardRef, useImperativeHandle, useEffect, useRef, useState, type ReactNode } from 'react'
import { Extension } from '@tiptap/core'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  BackgroundColor,
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from '@tiptap/extension-text-style'
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Strikethrough,
  Heading2,
  Heading3,
  List as ListIcon,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
  Minus,
  Palette,
  PaintBucket,
} from 'lucide-react'
import { toHtml, countWords } from '../../lib/utils/html'
import { loadEditorTypography, saveEditorTypography, applyEditorTypography, type EditorTypography } from '../../lib/editor-typography'

const FONT_FAMILY_OPTIONS = [
  {
    label: '默认正文',
    value: '',
    preview: 'var(--font-serif)',
  },
  {
    label: '宋体',
    value: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif',
    preview: '"SimSun", "Songti SC", serif',
  },
  {
    label: '黑体',
    value: '"SimHei", "Microsoft YaHei", "PingFang SC", "Heiti SC", sans-serif',
    preview: '"SimHei", "Microsoft YaHei", sans-serif',
  },
  {
    label: '仿宋',
    value: '"FangSong", "FangSong_GB2312", "STFangsong", serif',
    preview: '"FangSong", "STFangsong", serif',
  },
  {
    label: '楷体',
    value: '"KaiTi", "Kaiti SC", "STKaiti", serif',
    preview: '"KaiTi", "Kaiti SC", serif',
  },
  {
    label: '微软雅黑',
    value: '"Microsoft YaHei", "PingFang SC", sans-serif',
    preview: '"Microsoft YaHei", "PingFang SC", sans-serif',
  },
] as const

const FONT_SIZE_OPTIONS = ['12px', '14px', '16px', '18px', '20px', '22px', '24px', '28px', '32px'] as const
const LINE_HEIGHT_OPTIONS = [
  { label: '默认行距', value: '' },
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
  { label: '2.5', value: '2.5' },
  { label: '3.0', value: '3' },
] as const
const PARAGRAPH_SPACING_OPTIONS = [
  { label: '默认段距', value: '' },
  { label: '无段距', value: '0' },
  { label: '0.5行', value: '0.5em' },
  { label: '1行', value: '1em' },
  { label: '1.5行', value: '1.5em' },
  { label: '2行', value: '2em' },
] as const

const TEXT_COLOR_PRESETS = [
  { label: '正文', value: 'var(--editor-ink-primary)' },
  { label: '强黑/强白', value: 'var(--editor-ink-strong)' },
  { label: '暖褐', value: 'var(--editor-ink-cream)' },
  { label: '大黄', value: 'var(--editor-ink-gold)' },
  { label: '橙红', value: 'var(--editor-ink-orange)' },
  { label: '蓝', value: 'var(--editor-ink-blue)' },
  { label: '绿', value: 'var(--editor-ink-green)' },
  { label: '大红', value: 'var(--editor-ink-red)' },
  { label: '紫', value: 'var(--editor-ink-purple)' },
] as const
const BACKGROUND_COLOR_PRESETS = [
  { label: '清除文字背景色', value: '#00000000' },
  { label: '黄底', value: 'var(--editor-mark-yellow)' },
  { label: '红底', value: 'var(--editor-mark-red)' },
  { label: '蓝底', value: 'var(--editor-mark-blue)' },
  { label: '绿底', value: 'var(--editor-mark-green)' },
  { label: '紫底', value: 'var(--editor-mark-purple)' },
  { label: '褐底', value: 'var(--editor-mark-brown)' },
  { label: '墨底', value: 'var(--editor-mark-ink)' },
] as const
const BLOCK_SPACING_NODE_TYPES = new Set(['paragraph', 'heading'])

const LEGACY_THEME_COLOR_REPLACEMENTS: Array<[RegExp, string]> = [
  [/(#f5e6d3|rgb\(\s*245\s*,\s*230\s*,\s*211\s*\))/gi, 'var(--editor-ink-cream)'],
  [/(#ffffff|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/gi, 'var(--editor-ink-strong)'],
  [/(#d6b98c|rgb\(\s*214\s*,\s*185\s*,\s*140\s*\))/gi, 'var(--editor-ink-muted)'],
  [/(#d97757|rgb\(\s*217\s*,\s*119\s*,\s*87\s*\))/gi, 'var(--editor-ink-orange)'],
  [/(#60a5fa|rgb\(\s*96\s*,\s*165\s*,\s*250\s*\))/gi, 'var(--editor-ink-blue)'],
  [/(#4ade80|rgb\(\s*74\s*,\s*222\s*,\s*128\s*\))/gi, 'var(--editor-ink-green)'],
  [/(#ef4444|rgb\(\s*239\s*,\s*68\s*,\s*68\s*\))/gi, 'var(--editor-ink-red)'],
  [/(#3a2418|rgb\(\s*58\s*,\s*36\s*,\s*24\s*\))/gi, 'var(--editor-mark-ink)'],
  [/(#4a3326|rgb\(\s*74\s*,\s*51\s*,\s*38\s*\))/gi, 'var(--editor-mark-brown)'],
  [/(#5c3b2d|rgb\(\s*92\s*,\s*59\s*,\s*45\s*\))/gi, 'var(--editor-mark-red)'],
  [/(#1f2937|rgb\(\s*31\s*,\s*41\s*,\s*55\s*\))/gi, 'var(--editor-mark-blue)'],
  [/(#3f2f08|rgb\(\s*63\s*,\s*47\s*,\s*8\s*\))/gi, 'var(--editor-mark-yellow)'],
  [/(#14532d|rgb\(\s*20\s*,\s*83\s*,\s*45\s*\))/gi, 'var(--editor-mark-green)'],
]

function normalizeThemeAdaptiveColorHtml(html: string): string {
  return LEGACY_THEME_COLOR_REPLACEMENTS.reduce(
    (next, [pattern, replacement]) => next.replace(pattern, replacement),
    html,
  )
}

function rgbToHex(color: string): string | null {
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!match) return null

  return `#${[match[1], match[2], match[3]]
    .map(part => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0'))
    .join('')}`
}

function resolveColorForInput(color: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color
  const rgb = rgbToHex(color)
  if (rgb) return rgb

  const varName = color.match(/var\((--[^),\s]+)/)?.[1]
  if (varName && typeof window !== 'undefined') {
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    if (/^#[0-9a-f]{6}$/i.test(resolved)) return resolved
    const resolvedRgb = rgbToHex(resolved)
    if (resolvedRgb) return resolvedRgb
  }

  return fallback
}

const BlockSpacing = Extension.create({
  name: 'blockSpacing',

  addGlobalAttributes() {
    return [
      {
        types: Array.from(BLOCK_SPACING_NODE_TYPES),
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: element => element.style.lineHeight || null,
            renderHTML: attributes => {
              if (!attributes.lineHeight) return {}
              return { style: `line-height: ${attributes.lineHeight}` }
            },
          },
          paragraphSpacing: {
            default: null,
            parseHTML: element => element.style.marginBottom || null,
            renderHTML: attributes => {
              if (!attributes.paragraphSpacing) return {}
              return { style: `margin-bottom: ${attributes.paragraphSpacing}` }
            },
          },
        },
      },
    ]
  },
})

type PendingTextStyle = {
  backgroundColor?: string
  color?: string
  fontFamily?: string
  fontSize?: string
}

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
  /** 工具栏与正文之间的内容（例如章节标题）；用于让格式工具栏固定在最上方 */
  contentHeader?: ReactNode
}

/**
 * TipTap 富文本编辑器 + 工具栏
 * - 通过 ref 暴露命令式 API，便于与 AI 流式输出、选区操作集成
 * - value 允许传入旧的纯文本（自动包装为 <p>），新内容以 HTML 保存
 */
const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { value, onChange, placeholder = '开始写作...', className = '', minHeight = 400, disabled = false, showToolbar = true, contentHeader },
  ref,
) {
  // 避免 onChange 引起 editor 重建
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const pendingTextStyleRef = useRef<PendingTextStyle>({})
  const [pendingTextStyle, setPendingTextStyle] = useState<PendingTextStyle>({})
  const [, setThemeRevision] = useState(0)

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
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection
      savedSelectionRef.current = { from, to }
    },
  })

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

  const btnCls = (active: boolean) =>
    `p-1.5 rounded text-xs transition-colors ${
      active
        ? 'bg-accent/20 text-accent'
        : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
    }`

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

  const selectCls = 'h-8 rounded-md border border-border bg-bg-surface px-2 text-xs text-text-secondary outline-none transition-colors hover:text-text-primary focus:border-accent'

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
      {showToolbar && <div
        className="flex items-center gap-1.5 px-2 py-2 border-b border-border bg-bg-elevated flex-wrap"
        onMouseDownCapture={rememberSelection}
      >
        <select
          aria-label="字体"
          value={typography.fontFamily}
          onChange={(event) => setTypo({ fontFamily: event.target.value })}
          className={`${selectCls} w-32`}
          title="字体(全局·跨章保持)"
        >
          {FONT_FAMILY_OPTIONS.map(option => (
            <option key={option.label} value={option.value} style={{ fontFamily: option.preview }}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="字号"
          value={typography.fontSize}
          onChange={(event) => setTypo({ fontSize: event.target.value })}
          className={`${selectCls} w-20`}
          title="字号(全局·跨章保持)"
        >
          <option value="">默认</option>
          {FONT_SIZE_OPTIONS.map(size => (
            <option key={size} value={size}>{Number.parseInt(size, 10)}</option>
          ))}
        </select>
        <select
          aria-label="行距"
          value={typography.lineHeight}
          onChange={(event) => setTypo({ lineHeight: event.target.value })}
          className={`${selectCls} w-24`}
          title="行距(全局·跨章保持)"
        >
          {LINE_HEIGHT_OPTIONS.map(option => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          aria-label="段距"
          value={typography.paragraphSpacing}
          onChange={(event) => setTypo({ paragraphSpacing: event.target.value })}
          className={`${selectCls} w-24`}
          title="段距(全局·跨章保持)"
        >
          {PARAGRAPH_SPACING_OPTIONS.map(option => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1 rounded-md border border-border bg-bg-surface px-1.5 py-1" title="字色">
          <Palette className="h-3.5 w-3.5 text-text-muted" />
          <input
            aria-label="字色"
            type="color"
            value={colorInputValue}
            onChange={(event) => applyTextColor(event.target.value)}
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          />
          <div className="hidden items-center gap-0.5 md:flex">
            {TEXT_COLOR_PRESETS.map(color => (
              <button
                key={color.label}
                type="button"
                aria-label={`字色 ${color.label}`}
                onClick={() => applyTextColor(color.value)}
                className="h-4 w-4 rounded border border-border hover:border-accent"
                style={{ backgroundColor: color.value }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={clearTextColor}
            className="px-1 text-[10px] text-text-muted hover:text-text-primary"
          >
            清
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-bg-surface px-1.5 py-1" title="文字背景色">
          <PaintBucket className="h-3.5 w-3.5 text-text-muted" />
          <input
            aria-label="文字背景色"
            type="color"
            value={backgroundColorInputValue}
            onChange={(event) => setTextBackgroundColor(event.target.value)}
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          />
          <div className="hidden items-center gap-0.5 md:flex">
            {BACKGROUND_COLOR_PRESETS.map(color => (
              <button
                key={color.label}
                type="button"
                aria-label={color.label}
                onClick={() => setTextBackgroundColor(color.value)}
                className="h-4 w-4 rounded border border-border hover:border-accent"
                style={{
                  backgroundColor: color.value === '#00000000' ? 'transparent' : color.value,
                  backgroundImage: color.value === '#00000000'
                    ? 'linear-gradient(135deg, transparent 45%, var(--error) 46%, var(--error) 54%, transparent 55%)'
                    : undefined,
                }}
              />
            ))}
          </div>
        </div>
        <div className="w-px h-5 bg-border mx-0.5" />
        <button
          type="button"
          onClick={() => startInlineCommand().toggleBold().run()}
          className={btnCls(editor.isActive('bold'))}
          title="加粗 (Cmd/Ctrl+B)"
        >
          <BoldIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => startInlineCommand().toggleItalic().run()}
          className={btnCls(editor.isActive('italic'))}
          title="斜体 (Cmd/Ctrl+I)"
        >
          <ItalicIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => startInlineCommand().toggleStrike().run()}
          className={btnCls(editor.isActive('strike'))}
          title="删除线"
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          onClick={() => startInlineCommand().toggleHeading({ level: 2 }).run()}
          className={btnCls(editor.isActive('heading', { level: 2 }))}
          title="二级标题"
        >
          <Heading2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => startInlineCommand().toggleHeading({ level: 3 }).run()}
          className={btnCls(editor.isActive('heading', { level: 3 }))}
          title="三级标题"
        >
          <Heading3 className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          onClick={() => startInlineCommand().toggleBulletList().run()}
          className={btnCls(editor.isActive('bulletList'))}
          title="无序列表"
        >
          <ListIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => startInlineCommand().toggleOrderedList().run()}
          className={btnCls(editor.isActive('orderedList'))}
          title="有序列表"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => startInlineCommand().toggleBlockquote().run()}
          className={btnCls(editor.isActive('blockquote'))}
          title="引用"
        >
          <Quote className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => startInlineCommand().setHorizontalRule().run()}
          className={btnCls(false)}
          title="分割线"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        {/* G3：正文字数统计 */}
        <span className="text-[11px] text-text-muted font-mono px-1.5 tabular-nums select-none" title="本章正文字数（不含空白）">
          {countWords(editor.getText()).toLocaleString()} 字
        </span>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          className={btnCls(false)}
          title="撤销 (Cmd/Ctrl+Z)"
          disabled={!editor.can().undo()}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          className={btnCls(false)}
          title="重做 (Cmd/Ctrl+Shift+Z)"
          disabled={!editor.can().redo()}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>}

      {contentHeader}

      {/* 编辑区 */}
      <div
        className="overflow-y-auto resize-y"
        style={{ minHeight }}
        onClick={() => editor.commands.focus()}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
})

export default RichEditor
