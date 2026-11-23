import { Annotation, ChangeSet, Compartment, StateEffect, type ChangeSpec, type EditorState, type Extension, type Transaction } from '@codemirror/state'
import { history, invertedEffects, isolateHistory, undo, redo } from '@codemirror/commands'
import { DOMParser as ProseMirrorDOMParser, Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import { getHTMLFromFragment } from '@tiptap/core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { WorkspaceScope } from '../types'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { countWords, htmlToPlainText, plainTextToHtml } from '../utils/html'
import { authoringSchemaV1, parseAuthoringHtmlV1, splitAuthoringHtmlV1 } from './authoring-html-blocks'
import { joinMarkdownBlockProjectionsV1, projectAuthoringPmV1, projectProtectedTextV1 } from './authoring-markdown-projection'
import { compileNovelMarkdownV1, createNovelMarkdownStateV1, type CompiledNovelBlockV1 } from './novel-markdown-codec'

export interface AuthoringDocumentIdentityV1 extends WorkspaceScope {
  chapterId: number
  /** The existing PROJECT_TABLES chapter resource identity, never a new id. */
  chapterUid: string
}
interface BlockEnvelopeV1 extends CompiledNovelBlockV1 {
  key: number
  protected: boolean
  htmlFrom: number
  htmlTo: number
  protectedContext?: string
  htmlHash: string
}
/** Only explicit external-adoption boundaries keep a raw binding in history.
 * Ordinary keystrokes use CM's changes, without DOM or whole-document copies. */
interface RawBindingV1 {
  readonly identityKey: string
  readonly source: string
  readonly html: string
  readonly rows: readonly Pick<BlockEnvelopeV1, 'from' | 'to' | 'kind' | 'key' | 'html' | 'htmlHash' | 'protected' | 'pendingSyntax' | 'syntaxSignature' | 'protectedContext'>[]
  readonly gaps: readonly Readonly<{ pos: number; html: string }>[]
}
interface RawBindingChangeV1 { readonly target: RawBindingV1; readonly inverse: RawBindingV1 }
const rawBindingEffect = StateEffect.define<RawBindingChangeV1>()
const externalAdoption = Annotation.define<boolean>()
const issuedBindings = new WeakSet<RawBindingV1>()
export interface AuthoringSelectionSnapshotV1 {
  readonly from: number
  readonly to: number
  readonly text: string
  readonly sourceHtml: string
  readonly sourceContentHash: string
  readonly sourceRevision: number
  readonly baselineEpoch: number
  readonly identityKey: string
  readonly schemaVersion: 'rich-editor-heading-1-6@1'
}
export type AuthoringSelectionResultV1 = { ok: true; snapshot: AuthoringSelectionSnapshotV1 } | { ok: false; reason: string }
export interface AuthoringPasteDraftV1 {
  readonly identityKey: string
  readonly sourceRevision: number
  readonly baselineEpoch: number
  readonly sourceHtml: string
  readonly from: number
  readonly to: number
  readonly text: string
  readonly previewHtml: string
}

function identityKey(identity: AuthoringDocumentIdentityV1): string {
  for (const number of [identity.projectId, identity.worldId, identity.workId, identity.chapterId]) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('正文身份不完整。')
  }
  if (!isPortableResourceUidV1(identity.chapterUid, 'chapter')) throw new Error('章节稳定身份无法核对，请继续使用原编辑器。')
  return JSON.stringify([identity.projectId, identity.worldId, identity.workId, identity.chapterId, identity.chapterUid])
}
function overlaps(from: number, to: number, a: number, b: number): boolean { return from <= b && to >= a }
function completeUtf16(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}
function utf16Boundary(text: string, pos: number): boolean {
  if (pos === 0 || pos === text.length) return true
  const left = text.charCodeAt(pos - 1), right = text.charCodeAt(pos)
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff)
}
function containedBlocks(rows: readonly CompiledNovelBlockV1[], from: number, to: number): CompiledNovelBlockV1[] {
  let low = 0, high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows[middle].from < from) low = middle + 1
    else high = middle
  }
  const result: CompiledNovelBlockV1[] = []
  for (let i = low; i < rows.length && rows[i].from <= to; i++) if (rows[i].to <= to) result.push(rows[i])
  return result
}
function combineDocs(rows: readonly { pmDoc: ProseMirrorNode }[]): ProseMirrorNode {
  return authoringSchemaV1().nodes.doc.create(null, rows.reduce((fragment, row) => fragment.append(row.pmDoc.content), Fragment.empty))
}
function contextSignature(rows: readonly CompiledNovelBlockV1[], from: number): string {
  return JSON.stringify(rows.map(row => [row.from - from, row.to - from, row.kind, row.syntaxSignature ?? '']))
}
const rawHtmlHash = (html: string) => bytesToHex(sha256(new TextEncoder().encode(html)))

/** Headless, in-memory prototype. It has no DB/AI/persistence authority and is
 * not mounted by any product entry. HTML remains the sole formal body. */
export class AuthoringDocumentAdapterV1 {
  readonly identity: Readonly<AuthoringDocumentIdentityV1>
  readonly identityKey: string
  private state!: EditorState
  private display = new Compartment()
  private viewSlot = new Compartment()
  private viewAttached = false
  private rows: BlockEnvelopeV1[] = []
  private gaps: { pos: number; html: string }[] = []
  private pendingChanges: ChangeSet | null = null
  private lastHtml = ''
  private nextBlockKey = 1
  private composing = false
  private compositionStarted = false
  private selections = new WeakSet<AuthoringSelectionSnapshotV1>()
  private pasteDrafts = new WeakMap<AuthoringPasteDraftV1, AbortSignal>()
  private onHtmlChange?: (html: string, plainText: string) => void
  private currentSourceRevision = 0
  private currentBaselineEpoch = 0
  private currentRenderRevision = 0
  private currentDisplayMode: 'source' | 'preview' = 'preview'
  get sourceRevision() { return this.currentSourceRevision }
  /** A local invalidation epoch, never a database revision or adoption receipt. */
  get baselineEpoch() { return this.currentBaselineEpoch }
  get renderRevision() { return this.currentRenderRevision }
  get displayMode() { return this.currentDisplayMode }

  constructor(input: { identity: AuthoringDocumentIdentityV1; html: string; onHtmlChange?: (html: string, plainText: string) => void }) {
    this.identityKey = identityKey(input.identity)
    this.identity = Object.freeze({ ...input.identity })
    this.onHtmlChange = input.onHtmlChange
    this.loadHtml(input.html)
  }

  private assertIdentity(identity: AuthoringDocumentIdentityV1) {
    if (identityKey(identity) !== this.identityKey) throw new Error('正文作用域或章节身份已变化，草稿未写入其它章节。')
  }
  private assertNotComposing() {
    if (this.compositionStarted || this.composing) throw new Error('请先结束输入法组合，当前源草稿已保留。')
  }
  private loadHtml(html: string) {
    const framed = splitAuthoringHtmlV1(html)
    const originals = framed.slices.map(slice => {
      const parsed = parseAuthoringHtmlV1(slice.html, framed.framed)
      const projection = projectAuthoringPmV1(parsed.pmDoc.childCount === 1 ? parsed.pmDoc.firstChild! : parsed.pmDoc)
      const protectedBlock = parsed.protected || !projection.lossless
      return { slice, parsed, protected: protectedBlock, projection: protectedBlock ? projectProtectedTextV1(parsed.pmDoc) : projection }
    })
    let projected = joinMarkdownBlockProjectionsV1(originals.map(row => row.projection))
    this.state = this.createState(projected.source)
    let compiled = compileNovelMarkdownV1(this.state)
    let changed = false
    originals.forEach((row, index) => {
      if (row.protected) return
      const range = projected.ranges[index]
      const covered = containedBlocks(compiled, range.from, range.to)
      if (!covered.length || !combineDocs(covered).eq(row.parsed.pmDoc)) {
        row.protected = true; row.projection = projectProtectedTextV1(row.parsed.pmDoc); changed = true
      }
    })
    if (changed) {
      projected = joinMarkdownBlockProjectionsV1(originals.map(row => row.projection))
      this.state = this.createState(projected.source)
      compiled = compileNovelMarkdownV1(this.state)
    }
    this.rows = originals.length ? originals.map((row, index) => {
      const range = projected.ranges[index]
      const covered = containedBlocks(compiled, range.from, range.to)
      const dom = document.createElement('div')
      if (row.protected) for (const child of [...row.parsed.dom.childNodes]) dom.append(child.cloneNode(true))
      else for (const block of covered) for (const child of [...block.dom.childNodes]) dom.append(child)
      return { from: range.from, to: range.to, kind: covered[0]?.kind ?? 'paragraph', key: this.nextBlockKey++,
        dom, pmDoc: row.parsed.pmDoc, html: row.slice.html, leaves: row.protected ? [] : covered.flatMap(block => block.leaves),
        pendingSyntax: false, protected: row.protected, htmlFrom: 0, htmlTo: 0, syntaxSignature: covered.length === 1 ? covered[0].syntaxSignature : undefined,
        protectedContext: row.protected ? contextSignature(covered, range.from) : undefined, htmlHash: rawHtmlHash(row.slice.html) }
    }) : []
    this.gaps = originals.flatMap((row, index) => row.slice.leading ? [{ pos: projected.ranges[index].from, html: row.slice.leading }] : [])
    if (framed.trailing) this.gaps.push({ pos: projected.source.length + 1, html: framed.trailing })
    this.pendingChanges = null
    this.lastHtml = html
    if (originals.length) this.assembleHtml()
  }

  private createState(source: string): EditorState {
    return createNovelMarkdownStateV1(source, [history(), this.display.of([]), this.viewSlot.of([]), invertedEffects.of(transaction =>
      transaction.effects.filter(effect => effect.is(rawBindingEffect)).map(effect =>
        rawBindingEffect.of(Object.freeze({ target: effect.value.inverse, inverse: effect.value.target })))),
    ])
  }

  private captureRawBinding(): RawBindingV1 {
    this.materialize()
    const binding: RawBindingV1 = Object.freeze({ identityKey: this.identityKey, source: this.getSource(), html: this.lastHtml,
      rows: Object.freeze(this.rows.map(({ from, to, kind, key, html, htmlHash, protected: protectedBlock, pendingSyntax, syntaxSignature, protectedContext }) =>
        Object.freeze({ from, to, kind, key, html, htmlHash, protected: protectedBlock, pendingSyntax, syntaxSignature, protectedContext }))),
      gaps: Object.freeze(this.gaps.map(gap => Object.freeze({ ...gap }))),
    })
    issuedBindings.add(binding)
    return binding
  }

  private restoreRawBinding(binding: RawBindingV1, state: EditorState) {
    if (!issuedBindings.has(binding) || binding.identityKey !== this.identityKey || binding.source !== state.doc.toString()) throw new Error('撤销绑定与当前章节源码不符，原稿未覆盖。')
    const compiled = compileNovelMarkdownV1(state)
    const rows = binding.rows.map(saved => {
      if (rawHtmlHash(saved.html) !== saved.htmlHash) throw new Error('撤销绑定的原文校验失败。')
      const parsed = parseAuthoringHtmlV1(saved.html)
      const covered = containedBlocks(compiled, saved.from, saved.to)
      if (!saved.protected && (!covered.length || !combineDocs(covered).eq(parsed.pmDoc))) throw new Error('撤销绑定的正文结构无法核对。')
      const dom = document.createElement('div')
      const content = saved.protected ? [parsed.dom] : covered.map(block => block.dom)
      for (const block of content) for (const child of [...block.childNodes]) dom.append(child.cloneNode(true))
      // Source leaves must refer to the exact controlled nodes used for mapping.
      // Compilation nodes are safe and owned only by this restored state.
      if (!saved.protected) {
        dom.replaceChildren()
        for (const block of covered) for (const child of [...block.dom.childNodes]) dom.append(child)
      }
      return { ...saved, dom, pmDoc: parsed.pmDoc, leaves: saved.protected ? [] : covered.flatMap(block => block.leaves), htmlFrom: 0, htmlTo: 0 }
    })
    const previousRows = this.rows, previousGaps = this.gaps
    this.rows = rows; this.gaps = binding.gaps.map(gap => ({ ...gap }))
    if (this.assembleHtml() !== binding.html) {
      this.rows = previousRows; this.gaps = previousGaps
      throw new Error('撤销绑定的原始块或间隙校验失败。')
    }
    this.state = state; this.pendingChanges = null; this.lastHtml = binding.html
    for (const row of rows) this.nextBlockKey = Math.max(this.nextBlockKey, row.key + 1)
  }

  private assembleHtml(): string {
    let html = '', gap = 0
    for (const row of this.rows) {
      while (gap < this.gaps.length && this.gaps[gap].pos <= row.from) html += this.gaps[gap++].html
      row.htmlFrom = html.length; html += row.html; row.htmlTo = html.length
    }
    while (gap < this.gaps.length) html += this.gaps[gap++].html
    return html
  }

  private materialize() {
    this.assertNotComposing()
    if (!this.pendingChanges) return
    if (!completeUtf16(this.getSource())) throw new Error('输入仍含未完成字符，源草稿已保留，尚未保存。')
    const changes = this.pendingChanges
    const mapped = this.rows.map(row => ({ row, from: changes.mapPos(row.from, 1), to: changes.mapPos(row.to, -1), touched: false }))
    changes.iterChangedRanges((from, to) => {
      for (const candidate of mapped) if (overlaps(from, to, candidate.row.from, candidate.row.to)) candidate.touched = true
    })
    const untouched = new Map(mapped.filter(candidate => !candidate.touched)
      .map(candidate => [`${candidate.from}:${candidate.to}:${candidate.row.kind}`, candidate]))
    const compiled = compileNovelMarkdownV1(this.state, (from, to, kind, signature) => {
      const candidate = untouched.get(`${from}:${to}:${kind}`)
      return candidate && (candidate.row.syntaxSignature ?? (kind === 'paragraph' ? '[]' : '')) === signature
        ? { ...candidate.row, from, to, sourceShift: (candidate.row.sourceShift ?? 0) + from - candidate.row.from } : undefined
    })
    const protectedRows = mapped.filter(candidate => candidate.row.protected)
    for (const candidate of protectedRows) {
      if (contextSignature(containedBlocks(compiled, candidate.from, candidate.to), candidate.from) !== candidate.row.protectedContext) throw new Error('该语法会改变受保护的旧稿块；源草稿保留，请使用富文本。')
      let low = 0, high = compiled.length
      while (low < high) { const mid = (low + high) >>> 1; if (compiled[mid].to < candidate.from) low = mid + 1; else high = mid }
      for (let i = low; i < compiled.length && compiled[i].from <= candidate.to; i++) {
        const block = compiled[i]
        if (overlaps(block.from, block.to, candidate.from, candidate.to) && !(block.from >= candidate.from && block.to <= candidate.to)) throw new Error('该语法会改变受保护的旧稿块；源草稿保留，请换行或使用富文本。')
      }
    }
    const result: BlockEnvelopeV1[] = []
    const emittedProtected = new Set<number>()
    let protectedIndex = 0
    for (const block of compiled) {
      while (protectedIndex < protectedRows.length && protectedRows[protectedIndex].to < block.from) protectedIndex++
      const at = protectedRows[protectedIndex]
      const protectedRow = at && block.from >= at.from && block.to <= at.to ? at : undefined
      if (protectedRow) {
        if (!emittedProtected.has(protectedRow.row.key)) {
          result.push({ ...protectedRow.row, from: protectedRow.from, to: protectedRow.to }); emittedProtected.add(protectedRow.row.key)
        }
        continue
      }
      const atPrevious = untouched.get(`${block.from}:${block.to}:${block.kind}`)
      const previous = atPrevious && (atPrevious.row.syntaxSignature ?? (block.kind === 'paragraph' ? '[]' : '')) === (block.syntaxSignature ?? (block.kind === 'paragraph' ? '[]' : '')) ? atPrevious : undefined
      result.push(previous ? { ...previous.row, from: block.from, to: block.to, dom: block.dom, leaves: block.leaves, sourceShift: block.sourceShift }
        : { ...block, key: this.nextBlockKey++, protected: false, htmlFrom: 0, htmlTo: 0, htmlHash: rawHtmlHash(block.html) })
    }
    const gaps = this.gaps.map(gap => ({ ...gap, pos: gap.pos > changes.length ? this.state.doc.length + 1 : changes.mapPos(gap.pos, 1) }))
    this.rows = result; this.gaps = gaps; this.pendingChanges = null
    const html = this.assembleHtml(), previous = this.lastHtml
    this.lastHtml = html
    if (html !== previous) this.onHtmlChange?.(html, htmlToPlainText(html))
  }

  getSource(): string { return this.state.doc.toString() }
  getHtml(): string { this.materialize(); return this.lastHtml }
  getPlainText(): string { return htmlToPlainText(this.getHtml()) }
  getWordCount(): number { return countWords(this.getPlainText()) }
  getEnvelopes() { this.materialize(); return this.rows.map(row => ({ key: row.key, from: row.from, to: row.to, html: row.html, htmlHash: row.htmlHash, protected: row.protected, pendingSyntax: row.pendingSyntax })) }

  applySourceChange(input: { identity: AuthoringDocumentIdentityV1; sourceRevision: number; changes: ChangeSpec }): void {
    this.dispatchSourceTransaction({ ...input, transaction: this.state.update({ changes: input.changes, userEvent: 'input' }) })
  }

  getCodeMirrorState(): EditorState { return this.state }

  /** Explicit large input is parsed in an isolated temporary session. Nothing
   * enters the active document until the caller confirms this issued draft. */
  async preparePaste(input: { identity: AuthoringDocumentIdentityV1; sourceRevision: number; baselineEpoch: number; from: number; to: number; text: string; signal: AbortSignal }): Promise<AuthoringPasteDraftV1> {
    this.assertIdentity(input.identity); this.assertNotComposing(); input.signal.throwIfAborted()
    if (input.sourceRevision !== this.sourceRevision || input.baselineEpoch !== this.baselineEpoch) throw new Error('粘贴目标已变化，原稿未改变。')
    const binding = this.captureRawBinding()
    // Yield before and after bounded synchronous parsing so cancellation and
    // navigation get a chance to invalidate the pending draft before commit.
    const yieldToInput = () => new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(new DOMException('粘贴已取消。', 'AbortError')) }
      const timer = setTimeout(() => { input.signal.removeEventListener('abort', aborted); resolve() }, 0)
      input.signal.addEventListener('abort', aborted, { once: true })
    })
    await yieldToInput(); input.signal.throwIfAborted()
    const temporary = new AuthoringDocumentAdapterV1({ identity: this.identity, html: '' })
    temporary.restoreRawBinding(binding, temporary.createState(binding.source))
    temporary.applySourceChange({ identity: this.identity, sourceRevision: temporary.sourceRevision, changes: { from: input.from, to: input.to, insert: input.text } })
    const previewHtml = temporary.getHtml()
    await yieldToInput(); input.signal.throwIfAborted()
    this.assertNotComposing()
    if (input.sourceRevision !== this.sourceRevision || input.baselineEpoch !== this.baselineEpoch || binding.html !== this.getHtml()) throw new Error('粘贴等待期间正文已变化，原稿未覆盖。')
    const draft = Object.freeze({ identityKey: this.identityKey, sourceRevision: input.sourceRevision, baselineEpoch: input.baselineEpoch, sourceHtml: binding.html,
      from: input.from, to: input.to, text: input.text, previewHtml })
    this.pasteDrafts.set(draft, input.signal)
    return draft
  }

  commitPaste(draft: AuthoringPasteDraftV1): Transaction {
    this.assertNotComposing()
    if (!this.pasteDrafts.has(draft) || this.pasteDrafts.get(draft)!.aborted || draft.identityKey !== this.identityKey || draft.sourceRevision !== this.sourceRevision || draft.baselineEpoch !== this.baselineEpoch || draft.sourceHtml !== this.getHtml()) throw new Error('粘贴草稿已取消、过期或来自其它章节，原稿未覆盖。')
    const transaction = this.state.update({ changes: { from: draft.from, to: draft.to, insert: draft.text }, userEvent: 'input.paste', annotations: isolateHistory.of('full') })
    this.dispatchSourceTransaction({ identity: this.identity, sourceRevision: this.sourceRevision, transaction })
    this.pasteDrafts.delete(draft)
    return transaction
  }

  /** A view attaches extensions to this same immutable state/history once. */
  attachViewExtensions(extensions: Extension): void {
    this.assertNotComposing()
    if (this.viewAttached) throw new Error('该正文会话已经有一个活动编辑视图。')
    this.state = this.state.update({ effects: this.viewSlot.reconfigure(extensions) }).state
    this.viewAttached = true
  }
  detachViewExtensions(): void {
    this.state = this.state.update({ effects: this.viewSlot.reconfigure([]) }).state
    this.viewAttached = false
  }

  dispatchSourceTransaction(input: { identity: AuthoringDocumentIdentityV1; sourceRevision: number; transaction: Transaction }): void {
    this.assertIdentity(input.identity)
    if (input.sourceRevision !== this.sourceRevision) throw new Error('源文档已变化，请重新取得当前编辑会话。')
    const transaction = input.transaction
    if (transaction.startState !== this.state) throw new Error('编辑交易来自旧会话，当前源草稿已保留。')
    const rawChanges = transaction.effects.filter(effect => effect.is(rawBindingEffect))
    if (rawChanges.length) {
      this.assertNotComposing()
      if (rawChanges.length !== 1) throw new Error('正文基线交易不唯一，原稿未覆盖。')
      const previous = this.getHtml()
      this.restoreRawBinding(rawChanges[0].value.target, transaction.state)
      this.currentBaselineEpoch++
      if (!transaction.annotation(externalAdoption)) {
        this.currentSourceRevision++
        if (this.lastHtml !== previous) this.onHtmlChange?.(this.lastHtml, htmlToPlainText(this.lastHtml))
      }
      return
    }
    if (!transaction.docChanged) { this.state = transaction.state; return }
    const source = this.getSource()
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      if (!utf16Boundary(source, from) || !utf16Boundary(source, to)) throw new Error('不能拆开一个完整字符；原稿未改变。')
      if (!this.compositionStarted && !this.composing && !completeUtf16(inserted.toString())) throw new Error('输入含未完成字符；原稿未改变。')
    })
    const currentProtected = this.rows.filter(row => row.protected).map(row => ({
      from: this.pendingChanges?.mapPos(row.from, 1) ?? row.from, to: this.pendingChanges?.mapPos(row.to, -1) ?? row.to,
    }))
    transaction.changes.iterChangedRanges((from, to) => {
      if (currentProtected.some(row => overlaps(from, to, row.from, row.to))) throw new Error('旧格式块受保护，请使用富文本明确编辑；原稿未改变。')
    })
    this.state = transaction.state; this.currentSourceRevision++
    this.pendingChanges = this.pendingChanges ? this.pendingChanges.compose(transaction.changes) : transaction.changes
    if (!this.compositionStarted && !this.composing) this.materialize()
  }

  undoSource(): boolean {
    this.assertNotComposing()
    return undo({ state: this.state, dispatch: transaction => this.dispatchSourceTransaction({ identity: this.identity, sourceRevision: this.sourceRevision, transaction }) })
  }
  redoSource(): boolean {
    this.assertNotComposing()
    return redo({ state: this.state, dispatch: transaction => this.dispatchSourceTransaction({ identity: this.identity, sourceRevision: this.sourceRevision, transaction }) })
  }

  setDisplayMode(mode: 'source' | 'preview'): Transaction | undefined {
    this.assertNotComposing()
    if (mode === this.displayMode) return
    const transaction = this.state.update({ effects: this.display.reconfigure([]) })
    this.state = transaction.state
    this.currentDisplayMode = mode; this.currentRenderRevision++
    return transaction
  }
  setCompositionState(input: { compositionStarted: boolean; composing: boolean }) {
    const wasActive = this.compositionStarted || this.composing
    this.compositionStarted = input.compositionStarted; this.composing = input.composing
    if (wasActive && !input.compositionStarted && !input.composing) this.materialize()
  }

  mapSelection(from: number, to: number): AuthoringSelectionResultV1 {
    try {
      this.assertNotComposing()
      const sourceHtml = this.getHtml()
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > this.state.doc.length) throw new Error('请选择可见正文的完整范围。')
      if (this.rows.some(row => row.protected && overlaps(from, to, row.from, row.to))) throw new Error('选择涉及受保护的旧格式块，请在富文本中编辑。')
      if (this.rows.some(row => overlaps(from, to, row.from, row.to) && row.dom.textContent !== row.pmDoc.textContent)) throw new Error('该段的空格或换行无法由正式编辑器逐字保留，请使用富文本。')
      const leaves = this.rows.flatMap(row => row.leaves.map(leaf => ({ ...leaf, sourceShift: row.sourceShift ?? 0 })))
      const find = (pos: number) => {
        for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
          const leaf = leaves[leafIndex]
          for (let pieceIndex = 0; pieceIndex < leaf.pieces.length; pieceIndex++) {
            const piece = leaf.pieces[pieceIndex], offset = piece.boundaries.indexOf(pos - leaf.sourceShift)
            if (offset >= 0) return { leafIndex, pieceIndex, node: piece.node as Node, offset }
          }
          if (leaf.from === leaf.to && pos === leaf.from + leaf.sourceShift) return { leafIndex, pieceIndex: 0, node: leaf.dom as Node, offset: 0 }
        }
        return null
      }
      const start = find(from), end = find(to)
      if (!start || !end) throw new Error('选择边界位于语法、链接目标、实体内部或半个字符，不能精确替换。')
      const expected: string[] = []
      for (let index = start.leafIndex; index <= end.leafIndex; index++) {
        const pieces = leaves[index].pieces
        expected.push(pieces.map((piece, pieceIndex) => {
          if (index === start.leafIndex && pieceIndex < start.pieceIndex || index === end.leafIndex && pieceIndex > end.pieceIndex) return ''
          return piece.text.slice(index === start.leafIndex && pieceIndex === start.pieceIndex ? start.offset : 0,
            index === end.leafIndex && pieceIndex === end.pieceIndex ? end.offset : piece.text.length)
        }).join(''))
      }
      const text = expected.join('\n')
      const root = document.createElement('div'), cloned = new Map<Node, Node>()
      const clone = (node: Node): Node => {
        const result = node.cloneNode(false); cloned.set(node, result)
        for (const child of [...node.childNodes]) result.appendChild(clone(child))
        return result
      }
      for (const row of this.rows) for (const child of [...row.dom.childNodes]) root.append(clone(child))
      const positions = [{ node: cloned.get(start.node)!, offset: start.offset }, { node: cloned.get(end.node)!, offset: end.offset }] as { node: Node; offset: number; pos?: number }[]
      if (positions.some(position => !position.node)) throw new Error('当前投影不能提供精确位置。')
      const pmDoc = ProseMirrorDOMParser.fromSchema(authoringSchemaV1()).parse(root, { findPositions: positions })
      if (!pmDoc.eq(parseAuthoringHtmlV1(sourceHtml).pmDoc) || !pmDoc.eq(combineDocs(this.rows))) throw new Error('现有HTML与投影的结构无法逐字核对，请使用富文本。')
      const pmFrom = positions[0].pos, pmTo = positions[1].pos
      if (pmFrom === undefined || pmTo === undefined || pmTo <= pmFrom || pmDoc.textBetween(pmFrom, pmTo, '\n') !== text) throw new Error('选择的可见文字与正式编辑器位置不一致，请调整范围或使用富文本。')
      const snapshot = Object.freeze({ from: pmFrom, to: pmTo, text, sourceHtml, sourceRevision: this.sourceRevision, baselineEpoch: this.baselineEpoch, identityKey: this.identityKey,
        sourceContentHash: bytesToHex(sha256(new TextEncoder().encode(sourceHtml))), schemaVersion: 'rich-editor-heading-1-6@1' as const })
      this.selections.add(snapshot)
      return { ok: true, snapshot }
    } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '无法证明选区，原稿未改变。' } }
  }

  previewReplacement(snapshot: AuthoringSelectionSnapshotV1, text: string): string | null {
    this.assertNotComposing()
    if (!this.selections.has(snapshot) || snapshot.identityKey !== this.identityKey || snapshot.sourceRevision !== this.sourceRevision || snapshot.baselineEpoch !== this.baselineEpoch || snapshot.sourceHtml !== this.getHtml()) return null
    const affected: { row: BlockEnvelopeV1; from: number; to: number }[] = []
    let pos = 0
    for (const row of this.rows) {
      const end = pos + row.pmDoc.content.size
      if (snapshot.from < end && snapshot.to > pos) affected.push({ row, from: pos, to: end })
      pos = end
    }
    if (!affected.length || affected.some(item => item.row.protected || item.row.dom.textContent !== item.row.pmDoc.textContent)) return null
    const schema = authoringSchemaV1(), original = parseAuthoringHtmlV1(snapshot.sourceHtml).pmDoc
    const inserted = parseAuthoringHtmlV1(plainTextToHtml(text)).dom
    const replacement = ProseMirrorDOMParser.fromSchema(schema).parseSlice(inserted)
    const transaction = new Transform(original).replaceRange(snapshot.from, snapshot.to, replacement)
    const from = transaction.mapping.map(affected[0].from, -1), to = transaction.mapping.map(affected[affected.length - 1].to, 1)
    const boundaries = new Set([0]); transaction.doc.forEach((node, offset) => { boundaries.add(offset); boundaries.add(offset + node.nodeSize) })
    if (!boundaries.has(from) || !boundaries.has(to)) return null
    const html = getHTMLFromFragment(transaction.doc.content.cut(from, to), schema)
    const result = snapshot.sourceHtml.slice(0, affected[0].row.htmlFrom) + html + snapshot.sourceHtml.slice(affected[affected.length - 1].row.htmlTo)
    return parseAuthoringHtmlV1(result).pmDoc.eq(transaction.doc) ? result : null
  }

  /** Caller must first verify the real committed receipt in the existing domain.
   * receiptId is attribution, not proof of authority. This local view refresh
   * neither adopts nor writes, and its undo is a new author edit. */
  commitExternalHtml(input: { identity: AuthoringDocumentIdentityV1; sourceRevision: number; baselineEpoch: number; sourceHtml: string; html: string; receiptId: string; origin: 'external-adopt' }): Transaction | undefined {
    this.assertIdentity(input.identity); this.assertNotComposing()
    if (!input.receiptId.trim() || input.origin !== 'external-adopt' || input.sourceRevision !== this.sourceRevision || input.baselineEpoch !== this.baselineEpoch || input.sourceHtml !== this.getHtml()) throw new Error('外部回执与当前章节或作者草稿不符，未覆盖输入。')
    if (input.html === this.lastHtml) return
    const before = this.captureRawBinding()
    const prepared = new AuthoringDocumentAdapterV1({ identity: this.identity, html: input.html })
    for (const row of prepared.rows) row.key = this.nextBlockKey++
    const after = prepared.captureRawBinding()
    const transaction = this.state.update({ changes: { from: 0, to: this.state.doc.length, insert: after.source },
      effects: rawBindingEffect.of(Object.freeze({ target: after, inverse: before })),
      annotations: [externalAdoption.of(true), isolateHistory.of('full')],
    })
    this.dispatchSourceTransaction({ identity: this.identity, sourceRevision: this.sourceRevision, transaction })
    return transaction
  }
}
