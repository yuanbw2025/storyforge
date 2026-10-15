import { createServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createReadStream, realpathSync } from 'node:fs'
import { stat, realpath } from 'node:fs/promises'
import { resolve, dirname, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { providerProxies } from './proxies.mjs'
import { localCodexPlugin } from '../local-codex/bridge.mjs'
import { readLauncherFailure, recordLauncherFailure, beginLauncherSession, monitorLauncherFailures } from './diagnostics.mjs'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.pdf': 'application/pdf', '.mp4': 'video/mp4' }
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
function finish(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(text)
}
export function createPortableServer({ webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../web'), proxies = providerProxies, requestProvider = httpsRequest, readDiagnostics = readLauncherFailure } = {}) {
  const middleware = []
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => { if (!res.headersSent) finish(res, 500, 'Local service error.'); else res.destroy() })
  })
  // Reuse the governed, lazy Codex bridge; never create a second AI transport.
  localCodexPlugin().configureServer({ middlewares: { use: fn => middleware.push(fn) }, httpServer: server })
  const root = resolve(webRoot)
  async function handle(req, res) {
    let url
    try { url = new URL(req.url, `http://${req.headers.host}`) } catch { return finish(res, 400, 'Invalid URL.') }
    if (!LOOPBACK.has(req.socket.remoteAddress) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return finish(res, 403, 'Localhost only.')
    if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return finish(res, 403, 'Same-origin only.')
    if (url.pathname === '/storyforge/local-diagnostics/launcher') {
      if (req.method !== 'GET') return finish(res, 405, 'Method not allowed.')
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(readDiagnostics()))
      return
    }
    if (url.pathname.startsWith('/storyforge/local-codex/')) return middleware[0](req, res, () => finish(res, 404, 'Unknown bridge route.'))
    const route = Object.keys(proxies).find(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
    if (route) {
      if (!['GET', 'POST', 'OPTIONS'].includes(req.method)) return finish(res, 405, 'Method not allowed.')
      const proxy = proxies[route]
      const rewritten = proxy.rewrite(url.pathname + url.search)
      if (!rewritten.startsWith('/') || rewritten.startsWith('//')) return finish(res, 400, 'Invalid provider path.')
      const target = new URL(proxy.target)
      const headers = {}
      for (const key of ['authorization', 'content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'x-api-key', 'x-goog-api-key']) if (req.headers[key]) headers[key] = req.headers[key]
      // Fixed upstream, verified TLS, streaming bodies; no arbitrary URL proxy or credential logging.
      const upstream = requestProvider({ hostname: target.hostname, port: 443, path: rewritten, method: req.method, headers }, response => {
        res.writeHead(response.statusCode || 502, { 'Content-Type': response.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        response.pipe(res)
        response.on('error', () => res.destroy())
      })
      upstream.setTimeout(600_000, () => upstream.destroy())
      upstream.on('error', () => { if (!res.headersSent) finish(res, 502, 'Provider connection failed.'); else res.destroy() })
      res.on('close', () => { if (!res.writableFinished) upstream.destroy() })
      req.pipe(upstream)
      return
    }
    if (!['GET', 'HEAD'].includes(req.method)) return finish(res, 405, 'Method not allowed.')
    if (url.pathname === '/' || url.pathname === '/storyforge') { res.writeHead(302, { Location: '/storyforge/' }); res.end(); return }
    if (!url.pathname.startsWith('/storyforge/')) return finish(res, 404, 'Not found.')
    let relative
    try { relative = decodeURIComponent(url.pathname.slice('/storyforge/'.length)) } catch { return finish(res, 400, 'Invalid path.') }
    if (relative.includes('\\') || relative.includes('\0')) return finish(res, 400, 'Invalid path.')
    let file = resolve(root, relative || 'index.html')
    if (!file.startsWith(root + sep)) return finish(res, 403, 'Invalid path.')
    let info
    try { info = await stat(file); if (!info.isFile()) throw new Error() } catch {
      if (extname(relative)) return finish(res, 404, 'Not found.')
      file = resolve(root, 'index.html'); info = await stat(file)
    }
    if (!(await realpath(file)).startsWith((await realpath(root)) + sep)) return finish(res, 403, 'Invalid path.')
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
    if (req.method === 'HEAD') { res.end(); return }
    const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res)
  }
  return server
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  monitorLauncherFailures()
  const server = createPortableServer()
  server.on('error', error => { recordLauncherFailure(error); console.error(error.code === 'EADDRINUSE' ? 'Port 1111 is already in use. Close the previous StoryForge window/service and try again. The port will not change, preserving browser storage.' : 'Unable to start the local service.'); process.exitCode = 1 })
  let endSession = () => {}
  server.listen(1111, '127.0.0.1', () => {
    endSession = beginLauncherSession()
    const url = 'http://localhost:1111/storyforge/'
    console.log(`StoryForge: ${url}\nKeep this window open. Press Ctrl+C to stop.\nYour works remain in this browser; export a backup before switching browser or address.`)
    if (!process.argv.includes('--no-open')) {
      const command = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
      const child = spawn(command, args, { stdio: 'ignore', detached: true }); child.on('error', () => console.log('Open the address above in your browser.')); child.unref()
    }
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {
    endSession()
    server.close()
    server.closeAllConnections() // Closing an active stream must also cancel its provider request.
  })
  process.on('exit', () => { if (!process.exitCode) endSession() })
}
