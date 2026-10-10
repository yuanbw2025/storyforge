import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { CodexRuntime } from './runtime.mjs'

export const PREFIX = '/storyforge/local-codex/v1'
const UUID = /^[a-f0-9-]{36}$/i
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'unknown'])
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export function allowedRequest(req) {
  try {
    const url = new URL(`http://${req.headers.host}`)
    return LOOPBACK.has(req.socket.remoteAddress)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && req.headers['x-storyforge-codex'] === '1'
      && (!req.headers.origin || req.headers.origin === `${req.socket.encrypted ? 'https' : 'http'}://${url.host}`)
      && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin')
  } catch { return false }
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}
async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error('仅接受 JSON 请求。')
  let length = 0; const chunks = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > 2 * 1024 * 1024) throw new Error('请求超过 2 MiB 限制。')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function validateInput(input) {
  if (!input || !UUID.test(input.id) || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200
    || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 500
    || input.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')
    || (input.outputSchema != null && (typeof input.outputSchema !== 'object' || Array.isArray(input.outputSchema)))
    || (input.responseFormat != null && input.responseFormat !== 'json_object')
    || Object.keys(input).some(k => !['id', 'model', 'messages', 'outputSchema', 'responseFormat'].includes(k))) throw new Error('无效的 Codex 文本请求。')
  return input
}

/** Private transport receipts only; never a second Work/Canon database. */
export function createBridge({ runtime = new CodexRuntime(), journalDir = join(homedir(), '.storyforge', 'codex', createHash('sha256').update(resolve('.')).digest('hex').slice(0, 16)) } = {}) {
  let records = new Map(); const active = new Map(); const queue = []; let working = false; let storageFailed = false
  mkdirSync(journalDir, { recursive: true, mode: 0o700 })
  let closed = false
  const lockFile = join(journalDir, 'owner.pid')
  try {
    const pid = Number(readFileSync(lockFile, 'utf8'))
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Codex 记录锁无法识别。')
    try { process.kill(pid, 0); throw new Error('已有 StoryForge 服务使用此 Codex 记录目录。请停止另一服务。') }
    catch (error) { if (error.code === 'ESRCH') unlinkSync(lockFile); else throw error }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const lock = openSync(lockFile, 'wx', 0o600); writeFileSync(lock, String(process.pid)); closeSync(lock)
  const file = join(journalDir, 'receipts.json')
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(saved) || saved.some(r => !r || !UUID.test(r.id) || !Number.isFinite(r.createdAt) || typeof r.text !== 'string') || new Set(saved.map(r => r.id)).size !== saved.length) throw new Error('Invalid receipt journal')
    records = new Map(saved.map(r => [r.id, {
      ...r, ...(!TERMINAL.has(r.status) ? { status: 'unknown', error: '服务重启，先前请求结果未知；不会自动重发。' } : {}),
    }]))
  } catch (error) { if (error.code !== 'ENOENT') { unlinkSync(lockFile); throw new Error('Codex 恢复记录无法读取；请保留文件并检查，避免重复生成。') } }
  function persist() {
    if (closed) return
    for (const [id, record] of records) if (TERMINAL.has(record.status) && Date.now() - record.createdAt > 24 * 3600_000) records.delete(id)
    while (records.size > 100) {
      const oldest = [...records.values()].find(r => TERMINAL.has(r.status))
      if (!oldest) break
      records.delete(oldest.id)
    }
    writeFileSync(`${file}.tmp`, JSON.stringify([...records.values()]), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }
  try { persist() } catch (error) { unlinkSync(lockFile); throw error }
  function pump() {
    if (closed || storageFailed || working || !queue.length) return
    const job = queue.shift()
    if (job.controller.signal.aborted) { active.delete(job.input.id); pump(); return }
    working = true
    void run(job.input, job.record, job.controller).finally(() => { working = false; pump() }).catch(() => {})
  }
  async function run(input, record, controller) {
    let savedAt = 0
    try {
      await runtime.generate(input, update => {
        if (TERMINAL.has(record.status)) return
        Object.assign(record, update)
        if (update.dispatched) record.status = 'running'
        if (Buffer.byteLength(record.text, 'utf8') > 2 * 1024 * 1024) { record.text = ''; controller.abort() }
        // Persist the dispatch boundary and final items, never prompts or credentials.
        if (update.dispatched || update.usage || Date.now() - savedAt >= 250) { persist(); savedAt = Date.now() }
      }, controller.signal)
      if (!record.text.trim()) throw new Error('Codex 返回空结果，未接受为成功生成。')
      if (!TERMINAL.has(record.status)) record.status = 'completed'
    } catch (error) {
      if (!TERMINAL.has(record.status)) {
        record.status = controller.signal.aborted ? 'cancelled' : record.dispatched ? 'unknown' : 'failed'
        record.error = error.message || 'Codex 请求失败。'
      }
    } finally {
      active.delete(input.id)
      try { persist() } catch { storageFailed = true; record.status = 'unknown'; record.error = '恢复记录保存失败；已阻止新请求，请检查本机磁盘。' }
    }
  }
  const middleware = async (req, res, next) => {
    const path = req.url?.split('?')[0]
    if (!path?.startsWith(PREFIX)) return next()
    if (!allowedRequest(req)) return send(res, 403, { error: 'Codex 仅允许本机同源页面访问。' })
    const route = path.slice(PREFIX.length)
    try {
      if (req.method === 'GET' && route === '/status') return send(res, 200, { ...await runtime.account(), version: runtime.version })
      if (req.method === 'GET' && route === '/models') return send(res, 200, { models: await runtime.models() })
      if (req.method === 'GET' && route === '/requests') { persist(); return send(res, 200, { records: [...records.values()].reverse().map(({ hash, ...r }) => r) }) }
      if (req.method === 'POST' && route === '/login') { await readBody(req); if (active.size) return send(res, 409, { error: '请先停止或完成现有请求，再切换 Codex 登录。' }); return send(res, 200, await runtime.login()) }
      if (req.method === 'POST' && route === '/disconnect') {
        await readBody(req)
        for (const [id, controller] of active) { const r = records.get(id); if (!TERMINAL.has(r.status)) { r.status = 'unknown'; r.error = '连接已断开；请检查记录后再决定是否重试。' }; controller.abort() }
        runtime.close(); persist(); return send(res, 200, { disconnected: true })
      }
      if (req.method === 'POST' && route === '/requests') {
        if (storageFailed) return send(res, 503, { error: '恢复记录保存失败，已停止接收请求。请检查磁盘并重启本地服务。' })
        const input = validateInput(await readBody(req))
        const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
        const existing = records.get(input.id)
        if (existing) return send(res, existing.hash === hash ? 200 : 409, existing.hash === hash ? { id: input.id } : { error: '请求编号已用于不同内容。' })
        if (active.size >= 32) return send(res, 409, { error: 'Codex 待处理请求已达 32 条。请等待或取消已有请求；不会自动重试。' })
        const record = { id: input.id, hash, model: input.model, createdAt: Date.now(), status: 'accepted', text: '', dispatched: false }
        records.set(input.id, record)
        try { persist() } catch { records.delete(input.id); storageFailed = true; throw new Error('无法保存请求记录，未发送模型请求。') }
        const controller = new AbortController(); active.set(input.id, controller)
        send(res, 202, { id: input.id })
        queue.push({ input, record, controller }); pump()
        return
      }
      const match = /^\/requests\/([a-f0-9-]{36})(\/cancel)?$/i.exec(route)
      if (match) {
        const record = records.get(match[1])
        if (!record) return send(res, 404, { error: '请求记录不存在或已超过保留期限。' })
        if (req.method === 'GET' && !match[2]) { const { hash, ...view } = record; return send(res, 200, view) }
        if (req.method === 'POST' && match[2]) {
          await readBody(req)
          active.get(record.id)?.abort()
          if (record.status === 'accepted') { record.status = 'cancelled'; record.error = '请求已取消。'; persist() }
          return send(res, 200, { requested: true })
        }
      }
      return send(res, 404, { error: '不支持的 Codex 操作。' })
    } catch (error) { if (!res.headersSent) send(res, 400, { error: error instanceof SyntaxError ? '无效的 JSON。' : error.message }) }
  }
  return { middleware, close() {
    if (closed) return
    for (const [id, c] of active) { const r = records.get(id); if (!TERMINAL.has(r.status)) { r.status = 'unknown'; r.error = '服务停止，未完成请求不会自动重发。' }; c.abort() }
    runtime.close(); persist(); closed = true; unlinkSync(lockFile)
  } }
}

export function localCodexPlugin() {
  const install = server => {
    // Lazy: API-only users and static builds never start Codex or create receipts.
    let bridge
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith(PREFIX)) return next()
      if (!allowedRequest(req)) return send(res, 403, { error: 'Codex 仅允许本机同源页面访问。' })
      try { bridge ||= createBridge(); void bridge.middleware(req, res, next) }
      catch { send(res, 503, { error: '无法启动 Codex 连接服务，请检查本机恢复记录目录的权限。' }) }
    })
    server.httpServer?.once('close', () => bridge?.close())
  }
  return { name: 'storyforge-local-codex', configureServer: install, configurePreviewServer: install }
}
