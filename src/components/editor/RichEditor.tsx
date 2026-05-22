import { forwardRef, useImperativeHandle, useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Heading2,
  Heading3,
  List as ListIcon,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
  Minus,
} from 'lucide-react'
import { toHtml, countWords } from '../../lib/utils/html'

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
}

/**
 * TipTap 富文本编辑器 + 工具栏
 * - 通过 ref 暴露命令式 API，便于与 AI 流式输出、选区操作集成
 * - value 允许传入旧的纯文本（自动包装为 <p>），新内容以 HTML 保存
 */
const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { value, onChange, placeholder = '开始写作...', className = '', minHeight = 400, disabled = false },
  ref,
) {
  // 避免 onChange 引起 editor 重建
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: toHtml(value),
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          'tiptap-editor prose prose-invert max-w-none focus:outline-none px-4 py-3 text-text-primary text-sm leading-relaxed',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      const plain = editor.getText()
      onChangeRef.current(html, plain)
    },
  })

  // 外部 value 变化（切换章节、AI 整段替换）时同步编辑器内容
  // 但避免每次 onChange 触发的 value 回流导致光标丢失
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const incoming = toHtml(value)
    if (incoming !== current) {
      editor.commands.setContent(incoming, { emitUpdate: false })
    }
  }, [value, editor])

  // 同步 editable 状态
  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

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

  return (
    <div
      className={`w-full bg-bg-surface border border-border rounded-lg overflow-hidden focus-within:border-accent transition-colors ${className}`}
    >
      {/* 工具栏 */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-bg-elevated flex-wrap">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={btnCls(editor.isActive('bold'))}
          title="加粗 (Cmd/Ctrl+B)"
        >
          <BoldIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btnCls(editor.isActive('italic'))}
          title="斜体 (Cmd/Ctrl+I)"
        >
          <ItalicIcon className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={btnCls(editor.isActive('heading', { level: 2 }))}
          title="二级标题"
        >
          <Heading2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={btnCls(editor.isActive('heading', { level: 3 }))}
          title="三级标题"
        >
          <Heading3 className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btnCls(editor.isActive('bulletList'))}
          title="无序列表"
        >
          <ListIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btnCls(editor.isActive('orderedList'))}
          title="有序列表"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={btnCls(editor.isActive('blockquote'))}
          title="引用"
        >
          <Quote className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className={btnCls(false)}
          title="分割线"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
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
      </div>

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
