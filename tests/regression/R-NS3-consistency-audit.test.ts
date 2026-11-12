import { describe, expect, it } from 'vitest'
import {
  buildConsistencyAuditPrompt,
  parseConsistencyAuditResult,
  type ConsistencyAuditCitationSourceV1,
} from '../../src/lib/ai/adapters/consistency-audit-adapter'

describe('NS-3 · evidence-backed consistency audit', () => {
  const chapter = '林寻说自己从未见过青铜铃，却从左袖取出了青铜铃。'

  const sourceText = '第1章：消耗 青铜铃 ×1（已交给守门人）'
  const citationInput = {
    chapterVersionHash: 'a'.repeat(64),
    sources: [{ sourceType: 'observation', sourceId: 7, sourceKey: 'itemLedger', versionHash: 'b'.repeat(64),
      start: 19, end: 19 + sourceText.length, text: sourceText }] satisfies ConsistencyAuditCitationSourceV1[],
  }

  it('keeps a hard conflict only when both prose quote and evidence quote resolve exactly', () => {
    const result = parseConsistencyAuditResult({
      mode: 'fast',
      chapterContent: chapter,
      ...citationInput,
      raw: JSON.stringify({
        findings: [{
          category: '持有物',
          severity: 'hard',
          quote: '从左袖取出了青铜铃',
          evidence: [{
            sourceType: 'observation',
            sourceId: 7,
            quote: '消耗 青铜铃 ×1',
          }],
          reason: '该物品此前已消耗',
        }],
      }),
    })
    expect(result?.findings[0]).toMatchObject({
      severity: 'hard',
      category: '持有物',
    })
  })

  it('rejects invented prose or evidence instead of presenting an empty successful report', () => {
    const invented = parseConsistencyAuditResult({
      mode: 'fast',
      chapterContent: chapter,
      ...citationInput,
      raw: JSON.stringify({
        findings: [{
          category: '地点',
          severity: 'hard',
          quote: '正文里不存在',
          evidence: [],
          reason: '编造',
        }],
      }),
    })
    expect(invented).toBeNull()

    const noEvidence = parseConsistencyAuditResult({
      mode: 'fast',
      chapterContent: chapter,
      ...citationInput,
      raw: JSON.stringify({
        findings: [{
          category: '持有物',
          severity: 'hard',
          quote: '从左袖取出了青铜铃',
          evidence: [{ sourceType: 'observation', sourceId: 7, quote: '不存在的证据' }],
          reason: '证据失配',
        }],
      }),
    })
    expect(noEvidence).toBeNull()
  })

  it('can cite another exact passage in the reviewed chapter without inventing a registered source', () => {
    const parse = (sourceId: number) => parseConsistencyAuditResult({
      mode: 'fast', chapterContent: chapter, ...citationInput,
      raw: JSON.stringify({ findings: [{
        category: '人物陈述', severity: 'risk', quote: '从左袖取出了青铜铃',
        evidence: [{ sourceType: 'chapter', sourceId, quote: '自己从未见过青铜铃' }],
        reason: '陈述与行为需要核对，也可能是角色故意说谎。',
      }] }),
    })
    expect(parse(0)?.findings[0].evidence[0].quote).toBe('自己从未见过青铜铃')
    expect(parse(7)).toBeNull()
  })

  it.each([
    { severity: 'certain' },
    { reason: '' },
    { evidence: [{ sourceType: 'invented', sourceId: 7, quote: '消耗 青铜铃 ×1' }] },
    { evidence: [{ sourceType: 'chapter', sourceId: -1, quote: '消耗 青铜铃 ×1' }] },
  ])('does not turn malformed findings into a valid subset: %j', invalid => {
    const valid = {
      category: '持有物', severity: 'hard', quote: '从左袖取出了青铜铃',
      evidence: [{ sourceType: 'observation', sourceId: 7, quote: '消耗 青铜铃 ×1' }],
      reason: '此前已交出，需要核对何时取回。',
    }
    expect(parseConsistencyAuditResult({
      mode: 'fast', chapterContent: chapter, ...citationInput,
      raw: JSON.stringify({ findings: [valid, { ...valid, ...invalid }] }),
    })).toBeNull()
  })

  it('preserves an evidence-free issue as uncertain and accepts a genuinely empty report', () => {
    const empty = { mode: 'fast' as const, chapterContent: chapter, ...citationInput }
    expect(parseConsistencyAuditResult({ ...empty, raw: '{"findings":[]}' })?.findings).toEqual([])
    expect(parseConsistencyAuditResult({ ...empty, raw: JSON.stringify({ findings: [{
      category: '待核对', severity: 'hard', quote: '从左袖取出了青铜铃', evidence: [], reason: '缺少可核对来源。',
    }] }) })?.findings[0].severity).toBe('unknown')
  })

  it('resolves closed paragraph IDs for both findings and chapter evidence without model-copied quotes', () => {
    const body = '开场剩余两枚。\n连续消耗两枚后，余额仍为两枚。'
    const result = parseConsistencyAuditResult({
      mode: 'fast', chapterContent: body, ...citationInput,
      raw: JSON.stringify({ findings: [{ category: '资源结算', severity: 'hard', anchorId: 'p2',
        evidence: [{ sourceType: 'chapter', sourceId: 0, anchorId: 'p1' }], reason: '消耗与余额需要核对。' }] }),
    })
    expect(result?.findings[0]).toMatchObject({ anchorId: 'p2', quote: '连续消耗两枚后，余额仍为两枚。', evidence: [{ anchorId: 'p1', quote: '开场剩余两枚。' }] })
  })

  it('rejects invalid IDs even with valid fallback quotes and cannot relabel chapter spans as external evidence', () => {
    const finding = { category: '持有物', severity: 'risk', anchorId: 'p900', quote: chapter, evidence: [], reason: '不可猜测编号。' }
    const parse = (value: unknown) => parseConsistencyAuditResult({ mode: 'fast', chapterContent: chapter, ...citationInput, raw: JSON.stringify({ findings: [value] }) })
    expect(parse(finding)).toBeNull()
    expect(parse({ ...finding, anchorId: 'p1', evidence: [{ sourceType: 'canon', sourceId: 7, anchorId: 'p1', quote: '消耗 青铜铃 ×1' }] })).toBeNull()
  })

  it('valid IDs always use original text; conflicting redundant quotations remain visible as uncertain advice', () => {
    const result = parseConsistencyAuditResult({ mode: 'fast', chapterContent: chapter, ...citationInput,
      raw: JSON.stringify({ findings: [{ category: '持有物', severity: 'hard', anchorId: 'p1', quote: '改抄的附注',
        evidence: [{ sourceType: 'chapter', sourceId: 0, anchorId: 'p1', quote: '另一条改抄附注' }], reason: '需作者核对。' }] }),
    })
    expect(result?.findings[0]).toMatchObject({ severity: 'unknown', citationWarning: true, quote: chapter, evidence: [{ quote: chapter }] })
  })

  it('builds distinct fast and deep audit contracts without truncating chapter prose', () => {
    const evidence = '【物品流水证据】\n[observation#7] 第1章：消耗 青铜铃 ×1（已交给守门人）'
    const longChapter = '正文'.repeat(5000)
    const fast = buildConsistencyAuditPrompt({
      mode: 'fast',
      chapterTitle: '测试',
      chapterContent: longChapter,
      evidenceContext: evidence,
      lifecycleCatalog: 'characterId=7 | 林飞 | status=dead',
    })
    const deep = buildConsistencyAuditPrompt({
      mode: 'deep',
      chapterTitle: '测试',
      chapterContent: longChapter,
      evidenceContext: evidence,
    })
    expect(fast.at(-1)?.content).toContain(longChapter)
    expect(fast[0].content).toContain('低误报')
    expect(fast[0].content).toContain('lifecycleReferences')
    expect(fast.at(-1)?.content).toContain('status=dead')
    expect(deep[0].content).toContain('因果链')
  })
})
