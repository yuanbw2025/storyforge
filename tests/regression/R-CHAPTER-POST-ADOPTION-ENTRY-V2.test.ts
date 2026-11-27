import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { FORMAL_AI_ENTRY_REGISTRY_V1 } from '../../src/lib/agent/formal-ai-entry'
import {
  buildPostAdoptionAuthorizationSnapshotV1,
  resolveWorkPostAdoptionSettingsV1,
} from '../../src/lib/prose/post-adoption-policy'
import { createChapterPostAdoptionDurableRunV1, CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1 } from '../../src/lib/agent/run/chapter-post-adoption-durable'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import type { WorkspaceScope } from '../../src/lib/types'

async function seed(label: string): Promise<{ scope: WorkspaceScope; chapterId: number }> {
  const now = Date.now()
  const created = await seedCurrentWorkspace(label)
  const scope = created.scope
  await db.works.update(scope.workId, {
    description: '守灯人在风暴夜收到没有寄件人的信。', updatedAt: now,
  })
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, parentId: null, type: 'chapter', title: `${label}章`, summary: '',
    order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId: scope.projectId, outlineNodeId, title: `${label}章`,
    content: '<p>守灯人推开木门，决定沿海堤寻找铜铃。</p>', wordCount: 20, status: 'draft',
    order: 0, notes: '', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  await stampCurrentFixtureResourceUidsV1(scope.projectId)
  return { scope, chapterId }
}

describe('B03 收尾 · prose.memory.v2/organize.v2 formal 登记', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('两个 V2 Skill 按能力管理输出，不再携带固定输出档位', () => {
    const organize = getAgentSkillV1('prose.organize.v2', 'prose')
    const memory = getAgentSkillV1('prose.memory.v2', 'prose')
    expect(organize.maxOutputTokens).toBeNull()
    expect(memory.maxOutputTokens).toBeNull()
    // 与 V1 同族：来源、写目标与输入策略不变，不新增第二套业务 owner。
    expect(organize.contextSourceKeys).toEqual(getAgentSkillV1('prose.organize', 'prose').contextSourceKeys)
    expect(memory.contextSourceKeys).toEqual(getAgentSkillV1('prose.memory', 'prose').contextSourceKeys)
    expect(organize.writeTargets).toEqual(getAgentSkillV1('prose.organize', 'prose').writeTargets)
    expect(memory.writeTargets).toEqual(getAgentSkillV1('prose.memory', 'prose').writeTargets)
    // 新 Skill 没有借用完整请求策略；V2 冻结合同不要求 taskRequest。
    expect((organize as { requestPolicy?: string }).requestPolicy).toBeUndefined()
    expect((memory as { requestPolicy?: string }).requestPolicy).toBeUndefined()
  })

  it('AI 入口注册表替换为 V2 行，调用方与写集合准确绑定', () => {
    const entries = FORMAL_AI_ENTRY_REGISTRY_V1.entries
    expect(entries.filter(entry => entry.entryId === 'prose.chapter.memory.v2')).toHaveLength(1)
    expect(entries.filter(entry => entry.entryId === 'prose.chapter.organize.v2')).toHaveLength(1)
    // 旧 entryId 已移除，新开始不会静默回落旧身份。
    expect(entries.some(entry => entry.entryId === 'prose.chapter.memory')).toBe(false)
    expect(entries.some(entry => entry.entryId === 'prose.chapter.organize')).toBe(false)
    const memoryEntry = entries.find(entry => entry.entryId === 'prose.chapter.memory.v2')!
    const organizeEntry = entries.find(entry => entry.entryId === 'prose.chapter.organize.v2')!
    for (const entry of [memoryEntry, organizeEntry]) {
      expect(entry.entryKind).toBe('formal')
      expect(entry.allowedCallers).toEqual(['src/lib/prose/post-adoption-runner.ts', 'src/components/editor/ChapterEditor.tsx'])
    }
    expect(memoryEntry.adoptionTargets).toEqual(['chapters'])
    expect(organizeEntry.adoptionTargets).toEqual([
      'stateCards', 'temporalFacts', 'itemLedger', 'storyTimelineEvents', 'characterRelations',
      'foreshadows', 'storylineProgress', 'storylineCrossings', 'storyArcs',
    ])
  })

  it('新章后 Run 绑定 V2 Skill；旧 V1 合同通过同族兼容断言可读', async () => {
    const { scope, chapterId } = await seed('entry-v2')
    const chapter = await db.chapters.get(chapterId)
    const authorization = await buildPostAdoptionAuthorizationSnapshotV1({
      scope, chapterId, sourceTextHash: await hashChapterText(chapter!.content),
      modelRoutes: [
        { taskType: 'organization', provider: 'gemini', model: 'gemini-3.5-flash' },
        { taskType: 'memory', provider: 'gemini', model: 'gemini-3.5-flash' },
      ],
      settings: resolveWorkPostAdoptionSettingsV1(null),
    })
    const snapshot = await createChapterPostAdoptionDurableRunV1({ scope, worldGroupId: null, chapterId, authorization })
    const bindings = snapshot.contract.executionBindings ?? []
    expect(bindings.map(binding => binding.skillId).sort()).toEqual(['prose.consistency', 'prose.memory.v2', 'prose.organize.v2'])
    expect(CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization).toEqual([...getAgentSkillV1('prose.organize.v2', 'prose').contextSourceKeys])
    expect(CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.memory).toEqual([...getAgentSkillV1('prose.memory.v2', 'prose').contextSourceKeys])
  })
})
