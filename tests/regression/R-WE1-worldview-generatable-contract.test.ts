import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WORLDVIEW_HUMANITY_AGENT_FIELDS } from '../../src/components/worldview/WorldviewHumanityPanel'
import { WORLDVIEW_NATURAL_AGENT_FIELDS } from '../../src/components/worldview/WorldviewNaturalPanel'
import { WORLDVIEW_ORIGIN_AGENT_FIELDS } from '../../src/components/worldview/WorldviewOriginPanel'
import {
  WORLDVIEW_AGENT_FIELDS,
  WORLDVIEW_AGENT_FIELD_CAPABILITIES,
  WorldviewFieldCopilotStaleError,
  adoptRestoredWorldviewFieldCandidate,
  parseWorldviewFieldCandidateDraft,
  prepareWorldviewFieldCopilot,
  worldviewFieldCandidateMatchesRowV1,
  type WorldviewAgentField,
} from '../../src/lib/agent/worldview-field-copilot'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { db } from '../../src/lib/db/schema'
import {
  FIELD_BY_TARGET,
  WORLDVIEW_GENERATABLE_FIELD_SPECS,
} from '../../src/lib/registry/field-registry'
import { checkRegistry } from '../../src/lib/registry/validate'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { NaturalResources, WorkspaceScope } from '../../src/lib/types'

const NOW = 1_788_200_000_000

async function seedWorkspace(name: string): Promise<{ projectId: number; scope: WorkspaceScope }> {
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name,
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 1_000_000,
    createdAt: NOW,
    updatedAt: NOW,
  } as never) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  return { projectId, scope: ownership.scope }
}

function candidateValue(field: WorldviewAgentField): string | Record<string, unknown> {
  if (field === 'divineDesign') {
    return {
      hasDivinity: true,
      divineRank: '潮母之下设守潮神。',
      divineNames: '潮母与盐灯神。',
      divineRules: '不得夺取未自愿典当的记忆。',
    }
  }
  if (field === 'naturalResources') {
    return {
      rareCreatures: '负潮鲸沿盐路迁徙。',
      herbs: '回声藻只在退潮后一刻采集。',
      minerals: '记忆盐晶会记录最近一次誓言。',
      others: '雾织物可隔绝短时记忆读取。',
    } satisfies NaturalResources
  }
  return `${field} 的可执行设定，包含边界、因果和故事张力。`
}

function completeWorldview(): Record<string, unknown> {
  return Object.fromEntries(WORLDVIEW_AGENT_FIELDS.map(field => [field, candidateValue(field)]))
}

function lateFactValue(field: WorldviewAgentField): string | Record<string, unknown> {
  const marker = `[LATE:${field}]`
  const prefix = '既有设定用于验证目标字段末位事实不会因通用截断而消失。'.repeat(80)
  if (field === 'divineDesign') {
    return {
      hasDivinity: true,
      divineRank: prefix,
      divineNames: '潮母与盐灯神。',
      divineRules: `${prefix}${marker}`,
    }
  }
  if (field === 'naturalResources') {
    return {
      rareCreatures: prefix,
      herbs: '回声藻只在退潮后一刻采集。',
      minerals: '记忆盐晶会记录最近一次誓言。',
      others: `${prefix}${marker}`,
    } satisfies NaturalResources
  }
  return `${prefix}${marker}`
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe.sequential('WE-1 · FIELD_REGISTRY 派生的世界观统一 Harness 合同', () => {
  it('字段能力、Skill 写集、Gateway required 目标和三个 UI 分区完全同源', () => {
    const registered = WORLDVIEW_GENERATABLE_FIELD_SPECS.map(spec => spec.field).sort()
    const agent = [...WORLDVIEW_AGENT_FIELDS].sort()
    const skill = getAgentSkillV1('world-origin.worldview-field')
    const writeFields = [...(skill.writeTargets.find(target => target.table === 'worldviews')?.fields ?? [])].sort()
    const requiredTargets = [...(skill.contextGateway?.requiredWriteTargets ?? [])]
      .map(target => target.replace(/^worldviews\./, ''))
      .sort()
    const uiFields = [
      ...WORLDVIEW_ORIGIN_AGENT_FIELDS,
      ...WORLDVIEW_NATURAL_AGENT_FIELDS,
      ...WORLDVIEW_HUMANITY_AGENT_FIELDS,
    ].sort()

    expect(registered).toEqual(agent)
    expect(writeFields).toEqual(agent)
    expect(requiredTargets).toEqual(agent)
    expect(uiFields).toEqual(agent)
    expect(skill.contextGateway?.rollout).toBe('required')
    expect(FIELD_BY_TARGET.get('worldviews')?.filter(field => field.aiGeneration).length).toBe(agent.length)
    expect(checkRegistry()).toMatchObject({ ok: true, errors: [] })
  })

  it.each(WORLDVIEW_GENERATABLE_FIELD_SPECS)(
    '$field 使用登记 kind/schema/边界解析原生候选，不把对象降为 JSON 字符串',
    spec => {
      const value = candidateValue(spec.field)
      const parsed = parseWorldviewFieldCandidateDraft(JSON.stringify({
        field: spec.field,
        value,
        temporaryAssumptions: ['缺失直接依赖时只作为本轮候选假设。'],
      }))
      expect(parsed.field).toBe(spec.field)
      expect(parsed.value).toEqual(value)
      expect(typeof parsed.value).toBe(spec.aiGeneration.kind === 'text' ? 'string' : 'object')
      expect(WORLDVIEW_AGENT_FIELD_CAPABILITIES.get(spec.field)).toEqual(spec.aiGeneration)
      expect(worldviewFieldCandidateMatchesRowV1(parsed, {
        [spec.field]: value,
      } as never)).toBe(true)
    },
  )

  it('每个已填写字段都由同一 controller/Gateway 作为 mandatory 目标读取，且不越过当前 scope', async () => {
    const current = await seedWorkspace('当前世界')
    const foreign = await seedWorkspace('隔离世界')
    const currentWorldviewId = await db.worldviews.add(stampNewRecord(current.scope, 'worldviews', {
      projectId: current.projectId,
      ...Object.fromEntries(WORLDVIEW_AGENT_FIELDS.map(field => [field, lateFactValue(field)])),
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'world' }) as never)
    const foreignWorldviewId = await db.worldviews.add(stampNewRecord(foreign.scope, 'worldviews', {
      projectId: foreign.projectId,
      ...completeWorldview(),
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'world' }) as never)

    for (const field of WORLDVIEW_AGENT_FIELDS) {
      const prepared = await prepareWorldviewFieldCopilot({
        projectId: current.projectId,
        scope: current.scope,
        worldGroupId: null,
        authorRequest: `生成世界基座字段。目标字段=${field}；生成模式=expand。`,
      })
      const execution = prepared.contextGatewayExecution
      expect(execution, field).toBeDefined()
      expect(execution!.retrievalTrace.mandatory, field).toHaveLength(1)
      expect(execution!.retrievalTrace.mandatory[0].sourceRefs, field).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'worldviews', recordId: currentWorldviewId, field }),
      ]))
      expect(execution!.contextPacket.sourceRefs, field).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'worldviews', recordId: foreignWorldviewId }),
      ]))
      expect(execution!.contextPacket.content, field).toContain(`[LATE:${field}]`)
      expect(execution!.selector.selected.length, field).toBeLessThanOrEqual(20)
      expect(prepared.input.mode, field).toBe('expand')
    }
  }, 30_000)

  it('空项目的每个字段都进入 create，缺失依赖只形成候选假设而不创建 Canon', async () => {
    const fixture = await seedWorkspace('空白世界')
    for (const field of WORLDVIEW_AGENT_FIELDS) {
      const prepared = await prepareWorldviewFieldCopilot({
        projectId: fixture.projectId,
        scope: fixture.scope,
        worldGroupId: null,
        authorRequest: `生成世界基座字段。目标字段=${field}；生成模式=expand。`,
      })
      expect(prepared.input.mode, field).toBe('create')
      expect(prepared.snapshot.foundationState, field).toBe('empty')
      expect(prepared.prepared.messages[0].content, field).toContain('不得输出对其他字段的顺带修改')
    }
    expect(await db.worldviews.where('projectId').equals(fixture.projectId).count()).toBe(0)
  }, 30_000)

  it('部分世界的每个字段都保留 partial 边界，空目标创建、已填目标扩写', async () => {
    const fixture = await seedWorkspace('部分世界')
    await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.projectId,
      worldOrigin: '潮汐会周期性改写城市边界。',
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'world' }) as never)

    for (const field of WORLDVIEW_AGENT_FIELDS) {
      const prepared = await prepareWorldviewFieldCopilot({
        projectId: fixture.projectId,
        scope: fixture.scope,
        worldGroupId: null,
        authorRequest: `生成世界基座字段。目标字段=${field}；生成模式=expand。`,
      })
      expect(prepared.snapshot.foundationState, field).toBe('partial')
      expect(prepared.input.mode, field).toBe(field === 'worldOrigin' ? 'expand' : 'create')
      expect(prepared.prepared.messages[0].content, field).toContain('不得输出对其他字段的顺带修改')
    }
  }, 30_000)

  it('每个字段的恢复候选都在目标字段被作者修改后由同一 CAS stale 边界阻断', async () => {
    const fixture = await seedWorkspace('并发修改世界')
    const worldviewId = await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.projectId,
      ...completeWorldview(),
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'world' }) as never)

    for (const [index, field] of WORLDVIEW_AGENT_FIELDS.entries()) {
      const prepared = await prepareWorldviewFieldCopilot({
        projectId: fixture.projectId,
        scope: fixture.scope,
        worldGroupId: null,
        authorRequest: `生成世界基座字段。目标字段=${field}；生成模式=expand。`,
      })
      const authorValue = lateFactValue(field)
      await db.worldviews.update(worldviewId, {
        [field]: authorValue,
        updatedAt: NOW + index + 1,
      } as never)

      await expect(adoptRestoredWorldviewFieldCandidate({
        projectId: fixture.projectId,
        scope: fixture.scope,
        worldGroupId: null,
        snapshot: prepared.snapshot,
        targetField: field,
        draft: JSON.stringify({ field, value: candidateValue(field) }),
      }), field).rejects.toBeInstanceOf(WorldviewFieldCopilotStaleError)
    }
  }, 30_000)
})
