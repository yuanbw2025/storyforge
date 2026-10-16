import { generateHTML, generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { BlockSpacing } from './rich-editor-theme'

export function richEditorExtensionsV1(placeholder = '') {
  return [StarterKit.configure({ heading: { levels: [2, 3, 4] } }), TextStyle, Color, BackgroundColor, FontFamily, FontSize, BlockSpacing, Placeholder.configure({ placeholder })]
}

/** The same schema as the author's editor, without changing its live state. */
export function normalizeRichEditorHTMLV1(html: string): string {
  const extensions = richEditorExtensionsV1()
  return generateHTML(generateJSON(html, extensions), extensions)
}
