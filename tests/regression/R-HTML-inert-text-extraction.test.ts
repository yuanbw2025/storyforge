import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { countWords, htmlToPlainText } from '../../src/lib/utils/html'

/** Frozen pre-037-H DOM algorithm. Used only for semantic comparison. */
function previousDomText(html: string): string {
  if (!html || !/<\/?[a-z][\s\S]*>/i.test(html)) return html
  const root = document.createElement('div')
  root.innerHTML = html
  root.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,br').forEach(element => {
    if (element.tagName === 'BR') element.replaceWith('\n')
    else element.append('\n')
  })
  return (root.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([
  '', '\n  旧纯文本 # * 😀  \n',
  '<p>甲&amp;乙 &lt;字&gt; &#128512; &nbsp;丙</p>',
  '<p>甲</p><p></p><p></p><p></p><p>乙</p>',
  '<h1>一</h1><h6>六</h6><p>甲<br>乙</p>',
  '<p style="line-height:1.8"><span style="font-size:18px;color:red">旧稿😀 e\u0301</span></p>',
  '<ul><li><p>甲</p><ul><li><p>乙</p></li></ul></li></ul>',
  '<blockquote><p>甲</p><p>乙</p></blockquote><pre><code>  a\n b\n</code></pre>',
  '<p>甲<div>乙</div></p><!--间隙--><p>丙</p>',
  '<template>模板</template><textarea>甲&amp;乙</textarea>',
  '<script>inert fixture</script><style>p{color:red}</style><p>正文</p>',
])('keeps exact DOM text, UTF8 hash and word count for %s', html => {
  const before = previousDomText(html), actual = htmlToPlainText(html)
  expect(actual).toBe(before)
  expect(hash(actual)).toBe(hash(before))
  expect(countWords(actual)).toBe(countWords(before))
})

it('reads HTML in a separate document without changing the active document', () => {
  const create = vi.spyOn(document.implementation, 'createHTMLDocument')
  const body = document.body.innerHTML
  expect(htmlToPlainText('<p>隔离读取😀</p>')).toBe('隔离读取😀')
  const inactive = create.mock.results[0].value as Document
  expect(inactive).not.toBe(document)
  expect(inactive.defaultView).toBeNull()
  expect(document.body.innerHTML).toBe(body)
})

it('keeps the existing non-DOM fallback and unformatted-text early return', () => {
  vi.stubGlobal('document', undefined)
  expect(htmlToPlainText('<h1>甲&amp;乙</h1><p>丙<br>丁</p>')).toBe('甲&乙\n丙\n丁')
  expect(htmlToPlainText('  字面 # * 😀  ')).toBe('  字面 # * 😀  ')
})
