import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Reuse Codex's credential store; never read/copy its tokens or modify its config.
export const ISOLATION = {
  model_provider: 'storyforge-subscription', approval_policy: 'never', sandbox_mode: 'read-only',
  web_search: 'disabled', project_doc_max_bytes: 0,
  developer_instructions: '', mcp_servers: {}, plugins: {}, hooks: {},
  model_providers: { 'storyforge-subscription': { name: 'OpenAI', requires_openai_auth: true, wire_api: 'responses', request_max_retries: 0, stream_max_retries: 0 } },
  features: Object.fromEntries([
    'shell_tool', 'unified_exec', 'apps', 'plugins', 'remote_plugin', 'hooks', 'memories',
    'multi_agent', 'multi_agent_v2', 'code_mode', 'code_mode_host', 'browser_use',
    'browser_use_external', 'computer_use', 'image_generation', 'in_app_browser',
    'in_app_local_automation', 'workspace_dependencies', 'goals',
    'in_app_chat', 'in_app_voice', 'in_app_dictation', 'in_app_updates', 'realtime_conversation',
    'tool_suggest', 'sleep_tool', 'skill_search', 'skill_mcp_dependency_install', 'view_image',
    'daemon_auto_start', 'unbounded_connection_retries', 'worktrees', 'auth_elicitation',
    'enable_mcp_apps', 'request_permissions_tool', 'shell_snapshot', 'unified_exec_tty',
    'browser_use_full_cdp_access', 'browser_annotation_api', 'multi_agent_v2_dynamic_tools',
    'external_agent_memory_import', 'guardian_conversation_history_tools', 'tool_call_mcp_elicitation',
  ].map(key => [key, false])),
}
function toml(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
export class CodexRuntime {
  constructor({ executable = process.env.STORYFORGE_CODEX_BIN || 'codex', spawnProcess = spawn } = {}) {
    this.executable = executable; this.spawnProcess = spawnProcess
    this.pending = new Map(); this.listeners = new Set(); this.sequence = 0
  }
  async start() {
    if (this.starting) return this.starting
    this.starting = this.initialize().catch(error => { this.close(); throw error })
    return this.starting
  }
  async initialize(disabledServers = {}) {
    this.cwd = mkdtempSync(join(tmpdir(), 'storyforge-codex-'))
    const overrides = Object.entries({ ...ISOLATION, ...disabledServers }).flatMap(([k, v]) => ['-c', `${k}=${toml(v)}`])
    const env = { ...process.env }
    // Do not inherit a paid API override or a parent chat's execution identity.
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'CODEX_THREAD_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'OPENAI_BASE_URL']) delete env[key]
    this.child = this.spawnProcess(this.executable, ['app-server', '--listen', 'stdio://', ...overrides], {
      cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    this.child.stdin.on('error', () => {})
    this.child.stderr.on('data', () => {}) // Codex diagnostics can contain local paths or secrets.
    const child = this.child
    this.child.on('error', () => child === this.child && this.fail(new Error('未能启动 Codex。请安装 Codex CLI，或设置 STORYFORGE_CODEX_BIN 为可执行文件路径。')))
    this.child.on('exit', () => child === this.child && this.fail(new Error('Codex 服务已退出；在途请求结果未知，请检查记录后再重试。')))
    this.lines = createInterface({ input: this.child.stdout })
    this.lines.on('line', line => {
      let message
      try { message = JSON.parse(line) } catch { return }
      if (message.id != null && !message.method) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer); this.pending.delete(message.id)
        if (message.error) pending.reject(new Error('Codex 协议请求失败，请检查版本、登录或模型权限。'))
        else pending.resolve(message.result)
      } else if (message.id != null) {
        // No tool/approval or filesystem RPC is ever granted by the bridge.
        this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'StoryForge text provider forbids tool execution' } }) + '\n')
        for (const listener of this.listeners) listener({ method: 'bridge/forbiddenTool', params: message.params })
      } else {
        for (const listener of this.listeners) listener(message)
      }
    })
    const initialized = await this.rpc('initialize', { clientInfo: { name: 'storyforge', title: 'StoryForge', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    const version = /^storyforge\/(\d+)\.(\d+)\.(\d+)([^ ]*)/.exec(initialized.userAgent || '')
    if (!version || (Number(version[1]) === 0 && Number(version[2]) < 162)) throw new Error('Codex CLI 版本不支持已验证的隔离协议；请升级到 0.162.0 或更高版本。')
    this.version = `Codex ${version[1]}.${version[2]}.${version[3]}${version[4]}`
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
    const { config } = await this.rpc('config/read', { includeLayers: false })
    const activeServers = Object.entries(config.mcp_servers || {}).filter(([, server]) => server.enabled !== false)
    if (activeServers.some(([name]) => !/^[a-zA-Z0-9_-]+$/.test(name))) throw new Error('Codex MCP 配置名称无法安全隔离。')
    if (activeServers.length && !Object.keys(disabledServers).length) {
      this.child = null; this.lines.close(); child.kill()
      rmSync(this.cwd, { recursive: true, force: true })
      return this.initialize(Object.fromEntries(activeServers.map(([name]) => [`mcp_servers.${name}.enabled`, false])))
    }
    // Overrides must take effect before any model request. Never weaken admin policy.
    if (config.model_provider !== 'storyforge-subscription' || config.web_search !== 'disabled'
      || activeServers.length
      || ['base_url', 'env_key', 'experimental_bearer_token', 'http_headers', 'env_http_headers', 'query_params', 'auth'].some(key => config.model_providers?.['storyforge-subscription']?.[key] != null)
      || config.model_providers?.['storyforge-subscription']?.request_max_retries !== 0 || config.model_providers?.['storyforge-subscription']?.stream_max_retries !== 0
      || Object.entries(ISOLATION.features).some(([key]) => config.features?.[key] !== false)) {
      throw new Error('当前 Codex 配置无法隔离为文本提供商；已阻止生成。请检查版本与受管理配置。')
    }
    const skills = await this.rpc('skills/list', { cwds: [this.cwd] })
    this.disabledSkills = (skills.data || []).flatMap(entry => (entry.skills || []).map(skill => ({ path: skill.path, enabled: false })))
  }
  rpc(method, params, timeout = 30_000) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error('Codex 连接已停止。'))
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 请求超时；请检查服务状态。')) }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Codex 连接已断开。')) }
      })
    })
  }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  fail(error) {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error) }
    this.pending.clear()
    for (const listener of this.listeners) listener({ method: 'bridge/disconnected', params: {} })
    this.starting = null
  }
  async account() {
    await this.start()
    const { account } = await this.rpc('account/read', { refreshToken: false })
    if (!account) return { state: 'login-required' }
    if (account.type !== 'chatgpt') return { state: 'wrong-auth', message: '当前 Codex 未使用 ChatGPT 登录；不会使用 API Key 或其他提供商代替。' }
    return { state: 'ready', label: account.email ? account.email.replace(/^(.{1,2}).*(@.*)$/, '$1***$2') : 'ChatGPT 账号', plan: account.planType }
  }
  async models() {
    if ((await this.account()).state !== 'ready') throw new Error('请先在本机 Codex 中使用 ChatGPT 登录。')
    const models = []; let cursor = null
    for (let page = 0; page < 10; page++) {
      const result = await this.rpc('model/list', { limit: 100, cursor, includeHidden: false })
      models.push(...result.data.filter(model => !model.hidden).map(model => ({ id: model.model, label: model.displayName, isDefault: model.isDefault })))
      cursor = result.nextCursor
      if (!cursor) return models
    }
    throw new Error('Codex 模型目录过大，请升级连接服务。')
  }
  async login() {
    await this.start()
    const result = await this.rpc('account/login/start', { type: 'chatgpt' })
    const url = new URL(result.authUrl)
    if (url.protocol !== 'https:' || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].includes(url.hostname)) throw new Error('Codex 返回了不受支持的登录地址。')
    return { url: url.href }
  }
  async generate(input, notify, signal) {
    if ((await this.account()).state !== 'ready') throw new Error('Codex 登录不可用。请检查本机 ChatGPT 登录；不会切换付费 API。')
    if (!(await this.models()).some(model => model.id === input.model)) throw new Error('当前 Codex 模型目录没有所选模型，请刷新模型并重新选择。')
    let threadId; let turnId; let unsubscribe = () => {}; let timer
    try {
      const started = await this.rpc('thread/start', {
        model: input.model, modelProvider: 'storyforge-subscription', allowProviderModelFallback: false,
        cwd: this.cwd, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
        environments: [], selectedCapabilityRoots: [], dynamicTools: [],
        config: { ...ISOLATION, 'skills.config': this.disabledSkills },
        baseInstructions: 'You are the text generation component of StoryForge. Produce only the requested creative or structured output. Use only the supplied context. Do not use tools, files, shell, search, skills, or external memories.',
        developerInstructions: [
          ...input.messages.filter(m => m.role === 'system').map(m => m.content),
          ...(input.responseFormat === 'json_object' ? ['Return exactly one valid JSON object, without Markdown fences or surrounding prose.'] : []),
        ].join('\n\n'),
      })
      threadId = started.thread.id
      if (started.model !== input.model || started.modelProvider !== 'storyforge-subscription' || !Array.isArray(started.instructionSources) || started.instructionSources.length) throw new Error('Codex 模型或上下文隔离检查失败；已停止生成。')
      if (signal.aborted) throw new Error('请求已取消。')
      const completion = new Promise((resolve, reject) => {
        const abort = (reason = '请求已取消；未完成内容不会成为正式候选。') => {
          if (turnId) void this.rpc('turn/interrupt', { threadId, turnId }).catch(() => {})
          reject(new Error(typeof reason === 'string' ? reason : '请求已取消；未完成内容不会成为正式候选。'))
        }
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => abort('Codex 生成超过 20 分钟，已停止。'), 20 * 60_000)
        const messages = new Map()
        const finalItems = new Set()
        const off = this.onEvent(({ method, params: p }) => {
          try {
            if (method === 'bridge/disconnected') return reject(new Error('Codex 已断开，在途请求结果未知。'))
            if (method === 'bridge/forbiddenTool') return abort('Codex 请求了不允许的工具；本次结果已被阻止。')
            if (p?.threadId !== threadId) return
            if (method === 'turn/started') turnId = p.turn.id
            if (method === 'item/started' && !['userMessage', 'agentMessage', 'reasoning'].includes(p.item.type)) {
              return abort('Codex 尝试执行文本生成范围外的工具；已阻止本次结果。')
            }
            if (method === 'item/started' && p.item.type === 'agentMessage' && p.item.phase === 'final_answer') { finalItems.add(p.item.id); messages.set(p.item.id, '') }
            if (method === 'item/agentMessage/delta' && finalItems.has(p.itemId)) {
              messages.set(p.itemId, (messages.get(p.itemId) || '') + p.delta)
              notify({ text: [...messages.values()].join('\n') })
            }
            if (method === 'item/completed' && p.item.type === 'agentMessage' && p.item.phase !== 'commentary') {
              messages.set(p.item.id, p.item.text)
              notify({ text: [...messages.values()].join('\n') })
            }
            if (method === 'thread/tokenUsage/updated') notify({ usage: p.tokenUsage.last })
            if (method === 'turn/completed') {
              if (p.turn.status === 'completed') resolve()
              else reject(new Error('Codex 未成功完成本次生成，请检查登录、套餐额度及模型权限。'))
            }
          } catch { abort('Codex 返回或恢复记录处理失败，已停止本次请求。') }
        })
        unsubscribe = () => { off(); signal.removeEventListener('abort', abort) }
      })
      // Attach a rejection handler before awaiting turn/start to avoid an abort race.
      completion.catch(() => {})
      if ((await this.account()).state !== 'ready') throw new Error('Codex 登录状态已改变，已阻止发送。')
      if (signal.aborted) throw new Error('请求已取消。')
      notify({ dispatched: true })
      const turn = await this.rpc('turn/start', {
        threadId, input: [{ type: 'text', text: JSON.stringify(input.messages.filter(m => m.role !== 'system')), text_elements: [] }],
        model: input.model, effort: 'medium', environments: [],
        ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
      })
      turnId = turn.turn.id
      if (signal.aborted) { void this.rpc('turn/interrupt', { threadId, turnId }).catch(() => {}); throw new Error('请求已取消。') }
      await completion
    } finally {
      clearTimeout(timer); unsubscribe()
      if (threadId) void this.rpc('thread/unsubscribe', { threadId }).catch(() => {})
    }
  }
  close() {
    const child = this.child; this.child = null
    this.lines?.close(); child?.kill(); this.fail(new Error('Codex 连接已停止。'))
    if (this.cwd) { rmSync(this.cwd, { recursive: true, force: true }); this.cwd = null }
  }
}
