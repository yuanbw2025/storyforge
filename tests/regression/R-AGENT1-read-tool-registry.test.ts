import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_READ_TOOLS, executeAgentTool } from '../../src/lib/agent/tool-registry'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { CANON_RESOURCE_KINDS_V1, CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const EXPECTED_TOOLS = [
  'read_work_status',
  'read_worldview',
  'read_story_core',
  'read_characters',
  'read_outline',
  'read_chapter',
  'read_history',
  'read_world_rules',
  'read_foreshadows',
  'read_inventory',
  'read_story_timeline',
  'read_world_groups',
  'read_inspiration_workspace',
  'read_character_driven_plan',
  'search_text',
  'list_context_catalog',
  'search_context',
  'read_context_resource',
  'read_original_evidence',
]

async function addProject(name: string, enableMultiWorld: boolean) {
  return (await seedCurrentWorkspace(name, { enableMultiWorld })).scope.projectId
}

async function addWorld(projectId: number, name: string, order: number) {
  const now = Date.now()
  const { scope } = await resolveWorkspaceOwnership(projectId)
  return await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId,
    name,
    description: `${name}描述`,
    type: order === 0 ? 'primary' : 'traversal',
    order,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' }) as never) as number
}

async function addOutline(projectId: number, worldGroupId: number | null, title: string, order: number) {
  const now = Date.now()
  const { scope } = await resolveWorkspaceOwnership(projectId)
  return await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId,
    parentId: null,
    type: 'chapter',
    title,
    summary: `${title}摘要`,
    order,
    worldGroupId,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
}

async function addChapter(projectId: number, outlineNodeId: number, title: string, content: string, order = 0) {
  const now = Date.now()
  const { scope } = await resolveWorkspaceOwnership(projectId)
  return await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId,
    outlineNodeId,
    title,
    content,
    wordCount: content.length,
    status: 'draft',
    order,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
}

async function tableCounts() {
  return Object.fromEntries(await Promise.all(PROJECT_TABLES.map(async spec => (
    [spec.name, await spec.table.count()] as const
  ))))
}

describe('R-AGENT1 · 只读 Tool Registry', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('注册完整的只读工具，参数拒绝额外字段，所有读取源均已登记', () => {
    expect(AGENT_READ_TOOLS.map(tool => tool.name)).toEqual(EXPECTED_TOOLS)
    for (const tool of AGENT_READ_TOOLS) {
      expect(tool.risk).toBe('read')
      expect(tool.parameters.additionalProperties).toBe(false)
      expect(tool.inputBudgetTokens).toBeGreaterThan(0)
      for (const sourceKey of tool.sourceKeys) expect(CONTEXT_SOURCE_BY_KEY.has(sourceKey)).toBe(true)
    }
    expect(CONTEXT_SOURCE_BY_KEY.has('workStatus')).toBe(true)
    expect(CONTEXT_SOURCE_BY_KEY.has('worldGroups')).toBe(true)
    expect(CONTEXT_SOURCE_BY_KEY.has('outlineTree')).toBe(true)
    expect(CONTEXT_SOURCE_BY_KEY.has('searchResults')).toBe(true)
    expect(CONTEXT_SOURCE_BY_KEY.has('inspirationWorkspace')).toBe(true)
    expect(CONTEXT_SOURCE_BY_KEY.has('characterDrivenPlan')).toBe(true)
  })

  it('projectId/worldGroupId 只能由执行上下文给出，跨项目实体与世界组均拒绝', async () => {
    const projectA = await addProject('A', true)
    const projectB = await addProject('B', true)
    const worldA = await addWorld(projectA, 'A世界', 0)
    const worldB = await addWorld(projectB, 'B世界', 0)
    const outlineB = await addOutline(projectB, worldB, 'B章纲', 0)
    const chapterB = await addChapter(projectB, outlineB, 'B章', '绝不能泄漏的正文')

    const injected = await executeAgentTool('read_work_status', { projectId: projectA }, {
      projectId: projectB,
    })
    expect(injected.ok).toBe(false)
    expect(injected.error).toContain('不允许的参数')

    const foreignWorld = await executeAgentTool('read_worldview', {
      projectId: projectA,
      worldGroupId: worldB,
    })
    expect(foreignWorld.ok).toBe(false)
    expect(foreignWorld.error).toContain('世界组不属于当前项目')

    const foreignChapter = await executeAgentTool('read_chapter', {
      projectId: projectA,
      worldGroupId: worldA,
    }, { chapterId: chapterB })
    expect(foreignChapter.ok).toBe(false)
    expect(foreignChapter.content).not.toContain('绝不能泄漏')
    expect(foreignChapter.error).toContain('章节不属于当前项目')
  })

  it('多世界工具必须先选世界，并在大纲与搜索中隔离其它世界', async () => {
    const projectId = await addProject('多世界', true)
    const primary = await addWorld(projectId, '主世界', 0)
    const other = await addWorld(projectId, '异世界', 1)
    const primaryNode = await addOutline(projectId, primary, '主世界节点', 0)
    const otherNode = await addOutline(projectId, other, '异世界秘密节点', 1)
    await addChapter(projectId, primaryNode, '主世界章', '共同关键词 主世界证据')
    await addChapter(projectId, otherNode, '异世界章', '共同关键词 异世界秘密正文')

    const missingScope = await executeAgentTool('read_outline', { projectId }, {})
    expect(missingScope.ok).toBe(false)
    expect(missingScope.error).toContain('必须先选择世界组')

    const outline = await executeAgentTool('read_outline', {
      projectId,
      worldGroupId: primary,
    }, {})
    expect(outline.ok).toBe(true)
    expect(outline.content).toContain('主世界节点')
    expect(outline.content).not.toContain('异世界秘密节点')

    const search = await executeAgentTool('search_text', {
      projectId,
      worldGroupId: primary,
    }, { query: '共同关键词', kinds: ['chapter'], limit: 10 })
    expect(search.ok).toBe(true)
    expect(search.content).toContain('主世界证据')
    expect(search.content).not.toContain('异世界秘密正文')

    const foreignChapter = await executeAgentTool('read_chapter', {
      projectId,
      worldGroupId: primary,
    }, { chapterId: (await db.chapters.where('outlineNodeId').equals(otherNode).first())!.id })
    expect(foreignChapter.ok).toBe(false)
    expect(foreignChapter.error).toContain('不属于当前世界作用域')

    const mismatchedBoundary = await executeAgentTool('read_inventory', {
      projectId,
      worldGroupId: primary,
    }, { chapterId: (await db.chapters.where('outlineNodeId').equals(primaryNode).first())!.id, outlineNodeId: otherNode })
    expect(mismatchedBoundary.ok).toBe(false)
  })

  it('单世界自动归一到 null；搜索最多 10 条且只给短摘', async () => {
    const projectId = await addProject('单世界', false)
    for (let index = 0; index < 12; index++) {
      const node = await addOutline(projectId, null, `节点${index}`, index)
      await addChapter(
        projectId,
        node,
        `章节${index}`,
        `目标词 ${`长正文${index}`.repeat(120)} 尾部标记${index}`,
        index,
      )
    }

    const result = await executeAgentTool('search_text', { projectId }, {
      query: '目标词',
      kinds: ['chapter'],
      limit: 10,
    })
    expect(result.ok).toBe(true)
    expect(result.meta.included).toContain('searchResults')
    expect(result.content.match(/\[chapter#/g)).toHaveLength(10)
    expect(result.content).not.toContain('尾部标记0')
    expect(result.content).not.toContain('章节10')
  })

  it('超长单章按工具总预算显式截断，不让 L0 绕过预算', async () => {
    const projectId = await addProject('长章', false)
    const nodeId = await addOutline(projectId, null, '长章节点', 0)
    const chapterId = await addChapter(projectId, nodeId, '长章', '汉'.repeat(60_000))

    const result = await executeAgentTool('read_chapter', { projectId }, { chapterId })
    expect(result.ok).toBe(true)
    expect(result.content).toContain('该上下文源已按预算截断')
    expect(result.meta.totalInputTokens).toBeLessThanOrEqual(result.meta.inputBudget)
    expect(result.meta.inputBudget).toBe(24_000)
  })

  it('执行全部只读工具不会改变任何 PROJECT_TABLES 行数', async () => {
    const projectId = await addProject('只读快照', false)
    const nodeId = await addOutline(projectId, null, '第一章节点', 0)
    const chapterId = await addChapter(projectId, nodeId, '第一章', '主角取得铜钥匙。')
    const now = Date.now()
    const ownership = await resolveWorkspaceOwnership(projectId)
    const characterId = await db.characters.add(stampNewRecord(ownership.scope, 'characters', {
      projectId,
      name: '主角',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      shortDescription: '持有铜钥匙',
      appearance: '',
      personality: '',
      background: '',
      motivation: '',
      abilities: '',
      relationships: '[]',
      arc: '',
      homeWorldGroupId: null,
      isCrossWorld: true,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as never) as number
    const before = await tableCounts()
    await db.inspirationWorkspaces.add(stampNewRecord(ownership.scope, 'inspirationWorkspaces', {
      projectId,
      fragments: JSON.stringify([{
        id: 'idea-1',
        text: '铜钥匙每次开门都会忘记一段记忆',
        label: '钥匙规则',
        sourceKind: 'author',
        createdAt: now,
      }]),
      versions: '[]',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never)
    const characterDrivenPlanId = await db.characterDrivenPlans.add(stampNewRecord(ownership.scope, 'characterDrivenPlans', {
      projectId,
      name: '只读方案',
      arcs: JSON.stringify([{
        characterId,
        name: '主角',
        role: '主角',
        initialState: '尚未出发',
        targetState: '完成选择',
      }]),
      userHint: '',
      generatedVolumes: '[]',
      status: 'draft',
      version: 1,
      parentPlanId: null,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never)
    await stampCurrentFixtureResourceUidsV1(projectId)
    const gatewaySession = await createContextGatewayToolSessionV1({
      scope: { ...ownership.scope, worldGroupId: null },
      policy: {
        version: 'context-access-policy-v1', policyId: 'agent1-all-tools-v1',
        mandatorySourceKeys: [], allowedSourceKeys: ['ragSelection'],
        allowedResourceKinds: [...CANON_RESOURCE_KINDS_V1],
        allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
        selectorPolicyId: 'agent1-test-v1', maxReadCalls: 10, maxRetrievedTokens: 100_000,
        allowOriginalRead: true, candidateAccess: 'explicit-resource-key-only',
      },
    })
    const gatewayPage = await CANON_RESOURCE_PROVIDER_V1.listMetadata({
      scope: gatewaySession.scope, kinds: ['chapter'], limit: 100,
    })
    const chapterResourceKey = gatewayPage.items.find(item => item.resourceKey.endsWith(':field:content'))!.resourceKey
    const beforeWithInspiration = await tableCounts()
    const args: Record<string, Record<string, unknown>> = {
      read_outline: { outlineNodeId: nodeId },
      read_chapter: { chapterId },
      read_foreshadows: { chapterId },
      read_inventory: { chapterId, outlineNodeId: nodeId, characterId },
      read_story_timeline: { chapterId },
      read_inspiration_workspace: { fragmentIds: ['idea-1'], mode: 'single' },
      read_character_driven_plan: { planId: characterDrivenPlanId },
      search_text: { query: '铜钥匙' },
      list_context_catalog: { limit: 2 },
      search_context: { query: '铜钥匙', limit: 2 },
      read_context_resource: { resourceKey: chapterResourceKey, depth: 'full', maxTokens: 1000 },
    }
    let originalCapability: string | undefined
    for (const tool of AGENT_READ_TOOLS) {
      const toolArgs = tool.name === 'read_original_evidence'
        ? { sourceRef: originalCapability, maxTokens: 1000 }
        : args[tool.name] ?? {}
      const result = await tool.execute({ projectId, contextGatewaySession: gatewaySession }, toolArgs)
      expect(result.ok, `${tool.name}: ${result.error ?? ''}`).toBe(true)
      if (tool.name === 'read_context_resource') {
        originalCapability = JSON.parse(result.content).sourceRefCapabilities[0]
      }
    }
    expect(beforeWithInspiration.inspirationWorkspaces).toBe(before.inspirationWorkspaces + 1)
    expect(await tableCounts()).toEqual(beforeWithInspiration)
  })

  it('灵感工具只读取当前项目明确选择的碎片，并拒绝空选择和跨项目 ID', async () => {
    const projectA = await addProject('灵感 A', false)
    const projectB = await addProject('灵感 B', false)
    const now = Date.now()
    const scopeA = (await resolveWorkspaceOwnership(projectA)).scope
    const scopeB = (await resolveWorkspaceOwnership(projectB)).scope
    await db.inspirationWorkspaces.bulkAdd([
      stampNewRecord(scopeA, 'inspirationWorkspaces', {
        projectId: projectA,
        fragments: JSON.stringify([
          { id: 'a-1', text: '会吞掉名字的雨', label: '', sourceKind: 'author', createdAt: now },
          { id: 'a-2', text: '不会进入本轮的灯塔', label: '', sourceKind: 'author', createdAt: now + 1 },
        ]),
        versions: '[]',
        createdAt: now,
        updatedAt: now,
      }, { owner: 'work' }),
      stampNewRecord(scopeB, 'inspirationWorkspaces', {
        projectId: projectB,
        fragments: JSON.stringify([
          { id: 'b-1', text: '另一个项目的秘密', label: '', sourceKind: 'author', createdAt: now },
        ]),
        versions: '[]',
        createdAt: now,
        updatedAt: now,
      }, { owner: 'work' }),
    ] as never[])

    const selected = await executeAgentTool(
      'read_inspiration_workspace',
      { projectId: projectA },
      { fragmentIds: ['a-1'], mode: 'single' },
    )
    expect(selected.ok).toBe(true)
    expect(selected.content).toContain('会吞掉名字的雨')
    expect(selected.content).not.toContain('不会进入本轮的灯塔')

    const empty = await executeAgentTool(
      'read_inspiration_workspace',
      { projectId: projectA },
      { fragmentIds: [], mode: 'single' },
    )
    expect(empty.ok).toBe(false)
    expect(empty.error).toContain('1-24')

    const foreign = await executeAgentTool(
      'read_inspiration_workspace',
      { projectId: projectA },
      { fragmentIds: ['b-1'], mode: 'single' },
    )
    expect(foreign.ok).toBe(false)
    expect(foreign.error).toContain('不存在或不属于当前项目')
    expect(foreign.content).not.toContain('另一个项目的秘密')

    const mixed = await executeAgentTool(
      'read_inspiration_workspace',
      { projectId: projectA },
      { fragmentIds: ['a-1', 'b-1'], mode: 'single' },
    )
    expect(mixed.ok).toBe(false)
    expect(mixed.content).not.toContain('会吞掉名字的雨')

    const wrongMode = await executeAgentTool(
      'read_inspiration_workspace',
      { projectId: projectA },
      { fragmentIds: ['a-1'], mode: 'multiworld' },
    )
    expect(wrongMode.ok).toBe(false)
    expect(wrongMode.error).toContain('模式与当前项目不一致')
  })
})
