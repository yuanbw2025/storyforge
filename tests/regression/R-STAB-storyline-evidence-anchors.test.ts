import { describe, expect, it } from 'vitest'
import { resolveStorylineModelEvidenceV1, storylineEvidenceAnchorsV1 } from '../../src/lib/storyline/evidence-anchors'

const body = '她先试绳——确认无断股。\n\n随后记录结果，仍未放行粮车。'
const root = (row: unknown) => ({ progress: [row], crossings: [], newArcs: [] })
describe('STAB · mapping evidence uses frozen physical-text anchors', () => {
  it('selects exact source bytes across punctuation and paragraph separators, without copying a model quotation', () => {
    const anchors = storylineEvidenceAnchorsV1(body)
    expect(anchors.map(row => row.anchorId)).toEqual(['p1', 'p2'])
    const value = resolveStorylineModelEvidenceV1(root({ arcId: 7, anchorId: 'p2' }), body) as any
    expect(value.progress[0]).toEqual({ arcId: 7, quote: '随后记录结果，仍未放行粮车。' })
    expect(body).toContain(value.progress[0].quote)
  })
  it.each([{ anchorId: 'p99' }, { anchorId: 1 }, { anchorId: 'p1', quote: '她先试绳—确认无断股。' }, { anchorId: 'p1', evidenceQuote: '另一个字段' }])('unknown or ambiguous evidence is rejected: %j', row => {
    expect(() => resolveStorylineModelEvidenceV1(root(row), body)).toThrow()
  })
  it('historical literal quotes are not repaired or normalized by anchor decoding', () => {
    const source = root({ quote: '她先试绳—确认无断股。' })
    expect(resolveStorylineModelEvidenceV1(source, body)).toEqual(source)
    expect(body).not.toContain((source.progress[0] as any).quote)
  })
  it('long paragraphs share the pinned review segmentation without splitting a surrogate pair', () => {
    const text = '甲'.repeat(159) + '😀' + '乙'.repeat(8)
    const anchors = storylineEvidenceAnchorsV1(text)
    expect(anchors.map(row => row.anchorId)).toEqual(['p1-1', 'p1-2'])
    expect(anchors.map(row => row.quote).join('')).toBe(text)
    expect(anchors[1].quote.startsWith('😀')).toBe(true)
  })
})
