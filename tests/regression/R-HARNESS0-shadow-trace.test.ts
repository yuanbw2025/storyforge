import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRecentGenerationShadowTracesV1,
  listRecentGenerationShadowTracesV1,
} from '../../src/lib/agent/run/generation-shadow-trace'
import {
  prepareGenerationNode,
  runGenerationNode,
  type GenerationNode,
  type GenerationNodeShadowTrace,
} from '../../src/lib/generation/generation-node'
import {
  createOutlineGenerationShadowTraceV1,
  resolveOutlineGenerationSourceKeysV2,
} from '../../src/lib/outline/harness'
import type { AssembleContextResult } from '../../src/lib/registry/types'

function outlineAssembly(): AssembleContextResult {
  return {
    text: '【世界观】潮汐城市。',
    segments: [{
      label: '世界观',
      layer: 'L1',
      content: '【世界观】潮汐城市。',
      tokens: 9,
      trimmable: true,
    }],
    included: ['ragSelection'],
    omitted: resolveOutlineGenerationSourceKeysV2({ request: { kind: 'volumes' } })
      .filter(key => key !== 'ragSelection'),
    trimmed: [],
    totalInputTokens: 9,
    inputBudget: 8_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

describe('R-HARNESS0-shadow-trace · 真实 GenerationNode 影子记录', () => {
  beforeEach(() => clearRecentGenerationShadowTracesV1())

  it('大纲生成保持一次模型调用和原结果，同时留下无正文 trace', async () => {
    const run = vi.fn(async () => '第一卷：潮城迁徙')
    const node: GenerationNode<AssembleContextResult, string> = {
      id: 'outline.volume:batch',
      kind: 'outline.volume',
      editableInput: true,
      assembleInput: assembled => [{ role: 'user', content: assembled.text }],
      run,
    }
    const assembled = outlineAssembly()
    const shadowTrace = await createOutlineGenerationShadowTraceV1({
      projectId: 7,
      worldGroupId: null,
      request: { kind: 'volumes' },
      assembled,
    })

    const result = await runGenerationNode(node, prepareGenerationNode(node, assembled), { shadowTrace })

    expect(result.output).toBe('第一卷：潮城迁徙')
    expect(run).toHaveBeenCalledTimes(1)
    const projection = shadowTrace.projection()
    expect(projection).toMatchObject({
      state: 'running',
      steps: { 'outline.volume:batch': { status: 'succeeded', attempt: 1 } },
    })
    expect(projection.terminalReceiptHash).toBeUndefined()
    expect(shadowTrace.events.map(item => item.type)).toEqual([
      'run.created',
      'contract.accepted',
      'step.scheduled',
      'step.started',
      'context.assembled',
      'model.requested',
      'model.responded',
      'step.succeeded',
    ])
    expect(JSON.stringify(shadowTrace.events)).not.toContain('潮汐城市')
    expect(listRecentGenerationShadowTracesV1()).toHaveLength(1)
  })

  it('影子记录器自身失败不能改变生成、gate 或采纳结果', async () => {
    const traceErrors: unknown[] = []
    const throwingTrace: GenerationNodeShadowTrace = {
      beforeModel: async () => { throw new Error('trace-before-failed') },
      modelResponded: async () => { throw new Error('trace-response-failed') },
      stepSucceeded: async () => { throw new Error('trace-success-failed') },
      stepFailed: async () => { throw new Error('trace-failure-failed') },
      onTraceError: error => { traceErrors.push(error) },
    }
    const run = vi.fn(async () => '候选')
    const adopt = vi.fn(async () => '已采纳')
    const node: GenerationNode<string, string, string> = {
      id: 'test.shadow-isolation',
      kind: 'test',
      editableInput: false,
      assembleInput: value => [{ role: 'user', content: value }],
      run,
      gate: () => ({ status: 'pass', issues: [] }),
      adopt,
    }

    const result = await runGenerationNode(node, prepareGenerationNode(node, '输入'), {
      adopt: true,
      shadowTrace: throwingTrace,
    })

    expect(result).toMatchObject({ output: '候选', adopted: true, adoption: '已采纳' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(adopt).toHaveBeenCalledTimes(1)
    expect(traceErrors).toHaveLength(3)
  })

  it('模型失败保留失败步骤证据并继续抛出原错误', async () => {
    const node: GenerationNode<AssembleContextResult, string> = {
      id: 'outline.volume:batch',
      kind: 'outline.volume',
      editableInput: true,
      assembleInput: assembled => [{ role: 'user', content: assembled.text }],
      run: async () => { throw new Error('provider unavailable') },
    }
    const assembled = outlineAssembly()
    const shadowTrace = await createOutlineGenerationShadowTraceV1({
      projectId: 7,
      worldGroupId: null,
      request: { kind: 'volumes' },
      assembled,
    })

    await expect(runGenerationNode(node, prepareGenerationNode(node, assembled), { shadowTrace }))
      .rejects.toThrow('provider unavailable')
    expect(shadowTrace.projection().steps['outline.volume:batch']).toMatchObject({
      status: 'failed',
      failureCode: 'generation_model_failed',
    })
  })
})
