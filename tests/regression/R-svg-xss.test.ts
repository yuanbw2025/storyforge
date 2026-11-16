/**
 * R-svg-xss · AI 生成 SVG 的 XSS 回归测试（AUDIT-4）
 *
 * GeographyPanel 用 dangerouslySetInnerHTML 渲染 AI 生成的 SVG 概念地图。若 AI 端点被
 * 劫持或发生提示词注入，SVG 可携带 script 标签、on* 事件、javascript 协议、foreignObject 等执行向量，
 * 在应用源内窃取 IndexedDB 手稿与 storage 中的密钥。`sanitizeSvg` 用 DOM 解析剔除这些向量。
 * 本测试覆盖各类 XSS payload 必被剔除 + 正常地图元素必被保留。
 */
import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from '../../src/lib/utils/sanitize-svg'

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">'

describe('R-svg-xss · SVG 清洗剔除执行向量', () => {
  it('剔除 <script> 标签', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<script>alert(document.cookie)</script><path d="M0 0"/></svg>`)
    expect(out).not.toContain('script')
    expect(out).toContain('path') // 正常元素保留
  })

  it('剔除 on* 事件属性（onclick/onload/onmouseover）', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<rect x="1" y="1" onclick="evil()" onmouseover="steal()"/><circle onload="x()"/></svg>`)
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('onmouseover')
    expect(out).not.toContain('onload')
    expect(out).toContain('rect')
  })

  it('剔除根 svg 元素上的事件属性', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><path d="M0 0"/></svg>`)
    expect(out).not.toContain('onload')
  })

  it('剔除 <foreignObject>（可内嵌任意 HTML/script）', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject><path d="M0 0"/></svg>`)
    expect(out.toLowerCase()).not.toContain('foreignobject')
    expect(out).not.toContain('script')
  })

  it('剔除 javascript: 协议的 href / xlink:href', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<a href="javascript:alert(1)"><text>x</text></a><a xlink:href="javascript:evil()"><text>y</text></a><path id="sfqa131-safe-link-control" d="M0 0L10 10"/></svg>`)
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out).toContain('sfqa131-safe-link-control')
  })

  it('剔除 data:text/html 协议的 href', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<a href="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E"><text>x</text></a><path id="sfqa131-safe-data-control" d="M0 0L10 10"/></svg>`)
    expect(out.toLowerCase()).not.toContain('data:text/html')
    expect(out).toContain('sfqa131-safe-data-control')
  })

  it('剔除 <iframe>/<object>/<embed>', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<iframe src="evil"/><object data="evil"/><embed src="evil"/><path d="M0 0"/></svg>`)
    expect(out.toLowerCase()).not.toContain('iframe')
    expect(out.toLowerCase()).not.toContain('object')
    expect(out.toLowerCase()).not.toContain('embed')
  })

  it('剔除 SMIL 动画事件向量（animate/set）', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<set attributeName="onload" to="evil()"/><animate onbegin="x()"/><path d="M0 0"/></svg>`)
    expect(out.toLowerCase()).not.toContain('<set')
    expect(out.toLowerCase()).not.toContain('<animate')
    expect(out).not.toContain('onbegin')
  })

  it('剔除 style 内的 expression()/javascript:', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<rect style="fill:url(javascript:alert(1))"/><circle style="background:expression(alert(1))"/></svg>`)
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out.toLowerCase()).not.toContain('expression(')
  })

  it('保留正常地图 SVG 的全部结构元素', () => {
    const out = sanitizeSvg(`${SVG_OPEN}<defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><g><path d="M0 0 L10 10"/><polygon points="0,0 5,5"/><circle cx="5" cy="5" r="2"/><rect x="1" y="1" width="3" height="3"/><text x="2" y="2" fill="#333">城</text></g></svg>`)
    for (const tag of ['defs', 'lineargradient', 'stop', 'path', 'polygon', 'circle', 'rect', 'text']) {
      expect(out.toLowerCase(), `应保留 ${tag}`).toContain(tag)
    }
    expect(out).toContain('城') // 文字内容保留
  })

  it('解析失败 / 非 SVG 输入返回空串（不渲染）', () => {
    expect(sanitizeSvg('<not-svg><随便></not-svg>')).toBe('')
    expect(sanitizeSvg('')).toBe('')
    expect(sanitizeSvg('   ')).toBe('')
    expect(sanitizeSvg('<div onclick="x">不是 svg</div>')).toBe('')
  })
})
