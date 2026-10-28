import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import * as workspaceScope from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { parseChapterOrganizationOutput, persistChapterOrganizationCandidate, readLatestChapterOrganizationRun, selectAllChapterOrganizationCandidates } from '../../src/lib/agent/chapter-organization'
import { hashChapterOrganizationCandidateV1 } from '../../src/lib/agent/run/chapter-organization-durable'
import { readChapterOrganizationSelectionV1, saveChapterOrganizationSelectionV1 } from '../../src/lib/agent/chapter-organization-selection'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

async function seed() {
  const { scope } = await seedCurrentWorkspace('整理选择保存隔离验证')
  const base = { projectId: scope.projectId, createdAt: 1, updatedAt: 1 }
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: '潮门', summary: '', order: 0 }, { owner: 'work' }))
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...base, outlineNodeId, title: '潮门', content: '<p>林舟拾起钥匙。</p>', wordCount: 7, status: 'draft', order: 0, notes: '' }, { owner: 'work' }))
  const candidate = parseChapterOrganizationOutput({ raw: JSON.stringify({ authorSelection: { inventoryEvents: [] }, inventoryEvents: [{ itemName: '钥匙', heldByName: '林舟', quantity: 1, action: 'gain', note: '拾起', sourceQuote: '林舟拾起钥匙。' }] }), projectId: scope.projectId, chapterId, chapterTitle: '潮门', worldGroupId: null, chapterText: '林舟拾起钥匙。', sourceTextHash: 'isolated-test-hash', characters: [], existingRelations: [], foreshadows: [], budget: new AgentTeamBudgetTracker('balanced').snapshot() })!
  expect(candidate.inventoryEvents).toHaveLength(1)
  const run = await persistChapterOrganizationCandidate(candidate)
  const selection = { ...selectAllChapterOrganizationCandidates(candidate), inventoryEvents: [] }
  return { run, selection, chapter: await db.chapters.get(chapterId) }
}

beforeEach(() => resetPendingEditCoordinatorForTestsV1())
afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1() })

describe('已有章后整理的作者选择持久化', () => {
  it('默认兼容旧候选，关闭后可回读取消项，选择不改变模型候选哈希或写入正文、业务表', async () => {
    const { run, selection, chapter } = await seed()
    expect(readChapterOrganizationSelectionV1(run.candidate).selection.inventoryEvents).toEqual([0])
    const beforeHash = await hashChapterOrganizationCandidateV1(run.candidate)
    const saved = await saveChapterOrganizationSelectionV1({ run, selection })
    const loaded = await readLatestChapterOrganizationRun({ projectId: run.candidate.projectId, chapterId: run.candidate.chapterId })
    expect(loaded?.event.payload).toBe(saved.event.payload)
    expect(readChapterOrganizationSelectionV1(loaded!.candidate)).toEqual({ selection, error: null })
    expect(run.candidate.authorSelection).toBeUndefined()
    expect(await hashChapterOrganizationCandidateV1(saved.candidate)).toBe(beforeHash)
    expect(await hashChapterOrganizationCandidateV1({ ...saved.candidate, chapterTitle: '被改动' })).not.toBe(beforeHash)
    expect(await db.chapters.get(chapter!.id!)).toEqual(chapter)
    expect(await db.itemLedger.count()).toBe(0)
    expect(await db.storyTimelineEvents.count()).toBe(0)
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })

  it.each(['重复', '越界', '未知分类', '缺失分类', '稀疏数组', '非对象'])('损坏的%s不会恢复全选或覆盖原始载荷', async kind => {
    const { run } = await seed()
    const malformed: any = selectAllChapterOrganizationCandidates(run.candidate)
    if (kind === '重复') malformed.inventoryEvents = [0, 0]
    if (kind === '越界') malformed.inventoryEvents = [1]
    if (kind === '未知分类') malformed.secret = []
    if (kind === '缺失分类') delete malformed.facts
    if (kind === '稀疏数组') malformed.inventoryEvents = new Array(1)
    const candidate = { ...run.candidate, authorSelection: kind === '非对象' ? null : malformed }
    const result = readChapterOrganizationSelectionV1(candidate as any)
    expect(result.error).toMatch(/格式异常/u)
    expect(Object.values(result.selection).every(indexes => indexes.length === 0)).toBe(true)
    await expect(saveChapterOrganizationSelectionV1({ run, selection: candidate.authorSelection as any })).rejects.toThrow()
    expect((await db.agentEvents.get(run.event.id!))?.payload).toBe(run.event.payload)
  })

  it('作用域读取尚未完成时立即登记保存屏障，避免正式动作抢在写入前面', async () => {
    const { run, selection } = await seed()
    const original = workspaceScope.resolveScopeLike
    let release!: () => void
    const pendingScope = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(workspaceScope, 'resolveScopeLike').mockImplementationOnce(async input => { await pendingScope; return original(input) })
    const write = saveChapterOrganizationSelectionV1({ run, selection })
    let flushed = false
    const barrier = flushPendingEditsV1().then(() => { flushed = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(flushed).toBe(false)
    release()
    await write; await barrier
    expect(flushed).toBe(true)
    expect(JSON.parse((await db.agentEvents.get(run.event.id!))!.payload).authorSelection).toEqual(selection)
  })

  it('旧页面的写入被拒绝，不覆盖较新的选择，并保留失败屏障', async () => {
    const { run, selection } = await seed()
    const saved = await saveChapterOrganizationSelectionV1({ run, selection })
    await expect(saveChapterOrganizationSelectionV1({ run, selection: selectAllChapterOrganizationCandidates(run.candidate) })).rejects.toThrow('另一页面')
    expect((await db.agentEvents.get(run.event.id!))?.payload).toBe(saved.event.payload)
    await expect(flushPendingEditsV1()).rejects.toThrow('另一页面')
  })

  it.each(['事件', '归档'])('%s更新零行时回滚，明确重试后才确认成功', async target => {
    const { run, selection } = await seed()
    const table = target === '事件' ? db.agentEvents : db.agentConversations
    vi.spyOn(table, 'update').mockResolvedValueOnce(0)
    await expect(saveChapterOrganizationSelectionV1({ run, selection })).rejects.toThrow('未保存')
    expect((await db.agentEvents.get(run.event.id!))?.payload).toBe(run.event.payload)
    await expect(flushPendingEditsV1()).rejects.toThrow('未保存')
    const saved = await saveChapterOrganizationSelectionV1({ run, selection })
    expect(saved.candidate.authorSelection).toEqual(selection)
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })

  it('拒绝把另一个作品的候选冒充为当前作品', async () => {
    const { run, selection } = await seed()
    const other = await seedCurrentWorkspace('隔离另一作品')
    await expect(saveChapterOrganizationSelectionV1({ run: { ...run, candidate: { ...run.candidate, projectId: other.scope.projectId } }, selection })).rejects.toThrow('不属于当前作品')
    expect((await db.agentEvents.get(run.event.id!))?.payload).toBe(run.event.payload)
  })
})
