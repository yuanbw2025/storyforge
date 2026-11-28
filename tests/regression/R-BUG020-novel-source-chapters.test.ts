import { afterEach, beforeEach, expect, it } from 'vitest'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { splitDocumentChapters } from '../../src/lib/import/chunker'
import { extractTextFromFile, FILE_SIZE_LIMITS } from '../../src/lib/doc-parser'
import { createAdaptation, listActiveSourceUnits, readAdaptationSourceContent } from '../../src/lib/adaptation/source-manifest'
import { htmlToPlainText, plainTextToHtml, importedNovelTextToHtmlV1 } from '../../src/lib/utils/html'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())
const create = (text: string) => createWorkspace({ name: '导入来源', genres: [], description: '', targetWordCount: text.length, status: 'drafting' }, { kind: 'novel', novelProfile: 'long', importedNovelText: text })

it('stores actual short chapters separately rather than assigning 20k processing-group labels as chapter names', async () => {
  const originals = Array.from({ length: 40 }, (_, i) => `第${i + 1}章 标题${i + 1}\n正文${i}。${'叙事。'.repeat(220)}\n`)
  const f = await create(originals.join(''))
  const chapters = await db.chapters.where('projectId').equals(f.scope.projectId).sortBy('order')
  expect(chapters).toHaveLength(originals.length)
  for (const [i, chapter] of chapters.entries()) {
    expect(chapter.title).toBe(`第${i + 1}章 标题${i + 1}`)
    expect(chapter.content).toBe(plainTextToHtml(originals[i]))
  }
})

it('does not consume following body lines or blank lines in a chapter label', async () => {
  const text = `前言\n\n第一章 开始\n正文第一句。\n正文第二句。\n${'长正文。'.repeat(4100)}\n\n第二章 结束\n独特尾标记。\n`
  const f = await create(text)
  const chapters = await db.chapters.where('projectId').equals(f.scope.projectId).sortBy('order')
  expect(chapters.map(ch => ch.title)).toEqual(['前言', '第一章 开始', '第二章 结束'])
  expect(chapters[chapters.length - 1]!.content).toBe(plainTextToHtml('第二章 结束\n独特尾标记。\n'))
})

it('preserves prefix whitespace and CRLF at recognized chapter boundaries', async () => {
  const cases = ['\n  \r\n第一章 标题\r\n正文。\r\n第二章 尾章\r\n尾文。']
  for (const text of cases) {
    const f = await create(text)
    const chapters = await db.chapters.where('projectId').equals(f.scope.projectId).sortBy('order')
    expect(chapters).toHaveLength(text.includes('第一章') ? 2 : 1)
    expect(chapters[0].title).toBe(text.includes('第一章') ? '第一章 标题' : '全文')
    const expected = text.includes('第一章') ? [text.slice(0, text.indexOf('第二章')), text.slice(text.indexOf('第二章'))] : [text]
    expect(chapters.map(ch => ch.content)).toEqual(expected.map(importedNovelTextToHtmlV1))
  }
})

it('uses line-local labels only in persisted chapters and preserves all source character ranges', () => {
  const text = `第一章 标题\n正文第一句。\n${'大段正文。'.repeat(7000)}\n第二章 尾章\n独特尾标记。`
  expect(splitDocumentChapters(text).map(chunk => chunk.label)).toEqual(['第一章 标题', '第二章 尾章'])
  expect(splitDocumentChapters(text).map(ch => ch.text).join('')).toBe(text)
})

it('keeps a long headingless manuscript in one original Work chapter instead of inventing AI-budget chapters', async () => {
  const text = '\uFEFF  \r\n' + '无标题的连续原文，林岚守住灯塔。e\u0301🌙\r\n\r\n'.repeat(1200) + '  尾部原文。\r\n'
  expect(text.length).toBeGreaterThan(20_000)
  expect(splitDocumentChapters(text)).toEqual([{ index: 0, startChar: 0, endChar: text.length, charCount: text.length, label: '全文', text }])
  const created = await create(text)
  const chapters = await db.chapters.where('projectId').equals(created.scope.projectId).sortBy('order')
  expect(chapters).toHaveLength(1)
  expect(chapters[0]).toMatchObject({ title: '全文', content: importedNovelTextToHtmlV1(text), workId: created.scope.workId })
  expect(chapters[0].worldId).toBeUndefined()
  expect(await db.outlineNodes.get(chapters[0].outlineNodeId)).toMatchObject({ title: '全文', type: 'chapter', workId: created.scope.workId })
})

it('extracts a near-5MiB million-character source, stores all chapters, and freezes/read-checks the first middle and final evidence', async () => {
  const originals = Array.from({ length: 100 }, (_, i) => `第${i + 1}章 章节${i + 1}\n段首标记${i}。${'中文原作。'.repeat(3400)}段尾标记${i}。\n`)
  const text = originals.join('')
  const file = new File([text], '百万字原作.txt', { type: 'text/plain' })
  expect(file.size).toBeGreaterThan(4.8 * 1024 * 1024)
  expect(file.size).toBeLessThan(FILE_SIZE_LIMITS.txt)
  const extracted = await extractTextFromFile(file)
  expect(extracted.text).toBe(text)
  expect(extracted.rawChars).toBe(text.length)
  const f = await create(extracted.text)
  const chapters = await db.chapters.where('projectId').equals(f.scope.projectId).sortBy('order')
  expect(chapters).toHaveLength(100)
  expect(chapters.map(ch => ch.content)).toEqual(originals.map(plainTextToHtml))
  const created = await createAdaptation({ sourceScope: f.scope, sourceWorkId: f.scope.workId, title: '完整来源剧本', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: {
    format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 100, rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'standard', preserveVoiceOver: false,
    titlePage: { creditLine: '', authorDisplayName: '', contactText: '', copyrightNotice: '', draftLabel: '' }, exportDefaults: ['fountain'],
  } })
  const units = (await listActiveSourceUnits(created.adaptation.id!)).filter(unit => unit.sourceKind === 'chapter')
  expect(units.map(unit => unit.sourceChapterId)).toEqual(chapters.map(ch => ch.id))
  expect(units.map(unit => unit.label)).toEqual(chapters.map(ch => ch.title))
  for (const index of [0, 49, 99]) {
    const read = await readAdaptationSourceContent({ targetScope: created.scope, adaptationProjectId: created.adaptation.id!, manifestVersion: 1, sourceUnitKeys: [units[index].sourceUnitKey] })
    expect(read.units[0].content).toContain(htmlToPlainText(chapters[index].content))
    expect(read.units[0].contentHash).toBe(units[index].contentHash)
  }
  const backup = await exportProjectJSON(f.scope.projectId)
  const restoredId = await importProjectJSON(backup)
  const restored = await db.chapters.where('projectId').equals(restoredId).sortBy('order')
  expect(restored.map(ch => ({ title: ch.title, content: ch.content }))).toEqual(chapters.map(ch => ({ title: ch.title, content: ch.content })))
  const before = await db.chapters.count()
  await expect(create('字'.repeat(5_000_001))).rejects.toThrow('最多 500 万字符')
  expect(await db.chapters.count()).toBe(before)
  await expect(extractTextFromFile(new File(['a'.repeat(FILE_SIZE_LIMITS.txt + 1)], '超限.txt'))).rejects.toThrow('文件最大')
}, 60000)

it('retains whitespace-only source lines and BOM as real paragraph text through native creation and backup restore', async () => {
  const text = '\uFEFF  \r\n第一章 原稿\r\n\t  \r\n  e\u0301🌙 & <原文>  \r\n\r\n第二章 尾章\r\n  \t\r\n尾文🪶  \r\n'
  const f = await create(text)
  const original = await db.chapters.where('projectId').equals(f.scope.projectId).sortBy('order')
  const paragraphText = (html: string) => { const node = document.implementation.createHTMLDocument('').createElement('div');node.innerHTML = html;return Array.from(node.children).map(p => p.textContent).join('\n') }
  expect(original).toHaveLength(2)
  expect(original[0].content).toContain('<p>\uFEFF  </p>')
  expect(original[0].content).toContain('<p>\t  </p>')
  expect(original[0].content).toContain('e\u0301🌙 &amp; &lt;原文&gt;  ')
  const expected = [text.slice(0, text.indexOf('第二章')), text.slice(text.indexOf('第二章'))].map(value => value.replace(/\r\n/g, '\n'))
  expect(original.map(chapter => paragraphText(chapter.content))).toEqual(expected)
  const copyId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = await db.chapters.where('projectId').equals(copyId).sortBy('order')
  expect(restored.map(chapter => chapter.content)).toEqual(original.map(chapter => chapter.content))
  expect(restored.map(chapter => paragraphText(chapter.content))).toEqual(expected)
  expect(plainTextToHtml('  \n\t')).toBe('<p></p><p></p>') // Original model/editor callers keep their existing contract.
})
