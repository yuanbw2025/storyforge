import { Fountain } from 'fountain-js'
import { describe, expect, it } from 'vitest'
import type { ScreenplayBlock, ScreenplayTargetSpecV1 } from '../../src/lib/types'
import {
  renderScreenplayFdxV1,
  renderScreenplayFountainV1,
  renderScreenplayPrintHtmlV1,
  type ScreenplayRenderDocumentV1,
} from '../../src/lib/screenplay/renderers'

const targetSpec: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 90,
  rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'standard', preserveVoiceOver: true,
  titlePage: { creditLine: '原创', authorDisplayName: '测试作者', contactText: '', copyrightNotice: '', draftLabel: '第一稿' },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}

function document(blocks: ScreenplayBlock[], includeNotes = false): ScreenplayRenderDocumentV1 {
  return {
    title: '山站夜话', targetSpec: structuredClone(targetSpec), includeNotes,
    scenes: [{ stableKey: 'station', episodeNumber: 1, sceneNumber: 1, order: 0,
      intExt: 'INT', location: 'Station', timeOfDay: 'Night', blocks }],
  }
}

// This is a separate, pinned implementation of Fountain 1.1. StoryForge's
// blank-stripping outline reader cannot certify Character/Dialogue grouping.
function parse(input: ScreenplayRenderDocumentV1) {
  return new Fountain().parse(renderScreenplayFountainV1(input), true)
}

function paragraphs(input: ScreenplayRenderDocumentV1) {
  return parse(input).tokens.filter(token => !token.is_title && token.text !== undefined)
    .map(token => ({ type: token.type, text: token.text }))
}

describe('SFQA-029 · Fountain interoperability', () => {
  it.each(['AVA', '林岚', 'McClane'])('keeps %s and dialogue in one independently parsed group', name => {
    const output = parse(document([
      { id: 'cue', type: 'character', name },
      { id: 'line', type: 'dialogue', text: '末班车到了。' },
    ]))
    expect(output.tokens.filter(token => !token.is_title).map(token => token.type)).toEqual([
      'scene_heading', 'dialogue_begin', 'character', 'dialogue', 'dialogue_end',
    ])
    expect(output.tokens.find(token => token.type === 'character')?.text).toBe(name)
    expect(output.tokens.find(token => token.type === 'dialogue')?.text).toBe('末班车到了。')
  })

  it('keeps a parenthetical between its cue and dialogue, including character extensions', () => {
    expect(paragraphs(document([
      { id: 'cue', type: 'character', name: 'McClane', extension: 'O.S.' },
      { id: 'aside', type: 'parenthetical', text: '压低声音' },
      { id: 'line', type: 'dialogue', text: '站在我身后。' },
    ]))).toEqual([
      { type: 'scene_heading', text: 'INT. STATION - NIGHT' },
      { type: 'character', text: 'McClane (O.S.)' },
      { type: 'parenthetical', text: '(压低声音)' },
      { type: 'dialogue', text: '站在我身后。' },
    ])
  })

  it('preserves both sides of a dual dialogue and ends the group before action', () => {
    const output = parse(document([
      { id: 'left', type: 'character', name: '林岚' },
      { id: 'left-line', type: 'dialogue', text: '等等。' },
      { id: 'right', type: 'character', name: 'McClane', dualDialogue: true },
      { id: 'right-line', type: 'dialogue', text: '别动。' },
      { id: 'action', type: 'action', text: '两人同时停住。' },
    ]))
    expect(output.tokens.filter(token => token.type === 'character').map(token => token.text)).toEqual(['林岚', 'McClane'])
    expect(output.tokens.filter(token => token.type === 'dialogue_begin').map(token => token.dual)).toEqual(['left', 'right'])
    expect(output.tokens.filter(token => token.type.startsWith('dual_dialogue')).map(token => token.type)).toEqual(['dual_dialogue_begin', 'dual_dialogue_end'])
    expect(output.tokens[output.tokens.length - 1]).toMatchObject({ type: 'action', text: '两人同时停住。' })
  })

  it('preserves internal dialogue line breaks, including a blank line and CRLF input', () => {
    const output = parse(document([
      { id: 'cue', type: 'character', name: '林岚' },
      { id: 'line', type: 'dialogue', text: '第一句。\r\n第二句。\r\n\r\n最后一句。' },
    ]))
    const lines = output.tokens.filter(token => token.type === 'dialogue')
    expect(lines).toHaveLength(1)
    expect(lines[0].text?.replace(/^ {2}$/gm, '')).toBe('第一句。\n第二句。\n\n最后一句。')
    expect(output.html.script).toContain('第二句。<br /><br />最后一句。')
  })

  it.each(['INT. ANNEX - DAY', 'McClane\nA label on a poster.', '.A heading on a sign', '# One instruction', '= A printed summary', '~ A quoted lyric', '> An arrow', '==='])('keeps action text as action: %s', text => {
    const output = parse(document([{ id: 'action', type: 'action', text }]))
    expect(output.tokens.filter(token => !token.is_title).map(token => token.type)).toEqual(['scene_heading', 'action'])
    // Reference tokens deliberately retain inline escapes. Verify the text
    // through that parser's own renderer, including original line breaks.
    const html = new DOMParser().parseFromString(output.html.script, 'text/html')
    html.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
    expect(html.querySelector('p')?.textContent).toBe(text)
  })

  it('keeps transition text and optional notes distinct from dialogue', () => {
    const blocks: ScreenplayBlock[] = [
      { id: 'cue', type: 'character', name: '林岚' },
      { id: 'line', type: 'dialogue', text: '别回头。' },
      { id: 'transition', type: 'transition', text: 'Fade to black' },
      { id: 'note', type: 'note', text: 'INT. THIS IS A NOTE' },
    ]
    expect(paragraphs(document(blocks, true)).slice(-2)).toEqual([
      { type: 'transition', text: 'Fade to black' },
      { type: 'note', text: 'INT. THIS IS A NOTE' },
    ])
    expect(parse(document(blocks)).tokens.some(token => token.type === 'note')).toBe(false)
    expect(renderScreenplayFountainV1(document(blocks))).not.toContain('INT. THIS IS A NOTE')
  })

  it('uses official forced Action and multiline Note syntax where fountain-js 1.2.4 has known parser limitations', () => {
    // https://fountain.io/syntax/: ! forces Action, and a two-space line
    // preserves an internal blank line. The reference parser incorrectly
    // prioritizes TO: over ! and only recognizes single-line Note tokens.
    // These exact grammar controls do not claim those reader bugs are fixed.
    const input = document([
      { id: 'action', type: 'action', text: 'CUT TO:' },
      { id: 'note', type: 'note', text: 'INT. THIS IS A NOTE\n\nKeep this note.' },
    ], true)
    expect(renderScreenplayFountainV1(input)).toBe([
      'Title: 山站夜话', 'Credit: 原创', 'Author: 测试作者', 'Draft date: 第一稿', '',
      '.INT. STATION - NIGHT', '', '!CUT TO:', '',
      '[[INT. THIS IS A NOTE', '  ', 'Keep this note.]]', '',
    ].join('\n'))
  })

  it('escapes literal emphasis and boneyard delimiters instead of silently formatting or deleting prose', () => {
    const text = 'A *literal* _label_ and /* keep these words */.'
    const output = parse(document([
      { id: 'action', type: 'action', text },
      { id: 'cue', type: 'character', name: '林岚' },
      { id: 'line', type: 'dialogue', text },
    ]))
    const html = new DOMParser().parseFromString(output.html.script, 'text/html')
    expect(html.querySelectorAll('span, em, strong')).toHaveLength(0)
    expect(html.querySelector('p')?.textContent).toBe(text)
    expect(html.querySelector('.dialogue p')?.textContent).toBe(text)
  })

  it('preserves leading action spaces and literal force/lyric markers within multiline text', () => {
    const output = parse(document([
      { id: 'action', type: 'action', text: '  A sign reads:\n!Stop\n\nINT. ANNEX - DAY' },
      { id: 'cue', type: 'character', name: '林岚' },
      { id: 'line', type: 'dialogue', text: '~这是原话，不是歌词。\n!别走。' },
    ]))
    expect(output.tokens.filter(token => token.type === 'scene_heading')).toHaveLength(1)
    expect(output.tokens.filter(token => token.type === 'lyrics')).toHaveLength(0)
    const html = new DOMParser().parseFromString(output.html.script, 'text/html')
    expect(html.querySelector('p')?.textContent).toBe('\u00a0\u00a0A sign reads:!Stop')
    expect(html.querySelector('.dialogue p')?.textContent).toBe('~这是原话，不是歌词。!别走。')
  })

  it('does not let empty optional title fields end the title page', () => {
    const input = document([{ id: 'action', type: 'action', text: '门开了。' }])
    input.targetSpec.titlePage.creditLine = ''
    expect(parse(input).tokens.filter(token => token.type === 'author').map(token => token.text)).toEqual(['测试作者'])
  })

  it('reports a literal scene-number suffix instead of moving time-of-day text into a different field', () => {
    const input = document([{ id: 'action', type: 'action', text: '门开了。' }])
    input.scenes[0].timeOfDay = 'Night #A1#'
    const before = structuredClone(input)
    expect(() => renderScreenplayFountainV1(input)).toThrow(/场景编号.*FDX/)
    expect(input).toEqual(before)
    const xml = new DOMParser().parseFromString(renderScreenplayFdxV1(input), 'application/xml')
    expect(xml.querySelector('Paragraph[Type="Scene Heading"]')?.textContent).toBe('INT. STATION - NIGHT #A1#')
  })

  it('preserves an embedded scene-number-like label which is not at the end of the heading', () => {
    const input = document([{ id: 'action', type: 'action', text: '门开了。' }])
    input.scenes[0].location = 'Station #A1#'
    expect(paragraphs(input)[0]).toEqual({ type: 'scene_heading', text: 'INT. STATION #A1# - NIGHT' })
  })

  it.each(['\nINT. SIGN - DAY', ' \n# A sign'])('preserves leading blank action lines while forcing the first actual paragraph: %j', text => {
    const input = document([{ id: 'action', type: 'action', text }])
    const output = parse(input)
    expect(output.tokens.filter(token => !token.is_title).map(token => token.type)).toEqual(['scene_heading', 'action'])
    expect(renderScreenplayFountainV1(input)).toContain(text.replace(/([^\s])/, '!$1'))
    expect(input.scenes[0].blocks[0]).toEqual({ id: 'action', type: 'action', text })
  })

  it.each<ScreenplayBlock>([
    { id: 'cue', type: 'character', name: '林岚\n其他角色' },
    { id: 'cue', type: 'character', name: '林岚^' },
    { id: 'aside', type: 'parenthetical', text: '第一行\n第二行' },
    { id: 'transition', type: 'transition', text: '一个转场 <' },
    { id: 'transition', type: 'transition', text: '第一行\u2028第二行' },
    { id: 'line', type: 'dialogue', text: '(这句需要读出来。)' },
  ])('reports format-specific ambiguous structural content without modifying the AST ($type)', block => {
    const input = document([block])
    const before = structuredClone(input)
    expect(() => renderScreenplayFountainV1(input)).toThrow(/FDX/)
    expect(input).toEqual(before)
    expect(() => renderScreenplayFdxV1(input)).not.toThrow()
  })

  it.each(['[[keep this prose]]', 'an unmatched [[ opening'])('reports an unrepresentable literal delimiter without changing source or losing the FDX fallback: %s', text => {
    const input = document([{ id: 'action', type: 'action', text }])
    const before = structuredClone(input)
    expect(() => renderScreenplayFountainV1(input)).toThrow(/Fountain.*FDX/)
    expect(input).toEqual(before)
    const xml = new DOMParser().parseFromString(renderScreenplayFdxV1(input), 'application/xml')
    expect(xml.querySelector('FinalDraft > Content > Paragraph[Type="Action"]')?.textContent).toBe(text)
  })

  it('allows harmless closing brackets in body text but rejects a premature Note terminator', () => {
    expect(paragraphs(document([{ id: 'action', type: 'action', text: 'a literal ]] ending' }]))[1]).toEqual({ type: 'action', text: 'a literal ]] ending' })
    const note = document([{ id: 'note', type: 'note', text: 'a literal ]] ending' }], true)
    expect(() => renderScreenplayFountainV1(note)).toThrow(/注释.*FDX/)
    expect(note.scenes[0].blocks[0]).toEqual({ id: 'note', type: 'note', text: 'a literal ]] ending' })
  })

  it('keeps literal empty parentheses as spoken dialogue when they do not match a parenthetical', () => {
    expect(paragraphs(document([
      { id: 'cue', type: 'character', name: '林岚' },
      { id: 'line', type: 'dialogue', text: '()' },
    ]))[2]).toEqual({ type: 'dialogue', text: '()' })
  })

  it('indents multiline title-page fields using the official continuation syntax', () => {
    const input = document([{ id: 'action', type: 'action', text: '门开了。' }])
    input.targetSpec.titlePage.contactText = '第一行\n第二行'
    const output = parse(input)
    expect(output.tokens.filter(token => token.type === 'author')).toHaveLength(1)
    expect(output.tokens.find(token => token.type === 'contact')?.text).toBe('第一行\n第二行')
    // Another known reference-reader limitation: it treats an indented
    // "Author:" continuation as a new key. Keep the official indentation,
    // without deleting or rewriting the author's contact text to satisfy it.
    input.targetSpec.titlePage.contactText = '第一行\nAuthor: 原文中有冒号'
    expect(renderScreenplayFountainV1(input)).toContain('\nContact:\n   第一行\n   Author: 原文中有冒号\nDraft date: 第一稿\n')
  })

  it('keeps episode labels visible and exports a Shot as Fountain action without a stray exclamation mark', () => {
    const input = document([{ id: 'shot', type: 'shot', text: '特写：车票' }])
    input.targetSpec.format = 'series'
    input.targetSpec.episodeCount = 2
    input.scenes.push({ ...structuredClone(input.scenes[0]), stableKey: 'second', episodeNumber: 2, sceneNumber: 2, order: 1 })
    const output = parse(input)
    expect(output.tokens.filter(token => token.type === 'action').map(token => token.text)).toEqual(['=== 第 1 集 ===', '特写：车票', '=== 第 2 集 ===', '特写：车票'])
    expect(renderScreenplayFdxV1(input)).toContain('Type="Shot"')
    expect(renderScreenplayPrintHtmlV1(input)).toContain('class="shot"')
  })

  it('does not mutate source scenes or their order, and sorts the exported scenes deterministically', () => {
    const input = document([{ id: 'action', type: 'action', text: '门打开了。' }])
    input.scenes.unshift({ ...structuredClone(input.scenes[0]), stableKey: 'later', sceneNumber: 2, order: 1, location: 'Annex' })
    const before = structuredClone(input)
    expect(parse(input).tokens.filter(token => token.type === 'scene_heading').map(token => token.text)).toEqual(['INT. STATION - NIGHT', 'INT. ANNEX - NIGHT'])
    expect(input).toEqual(before)
  })
})

describe('SFQA-029 · separate FDX and print structural checks', () => {
  const blocks: ScreenplayBlock[] = [
    { id: 'cue', type: 'character', name: '林岚' },
    { id: 'aside', type: 'parenthetical', text: '低声' },
    { id: 'line', type: 'dialogue', text: '门 <开> 了 & 雨停了。\n走吧。' },
    { id: 'note', type: 'note', text: '私下备注' },
  ]

  it('parses FDX XML and checks typed paragraphs, original text and hidden notes independently', () => {
    const xml = new DOMParser().parseFromString(renderScreenplayFdxV1(document(blocks)), 'application/xml')
    expect(xml.querySelector('parsererror')).toBeNull()
    const rows = [...xml.querySelectorAll('FinalDraft > Content > Paragraph')]
    expect(rows.map(row => row.getAttribute('Type'))).toEqual(['Scene Heading', 'Character', 'Parenthetical', 'Dialogue'])
    expect(rows[3].textContent).toBe('门 <开> 了 & 雨停了。\n走吧。')
    expect(xml.textContent).not.toContain('私下备注')
  })

  it('parses print HTML and checks text, line breaks and classes independently', () => {
    const html = new DOMParser().parseFromString(renderScreenplayPrintHtmlV1(document(blocks)), 'text/html')
    expect([...html.querySelectorAll('.scene p')].map(row => row.className)).toEqual(['character', 'parenthetical', 'dialogue'])
    expect(html.querySelector('.dialogue')?.textContent).toBe('门 <开> 了 & 雨停了。走吧。')
    expect(html.querySelectorAll('.dialogue br')).toHaveLength(1)
    expect(html.querySelector('.note')).toBeNull()
  })
})
