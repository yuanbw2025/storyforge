import { describe, expect, it } from 'vitest'
import {
  CUSTOM_PROXY_PREFIX,
  fromCustomProxyBaseUrl,
  isCustomProxyBaseUrl,
  parseCustomProxyPath,
  toCustomProxyBaseUrl,
} from '../../src/lib/ai/custom-proxy'
import { buildOpenAIEndpoint } from '../../src/lib/ai/openai-endpoint'

describe('R-custom-proxy-local · 自定义网关本地代理', () => {
  it('直连 Base URL 与本地代理路径可往返', () => {
    const direct = 'https://api.example.com/v1'
    const proxy = toCustomProxyBaseUrl(direct)
    expect(proxy).toBe('/custom-proxy/https/api.example.com/v1')
    expect(isCustomProxyBaseUrl(proxy)).toBe(true)
    expect(fromCustomProxyBaseUrl(proxy)).toBe(direct)
  })

  it('已是代理路径时 toCustomProxyBaseUrl 幂等', () => {
    const proxy = '/custom-proxy/https/api.example.com/v1'
    expect(toCustomProxyBaseUrl(proxy)).toBe(proxy)
  })

  it('非法 / 相对路径不硬改', () => {
    expect(toCustomProxyBaseUrl('/deepseek-proxy/v1')).toBe('/deepseek-proxy/v1')
    expect(toCustomProxyBaseUrl('not-a-url')).toBe('not-a-url')
  })

  it('proxy Base URL 拼出正确 chat/completions 路径', () => {
    const proxyBase = toCustomProxyBaseUrl('https://api.example.com/v1')
    expect(buildOpenAIEndpoint(proxyBase, 'chat/completions')).toBe(
      '/custom-proxy/https/api.example.com/v1/chat/completions',
    )
  })

  it('parseCustomProxyPath 解析上游 origin 与 path', () => {
    const parsed = parseCustomProxyPath(
      `${CUSTOM_PROXY_PREFIX}/https/api.example.com/v1/chat/completions`,
    )
    expect(parsed).toEqual({
      targetOrigin: 'https://api.example.com',
      upstreamPath: '/v1/chat/completions',
    })
  })

  it('parseCustomProxyPath 保留 query', () => {
    const parsed = parseCustomProxyPath(
      '/custom-proxy/http/localhost:11434/v1/models?foo=1',
    )
    expect(parsed).toEqual({
      targetOrigin: 'http://localhost:11434',
      upstreamPath: '/v1/models?foo=1',
    })
  })
})
