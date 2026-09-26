import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { runSession, registerChunkTexts, clearChunkTexts, retryFailedChunks } from '../../src/lib/import/pipeline'
import { useImportSessionStore } from '../../src/stores/import-session'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'

const completion = (content: string | null, finish = 'stop') => new Response(JSON.stringify({
  choices: [{ message: { content, reasoning_content: 'private-reasoning' }, finish_reason: finish }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
}), { status: 200 })
let sessionId: number
let projectId: number

beforeEach(async () => {
  await db.delete(); await db.open()
  usePromptStore.setState({ loaded: false, templates: [] })
  await usePromptStore.getState().init()
  useAIConfigStore.setState({ config: {
    provider: 'deepseek', model: 'deepseek-v4-flash', baseUrl: 'https://test.invalid/v1',
    apiKey: 'test-only-key', maxTokens: 4096, temperature: 0.7,
  }, taskRoutes: {} })
  const workspace = await createWorkspace({ name: '解析测试', genres: [], description: '', status: 'drafting', targetWordCount: 10000 }, { kind: 'novel', novelProfile: 'long' })
  projectId = workspace.project.id!
  sessionId = await useImportSessionStore.getState().create({
    projectId, filename: 'private-novel.txt', fileHash: 'test-hash', totalChars: 20,
    totalChunks: 2, chunkSize: 10, chunks: [0, 1].map(index => ({
      index, startChar: index * 10, endChar: (index + 1) * 10, charCount: 10,
      status: 'pending', attempts: 0,
    })), merged: {}, rollingContext: '', importTarget: 'project', status: 'pending',
  })
  registerChunkTexts(sessionId, [{ index: 0, text: '海港有一座灯塔。' }, { index: 1, text: '灯塔照亮归航的人。' }])
})
afterEach(() => { clearChunkTexts(sessionId); vi.unstubAllGlobals(); db.close() })

describe('Feedback #56: bounded, diagnosable import failures', () => {
  it.each(['non-json', 'empty', 'truncated', '401', '429', 'network'])('stops %s after one request and leaves remaining chunks untouched', async problem => {
    const fetch = vi.fn().mockImplementation(async () => {
      if (problem === 'network') throw new TypeError('Failed to fetch')
      if (problem === '401' || problem === '429') return new Response('service rejected request', { status: Number(problem) })
      return completion(problem === 'empty' ? null : problem === 'truncated' ? '{"worldview":{"summary":"private-answer"}}' : 'private-answer', problem === 'truncated' ? 'length' : 'stop')
    })
    vi.stubGlobal('fetch', fetch)
    await runSession({ projectId, sessionId })
    expect(fetch).toHaveBeenCalledTimes(1)
    const session = await useImportSessionStore.getState().load(sessionId)
    expect(session).toMatchObject({ status: 'failed', chunks: [
      { status: 'failed', attempts: 1 }, { status: 'pending', attempts: 0 },
    ] })
    expect(session?.fatalError).toContain('未自动重发')
    expect(JSON.stringify(await useImportSessionStore.getState().listLogs(sessionId))).not.toMatch(/private-answer|private-reasoning/)
    expect(await db.characters.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.outlineNodes.where('projectId').equals(projectId).count()).toBe(0)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toMatchObject({ response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 16384 })
  })

  it('does not send DeepSeek-only options to another configured provider', async () => {
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, provider: 'custom', contextWindow: 131072 } })
    const fetch = vi.fn().mockImplementation(async () => completion('{}'))
    vi.stubGlobal('fetch', fetch)
    await runSession({ projectId, sessionId })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('thinking')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('response_format')
  })

  it('keeps completed chunks and supports an explicit retry after correction', async () => {
    const fetch = vi.fn()
      .mockImplementationOnce(async () => completion('{"outline":[{"type":"volume","title":"第一卷","children":[{"type":"chapter","title":"灯塔"}]}]}'))
      .mockImplementationOnce(async () => completion('not json'))
      .mockImplementation(async () => completion('{}'))
    vi.stubGlobal('fetch', fetch)
    await runSession({ projectId, sessionId })
    expect(fetch).toHaveBeenCalledTimes(2)
    const nodes = await db.outlineNodes.where('projectId').equals(projectId).toArray()
    expect(nodes.map(node => node.title)).toContain('灯塔')
    await retryFailedChunks({ projectId, sessionId })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect((await useImportSessionStore.getState().load(sessionId))?.status).toBe('done')
    expect(await db.outlineNodes.where('projectId').equals(projectId).toArray()).toEqual(nodes)
  })

  it('retries a definite 503 at most three times with visible attempts', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response('busy', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    // One block isolates the existing bounded transient retry path.
    await useImportSessionStore.getState().patch(sessionId, { totalChunks: 1, chunks: [{ index: 0, startChar: 0, endChar: 10, charCount: 10, status: 'pending', attempts: 0 }] })
    await runSession({ projectId, sessionId })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect((await useImportSessionStore.getState().load(sessionId))?.chunks[0]).toMatchObject({ status: 'failed', attempts: 3 })
  }, 10000)
})
