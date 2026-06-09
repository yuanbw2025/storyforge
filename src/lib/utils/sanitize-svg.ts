/**
 * SVG 安全清洗 —— 防 XSS。
 *
 * AI 生成的 SVG（概念地图等）会以 dangerouslySetInnerHTML 渲染。SVG 可携带
 * <script>、on* 事件、javascript: URL、<foreignObject> 等可执行内容；若 AI 端点
 * 被劫持或发生提示词注入，会在应用源内执行任意脚本（窃取 IndexedDB 中的小说、
 * localStorage 中的 API Key 等）。此函数用 DOM 解析后剔除可执行向量再序列化，
 * 比正则更可靠。
 */

const DANGEROUS_TAGS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video',
  'animate', 'animatetransform', 'set', 'handler',
])

/** 清洗 SVG 字符串，移除脚本/事件/危险协议。失败时返回空串（不渲染）。 */
export function sanitizeSvg(raw: string): string {
  if (!raw || !raw.trim()) return ''
  try {
    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
    // 解析错误（parsererror 节点）→ 拒绝
    if (doc.querySelector('parsererror')) return ''
    const svg = doc.documentElement
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return ''

    const walk = (el: Element) => {
      // 1. 危险标签整体删除
      for (const child of Array.from(el.children)) {
        if (DANGEROUS_TAGS.has(child.nodeName.toLowerCase())) {
          child.remove()
          continue
        }
        // 2. 移除事件处理属性 + 危险协议的 href/src
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase()
          const value = attr.value.replace(/\s+/g, '').toLowerCase()
          if (name.startsWith('on')) {
            child.removeAttribute(attr.name)
          } else if ((name === 'href' || name === 'xlink:href' || name === 'src') &&
                     (value.startsWith('javascript:') || value.startsWith('data:text/html'))) {
            child.removeAttribute(attr.name)
          } else if (name === 'style' && /expression\(|javascript:/i.test(attr.value)) {
            child.removeAttribute(attr.name)
          }
        }
        walk(child)
      }
    }
    // 根节点自身的事件属性也清掉
    for (const attr of Array.from(svg.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) svg.removeAttribute(attr.name)
    }
    walk(svg)

    return new XMLSerializer().serializeToString(svg)
  } catch {
    return ''
  }
}
