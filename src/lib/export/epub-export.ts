/**
 * EPUB 导出 — Phase 24.1
 *
 * 生成 EPUB 3.0 格式电子书。
 * 实现方式：纯前端用 JSZip 生成 EPUB（本质上是打包好的 XHTML+XML ZIP）。
 * 不依赖后端。
 *
 * EPUB 结构：
 *   META-INF/container.xml
 *   OEBPS/content.opf     — 包描述
 *   OEBPS/toc.ncx          — 目录（EPUB 2 兼容）
 *   OEBPS/nav.xhtml         — 导航（EPUB 3）
 *   OEBPS/style.css
 *   OEBPS/chapter-*.xhtml   — 章节内容
 */
import { db } from '../db/schema'
import { sanitizeExportHtml } from './sanitize-html'
// Chapter type used internally via db queries

interface EpubChapter {
  id: string
  title: string
  content: string // HTML content
  order: number
}

/** 生成 EPUB 并下载 */
export async function exportProjectEPUB(projectId: number): Promise<void> {
  // 动态导入 JSZip（减少首屏加载）
  const JSZip = (await import('jszip')).default

  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  const nodes = await db.outlineNodes.where('projectId').equals(projectId).toArray()
  const chapters = await db.chapters.where('projectId').equals(projectId).toArray()
  const sortedChapters = chapters.sort((a, b) => a.order - b.order)

  // 构建章节列表
  const epubChapters: EpubChapter[] = sortedChapters
    .filter(ch => ch.content && ch.content.trim())
    .map((ch, idx) => {
      const node = nodes.find(n => n.id === ch.outlineNodeId)
      return {
        id: `chapter-${idx + 1}`,
        title: node?.title || ch.title || `第${idx + 1}章`,
        content: ch.content,
        order: idx,
      }
    })

  if (epubChapters.length === 0) {
    throw new Error('没有可导出的章节内容')
  }

  const bookTitle = project.name
  const bookId = `storyforge-${projectId}-${Date.now()}`
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const zip = new JSZip()

  // mimetype（必须是第一个文件，且不压缩）
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  // META-INF/container.xml
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)

  // style.css
  zip.file('OEBPS/style.css', `
body {
  font-family: "Source Han Serif", "Noto Serif CJK SC", "SimSun", serif;
  line-height: 1.8;
  margin: 1em;
  color: #333;
}
h1 { font-size: 1.5em; text-align: center; margin: 2em 0 1em; }
h2 { font-size: 1.2em; margin: 1.5em 0 0.8em; }
p { text-indent: 2em; margin: 0.3em 0; }
.title-page { text-align: center; margin-top: 30%; }
.title-page h1 { font-size: 2em; }
.title-page p { text-indent: 0; color: #666; }
`)

  // 封面页
  zip.file('OEBPS/title.xhtml', buildXHTML('封面', `
<div class="title-page">
  <h1>${escapeXML(bookTitle)}</h1>
  <p>由 StoryForge 生成</p>
</div>`))

  // 各章节
  for (const ch of epubChapters) {
    const body = htmlToEpubBody(ch.content)
    zip.file(`OEBPS/${ch.id}.xhtml`, buildXHTML(ch.title, `
<h1>${escapeXML(ch.title)}</h1>
${body}`))
  }

  // nav.xhtml (EPUB 3 导航)
  const navItems = epubChapters.map(ch =>
    `    <li><a href="${ch.id}.xhtml">${escapeXML(ch.title)}</a></li>`
  ).join('\n')
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<nav epub:type="toc">
  <h1>目录</h1>
  <ol>
    <li><a href="title.xhtml">封面</a></li>
${navItems}
  </ol>
</nav>
</body>
</html>`)

  // toc.ncx (EPUB 2 兼容)
  const ncxItems = epubChapters.map((ch, i) => `
  <navPoint id="np-${i + 1}" playOrder="${i + 2}">
    <navLabel><text>${escapeXML(ch.title)}</text></navLabel>
    <content src="${ch.id}.xhtml"/>
  </navPoint>`).join('')

  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
  <meta name="dtb:uid" content="${bookId}"/>
</head>
<docTitle><text>${escapeXML(bookTitle)}</text></docTitle>
<navMap>
  <navPoint id="np-0" playOrder="1">
    <navLabel><text>封面</text></navLabel>
    <content src="title.xhtml"/>
  </navPoint>${ncxItems}
</navMap>
</ncx>`)

  // content.opf
  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...epubChapters.map(ch =>
      `<item id="${ch.id}" href="${ch.id}.xhtml" media-type="application/xhtml+xml"/>`
    ),
  ].join('\n    ')

  const spineItems = [
    '<itemref idref="title"/>',
    ...epubChapters.map(ch => `<itemref idref="${ch.id}"/>`),
  ].join('\n    ')

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="BookId">${bookId}</dc:identifier>
  <dc:title>${escapeXML(bookTitle)}</dc:title>
  <dc:language>zh</dc:language>
  <dc:creator>StoryForge</dc:creator>
  <meta property="dcterms:modified">${now}</meta>
</metadata>
<manifest>
    ${manifestItems}
</manifest>
<spine toc="ncx">
    ${spineItems}
</spine>
</package>`)

  // 生成 blob 并下载
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${bookTitle}_${new Date().toISOString().slice(0, 10)}.epub`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── 工具函数 ──

function escapeXML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function buildXHTML(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXML(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>`
}

/** 将 TipTap HTML 内容转为 EPUB 安全的 XHTML */
function htmlToEpubBody(html: string): string {
  // 移除 TipTap 特有属性和标签，保留基本结构
  let clean = sanitizeExportHtml(html)
    // 移除 data-* 属性
    .replace(/\s+data-[a-z-]+="[^"]*"/gi, '')
    // 自闭合标签
    .replace(/<br\s*>/gi, '<br/>')
    .replace(/<hr\s*>/gi, '<hr/>')
    .replace(/<img([^>]*?)>/gi, '<img$1/>')
    // 空段落转为带内容的段落
    .replace(/<p>\s*<\/p>/g, '<p>&#160;</p>')

  // 如果没有 HTML 标签，按纯文本处理
  if (!/<[a-z][^>]*>/i.test(clean)) {
    clean = clean
      .split(/\n\n+/)
      .map(para => `<p>${escapeXML(para.trim())}</p>`)
      .join('\n')
  }

  return clean
}
