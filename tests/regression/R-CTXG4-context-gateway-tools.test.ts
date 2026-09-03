import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import type { ContextAccessPolicyV1, ContextResourceKind, WorkspaceScope } from '../../src/lib/types'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { CANON_RESOURCE_PROVIDER_V1, contextResourceSpecsV1 } from '../../src/lib/context-gateway/canon-provider'
import { AGENT_READ_TOOLS, executeAgentTool } from '../../src/lib/agent/tool-registry'

const now = 1_787_600_000_000

async function seedWorkspace() {
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name: 'CTXG-4 工具项目',
    genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 1_000_000, enableMultiWorld: true, createdAt: now, updatedAt: now,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  return { projectId, scope: ownership.scope }
}

async function addScoped(
  scope: WorkspaceScope,
  tableName: string,
  row: Record<string, unknown>,
  owner?: 'world' | 'work',
): Promise<number> {
  return (db as any)[tableName].add(stampNewRecord(scope, tableName, {
    projectId: scope.projectId,
    createdAt: now,
    updatedAt: now,
    ...row,
  }, owner ? { owner } : {})) as Promise<number>
}

function policy(input: {
  kinds?: ContextResourceKind[]
  depths?: ContextAccessPolicyV1['allowedDepths']
  allowOriginal?: boolean
  candidateAccess?: ContextAccessPolicyV1['candidateAccess']
  calls?: number
  tokens?: number
} = {}): ContextAccessPolicyV1 {
  return {
    version: 'context-access-policy-v1',
    policyId: 'ctxg4-test-policy-v1',
    mandatorySourceKeys: [],
    allowedSourceKeys: ['ragSelection'],
    allowedResourceKinds: input.kinds ?? ['worldview-field', 'story-core-field', 'character', 'story-arc', 'storyline-progress', 'chapter', 'fact', 'narrative-blueprint'],
    allowedDepths: input.depths ?? ['index', 'summary', 'focused', 'full', 'original'],
    selectorPolicyId: 'ctxg4-selector-v1',
    maxReadCalls: input.calls ?? 20,
    maxRetrievedTokens: input.tokens ?? 30_000,
    allowOriginalRead: input.allowOriginal ?? true,
    candidateAccess: input.candidateAccess ?? 'forbidden',
  }
}

async function seedResources() {
  const fixture = await seedWorkspace()
  const { scope } = fixture
  const primaryGroupId = await addScoped(scope, 'worldGroups', {
    name: '主潮界', description: '主世界', type: 'primary', order: 0,
  }, 'world')
  const otherGroupId = await addScoped(scope, 'worldGroups', {
    name: '雾界', description: '隔离世界', type: 'parallel', order: 1,
  }, 'world')
  const worldviewId = await addScoped(scope, 'worldviews', {
    worldGroupId: primaryGroupId,
    worldOrigin: '潮汐托起大陆。',
    races: '潮民依靠月相航行。',
  }, 'world')
  await addScoped(scope, 'worldviews', {
    worldGroupId: otherGroupId,
    races: '不应泄漏的雾族。',
  }, 'world')
  const characterId = await addScoped(scope, 'characters', {
    homeWorldGroupId: primaryGroupId, isCrossWorld: false, name: '航海者', role: 'protagonist',
    roleWeight: 'main', shortDescription: '追逐潮门', identity: '潮民', goals: '开启潮门',
  }, 'world')
  const arcId = await addScoped(scope, 'storyArcs', {
    name: '潮门主线', type: 'main', description: '寻找潮门', stages: '[]',
  }, 'work')
  await addScoped(scope, 'storylineProgress', {
    arcId, currentStageId: null, status: 'active', progressNote: '潮门计划推进到港口',
    lastActiveChapterId: null, involvedEntities: '[]', evidenceQuote: '潮门已经响应。',
  }, 'work')
  const nodeId = await addScoped(scope, 'outlineNodes', {
    parentId: null, type: 'chapter', title: '港口章', summary: '抵达港口', order: 0,
    worldGroupId: primaryGroupId,
  }, 'work')
  const chapterId = await addScoped(scope, 'chapters', {
    outlineNodeId: nodeId, title: '港口章', content: '<p>航海者抵达港口。</p>', wordCount: 10,
    status: 'draft', order: 0, notes: '',
  }, 'work')
  await addScoped(scope, 'temporalFacts', {
    worldGroupId: primaryGroupId, characterId, subjectName: '航海者', predicate: 'location',
    factKind: 'state', value: '港口', sourceType: 'chapter', sourceChapterId: chapterId,
    sourceQuote: '航海者抵达港口。', validFromChapterId: chapterId, validToChapterId: null,
    status: 'confirmed', locked: true,
  }, 'work')
  const candidatePlanId = await addScoped(scope, 'characterDrivenPlans', {
    name: '未采纳潮门计划', premise: '候选方案', generatedArcs: '[]', generatedVolumes: '[]', status: 'generated',
  }, 'work')
  const otherWorkId = await db.works.add({
    projectId: scope.projectId, worldId: scope.worldId, code: 'ctxg4-other-work', title: '隔离作品',
    description: '', genres: [], status: 'drafting', targetWordCount: 1000, createdAt: now, updatedAt: now,
  } as any) as number
  await addScoped({ ...scope, workId: otherWorkId }, 'storyCores', {
    logline: '不应泄漏的另一作品故事', concept: '', theme: '', centralConflict: '',
    plotPattern: '', mainPlot: '', subPlots: '',
  }, 'work')
  return {
    ...fixture, primaryGroupId, otherGroupId, worldviewId, characterId, arcId, chapterId, candidatePlanId,
  }
}

async function descriptorKeys(scope: WorkspaceScope, worldGroupId: number) {
  const items = []
  let cursor: string | undefined
  do {
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: { ...scope, worldGroupId }, limit: 100, cursor })
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return items
}

async function resourceSnapshot(projectId: number) {
  return JSON.stringify(await Promise.all(contextResourceSpecsV1().map(async spec => ({
    table: spec.name,
    rows: await spec.table.where('projectId').equals(projectId).toArray(),
  }))))
}

describe('CTXG-4 · Context Gateway read tools', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('registers four tools only in the existing registry and requires a host-frozen session', async () => {
    for (const name of ['list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence']) {
      const tool = AGENT_READ_TOOLS.find(candidate => candidate.name === name)!
      expect(tool).toBeTruthy()
      expect(tool.risk).toBe('read')
      expect(tool.parameters.additionalProperties).toBe(false)
    }
    const withoutSession = await executeAgentTool('list_context_catalog', { projectId: 1 }, {})
    expect(withoutSession.ok).toBe(false)
    expect(withoutSession.error).toContain('Host 未提供')
    const injected = await executeAgentTool('list_context_catalog', { projectId: 1 }, { projectId: 2 })
    expect(injected.ok).toBe(false)
    expect(injected.error).toContain('不允许的参数')
  })

  it('lists metadata only and searches by kind, relation, story arc and time with bound cursors', async () => {
    const fixture = await seedResources()
    const frozenScope = { ...fixture.scope, worldGroupId: fixture.primaryGroupId }
    const session = await createContextGatewayToolSessionV1({ scope: frozenScope, policy: policy() })
    const first = await executeAgentTool('list_context_catalog', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, { kinds: ['worldview-field'], limit: 1 })
    expect(first.ok).toBe(true)
    const firstBody = JSON.parse(first.content)
    expect(firstBody.items).toHaveLength(1)
    expect(firstBody.nextCursor).toBeTruthy()
    expect(first.content).not.toContain('sourceRefs')
    expect(first.content).not.toContain('recordId')
    expect(firstBody.pageKindCounts['worldview-field']).toBe(1)
    const second = await executeAgentTool('list_context_catalog', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, { kinds: ['worldview-field'], limit: 1, cursor: firstBody.nextCursor })
    expect(second.ok).toBe(true)
    expect(JSON.parse(second.content).items[0].resourceKey).not.toBe(firstBody.items[0].resourceKey)

    const all = await descriptorKeys(fixture.scope, fixture.primaryGroupId)
    const arcKey = all.find(item => item.kind === 'story-arc' && !item.resourceKey.includes(':field:'))!.resourceKey
    const characterKey = all.find(item => item.kind === 'character' && !item.resourceKey.includes(':field:'))!.resourceKey
    const progress = await executeAgentTool('search_context', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, {
      query: '潮门计划', kinds: ['storyline-progress'], storyArcKeys: [arcKey], limit: 5,
    })
    expect(progress.ok).toBe(true)
    expect(JSON.parse(progress.content).items.length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(progress.content).items.every((item: any) => item.kind === 'storyline-progress')).toBe(true)
    const fact = await executeAgentTool('search_context', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, {
      query: '航海者', kinds: ['fact'], entityKeys: [characterKey],
      timeRange: { throughChapterId: fixture.chapterId }, limit: 5,
    })
    expect(fact.ok).toBe(true)
    expect(JSON.parse(fact.content).items.some((item: any) => item.title.includes('航海者'))).toBe(true)

    const forgedCursor = await executeAgentTool('search_context', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, { query: '另一查询', kinds: ['fact'], limit: 1, cursor: firstBody.nextCursor })
    expect(forgedCursor.ok).toBe(false)
    expect(forgedCursor.error).toContain('cursor')
  })

  it('enforces kind/depth/candidate/original policy and only accepts current-session source capabilities', async () => {
    const fixture = await seedResources()
    const frozenScope = { ...fixture.scope, worldGroupId: fixture.primaryGroupId }
    const all = await descriptorKeys(fixture.scope, fixture.primaryGroupId)
    const races = all.find(item => item.resourceKey.endsWith(':field:races'))!
    const character = all.find(item => item.kind === 'character' && !item.resourceKey.includes(':field:'))!
    const candidate = all.find(item => item.title.includes('未采纳潮门计划') && !item.resourceKey.includes(':field:'))!
    const session = await createContextGatewayToolSessionV1({
      scope: frozenScope,
      policy: policy({ kinds: ['worldview-field'], depths: ['full', 'original'] }),
    })
    const read = await executeAgentTool('read_context_resource', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, { resourceKey: races.resourceKey, depth: 'full', maxTokens: 1000 })
    expect(read.ok).toBe(true)
    const readBody = JSON.parse(read.content)
    expect(readBody.content).toBe('潮民依靠月相航行。')
    expect(readBody.sourceRefCapabilities[0]).toMatch(/^ctxref_v1_/)
    expect(read.content).not.toContain('worldviews')
    expect(read.meta.gateway?.sourceRefEvidence[0].sourceRef.table).toBe('worldviews')
    expect(read.content).not.toContain('sourceRefEvidence')

    const original = await executeAgentTool('read_original_evidence', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, { sourceRef: readBody.sourceRefCapabilities[0], maxTokens: 1000 })
    expect(original.ok).toBe(true)
    expect(JSON.parse(original.content).content).toBe('潮民依靠月相航行。')
    const forged = await executeAgentTool('read_original_evidence', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, { sourceRef: `${readBody.sourceRefCapabilities[0]}x`, maxTokens: 1000 })
    expect(forged.ok).toBe(false)
    expect(forged.error).toContain('当前 Gateway session')
    const otherSession = await createContextGatewayToolSessionV1({
      scope: frozenScope,
      policy: policy({ kinds: ['worldview-field'], depths: ['full', 'original'] }),
    })
    const crossSession = await executeAgentTool('read_original_evidence', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: otherSession,
    }, { sourceRef: readBody.sourceRefCapabilities[0], maxTokens: 1000 })
    expect(crossSession.ok).toBe(false)

    const deniedKind = await executeAgentTool('read_context_resource', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: session,
    }, { resourceKey: character.resourceKey, depth: 'full', maxTokens: 1000 })
    expect(deniedKind.ok).toBe(false)
    expect(deniedKind.content).toBe('')
    const deniedDepthSession = await createContextGatewayToolSessionV1({
      scope: frozenScope, policy: policy({ kinds: ['worldview-field'], depths: ['summary'], allowOriginal: false }),
    })
    const deniedDepth = await executeAgentTool('read_context_resource', {
      projectId: fixture.projectId, contextGatewaySession: deniedDepthSession,
    }, { resourceKey: races.resourceKey, depth: 'full', maxTokens: 1000 })
    expect(deniedDepth.ok).toBe(false)
    expect(deniedDepth.error).toContain('depth')
    const summaryRead = await executeAgentTool('read_context_resource', {
      projectId: fixture.projectId, contextGatewaySession: deniedDepthSession,
    }, { resourceKey: races.resourceKey, depth: 'summary', maxTokens: 1000 })
    expect(summaryRead.ok).toBe(true)
    const deniedOriginal = await executeAgentTool('read_original_evidence', {
      projectId: fixture.projectId, contextGatewaySession: deniedDepthSession,
    }, { sourceRef: JSON.parse(summaryRead.content).sourceRefCapabilities[0], maxTokens: 1000 })
    expect(deniedOriginal.ok).toBe(false)
    expect(deniedOriginal.error).toContain('original')

    const candidateDenied = await createContextGatewayToolSessionV1({
      scope: frozenScope,
      policy: policy({ kinds: ['narrative-blueprint'], depths: ['full'], allowOriginal: false }),
    })
    expect((await executeAgentTool('read_context_resource', {
      projectId: fixture.projectId, contextGatewaySession: candidateDenied,
    }, { resourceKey: candidate.resourceKey, depth: 'full', maxTokens: 1000 })).ok).toBe(false)
    const candidateAllowed = await createContextGatewayToolSessionV1({
      scope: frozenScope,
      policy: policy({
        kinds: ['narrative-blueprint'], depths: ['full'], allowOriginal: false,
        candidateAccess: 'explicit-resource-key-only',
      }),
    })
    expect((await executeAgentTool('read_context_resource', {
      projectId: fixture.projectId, contextGatewaySession: candidateAllowed,
    }, { resourceKey: candidate.resourceKey, depth: 'full', maxTokens: 1000 })).ok).toBe(true)

    await db.worldviews.update(fixture.worldviewId, { races: '潮民已经停止航行。', updatedAt: now + 1 })
    const stale = await executeAgentTool('read_original_evidence', {
      projectId: fixture.projectId, contextGatewaySession: session,
    }, { sourceRef: readBody.sourceRefCapabilities[0], maxTokens: 1000 })
    expect(stale.ok).toBe(false)
    expect(stale.error).toContain('当前版本')
  })

  it('fails closed on call/token budgets, deleted/cross-scope resources, and performs zero database writes', async () => {
    const fixture = await seedResources()
    const frozenScope = { ...fixture.scope, worldGroupId: fixture.primaryGroupId }
    const before = await resourceSnapshot(fixture.projectId)
    const limited = await createContextGatewayToolSessionV1({
      scope: frozenScope, policy: policy({ kinds: ['worldview-field'], calls: 1, tokens: 100 }),
    })
    const overTokens = await executeAgentTool('read_context_resource', {
      projectId: fixture.projectId, contextGatewaySession: limited,
    }, { resourceKey: 'worldview-field:not-needed', depth: 'full', maxTokens: 101 })
    expect(overTokens.ok).toBe(false)
    expect(overTokens.error).toContain('剩余额度')
    const overCalls = await executeAgentTool('list_context_catalog', {
      projectId: fixture.projectId, contextGatewaySession: limited,
    }, { limit: 1 })
    expect(overCalls.ok).toBe(false)
    expect(overCalls.error).toContain('read call')

    const scopeSession = await createContextGatewayToolSessionV1({ scope: frozenScope, policy: policy() })
    const mismatchedHost = await executeAgentTool('list_context_catalog', {
      projectId: fixture.projectId + 1, contextGatewaySession: scopeSession,
    }, { limit: 1 })
    expect(mismatchedHost.ok).toBe(false)
    expect(mismatchedHost.error).toContain('projectId')
    const catalog = await executeAgentTool('list_context_catalog', {
      projectId: fixture.projectId, contextGatewaySession: scopeSession,
    }, { kinds: ['worldview-field'], limit: 20 })
    expect(catalog.ok).toBe(true)
    expect(catalog.content).not.toContain('不应泄漏的雾族')
    const crossWork = await executeAgentTool('search_context', {
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
      contextGatewaySession: scopeSession,
    }, { query: '不应泄漏', kinds: ['story-core-field'], limit: 10 })
    expect(crossWork.ok).toBe(true)
    expect(JSON.parse(crossWork.content).items).toHaveLength(0)
    expect(await resourceSnapshot(fixture.projectId)).toBe(before)
    const racesKey = JSON.parse(catalog.content).items.find((item: any) => item.resourceKey.endsWith(':field:races')).resourceKey
    await db.worldviews.delete(fixture.worldviewId)
    const deleted = await executeAgentTool('read_context_resource', {
      projectId: fixture.projectId, contextGatewaySession: scopeSession,
    }, { resourceKey: racesKey, depth: 'full', maxTokens: 1000 })
    expect(deleted.ok).toBe(false)
    expect(deleted.content).toBe('')

    const afterDelete = await resourceSnapshot(fixture.projectId)
    expect(afterDelete).not.toBe(before)
    // 除了测试显式删除的 Canon 行，所有 Gateway 工具都只改变内存 session。
    const afterTools = await resourceSnapshot(fixture.projectId)
    expect(afterTools).toBe(afterDelete)
  })
})
