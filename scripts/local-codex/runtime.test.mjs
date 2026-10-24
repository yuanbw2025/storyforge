import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { CodexRuntime, ISOLATION } from './runtime.mjs'

function fixture(t, { account = { type: 'chatgpt', email: 'test@example.com' }, config = ISOLATION, instructions = [], model = 'test', tool = false, version = '0.162.0', terminal = 'completed', foreignTerminal = false, disconnected = false, codexErrorInfo } = {}) {
  const calls = []; const spawned = []
  const runtime = new CodexRuntime({ spawnProcess: (executable, args, options) => {
    spawned.push({ executable, args, options })
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => { child.stdout.end() }
    const emit = message => child.stdout.write(JSON.stringify(message) + '\n')
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const m = JSON.parse(chunk.toString()); calls.push(m)
      if (!m.id || !m.method) { done(); return }
      const replies = {
        initialize: { userAgent: `storyforge/${version} (test)` }, 'config/read': { config }, 'skills/list': { data: [] },
        'account/read': { account }, 'model/list': { data: [{ model: 'test', displayName: 'Test', isDefault: true }] },
        'thread/start': { thread: { id: 'thread' }, model, modelProvider: 'storyforge-subscription', instructionSources: instructions },
        'turn/start': { turn: { id: 'turn' } },
      }
      emit({ id: m.id, result: replies[m.method] ?? {} }); done()
      if (m.method === 'turn/start') queueMicrotask(() => {
        emit({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } })
        if (foreignTerminal) {
          emit({ method: 'turn/completed', params: { threadId: 'other-thread', turn: { id: 'turn', status: 'failed' } } })
          emit({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'other-turn', status: 'failed' } } })
        }
        if (disconnected) { child.emit('exit'); return }
        if (tool) emit({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread' } })
        emit({ method: 'item/completed', params: { threadId: 'thread', item: { type: 'agentMessage', id: 'comment', phase: 'commentary', text: 'not author content' } } })
        emit({ method: 'item/completed', params: { threadId: 'thread', item: { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: '{"title":"候选"}' } } })
        emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', tokenUsage: { last: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } } })
        emit({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: terminal, error: { message: 'private provider diagnostic', additionalDetails: 'private input', codexErrorInfo } } } })
      })
    } })
    return child
  } })
  t.after(() => runtime.close())
  return { runtime, calls, spawned }
}
const input = { model: 'test', messages: [{ role: 'system', content: 'StoryForge context' }, { role: 'user', content: 'write' }], outputSchema: { type: 'object' } }

test('reuses native auth, isolates thread, disables tools/retries, preserves schema and final answer', async t => {
  const { runtime, calls, spawned } = fixture(t); const updates = []
  await runtime.generate(input, v => updates.push(v), new AbortController().signal)
  assert.equal(updates.find(v => v.text)?.text, '{"title":"候选"}')
  assert.equal(updates.find(v => v.usage)?.usage.totalTokens, 15)
  assert.deepEqual(updates.find(v => v.providerTurn)?.providerTurn, { threadId: 'thread', turnId: 'turn', status: 'completed' })
  assert.equal(calls.some(v => v.method === 'account/login/start'), false)
  const thread = calls.find(v => v.method === 'thread/start').params
  assert.equal(thread.ephemeral, true); assert.equal(thread.allowProviderModelFallback, false)
  assert.deepEqual(thread.environments, []); assert.equal(thread.config.web_search, 'disabled')
  assert.equal(thread.developerInstructions, 'StoryForge context')
  assert.deepEqual(calls.find(v => v.method === 'turn/start').params.outputSchema, input.outputSchema)
  assert.equal(spawned[0].options.env.OPENAI_API_KEY, undefined)
  assert.equal(thread.config.model_providers['storyforge-subscription'].stream_max_retries, 0)
  for (const key of ['skill_search', 'view_image', 'sleep_tool', 'unbounded_connection_retries', 'daemon_auto_start']) assert.equal(thread.config.features[key], false)
})
test('API-key or absent login cannot dispatch or fall back', async t => {
  for (const account of [null, { type: 'apiKey' }]) {
    const { runtime, calls } = fixture(t, { account })
    await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), /登录不可用/)
    assert.equal(calls.some(v => v.method === 'turn/start'), false)
  }
})
test('unknown model, inherited instructions and too-old protocol fail before generation', async t => {
  for (const options of [{ model: 'substituted' }, { instructions: [{ path: '/AGENTS.md' }] }, { version: '0.100.0' }]) {
    const { runtime, calls } = fixture(t, options)
    await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal))
    assert.equal(calls.some(v => v.method === 'turn/start'), false)
  }
})
test('unexpected approval/tool RPC is denied and cannot become successful output', async t => {
  const { runtime, calls } = fixture(t, { tool: true })
  await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), /工具/)
  assert.ok(calls.some(v => v.id === 900 && v.error.code === -32601))
})
test('managed policy that keeps tools enabled blocks inference', async t => {
  const { runtime, calls } = fixture(t, { config: { ...ISOLATION, features: { ...ISOLATION.features, shell_tool: true } } })
  await assert.rejects(runtime.generate(input, () => {}, new AbortController().signal), /隔离/)
  assert.equal(calls.some(v => v.method === 'turn/start'), false)
})
test('failed and interrupted turns carry only verified terminal identity, never raw diagnostics', async t => {
  for (const terminal of ['failed', 'interrupted']) {
    const { runtime, calls } = fixture(t, { terminal }); const updates = []
    const error = await runtime.generate(input, v => updates.push(v), new AbortController().signal).catch(e => e)
    assert.deepEqual(error.providerTurn, { threadId: 'thread', turnId: 'turn', status: terminal })
    assert.equal(`${error.message}${JSON.stringify(error)}${JSON.stringify(updates)}`.includes('private'), false)
    assert.equal(calls.filter(v => v.method === 'turn/start').length, 1)
  }
})
test('other thread/turn completion cannot terminate the active request', async t => {
  const { runtime } = fixture(t, { foreignTerminal: true }); const updates = []
  await runtime.generate(input, v => updates.push(v), new AbortController().signal)
  assert.equal(updates.find(v => v.providerTurn)?.providerTurn.status, 'completed')
})
test('disconnect and unrecognized completion remain unknown without terminal proof or replay', async t => {
  for (const options of [{ disconnected: true }, { terminal: 'unexpected' }]) {
    const { runtime, calls } = fixture(t, options)
    const error = await runtime.generate(input, () => {}, new AbortController().signal).catch(e => e)
    assert.equal(error.providerTurn, undefined)
    assert.match(error.message, /未知/)
    assert.equal(calls.filter(v => v.method === 'turn/start').length, 1)
  }
})

test('matched terminal failure exposes only allowlisted protocol types and bounded HTTP status', async t => {
  for (const [codexErrorInfo, expected] of [
    ['usageLimitExceeded', '使用额度已达上限；usageLimitExceeded'],
    ['badRequest', '请求参数未被提供商接受；badRequest'],
    [{httpConnectionFailed: {httpStatusCode: 429, private: 'private token'}}, '上游连接失败；httpConnectionFailed，HTTP 429'],
    [{responseStreamDisconnected: {httpStatusCode: 503}}, '回复流已断开；responseStreamDisconnected，HTTP 503'],
    [{responseStreamDisconnected: {httpStatusCode: 'private token'}}, '回复流已断开；responseStreamDisconnected'],
    [{httpConnectionFailed: {httpStatusCode: 700}}, '上游连接失败；httpConnectionFailed'],
  ]) {
    const {runtime, calls} = fixture(t, {terminal: 'failed', codexErrorInfo})
    const error = await runtime.generate(input, () => {}, new AbortController().signal).catch(e => e)
    assert.ok(error.message.includes(expected))
    assert.equal(JSON.stringify(error).includes('private'), false)
    assert.equal(error.message.includes('private'), false)
    assert.equal(calls.filter(v => v.method === 'turn/start').length, 1)
    assert.deepEqual(error.providerTurn, {threadId: 'thread', turnId: 'turn', status: 'failed'})
  }
})
test('missing, unknown or malformed error variants do not leak or invent a diagnosis', async t => {
  for (const codexErrorInfo of [null, 'private-token-variant', '__proto__', 'httpConnectionFailed', ['unauthorized'],
    {private: 'private input'}, {unauthorized: {private: 'private input'}},
    {httpConnectionFailed: {httpStatusCode: 401}, private: 'private input'},
  ]) {
    const {runtime} = fixture(t, {terminal: 'failed', codexErrorInfo})
    const error = await runtime.generate(input, () => {}, new AbortController().signal).catch(e => e)
    assert.equal(error.message, 'Codex 已确认本次生成失败；未完成内容不会成为正式候选，不会自动重发。')
    assert.equal(JSON.stringify(error).includes('private'), false)
  }
})
