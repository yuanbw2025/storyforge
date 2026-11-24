import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { AuthoringDocumentAdapterV1, type AuthoringPasteDraftV1, type AuthoringSelectionSnapshotV1 } from './authoring-document-adapter'
import { parseAuthoringHtmlV1 } from './authoring-html-blocks'
import { findEditorEntityMatches, filterEditorEntityReferences, type EditorEntityReference } from './entity-reference'

/** 投影给既有 FloatingToolbar 的选区快照（PM 坐标，不是 CM 源坐标）。 */
export interface ToolbarSelectionProjectionV1 {
  snapshot: { from: number; to: number; text: string; sourceHtml: string } | null
  reason?: string
}
export interface ToolbarReplacementTargetV1 { from: number; to: number; text: string; sourceHtml: string }

interface ProtectedViewV1 { from: number; to: number; key: number; hash: string; widget: ProtectedBlockWidgetV1 }
class ProtectedBlockWidgetV1 extends WidgetType {
  constructor(readonly key: number, readonly hash: string, private readonly content: HTMLElement, private readonly onRichText: () => void) { super() }
  eq(other: ProtectedBlockWidgetV1) { return this.key === other.key && this.hash === other.hash }
  toDOM() {
    const wrapper = document.createElement('section')
    wrapper.className = 'sf-authoring-protected'
    wrapper.setAttribute('aria-label', '旧格式块，使用富文本编辑')
    const body = document.createElement('div')
    for (const child of [...this.content.childNodes]) body.append(child.cloneNode(true))
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = '用富文本编辑'
    button.addEventListener('click', this.onRichText)
    wrapper.append(body, button)
    return wrapper
  }
  ignoreEvent() { return true }
}
const refreshProtected = StateEffect.define<readonly ProtectedViewV1[]>()
class SeparatorWidgetV1 extends WidgetType {
  toDOM() { const line = document.createElement('span'); line.className = 'sf-md-separator'; line.setAttribute('role', 'separator'); return line }
  eq() { return true }
}
const separatorWidget = new SeparatorWidgetV1()

function protectedDecorations(rows: readonly ProtectedViewV1[]): DecorationSet {
  return Decoration.set(rows.map(row => row.from === row.to
    ? Decoration.widget({ widget: row.widget, block: true, side: 1 }).range(row.from)
    : Decoration.replace({ widget: row.widget, block: true, inclusive: false }).range(row.from, row.to)), true)
}
function validBoundary(source: string, pos: number): boolean {
  if (pos <= 0 || pos >= source.length) return true
  const left = source.charCodeAt(pos - 1), right = source.charCodeAt(pos)
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff)
}

/** Actual CM view for the unmounted 037 prototype. It never reads or writes DB.
 * Protected block widgets are direct StateField decorations. Only inline and
 * line decorations are viewport-derived; neither replaces a newline. */
export class AuthoringMarkdownViewV1 {
  readonly view: EditorView
  private listeners = new Set<() => void>()
  private widgets = new Map<number, ProtectedBlockWidgetV1>()
  private compositionEventStarted = false
  private compositionFrame = 0
  private destroyed = false
  private pasteAbort?: AbortController
  /** 仅登记本会话由 mapSelection 签发的真实内部快照；key 用投影字段，禁止由 from/to 重建。 */
  private toolbarSelections = new Map<string, AuthoringSelectionSnapshotV1>()
  /** 项目实体档案；装饰只读、@补全菜单使用，不写正文。 */
  private readonly entityReferences: readonly EditorEntityReference[]
  /** Lightweight DOM tooltip for entity hover info; managed in constructor. */
  private popupEl: HTMLDivElement | null = null
  /** 悬浮高亮状态：{ reference, x, y } */
  private readonly readProtected: () => ProtectedViewV1[]
  private readonly protectedField: StateField<{ rows: readonly ProtectedViewV1[]; decorations: DecorationSet }>

  constructor(readonly adapter: AuthoringDocumentAdapterV1, input: {
    parent: HTMLElement
    onError: (error: Error) => void
    onRichText: () => void
    placeholder?: string
    onLargePaste?: (pending: { text: string; cancel: () => void; draft: Promise<AuthoringPasteDraftV1> }) => void
    /** 项目实体档案，用于 CM 视图内只读悬浮与 @ 补全装饰。 */
    entityReferences?: readonly EditorEntityReference[]
  }) {
    this.entityReferences = input.entityReferences ?? []
    const report = (error: unknown) => input.onError(error instanceof Error ? error : new Error(String(error)))
    const readProtected = this.readProtected = (): ProtectedViewV1[] => {
      const current = adapter.getEnvelopes().filter(row => row.protected)
      const activeKeys = new Set(current.map(row => row.key))
      for (const key of this.widgets.keys()) if (!activeKeys.has(key)) this.widgets.delete(key)
      return current.map(row => {
      let widget = this.widgets.get(row.key)
      if (!widget || widget.hash !== row.htmlHash) {
        widget = new ProtectedBlockWidgetV1(row.key, row.htmlHash, parseAuthoringHtmlV1(row.html).dom, input.onRichText)
        this.widgets.set(row.key, widget)
      }
      return { from: row.from, to: row.to, key: row.key, hash: row.htmlHash, widget }
      })
    }
    this.protectedField = StateField.define<{ rows: readonly ProtectedViewV1[]; decorations: DecorationSet }>({
      create: () => { const rows = readProtected(); return { rows, decorations: protectedDecorations(rows) } },
      update: (value, transaction) => {
        const refresh = transaction.effects.find(effect => effect.is(refreshProtected))
        if (refresh) return { rows: refresh.value, decorations: protectedDecorations(refresh.value) }
        if (!transaction.docChanged) return value
        const rows = value.rows.map(row => ({ ...row, from: transaction.changes.mapPos(row.from, 1), to: transaction.changes.mapPos(row.to, -1) }))
          .filter(row => row.from <= row.to)
        return { rows, decorations: protectedDecorations(rows) }
      },
      provide: field => [EditorView.decorations.from(field, value => value.decorations),
        EditorView.atomicRanges.of(view => view.state.field(field).decorations)],
    })
    const protectedField = this.protectedField
    const compositionEventActive = () => this.compositionEventStarted
    const inlinePreview = ViewPlugin.fromClass(class {
      decorations = Decoration.none
      atomic = Decoration.none
      constructor(view: EditorView) { this.build(view) }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.length) this.build(update.view)
      }
      build(view: EditorView) {
        if (adapter.displayMode === 'source' || compositionEventActive() || view.compositionStarted || view.composing) {
          this.decorations = this.atomic = Decoration.none; return
        }
        const decorations: Range<Decoration>[] = [], atomic: Range<Decoration>[] = []
        const protectedRows = view.state.field(protectedField).rows
        const seen = new Set<string>()
        for (const range of view.visibleRanges) syntaxTree(view.state).iterate({ from: range.from, to: range.to, enter(node) {
          const key = `${node.from}:${node.to}:${node.name}`
          if (seen.has(key)) return
          seen.add(key)
          if (protectedRows.some(row => node.from >= row.from && node.to <= row.to)) return false
          const name = node.name, parent = node.node.parent
          const selected = parent && view.state.selection.ranges.some(selection => selection.from <= parent.to && selection.to >= parent.from)
          const nodeSelected = view.state.selection.ranges.some(selection => selection.from <= node.to && selection.to >= node.from)
          const markClass = name === 'StrongEmphasis' ? 'sf-md-strong' : name === 'Emphasis' ? 'sf-md-emphasis'
            : name === 'Strikethrough' ? 'sf-md-strike' : name === 'InlineCode' ? 'sf-md-code' : name === 'Link' ? 'sf-md-link' : null
          if (markClass && node.to > node.from) decorations.push(Decoration.mark({ class: markClass }).range(node.from, node.to))
          const heading = /^ATXHeading([1-6])$|^SetextHeading([12])$/.exec(name)
          if (heading) decorations.push(Decoration.line({ class: `sf-md-heading sf-md-h${heading[1] ?? heading[2]}` }).range(view.state.doc.lineAt(node.from).from))
          if (name === 'HorizontalRule' && !nodeSelected && view.state.doc.lineAt(node.from).number === view.state.doc.lineAt(node.to).number) {
            const rule = Decoration.replace({ widget: separatorWidget, inclusive: false }).range(node.from, node.to)
            decorations.push(rule); atomic.push(rule)
          }
          if (['FencedCode', 'CodeBlock', 'Blockquote', 'ListItem'].includes(name)) {
            const from = view.state.doc.lineAt(Math.max(node.from, range.from)).number
            const to = view.state.doc.lineAt(Math.min(node.to, range.to)).number
            for (let number = from; number <= to; number++) decorations.push(Decoration.line({ class: `sf-md-${name.toLowerCase()}` }).range(view.state.doc.line(number).from))
          }
          if (!selected && ['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'HeaderMark', 'LinkMark', 'URL', 'LinkTitle'].includes(name)
            && parent && ['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode', 'Link', 'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6', 'SetextHeading1', 'SetextHeading2'].includes(parent.name)
            && node.from < node.to && view.state.doc.lineAt(node.from).number === view.state.doc.lineAt(node.to).number) {
            const hidden = Decoration.replace({ inclusive: false }).range(node.from, node.to)
            decorations.push(hidden); atomic.push(hidden)
          }
        } })
        this.decorations = Decoration.set(decorations, true); this.atomic = Decoration.set(atomic, true)
      }
    }, { decorations: value => value.decorations, provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.atomic ?? Decoration.none) })
        // Entity decoration & @ autocomplete (decorative only; reads from source text coordinates).
    // Preview mode has invisible syntax chars so matching there is unreliable; skip in preview.
    const entityRefs = this.entityReferences
    const entityPlugin = ViewPlugin.fromClass(class {
      decorations: DecorationSet = Decoration.none
      constructor(view: EditorView) { this.build(view) }
      build(view: EditorView) {
        if (entityRefs.length === 0 || adapter.displayMode === 'preview'
          || compositionEventActive() || view.compositionStarted || view.composing) {
          this.decorations = Decoration.none; return
        }
        const docText = view.state.doc.toString()
        const matches = findEditorEntityMatches(docText, entityRefs)
        const result: Array<Range<Decoration>> = []
        for (const m of matches) {
          const line = view.state.doc.lineAt(m.from)
          // Skip if not on its own line unless selected
          if (line.from !== line.to && !view.state.selection.ranges.some(r => r.from <= m.from && r.to >= m.to)) continue
          if (m.from < line.from || m.to > line.to) continue
          result.push(Decoration.mark({
            class: `sf-entity-ref sf-entity-ref-${m.reference.kind}`,
            'data-entity-id': m.reference.id,
          }).range(m.from, m.to))
        }
        this.decorations = Decoration.set(result, true)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) this.build(update.view)
      }
    }, { decorations: v => v.decorations })

    // cleanup popup on destroy
    this.popupEl = document.createElement('div')
    this.popupEl.className = 'sf-entity-popup'
    this.popupEl.style.cssText = 'position:absolute;left:0;top:0;background:var(--bg-surface,#fff);border:1px solid var(--border,#ccc);border-radius:4px;padding:4px 8px;font-size:12px;color:var(--text-primary,#000);z-index:9999;pointer-events:none;max-width:280px;box-shadow:0 2px 8px rgba(0,0,0,.15);display:none'
    input.parent.appendChild(this.popupEl)
    const showPopup = (x: number, y: number, ref: EditorEntityReference | null) => {
      if (!this.popupEl) return
      this.popupEl.style.left = x + 'px'; this.popupEl.style.top = y + 'px'
      if (ref) {
        this.popupEl.textContent = '[' + ref.kindLabel + '] ' + ref.name
        this.popupEl.style.display = 'block'
      } else { this.popupEl.style.display = 'none' }
    }
    const entityQueryRegex = /(?:^|[\s，。！？；：、(（])@([^@\s，。！？；：、()（）]{0,20})$/
    let entityMenuState: { query: string; from: number; to: number; x: number; y: number; filtered: EditorEntityReference[] } | null = null
    let entityMenuIndex = 0
    const getCMView = () => this.destroyed ? null : this.view
    adapter.attachViewExtensions([
      this.protectedField, inlinePreview, entityPlugin, keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': '正文 Markdown', 'data-placeholder': input.placeholder ?? '开始写作…', spellcheck: 'false' }),
      EditorState.transactionFilter.of(transaction => {
        if (transaction.docChanged) return transaction
        const source = transaction.newDoc.toString(), rows = transaction.startState.field(this.protectedField).rows
        if (transaction.newSelection.ranges.some(range => !validBoundary(source, range.from) || !validBoundary(source, range.to)
          || rows.some(row => range.from > row.from && range.from < row.to || range.to > row.from && range.to < row.to))) {
          report(new Error('请选择完整字符；旧格式块请使用富文本编辑。')); return []
        }
        return transaction
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          if (update.changes.empty) return
          update.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
            if (!inserted.toString().endsWith('@')) return
            const pos = fromB + inserted.length - 1
            const before = update.state.sliceDoc(Math.max(0, pos - 40), pos)
            const match = before.match(entityQueryRegex)
            if (!match) return
            const query = match[1] ?? ''
            const coords = update.view.coordsAtPos(pos)
            const filtered = filterEditorEntityReferences(entityRefs, query, 8)
            entityMenuState = { query, from: pos - query.length - 1, to: pos, x: coords?.left ?? 0, y: (coords?.bottom ?? 0) + 6, filtered }
            entityMenuIndex = 0
            return true // stop after first match
          })
        }
        if (update.selectionSet && !update.docChanged) {
          if (entityMenuState) {
            const s = update.view.state.selection
            if (s.ranges.some(r => !r.empty || r.from !== entityMenuState!.to)) {
              entityMenuState = null; entityMenuIndex = 0
            }
          }
        }
      }),
      EditorView.domEventHandlers({
        paste: (event: ClipboardEvent) => {
          const text = event.clipboardData?.getData('text/plain') ?? ''
          if (text.length < 10000) return false
          event.preventDefault()
          if (!input.onLargePaste) { report(new Error('大段粘贴需要先预览确认，原稿未改变；内容仍在剪贴板中。')); return true }
          this.pasteAbort?.abort()
          const controller = this.pasteAbort = new AbortController()
          const draft = this.preparePaste(text, controller.signal)
          input.onLargePaste({ text, cancel: () => controller.abort(), draft })
          return true
        },
        compositionstart: () => { this.compositionEventStarted = true; adapter.setCompositionState({ compositionStarted: true, composing: false }); return false },
        compositionend: () => {
          this.compositionEventStarted = false
          const finish = () => {
            if (this.destroyed) return
            if (this.view.compositionStarted || this.view.composing) { this.compositionFrame = requestAnimationFrame(finish); return }
            try { adapter.setCompositionState({ compositionStarted: false, composing: false }); this.refreshProtected(readProtected()) } catch (error) { report(error) }
          }
          this.compositionFrame = requestAnimationFrame(finish)
          return false
        },
        mouseover: (event: MouseEvent) => {
          const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-entity-id]') : null
          if (!target) return false
          const id = target.dataset.entityId
          const reference = entityRefs.find(r => r.id === id)
          if (!reference) return false
          const cm = getCMView()
          if (cm) showPopup(event.clientX, event.clientY + 6, reference)
          return false
        },
        mouseout: (event: MouseEvent) => {
          const related = event.relatedTarget
          if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) return false
          const cm = getCMView()
          if (cm) showPopup(0, 0, null)
          return false
        },
        mousedown: () => {
          // Close menu on any outside click; keep focus on CM
          entityMenuState = null; entityMenuIndex = 0
          return false
        },
        keydown: (event: KeyboardEvent) => {
          if (!entityMenuState) return false
          const items = entityMenuState.filtered
          switch (event.key) {
            case 'Escape':
              entityMenuState = null; entityMenuIndex = 0
              showPopup(0, 0, null); break
            case 'Enter': {
              if (items.length === 0) { entityMenuState = null; break }
              const chosen = items[entityMenuIndex]
              getCMView()?.dispatch({
                changes: { from: entityMenuState.from, to: entityMenuState.to, insert: chosen.name },
                selection: { anchor: entityMenuState.from + chosen.name.length },

              })
              entityMenuState = null; entityMenuIndex = 0; break
            }
            case 'ArrowUp': {
              event.preventDefault()
              entityMenuIndex = Math.max(0, entityMenuIndex - 1)
              showPopup(entityMenuState.x, entityMenuState.y, null)
              break
            }
            case 'ArrowDown': {
              event.preventDefault()
              entityMenuIndex = Math.min(items.length - 1, entityMenuIndex + 1)
              showPopup(entityMenuState.x, entityMenuState.y, null)
              break
            }
            default: return false
          }
          // Reposition after nav
          const cm = getCMView()
          if (cm && entityMenuState) {
            const coords = cm.coordsAtPos(entityMenuState.from)
            if (coords) entityMenuState = { ...entityMenuState, x: coords.left, y: coords.bottom + 6 }
          }
          return true
        },
      }),
      EditorView.updateListener.of(update => { if (update.selectionSet || update.docChanged) for (const listener of this.listeners) listener() }),
      EditorView.exceptionSink.of(report),
      EditorView.baseTheme({
        '&': { fontSize: '14px', lineHeight: '1.8', minHeight: '400px' },
        '.cm-content': { padding: '12px 16px', caretColor: 'currentColor' },
        '.cm-scroller': { fontFamily: 'inherit', overflow: 'auto' },
        '.sf-md-strong': { fontWeight: 'bold' }, '.sf-md-emphasis': { fontStyle: 'italic' }, '.sf-md-strike': { textDecoration: 'line-through' },
        '.sf-md-code, .sf-md-fencedcode, .sf-md-codeblock': { fontFamily: 'monospace', backgroundColor: 'rgba(128,128,128,.1)' },
        '.sf-md-link': { textDecoration: 'underline' }, '.sf-md-heading': { fontWeight: 'bold' },
        '.sf-md-separator': { display: 'inline-block', width: '95%', borderTop: '1px solid #888', verticalAlign: 'middle' },
        '.sf-md-h1': { fontSize: '2em' }, '.sf-md-h2': { fontSize: '1.7em' }, '.sf-md-h3': { fontSize: '1.4em' },
        '.sf-md-h4': { fontSize: '1.2em' }, '.sf-md-h5': { fontSize: '1.1em' },
        '.sf-md-blockquote': { borderLeft: '3px solid #888', paddingLeft: '1em' },
        '.sf-authoring-protected': { border: '1px solid #888', borderRadius: '6px', padding: '8px', whiteSpace: 'pre-wrap' },
        '.sf-authoring-protected button': { fontSize: '12px', cursor: 'pointer' },
      }),
    ])
    this.view = new EditorView({ parent: input.parent, state: adapter.getCodeMirrorState(), dispatchTransactions: (transactions, view) => {
      try { adapter.setCompositionState({ compositionStarted: this.compositionEventStarted || view.compositionStarted, composing: view.composing }) } catch (error) { report(error) }
      for (const transaction of transactions) {
        try {
          adapter.dispatchSourceTransaction({ identity: adapter.identity, sourceRevision: adapter.sourceRevision, transaction })
          view.update([transaction])
        } catch (error) {
          // Parsing may fail after the source was accepted. Keep that exact
          // draft visible; a preflight rejection retains the previous state.
          if (adapter.getCodeMirrorState() === transaction.state) view.update([transaction])
          report(error); break
        }
      }
      if (!this.compositionEventStarted && !view.compositionStarted && !view.composing) {
        try { this.refreshProtected(readProtected()) } catch (error) { report(error) }
      }
    } })
  }

  private refreshProtected(rows: readonly ProtectedViewV1[]) {
    const old = this.view.state.field(this.protectedField).rows
    if (rows.length === old.length && rows.every((row, index) => row.from === old[index].from && row.to === old[index].to && row.key === old[index].key && row.hash === old[index].hash)) return
    this.view.dispatch({ effects: refreshProtected.of(rows) })
  }
  private assertLive() { if (this.destroyed) throw new Error('编辑视图已关闭，迟到操作未写入原稿。') }
  setDisplayMode(mode: 'source' | 'preview') {
    this.assertLive()
    const transaction = this.adapter.setDisplayMode(mode)
    if (transaction) this.view.update([transaction])
  }
  commitExternalHtml(input: Parameters<AuthoringDocumentAdapterV1['commitExternalHtml']>[0]) {
    this.assertLive()
    const transaction = this.adapter.commitExternalHtml(input)
    if (transaction) {
      this.view.update([transaction])
      this.refreshProtected(this.readProtected())
    }
  }
  preparePaste(text: string, signal: AbortSignal): Promise<AuthoringPasteDraftV1> {
    this.assertLive()
    const selection = this.view.state.selection
    if (selection.ranges.length !== 1) return Promise.reject(new Error('大段粘贴需要一个明确的插入范围。'))
    return this.adapter.preparePaste({ identity: this.adapter.identity, sourceRevision: this.adapter.sourceRevision, baselineEpoch: this.adapter.baselineEpoch,
      from: selection.main.from, to: selection.main.to, text, signal })
  }
  commitPaste(draft: AuthoringPasteDraftV1) {
    this.assertLive()
    const transaction = this.adapter.commitPaste(draft)
    this.view.update([transaction]); this.refreshProtected(this.readProtected())
  }
  subscribeSelection(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSelectionSnapshot() {
    const selection = this.view.state.selection
    return selection.ranges.length === 1 && !selection.main.empty ? this.adapter.mapSelection(selection.main.from, selection.main.to) : null
  }
  getSelectionRect(): DOMRect | null {
    const selection = this.view.state.selection.main
    if (selection.empty) return null
    const from = this.view.coordsAtPos(selection.from), to = this.view.coordsAtPos(selection.to)
    if (!from || !to) return null
    return new DOMRect(Math.min(from.left, to.left), Math.min(from.top, to.top), Math.max(from.right, to.right) - Math.min(from.left, to.left), Math.max(from.bottom, to.bottom) - Math.min(from.top, to.top))
  }
  /**
   * 给既有 FloatingToolbar 的选区快照：内部走 adapter.mapSelection 得到 PM 坐标，
   * 只投影 {from,to,text,sourceHtml}，绝不把 CM 源 pos 冒充 PM pos。同一份
   * 真实 AuthoringSelectionSnapshotV1 暂存在本会话，供后续预演按 key 取回。
   */
  getToolbarSelectionV1(): ToolbarSelectionProjectionV1 {
    this.assertLive()
    const selection = this.view.state.selection
    if (selection.ranges.length !== 1 || selection.main.empty) return { snapshot: null, reason: '请先选择可编辑的正文范围。' }
    const mapped = this.adapter.mapSelection(selection.main.from, selection.main.to)
    if (!mapped.ok) return { snapshot: null, reason: mapped.reason }
    const { from, to, text, sourceHtml } = mapped.snapshot
    const key = `${from}:${to}:${sourceHtml}:${text}`
    if (this.toolbarSelections.size >= 32) this.toolbarSelections.clear()
    this.toolbarSelections.set(key, mapped.snapshot)
    return { snapshot: { from, to, text, sourceHtml } }
  }

  /** 只认本会话 mapSelection 登记过的内部快照；过期/保护块/语法边界由 adapter 返回 null。 */
  previewToolbarReplacementV1(target: ToolbarReplacementTargetV1, outputText: string): string | null {
    this.assertLive()
    const key = `${target.from}:${target.to}:${target.sourceHtml}:${target.text}`
    const snapshot = this.toolbarSelections.get(key)
    if (!snapshot) return null
    return this.adapter.previewReplacement(snapshot, outputText)
  }

  destroy() {
    this.destroyed = true; cancelAnimationFrame(this.compositionFrame); this.pasteAbort?.abort()
    // cleanup popup on destroy
  }
}
