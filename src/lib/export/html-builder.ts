/**
 * HTML 导出构建器 — Phase H1
 *
 * 生成带样式的单页 HTML 文件
 */
import { db } from '../db/schema'
import type { Chapter } from '../types'
import { sanitizeExportHtml } from './sanitize-html'

export interface HTMLExportOptions {
  /** 包含大纲 */
  includeOutline?: boolean
  /** 包含角色设定 */
  includeCharacters?: boolean
  /** 包含世界观 */
  includeWorldview?: boolean
  /** 自定义 CSS */
  customCSS?: string
}

export async function exportProjectHTML(
  projectId: number,
  options: HTMLExportOptions = {},
): Promise<string> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  const nodes = await db.outlineNodes.where('projectId').equals(projectId).toArray()
  const chapters = await db.chapters.where('projectId').equals(projectId).toArray()

  const chapterMap = new Map<number, Chapter>()
  for (const ch of chapters.sort((a, b) => a.order - b.order)) {
    chapterMap.set(ch.outlineNodeId, ch)
  }

  const volumes = nodes
    .filter(n => n.type === 'volume' && n.parentId === null)
    .sort((a, b) => a.order - b.order)

  const parts: string[] = []

  // 标题页
  parts.push(`<div class="title-page"><h1>${escapeHTML(project.name)}</h1>`)
  if (project.description) {
    parts.push(`<p class="description">${escapeHTML(project.description)}</p>`)
  }
  parts.push(`<p class="meta">${project.genre} · 目标 ${(project.targetWordCount || 0).toLocaleString()} 字</p></div>`)

  // 目录
  parts.push('<div class="toc"><h2>目录</h2><ul>')
  for (const vol of volumes) {
    parts.push(`<li><a href="#vol-${vol.id}">${escapeHTML(vol.title)}</a>`)
    const volChapters = nodes
      .filter(n => n.parentId === vol.id && n.type === 'chapter')
      .sort((a, b) => a.order - b.order)
    if (volChapters.length > 0) {
      parts.push('<ul>')
      for (const ch of volChapters) {
        parts.push(`<li><a href="#ch-${ch.id}">${escapeHTML(ch.title)}</a></li>`)
      }
      parts.push('</ul>')
    }
    parts.push('</li>')
  }
  parts.push('</ul></div>')

  // 世界观
  if (options.includeWorldview) {
    const worldview = await db.worldviews.where('projectId').equals(projectId).first()
    if (worldview) {
      parts.push('<div class="section worldview"><h2>世界观设定</h2>')
      // 渲染世界观各字段（此前只渲染了世界树 worldNodes，遗漏了世界观本身的设定字段）
      const wvFields: [string, string | undefined][] = [
        ['世界来源', worldview.worldOrigin],
        ['力量体系', worldview.powerHierarchy],
        ['世界结构', worldview.worldStructure],
        ['疆域尺寸', worldview.worldDimensions],
        ['地貌分布', worldview.continentLayout],
        ['重镇/区域分布', worldview.regionDimensions],
        ['山川水系', worldview.mountainsRivers],
        ['气候环境', worldview.climateByRegion],
        ['世界历史线', worldview.historyLine],
        ['世界大事记', worldview.worldEvents],
        ['种族民族', worldview.races],
        ['势力分布', worldview.factionLayout],
        ['政经文化', worldview.politicsEconomyCulture],
        ['矛盾冲突', worldview.internalConflicts],
        ['道具设计', worldview.itemDesign],
      ]
      for (const [label, val] of wvFields) {
        if (val && val.trim()) parts.push(`<h3>${escapeHTML(label)}</h3><p>${escapeHTML(val)}</p>`)
      }
      if (worldview.divineDesign?.hasDivinity) {
        const d = worldview.divineDesign
        parts.push(`<h3>神明设定</h3><p>${escapeHTML([d.divineRank, d.divineNames, d.divineRules].filter(Boolean).join('；'))}</p>`)
      }
      // 世界树节点（多世界）
      const wNodes = await db.worldNodes.where('projectId').equals(projectId).toArray()
      for (const wn of wNodes) {
        parts.push(`<h3>${escapeHTML(wn.name)}</h3><p>${escapeHTML(wn.description || '')}</p>`)
      }
      parts.push('</div>')
    }
  }

  // 角色
  if (options.includeCharacters) {
    const characters = await db.characters.where('projectId').equals(projectId).toArray()
    if (characters.length > 0) {
      parts.push('<div class="section characters"><h2>角色设定</h2>')
      for (const c of characters) {
        parts.push(`<div class="character-card">
          <h3>${escapeHTML(c.name)}</h3>
          <p><strong>简介：</strong>${escapeHTML(c.shortDescription)}</p>
          ${c.appearance ? `<p><strong>外貌：</strong>${escapeHTML(c.appearance)}</p>` : ''}
          ${c.personality ? `<p><strong>性格：</strong>${escapeHTML(c.personality)}</p>` : ''}
          ${c.background ? `<p><strong>背景：</strong>${escapeHTML(c.background)}</p>` : ''}
          ${c.motivation ? `<p><strong>动机：</strong>${escapeHTML(c.motivation)}</p>` : ''}
          ${c.abilities ? `<p><strong>能力：</strong>${escapeHTML(c.abilities)}</p>` : ''}
          ${c.arc ? `<p><strong>成长弧线：</strong>${escapeHTML(c.arc)}</p>` : ''}
        </div>`)
      }
      parts.push('</div>')
    }
  }

  // 正文
  for (const vol of volumes) {
    parts.push(`<div class="volume" id="vol-${vol.id}"><h2>${escapeHTML(vol.title)}</h2>`)
    if (options.includeOutline && vol.summary) {
      parts.push(`<p class="volume-summary">${escapeHTML(vol.summary)}</p>`)
    }

    const volChapters = nodes
      .filter(n => n.parentId === vol.id && n.type === 'chapter')
      .sort((a, b) => a.order - b.order)

    for (const node of volChapters) {
      const ch = chapterMap.get(node.id!)
      parts.push(`<div class="chapter" id="ch-${node.id}"><h3>${escapeHTML(node.title)}</h3>`)
      if (ch?.content) {
        parts.push(`<div class="chapter-content">${sanitizeExportHtml(ch.content)}</div>`)
      } else if (node.summary) {
        parts.push(`<p class="outline-only">[大纲] ${escapeHTML(node.summary)}</p>`)
      }
      parts.push('</div>')
    }
    parts.push('</div>')
  }

  const css = options.customCSS || DEFAULT_CSS

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(project.name)}</title>
  <style>${css}</style>
</head>
<body>
  <article class="novel">
    ${parts.join('\n')}
  </article>
  <footer class="export-footer">
    <p>由 StoryForge 导出 · ${new Date().toLocaleDateString('zh-CN')}</p>
  </footer>
</body>
</html>`
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const DEFAULT_CSS = `
  body {
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    font-family: 'Source Han Serif', 'Noto Serif CJK SC', 'STSong', serif;
    line-height: 1.8;
    color: #333;
    background: #fefefe;
  }
  .title-page {
    text-align: center;
    padding: 4rem 0;
    border-bottom: 1px solid #eee;
    margin-bottom: 2rem;
  }
  .title-page h1 { font-size: 2.5rem; margin-bottom: 1rem; }
  .title-page .description { color: #666; font-size: 1.1rem; }
  .title-page .meta { color: #999; font-size: 0.9rem; margin-top: 1rem; }
  .toc { margin: 2rem 0; padding: 1.5rem; background: #f8f8f8; border-radius: 8px; }
  .toc h2 { margin-top: 0; }
  .toc ul { padding-left: 1.5rem; }
  .toc a { color: #555; text-decoration: none; }
  .toc a:hover { color: #000; }
  .section { margin: 2rem 0; padding-top: 1rem; border-top: 1px solid #eee; }
  .character-card { margin: 1rem 0; padding: 1rem; background: #f9f9f9; border-radius: 6px; }
  .volume { margin: 3rem 0; }
  .volume h2 { color: #222; border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  .volume-summary { color: #888; font-style: italic; }
  .chapter { margin: 2rem 0; }
  .chapter h3 { color: #444; }
  .chapter-content { text-indent: 2em; }
  .chapter-content p { margin: 0.8em 0; text-indent: 2em; }
  .outline-only { color: #999; font-style: italic; }
  .export-footer { text-align: center; color: #ccc; margin-top: 4rem; padding-top: 1rem; border-top: 1px solid #eee; font-size: 0.8rem; }
`
