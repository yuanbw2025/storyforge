import { describe, it, expect } from 'vitest'
import { selectReferenceMethods, spreadReferenceItems } from '../../src/lib/reference-analysis/context-selection'
import { mergeAnalysisResults } from '../../src/lib/reference-analysis/merge-analysis'
import { referenceChunkMessages } from '../../src/lib/reference-analysis/chunk-prompt'

describe('reference whole evidence selection', () => {
  it('reports the actual source character range rather than inventing chapter locations', () => {
    const messages = referenceChunkMessages({ runId: 1, ref: { title: '残页', type: 'story' } as any,
      depth: 'deep', maxTokens: 8192, totalChunks: 3,
      chunk: {index: 1, startChar: 1300, endChar: 1411, charCount: 111, text: '只有局部材料。'} })
    expect(messages[1].content).toContain('1300—1411')
    expect(messages[1].content).toContain('未标章节')
  })
  it('完整保留长分析及末段反证，不因固定2000预算跳过材料', () => {
    const evidence = '可用于互相信任的人物。'.repeat(40) + '反例：尚无共同经历时不能照搬。'
    const complete = selectReferenceMethods([evidence])
    expect(complete).toContain(evidence)
    const skipped = selectReferenceMethods([evidence.repeat(20), '短分析；仅适用已建立的关系。'])
    expect(skipped).toContain(evidence.repeat(20))
    expect(skipped).toContain('短分析；仅适用已建立的关系。')
    expect(skipped).toContain('2/2')
  })
  it('does not hide later counterevidence behind a similar opening in the report', () => {
    const prefix = '观察：人物选择受到资源约束。'.repeat(10)
    const rows = [0,1].map(chunkIndex => ({ referenceId: 1, analysisRunId: 1, chunkIndex, createdAt: 1,
      characterCraft: prefix + (chunkIndex ? '后段反例：他放弃了这种选择。' : '开篇暂时支持此解释。') }))
    const merged = mergeAnalysisResults(rows, false)
    const items = merged.dimensions.find(row => row.dimension === 'characterCraft')!.items
    expect(items).toHaveLength(2)
    expect(items[1].text).toContain('后段反例')
  })
  it('includes end and middle before repeated opening material without mutating input', () => {
    const rows = [0,1,2,3,4,5]
    expect(spreadReferenceItems(rows)).toEqual([0,5,3,1,2,4])
    expect(rows).toEqual([0,1,2,3,4,5])
  })
  it('没有旧来源长度上限，空来源仍为空', () => {
    expect(selectReferenceMethods(['长'.repeat(10000)])).toContain('长'.repeat(10000))
    expect(selectReferenceMethods([])).toBe('')
  })
})
