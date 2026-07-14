import { describe, expect, it } from 'vitest'
import {
  buildOpenAIEndpoint,
  normalizeOpenAIBaseUrl,
} from '../../src/lib/ai/openai-endpoint'
import { AI_PROXY_ENDPOINTS } from '../../src/lib/ai/proxy-endpoints'

describe('R-CF20260702-ai-config-endpoint', () => {
  it('把常见误填端点修正为 OpenAI 兼容根路径', () => {
    expect(normalizeOpenAIBaseUrl('http://192.168.110.51:1234/v1/models').baseUrl)
      .toBe('http://192.168.110.51:1234/v1')
    expect(normalizeOpenAIBaseUrl('http://192.168.110.51:1234/v1/chat/completions').baseUrl)
      .toBe('http://192.168.110.51:1234/v1')
    expect(normalizeOpenAIBaseUrl('http://localhost:11434/v1/v1').baseUrl)
      .toBe('http://localhost:11434/v1')
  })

  it('实际请求 endpoint 不重复拼接 chat/completions', () => {
    expect(buildOpenAIEndpoint('http://x:1234/v1/chat/completions', 'chat/completions'))
      .toBe('http://x:1234/v1/chat/completions')
    expect(buildOpenAIEndpoint('http://x:1234/v1/models', 'chat/completions'))
      .toBe('http://x:1234/v1/chat/completions')
  })

  it('代理与直连端点由网络层单一配置维护', () => {
    expect(AI_PROXY_ENDPOINTS.deepseek).toEqual({
      proxy: '/deepseek-proxy/v1',
      direct: 'https://api.deepseek.com/v1',
    })
    expect(AI_PROXY_ENDPOINTS.longcat).toEqual({
      proxy: '/longcat-proxy/openai/v1',
      direct: 'https://api.longcat.chat/openai/v1',
    })
    expect(AI_PROXY_ENDPOINTS.opencode?.direct).toBe('https://opencode.ai/zen/go/v1')
  })
})
