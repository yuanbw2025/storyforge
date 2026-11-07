/**
 * R-reuse-to-project · 复用已解析会话 → 一键灌进当前项目设定库（社区反馈）
 *
 * 场景:用户已用「导入项目参考」拆解过对标文（解析结果存在 session.merged），想把设定
 * 搬进设定库又不想一个个手填。applyProjectFromSession 复用 session.merged 调 applyChunkResult
 * 写库，**不再调用解析 AI**（省钱）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  applyProjectFromSession, clearChunkTexts, readPendingDocumentImportV1, registerChunkTexts, runSession,
} from '../../src/lib/import/pipeline'
import { confirmDocumentImportChunkV1 } from '../../src/lib/import/document-parse-adoption'
import { quickHash } from '../../src/lib/import/chunker'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { hashImportChunkTextV1, useImportSessionStore } from '../../src/stores/import-session'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

describe('R-reuse-to-project · 复用已解析灌进设定库', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('用 session.merged 把世界观/角色写进设定库(零重复解析)', async () => {
    const { scope } = await seedCurrentWorkspace('测试项目')
    const projectId = scope.projectId
    const source = '混沌初开，造物主立世创世。剑修林惊羽性情坚毅，苏长歌性情温婉。'
    const merged = {
      worldview: { worldOrigin: '混沌初开，造物主立世创世' },
      characters: [
        {
          name: '林惊羽', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral',
          personality: '坚毅', shortDescription: '天才剑修',
        },
        {
          name: '苏长歌', roleWeight: 'secondary', moralAxis: 'good', orderAxis: 'neutral',
          personality: '温婉',
        },
      ],
    }
    const store = useImportSessionStore.getState()
    const sessionId = await store.create({
      projectId, targetScope: scope, filename: '对标文.txt', fileHash: quickHash(source),
      totalChars: source.length, totalChunks: 1, chunkSize: 1000,
      chunks: [{ index: 0, startChar: 0, endChar: source.length, charCount: source.length,
        sourceTextHash: await hashImportChunkTextV1(source), status: 'pending', attempts: 0 }],
      targetWorldGroupId: null, importTarget: 'reference', analysisDepth: 'quick',
      merged: {}, status: 'pending', rollingContext: '',
    })
    const previousAI = useAIConfigStore.getState()
    let counts: Awaited<ReturnType<typeof applyProjectFromSession>>
    try {
      useAIConfigStore.setState({
        config: { provider: 'deepseek', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'isolated-reuse-no-real-key', maxTokens: 16_384, temperature: 0.1 },
        rememberApiKey: false, presets: [], taskRoutes: {},
      })
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(merged) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 31, completion_tokens: 17, total_tokens: 48 },
      }), { headers: { 'Content-Type': 'application/json' } }))
      vi.stubGlobal('fetch', fetchMock)
      registerChunkTexts(sessionId, [{ index: 0, text: source }])
      const input = { sessionId, projectId, chunkIndex: 0 }
      await runSession(input)
      const pending = await readPendingDocumentImportV1(input)
      if (!pending?.candidate) throw new Error('未保存待作者确认的原候选')
      await confirmDocumentImportChunkV1({ ...input, candidateHash: pending.candidate.candidateHash, reviewedResult: merged })
      const session = await store.findReusableCompleted(projectId)
      if (!session || session.id !== sessionId) throw new Error('未找到可复用的原已确认会话')
      expect(await db.worldviews.count()).toBe(0)
      expect(await db.characters.count()).toBe(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      counts = await applyProjectFromSession(projectId, session, null, undefined, true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      clearChunkTexts(sessionId)
      useAIConfigStore.setState(previousAI)
    }

    // 返回计数
    expect(counts.worldviewFields).toBeGreaterThan(0)
    expect(counts.characters).toBeGreaterThan(0)

    // 设定库实际写入
    const wv = await db.worldviews.where('projectId').equals(projectId).first()
    expect(wv?.worldOrigin).toContain('造物主')
    const chars = await db.characters.where('projectId').equals(projectId).toArray()
    expect(chars.map(c => c.name)).toContain('林惊羽')
    expect(chars.map(c => c.name)).toContain('苏长歌')
  })

  it('merged 为空时不报错，返回零计数', async () => {
    const { scope } = await seedCurrentWorkspace('空项目', { genres: ['other'] })
    const projectId = scope.projectId
    const store = useImportSessionStore.getState()
    const sessionId = await store.create({
      projectId, targetScope: scope, filename: 'x.txt', fileHash: quickHash(''),
      totalChars: 0, totalChunks: 0, chunkSize: 1000, chunks: [], targetWorldGroupId: null,
      importTarget: 'project', status: 'done', merged: {}, rollingContext: '',
    })
    const session = await store.load(sessionId)
    if (!session) throw new Error('未保存原空会话')
    const counts = await applyProjectFromSession(projectId, session, null)
    expect(counts.worldviewFields).toBe(0)
    expect(counts.characters).toBe(0)
  })
})
