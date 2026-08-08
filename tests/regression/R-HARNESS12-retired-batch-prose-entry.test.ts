import { describe, expect, it } from 'vitest'
import * as batchDetailRunner from '../../src/lib/ai/batch-detail-runner'

describe('R-HARNESS12 · 旧批量正文旁路收口', () => {
  it('保留可达的 durable 批量细纲入口，不再导出直接 chat 后写正文的旧入口', () => {
    expect(batchDetailRunner.batchGenerateDetails).toBeTypeOf('function')
    expect('batchGenerateChapters' in batchDetailRunner).toBe(false)
  })
})
