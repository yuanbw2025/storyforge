import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord, resolveScope } from '../../src/lib/workspace/scope'
import { plainTextToHtml } from '../../src/lib/utils/html'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { runWholeChapterQualityReviewV1, readLatestWholeChapterQualityReviewV1 } from '../../src/lib/agent/run/quality-review-durable'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'

const validCall = async (_messages: unknown, _config: unknown, result: any) => {
  result.completion = 'complete'; result.finishReason = 'stop'
  return JSON.stringify({ summary: '安静收店任务可保留，意见只是建议。', strengths: ['留白'], issues: [] })
}

const old = useAIConfigStore.getState()
async function seed() {
  const f = await seedCurrentWorkspace('全文评审', { genres: ['realism'] })
  const text = '两人安静清点工具。'.repeat(700) + '\n\n没有付款过程，却记录已收款。'
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '收店', summary: '清点后签收，关灯停笔', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId, title: '收店', content: plainTextToHtml(text), wordCount: text.length, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  return { ...f, text, outlineNodeId, chapterId }
}

describe('LFQ7 · 正式全文评审持久证据', () => {
  beforeEach(async () => { await db.delete(); await db.open(); useAIConfigStore.setState({ config: { ...old.config, provider: 'ollama', model: 'whole-review-test', temperature: 0, maxTokens: 4000, contextWindow: 128000 } }) })
  afterEach(() => { useAIConfigStore.setState(old, true); db.close() })

  it('完整正文与登记原文送审一次，章末问题可定位；报告刷新恢复，手稿变化后只读过期，无Canon写回', async () => {
    const f = await seed()
    const original = (await db.chapters.get(f.chapterId))!.content
    const quote = '没有付款过程，却记录已收款。'
    const call = vi.fn(async (messages, _config, result) => {
      expect(messages[1].content).toContain(f.text)
      result.completion = 'complete'; result.finishReason = 'stop'
      return JSON.stringify({ summary: '签收过程需核对', strengths: ['保留安静章节'], issues: [{ dimension: 'causality', confidence: 'uncertain', quote, start: null, end: null, reason: '没有出现付款动作', suggestion: '核对付款，不改变金额' }] })
    })
    const result = await runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'quality', call })
    expect(call).toHaveBeenCalledTimes(1)
    expect(result.report.issues[0].start).toBeGreaterThan(4000)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(original)
    expect((await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'quality' }))?.current).toBe(true)
    await db.chapters.update(f.chapterId, { content: original + '<p>作者新写一段。</p>' })
    const historical = await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'quality' })
    expect(historical?.current).toBe(false)
    expect(historical?.report.artifactHash).toBe(result.report.artifactHash)
  })

  it('假引文拒绝完整报告，不重试；原响应保留', async () => {
    const f = await seed()
    const call = vi.fn(async (_messages, _config, result) => {
      result.completion = 'complete'; result.finishReason = 'stop'
      return JSON.stringify({ summary: '虚构建议', strengths: [], issues: [{ dimension: 'voice', confidence: 'suggestion', quote: '不在原文的句子', start: null, end: null, reason: '猜测问题', suggestion: '不应采用' }] })
    })
    await expect(runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'style', call })).rejects.toThrow('引文')
    expect(call).toHaveBeenCalledTimes(1)
    expect(await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'style' })).toBeNull()
    expect((await db.agentRunArtifacts.toArray()).some(row => row.artifactKind === 'raw-response' && row.content?.includes('不在原文的句子'))).toBe(true)
    const run = (await db.agentRuns.toArray())[0]
    const failed = await readAgentRunV1(f.scope, run.id!)
    expect(failed.projection.state).toBe('failed')
    expect(failed.events.filter(event => event.type === 'run.failed')).toHaveLength(1)
  })

  it.each(['truncated', 'filtered', 'source-changed'] as const)('%s 拒绝完整报告并保留一次请求的结果', async failure => {
    const f = await seed()
    const call = vi.fn(async (_messages, _config, result) => {
      result.completion = 'complete'; result.finishReason = failure === 'truncated' ? 'length' : failure === 'filtered' ? 'content_filter' : 'stop'
      if (failure === 'source-changed') await db.works.update(f.scope.workId, { description: '作者改变场景任务', updatedAt: Date.now() })
      return JSON.stringify({ summary: '尚需作者核对', strengths: [], issues: [] })
    })
    await expect(runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'readability', call })).rejects.toThrow()
    expect(call).toHaveBeenCalledTimes(1)
    expect(await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'readability' })).toBeNull()
    expect((await db.agentRunArtifacts.toArray()).some(row => row.artifactKind === 'raw-response' && row.content?.includes('尚需作者核对'))).toBe(true)
    const run = (await db.agentRuns.toArray())[0]
    expect((await readAgentRunV1(f.scope, run.id!)).projection.state).toBe(failure === 'source-changed' ? 'paused' : 'failed')
  })

  it.each(['transport-failed', 'author-stopped'] as const)('%s 留下终态，刷新不恢复成进行中或重发', async failure => {
    const f = await seed()
    const original = (await db.chapters.get(f.chapterId))!.content
    const controller = new AbortController()
    const call = vi.fn(async () => {
      if (failure === 'author-stopped') controller.abort()
      throw new Error(failure)
    })
    await expect(runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'quality', signal: controller.signal, call })).rejects.toThrow(failure)
    const run = (await db.agentRuns.toArray())[0]
    expect((await readAgentRunV1(f.scope, run.id!)).projection.state).toBe(failure === 'author-stopped' ? 'cancelled' : 'failed')
    expect(await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'quality' })).toBeNull()
    expect(call).toHaveBeenCalledTimes(1)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(original)
  })

  it('另一作品不能查看报告，损坏的原响应不得恢复', async () => {
    const f = await seed()
    await runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'quality', call: validCall })
    const other = await seedCurrentWorkspace('其它作品', { genres: ['realism'] })
    expect(await readLatestWholeChapterQualityReviewV1({ scope: other.scope, chapterId: f.chapterId, mode: 'quality' })).toBeNull()
    const artifact = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response' && row.content?.includes('quality-review-response-v1'))!
    await db.agentRunArtifacts.update(artifact.id!, { content: artifact.content + '伪造正文' })
    await expect(readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'quality' })).rejects.toThrow()
  })

  it('导出保留报告原证据，导入重映射章目标且旧回执失效；删除副本不影响原作品', async () => {
    const f = await seed()
    const report = await runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'readability', call: validCall })
    const backup = await exportProjectJSON(f.scope.projectId)
    const importedId = await importProjectJSON(backup)
    const importedScope = await resolveScope({ projectId: importedId })
    const chapter = await db.chapters.where('projectId').equals(importedId).first()
    const run = await db.agentRuns.where('projectId').equals(importedId).first()
    expect(chapter!.id).not.toBe(f.chapterId)
    expect(JSON.parse(run!.contractJson).scope.chapterIds).toEqual([chapter!.id])
    expect(run!.terminalReceiptHash).toBeNull()
    expect(await readLatestWholeChapterQualityReviewV1({ scope: importedScope, chapterId: chapter!.id!, mode: 'readability' })).toBeNull()
    expect((await db.agentRunArtifacts.where('projectId').equals(importedId).toArray()).some(row => row.content?.includes(report.report.artifactHash))).toBe(true)
    await cascadeDeleteProject(importedId)
    expect(await db.agentRuns.where('projectId').equals(importedId).count()).toBe(0)
    expect(await db.agentRunArtifacts.where('projectId').equals(importedId).count()).toBe(0)
    expect((await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'readability' }))?.report.artifactHash).toBe(report.report.artifactHash)
  })
})
