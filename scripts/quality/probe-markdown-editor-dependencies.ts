// 037-D dependency compatibility probe. This file is never imported by the app.
// It does not implement the novel dialect, HTML adapter, or an editor entry point.
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { commonmarkLanguage, markdown } from '@codemirror/lang-markdown'
import { parser, Strikethrough } from '@lezer/markdown'

const doc = '# 依赖探针\n\n~~删除线~~与中文😀\n'
const display = new Compartment()
const state = EditorState.create({
  doc,
  extensions: [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdown({
      base: commonmarkLanguage,
      extensions: [Strikethrough],
      addKeymap: false,
      completeHTMLTags: false,
      pasteURLAsLink: false,
    }),
    display.of([]),
  ],
})
const tree = syntaxTree(state).toString()
const standaloneTree = parser.configure(Strikethrough).parse(doc).toString()
if (!tree.includes('ATXHeading1') || !tree.includes('Strikethrough')
  || !standaloneTree.includes('Strikethrough')) {
  throw new Error('Selected Markdown parser packages are incompatible')
}
const transaction = state.update({ effects: display.reconfigure([]) })
if (transaction.docChanged || transaction.state.doc.toString() !== doc) {
  throw new Error('Display compartment reconfiguration changed the source')
}
const viewAPIs = {
  compositionStarted: !!Object.getOwnPropertyDescriptor(EditorView.prototype, 'compositionStarted')?.get,
  composing: !!Object.getOwnPropertyDescriptor(EditorView.prototype, 'composing')?.get,
  coordsAtPos: typeof EditorView.prototype.coordsAtPos === 'function',
  decorations: !!EditorView.decorations,
  atomicRanges: !!EditorView.atomicRanges,
}
if (Object.values(viewAPIs).some(available => !available)) {
  throw new Error('Selected view package is missing a required public API')
}
console.log(JSON.stringify({
  probe: '037-D-unmounted-dependencies',
  tree,
  viewAPIs,
  reconfigurationDocChanged: transaction.docChanged,
  productFeatureImplemented: false,
}))
