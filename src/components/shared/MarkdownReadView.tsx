import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Lexer, type MarkedToken, type Token } from 'marked'
import { markdownReadHrefV1, markdownReadTextV1 } from '../../lib/authoring/markdown-read-safety'

export interface MarkdownReadViewProps {
  value: string
  readOnly?: boolean
  /** Notification only. This component neither saves nor changes the source. */
  onRequestEdit?: (original: string) => void
}
const codeStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre' as const, tabSize: 4 }

function renderMarkdown(value: string): ReactNode {
  let remaining = 20_000
  const nodes = (tokens: Token[], depth = 0): ReactNode[] => tokens.map((token, index) => {
    if (--remaining < 0 || depth > 40) throw new Error('Markdown display limit')
    const t = token as MarkedToken
    const children = (nested: Token[]) => nodes(nested, depth + 1)
    const literal = <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{token.raw}</span>
    let node: ReactNode
    switch (t.type) {
      case 'space': case 'def': node = null; break
      case 'text': node = t.tokens ? children(t.tokens) : markdownReadTextV1(t.text); break
      case 'escape': node = t.text; break
      case 'paragraph': node = <p style={{ marginBlock: '.65em' }}>{children(t.tokens)}</p>; break
      case 'heading': {
        const Heading = `h${Math.max(1, Math.min(6, t.depth))}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
        node = <Heading style={{ fontWeight: 600, fontSize: `${1.6 - Math.min(6, t.depth) * .1}em`, marginBlock: '.75em' }}>{children(t.tokens)}</Heading>
        break
      }
      case 'strong': node = <strong>{children(t.tokens)}</strong>; break
      case 'em': node = <em>{children(t.tokens)}</em>; break
      case 'del': node = <del>{children(t.tokens)}</del>; break
      case 'br': node = <br />; break
      case 'hr': node = <hr />; break
      case 'codespan': node = <code style={codeStyle}>{t.text}</code>; break
      case 'code': node = <pre style={{ ...codeStyle, maxWidth: '100%', overflowX: 'auto', padding: '.75em', background: 'rgba(127,127,127,.08)' }}><code>{t.text}</code></pre>; break
      case 'html': node = t.block ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.raw}</pre> : literal; break
      case 'image': node = <span data-markdown-image-alt>［图片：{markdownReadTextV1(t.text || '无描述')}］</span>; break
      case 'link': {
        const href = markdownReadHrefV1(t.href)
        node = href ? <a href={href} title={t.title ?? undefined} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer" referrerPolicy="no-referrer"
          style={{ textDecoration: 'underline' }}>{children(t.tokens)}</a> : <span>{children(t.tokens)}</span>
        break
      }
      case 'blockquote': node = <blockquote style={{ marginInline: 0, paddingInlineStart: '1em', borderInlineStart: '3px solid currentColor' }}>{children(t.tokens)}</blockquote>; break
      case 'list': {
        const items = t.items.map((item, i) => <li key={i}>{item.task && <span aria-label={item.checked ? '已完成' : '未完成'}>{item.checked ? '☑ ' : '☐ '}</span>}{children(item.tokens)}</li>)
        node = t.ordered ? <ol start={typeof t.start === 'number' ? t.start : 1} style={{ paddingInlineStart: '1.5em', listStyleType: 'decimal' }}>{items}</ol>
          : <ul style={{ paddingInlineStart: '1.5em', listStyleType: 'disc' }}>{items}</ul>
        break
      }
      case 'list_item': node = children(t.tokens); break
      case 'table': node = <div data-markdown-table-scroll style={{ maxWidth: '100%', overflowX: 'auto' }}><table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{t.header.map((cell, i) => <th key={i} scope="col" style={{ border: '1px solid currentColor', padding: '.4em .65em', textAlign: cell.align ?? undefined }}>{children(cell.tokens)}</th>)}</tr></thead>
        <tbody>{t.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ border: '1px solid currentColor', padding: '.4em .65em', textAlign: cell.align ?? undefined }}>{children(cell.tokens)}</td>)}</tr>)}</tbody>
      </table></div>; break
      default: node = literal
    }
    return <Fragment key={index}>{node}</Fragment>
  })
  try {
    // Private options/tokenizer: global marked extensions cannot install HTML
    // renderers or expand the closed element/attribute set here.
    return nodes(new Lexer({ gfm: true, breaks: false, pedantic: false }).lex(value))
  } catch {
    return <pre data-markdown-fallback style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</pre>
  }
}

/** Stateless source authority: rendering, selection, source view/copy and edit
 * requests never infer field admission, a saved state, or persistence rights. */
export default function MarkdownReadView({ value, readOnly = false, onRequestEdit }: MarkdownReadViewProps) {
  const content = useMemo(() => renderMarkdown(value), [value])
  const [sourceVisible, setSourceVisible] = useState(false)
  const [copyResult, setCopyResult] = useState<{ value: string; status: string } | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointer = useRef({ x: 0, y: 0, moved: false })
  const cancelClick = useCallback(() => { if (clickTimer.current != null) clearTimeout(clickTimer.current); clickTimer.current = null }, [])
  useEffect(() => () => cancelClick(), [value, readOnly, onRequestEdit, cancelClick])
  const request = (event: MouseEvent<HTMLDivElement>) => {
    cancelClick()
    if (readOnly || !onRequestEdit || sourceVisible || event.defaultPrevented || event.button !== 0 || event.detail !== 1
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || pointer.current.moved
      || !(event.target instanceof Element) || event.target.closest('a,button,input,textarea,select,pre,code,[data-markdown-table-scroll]')
      || !window.getSelection()?.isCollapsed) return
    // Wait for double-click word selection; do not unmount reading on its first click.
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      if (window.getSelection()?.isCollapsed) onRequestEdit(value)
    }, 240)
  }
  const copy = async () => {
    setCopyResult(null)
    try { await navigator.clipboard.writeText(value); setCopyResult({ value, status: '源码已复制' }) }
    catch { setCopyResult({ value, status: '复制失败，可查看源码后选择复制' }) }
  }
  return <section data-markdown-read-view style={{ minWidth: 0, maxWidth: '100%' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.75em', fontSize: '.8em' }}>
      <button type="button" aria-expanded={sourceVisible} onClick={() => { cancelClick(); setSourceVisible(current => !current) }}>{sourceVisible ? '返回阅读' : '查看源码'}</button>
      <button type="button" onClick={() => { cancelClick(); void copy() }}>复制源码</button>
      {!readOnly && onRequestEdit && <button type="button" onClick={() => { cancelClick(); onRequestEdit(value) }}>编辑源码</button>}
      <span role="status">{copyResult?.value === value ? copyResult.status : ''}</span>
    </div>
    <div data-markdown-body onClick={request} onDoubleClick={cancelClick}
      onPointerDown={event => { pointer.current = { x: event.clientX, y: event.clientY, moved: false } }}
      onPointerMove={event => { if (event.buttons && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 5) pointer.current.moved = true }}
      onScrollCapture={() => { pointer.current.moved = true; cancelClick() }}
      style={{ minWidth: 0, maxWidth: '100%', lineHeight: 1.7, overflowWrap: 'anywhere' }}>
      {sourceVisible ? <pre data-markdown-source style={{ ...codeStyle, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</pre> : content}
    </div>
  </section>
}
