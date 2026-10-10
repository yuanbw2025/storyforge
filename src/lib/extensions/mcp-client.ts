import { Client, StreamableHTTPClientTransport, type JSONRPCMessage } from '@modelcontextprotocol/client'
import { createTaskSessionFromClient, createTaskSessionEndpointId, toolDeclarationFromMcpTool, type RawClientDispatch } from '@modelcontextprotocol/ext-tasks/client'
import { assertJson, isObject } from './schema'
import type { ExtensionConnector } from './types'

const clientInfo = { name: 'storyforge', version: '1.0.0' }
const clientCapabilities = { extensions: { 'io.modelcontextprotocol/tasks': {} } }
/** The SDK owns base-protocol negotiation; the official Tasks extension owns task codecs.
 * Its V2 API requires a host coordinator for extension request IDs and response matching. */
export async function connectExtensionMcp(connector: ExtensionConnector, options: { token?: string; signal?: AbortSignal; fetch?: typeof fetch } = {}) {
  const client = new Client(clientInfo, {
    capabilities: clientCapabilities,
    versionNegotiation: { mode: connector.protocol === 'legacy' ? 'legacy' : { pin: connector.protocol }, probe: { timeoutMs: 10000, maxRetries: 0 } },
    inputRequired: { autoFulfill: false }, listMaxPages: 4,
  })
  const endpoint = new URL(connector.url)
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: options.token ? { token: async () => options.token! } : undefined,
    requestInit: { credentials: 'omit', redirect: 'error' }, onInsufficientScope: 'throw', maxStepUpRetries: 0,
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.href !== endpoint.href) throw new Error('MCP 请求不得离开已确认的地址')
      const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(options.signal ? [options.signal] : []), ...(init?.signal ? [init.signal] : [])])
      const response = await (options.fetch ?? fetch)(input, { ...init, signal, credentials: 'omit', redirect: 'error' })
      if (!response.body) return response
      // Bound even SSE responses. No eagerly buffering a long-lived stream.
      let bytes = 0
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > 2_000_000) throw new Error('MCP 响应超过 2 MB'); controller.enqueue(chunk) } }))
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    },
  })
  try {
    await client.connect(transport, { signal: options.signal, timeout: 10000 })
    const original = transport.onmessage
    const responses = new Map<string, (message: JSONRPCMessage) => void>()
    transport.onmessage = message => {
      const id = 'id' in message ? String(message.id) : ''
      const receiver = responses.get(id)
      if (receiver) receiver(message); else original?.(message)
    }
    const rawDispatch: RawClientDispatch = (request, requestOptions) => new Promise((resolve, reject) => {
      if (!isObject(request) || typeof request.method !== 'string') { reject(new Error('MCP 扩展请求无效')); return }
      const id = `sf-tasks-${crypto.randomUUID()}`
      const signal = requestOptions?.signal
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); responses.delete(id) }
      const abort = () => { cleanup(); reject(signal?.reason ?? new Error('已停止等待')) }
      const timer = setTimeout(() => { cleanup(); reject(new Error('MCP 扩展请求超时；结果可能未知')) }, Math.min(requestOptions?.context?.requestTimeoutMs ?? 30000, 30000))
      responses.set(id, message => {
        cleanup()
        if ('error' in message) { const { code, message: detail, data } = message.error; if (data !== undefined) assertJson(data); resolve({ kind: 'error', error: { code, message: detail, ...(data === undefined ? {} : { data }) } }); return }
        if ('result' in message) { assertJson(message.result); resolve({ kind: 'result', result: message.result }); return }
        reject(new Error('MCP 扩展响应无效'))
      })
      if (signal?.aborted) { abort(); return }
      signal?.addEventListener('abort', abort, { once: true })
      void transport.send({ ...request, jsonrpc: '2.0', id } as JSONRPCMessage).catch(error => { cleanup(); reject(error) })
    })
    const listed = await client.listTools(undefined, { signal: options.signal, timeout: 10000 })
    if (listed.tools.length > 200) throw new Error('工具目录超过 200 项')
    const tools = listed.tools.filter(tool => connector.tools.includes(tool.name))
    const tasks = createTaskSessionFromClient(client, {
      endpointId: await createTaskSessionEndpointId('storyforge-mcp-v1', { url: connector.url, protocol: connector.protocol }),
      rawDispatch, v2RequestFraming: { protocolVersion: '2026-07-28', clientInfo, clientCapabilities },
      tools: { currentTool: name => { const tool = tools.find(item => item.name === name); return tool ? toolDeclarationFromMcpTool(tool) : undefined } },
      maxInputRounds: 1,
      onInputRequest: async () => { throw new Error('该工具要求额外的模型、文件或交互授权；当前连接未提供这些能力') },
    })
    return {
      connector: structuredClone(connector), client, tasks, tools, era: client.getProtocolEra(),
      capabilities: { tasks: tasks.capabilities, apps: false as const },
      async close() { await tasks.close(); await client.close() },
    }
  } catch (error) { await client.close(); throw error }
}
