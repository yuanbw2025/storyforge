import { describe, expect, it, vi } from 'vitest'
import { fetchOpenAIModels } from '../../src/lib/ai/model-list'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('CF-20260702-11 · OpenAI-compatible 模型列表刷新', () => {
  it('标准化 Base URL，去重排序模型，并在无 Key 时不发送鉴权头', async () => {
    const fetchImpl = vi.fn(async () => response({
      data: [{ id: 'qwen3' }, { id: 'deepseek-r1' }, { id: 'qwen3' }, { id: '' }],
    }))

    const models = await fetchOpenAIModels({
      baseUrl: 'http://localhost:1234/v1/models',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(models).toEqual(['deepseek-r1', 'qwen3'])
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:1234/v1/models', expect.objectContaining({
      method: 'GET',
      headers: undefined,
    }))
  })

  it('有 Key 时沿用 Bearer 鉴权', async () => {
    const fetchImpl = vi.fn(async () => response({ data: [{ id: 'private-model' }] }))

    await fetchOpenAIModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer sk-test' },
    }))
  })

  it('拒绝非 OpenAI 格式响应并保留手动输入回退', async () => {
    const fetchImpl = vi.fn(async () => response({ models: ['wrong-shape'] }))

    await expect(fetchOpenAIModels({
      baseUrl: 'http://localhost:11434/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('模型列表响应格式无效')
  })
})

