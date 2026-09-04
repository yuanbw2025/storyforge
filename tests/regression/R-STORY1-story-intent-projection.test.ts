import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORY_CORE_PANEL_FIELDS } from '../../src/components/worldview/StoryCorePanel'
import {
  STORY_CORE_FIELDS,
  formatStoryCoreGenerationRequestV1,
  prepareStoryCoreCopilot,
} from '../../src/lib/agent/story-core-copilot'
import {
  adoptRestoredStoryArcCandidate,
  prepareStoryArcCopilot,
  type StoryArcCopilotCandidate,
} from '../../src/lib/agent/story-arc-copilot'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { db } from '../../src/lib/db/schema'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import {
  STORY_CORE_GENERATABLE_FIELD_SPECS,
} from '../../src/lib/registry/field-registry'
import { REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import { checkRegistry } from '../../src/lib/registry/validate'
import {
  readStoryCoreIntentSnapshotV1,
  storyArcIntentAlignmentV1,
} from '../../src/lib/storyline/intent-projection'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { cascadeRegisteredReferences } from '../../src/lib/workspace/lifecycle'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { StoryArc, StoryCore, WorkspaceScope } from '../../src/lib/types'
import { seedCurrentProject } from '../helpers/current-workspace'

const NOW = 1_788_300_000_000

async function seedWorkspace(): Promise<{
  projectId: number
  scope: WorkspaceScope
  storyCoreId: number
}> {
  const projectId = await seedCurrentProject({
    workspaceUid: generateWorkspaceUid(),
    name: '潮汐意图工程',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 1_000_000,
    createdAt: NOW,
    updatedAt: NOW,
  } as never) as number
  const { scope } = await resolveWorkspaceOwnership(projectId)
  await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
    projectId,
    worldOrigin: '潮海每十年退潮一次，记忆盐晶成为城市能源。',
    createdAt: NOW,
    updatedAt: NOW,
  }, { owner: 'world' }) as never)
  const fields = Object.fromEntries(STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => [
    spec.field,
    `${spec.aiGeneration.label}的作者意图；[INTENT:${spec.field}]`,
  ]))
  const storyCoreId = await db.storyCores.add(stampNewRecord(scope, 'storyCores', {
    projectId,
    ...fields,
    createdAt: NOW,
    updatedAt: NOW,
  }, { owner: 'work' }) as never) as number
  return { projectId, scope, storyCoreId }
}

function arcCandidate(name = '守灯人的潮钟抉择'): StoryArcCopilotCandidate {
  return {
    name,
    type: 'main',
    description: '把故事核心意图拆成可执行的因果阶段。',
    stages: [
      { title: '发现', description: '发现盐晶来源。', keyEvents: ['发现无主盐晶'] },
      { title: '追索', description: '追索潮钟真相。', keyEvents: ['进入废弃钟塔'] },
      { title: '抉择', description: '承担公开真相的代价。', keyEvents: ['改变潮钟用途'] },
    ],
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe.sequential('STORY-1 · 故事意图与可执行故事线投影', () => {
  it('空项目故事线把无故事核心记录视为有效冻结基线，后来新增意图才标记 stale', async () => {
    const empty = await readStoryCoreIntentSnapshotV1((await resolveWorkspaceOwnership(
      await seedCurrentProject({
        workspaceUid: generateWorkspaceUid(), name: '空意图基线', genres: ['fantasy'],
        description: '', status: 'drafting', targetWordCount: 100_000, createdAt: NOW, updatedAt: NOW,
      } as never) as number,
    )).scope)
    const arc = {
      origin: 'ai', sourceStoryCoreId: null, sourceStoryCoreHash: empty.hash, lastAlignedHash: empty.hash,
    } as StoryArc
    expect(storyArcIntentAlignmentV1(arc, empty)).toBe('aligned')
    expect(storyArcIntentAlignmentV1(arc, { ...empty, storyCoreId: 1, hash: 'a'.repeat(64) })).toBe('stale')
  })

  it('七字段能力、UI、Skill 写集和 Gateway required 目标完全同源', () => {
    const registered = STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => spec.field)
    const skill = getAgentSkillV1('world-origin.story-core')
    const writes = skill.writeTargets.find(target => target.table === 'storyCores')?.fields ?? []
    const required = (skill.contextGateway?.requiredWriteTargets ?? [])
      .map(target => target.replace(/^storyCores\./, ''))
    expect(STORY_CORE_FIELDS).toEqual(registered)
    expect(STORY_CORE_PANEL_FIELDS.map(field => field.key)).toEqual(registered)
    expect(writes).toEqual(registered)
    expect(required).toEqual(registered)
    expect(skill.contextGateway?.rollout).toBe('required')
    expect(checkRegistry()).toMatchObject({ ok: true, errors: [] })
  })

  it.each(STORY_CORE_GENERATABLE_FIELD_SPECS)(
    '$field 把当前目标原文作为 mandatory original 冻结，末位事实不会被前缀截断',
    async spec => {
      const { projectId, scope } = await seedWorkspace()
      const prepared = await prepareStoryCoreCopilot({
        projectId,
        scope,
        worldGroupId: null,
        authorRequest: formatStoryCoreGenerationRequestV1({
          field: spec.field,
          mode: 'expand',
          hint: '保持作者意图，只补充可执行因果。',
        }),
      })
      const execution = prepared.contextGatewayExecution!
      const targetRead = execution.retrievalTrace.mandatory.find(read => (
        read.depth === 'original'
        && read.sourceRefs.some(ref => ref.table === 'storyCores' && ref.field === spec.field)
      ))
      expect(targetRead).toBeDefined()
      expect(targetRead!.sourceRefs).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'storyCores', field: spec.field }),
      ]))
      expect(execution.contextPacket.content).toContain(`[INTENT:${spec.field}]`)
    },
  )

  it('故事线生成冻结全部非空故事意图字段，但仍产出独立的 1:N 候选', async () => {
    const { projectId, scope } = await seedWorkspace()
    const prepared = await prepareStoryArcCopilot({
      projectId,
      scope,
      worldGroupId: null,
      authorRequest: '依据作者故事意图生成一条新的主线故事线',
    })
    const refs = prepared.contextGatewayExecution!.retrievalTrace.mandatory
      .flatMap(read => read.sourceRefs)
      .filter(ref => ref.table === 'storyCores')
    expect(new Set(refs.map(ref => ref.field))).toEqual(new Set(STORY_CORE_FIELDS))
    expect(prepared.prepared.messages.map(message => message.content).join('\n'))
      .toContain('1:N 可执行投影')
    expect(await db.storyArcs.count()).toBe(0)
  })

  it('采纳记录来源、意图 hash 与 producer；意图变化后只标漂移并阻断旧候选，不自动覆盖故事线', async () => {
    const { projectId, scope, storyCoreId } = await seedWorkspace()
    const prepared = await prepareStoryArcCopilot({
      projectId,
      scope,
      worldGroupId: null,
      authorRequest: '依据作者故事意图生成一条新的主线故事线',
    })
    const draft = JSON.stringify([arcCandidate()])
    const producerRunId = await db.agentRuns.add(stampNewRecord(scope, 'agentRuns', {
      projectId,
      status: 'planned',
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'work' }) as never) as number
    const result = await adoptRestoredStoryArcCandidate({
      projectId,
      scope,
      worldGroupId: null,
      snapshot: prepared.snapshot,
      draft,
      producerRunId,
      producerCandidateHash: 'a'.repeat(64),
    })
    const row = await db.storyArcs.get(result.ids[0]) as StoryArc
    expect(row).toMatchObject({
      origin: 'ai',
      status: 'active',
      sourceStoryCoreId: storyCoreId,
      sourceStoryCoreRevision: NOW,
      sourceStoryCoreHash: prepared.snapshot.storyIntent.hash,
      lastAlignedHash: prepared.snapshot.storyIntent.hash,
      producerRunId,
      producerCandidateHash: 'a'.repeat(64),
    })
    expect(storyArcIntentAlignmentV1(row, await readStoryCoreIntentSnapshotV1(scope))).toBe('aligned')

    const before = await db.storyCores.get(storyCoreId) as StoryCore
    await db.storyCores.update(storyCoreId, {
      mainPlot: `${before.mainPlot}\n作者新增的转折意图。`,
      updatedAt: NOW + 1,
    })
    const currentIntent = await readStoryCoreIntentSnapshotV1(scope)
    expect(storyArcIntentAlignmentV1(row, currentIntent)).toBe('stale')
    expect((await db.storyArcs.get(row.id!))?.description).toBe(row.description)
    await expect(adoptRestoredStoryArcCandidate({
      projectId,
      scope,
      worldGroupId: null,
      snapshot: prepared.snapshot,
      draft: JSON.stringify([arcCandidate('旧基线候选')]),
    })).rejects.toThrow('故事线已在候选生成后发生变化')
  })

  it('PROJECT_TABLES 管理故事核心和运行来源引用的删除及导入重映射生命周期', () => {
    const core = REGISTRY_BY_NAME.get('storyCores')!
    const arcs = REGISTRY_BY_NAME.get('storyArcs')!
    const runs = REGISTRY_BY_NAME.get('agentRuns')!
    expect(core.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'storyArcs[sourceStoryCoreId]', onDelete: 'setNull' }),
    ]))
    expect(arcs.exportRemap).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'sourceStoryCoreId', remapVia: 'storyCores' }),
      expect.objectContaining({ field: 'producerRunId', remapVia: 'agentRuns' }),
    ]))
    expect(runs.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'storyArcs[producerRunId]', onDelete: 'setNull' }),
    ]))
    expect(arcs.defaults).toMatchObject({ origin: 'manual', status: 'active' })
  })

  it('删除故事核心或 producer run 时只 setNull 来源引用，不误删作者故事线', async () => {
    const { projectId, scope, storyCoreId } = await seedWorkspace()
    const producerRunId = await db.agentRuns.add(stampNewRecord(scope, 'agentRuns', {
      projectId,
      status: 'planned',
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'work' }) as never) as number
    const arcId = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', {
      projectId,
      name: '保留的作者故事线',
      type: 'main',
      stages: '[]',
      description: '',
      origin: 'ai',
      status: 'active',
      sourceStoryCoreId: storyCoreId,
      producerRunId,
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'work' }) as never) as number
    await cascadeRegisteredReferences('storyCores', storyCoreId)
    await db.storyCores.delete(storyCoreId)
    expect(await db.storyArcs.get(arcId)).toMatchObject({
      id: arcId,
      sourceStoryCoreId: null,
      producerRunId,
    })
    await cascadeRegisteredReferences('agentRuns', producerRunId)
    await db.agentRuns.delete(producerRunId)
    expect(await db.storyArcs.get(arcId)).toMatchObject({
      id: arcId,
      sourceStoryCoreId: null,
      producerRunId: null,
    })
  })
})
