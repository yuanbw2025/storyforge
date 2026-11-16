import { db } from '../../src/lib/db/schema'
import { readOwnedRows, stampNewRecord } from '../../src/lib/workspace/scope'
import {
  adoptInventoryExtractionCandidateV1,
  generateInventoryExtractionCandidateV1,
  readRecoverableInventoryExtractionV1,
} from '../../src/lib/agent/run/inventory-extraction-durable'
import {
  adoptStoryTimelineExtractionCandidateV1,
  generateStoryTimelineExtractionCandidateV1,
  readRecoverableStoryTimelineExtractionV1,
} from '../../src/lib/agent/run/story-timeline-extraction-durable'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from './current-workspace'

export type ProseExtractionKindV1 = 'inventory' | 'timeline'

export async function seedProseExtractionSourceFixtureV1() {
  const created = await seedCurrentWorkspace('SFQA073 提取来源', { enableMultiWorld: true })
  const scope = created.scope
  const now = Date.now()
  const groupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId: scope.projectId,
    name: '主世界', description: '', type: 'primary', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'world' }))
  const volumeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId,
    worldGroupId: groupId, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0,
    createdAt: now, updatedAt: now,
  }, { owner: 'work' }))
  const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
    projectId: scope.projectId,
    homeWorldGroupId: groupId, name: '归舟', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: '钟楼守卫', appearance: '', personality: '', background: '', motivation: '',
    abilities: '', relationships: '', arc: '', createdAt: now, updatedAt: now,
  }, { owner: 'world' }))
  const chapterIds: number[] = []
  for (let index = 0; index < 2; index++) {
    const title = `第${index + 1}章`
    const outlineId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      projectId: scope.projectId,
      worldGroupId: groupId, parentId: volumeId, type: 'chapter', title, summary: '', order: index,
      createdAt: now + index, updatedAt: now + index,
    }, { owner: 'work' }))
    const content = `<p>归舟在第${index + 1}日进入钟楼，找到了守卫留下的铜钥匙。她仔细确认门上的记号，将钥匙收入背包，并把调查结果记录在纸上。钟声响起时，她沿着台阶离开，准备在明日继续调查旧港的秘密。</p>`
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
      projectId: scope.projectId,
      outlineNodeId: outlineId, title, content, wordCount: content.length, status: 'draft', order: index,
      notes: '', createdAt: now + index, updatedAt: now + index,
    }, { owner: 'work' }))
    chapterIds.push(chapterId)
    await db.itemLedger.add(stampNewRecord(scope, 'itemLedger', {
      projectId: scope.projectId,
      itemName: `旧物品${index}`, heldByName: '归舟', characterId, action: 'gain', quantity: 1,
      chapterId, chapterTitle: title, note: '作者原有物品记录', createdAt: now + index,
    }, { owner: 'work' }))
    await db.storyTimelineEvents.add(stampNewRecord(scope, 'storyTimelineEvents', {
      projectId: scope.projectId,
      title: `旧事件${index}`, storyTime: `第${index + 1}日`, importance: 2, description: '作者原有年表记录',
      chapterId, chapterTitle: title, order: index, createdAt: now + index,
    }, { owner: 'work' }))
  }
  return { scope, chapterIds, characterId }
}

export async function generateProseExtractionCandidateFixtureV1(kind: ProseExtractionKindV1, scope: WorkspaceScope) {
  let calls = 0
  const runAI = async () => {
    const index = calls++
    return JSON.stringify([kind === 'inventory'
      ? { itemName: `新物品${index}`, heldByName: '归舟', action: 'gain', quantity: 1, note: '冻结正文提取' }
      : { title: `新事件${index}`, storyTime: `第${index + 1}日`, importance: 3, description: '冻结正文提取' }])
  }
  const result = kind === 'inventory'
    ? await generateInventoryExtractionCandidateV1({ scope, request: { mode: 'all' }, runAI })
    : await generateStoryTimelineExtractionCandidateV1({ scope, runAI })
  return { ...result, modelCalls: () => calls, selectedIndexes: result.candidate.events.map((_, index) => index) }
}

export function adoptProseExtractionFixtureV1(
  kind: ProseExtractionKindV1,
  input: Parameters<typeof adoptInventoryExtractionCandidateV1>[0],
) {
  return kind === 'inventory' ? adoptInventoryExtractionCandidateV1(input) : adoptStoryTimelineExtractionCandidateV1(input)
}

export function readProseExtractionRowsV1(kind: ProseExtractionKindV1, scope: WorkspaceScope) {
  return readOwnedRows<Record<string, unknown>>(scope, kind === 'inventory' ? 'itemLedger' : 'storyTimelineEvents', { owner: 'work' })
}

export function recoverableProseExtractionV1(kind: ProseExtractionKindV1, scope: WorkspaceScope) {
  return kind === 'inventory' ? readRecoverableInventoryExtractionV1({ scope }) : readRecoverableStoryTimelineExtractionV1({ scope })
}
