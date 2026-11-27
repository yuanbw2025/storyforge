import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { AuthoringRichTextSessionV1 } from '../../src/lib/editor/authoring-rich-text-session'
import { richEditorExtensionsV1 } from '../../src/lib/editor/rich-editor-schema'
import { parseAuthoringPmProofV1 } from '../../src/lib/editor/authoring-html-blocks'

describe('037 rich frontend transaction boundary', () => {
  it('opens native PM from JSON without rewriting HTML; real commands preserve duplicate raw siblings and styles', () => {
    const raw = '\n<!--gap--><p>重复😀</p><p></p><p></p>\n<p style="line-height: 1.8"><span style="color: red; font-size:18px">旧稿</span></p><p>重复😀</p>\n'
    let session = new AuthoringRichTextSessionV1(raw)
    const changes: string[] = []
    const editor = new Editor({ extensions: richEditorExtensionsV1(), content: session.getDocument().toJSON(), onTransaction({ transaction }) {
      const result = session.applyTransaction(transaction)
      if (result) changes.push(result.html)
    } })
    session = new AuthoringRichTextSessionV1(raw, { document: editor.state.doc })
    try {
      expect(session.getHtml()).toBe(raw)
      expect(changes).toEqual([])
      const last = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize + 1
      editor.commands.insertContentAt({ from: last, to: last + 2 }, '第二')
      expect(session.getHtml()).toBe(raw.slice(0, raw.lastIndexOf('<p>重复😀</p>')) + '<p>第二😀</p>\n')
      expect(parseAuthoringPmProofV1(session.getHtml(), editor.schema).eq(editor.state.doc)).toBe(true)
      editor.commands.setTextSelection({ from: last, to: last + 2 })
      editor.commands.toggleBold()
      expect(session.getHtml()).toContain('<p><strong>第二</strong>😀</p>')
      expect(session.getHtml()).toContain('<p style="line-height: 1.8"><span style="color: red; font-size:18px">旧稿</span></p>')
    } finally { editor.destroy() }
  })

  it('handles insertion between original roots, paragraph joins and mark-only transactions by position', () => {
    const raw = '<p style="color: red">甲</p>\n<p>乙</p><p style="color: blue">丙</p>'
    let session = new AuthoringRichTextSessionV1(raw)
    const editor = new Editor({ extensions: richEditorExtensionsV1(), content: session.getDocument().toJSON(), onTransaction({ transaction }) { session.applyTransaction(transaction) } })
    session = new AuthoringRichTextSessionV1(raw, { document: editor.state.doc })
    try {
      editor.commands.insertContentAt(3, '<p>插入</p>')
      expect(session.getHtml()).toBe('<p style="color: red">甲</p><p>插入</p>\n<p>乙</p><p style="color: blue">丙</p>')
      // Join the inserted paragraph with 乙. The untouched blue/raw first
      // paragraph remain byte-identical; the two joined roots are rebuilt.
      editor.commands.setTextSelection(8)
      editor.commands.joinBackward()
      expect(session.getHtml()).toContain('<p>插入乙</p>')
      expect(session.getHtml()).toContain('<p style="color: blue">丙</p>')
      expect(session.getHtml()).toContain('<p style="color: red">甲</p>')
      expect(parseAuthoringPmProofV1(session.getHtml(), editor.schema).eq(editor.state.doc)).toBe(true)
    } finally { editor.destroy() }
  })

  it('refuses ambiguous whole/block parsing instead of silently normalizing and rejects stale native transactions', () => {
    expect(() => new AuthoringRichTextSessionV1('<p>甲')).toThrow('边界')
    let session = new AuthoringRichTextSessionV1('<p>甲</p>')
    const editor = new Editor({ extensions: richEditorExtensionsV1(), content: session.getDocument().toJSON() })
    session = new AuthoringRichTextSessionV1('<p>甲</p>', { document: editor.state.doc })
    try {
      const old = editor.state.tr.insertText('旧', 1)
      session.applyTransaction(editor.state.tr.insertText('新', 1))
      expect(() => session.applyTransaction(old)).toThrow('旧正文会话')
      expect(session.getHtml()).toBe('<p>新甲</p>')
    } finally { editor.destroy() }
  })

  it('preserves visible spaces and soft text newlines per root without turning raw root gaps into paragraphs; refuses formal coordinate reuse', () => {
    const raw = '\n<p>甲  乙\n丙😀</p>\n<!--gap--><p>后段</p>\n'
    let session = new AuthoringRichTextSessionV1(raw)
    const editor = new Editor({ extensions: richEditorExtensionsV1(), content: session.getDocument().toJSON(), onTransaction({ transaction, appendedTransactions }) {
      session.applyTransactions([transaction, ...appendedTransactions])
    } })
    session = new AuthoringRichTextSessionV1(raw, { document: editor.state.doc })
    try {
      expect(editor.state.doc.childCount).toBe(2)
      expect(editor.state.doc.firstChild!.textContent).toBe('甲  乙\n丙😀')
      expect(session.canUseFormalPositions()).toBe(false)
      expect(session.getHtml()).toBe(raw)
      editor.commands.insertContentAt(2, '  新')
      expect(session.getHtml()).toBe('\n<p>甲  新  乙\n丙😀</p>\n<!--gap--><p>后段</p>\n')
      expect(editor.state.doc.firstChild!.textContent).toBe('甲  新  乙\n丙😀')
      expect(session.canUseFormalPositions()).toBe(false)
    } finally { editor.destroy() }
  })

  it('accepts native appended transactions as one atomic save and rolls back a failed batch rather than saving its prefix', () => {
    const raw = '<p style="line-height: 1.8">原稿</p>'
    let session = new AuthoringRichTextSessionV1(raw)
    const changed: string[] = []
    const editor = new Editor({ extensions: richEditorExtensionsV1(), content: session.getDocument().toJSON(), onTransaction({ transaction, appendedTransactions }) {
      const result = session.applyTransactions([transaction, ...appendedTransactions])
      if (result) changed.push(result.html)
    } })
    session = new AuthoringRichTextSessionV1(raw, { document: editor.state.doc })
    try {
      const first = editor.state.tr.insertText('新', 1), stale = editor.state.tr.insertText('迟', 1)
      expect(() => session.applyTransactions([first, stale])).toThrow('旧正文会话')
      expect(session.getHtml()).toBe(raw)
      editor.commands.insertContentAt(editor.state.doc.content.size, '<hr>')
      expect(changed).toHaveLength(1)
      expect(session.getHtml().startsWith(raw)).toBe(true)
      expect(session.getDocument().eq(editor.state.doc)).toBe(true)
    } finally { editor.destroy() }
  })
})
