import type { ScreenplayBlock, ScreenplayReleaseManifestV1, ScreenplayScene, ScreenplayTargetSpecV1 } from '../types'

export type ScreenplayRenderableSceneV1 = Pick<ScreenplayScene,
  'stableKey' | 'episodeNumber' | 'sceneNumber' | 'order' | 'intExt' | 'location' | 'timeOfDay' | 'blocks'
>

export interface ScreenplayRenderDocumentV1 {
  title: string
  targetSpec: ScreenplayTargetSpecV1
  scenes: ScreenplayRenderableSceneV1[]
  includeNotes?: boolean
}

function orderedScenes(document: ScreenplayRenderDocumentV1): ScreenplayRenderableSceneV1[] {
  return [...document.scenes].sort((left, right) => left.order - right.order || left.episodeNumber - right.episodeNumber || left.sceneNumber - right.sceneNumber)
}

function heading(scene: ScreenplayRenderableSceneV1): string {
  return `${scene.intExt === 'INT_EXT' ? 'INT./EXT.' : `${scene.intExt}.`} ${scene.location.toLocaleUpperCase()} - ${scene.timeOfDay.toLocaleUpperCase()}`
}

function cue(block: Extract<ScreenplayBlock, { type: 'character' }>): string {
  return `${block.name.toLocaleUpperCase()}${block.extension ? ` (${block.extension})` : ''}${block.dualDialogue ? ' ^' : ''}`
}

function titlePageLines(document: ScreenplayRenderDocumentV1): string[] {
  const page = document.targetSpec.titlePage
  return [
    `Title: ${document.title}`,
    `Credit: ${page.creditLine}`,
    `Author: ${page.authorDisplayName}`,
    ...(page.contactText ? [`Contact: ${page.contactText}`] : []),
    ...(page.copyrightNotice ? [`Copyright: ${page.copyrightNotice}`] : []),
    ...(page.draftLabel ? [`Draft date: ${page.draftLabel}`] : []),
  ]
}

export function renderScreenplayFountainV1(document: ScreenplayRenderDocumentV1): string {
  const lines = [...titlePageLines(document), '']
  let episode = 0
  for (const scene of orderedScenes(document)) {
    if (document.targetSpec.format !== 'film' && scene.episodeNumber !== episode) {
      episode = scene.episodeNumber
      lines.push(`=== 第 ${episode} 集 ===`, '')
    }
    lines.push(`.${heading(scene)}`, '')
    for (const block of scene.blocks) {
      if (block.type === 'note' && !document.includeNotes) continue
      if (block.type === 'character') lines.push(cue(block))
      else if (block.type === 'parenthetical') lines.push(`(${block.text.replace(/^\(|\)$/g, '')})`)
      else if (block.type === 'transition') lines.push(`> ${block.text.toLocaleUpperCase()}`)
      else if (block.type === 'shot') lines.push(`!! ${block.text}`)
      else if (block.type === 'note') lines.push(`[[${block.text}]]`)
      else lines.push(block.text)
      lines.push('')
    }
  }
  return lines.join('\n').trimEnd() + '\n'
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function fdxParagraph(type: string, text: string, sceneNumber?: number): string {
  return `<Paragraph Type="${xml(type)}"${sceneNumber == null ? '' : ` Number="${sceneNumber}"`}><Text>${xml(text)}</Text></Paragraph>`
}

export function renderScreenplayFdxV1(document: ScreenplayRenderDocumentV1): string {
  const paragraphs: string[] = []
  for (const scene of orderedScenes(document)) {
    paragraphs.push(fdxParagraph('Scene Heading', heading(scene), scene.sceneNumber))
    for (const block of scene.blocks) {
      if (block.type === 'note' && !document.includeNotes) continue
      if (block.type === 'character') paragraphs.push(fdxParagraph('Character', cue(block)))
      else if (block.type === 'parenthetical') paragraphs.push(fdxParagraph('Parenthetical', `(${block.text.replace(/^\(|\)$/g, '')})`))
      else if (block.type === 'dialogue') paragraphs.push(fdxParagraph('Dialogue', block.text))
      else if (block.type === 'transition') paragraphs.push(fdxParagraph('Transition', block.text))
      else if (block.type === 'shot') paragraphs.push(fdxParagraph('Shot', block.text))
      else if (block.type === 'note') paragraphs.push(fdxParagraph('General', `[[${block.text}]]`))
      else paragraphs.push(fdxParagraph('Action', block.text))
    }
  }
  const page = document.targetSpec.titlePage
  return `<?xml version="1.0" encoding="UTF-8"?>\n<FinalDraft DocumentType="Script" Template="No" Version="1"><Content>${paragraphs.join('')}</Content><TitlePage><Content>${[
    fdxParagraph('Action', document.title),
    fdxParagraph('Action', page.creditLine),
    fdxParagraph('Action', page.authorDisplayName),
    ...(page.contactText ? [fdxParagraph('Action', page.contactText)] : []),
    ...(page.copyrightNotice ? [fdxParagraph('Action', page.copyrightNotice)] : []),
    ...(page.draftLabel ? [fdxParagraph('Action', page.draftLabel)] : []),
  ].join('')}</Content></TitlePage></FinalDraft>\n`
}

export function renderScreenplayPrintHtmlV1(document: ScreenplayRenderDocumentV1): string {
  const body = orderedScenes(document).map(scene => `<section class="scene"><h2>${xml(heading(scene))}</h2>${scene.blocks.flatMap(block => {
    if (block.type === 'note' && !document.includeNotes) return []
    const value = block.type === 'character' ? cue(block) : block.text
    return [`<p class="${block.type}">${xml(block.type === 'parenthetical' ? `(${value.replace(/^\(|\)$/g, '')})` : value).replace(/\n/g, '<br>')}</p>`]
  }).join('')}</section>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${xml(document.title)}</title><style>@page{size:A4;margin:22mm 20mm 20mm}body{font-family:"Noto Sans CJK SC","Source Han Sans SC","PingFang SC",sans-serif;color:#111;font-size:12pt;line-height:1.45}.title{height:230mm;display:grid;place-content:center;text-align:center;break-after:page}.title h1{font-size:24pt}.scene{break-inside:auto}.scene h2{font-size:12pt;margin:18pt 0 10pt}.scene p{white-space:pre-wrap;margin:7pt 0}.character{width:52%;margin:12pt auto 0!important;text-align:center;font-weight:700}.parenthetical{width:38%;margin:0 auto!important}.dialogue{width:52%;margin:0 auto 10pt!important}.transition{text-align:right;font-weight:700}.shot{font-weight:700;text-transform:uppercase}.note{color:#666;border-left:2px solid #aaa;padding-left:8pt}</style></head><body><section class="title"><h1>${xml(document.title)}</h1><p>${xml(document.targetSpec.titlePage.creditLine)}</p><p>${xml(document.targetSpec.titlePage.authorDisplayName)}</p><p>${xml(document.targetSpec.titlePage.draftLabel)}</p></section>${body}</body></html>`
}

export function screenplayRenderDocumentFromReleaseV1(manifest: ScreenplayReleaseManifestV1): ScreenplayRenderDocumentV1 {
  return { title: manifest.work.title, targetSpec: manifest.adaptation.targetSpec, scenes: structuredClone(manifest.scenes) }
}

export interface ScreenplayRoundTripOutlineV1 {
  headings: string[]
  orderedParagraphs: Array<{ type: string; text: string }>
}

/** Strict enough to verify StoryForge's deterministic Fountain export without pretending to be a full Fountain editor. */
export function parseStoryForgeFountainV1(source: string): ScreenplayRoundTripOutlineV1 {
  if (typeof source !== 'string' || !source.trim()) throw new Error('[screenplay-render] Fountain 内容为空')
  const lines = source.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  const firstScene = lines.findIndex(line => line.startsWith('.INT.') || line.startsWith('.EXT.') || line.startsWith('.INT./EXT.'))
  if (firstScene < 0) throw new Error('[screenplay-render] Fountain 缺少场景标题')
  const body = lines.slice(firstScene)
  const headings = body.filter(line => line.startsWith('.')).map(line => line.slice(1))
  return {
    headings,
    orderedParagraphs: body.map(line => ({
      type: line.startsWith('.') ? 'Scene Heading' : line.startsWith('> ') ? 'Transition' : line.startsWith('!! ') ? 'Shot' : line.startsWith('[[') ? 'General' : 'Content',
      text: line.replace(/^\.|^>\s+|^!!\s+|^\[\[|\]\]$/g, ''),
    })),
  }
}

function unxml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/** Parses the closed paragraph subset emitted by renderScreenplayFdxV1. */
export function parseStoryForgeFdxV1(source: string): ScreenplayRoundTripOutlineV1 {
  if (!/^<\?xml[^>]*>\s*<FinalDraft\b/.test(source) || !source.trimEnd().endsWith('</FinalDraft>')) throw new Error('[screenplay-render] FDX XML 外壳非法')
  const paragraphs: Array<{ type: string; text: string }> = []
  const pattern = /<Paragraph Type="([^"]+)"(?: Number="\d+")?><Text>([\s\S]*?)<\/Text><\/Paragraph>/g
  for (const match of source.matchAll(pattern)) paragraphs.push({ type: unxml(match[1]), text: unxml(match[2]) })
  if (!paragraphs.length) throw new Error('[screenplay-render] FDX 缺少 Paragraph')
  return { headings: paragraphs.filter(item => item.type === 'Scene Heading').map(item => item.text), orderedParagraphs: paragraphs }
}
