import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProseGenerationRunContractV1 } from '../../src/lib/agent/run/prose-generation-durable'

describe('CREL-12 · 章节正文默认不追加隐藏语义调用', () => {
  it('默认 durable 合同只允许一次生成；显式语义评审能力可独立调用', () => {
    const base = {
      projectId: 1,
      worldGroupId: null,
      chapterId: 2,
      operation: 'generate' as const,
    }
    const defaultContract = buildProseGenerationRunContractV1(base)
    expect(defaultContract.budget.maxModelCalls).toBe(1)
    expect(defaultContract.acceptance.some(item => item.id === 'prose-generation.semantic-review')).toBe(false)
    expect(defaultContract.executionBindings).toHaveLength(1)
    expect(defaultContract.executionBindings?.[0]?.stepId).toBe('prose-generation')

    const explicitReviewContract = buildProseGenerationRunContractV1({ ...base, semanticReview: true })
    expect(explicitReviewContract.budget.maxModelCalls).toBe(4)
    expect(explicitReviewContract.acceptance.some(item => item.id === 'prose-generation.semantic-review')).toBe(true)
  })

  it('章节编辑器使用一次生成合同并明确告知作者评审需要显式触发', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/editor/ChapterEditor.tsx'),
      'utf8',
    )
    expect(source).toContain('semanticReview: false')
    expect(source).not.toContain('runDurableProseSemanticReviewV1')
    expect(source).toContain('本次正文只调用模型生成一次')
    expect(source).toContain('再由你从评审入口显式发起并确认费用')
  })
})
