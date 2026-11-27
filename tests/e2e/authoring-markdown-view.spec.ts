import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release } from 'node:os'
import { build } from 'vite'
import { expect, test } from '@playwright/test'
import type { AuthoringDocumentAdapterV1 } from '../../src/lib/editor/authoring-document-adapter'
import type { AuthoringMarkdownViewV1 } from '../../src/lib/editor/authoring-markdown-view'
import type { AuthoringRichTextSessionV1 } from '../../src/lib/editor/authoring-rich-text-session'
import type { Editor } from '@tiptap/core'
import type { richEditorExtensionsV1 } from '../../src/lib/editor/rich-editor-schema'

declare global {
  interface Window {
    __sfAuthoringPrototype: { Adapter: typeof AuthoringDocumentAdapterV1; View: typeof AuthoringMarkdownViewV1; RichSession: typeof AuthoringRichTextSessionV1; Editor: typeof Editor; extensions: typeof richEditorExtensionsV1 }
    __sfView: AuthoringMarkdownViewV1
    __sfChanges: string[]
    __sfErrors: string[]
    __sfRichRequests: number
    __sfExecuted?: number
  }
}
test.use({ trace: 'off' })
let sourceBundle = ''
test.beforeAll(async () => {
  const entry = 'virtual:authoring-view-probe'
  const adapter = fileURLToPath(new URL('../../src/lib/editor/authoring-document-adapter.ts', import.meta.url))
  const view = fileURLToPath(new URL('../../src/lib/editor/authoring-markdown-view.ts', import.meta.url))
  const rich = fileURLToPath(new URL('../../src/lib/editor/authoring-rich-text-session.ts', import.meta.url))
  const schema = fileURLToPath(new URL('../../src/lib/editor/rich-editor-schema.ts', import.meta.url))
  const built = await build({ configFile: false, publicDir: false, logLevel: 'silent', plugins: [{
    name: 'actual-authoring-view-probe', resolveId(id) { if (id === entry) return '\0' + entry },
    load(id) { if (id === '\0' + entry) return `import {AuthoringDocumentAdapterV1 as Adapter} from ${JSON.stringify(adapter)}; import {AuthoringMarkdownViewV1 as View} from ${JSON.stringify(view)}; import {AuthoringRichTextSessionV1 as RichSession} from ${JSON.stringify(rich)}; import {Editor} from '@tiptap/core'; import {richEditorExtensionsV1 as extensions} from ${JSON.stringify(schema)}; globalThis.__sfAuthoringPrototype={Adapter,View,RichSession,Editor,extensions};` },
  }], build: { write: false, minify: false, rollupOptions: { input: entry, output: { format: 'iife' } } } })
  sourceBundle = (Array.isArray(built) ? built : [built]).flatMap(output => 'output' in output ? output.output : []).filter(output => output.type === 'chunk').map(output => output.code).join('\n')
  expect(sourceBundle).not.toBe('')
})

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => route.abort('blockedbyclient'))
  await page.goto('about:blank')
  await page.addScriptTag({ content: sourceBundle })
})

for (const width of [1728, 1366, 390]) test(`real CM view preserves raw blocks, selection geometry and one source history at width ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const original = '\n<!--gap--><p>甲</p><p></p><p></p><p style="line-height:1.8"><span style="color:red">旧稿😀</span></p><p><strong>重复😀</strong></p>'
  await page.evaluate(html => {
    const { Adapter, View } = window.__sfAuthoringPrototype
    window.__sfChanges = []; window.__sfErrors = []; window.__sfRichRequests = 0
    const parent = document.createElement('div'); parent.style.height = '500px'; document.body.append(parent)
    const adapter = new Adapter({ identity: { projectId: 1, worldId: 2, workId: 3, chapterId: 4, chapterUid: 'res:v1:chapter:11111111-1111-4111-8111-111111111111' }, html,
      onHtmlChange: changed => window.__sfChanges.push(changed) })
    window.__sfView = new View(adapter, { parent, onError: error => window.__sfErrors.push(error.message), onRichText: () => window.__sfRichRequests++ })
  }, original)
  await expect(page.getByRole('button', { name: '用富文本编辑' })).toBeVisible()
  await page.getByRole('button', { name: '用富文本编辑' }).click()
  expect(await page.evaluate(() => window.__sfRichRequests)).toBe(1)
  expect(await page.evaluate(() => window.__sfView.adapter.getHtml())).toBe(original)
  await page.evaluate(() => {
    const editor = window.__sfView
    const block = editor.adapter.getEnvelopes().find(row => row.protected)!
    editor.view.dispatch({ selection: { anchor: block.from + 1 } })
    editor.setDisplayMode('source'); editor.setDisplayMode('preview')
    const source = editor.adapter.getSource(), from = source.lastIndexOf('重复')
    editor.view.dispatch({ selection: { anchor: from, head: from + 4 } })
  })
  const selection = await page.evaluate(() => ({ result: window.__sfView.getSelectionSnapshot(), rect: window.__sfView.getSelectionRect()?.toJSON(), changes: window.__sfChanges.length }))
  expect(selection.result?.ok && selection.result.snapshot.text).toBe('重复😀')
  expect(selection.rect?.height).toBeGreaterThan(0)
  expect(selection.changes).toBe(0)
  await page.evaluate(() => { const editor = window.__sfView; editor.view.dispatch({ selection: { anchor: 1 } }); editor.view.focus() })
  await page.keyboard.insertText('中')
  const authored = await page.evaluate(() => window.__sfView.adapter.getHtml())
  expect(authored).toBe(original.replace('<p>甲</p>', '<p>甲中</p>'))
  await page.evaluate(() => {
    const editor = window.__sfView, adapter = editor.adapter
    editor.commitExternalHtml({ identity: adapter.identity, sourceRevision: adapter.sourceRevision, baselineEpoch: adapter.baselineEpoch,
      sourceHtml: adapter.getHtml(), html: '<p style="color:blue">采纳😀</p><p>正文</p>', receiptId: 'synthetic-already-committed-receipt', origin: 'external-adopt' })
    editor.view.focus()
  })
  await expect(page.getByText('采纳😀', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__sfChanges.length)).toBe(1)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await page.evaluate(() => window.__sfView.adapter.getHtml())).toBe(authored)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await page.evaluate(() => window.__sfView.adapter.getHtml())).toBe(original)
  expect(await page.evaluate(() => window.__sfErrors)).toEqual(['请选择完整字符；旧格式块请使用富文本编辑。'])
})

test('native rich frontend preserves whitespace and untouched bytes with real keyboard input and mark-only commands', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { RichSession, Editor, extensions } = window.__sfAuthoringPrototype
    const raw = '\n<!--gap--><p>甲  乙\n丙😀</p><p></p><p style="line-height:1.8"><span style="color:red">旧稿</span></p><p>重复😀</p>\n'
    let session = new RichSession(raw)
    const parent = document.createElement('div'); document.body.append(parent)
    const editor = new Editor({ element: parent, extensions: extensions(), content: session.getDocument().toJSON(), onTransaction({ transaction, appendedTransactions }) {
      session.applyTransactions([transaction, ...appendedTransactions])
    } })
    session = new RichSession(raw, { document: editor.state.doc })
    const before = session.getHtml(), visible = editor.state.doc.firstChild!.textContent, formalCoordinates = session.canUseFormalPositions()
    const last = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize + 1
    editor.commands.insertContentAt({ from: last, to: last + 2 }, '第二')
    editor.commands.setTextSelection({ from: last, to: last + 2 }); editor.commands.toggleBold()
    const after = session.getHtml()
    editor.destroy()
    return { raw, before, visible, formalCoordinates, after }
  })
  expect(result.before).toBe(result.raw)
  expect(result.visible).toBe('甲  乙\n丙😀')
  expect(result.formalCoordinates).toBe(false)
  expect(result.after).toBe(result.raw.replace('<p>重复😀</p>', '<p><strong>第二</strong>😀</p>'))
})

test('mounted protected DOM and the real inactive PM proof attempt no resources or scripts', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort('blockedbyclient') })
  const html = '<p>旧稿<img src="https://authoring.invalid/image" srcset="https://authoring.invalid/srcset 2x" onerror="window.__sfExecuted=1"></p><iframe src="https://authoring.invalid/frame"></iframe><script>window.__sfExecuted=2</script><style>@import url(https://authoring.invalid/css);</style><p><a href="javascript:window.__sfExecuted=3">链接</a></p><p>正文</p>'
  await page.evaluate(html => {
    const { Adapter, View } = window.__sfAuthoringPrototype
    window.__sfErrors = []
    const parent = document.createElement('div'); document.body.append(parent)
    window.__sfView = new View(new Adapter({ identity: { projectId: 1, worldId: 2, workId: 3, chapterId: 4, chapterUid: 'res:v1:chapter:11111111-1111-4111-8111-111111111111' }, html }),
      { parent, onError: error => window.__sfErrors.push(error.message), onRichText: () => {} })
    window.__sfView.adapter.getPlainText()
    const from = window.__sfView.adapter.getSource().lastIndexOf('正文')
    window.__sfView.adapter.mapSelection(from, from + 2)
  }, html)
  await page.waitForTimeout(250)
  expect(requests).toEqual([])
  expect(await page.evaluate(() => window.__sfExecuted ?? 0)).toBe(0)
  expect(await page.locator('.cm-editor img, .cm-editor iframe, .cm-editor script, .cm-editor style, .cm-editor [onerror], .cm-editor a[href^="javascript:"]').count()).toBe(0)
  expect(await page.evaluate(() => window.__sfView.adapter.getHtml())).toBe(html)
})

test('synthetic composition-start and pending surrogate hold drafts, modes and external adoption until composition ends', async ({ page }, info) => {
  await page.evaluate(() => {
    const { Adapter, View } = window.__sfAuthoringPrototype
    const parent = document.createElement('div'); document.body.append(parent)
    window.__sfChanges = []; window.__sfErrors = []
    const adapter = new Adapter({ identity: { projectId: 1, worldId: 2, workId: 3, chapterId: 4, chapterUid: 'res:v1:chapter:11111111-1111-4111-8111-111111111111' }, html: '<p>甲</p>', onHtmlChange: html => window.__sfChanges.push(html) })
    window.__sfView = new View(adapter, { parent, onError: error => window.__sfErrors.push(error.message), onRichText: () => {} })
    window.__sfView.view.focus()
    window.__sfView.view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    window.__sfView.view.dispatch({ changes: { from: 1, insert: '\ud83d' } })
  })
  expect(await page.evaluate(() => window.__sfChanges.length)).toBe(0)
  expect(await page.evaluate(() => { try { window.__sfView.setDisplayMode('source'); return 'unexpected' } catch (error) { return String(error) } })).toContain('输入法组合')
  expect(await page.evaluate(() => window.__sfView.adapter.mapSelection(0, 1).ok)).toBe(false)
  await page.evaluate(() => {
    const editor = window.__sfView
    editor.view.dispatch({ changes: { from: 2, insert: '\ude00' } })
    editor.view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  })
  await expect.poll(() => page.evaluate(() => window.__sfChanges)).toEqual(['<p>甲😀</p>'])
  expect(await page.evaluate(() => window.__sfErrors)).toEqual([])
  const proof = { evidence: 'synthetic DOM events only; not real system IME', userAgent: await page.evaluate(() => navigator.userAgent), html: await page.evaluate(() => window.__sfView.adapter.getHtml()) }
  await writeFile(info.outputPath('synthetic-composition.json'), JSON.stringify(proof, null, 2))
})

test('actual view records input, scroll and cancellable full paste at 1/5/10万 visible UTF16 units', async ({ page }, info) => {
  test.setTimeout(120000)
  page.on('console', message => { if (message.text().startsWith('037-perf:')) console.log(message.text()) })
  await page.setViewportSize({ width: 1366, height: 768 })
  const measurement = await page.evaluate(async () => {
    const { Adapter, View } = window.__sfAuthoringPrototype
    const identity = { projectId: 1, worldId: 2, workId: 3, chapterId: 4, chapterUid: 'res:v1:chapter:11111111-1111-4111-8111-111111111111' }
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const p95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1]
    const results = [], errors: string[] = []
    for (const visibleUtf16 of [10000, 50000, 100000]) for (const profile of ['paragraphs', 'styled', 'dense-inline']) {
      console.log('037-perf:start', visibleUtf16, profile)
      const parent = document.createElement('div'); parent.style.height = '500px'; parent.style.overflow = 'auto'; document.body.append(parent)
      const rows = Array.from({ length: visibleUtf16 / 100 }, (_, index) => profile === 'styled' && index % 10 === 0
        ? '<p style="line-height:1.8"><span style="color:red">' + '甲'.repeat(100) + '</span></p>'
        : profile === 'dense-inline' ? '<p>' + '<strong>甲😀</strong>乙'.repeat(25) + '</p>' : '<p>' + '甲'.repeat(100) + '</p>')
      let saves = 0
      const loadStart = performance.now()
      const adapter = new Adapter({ identity, html: rows.join(''), onHtmlChange: () => saves++ })
      const editor = new View(adapter, { parent, onError: error => errors.push(error.message), onRichText: () => {} })
      const loadMs = performance.now() - loadStart
      console.log('037-perf:loaded', visibleUtf16, profile, loadMs)
      await frame(); await frame()
      const initialProtected = adapter.getEnvelopes().filter(row => row.protected).map(row => row.htmlHash)
      const inputMs = [], inputToFrameMs = [], scrollToFrameMs = []
      for (let index = 0; index < 20; index++) {
        const at = adapter.getSource().lastIndexOf('甲')
        const started = performance.now()
        editor.view.dispatch({ changes: { from: at, insert: '乙' }, selection: { anchor: at + 1 }, scrollIntoView: true, userEvent: 'input' })
        inputMs.push(performance.now() - started)
        await frame(); inputToFrameMs.push(performance.now() - started)
      }
      console.log('037-perf:typed', visibleUtf16, profile, p95(inputMs))
      for (let index = 0; index < 20; index++) {
        const started = performance.now()
        parent.scrollTop = index % 2 ? 0 : parent.scrollHeight
        editor.view.requestMeasure()
        await frame(); await frame(); scrollToFrameMs.push(performance.now() - started)
      }
      console.log('037-perf:scrolled', visibleUtf16, profile)
      const source = adapter.getSource(), html = adapter.getHtml()
      editor.view.dispatch({ selection: { anchor: source.length } })
      const controller = new AbortController(), cancelled = editor.preparePaste('\n' + '取消'.repeat(50000), controller.signal)
      controller.abort()
      let cancelName = ''
      try { await cancelled } catch (error) { cancelName = error instanceof DOMException ? error.name : String(error) }
      if (cancelName !== 'AbortError' || adapter.getHtml() !== html || adapter.getSource() !== source) throw new Error('Cancelled paste altered the document')
      console.log('037-perf:cancelled', visibleUtf16, profile)
      const text = '\n' + '完整😀'.repeat(25000), pasteStart = performance.now()
      const draft = await editor.preparePaste(text, new AbortController().signal)
      const prepareMs = performance.now() - pasteStart
      console.log('037-perf:prepared', visibleUtf16, profile, prepareMs)
      if (adapter.getHtml() !== html || adapter.getSource() !== source) throw new Error('Pending paste altered the document')
      const commitStart = performance.now(); editor.commitPaste(draft)
      const commitMs = performance.now() - commitStart
      if (adapter.getSource() !== source + text || adapter.getHtml() !== draft.previewHtml) throw new Error('Paste was truncated or changed')
      if (JSON.stringify(adapter.getEnvelopes().filter(row => row.protected).map(row => row.htmlHash)) !== JSON.stringify(initialProtected)) throw new Error('Protected raw HTML changed')
      results.push({ visibleUtf16, profile, paragraphs: rows.length, sourceUtf16BeforePaste: source.length, loadMs, inputMs, inputP95Ms: p95(inputMs), inputToFrameMs,
        inputToFrameP95Ms: p95(inputToFrameMs), scrollToFrameMs, scrollP95Ms: p95(scrollToFrameMs), pasteUtf16: text.length, prepareMs, commitMs, pasteTotalMs: prepareMs + commitMs,
        cancelName, saves, heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null })
      editor.destroy(); parent.remove()
      await frame()
    }
    return { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, results, errors }
  })
  const proof = { machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model }, measurement,
    scope: 'isolated mounted CM prototype; excludes product DB, AI, user bootstrap, OS IME and commercial acceptance' }
  await writeFile(info.outputPath('actual-view-performance.json'), JSON.stringify(proof, null, 2))
  await info.attach('actual-view-performance', { contentType: 'application/json', path: info.outputPath('actual-view-performance.json') })
  expect(measurement.errors).toEqual([])
  for (const result of measurement.results) {
    expect(result.inputP95Ms, `${result.visibleUtf16}/${result.profile} hot input`).toBeLessThanOrEqual(100)
    expect(result.pasteTotalMs, `${result.visibleUtf16}/${result.profile} full paste`).toBeLessThanOrEqual(2000)
  }
})
