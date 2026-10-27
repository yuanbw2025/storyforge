// Same-origin loopback transport. No author paths, API key, CORS relaxation,
// automatic launch-on-read, inference retry, or adopted media is exposed.
import { createProductVoiceJobs } from './product-jobs.mjs'
import { digest, stable } from './product-contract.mjs'
import { previewLocalReading, validateReadingInput, verifyReadingPreview } from './reading-preview.mjs'
export const PREFIX = '/storyforge/local-tts/v1'
export function allowedProductVoiceRequest(req) {
  try {
    const url = new URL(`http://${req.headers.host}`)
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && req.headers['x-storyforge-tts'] === '1'
      && (!req.headers.origin || req.headers.origin === `${req.socket.encrypted ? 'https' : 'http'}://${url.host}`)
      && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
  } catch { return false }
}
function send(res, code, data) { if (res.destroyed || res.writableEnded) return; res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)) }
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error('JSON required')
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('Bounded job input exceeded'); chunks.push(chunk) }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)))
}
export function createProductVoiceBridge(runtimeDir, options = {}) {
  const jobs = createProductVoiceJobs(runtimeDir, options)
  let preview = null, closed = false
  async function middleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith(PREFIX)) return next()
    if (!allowedProductVoiceRequest(req)) return send(res, 403, { error: 'local-origin-required' })
    try {
      if (closed) return send(res, 409, { error: 'local-service-closed' })
      if (req.method === 'GET' && url.pathname === PREFIX + '/profile') {
        if ([...url.searchParams.keys()].some(k => k !== 'profileId') || url.searchParams.getAll('profileId').length > 1) throw new Error('Closed profile selection required')
        const selected = jobs.profiles().find(p => p.profileId === (url.searchParams.get('profileId') ?? 'melo-zh-product-v2'))
        if (!selected) return send(res, 409, { error: 'selected-local-voice-unavailable', automaticRetryAllowed: false })
        return send(res, 200, { kind: 'local-offline-speech-v1', profileHash: digest(stable(selected)), profile: selected })
      }
      if (req.method === 'POST' && url.pathname === PREFIX + '/reading-preview') {
        if (preview) return send(res, 409, { error: 'reading-preview-busy', automaticRetryAllowed: false })
        const value = await body(req)
        if (Object.keys(value).sort().join(',') !== 'decision,input' || value.decision !== 'preview-this-original-voice-reading') throw new Error('Explicit reading preview required')
        validateReadingInput(value.input)
        if (preview || closed || req.aborted || res.destroyed || res.writableEnded) throw new Error('Reading preview slot changed or request closed')
        const controller = new AbortController(), abort = () => controller.abort()
        preview = controller; res.once('close', abort)
        try {
          const result = await (options.previewReading ?? previewLocalReading)(runtimeDir, value.input, { signal: controller.signal })
          if (controller.signal.aborted || closed) throw new Error('Reading preview cancelled')
          return send(res, 200, verifyReadingPreview(result, value.input))
        } finally { res.removeListener('close', abort); if (preview === controller) preview = null }
      }
      if (req.method === 'POST' && url.pathname === PREFIX + '/jobs') return send(res, 200, jobs.create(await body(req)))
      const match = url.pathname.slice(PREFIX.length).match(/^\/jobs\/([^/]+)(?:\/(start|cancel|raw|lease|recover-raw))?$/)
      if (!match) return send(res, 404, { error: 'not-found' })
      const jobKey = decodeURIComponent(match[1]), action = match[2]
      if (req.method === 'GET' && !action) return send(res, 200, jobs.get(jobKey))
      if (req.method === 'GET' && action === 'raw') return send(res, 200, jobs.raw(jobKey))
      if (req.method === 'POST' && action === 'recover-raw') { const value = await body(req); if (Object.keys(value).sort().join(',') !== 'decision,inputArtifactHash' || value.decision !== 'recover-original-complete-raw-without-resending') throw new Error('Explicit original evidence recovery required'); return send(res, 200, jobs.recoverRaw(jobKey, value.inputArtifactHash)) }
      if (req.method === 'POST' && action === 'start') { const value = await body(req); if (Object.keys(value).join(',') !== 'inputArtifactHash') throw new Error('Exact start identity required'); return send(res, 200, jobs.start(jobKey, value.inputArtifactHash)) }
      if (req.method === 'POST' && action === 'lease') { const value = await body(req); if (Object.keys(value).join(',') !== 'inputArtifactHash') throw new Error('Exact lease identity required'); return send(res, 200, jobs.renew(jobKey, value.inputArtifactHash)) }
      if (req.method === 'POST' && action === 'cancel') { const value = await body(req); if (Object.keys(value).join(',') !== 'decision' || value.decision !== 'request-stop-original-local-voice-job') throw new Error('Explicit original stop required'); return send(res, 200, jobs.cancel(jobKey)) }
      return send(res, 405, { error: 'method-not-allowed' })
    } catch { return send(res, 409, { error: 'original-local-voice-job-needs-review', automaticRetryAllowed: false }) }
  }
  return { middleware, close() { closed = true; preview?.abort(); jobs.close() } }
}
export function localTtsPlugin() {
  const install = server => {
    const runtime = process.env.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR
    if (!runtime) return
    const bridge = createProductVoiceBridge(runtime, { qwenRuntimeDir: process.env.STORYFORGE_TTRPG_QWEN_TTS_RUNTIME_DIR })
    server.middlewares.use(bridge.middleware)
    server.httpServer?.once('close', bridge.close)
  }
  return { name: 'storyforge-local-tts', configureServer: install, configurePreviewServer: install }
}
