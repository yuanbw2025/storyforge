/**
 * 本地开发用：把任意 OpenAI 兼容 Base URL 编成同源路径，
 * 交给 Vite `/custom-proxy` 中间件转发，绕过浏览器 CORS。
 *
 * 例：https://api.example.com/v1 → /custom-proxy/https/api.example.com/v1
 * 仅 `npm run dev` 有效；生产静态部署没有该代理。
 */

export const CUSTOM_PROXY_PREFIX = '/custom-proxy'

export interface ParsedCustomProxyPath {
  /** 上游 origin，如 https://api.example.com */
  targetOrigin: string
  /** 转发给上游的 path+query，如 /v1/chat/completions */
  upstreamPath: string
}

/** 当前 Base URL 是否已是本地自定义代理路径 */
export function isCustomProxyBaseUrl(baseUrl: string): boolean {
  const raw = (baseUrl || '').trim()
  return raw === CUSTOM_PROXY_PREFIX || raw.startsWith(`${CUSTOM_PROXY_PREFIX}/`)
}

/**
 * 直连 Base URL → 本地代理 Base URL。
 * 非法 / 相对路径原样返回（无法代理）。
 */
export function toCustomProxyBaseUrl(directBaseUrl: string): string {
  const input = (directBaseUrl || '').trim().replace(/\/+$/, '')
  if (!input || isCustomProxyBaseUrl(input)) return input

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return input
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return input

  const protocol = url.protocol.replace(':', '')
  const path = url.pathname.replace(/\/+$/, '')
  return `${CUSTOM_PROXY_PREFIX}/${protocol}/${url.host}${path}`
}

/**
 * 本地代理 Base URL → 直连 Base URL。
 * 非代理路径原样返回。
 */
export function fromCustomProxyBaseUrl(proxyBaseUrl: string): string {
  const input = (proxyBaseUrl || '').trim().replace(/\/+$/, '')
  if (!isCustomProxyBaseUrl(input)) return input

  const rest = input.slice(CUSTOM_PROXY_PREFIX.length).replace(/^\//, '')
  const match = rest.match(/^(https?)\/([^/]+)(.*)$/i)
  if (!match) return input

  const protocol = match[1].toLowerCase()
  const host = match[2]
  const path = (match[3] || '').replace(/\/+$/, '')
  return `${protocol}://${host}${path}`
}

/**
 * 解析发往 Vite 的完整请求 path（含 /custom-proxy 前缀）。
 * 供 dev 中间件转发使用。
 */
export function parseCustomProxyPath(requestPath: string): ParsedCustomProxyPath | null {
  const raw = (requestPath || '').trim()
  if (!raw.startsWith(CUSTOM_PROXY_PREFIX)) return null

  const qIndex = raw.indexOf('?')
  const pathOnly = qIndex >= 0 ? raw.slice(0, qIndex) : raw
  const query = qIndex >= 0 ? raw.slice(qIndex) : ''

  const rest = pathOnly.slice(CUSTOM_PROXY_PREFIX.length).replace(/^\//, '')
  const match = rest.match(/^(https?)\/([^/]+)(.*)$/i)
  if (!match) return null

  const protocol = match[1].toLowerCase()
  const host = match[2]
  const upstreamPath = `${match[3] || '/'}${query}` || `/${query}`

  return {
    targetOrigin: `${protocol}://${host}`,
    upstreamPath: upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`,
  }
}
