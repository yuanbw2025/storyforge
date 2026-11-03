import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from './current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, DetailedOutline, OutlineNode } from '../../src/lib/types'
import { CHAPTER_TEXT_NORMALIZATION_VERSION, hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'

export const CONTINUITY_MARKERS = { summary: '摘要事实：只带蓝钥匙。', continuityHandoff: '交接事实：停在蓝门。', planReconciliation: '对账事实：没有红钥匙。' }

export async function seedSFQA086Continuity() {
  const created = await seedCurrentWorkspace('SFQA086独立正文')
  const { scope } = created
  const volumeId = await db.outlineNodes.add(stampNewRecord<OutlineNode>(scope, 'outlineNodes', { projectId: scope.projectId, parentId: null, type: 'volume', title: '第一卷', summary: '调查', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
  const outlineIds = await db.outlineNodes.bulkAdd([0, 1].map(index => stampNewRecord<OutlineNode>(scope, 'outlineNodes', { projectId: scope.projectId, parentId: volumeId, type: 'chapter', title: `第${index + 1}章`, summary: index ? '打开蓝门' : '抵达蓝门', order: index, createdAt: 1, updatedAt: 1 }, { owner: 'work' })), { allKeys: true })
  const content = '<p>当前作者原文：林只带了蓝钥匙，停在蓝门。</p>'
  const sourceTextHash = await hashChapterText(content)
  const priorBase = stampNewRecord<Chapter>(scope, 'chapters', {
    projectId: scope.projectId, outlineNodeId: outlineIds[0], title: '第一章', content, wordCount: 24, status: 'final', order: 0, notes: '',
    summary: CONTINUITY_MARKERS.summary, summarySourceTextHash: sourceTextHash, summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
    createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })
  const priorId = await db.chapters.add(priorBase)
  const derived: Pick<Chapter, 'continuityHandoff' | 'planReconciliation'> = {
    continuityHandoff: { chapterId: priorId, sourceTextHash, schemaVersion: 1, extractorVersion: 'sfqa086-fixture-v1', textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION, finalScene: { location: CONTINUITY_MARKERS.continuityHandoff, activeCharacters: ['林'] }, stateChanges: [], knowledgeChanges: [], commitments: [], openLoops: [], evidenceQuotes: [], generatedAt: 1 },
    planReconciliation: { chapterId: priorId, sourceTextHash, planSourceHash: 'b'.repeat(64), schemaVersion: 1, extractorVersion: 'sfqa086-fixture-v1', textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION, reviewStatus: 'confirmed-constraint', confirmedActualProgress: CONTINUITY_MARKERS.planReconciliation, completedGoals: [], unfinishedGoals: [], deviations: [], newConstraints: [], nextChapterImpacts: [], generatedAt: 1 },
  }
  await db.chapters.update(priorId, derived)
  const priorRow = { ...priorBase, ...derived }
  const targetId = await db.chapters.add(stampNewRecord<Chapter>(scope, 'chapters', { projectId: scope.projectId, outlineNodeId: outlineIds[1], title: '第二章', content: '', wordCount: 0, status: 'outline', order: 1, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
  await db.detailedOutlines.add(stampNewRecord<DetailedOutline>(scope, 'detailedOutlines', { projectId: scope.projectId, outlineNodeId: outlineIds[1], scenes: [{ sceneId: 'open-door', title: '开门', summary: '林确认蓝钥匙后打开蓝门', characterIds: [], location: '蓝门', conflict: '锁紧', pace: 'medium', estimatedWords: 800, notes: '' }], openingHook: '停在蓝门', endingCliffhanger: '门内亮灯', sceneLocation: '蓝门', appearingCharacterIds: [], foreshadowIds: [], emotionArc: 'rising', prohibitions: ['不要添加红钥匙'], createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
  const frozenScope = { ...scope, worldGroupId: null, chapterId: targetId, characterId: null }
  const key = `chapter:${priorRow.ragDocumentId}:continuity-tail`
  return { created, priorId, targetId, outlineId: outlineIds[1], key, frozenScope, priorRow }
}
