import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import {
  buildPostAdoptionAuthorizationSnapshotV1,
  resolveWorkPostAdoptionSettingsV1,
} from '../../src/lib/prose/post-adoption-policy'
import { parseChapterMemoryOutput } from '../../src/lib/ai/adapters/chapter-memory-adapter'
import { formatHandoff } from '../../src/lib/ai/chapter-memory/handoff-format'
import { hashChapterText, normalizeChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { generateWorkCode } from '../../src/lib/memory/identity'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'

async function seedLongChapter(label: string, chapterContent: string): Promise<{
  scope: WorkspaceScope
  chapterId: number
}> {
  const now = Date.now()
  const created = await seedCurrentWorkspace(label)
  const scope = created.scope
  const { projectId, worldId } = scope
  await db.works.put(currentWorkFixtureRecordV1({
    projectId,
    worldId,
    code: generateWorkCode(),
    title: label,
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 1_000_000,
    kind: 'novel',
    novelProfile: 'long',
    createdAt: now,
    updatedAt: now,
  }))
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId,
    parentId: null,
    type: 'chapter',
    title: `${label}章`,
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId,
    outlineNodeId,
    title: `${label}章`,
    content: chapterContent,
    wordCount: chapterContent.length,
    status: 'revised',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return { scope, chapterId }
}

describe.sequential('B03b · 章后任务不再落固定 24k/8k/条数配额', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('长章授权预算按真实材料与模型能力测算，不回落 24k 输入/8k 输出常数', async () => {
    // ~40k CJK chars ≈ 60k tokens：远超旧的 24k 单步装配上限。
    const longChapter = '潮门港的守灯人在长夜里逐盏点亮航标。'.repeat(2_400)
    const { scope, chapterId } = await seedLongChapter('long-estimate', longChapter)
    const chapter = await db.chapters.get(chapterId)
    const authorization = await buildPostAdoptionAuthorizationSnapshotV1({
      scope,
      chapterId,
      sourceTextHash: await hashChapterText(chapter!.content),
      modelRoutes: [
        { taskType: 'organization', provider: 'gemini', model: 'gemini-3.5-flash' },
        { taskType: 'memory', provider: 'gemini', model: 'gemini-3.5-flash' },
      ],
      settings: resolveWorkPostAdoptionSettingsV1(null),
    })
    const expectedInput = Math.max(1_000, estimateTokens(normalizeChapterText(longChapter)) + 2_000)
    // 每个模型步读取一次全章材料；输入上限随正文走而不是 2×24k。
    expect(authorization.estimate.inputTokens.max).toBe(expectedInput * 2)
    expect(authorization.estimate.inputTokens.max).toBeGreaterThan(48_000)
    // 输出预测随材料伸缩（七域证据 JSON 约为正文的一半），不再固定 8k。
    expect(authorization.estimate.outputTokens.max).toBeGreaterThan(8_000)
  })

  it('章节记忆解析保留全部引文/状态/对账条目，不截 24 条/16 项/6 引文', async () => {
    const quoteCount = 30
    const quotes = Array.from({ length: quoteCount }, (_, index) => `第${index + 1}盏航标在雾中亮起。`)
    const normalizedText = quotes.join('\n')
    const itemCount = 20
    const raw = JSON.stringify({
      summary: '守灯人完成整轮巡检。',
      handoff: {
        finalScene: {
          location: '潮门灯塔',
          storyTime: '黎明前',
          activeCharacters: Array.from({ length: 12 }, (_, index) => `角色${index + 1}`),
          lastAction: '熄灭最后一盏信号灯',
        },
        stateChanges: Array.from({ length: 30 }, (_, index) => `状态变化${index + 1}`),
        knowledgeChanges: Array.from({ length: 25 }, (_, index) => `认知变化${index + 1}`),
        commitments: Array.from({ length: 26 }, (_, index) => `承诺${index + 1}`),
        openLoops: Array.from({ length: 28 }, (_, index) => `未闭环${index + 1}`),
        immediateNextIntent: '返回邮局',
        evidenceQuotes: quotes.map(quote => ({ quote })),
      },
      planReconciliation: {
        completedGoals: Array.from({ length: itemCount }, (_, index) => ({
          text: `已完成目标${index + 1}`,
          evidenceQuotes: [{ quote: quotes[index % quoteCount] }],
        })),
        unfinishedGoals: [],
        deviations: [],
        newConstraints: [],
        nextChapterImpacts: [],
        proposedOutlineSummary: '',
      },
    })
    const parsed = parseChapterMemoryOutput({
      raw,
      chapterId: 1,
      normalizedText,
      sourceTextHash: 'hash',
      planSourceHash: 'plan-hash',
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.handoff.evidenceQuotes).toHaveLength(quoteCount)
    expect(parsed!.handoff.stateChanges).toHaveLength(30)
    expect(parsed!.handoff.knowledgeChanges).toHaveLength(25)
    expect(parsed!.handoff.commitments).toHaveLength(26)
    expect(parsed!.handoff.openLoops).toHaveLength(28)
    expect(parsed!.handoff.finalScene.activeCharacters).toHaveLength(12)
    expect(parsed!.planReconciliation!.completedGoals).toHaveLength(itemCount)
    expect(parsed!.planReconciliation!.completedGoals.every(item => item.evidenceQuotes.length === 1)).toBe(true)
  })

  it('直接交接序列化全部已验证引文，不再只取前 6 条', () => {
    const quotes = Array.from({ length: 10 }, (_, index) => ({
      quote: `第${index + 1}条逐字证据`,
      startOffset: index * 8,
      endOffset: index * 8 + 7,
    }))
    const lines = formatHandoff({
      chapterId: 1,
      sourceTextHash: 'hash',
      schemaVersion: 1,
      extractorVersion: 'test',
      textNormalizationVersion: 'v1',
      finalScene: { activeCharacters: [] },
      stateChanges: [],
      knowledgeChanges: [],
      commitments: [],
      openLoops: [],
      evidenceQuotes: quotes,
      generatedAt: Date.now(),
    })
    const evidenceLine = lines.find(line => line.startsWith('证据引文：'))!
    quotes.forEach(item => expect(evidenceLine).toContain(item.quote))
  })
})
