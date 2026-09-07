import JSZip from 'jszip'
import type { ComicPage, ComicPanel, ComicTargetSpecV1 } from '../types'

export interface ComicPageRenderV1 {
  page: ComicPage
  panels: ComicPanel[]
  targetSpec: ComicTargetSpecV1
  assetDataUrls: ReadonlyMap<string, string> | Readonly<Record<string, string>>
  mode: 'storyboard' | 'formal'
}

export interface ComicBookRenderV1 {
  title: string
  pages: Array<Omit<ComicPageRenderV1, 'targetSpec' | 'mode'> & { panels: ComicPanel[] }>
  targetSpec: ComicTargetSpecV1
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[char]!)
}

function assetUrl(input: ComicPageRenderV1, key: string): string | undefined {
  if ('get' in input.assetDataUrls && typeof input.assetDataUrls.get === 'function') return input.assetDataUrls.get(key)
  return (input.assetDataUrls as Readonly<Record<string, string>>)[key]
}

function pagePixels(spec: ComicTargetSpecV1): { width: number; height: number; bleed: number } {
  if (spec.pageSize.unit === 'px') return { width: Math.round(spec.pageSize.width), height: Math.round(spec.pageSize.height), bleed: Math.round(spec.pageSize.bleed) }
  const scale = 144 / 25.4
  return { width: Math.round(spec.pageSize.width * scale), height: Math.round(spec.pageSize.height * scale), bleed: Math.round(spec.pageSize.bleed * scale) }
}

function textLines(text: string, width: number, fontSize: number): string[] {
  const max = Math.max(1, Math.floor(width / Math.max(1, fontSize * 0.92)))
  const result: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) { result.push(''); continue }
    for (let offset = 0; offset < paragraph.length; offset += max) result.push(paragraph.slice(offset, offset + max))
  }
  return result.slice(0, 40)
}

function speechShape(item: ComicPanel['lettering'][number], x: number, y: number, width: number, height: number, panelX: number, panelY: number, panelWidth: number, panelHeight: number): string {
  if (item.kind === 'sfx') return ''
  if (item.kind === 'caption') return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(9, height * .06)}" fill="${escapeXml(item.fillColor)}" stroke="${escapeXml(item.strokeColor)}" stroke-width="${item.strokeWidth}"/>`
  const cx = x + width / 2; const cy = y + height / 2
  if (item.kind === 'thought') {
    const body = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(width, height) * .38}" fill="${escapeXml(item.fillColor)}" stroke="${escapeXml(item.strokeColor)}" stroke-width="${item.strokeWidth}"/>`
    if (!item.tail) return body
    const tx = panelX + item.tail.x * panelWidth; const ty = panelY + item.tail.y * panelHeight
    const firstX = cx + (tx - cx) * .58; const firstY = cy + (ty - cy) * .58
    const secondX = cx + (tx - cx) * .8; const secondY = cy + (ty - cy) * .8
    return `${body}<circle cx="${firstX}" cy="${firstY}" r="${Math.max(3, Math.min(width, height) * .07)}" fill="${escapeXml(item.fillColor)}" stroke="${escapeXml(item.strokeColor)}" stroke-width="${Math.max(1, item.strokeWidth * .75)}"/><circle cx="${secondX}" cy="${secondY}" r="${Math.max(2, Math.min(width, height) * .035)}" fill="${escapeXml(item.fillColor)}" stroke="${escapeXml(item.strokeColor)}" stroke-width="${Math.max(1, item.strokeWidth * .6)}"/>`
  }
  const body = `<ellipse cx="${cx}" cy="${cy}" rx="${width / 2}" ry="${height / 2}" fill="${escapeXml(item.fillColor)}" stroke="${escapeXml(item.strokeColor)}" stroke-width="${item.strokeWidth}"/>`
  if (!item.tail) return body
  const tx = panelX + item.tail.x * panelWidth; const ty = panelY + item.tail.y * panelHeight
  const baseY = y + height * .82; const spread = Math.max(4, width * .07)
  const tail = `<path d="M ${cx - spread} ${baseY} L ${tx} ${ty} L ${cx + spread} ${baseY}" fill="${escapeXml(item.fillColor)}" stroke="${escapeXml(item.strokeColor)}" stroke-width="${item.strokeWidth}" stroke-linejoin="round"/>`
  return `${tail}${body}`
}

function letteringSvg(panel: ComicPanel, pageWidth: number, pageHeight: number): string {
  const panelX = panel.frame.x * pageWidth
  const panelY = panel.frame.y * pageHeight
  const panelWidth = panel.frame.width * pageWidth
  const panelHeight = panel.frame.height * pageHeight
  return [...panel.lettering].sort((left, right) => left.zIndex - right.zIndex).map(item => {
    const x = panelX + item.frame.x * panelWidth
    const y = panelY + item.frame.y * panelHeight
    const width = item.frame.width * panelWidth
    const height = item.frame.height * panelHeight
    const font = item.fontFamily === 'storyforge-serif' ? 'serif' : 'sans-serif'
    const shape = speechShape(item, x, y, width, height, panelX, panelY, panelWidth, panelHeight)
    if (item.direction === 'vertical') {
      const chars = [...item.text].slice(0, 200)
      const perColumn = Math.max(1, Math.floor((height - item.fontSize) / (item.fontSize * 1.15)))
      const text = chars.map((char, index) => {
        const column = Math.floor(index / perColumn)
        const row = index % perColumn
        return `<text x="${x + width - item.fontSize * (.8 + column * 1.1)}" y="${y + item.fontSize * (1.1 + row * 1.15)}" font-family="${font}" font-size="${item.fontSize}" fill="${escapeXml(item.textColor)}" text-anchor="middle">${escapeXml(char)}</text>`
      }).join('')
      return `<g data-lettering-id="${escapeXml(item.id)}">${shape}${text}</g>`
    }
    const lines = textLines(item.text, width * .82, item.fontSize)
    const startY = y + Math.max(item.fontSize * 1.1, (height - lines.length * item.fontSize * 1.2) / 2 + item.fontSize)
    const tspans = lines.map((line, index) => `<tspan x="${x + width / 2}" y="${startY + index * item.fontSize * 1.2}">${escapeXml(line)}</tspan>`).join('')
    return `<g data-lettering-id="${escapeXml(item.id)}">${shape}<text font-family="${font}" font-size="${item.fontSize}" font-weight="${item.kind === 'sfx' ? 800 : 600}" font-style="${item.kind === 'sfx' ? 'italic' : 'normal'}" fill="${escapeXml(item.textColor)}" text-anchor="middle" paint-order="stroke" stroke="${escapeXml(item.strokeColor)}" stroke-width="${item.kind === 'sfx' ? Math.max(2, item.strokeWidth) : 0}">${tspans}</text></g>`
  }).join('')
}

function storyboardPlaceholderSvg(panel: ComicPanel, index: number, x: number, y: number, width: number, height: number, pageWidth: number): string {
  const labelSize = Math.max(15, Math.min(32, pageWidth * .013))
  const bodySize = Math.max(17, Math.min(38, Math.min(width / 17, height / 10)))
  const inset = Math.max(10, Math.min(width, height) * .045)
  const labelY = y + inset + labelSize
  const description = panel.moment?.trim() || panel.action.trim() || '待补充可画瞬间'
  const lines = textLines(description, Math.max(1, width - inset * 2), bodySize).slice(0, Math.max(2, Math.floor(height * .22 / (bodySize * 1.25))))
  const textY = y + height * .76
  const tspans = lines.map((line, lineIndex) => `<tspan x="${x + inset}" y="${textY + lineIndex * bodySize * 1.22}">${escapeXml(line)}</tspan>`).join('')
  const subjectCount = Math.max(1, Math.min(3, panel.subjectStates?.length || panel.continuityRefs?.length || 1))
  const silhouettes = Array.from({ length: subjectCount }, (_, subjectIndex) => {
    const centerX = x + width * (.38 + subjectIndex * .16 - (subjectCount - 1) * .08)
    const centerY = y + height * .43 + subjectIndex * height * .025
    const head = Math.max(8, Math.min(width, height) * .055)
    return `<g opacity="${.34 + subjectIndex * .08}"><circle cx="${centerX}" cy="${centerY - head * 1.45}" r="${head}" fill="#4d5660"/><path d="M ${centerX - head * 1.35} ${centerY - head * .35} Q ${centerX} ${centerY - head * 1.05} ${centerX + head * 1.35} ${centerY - head * .35} L ${centerX + head * 1.8} ${centerY + head * 2.4} L ${centerX - head * 1.8} ${centerY + head * 2.4} Z" fill="#4d5660"/></g>`
  }).join('')
  return `<g data-storyboard-placeholder="${escapeXml(panel.stableKey)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#e8edf0"/><path d="M ${x} ${y + height * .62} L ${x + width} ${y + height * .46} M ${x + width * .18} ${y} L ${x + width * .5} ${y + height * .68} M ${x + width * .82} ${y} L ${x + width * .5} ${y + height * .68}" fill="none" stroke="#78848d" stroke-width="${Math.max(1, pageWidth * .0007)}" opacity=".18"/>${silhouettes}<rect x="${x}" y="${y + height * .69}" width="${width}" height="${height * .31}" fill="#f8f6f0" fill-opacity=".94"/><circle cx="${x + inset + labelSize * .55}" cy="${labelY - labelSize * .38}" r="${labelSize * .55}" fill="#20272d"/><text x="${x + inset + labelSize * .55}" y="${labelY - labelSize * .18}" text-anchor="middle" font-family="sans-serif" font-size="${labelSize * .72}" font-weight="800" fill="#fff">${index + 1}</text><text x="${x + inset + labelSize * 1.35}" y="${labelY}" font-family="sans-serif" font-size="${labelSize * .68}" font-weight="700" letter-spacing="${labelSize * .08}" fill="#39434b">${escapeXml(panel.shot.size.toUpperCase())} · ${escapeXml(panel.shot.angle.toUpperCase())}</text><text font-family="sans-serif" font-size="${bodySize}" font-weight="600" fill="#20272d">${tspans}</text></g>`
}

export function renderComicPageSvgV1(input: ComicPageRenderV1): string {
  const { width, height, bleed } = pagePixels(input.targetSpec)
  const sorted = [...input.panels].sort((left, right) => left.order - right.order)
  if (!sorted.length) throw new Error('[comic-render] 页面没有格')
  const missing = sorted.filter(panel => !panel.selectedMediaAssetKey || !assetUrl(input, panel.selectedMediaAssetKey))
  if (input.mode === 'formal' && missing.length) throw new Error(`[comic-render] 正式导出缺少已选成图：${missing.map(panel => panel.stableKey).join('、')}`)
  const filters = input.targetSpec.colorMode === 'color' ? '' : `<filter id="color-mode"><feColorMatrix type="saturate" values="0"/>${input.targetSpec.colorMode === 'monochrome' ? '<feComponentTransfer><feFuncR type="discrete" tableValues="0 1"/><feFuncG type="discrete" tableValues="0 1"/><feFuncB type="discrete" tableValues="0 1"/></feComponentTransfer>' : ''}</filter>`
  const defs = sorted.map(panel => `<clipPath id="clip-${escapeXml(panel.stableKey)}"><rect x="${panel.frame.x * width}" y="${panel.frame.y * height}" width="${panel.frame.width * width}" height="${panel.frame.height * height}"/></clipPath>`).join('')
  const panels = sorted.map((panel, index) => {
    const x = panel.frame.x * width; const y = panel.frame.y * height
    const panelWidth = panel.frame.width * width; const panelHeight = panel.frame.height * height
    const selected = panel.selectedMediaAssetKey ? assetUrl(input, panel.selectedMediaAssetKey) : undefined
    const cx = x + panelWidth / 2; const cy = y + panelHeight / 2
    const media = selected
      ? `<image href="${escapeXml(selected)}" x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" preserveAspectRatio="xMidYMid ${panel.imageTransform.fit === 'cover' ? 'slice' : 'meet'}" transform="translate(${panel.imageTransform.offsetX * panelWidth} ${panel.imageTransform.offsetY * panelHeight}) translate(${cx} ${cy}) rotate(${panel.imageTransform.rotation}) scale(${panel.imageTransform.scale}) translate(${-cx} ${-cy})"/>`
      : storyboardPlaceholderSvg(panel, index, x, y, panelWidth, panelHeight, width)
    return `<g data-panel-key="${escapeXml(panel.stableKey)}" clip-path="url(#clip-${escapeXml(panel.stableKey)})"${filters ? ' filter="url(#color-mode)"' : ''}>${media}</g><rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" fill="none" stroke="#111" stroke-width="${Math.max(2, width * .002)}"/>${letteringSvg(panel, width, height)}`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-storyforge-comic-page="1"><metadata>${escapeXml(JSON.stringify({ version: 1, pageStableKey: input.page.stableKey, readingDirection: input.targetSpec.readingDirection, bleed }))}</metadata><defs>${filters}${defs}</defs><rect width="${width}" height="${height}" fill="#fff"/>${panels}</svg>`
}

export async function rasterizeComicPageV1(svg: string, mimeType: 'image/png' | 'image/webp' = 'image/png'): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('[comic-render] 图片合成需要浏览器 Canvas')
  const match = svg.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/)
  if (!match) throw new Error('[comic-render] SVG 页面尺寸缺失')
  const canvas = document.createElement('canvas'); canvas.width = Number(match[1]); canvas.height = Number(match[2])
  const context = canvas.getContext('2d')
  if (!context) throw new Error('[comic-render] 浏览器不支持 Canvas 2D')
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('[comic-render] SVG 页面解码失败')); image.src = url })
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('[comic-render] 页面编码失败')), mimeType, .94))
  } finally { URL.revokeObjectURL(url) }
}

function fileNumber(value: number): string { return String(value + 1).padStart(4, '0') }

export function renderComicStoryboardTextV1(book: ComicBookRenderV1): string {
  return [`# ${book.title}`, `阅读方向：${book.targetSpec.readingDirection.toUpperCase()}`, ...book.pages.flatMap(({ page, panels }) => [
    `\n## 第 ${page.chapterNumber} 章 · 第 ${page.order + 1} 页 · ${page.summary}`,
    ...[...panels].sort((left, right) => left.order - right.order).map(panel => [
      `\n### 格 ${panel.order + 1} · ${panel.shot.size}/${panel.shot.angle}/${panel.shot.movement}`,
      `动作：${panel.action}`,
      `来源：${panel.sourceUnitIds.join(', ')}`,
      `连续性：${panel.continuityRefs.map(ref => `${ref.subjectKey}(${ref.note})`).join('；') || '无'}`,
      `排字：${panel.lettering.map(item => `[${item.kind}] ${item.text}`).join('；') || '无'}`,
      `Prompt：${panel.visualPrompt}`,
      `Negative：${panel.negativePrompt}`,
    ].join('\n')),
  ])].join('\n')
}

export async function renderComicArchiveV1(input: ComicBookRenderV1 & { format: 'png-zip' | 'webp-zip' | 'cbz' }): Promise<Blob> {
  const zip = new JSZip()
  const mimeType = input.format === 'webp-zip' ? 'image/webp' : 'image/png'
  const extension = mimeType === 'image/webp' ? 'webp' : 'png'
  const manifest: Array<{ file: string; pageStableKey: string; chapterNumber: number; order: number }> = []
  for (const item of [...input.pages].sort((left, right) => left.page.order - right.page.order)) {
    const svg = renderComicPageSvgV1({ ...item, targetSpec: input.targetSpec, mode: 'formal' })
    const blob = await rasterizeComicPageV1(svg, mimeType)
    const file = `pages/${fileNumber(item.page.order)}.${extension}`
    zip.file(file, blob); manifest.push({ file, pageStableKey: item.page.stableKey, chapterNumber: item.page.chapterNumber, order: item.page.order })
  }
  zip.file('manifest.json', JSON.stringify({ version: 1, title: input.title, readingDirection: input.targetSpec.readingDirection, colorMode: input.targetSpec.colorMode, pages: manifest }, null, 2))
  if (input.format === 'cbz') zip.file('ComicInfo.xml', `<?xml version="1.0" encoding="UTF-8"?><ComicInfo><Title>${escapeXml(input.title)}</Title><PageCount>${manifest.length}</PageCount><Manga>${input.targetSpec.readingDirection === 'rtl' ? 'YesAndRightToLeft' : 'No'}</Manga></ComicInfo>`)
  return zip.generateAsync({ type: 'blob', mimeType: input.format === 'cbz' ? 'application/vnd.comicbook+zip' : 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function renderComicPrintHtmlV1(input: ComicBookRenderV1): Promise<string> {
  const pageDataUrls: string[] = []
  for (const item of [...input.pages].sort((left, right) => left.page.order - right.page.order)) {
    const blob = await rasterizeComicPageV1(renderComicPageSvgV1({ ...item, targetSpec: input.targetSpec, mode: 'formal' }), 'image/png')
    pageDataUrls.push(await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) }))
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(input.title)}</title><style>@page{size:${input.targetSpec.pageSize.width}${input.targetSpec.pageSize.unit} ${input.targetSpec.pageSize.height}${input.targetSpec.pageSize.unit};margin:0}html,body{margin:0;background:#222}.page{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;break-after:page}.page img{display:block;max-width:100%;max-height:100%;object-fit:contain}</style></head><body>${pageDataUrls.map((url, index) => `<section class="page" data-page="${index + 1}"><img src="${url}" alt="第 ${index + 1} 页"></section>`).join('')}</body></html>`
}
