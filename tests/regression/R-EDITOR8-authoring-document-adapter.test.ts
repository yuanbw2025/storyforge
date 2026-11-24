import { describe, expect, it, vi } from 'vitest'
import { AuthoringDocumentAdapterV1, type AuthoringDocumentIdentityV1 } from '../../src/lib/editor/authoring-document-adapter'
import { parseAuthoringHtmlV1 } from '../../src/lib/editor/authoring-html-blocks'
import { htmlToPlainText } from '../../src/lib/utils/html'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'

const identity: AuthoringDocumentIdentityV1 = { projectId: 1, worldId: 2, workId: 3, chapterId: 4, chapterUid: 'res:v1:chapter:11111111-1111-4111-8111-111111111111' }
const edit = (adapter: AuthoringDocumentAdapterV1, from: number, to: number, insert: string) => adapter.applySourceChange({ identity, sourceRevision: adapter.sourceRevision, changes: { from, to, insert } })

describe('037 hidden prototype: one HTML document with positional source projection', () => {
  it('shares source undo/redo across display changes without adding display-only history', () => {
    const changed = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>甲</p>', onHtmlChange: changed })
    edit(adapter, 1, 1, '乙')
    adapter.setDisplayMode('source'); adapter.setDisplayMode('preview')
    expect(adapter.sourceRevision).toBe(1)
    expect(adapter.undoSource()).toBe(true)
    expect(adapter.getHtml()).toBe('<p>甲</p>')
    expect(adapter.redoSource()).toBe(true)
    expect(adapter.getHtml()).toBe('<p>甲乙</p>')
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('rebuilds the entire affected inline syntax container when a later delimiter changes an earlier physical paragraph', () => {
    const adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>初始</p>' })
    edit(adapter, 0, adapter.getSource().length, '**甲\n乙')
    expect(adapter.getHtml()).toBe('<p>**甲</p><p>乙</p>')
    edit(adapter, adapter.getSource().length, adapter.getSource().length, '**')
    expect(adapter.getHtml()).toBe('<p><strong>甲</strong></p><p><strong>乙</strong></p>')
  })

  it('reuses untouched semantic blocks while mapping their source pointer shift by position', () => {
    const html = Array.from({ length: 300 }, () => '<p>重复😀</p>').join('')
    const adapter = new AuthoringDocumentAdapterV1({ identity, html })
    const old = adapter.getEnvelopes()
    const parse = vi.spyOn(ProseMirrorDOMParser.prototype, 'parse')
    try {
      edit(adapter, 0, 0, '增')
      expect(parse.mock.calls.length).toBeLessThanOrEqual(2)
      expect(adapter.getEnvelopes().slice(1).map(row => [row.key, row.htmlHash])).toEqual(old.slice(1).map(row => [row.key, row.htmlHash]))
      const sourceFrom = adapter.getSource().lastIndexOf('重复')
      const selected = adapter.mapSelection(sourceFrom, sourceFrom + 4)
      expect(selected.ok && selected.snapshot.text).toBe('重复😀')
      if (selected.ok) expect(parseAuthoringHtmlV1(adapter.getHtml()).pmDoc.textBetween(selected.snapshot.from, selected.snapshot.to, '\n')).toBe('重复😀')
    } finally { parse.mockRestore() }
  })

  it('rejects split-surrogate edits, holds incomplete composition text and only saves the completed character', () => {
    const changed = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>😀</p>', onHtmlChange: changed })
    expect(() => edit(adapter, 1, 2, '')).toThrow('完整字符')
    expect(() => edit(adapter, 2, 2, '\ud83d')).toThrow('未完成字符')
    adapter.setCompositionState({ compositionStarted: true, composing: false })
    edit(adapter, 2, 2, '\ud83d')
    expect(() => adapter.setCompositionState({ compositionStarted: false, composing: false })).toThrow('未完成字符')
    expect(adapter.getSource()).toBe('😀\ud83d')
    expect(changed).not.toHaveBeenCalled()
    adapter.setCompositionState({ compositionStarted: true, composing: true })
    edit(adapter, 3, 3, '\ude00')
    adapter.setCompositionState({ compositionStarted: false, composing: false })
    expect(adapter.getHtml()).toBe('<p>😀😀</p>')
    expect(changed).toHaveBeenCalledOnce()
  })

  it('rejects a transaction captured from another immutable CM state even if display-only revision did not change source', () => {
    const adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>甲</p>' })
    const transaction = adapter.getCodeMirrorState().update({ changes: { from: 0, insert: '旧' } })
    adapter.setDisplayMode('source')
    expect(() => adapter.dispatchSourceTransaction({ identity, sourceRevision: 0, transaction })).toThrow('旧会话')
    expect(adapter.getHtml()).toBe('<p>甲</p>')
  })
  it('opens and switches display without normalizing HTML, invoking saves or advancing source revision', () => {
    const html = '\n<!--gap--><p>甲</p><p></p><p></p><p style="line-height: 1.8"><span style="color: red; font-size:18px">保护😀</span></p>\n<p>甲</p>\n'
    const change = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html, onHtmlChange: change })
    expect(adapter.getHtml()).toBe(html)
    adapter.setDisplayMode('source'); adapter.setDisplayMode('preview')
    expect(adapter.getHtml()).toBe(html)
    expect(adapter.sourceRevision).toBe(0)
    expect(adapter.renderRevision).toBe(2)
    expect(change).not.toHaveBeenCalled()
    expect(adapter.getEnvelopes().filter(row => row.protected)).toHaveLength(1)
  })

  it('edits the second occurrence by position and retains all other raw bytes and block identities', () => {
    const html = '<p>重复😀</p>\n<p></p><p></p><p style="line-height:1.8"><span style="color:red">保护</span></p><p>重复😀</p>'
    const adapter = new AuthoringDocumentAdapterV1({ identity, html })
    const original = adapter.getEnvelopes()
    const at = adapter.getSource().lastIndexOf('重复')
    edit(adapter, at, at + 2, '新段')
    expect(adapter.getHtml()).toBe(html.slice(0, -'<p>重复😀</p>'.length) + '<p>新段😀</p>')
    expect(adapter.getEnvelopes().slice(0, -1).map(row => row.key)).toEqual(original.slice(0, -1).map(row => row.key))
    expect(adapter.getPlainText()).toBe(htmlToPlainText(adapter.getHtml()))
  })

  it('does not let a source edit, a boundary deletion or a different scope overwrite a protected block', () => {
    const html = '<p>甲</p><p style="color:red">保护</p><p>乙</p>'
    const adapter = new AuthoringDocumentAdapterV1({ identity, html })
    const protectedBlock = adapter.getEnvelopes().find(row => row.protected)!
    expect(() => edit(adapter, protectedBlock.from, protectedBlock.from + 1, '改')).toThrow('受保护')
    expect(() => edit(adapter, protectedBlock.from - 1, protectedBlock.from, '')).toThrow('受保护')
    expect(() => adapter.applySourceChange({ identity: { ...identity, workId: 9 }, sourceRevision: 0, changes: { from: 0, insert: '错' } })).toThrow('身份已变化')
    expect(adapter.getHtml()).toBe(html)
    expect(adapter.sourceRevision).toBe(0)
  })

  it('safely saves incomplete fenced input literally and reopens every visible character', () => {
    const adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>原稿</p>' })
    edit(adapter, 0, adapter.getSource().length, '```js\n未闭合 **正文')
    expect(adapter.getHtml()).toBe('<p>```js</p><p>未闭合 **正文</p>')
    const reopened = new AuthoringDocumentAdapterV1({ identity, html: adapter.getHtml() })
    expect(reopened.getPlainText()).toBe('```js\n未闭合 **正文')
    expect(reopened.getHtml()).toBe(adapter.getHtml())
  })

  it('guards the composition-started phase before the first composing document update', () => {
    const change = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>甲</p>', onHtmlChange: change })
    adapter.setCompositionState({ compositionStarted: true, composing: false })
    edit(adapter, 1, 1, '中')
    expect(adapter.getSource()).toBe('甲中')
    expect(() => adapter.getHtml()).toThrow('输入法组合')
    expect(() => adapter.setDisplayMode('source')).toThrow('输入法组合')
    expect(adapter.mapSelection(0, 1).ok).toBe(false)
    expect(() => adapter.commitExternalHtml({ identity, sourceRevision: 1, baselineEpoch: 0, sourceHtml: '<p>甲</p>', html: '<p>外部</p>', receiptId: 'actual-test-receipt', origin: 'external-adopt' })).toThrow('输入法组合')
    expect(change).not.toHaveBeenCalled()
    adapter.setCompositionState({ compositionStarted: false, composing: false })
    expect(adapter.getHtml()).toBe('<p>甲中</p>')
    expect(change).toHaveBeenCalledOnce()
  })

  it('proves UTF16 to real PM positions with duplicate paragraphs and an emoji', () => {
    const html = '<p>重复😀</p><p>甲<strong>重复😀</strong>乙</p>'
    const adapter = new AuthoringDocumentAdapterV1({ identity, html })
    const from = adapter.getSource().lastIndexOf('重复')
    const result = adapter.mapSelection(from, from + 4)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    const firstSize = parseAuthoringHtmlV1(html).pmDoc.firstChild!.nodeSize
    expect(result.snapshot).toMatchObject({ from: firstSize + 2, to: firstSize + 6, text: '重复😀', sourceHtml: html, sourceRevision: 0 })
    expect(parseAuthoringHtmlV1(html).pmDoc.textBetween(result.snapshot.from, result.snapshot.to, '\n')).toBe(result.snapshot.text)
    expect(result.snapshot.sourceContentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(adapter.mapSelection(from + 3, from + 4).ok).toBe(false)
    expect(adapter.mapSelection(from - 1, from + 4).ok).toBe(false)
  })

  it('maps complete entities, rejects their interior, and proves ordinary cross-paragraph text', () => {
    const adapter = new AuthoringDocumentAdapterV1({ identity, html: '' })
    edit(adapter, 0, 0, '甲&amp;乙\n丙😀')
    const entity = adapter.getSource().indexOf('&amp;')
    const selected = adapter.mapSelection(entity, entity + 5)
    expect(selected.ok && selected.snapshot.text).toBe('&')
    expect(adapter.mapSelection(entity + 1, entity + 4).ok).toBe(false)
    const all = adapter.mapSelection(0, adapter.getSource().length)
    expect(all.ok && all.snapshot.text).toBe('甲&乙\n丙😀')
  })

  it('does not guess a visible hard-break selection that the existing PM contract cannot prove', () => {
    const adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>甲<br>乙</p>' })
    const selected = adapter.mapSelection(0, adapter.getSource().length)
    expect(selected.ok).toBe(false)
    expect(adapter.getHtml()).toBe('<p>甲<br>乙</p>')
  })

  it('previews a pure PM replacement without writing or losing protected siblings; rejects stale previews', () => {
    const protectedHtml = '<p style="line-height: 1.8"><span style="color: red">保护</span></p>'
    const html = '<p>甲<strong>选择😀</strong>乙</p>' + protectedHtml
    const change = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html, onHtmlChange: change })
    const from = adapter.getSource().indexOf('选择')
    const selected = adapter.mapSelection(from, from + 4)
    expect(selected.ok).toBe(true)
    if (!selected.ok) throw new Error(selected.reason)
    const candidate = adapter.previewReplacement(selected.snapshot, '<不是标签>&')
    expect(candidate).toContain('&lt;不是标签&gt;&amp;')
    expect(candidate?.endsWith(protectedHtml)).toBe(true)
    expect(adapter.getHtml()).toBe(html)
    expect(change).not.toHaveBeenCalled()
    adapter.setDisplayMode('source')
    expect(adapter.previewReplacement(selected.snapshot, '仍可预演')).not.toBeNull()
    edit(adapter, 0, 1, '新')
    expect(adapter.previewReplacement(selected.snapshot, '旧结果')).toBeNull()
  })

  it('accepts a bound external adoption as a view refresh only and rejects late/cross-work data', () => {
    const change = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>甲</p>', onHtmlChange: change })
    const receipt = { identity, sourceRevision: 0, baselineEpoch: 0, sourceHtml: '<p>甲</p>', html: '<p>外部候选</p>', receiptId: 'already-committed-receipt', origin: 'external-adopt' as const }
    expect(() => adapter.commitExternalHtml({ ...receipt, identity: { ...identity, workId: 5 } })).toThrow('身份已变化')
    adapter.commitExternalHtml(receipt)
    expect(adapter.getHtml()).toBe('<p>外部候选</p>')
    expect(change).not.toHaveBeenCalled()
    expect(() => adapter.commitExternalHtml(receipt)).toThrow('未覆盖输入')
  })

  it('refuses replacement anywhere in a paragraph whose unselected spaces would be collapsed by PM', () => {
    const changed = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html: '', onHtmlChange: changed })
    edit(adapter, 0, 0, '甲  乙选择😀')
    const before = adapter.getHtml(), from = adapter.getSource().indexOf('选择')
    const selected = adapter.mapSelection(from, from + 4)
    expect(selected.ok).toBe(false)
    if (!selected.ok) expect(selected.reason).toContain('空格或换行')
    expect(adapter.getHtml()).toBe(before)
    expect(before).toBe('<p>甲  乙选择😀</p>')
    expect(changed).toHaveBeenCalledOnce()
  })

  it('keeps external adoption in source history; undo and redo are new author edits retaining raw gaps and protected styles', () => {
    const original = '\n<!--before--><p>甲</p><p style="color:red">旧样式</p>\n'
    const adopted = '<h1>外部</h1>\n<p style="line-height:1.8">新样式</p>'
    const changed = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html: original, onHtmlChange: changed })
    edit(adapter, 1, 1, '乙')
    const before = adapter.getHtml(), source = adapter.getSource(), snapshot = adapter.mapSelection(0, 1)
    const receipt = Object.freeze({ identity, sourceRevision: adapter.sourceRevision, baselineEpoch: adapter.baselineEpoch,
      sourceHtml: before, html: adopted, receiptId: 'existing-domain-receipt', origin: 'external-adopt' as const })
    const receiptBytes = JSON.stringify(receipt)
    adapter.commitExternalHtml(receipt)
    expect(adapter.sourceRevision).toBe(1)
    expect(adapter.baselineEpoch).toBe(1)
    expect(changed).toHaveBeenCalledOnce()
    expect(adapter.getHtml()).toBe(adopted)
    expect(adapter.undoSource()).toBe(true)
    expect(adapter.sourceRevision).toBe(2)
    expect(adapter.baselineEpoch).toBe(2)
    expect(adapter.getSource()).toBe(source)
    expect(adapter.getHtml()).toBe(before)
    if (!snapshot.ok) throw new Error(snapshot.reason)
    expect(adapter.previewReplacement(snapshot.snapshot, '过期')).toBeNull()
    expect(() => adapter.commitExternalHtml({ ...receipt, sourceRevision: adapter.sourceRevision })).toThrow('未覆盖输入')
    expect(adapter.redoSource()).toBe(true)
    expect(adapter.getHtml()).toBe(adopted)
    expect(adapter.sourceRevision).toBe(3)
    expect(changed).toHaveBeenCalledTimes(3)
    adapter.undoSource(); adapter.undoSource()
    expect(adapter.getHtml()).toBe(original)
    expect(JSON.stringify(receipt)).toBe(receiptBytes)
  })

  it('undoes source-identical raw format adoptions and repeated adoption boundaries without inventing an author edit', () => {
    const changed = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p style="color:red">甲</p>', onHtmlChange: changed })
    const adopt = (html: string, receiptId: string) => adapter.commitExternalHtml({ identity, sourceRevision: adapter.sourceRevision,
      baselineEpoch: adapter.baselineEpoch, sourceHtml: adapter.getHtml(), html, receiptId, origin: 'external-adopt' })
    const source = adapter.getSource()
    adopt('<p style="color:blue">甲</p>', 'receipt-1')
    adopt('<p style="color:green">甲</p>', 'receipt-2')
    expect(adapter.getSource()).toBe(source)
    expect(adapter.sourceRevision).toBe(0)
    expect(adapter.baselineEpoch).toBe(2)
    expect(changed).not.toHaveBeenCalled()
    adapter.undoSource()
    expect(adapter.getHtml()).toBe('<p style="color:blue">甲</p>')
    adapter.undoSource()
    expect(adapter.getHtml()).toBe('<p style="color:red">甲</p>')
    adapter.redoSource(); adapter.redoSource()
    expect(adapter.getHtml()).toBe('<p style="color:green">甲</p>')
    expect(adapter.sourceRevision).toBe(4)
    expect(changed).toHaveBeenCalledTimes(4)
  })

  it('stages complete paste outside the formal document, cancels without a write and rejects late or cross-session confirmations', async () => {
    const changed = vi.fn(), adapter = new AuthoringDocumentAdapterV1({ identity, html: '<p>原稿</p>', onHtmlChange: changed })
    const prepare = (signal: AbortSignal) => adapter.preparePaste({ identity, sourceRevision: adapter.sourceRevision, baselineEpoch: adapter.baselineEpoch, from: 2, to: 2, text: '\n**新稿😀**', signal })
    const controller = new AbortController(), cancelled = prepare(controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(adapter.getHtml()).toBe('<p>原稿</p>')
    const readyController = new AbortController(), cancelledReady = await prepare(readyController.signal)
    readyController.abort()
    expect(() => adapter.commitPaste(cancelledReady)).toThrow('取消')
    expect(adapter.getHtml()).toBe('<p>原稿</p>')
    const draft = await prepare(new AbortController().signal)
    expect(adapter.sourceRevision).toBe(0)
    expect(changed).not.toHaveBeenCalled()
    expect(draft.previewHtml).toBe('<p>原稿</p><p><strong>新稿😀</strong></p>')
    const other = new AuthoringDocumentAdapterV1({ identity, html: '<p>原稿</p>' })
    expect(() => other.commitPaste(draft)).toThrow('其它章节')
    adapter.setDisplayMode('source')
    adapter.commitPaste(draft)
    expect(adapter.getHtml()).toBe(draft.previewHtml)
    expect(changed).toHaveBeenCalledOnce()
    expect(() => adapter.commitPaste(draft)).toThrow('过期')
    adapter.undoSource()
    expect(adapter.getHtml()).toBe('<p>原稿</p>')
    const late = await prepare(new AbortController().signal)
    edit(adapter, 0, 0, '作者')
    expect(() => adapter.commitPaste(late)).toThrow('过期')
    expect(adapter.getHtml()).toBe('<p>作者原稿</p>')
  })
})
