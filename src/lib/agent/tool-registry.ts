import { db } from '../db/schema'
import { parseInspirationFragments } from '../inspiration/workspace'
import { assembleContext } from '../registry/assemble-context'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import type { AssembleContextInput } from '../registry/types'
import { AGENT_SEARCH_KINDS } from './read-sources'
import type {
  AgentToolDefinition,
  AgentToolExecutionContext,
  AgentToolJsonSchema,
  AgentToolResult,
} from './types'
import { assertRecordInScope, isLegacyReadScope, readOwnedRows, resolveReadScope } from '../world-engine/scope'

type ArgRules = {
  allowed: readonly string[]
  required?: readonly string[]
}

type ReadToolSpec = Omit<AgentToolDefinition, 'execute' | 'risk'> & {
  argRules: ArgRules
  requiresWorldScope?: boolean
}

const EMPTY_SCHEMA: AgentToolJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

const OPTIONAL_BOUNDARY_SCHEMA: AgentToolJsonSchema = {
  type: 'object',
  properties: {
    chapterId: { type: 'integer', minimum: 1, description: '章节 ID' },
    outlineNodeId: { type: 'integer', minimum: 1, description: '大纲节点 ID' },
    characterId: { type: 'integer', minimum: 1, description: '角色 ID' },
  },
  additionalProperties: false,
}

const READ_TOOL_SPECS: readonly ReadToolSpec[] = [
  {
    name: 'read_project_status',
    description: '读取当前项目的紧凑填写概况、字数和模块数量，不返回整表原文。',
    parameters: EMPTY_SCHEMA,
    sourceKeys: ['projectStatus'],
    inputBudgetTokens: 1400,
    argRules: { allowed: [] },
  },
  {
    name: 'read_worldview',
    description: '读取当前世界的世界观、力量体系和设定词条。',
    parameters: EMPTY_SCHEMA,
    sourceKeys: ['worldview', 'powerSystem', 'codex'],
    inputBudgetTokens: 18_000,
    argRules: { allowed: [] },
  },
  {
    name: 'read_story_core',
    description: '读取项目级故事核心和作者明确激活的角色驱动方案。',
    parameters: EMPTY_SCHEMA,
    sourceKeys: ['storyCore', 'activeNarrativeBlueprint', 'characterDrivenPlan'],
    inputBudgetTokens: 8000,
    argRules: { allowed: [] },
  },
  {
    name: 'read_characters',
    description: '读取当前世界可见的角色档案和项目角色关系。',
    parameters: EMPTY_SCHEMA,
    sourceKeys: ['characters', 'characterRelations'],
    inputBudgetTokens: 10_500,
    argRules: { allowed: [] },
  },
  {
    name: 'read_outline',
    description: '读取当前世界的大纲树；可附带一个节点或章节以读取当前章纲。',
    parameters: {
      type: 'object',
      properties: {
        outlineNodeId: { type: 'integer', minimum: 1, description: '可选的大纲节点 ID' },
        chapterId: { type: 'integer', minimum: 1, description: '可选的章节 ID' },
      },
      additionalProperties: false,
    },
    sourceKeys: ['activeNarrativeBlueprint', 'outlineTree', 'chapterOutline'],
    inputBudgetTokens: 7000,
    argRules: { allowed: ['outlineNodeId', 'chapterId'] },
  },
  {
    name: 'read_chapter',
    description: '读取当前项目指定章节的正文。',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'integer', minimum: 1, description: '要读取的章节 ID' },
      },
      required: ['chapterId'],
      additionalProperties: false,
    },
    sourceKeys: ['chapterContent'],
    inputBudgetTokens: 24_000,
    argRules: { allowed: ['chapterId'], required: ['chapterId'] },
    requiresWorldScope: true,
  },
  {
    name: 'read_history',
    description: '读取当前世界的历史时间线和历史关键词上下文。',
    parameters: EMPTY_SCHEMA,
    sourceKeys: ['historical'],
    inputBudgetTokens: 2200,
    argRules: { allowed: [] },
  },
  {
    name: 'read_world_rules',
    description: '读取当前世界作者确认的 Canon 断言与真实/幻想规则。',
    parameters: EMPTY_SCHEMA,
    sourceKeys: ['canonAssertions', 'worldRules'],
    inputBudgetTokens: 3500,
    argRules: { allowed: [] },
  },
  {
    name: 'read_foreshadows',
    description: '读取伏笔状态；给出章节时按该章边界组织上下文。',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'integer', minimum: 1, description: '可选的当前章节 ID' },
      },
      additionalProperties: false,
    },
    sourceKeys: ['foreshadows'],
    inputBudgetTokens: 1800,
    argRules: { allowed: ['chapterId'] },
  },
  {
    name: 'read_inventory',
    description: '读取物品流水；提供章节或大纲边界时同时返回已确认的当前持有投影。',
    parameters: OPTIONAL_BOUNDARY_SCHEMA,
    sourceKeys: ['itemLedger', 'heldItems'],
    inputBudgetTokens: 4200,
    argRules: { allowed: ['chapterId', 'outlineNodeId', 'characterId'] },
  },
  {
    name: 'read_story_timeline',
    description: '读取故事进程年表和作者确认的故事线进度。',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'integer', minimum: 1, description: '可选的当前章节 ID' },
      },
      additionalProperties: false,
    },
    sourceKeys: ['storyTimeline', 'storylineProgress'],
    inputBudgetTokens: 4800,
    argRules: { allowed: ['chapterId'] },
  },
  {
    name: 'read_world_groups',
    description: '读取项目世界组目录和世界连接关系。',
    parameters: EMPTY_SCHEMA,
    sourceKeys: ['worldGroups'],
    inputBudgetTokens: 1800,
    argRules: { allowed: [] },
  },
  {
    name: 'read_inspiration_workspace',
    description: '只读取作者本次明确勾选的灵感碎片和同模式最近确认版本。',
    parameters: {
      type: 'object',
      properties: {
        fragmentIds: {
          type: 'array',
          description: '本次参与反推的灵感碎片 ID，最多 24 个',
          items: { type: 'string' },
        },
        mode: {
          type: 'string',
          enum: ['single', 'multiworld'],
          description: '与当前项目一致的反推结果模式',
        },
      },
      required: ['fragmentIds', 'mode'],
      additionalProperties: false,
    },
    sourceKeys: ['inspirationWorkspace'],
    inputBudgetTokens: 11_000,
    argRules: { allowed: ['fragmentIds', 'mode'], required: ['fragmentIds', 'mode'] },
  },
  {
    name: 'search_text',
    description: '在当前项目与世界作用域内做本地包含匹配，只返回有界短摘，不调用网络或 embedding。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 100, description: '搜索关键词' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: '最多返回条数' },
        kinds: {
          type: 'array',
          description: '可选的数据类型过滤',
          items: { type: 'string', enum: AGENT_SEARCH_KINDS },
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    sourceKeys: ['searchResults'],
    inputBudgetTokens: 2600,
    argRules: { allowed: ['query', 'limit', 'kinds'], required: ['query'] },
  },
] as const

function emptyMeta(toolName: string, sourceKeys: readonly string[], budget: number): AgentToolResult['meta'] {
  return {
    toolName,
    sourceKeys,
    included: [],
    omitted: [],
    trimmed: [],
    totalInputTokens: 0,
    inputBudget: budget,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

function failure(spec: ReadToolSpec, error: string): AgentToolResult {
  return {
    ok: false,
    content: '',
    error,
    meta: emptyMeta(spec.name, spec.sourceKeys, spec.inputBudgetTokens),
  }
}

function positiveInteger(value: unknown, name: string): number | undefined {
  if (value == null) return undefined
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${name} 必须是正整数`)
  return Number(value)
}

function validateArgs(spec: ReadToolSpec, raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工具参数必须是对象')
  const keys = Object.keys(raw)
  const unknown = keys.filter(key => !spec.argRules.allowed.includes(key))
  if (unknown.length) throw new Error(`不允许的参数：${unknown.join(', ')}`)
  const missing = (spec.argRules.required ?? []).filter(key => raw[key] == null)
  if (missing.length) throw new Error(`缺少必填参数：${missing.join(', ')}`)

  const args = { ...raw }
  for (const key of ['chapterId', 'outlineNodeId', 'characterId']) {
    if (key in args) args[key] = positiveInteger(args[key], key)
  }
  if ('query' in args) {
    if (typeof args.query !== 'string') throw new Error('query 必须是字符串')
    const query = args.query.trim()
    if (query.length < 2 || query.length > 100) throw new Error('query 长度必须为 2-100')
    args.query = query
  }
  if ('limit' in args) {
    const limit = positiveInteger(args.limit, 'limit')
    if (limit != null && limit > 10) throw new Error('limit 不能大于 10')
    args.limit = limit
  }
  if ('kinds' in args) {
    if (!Array.isArray(args.kinds) || args.kinds.some(kind => (
      typeof kind !== 'string' || !AGENT_SEARCH_KINDS.includes(kind as typeof AGENT_SEARCH_KINDS[number])
    ))) throw new Error('kinds 含有不支持的数据类型')
  }
  if ('fragmentIds' in args) {
    if (
      !Array.isArray(args.fragmentIds)
      || args.fragmentIds.length === 0
      || args.fragmentIds.length > 24
      || args.fragmentIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 120)
    ) throw new Error('fragmentIds 必须包含 1-24 个有效碎片 ID')
    args.fragmentIds = [...new Set(args.fragmentIds.map(id => String(id).trim()))]
  }
  if ('mode' in args && args.mode !== 'single' && args.mode !== 'multiworld') {
    throw new Error('mode 必须是 single 或 multiworld')
  }
  return args
}

async function resolveScope(
  spec: ReadToolSpec,
  context: AgentToolExecutionContext,
  args: Record<string, unknown>,
): Promise<AssembleContextInput> {
  const projectId = positiveInteger(context.projectId, 'projectId')!
  const workspaceScope = await resolveReadScope({ projectId, scope: context.scope })
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')
  const fragmentIds = args.fragmentIds as string[] | undefined
  const inspirationMode = args.mode as 'single' | 'multiworld' | undefined
  if (
    inspirationMode
    && inspirationMode !== (project.enableMultiWorld ? 'multiworld' : 'single')
  ) throw new Error('灵感反推模式与当前项目不一致')
  if (fragmentIds) {
    const workspace = (await readOwnedRows<any>(workspaceScope, 'inspirationWorkspaces', { owner: 'work' }))[0]
    const available = new Set(parseInspirationFragments(workspace?.fragments).map(item => item.id))
    if (fragmentIds.some(fragmentId => !available.has(fragmentId))) {
      throw new Error('灵感碎片不存在或不属于当前项目')
    }
  }

  const needsWorld = spec.requiresWorldScope
    || spec.sourceKeys.some(key => CONTEXT_SOURCE_BY_KEY.get(key)?.requiresWorldGroupId)
  const explicitWorld = Object.prototype.hasOwnProperty.call(context, 'worldGroupId')
    && context.worldGroupId !== undefined
  let worldGroupId = context.worldGroupId
  if (needsWorld && !explicitWorld) {
    if (project.enableMultiWorld) throw new Error('多世界项目必须先选择世界组')
    worldGroupId = null
  }
  if (worldGroupId != null) {
    const group = await db.worldGroups.get(worldGroupId)
    if (!await assertRecordInScope(workspaceScope, 'worldGroups', group, { owner: 'world' })) {
      throw new Error('世界组不属于当前项目或当前 World')
    }
  }

  const chapterId = args.chapterId as number | undefined
  const outlineNodeId = args.outlineNodeId as number | undefined
  const characterId = args.characterId as number | undefined
  let chapterOutlineNodeId: number | undefined
  const assertOutlineWorld = async (nodeId: number) => {
    let node = await db.outlineNodes.get(nodeId)
    const visited = new Set<number>()
    let effectiveWorld: number | null = null
    while (node) {
      if (!await assertRecordInScope(workspaceScope, 'outlineNodes', node, { owner: 'work' })) {
        throw new Error('大纲节点不属于当前作品')
      }
      if (node.worldGroupId != null) {
        effectiveWorld = node.worldGroupId
        break
      }
      if (node.parentId == null || visited.has(node.parentId)) break
      visited.add(node.parentId)
      node = await db.outlineNodes.get(node.parentId)
    }
    if (needsWorld && effectiveWorld !== (worldGroupId ?? null)) {
      throw new Error('大纲或章节不属于当前世界作用域')
    }
  }
  if (chapterId != null) {
    const chapter = await db.chapters.get(chapterId)
    if (!chapter || !await assertRecordInScope(workspaceScope, 'chapters', chapter, { owner: 'work' })) {
      throw new Error('章节不属于当前项目或当前作品')
    }
    chapterOutlineNodeId = chapter.outlineNodeId
    await assertOutlineWorld(chapter.outlineNodeId)
  }
  if (outlineNodeId != null) {
    const node = await db.outlineNodes.get(outlineNodeId)
    if (!node || !await assertRecordInScope(workspaceScope, 'outlineNodes', node, { owner: 'work' })) {
      throw new Error('大纲节点不属于当前作品')
    }
    await assertOutlineWorld(outlineNodeId)
  }
  if (chapterOutlineNodeId != null && outlineNodeId != null && chapterOutlineNodeId !== outlineNodeId) {
    throw new Error('章节与大纲节点边界不一致')
  }
  if (characterId != null) {
    const character = await db.characters.get(characterId)
    if (!character || !await assertRecordInScope(workspaceScope, 'characters', character, { owner: 'world' })) {
      throw new Error('角色不属于当前 World')
    }
    if (
      needsWorld
      && !character.isCrossWorld
      && (character.homeWorldGroupId ?? null) !== (worldGroupId ?? null)
    ) throw new Error('角色不属于当前世界作用域')
  }

  return {
    projectId,
    scope: isLegacyReadScope(workspaceScope) ? undefined : workspaceScope,
    ...(needsWorld || explicitWorld ? { worldGroupId: worldGroupId ?? null } : {}),
    chapterId,
    outlineNodeId,
    characterId,
    searchQuery: args.query as string | undefined,
    searchLimit: args.limit as number | undefined,
    searchKinds: args.kinds as string[] | undefined,
    inspirationFragmentIds: fragmentIds,
    inspirationMode,
    provider: context.provider,
    model: context.model,
    sourceKeys: [...spec.sourceKeys],
    inputBudgetMaxTokens: Math.min(
      spec.inputBudgetTokens,
      context.contextPolicy?.maxInputTokens ?? spec.inputBudgetTokens,
    ),
    sourceBudgetScale: context.contextPolicy?.sourceBudgetScale,
  }
}

async function executeReadTool(
  spec: ReadToolSpec,
  context: AgentToolExecutionContext,
  rawArgs: Record<string, unknown>,
): Promise<AgentToolResult> {
  try {
    const args = validateArgs(spec, rawArgs)
    const assembled = await assembleContext(await resolveScope(spec, context, args))
    return {
      ok: true,
      content: assembled.text || '当前作用域内没有可用数据。',
      meta: {
        toolName: spec.name,
        sourceKeys: spec.sourceKeys,
        included: assembled.included,
        omitted: assembled.omitted,
        trimmed: assembled.trimmed,
        totalInputTokens: assembled.totalInputTokens,
        inputBudget: assembled.inputBudget,
        overBudgetBeforeTrim: assembled.overBudgetBeforeTrim,
        overBudgetAfterTrim: assembled.overBudgetAfterTrim,
      },
    }
  } catch (error) {
    return failure(spec, error instanceof Error ? error.message : '工具执行失败')
  }
}

export const AGENT_READ_TOOLS: readonly AgentToolDefinition[] = READ_TOOL_SPECS.map(spec => {
  for (const sourceKey of spec.sourceKeys) {
    if (!CONTEXT_SOURCE_BY_KEY.has(sourceKey)) {
      throw new Error(`Agent 工具 ${spec.name} 引用了未注册上下文源：${sourceKey}`)
    }
  }
  return {
    name: spec.name,
    description: spec.description,
    risk: 'read',
    parameters: spec.parameters,
    sourceKeys: spec.sourceKeys,
    inputBudgetTokens: spec.inputBudgetTokens,
    execute: (context, args) => executeReadTool(spec, context, args),
  }
})

/** Maximum context capability exposed by the generic read-only runner. */
export const AGENT_READ_CONTEXT_SOURCE_KEYS: readonly string[] = [...new Set(
  AGENT_READ_TOOLS.flatMap(tool => tool.sourceKeys),
)].sort()

export const AGENT_TOOL_BY_NAME: ReadonlyMap<string, AgentToolDefinition> = new Map(
  AGENT_READ_TOOLS.map(tool => [tool.name, tool] as const),
)

export async function executeAgentTool(
  name: string,
  context: AgentToolExecutionContext,
  args: Record<string, unknown> = {},
): Promise<AgentToolResult> {
  const tool = AGENT_TOOL_BY_NAME.get(name)
  if (!tool) {
    return {
      ok: false,
      content: '',
      error: `未知工具：${name}`,
      meta: emptyMeta(name, [], 0),
    }
  }
  return tool.execute(context, args)
}
