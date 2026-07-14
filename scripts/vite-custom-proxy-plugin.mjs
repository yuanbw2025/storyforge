/**
 * Vite 开发插件：/custom-proxy/{http|https}/{host}{path}
 * 动态转发到任意 OpenAI 兼容上游，绕过浏览器 CORS。
 * 仅 dev server 有效。
 *
 * 解析规则与 src/lib/ai/custom-proxy.ts 保持一致（此处内联，避免 .mjs 直接 import .ts）。
 */
import http from 'node:http'
import https from 'node:https'

const CUSTOM_PROXY_PREFIX = '/custom-proxy'

/**
 * @param {string} requestPath
 * @returns {{ targetOrigin: string, upstreamPath: string } | null}
 */
function parseCustomProxyPath(requestPath) {
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
  let upstreamPath = `${match[3] || '/'}${query}`
  if (!upstreamPath.startsWith('/')) upstreamPath = `/${upstreamPath}`

  return {
    targetOrigin: `${protocol}://${host}`,
    upstreamPath,
  }
}

/**
 * @returns {import('vite').Plugin}
 */
export function customProxyPlugin() {
  return {
    name: 'storyforge-custom-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith(CUSTOM_PROXY_PREFIX)) {
          next()
          return
        }

        const parsed = parseCustomProxyPath(url)
        if (!parsed) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(
            'Invalid custom-proxy path. Expected /custom-proxy/https/host/v1/...',
          )
          return
        }

        const targetUrl = new URL(parsed.upstreamPath, parsed.targetOrigin)
        const isHttps = targetUrl.protocol === 'https:'
        const lib = isHttps ? https : http

        /** @type {import('node:http').OutgoingHttpHeaders} */
        const headers = { ...req.headers }
        headers.host = targetUrl.host
        delete headers.origin
        delete headers.referer
        delete headers.connection

        const proxyReq = lib.request(
          {
            protocol: targetUrl.protocol,
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            path: `${targetUrl.pathname}${targetUrl.search}`,
            method: req.method,
            headers,
            timeout: 120_000,
          },
          (proxyRes) => {
            res.statusCode = proxyRes.statusCode || 502
            for (const [key, value] of Object.entries(proxyRes.headers)) {
              if (value === undefined) continue
              const lk = key.toLowerCase()
              if (lk === 'transfer-encoding' || lk === 'connection') continue
              res.setHeader(key, value)
            }
            proxyRes.pipe(res)
          },
        )

        proxyReq.on('timeout', () => {
          proxyReq.destroy()
          if (!res.headersSent) {
            res.statusCode = 504
            res.end('Upstream timeout')
          }
        })

        proxyReq.on('error', (err) => {
          console.error('[custom-proxy]', targetUrl.href, err.message)
          if (!res.headersSent) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(`custom-proxy upstream error: ${err.message}`)
          } else {
            res.end()
          }
        })

        req.pipe(proxyReq)
      })
    },
  }
}
