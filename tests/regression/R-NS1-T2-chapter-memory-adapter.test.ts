import { describe, expect, it } from 'vitest'
import {
  CHAPTER_MEMORY_EXTRACTOR_VERSION,
  parseChapterMemoryOutput,
  prepareChapterMemoryRequest,
} from '../../src/lib/ai/adapters/chapter-memory-adapter'
import { CHAPTER_TEXT_NORMALIZATION_VERSION } from '../../src/lib/ai/chapter-memory/text-normalization'

describe('NS-1 T2 · unified chapter memory adapter', () => {
  it('uses the full normalized chapter without the old 6000-char head truncation', async () => {
    const ending = '章末唯一锚点：她把铜钥匙交给顾临。'
    const content = `<p>${'前文。'.repeat(2200)}</p><p>${ending}</p>`
    const prepared = await prepareChapterMemoryRequest('长章', content)

    expect(prepared.normalizedText.length).toBeGreaterThan(6000)
    expect(prepared.normalizedText).toContain(ending)
    expect(prepared.messages.at(-1)?.content).toContain(ending)
    expect(prepared.sourceTextHash).toHaveLength(64)
  })

  it('injects system-owned provenance and locates exact evidence offsets', () => {
    const normalizedText = '顾临推开门。\n她把铜钥匙交给顾临。\n两人约定天亮前离开。'
    const raw = JSON.stringify({
      summary: '顾临取得铜钥匙，并与同伴约定天亮前离开。',
      handoff: {
        finalScene: {
          location: '门边',
          activeCharacters: ['顾临', '她'],
          lastAction: '两人约定天亮前离开',
        },
        stateChanges: ['顾临获得铜钥匙'],
        knowledgeChanges: [],
        commitments: ['天亮前离开'],
        openLoops: ['门外是否安全'],
        immediateNextIntent: '离开此地',
        evidenceQuotes: [
          { quote: '她把铜钥匙交给顾临。' },
          { quote: '模型编造的句子' },
        ],
      },
    })
    const parsed = parseChapterMemoryOutput({
      raw,
      chapterId: 7,
      normalizedText,
      sourceTextHash: 'a'.repeat(64),
      generatedAt: 123,
    })

    expect(parsed?.handoff.chapterId).toBe(7)
    expect(parsed?.handoff.extractorVersion).toBe(CHAPTER_MEMORY_EXTRACTOR_VERSION)
    expect(parsed?.handoff.textNormalizationVersion).toBe(CHAPTER_TEXT_NORMALIZATION_VERSION)
    expect(parsed?.handoff.evidenceQuotes).toEqual([{
      quote: '她把铜钥匙交给顾临。',
      startOffset: 7,
      endOffset: 17,
    }])
    expect(normalizedText.slice(7, 17)).toBe('她把铜钥匙交给顾临。')
  })

  it('drops ambiguous repeated quotes unless anchors identify exactly one occurrence', () => {
    const normalizedText = '甲说：走。\n乙回答。\n甲又说：走。\n丙点头。'
    const base = {
      summary: '众人准备离开。',
      handoff: {
        finalScene: { activeCharacters: ['甲', '乙', '丙'] },
        stateChanges: [],
        knowledgeChanges: [],
        commitments: [],
        openLoops: [],
        evidenceQuotes: [
          { quote: '走。' },
          { quote: '走。', prefix: '甲又说：', suffix: '\n丙点头。' },
        ],
      },
    }
    const parsed = parseChapterMemoryOutput({
      raw: JSON.stringify(base),
      chapterId: 1,
      normalizedText,
      sourceTextHash: 'b'.repeat(64),
    })

    expect(parsed?.handoff.evidenceQuotes).toHaveLength(1)
    const evidence = parsed!.handoff.evidenceQuotes[0]
    expect(normalizedText.slice(evidence.startOffset, evidence.endOffset)).toBe('走。')
    expect(evidence.startOffset).toBe(normalizedText.lastIndexOf('走。'))
  })

  it('returns null instead of throwing on malformed or incomplete output', () => {
    expect(parseChapterMemoryOutput({
      raw: 'not json',
      chapterId: 1,
      normalizedText: '正文',
      sourceTextHash: 'c'.repeat(64),
    })).toBeNull()
    expect(parseChapterMemoryOutput({
      raw: '{"summary":"","handoff":{}}',
      chapterId: 1,
      normalizedText: '正文',
      sourceTextHash: 'c'.repeat(64),
    })).toBeNull()
  })
})
