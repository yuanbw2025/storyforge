import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { resolveCanonicalChapterSequence } from '../../src/lib/ai/chapter-memory/canonical-chapter-sequence'
import { prepareContinuityContext } from '../../src/lib/ai/chapter-memory/continuity-context'
import {
  CHAPTER_TEXT_NORMALIZATION_VERSION,
  hashChapterText,
} from '../../src/lib/ai/chapter-memory/text-normalization'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import type { Chapter, OutlineNode } from '../../src/lib/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

const now = Date.now()

function node(id: number, parentId: number | null, order: number, type: OutlineNode['type'] = 'chapter'): OutlineNode {
  return {
    id, projectId: 1, parentId, order, type, title: `N${id}`, summary: '',
    createdAt: now, updatedAt: now,
  }
}

function chapter(id: number, outlineNodeId: number, order: number): Chapter {
  return {
    id, projectId: 1, outlineNodeId, order, title: `C${id}`, content: `正文${id}`,
    wordCount: 3, status: 'draft', notes: '', createdAt: now, updatedAt: now,
  }
}

describe('NS-1 T4/T5 · canonical sequence and continuity sources', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('uses outline sibling order instead of stale Chapter.order and follows reorder', () => {
    const volume = node(1, null, 0, 'volume')
    const first = node(2, 1, 0)
    const second = node(3, 1, 1)
    const chapters = [
      chapter(10, 2, 99),
      chapter(11, 3, 0),
    ]
    expect(resolveCanonicalChapterSequence([volume, first, second], chapters).sequence.map(item => item.chapter.id))
      .toEqual([10, 11])

    first.order = 1
    second.order = 0
    expect(resolveCanonicalChapterSequence([volume, first, second], chapters).sequence.map(item => item.chapter.id))
      .toEqual([11, 10])
  })

  it('routes generation and continuation through registered continuity sources', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/editor/ChapterEditor.tsx'), 'utf8')
    const gateway = readFileSync(resolve(process.cwd(), 'src/lib/prose/gateway-context.ts'), 'utf8')
    const generationFlow = source.slice(
      source.indexOf('const buildFullWorldCtx = async'),
      source.indexOf('const handlePolish = () => {'),
    )
    expect(generationFlow).toContain('prepareProseGatewayAssemblyV1')
    expect(gateway).toContain(':continuity-tail`')
    expect(gateway).toContain(':consistency-dossier`')
    expect(generationFlow).not.toContain('sourceKeys:')
    expect(generationFlow).not.toContain('chapters.filter(c => c.order <')
  })

  it('degrades deterministically and reports dirty-tree anomalies', () => {
    const a = node(1, 2, 0)
    const b = node(2, 1, 0)
    const orphan = node(3, 999, 0)
    const duplicate = chapter(11, 1, 5)
    const result = resolveCanonicalChapterSequence(
      [a, b, orphan],
      [chapter(10, 1, 9), duplicate, chapter(12, 404, 0)],
    )

    expect(result.sequence.map(item => item.chapter.id)).toEqual([10, 12])
    expect(result.anomalies.map(item => item.kind)).toEqual(expect.arrayContaining([
      'outline-cycle',
      'orphan-outline-node',
      'duplicate-chapter-mapping',
      'chapter-without-outline',
    ]))
  })

  it('keeps cross-world direct predecessor handoff/tail but summaries only from current world', async () => {
    const projectId = await seedCurrentProject({
      name: '多世界承接', genres: ['fantasy'], description: '', targetWordCount: 1000,
      enableMultiWorld: true, createdAt: now, updatedAt: now,
    } as any) as number
    const worldA = await db.worldGroups.add({
      projectId, name: '火界', description: '', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '冰界', description: '', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number
    const volumeA1 = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '火界一', summary: '', order: 0,
      worldGroupId: worldA, createdAt: now, updatedAt: now,
    } as any) as number
    const volumeB = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '冰界', summary: '', order: 1,
      worldGroupId: worldB, createdAt: now, updatedAt: now,
    } as any) as number
    const volumeA2 = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '火界二', summary: '', order: 2,
      worldGroupId: worldA, createdAt: now, updatedAt: now,
    } as any) as number
    const nodeA = await db.outlineNodes.add({
      projectId, parentId: volumeA1, type: 'chapter', title: '火界旧章', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const nodeB = await db.outlineNodes.add({
      projectId, parentId: volumeB, type: 'chapter', title: '冰界转场章', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const nodeCurrent = await db.outlineNodes.add({
      projectId, parentId: volumeA2, type: 'chapter', title: '回到火界', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const nodeFuture = await db.outlineNodes.add({
      projectId, parentId: volumeA2, type: 'chapter', title: '未来章', summary: '', order: 1,
      createdAt: now, updatedAt: now,
    } as any) as number

    const contentA = '<p>火界旧事实：赤钥仍在林砚手中。</p>'
    const hashA = await hashChapterText(contentA)
    const chapterA = await db.chapters.add({
      projectId, outlineNodeId: nodeA, title: '火界旧章', content: contentA, wordCount: 10,
      status: 'draft', order: 99, notes: '', summary: '林砚保留赤钥。',
      summarySourceTextHash: hashA,
      summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      createdAt: now, updatedAt: now,
    } as any) as number
    const contentB = '<p>冰界结尾：苏禾推开返回火界的门。</p>'
    const hashB = await hashChapterText(contentB)
    const chapterB = await db.chapters.add({
      projectId, outlineNodeId: nodeB, title: '冰界转场章', content: contentB, wordCount: 10,
      status: 'draft', order: 0, notes: '', summary: '苏禾准备离开冰界。',
      summarySourceTextHash: hashB,
      summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      createdAt: now, updatedAt: now,
    } as any) as number
    await db.chapters.update(chapterB, {
      continuityHandoff: {
        chapterId: chapterB,
        sourceTextHash: hashB,
        schemaVersion: 1,
        extractorVersion: 'test',
        textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
        finalScene: { location: '冰界门前', activeCharacters: ['苏禾'], lastAction: '推开门' },
        stateChanges: [],
        knowledgeChanges: [],
        commitments: ['返回火界'],
        openLoops: ['门后是否安全'],
        evidenceQuotes: [],
        generatedAt: now,
      },
      planReconciliation: {
        chapterId: chapterB,
        sourceTextHash: hashB,
        planSourceHash: 'plan-hash',
        schemaVersion: 1,
        extractorVersion: 'test',
        textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
        completedGoals: [],
        unfinishedGoals: [],
        deviations: [{
          text: '苏禾实际已经推开返回火界的门',
          evidenceQuotes: [{ quote: '苏禾推开返回火界的门。', startOffset: 5, endOffset: 18 }],
        }],
        newConstraints: [],
        nextChapterImpacts: [{
          text: '下一章必须从跨界后的现场继续',
          evidenceQuotes: [{ quote: '苏禾推开返回火界的门。', startOffset: 5, endOffset: 18 }],
        }],
        reviewStatus: 'confirmed-constraint',
        confirmedActualProgress: '苏禾已经穿过返回火界的门',
        generatedAt: now,
      },
    })
    const currentId = await db.chapters.add({
      projectId, outlineNodeId: nodeCurrent, title: '回到火界', content: '', wordCount: 0,
      status: 'outline', order: 1, notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    await db.chapters.add({
      projectId, outlineNodeId: nodeFuture, title: '未来章', content: '<p>未来泄漏事实</p>', wordCount: 6,
      status: 'outline', order: -1, notes: '', summary: '未来泄漏摘要',
      createdAt: now, updatedAt: now,
    } as any)
    await finalizeCurrentFixtureV1(projectId)

    const snapshot = await prepareContinuityContext({ projectId, chapterId: currentId })
    expect(snapshot.predecessor?.chapter.id).toBe(chapterB)
    expect(snapshot.previousTailText).toContain('冰界结尾')
    expect(snapshot.previousTailText).toContain('跨世界转场')
    expect(snapshot.handoffText).toContain('返回火界')
    expect(snapshot.planReconciliationText).toContain('实际已经推开')
    expect(snapshot.recentSummariesText).toContain('林砚保留赤钥')
    expect(snapshot.recentSummariesText).not.toContain('苏禾准备离开冰界')
    expect(snapshot.recentSummariesText).not.toContain('未来泄漏摘要')
    expect(snapshot.memoryRebuildCandidateIds).not.toContain(chapterA)

    const assembled = await assembleContext({
      projectId,
      chapterId: currentId,
      sourceKeys: [
        'chapterContinuityHandoff',
        'previousPlanReconciliation',
        'previousChapterEnding',
        'recentChapterSummaries',
      ],
    })
    expect(assembled.included).toEqual([
      'chapterContinuityHandoff',
      'previousPlanReconciliation',
      'previousChapterEnding',
      'recentChapterSummaries',
    ])
    expect(assembled.text).toContain('冰界门前')
    expect(assembled.text).toContain('下一章必须从跨界后的现场继续')
    expect(assembled.text).toContain('林砚保留赤钥')
    expect(assembled.text).not.toContain('未来泄漏事实')
  })
})
