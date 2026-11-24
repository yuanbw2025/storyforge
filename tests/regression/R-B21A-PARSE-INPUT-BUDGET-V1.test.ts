import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createDocumentImportChunkCandidateV1 } from '../../src/lib/import/document-parse-durable'
import { clearChunkTexts, registerChunkTexts } from '../../src/lib/import/pipeline'
import { hashImportChunkTextV1, useImportSessionStore } from '../../src/stores/import-session'
import { quickHash } from '../../src/lib/import/chunker'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const raw = '{"worldview":{"summary":"北境"},"characters":[],"outline":[]}'
const sessions: number[] = []
const previous = useAIConfigStore.getState()

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.setState({
    config: { provider: 'custom', model: 'isolated-b21a-model', baseUrl: 'https://isolated.invalid/v1',
      apiKey: 'isolated-only', contextWindow: 262_144, maxTokens: 16_384, temperature: 0.1 },
    rememberApiKey: false, presets: [], taskRoutes: {},
  })
})
afterEach(() => {
  for (const id of sessions.splice(0)) clearChunkTexts(id)
  useAIConfigStore.setState(previous); vi.unstubAllGlobals(); db.close()
})

async function fixture(documentText: string) {
  const f = await seedCurrentWorkspace('B21a 解析输入预算')
  const sessionId = await useImportSessionStore.getState().create({
    projectId: f.scope.projectId, targetScope: f.scope, filename: 'synthetic.txt',
    fileHash: quickHash(documentText), totalChars: documentText.length, totalChunks: 1,
    chunkSize: documentText.length,
    chunks: [{ index: 0, startChar: 0, endChar: documentText.length, charCount: documentText.length,
      sourceTextHash: await hashImportChunkTextV1(documentText), status: 'pending', attempts: 0 }],
    importTarget: 'project', analysisDepth: undefined, targetWorldGroupId: null, status: 'pending',
    merged: {}, rollingContext: '',
  })
  sessions.push(sessionId)
  registerChunkTexts(sessionId, [{ index: 0, text: documentText }])
  return { ...f, input: { projectId: f.scope.projectId, sessionId, chunkIndex: 0 } }
}

const reply = () => new Response(JSON.stringify({
  choices: [{ message: { role: 'assistant', content: raw }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}), { headers: { 'Content-Type': 'application/json' } })

describe('B21a · 文档分块输入预算跟随真实容量，而非固定 100k', () => {
  it('超过旧 100k 应用门但仍在已发现容量内的整块：逐字发送且仅一次 POST', async () => {
    // ~72k CJK 字符 ≈ 108k tokens，高于旧的 100,000 固定门。
    const unit = '北境有山川城池，原文必须逐字交付。'
    const documentText = unit.repeat(Math.ceil(80_000 / unit.length))
    const tokens = Math.round((documentText.match(/[一-鿿]/g) ?? []).length * 1.5)
    expect(tokens).toBeGreaterThan(100_000)
    const f = await fixture(documentText)
    const post = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (String(_url).endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ models: [{ key: 'isolated-b21a-model', type: 'llm',
          loaded_instances: [{ config: { context_length: 262_144 } }] }] }))
      }
      const request = JSON.parse(String(init?.body))
      expect(request.messages.some((message: { content: string }) => message.content.includes(documentText))).toBe(true)
      return reply()
    })
    vi.stubGlobal('fetch', post)
    const candidate = await createDocumentImportChunkCandidateV1(f.input)
    expect(candidate.result).toBeTruthy()
    expect(post.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 20_000)

  it('超出模型真实容量的整块：派发前确定性拒绝，零 POST、零 Run', async () => {
    const unit = '北境有山川城池，原文必须逐字交付。'
    const documentText = unit.repeat(Math.ceil(80_000 / unit.length))
    const f = await fixture(documentText)
    // 独立模型名：容量按路由缓存，不能复用上一条的 262k 发现结果。
    useAIConfigStore.getState().setConfig({ model: 'isolated-b21a-small', contextWindow: 96_000 })
    const post = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ models: [{ key: 'isolated-b21a-small', type: 'llm',
          loaded_instances: [{ config: { context_length: 96_000 } }] }] }))
      }
      return reply()
    })
    vi.stubGlobal('fetch', post)
    await expect(createDocumentImportChunkCandidateV1(f.input)).rejects.toThrow(/完整请求超出|完整交付/)
    // 仅允许容量探测，不允许任何模型 POST。
    expect(post.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(await db.agentRuns.count()).toBe(0)
  }, 20_000)
})
