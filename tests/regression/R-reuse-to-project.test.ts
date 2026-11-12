/**
 * R-reuse-to-project · 复用已解析会话 → 一键灌进当前项目设定库（社区反馈）
 *
 * 场景:用户已用「导入项目参考」拆解过对标文（解析结果存在 session.merged），想把设定
 * 搬进设定库又不想一个个手填。applyProjectFromSession 复用 session.merged 调 applyChunkResult
 * 写库，**不再调用解析 AI**（省钱）。
 *
 * 复用入口只接受原库中已冻结原文、作者逐块确认过的会话；夹具因此走当前真实契约
 * （持久化 session + targetScope + 分块 SHA-256 + 确认回执），不复用内存假 session。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { applyProjectFromSession, clearChunkTexts, registerChunkTexts } from '../../src/lib/import/pipeline'
import { hashImportChunkTextV1, useImportSessionStore } from '../../src/stores/import-session'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { quickHash } from '../../src/lib/import/chunker'
import { createDocumentImportChunkCandidateV1 } from '../../src/lib/import/document-parse-durable'
import { confirmDocumentImportChunkV1 } from '../../src/lib/import/document-parse-adoption'
import type { ImportSession } from '../../src/lib/types/import-session'
import type { WorkspaceScope } from '../../src/lib/types/world-ownership'

const TEXT = '混沌初开，造物主立世创世。'

const previousConfig = useAIConfigStore.getState()

async function seedReusableSession(scope: WorkspaceScope, merged: ImportSession['merged']) {
  const sessionId = await useImportSessionStore.getState().create({
    projectId: scope.projectId, targetScope: scope, filename: '对标文.txt', fileHash: quickHash(TEXT),
    totalChars: TEXT.length, totalChunks: 1, chunkSize: 1000, importTarget: 'reference', analysisDepth: 'quick',
    targetWorldGroupId: null, status: 'pending', merged: {}, rollingContext: '',
    chunks: [{ index: 0, startChar: 0, endChar: TEXT.length, charCount: TEXT.length,
      sourceTextHash: await hashImportChunkTextV1(TEXT), status: 'pending', attempts: 0 }],
  })
  const service = vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: JSON.stringify(merged) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', service)
  registerChunkTexts(sessionId, [{ index: 0, text: TEXT }])
  try {
    const input = { projectId: scope.projectId, sessionId, chunkIndex: 0 }
    const candidate = await createDocumentImportChunkCandidateV1(input)
    await confirmDocumentImportChunkV1({ ...input, candidateHash: candidate.candidateHash })
    expect(service).toHaveBeenCalledOnce()
    return (await db.importSessions.get(sessionId))!
  } finally {
    clearChunkTexts(sessionId)
  }
}

describe('R-reuse-to-project · 复用已解析灌进设定库', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    useAIConfigStore.setState({ config: { provider: 'agnes', model: 'synthetic-test-model', baseUrl: 'https://example.invalid/v1',
      apiKey: 'synthetic', temperature: 0, maxTokens: 1000 }, rememberApiKey: false, taskRoutes: {} })
  })
  afterEach(() => { vi.unstubAllGlobals(); useAIConfigStore.setState(previousConfig); db.close() })

  it('用 session.merged 把世界观/角色写进设定库(零重复解析)', async () => {
    const { scope } = await seedCurrentWorkspace('测试项目')
    const { projectId } = scope

    const session = await seedReusableSession(scope, {
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
    })

    const counts = await applyProjectFromSession(projectId, session, null, undefined, true)

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
    const { scope } = await seedCurrentWorkspace('空项目')
    const { projectId } = scope
    const session = await seedReusableSession(scope, { characters: [] })
    const counts = await applyProjectFromSession(projectId, session, null, undefined, true)
    expect(counts.worldviewFields).toBe(0)
    expect(counts.characters).toBe(0)
  })

  it('已删除的导入会话不能再把历史结果灌进设定库', async () => {
    const { scope } = await seedCurrentWorkspace('已删会话')
    const { projectId } = scope
    const session = await seedReusableSession(scope, { worldview: { worldOrigin: TEXT } })
    await db.importSessions.delete(session.id!)
    await expect(applyProjectFromSession(projectId, session, null, undefined, true)).rejects.toThrow('导入会话或所属项目已删除')
    expect(await db.worldviews.where('projectId').equals(projectId).count()).toBe(0)
  })

  it.each([
    ['尚未作者确认', (row: ImportSession) => { delete row.chunks[0].durableParse!.confirmation }],
    ['缺少冻结原文摘要', (row: ImportSession) => { delete row.chunks[0].sourceTextHash }],
  ])('%s的旧会话只可查看，不能复用写入', async (_label, mutate) => {
    const { scope } = await seedCurrentWorkspace('旧会话')
    const { projectId } = scope
    const session = await seedReusableSession(scope, { worldview: { worldOrigin: TEXT } })
    const legacy = structuredClone(session)
    mutate(legacy)
    await db.importSessions.put(legacy)
    await expect(applyProjectFromSession(projectId, legacy, null, undefined, true)).rejects.toThrow()
    expect(await db.worldviews.where('projectId').equals(projectId).count()).toBe(0)
  })
})
