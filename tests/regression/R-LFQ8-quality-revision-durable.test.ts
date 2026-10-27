import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord, resolveScope } from '../../src/lib/workspace/scope'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { normalizeRichEditorHTMLV1 } from '../../src/lib/editor/rich-editor-schema'
import { runWholeChapterQualityReviewV1 } from '../../src/lib/agent/run/quality-review-durable'
import { runQualityRevisionV1, readLatestQualityRevisionV1, adoptQualityRevisionV1, rejectQualityRevisionV1, abandonQualityRevisionV1 } from '../../src/lib/agent/run/quality-revision-durable'
import { isProseGenerationCandidateCurrentV1 } from '../../src/lib/agent/run/prose-generation-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as protection from '../../src/lib/prose/quality-revision'
import { verifyQualityRevisionEvidenceV1 } from '../../src/lib/prose/quality-revision-evidence'

const old = useAIConfigStore.getState()
// These cases verify multi-transaction durability, not latency. Keep a bounded
// allowance under coverage so a premature timeout cannot strand a DB operation.
const DURABLE_TEST_TIMEOUT = 15_000
async function seed() {
  const f = await seedCurrentWorkspace('按问题修稿', { genres: ['realism'] })
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '签字', summary: '金额一百二十，余额三点，签字处停笔', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const sourceHtml = normalizeRichEditorHTMLV1('<p><strong>余额三点，金额一百二十。</strong></p><p>陈禾签下名字，正文到此结束。</p>')
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId, title: '签字', content: sourceHtml, wordCount: 31, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const review = await runWholeChapterQualityReviewV1({ scope: f.scope, chapterId, outlineNodeId, worldGroupId: null, mode: 'quality', call: async (_messages, _config, result) => {
    result.completion = 'complete'; result.finishReason = 'stop'
    return JSON.stringify({ summary: '停笔处有任务说明', strengths: ['金额和余额明确'], issues: [{ dimension: 'voice', confidence: 'suggestion', anchorId: 'p2', reason: '任务语言进入正文', suggestion: '移除任务说明，保留签字动作' }] })
  } })
  const revise = vi.fn(async (_messages, _resolution, result) => { result.completion = 'complete'; result.finishReason = 'stop'; return JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '陈禾签下名字。' }] }) })
  const recheck = vi.fn(async (_messages, _resolution, result) => { result.completion = 'complete'; result.finishReason = 'stop'; return JSON.stringify({ review: { summary: '任务说明已移除，仍需作者判断', strengths: ['保留签字'], issues: [] }, outcomes: [{ issueId: review.report.issues[0].id, status: 'improved', anchorId: 'p2', reason: '签字事件保留且没有任务说明' }] }) })
  return { ...f, chapterId, outlineNodeId, sourceHtml, review, revise, recheck }
}

function input(f: Awaited<ReturnType<typeof seed>>) {
  return { scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'quality' as const, reportRunId: f.review.runId, reportHash: f.review.report.artifactHash, selectedIssueIds: [f.review.report.issues[0].id], revise: f.revise, recheck: f.recheck }
}

describe('LFQ8 · 同一正文候选的范围修订与采纳', () => {
  beforeEach(async () => {
    const held = new Set<string>()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: unknown, fn: (lock: unknown) => Promise<unknown>) => {
      if (held.has(name)) return fn(null)
      held.add(name); try { return await fn({ name }) } finally { held.delete(name) }
    } } })
    await db.delete(); await db.open(); useAIConfigStore.setState({ config: { ...old.config, provider: 'ollama', model: 'quality-scope', contextWindow: 128000, maxTokens: 4000 } })
  })
  afterEach(() => { vi.restoreAllMocks(); useAIConfigStore.setState(old, true); db.close() })

  it('一次修订加一次复核，原稿与加粗不变；恢复后作者采纳才正式写回，禁止同轮重复调用', async () => {
    const f = await seed()
    const result = await runQualityRevisionV1({ ...input(f), authorRequest: '保留签字，只移除任务说明' })
    expect(f.revise).toHaveBeenCalledTimes(1); expect(f.recheck).toHaveBeenCalledTimes(1)
    const writerMessages = f.revise.mock.calls[0][0] as { content: string }[]
    const checkerMessages = f.recheck.mock.calls[0][0] as { content: string }[]
    expect(writerMessages[1].content).toContain(JSON.stringify(f.review.report.strengths))
    expect(checkerMessages[1].content).toContain(JSON.stringify(f.review.report.strengths))
    expect(writerMessages[1].content).toContain('保留签字，只移除任务说明')
    expect(checkerMessages[1].content).toContain('保留签字，只移除任务说明')
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.sourceHtml)
    expect(result.state).toBe('awaiting_confirmation')
    expect(result.candidate?.operation).toBe('quality-revise')
    expect(result.candidate?.qualityRevision?.recheck.outcomes[0].anchorId).toBe('p2')
    expect(await isProseGenerationCandidateCurrentV1(result.candidate!)).toBe(true)
    const restored = await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId })
    expect(restored?.candidate?.durable.candidateHash).toBe(result.candidate!.durable.candidateHash)
    await expect(runQualityRevisionV1(input(f))).rejects.toThrow('本轮修订已执行')
    const adopted = await adoptQualityRevisionV1({ scope: f.scope, candidate: restored!.candidate! })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect((await db.chapters.get(f.chapterId))!.content).toBe('<p><strong>余额三点，金额一百二十。</strong></p><p>陈禾签下名字。</p>')
    expect(adopted.receipt?.criteria.map(item => item.id)).toContain('quality-revision.scope')
    expect(adopted.receipt?.contextManifestHashes).toContain(result.candidate!.qualityRevision!.recheckManifestHash)
  }, DURABLE_TEST_TIMEOUT)

  it('候选篡改和原稿变化都不能采纳，原作者改稿保持不变', async () => {
    const f = await seed(); const result = await runQualityRevisionV1(input(f))
    const forged = structuredClone(result.candidate!); forged.qualityRevision!.contentHtml = '<p>余额三十点。</p>'
    expect(await isProseGenerationCandidateCurrentV1(forged)).toBe(false)
    await expect(adoptQualityRevisionV1({ scope: f.scope, candidate: forged })).rejects.toThrow()
    await db.chapters.update(f.chapterId, { content: f.sourceHtml + '<p>作者补写。</p>', updatedAt: Date.now() })
    await expect(adoptQualityRevisionV1({ scope: f.scope, candidate: result.candidate! })).rejects.toThrow('过期')
    expect((await db.chapters.get(f.chapterId))!.content).toContain('作者补写')
  }, DURABLE_TEST_TIMEOUT)

  it('越界补丁只有一次请求；复核失败保留只读预演，无候选且不循环', async () => {
    const f = await seed()
    f.revise.mockImplementationOnce(async (_m, _c, result) => { result.completion = 'complete'; result.finishReason = 'stop'; return JSON.stringify({ edits: [{ spanId: 'p1.1', replacement: '余额三十点。' }] }) })
    await expect(runQualityRevisionV1(input(f))).rejects.toThrow('授权范围')
    expect(f.recheck).not.toHaveBeenCalled()
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.sourceHtml)
    const second = await seed()
    second.recheck.mockImplementationOnce(async () => { throw new Error('断网，结果未知') })
    await expect(runQualityRevisionV1(input(second))).rejects.toThrow('断网')
    const recovered = await readLatestQualityRevisionV1({ scope: second.scope, chapterId: second.chapterId })
    expect(recovered?.candidate).toBeNull()
    expect(recovered?.draft.outputText).toContain('陈禾签下名字。')
    expect(recovered?.state).toBe('failed')
    expect(second.revise).toHaveBeenCalledTimes(1); expect(second.recheck).toHaveBeenCalledTimes(1)
  }, DURABLE_TEST_TIMEOUT)

  it('作者拒绝不改原稿，另一个作品不能读取或采纳', async () => {
    const f = await seed(); const result = await runQualityRevisionV1(input(f))
    const foreign = await seedCurrentWorkspace('其它作品', { genres: ['realism'] })
    expect(await readLatestQualityRevisionV1({ scope: foreign.scope, chapterId: f.chapterId })).toBeNull()
    await expect(adoptQualityRevisionV1({ scope: foreign.scope, candidate: result.candidate! })).rejects.toThrow()
    const rejected = await rejectQualityRevisionV1({ scope: f.scope, candidate: result.candidate! })
    expect(rejected.projection.state).toBe('cancelled')
    expect(rejected.events.filter(event => event.type === 'run.cancelled').map(event => event.payload)).toEqual([{ reason: 'author-rejected-quality-revision' }])
    expect((await rejectQualityRevisionV1({ scope: f.scope, candidate: result.candidate! })).events).toEqual(rejected.events)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.sourceHtml)
  }, DURABLE_TEST_TIMEOUT)

  it.each(['run.cancelled', 'memory.settlement.recorded'])('修订拒绝的 %s 写失败时完整回滚，原候选可恢复并明确重试', async eventType => {
    const f = await seed(); const result = await runQualityRevisionV1(input(f))
    const request = { scope: f.scope, candidate: result.candidate! }
    const before = await readAgentRunV1(f.scope, result.runId)
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === eventType) throw new DOMException('修订拒绝终态写入故障', 'QuotaExceededError')
      return add(...args)
    })
    await expect(rejectQualityRevisionV1(request)).rejects.toThrow('修订拒绝终态写入故障')
    expect(await readAgentRunV1(f.scope, result.runId)).toEqual(before)
    expect((await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId }))?.state).toBe('awaiting_confirmation')
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.sourceHtml)
    spy.mockRestore()
    const rejected = await rejectQualityRevisionV1(request)
    expect(rejected.projection.state).toBe('cancelled')
    for (const type of ['confirmation.recorded', 'run.cancelled', 'memory.settlement.recorded']) expect(rejected.events.filter(event => event.type === type)).toHaveLength(1)
    expect(f.revise).toHaveBeenCalledTimes(1); expect(f.recheck).toHaveBeenCalledTimes(1)
  }, DURABLE_TEST_TIMEOUT)

  it.each(['unchanged', 'uncertain'] as const)('复核%s仍由作者决定，不循环重写', async status => {
    const f = await seed()
    f.recheck.mockImplementationOnce(async (_m, _c, result) => {
      result.completion = 'complete'; result.finishReason = 'stop'
      return JSON.stringify({ review: { summary: '建议由作者决定', strengths: [], issues: [] }, outcomes: [{ issueId: f.review.report.issues[0].id, status, quote: '陈禾签下名字。', reason: '模型无法确认阅读效果' }] })
    })
    const result = await runQualityRevisionV1(input(f))
    expect(result.candidate?.qualityRevision?.recheck.outcomes[0].status).toBe(status)
    await adoptQualityRevisionV1({ scope: f.scope, candidate: result.candidate! })
    expect(f.revise).toHaveBeenCalledTimes(1); expect(f.recheck).toHaveBeenCalledTimes(1)
  }, DURABLE_TEST_TIMEOUT)

  it('受保护原句在问题所在段也逐字保留；输出预算不足零模型请求', async () => {
    const f = await seed()
    f.revise.mockImplementationOnce(async (_m, _c, result) => { result.completion = 'complete'; result.finishReason = 'stop'; return JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '。' }] }) })
    const result = await runQualityRevisionV1({ ...input(f), protectedQuotes: ['陈禾签下名字'] })
    expect(result.candidate?.outputText).toContain('陈禾签下名字。')
    const second = await seed()
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, maxTokens: 20000 } })
    await expect(runQualityRevisionV1(input(second))).rejects.toThrow('预算')
    expect(second.revise).not.toHaveBeenCalled(); expect(second.recheck).not.toHaveBeenCalled()
  }, DURABLE_TEST_TIMEOUT)

  it('重复附加保护原句在复核前停止，收到的补丁与只读预演可恢复，原稿不变', async () => {
    const f = await seed()
    const raw = JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '陈禾签下名字。' }] })
    await expect(runQualityRevisionV1({ ...input(f), protectedQuotes: ['陈禾签下名字'] })).rejects.toThrow('重复附加受保护原句')
    expect(f.revise).toHaveBeenCalledTimes(1)
    expect(f.recheck).not.toHaveBeenCalled()
    const view = await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId })
    expect(view?.state).toBe('failed')
    expect(view?.current).toBe(false)
    expect(view?.protectionError).toContain('重复附加受保护原句')
    expect(view?.draft.outputText).toContain('陈禾签下名字陈禾签下名字。')
    expect(view?.candidate).toBeNull()
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.sourceHtml)
    const artifacts = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
    expect(artifacts.some(row => {
      try { const received = JSON.parse(row.content ?? ''); return received.version === 'quality-revision-received-v1' && received.raw === raw } catch { return false }
    })).toBe(true)
  }, DURABLE_TEST_TIMEOUT)

  it('旧策略产生的重复保护候选仍可查看和结束，但共享采纳入口不接受', async () => {
    const f = await seed()
    // Simulate the previous policy, retaining real durable contracts, artifacts,
    // candidate hashes and receipts instead of forging a signed candidate.
    const previousPolicy = vi.spyOn(protection, 'qualityRevisionProtectionErrorV1').mockReturnValue(null)
    let legacy: Awaited<ReturnType<typeof runQualityRevisionV1>>
    try { legacy = await runQualityRevisionV1({ ...input(f), protectedQuotes: ['陈禾签下名字'] }) } finally { previousPolicy.mockRestore() }
    expect(legacy!.state).toBe('awaiting_confirmation')
    expect(await verifyQualityRevisionEvidenceV1(legacy!.candidate!.qualityRevision!, legacy!.candidate!.outputText)).toBe(false)
    expect(await isProseGenerationCandidateCurrentV1(legacy!.candidate!)).toBe(false)
    const before = (await db.agentRuns.get(legacy!.runId))!.lastSequence
    await expect(adoptQualityRevisionV1({ scope: f.scope, candidate: legacy!.candidate! })).rejects.toThrow('重复附加受保护原句')
    expect((await db.agentRuns.get(legacy!.runId))!.lastSequence).toBe(before)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.sourceHtml)
    const view = await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId })
    expect(view?.draft.outputText).toContain('陈禾签下名字陈禾签下名字。')
    expect(view?.protectionError).toContain('重复附加受保护原句')
    expect(view?.current).toBe(false)
    await abandonQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId, runId: legacy!.runId })
    expect((await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId }))?.state).toBe('cancelled')
    expect(f.revise).toHaveBeenCalledTimes(1)
    expect(f.recheck).toHaveBeenCalledTimes(1)
  }, DURABLE_TEST_TIMEOUT)

  it('作者取消保留一次已收到预演，禁止复核重发；并发占用不派第二次模型调用', async () => {
    const f = await seed(); const controller = new AbortController()
    f.revise.mockImplementationOnce(async (_m, _c, result) => { result.completion = 'complete'; result.finishReason = 'stop'; controller.abort(); return JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '陈禾签下名字。' }] }) })
    await expect(runQualityRevisionV1({ ...input(f), signal: controller.signal })).rejects.toThrow('停止')
    expect(f.recheck).not.toHaveBeenCalled()
    expect((await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId }))?.state).toBe('cancelled')
    const second = await seed(); let release!: () => void; let entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    second.revise.mockImplementationOnce(async (_m, _c, result) => { entered(); await gate; result.completion = 'complete'; result.finishReason = 'stop'; return JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '陈禾签下名字。' }] }) })
    const running = runQualityRevisionV1(input(second))
    try {
      await Promise.race([started, running.then(() => { throw new Error('修订未进入受控阶段') })])
      expect(second.revise).toHaveBeenCalledTimes(1)
      await expect(runQualityRevisionV1(input(second))).rejects.toThrow('另一页面')
    } finally { release() }
    await running
    expect(second.revise).toHaveBeenCalledTimes(1); expect(second.recheck).toHaveBeenCalledTimes(1)
  }, DURABLE_TEST_TIMEOUT)

  it('上游改变旧候选失效；备份保留原证据，导入不复活物理身份，删除副本隔离', async () => {
    const f = await seed(); const result = await runQualityRevisionV1(input(f))
    const backup = await exportProjectJSON(f.scope.projectId)
    const importedId = await importProjectJSON(backup)
    const importedScope = await resolveScope({ projectId: importedId })
    const chapter = await db.chapters.where('projectId').equals(importedId).first()
    expect(await readLatestQualityRevisionV1({ scope: importedScope, chapterId: chapter!.id! })).toBeNull()
    expect((await db.agentRunArtifacts.where('projectId').equals(importedId).toArray()).some(row => row.content?.includes('quality-revision-response-v1'))).toBe(true)
    await cascadeDeleteProject(importedId)
    expect(await db.agentRuns.where('projectId').equals(importedId).count()).toBe(0)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.sourceHtml)
    await db.works.update(f.scope.workId, { description: '作者改变场景方向', updatedAt: Date.now() })
    expect(await isProseGenerationCandidateCurrentV1(result.candidate!)).toBe(false)
    await expect(adoptQualityRevisionV1({ scope: f.scope, candidate: result.candidate! })).rejects.toThrow()
  }, DURABLE_TEST_TIMEOUT)

  it('复核原响应或请求工件损坏不能靠候选内副本绕过检查', async () => {
    const f = await seed(); const result = await runQualityRevisionV1(input(f))
    const artifact = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response' && row.content?.includes('quality-recheck-response-v1'))!
    await db.agentRunArtifacts.update(artifact.id!, { content: artifact.content + '篡改复核' })
    expect(await isProseGenerationCandidateCurrentV1(result.candidate!)).toBe(false)
    await expect(adoptQualityRevisionV1({ scope: f.scope, candidate: result.candidate! })).rejects.toThrow()
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.sourceHtml)
  }, DURABLE_TEST_TIMEOUT)

  it.each(['fake-quote', 'fake-anchor', 'wrong-id', 'truncated'] as const)('复核%s保留原响应与已收到账单，不产生可采纳候选', async failure => {
    const f = await seed()
    f.recheck.mockImplementationOnce(async (_m, _c, result) => {
      result.completion = 'complete'; result.finishReason = failure === 'truncated' ? 'length' : 'stop'
      const location = failure === 'fake-anchor' ? { anchorId: 'p99-1' } : { quote: failure === 'fake-quote' ? '不存在的改稿句子' : '陈禾签下名字。' }
      return JSON.stringify({ review: { summary: '只供诊断', strengths: [], issues: [] }, outcomes: [{ issueId: failure === 'wrong-id' ? '另一报告的问题' : f.review.report.issues[0].id, status: 'improved', ...location, reason: '未确证的判断' }] })
    })
    await expect(runQualityRevisionV1(input(f))).rejects.toThrow()
    const restored = await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId })
    expect(restored?.candidate).toBeNull(); expect(restored?.state).toBe('failed')
    expect(f.revise).toHaveBeenCalledTimes(1); expect(f.recheck).toHaveBeenCalledTimes(1)
    expect((await db.agentRunArtifacts.toArray()).some(row => row.content?.includes('quality-recheck-received-v1'))).toBe(true)
    expect((await db.agentRunEvents.toArray()).filter(row => row.type === 'budget.settled')).toHaveLength(2)
  }, DURABLE_TEST_TIMEOUT)
})
