import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useDetailedOutlineStore } from '../../src/stores/detailed-outline'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareDetailedOutlineGatewayAssemblyV1 } from '../../src/lib/outline/detail-gateway-context'
import { prepareOutlineGatewayAssemblyV1 } from '../../src/lib/outline/gateway-context'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { prepareStoryArcCopilot } from '../../src/lib/agent/story-arc-copilot'

async function seed() {
  const { scope } = await seedCurrentWorkspace('反馈 102 隔离作品')
  async function add(table: string, row: Record<string, unknown>) {
    return (db as any)[table].add(stampNewRecord(scope, table, {
      projectId: scope.projectId, createdAt: 1, updatedAt: 1, ...row,
    }, { owner: 'work' })) as Promise<number>
  }
  const outlineNodeId = await add('outlineNodes', {
    parentId: null, type: 'chapter', title: '开场', summary: '守灯人进入潮门。', order: 0,
  })
  const input = {
    projectId: scope.projectId, scope, worldGroupId: null, outlineNodeId,
    authorRequest: '根据已确认材料规划潮门开场', config: useAIConfigStore.getState().config,
  }
  return { scope, add, outlineNodeId, input }
}

async function fact(f: Awaited<ReturnType<typeof seed>>, predicate: string, value: string, sourceChapterId: number | null = null) {
  return f.add('temporalFacts', {
    subjectName: '守灯人', predicate, value, factKind: predicate === 'knows' ? 'event' : 'state',
    status: 'confirmed', sourceType: 'manual', sourceChapterId,
    validFromChapterId: null, validToChapterId: null, locked: false,
  })
}

describe('R-FEEDBACK102 longform mandatory resources agree with Canon publication', () => {
  beforeEach(async () => { await db.delete(); await db.open(); useDetailedOutlineStore.setState({ detailedOutlines: [] }) })
  afterEach(() => db.close())

  it('the actual getOrCreate empty detail does not block first scene generation', async () => {
    const f = await seed()
    const detail = await useDetailedOutlineStore.getState().getOrCreate(f.scope, f.outlineNodeId)
    const result = await prepareDetailedOutlineGatewayAssemblyV1({ ...f.input, operation: 'scenes' })
    expect(result.contextGatewayExecution.retrievalTrace.mandatory.map(x => x.resourceKey))
      .not.toContain(`detailed-outline:${detail.ragDocumentId}`)
    expect((await db.detailedOutlines.get(detail.id!))?.scenes).toEqual([])
  })

  it.each(['scenes', 'outline'] as const)('empty arc stages do not block %s generation', async mode => {
    const f = await seed()
    const arcId = await f.add('storyArcs', { name: '主线', type: 'main', description: '', stages: '[]' })
    const result = mode === 'scenes'
      ? await prepareDetailedOutlineGatewayAssemblyV1({ ...f.input, operation: 'scenes' })
      : await prepareOutlineGatewayAssemblyV1({ ...f.input, request: { kind: 'single-chapter', chapterId: f.outlineNodeId } })
    const arc = await db.storyArcs.get(arcId)
    const keys = result.contextGatewayExecution.retrievalTrace.mandatory.map(x => x.resourceKey)
    expect(keys).toContain(`story-arc:${arc!.ragDocumentId}`)
    expect(keys).not.toContain(`story-arc:${arc!.ragDocumentId}:field:stages`)
  })

  it('story arc transformation resolves confirmed crossings from their registered context kind', async () => {
    const f = await seed()
    const arcId = await f.add('storyArcs', { name: '主线', type: 'main', description: '', stages: '[]' })
    const arcIdB = await f.add('storyArcs', { name: '支线', type: 'sub', description: '', stages: '[]' })
    const crossingId = await f.add('storylineCrossings', { arcIdA: arcId, arcIdB, crossingType: 'cooperation', description: '两线相遇', chapterId: null, chapterTitle: '', evidenceQuote: '潮门相遇' })
    const result = await prepareStoryArcCopilot({
      projectId: f.scope.projectId, scope: f.scope, worldGroupId: null,
      authorRequest: '扩写现有主线的关键事件', mutationRequest: { operation: 'expand', targetArcId: arcId },
    })
    const crossing = await db.storylineCrossings.get(crossingId)
    expect(result.contextGatewayExecution?.retrievalTrace.mandatory.map(x => x.resourceKey))
      .toContain(`storyline-progress:${crossing!.ragDocumentId}`)
  })

  it('step prose gives an actionable empty-detail error while explicit Agent drafts remain allowed', async () => {
    const f = await seed()
    await useDetailedOutlineStore.getState().getOrCreate(f.scope, f.outlineNodeId)
    await expect(prepareProseGatewayAssemblyV1({ ...f.input, operation: 'generate' }))
      .rejects.toThrow('请先填写或生成目标章细纲')
    await expect(prepareProseGatewayAssemblyV1({ ...f.input, operation: 'generate', allowOutlineOnlyAgentDraft: true }))
      .resolves.toHaveProperty('contextGatewayExecution')
  })

  it('published detail content is mandatory but empty JSON fields are not', async () => {
    const f = await seed()
    const id = await f.add('detailedOutlines', { outlineNodeId: f.outlineNodeId, scenes: [], openingHook: '潮门开启', endingCliffhanger: '{}', emotionArc: 'null' })
    const result = await prepareProseGatewayAssemblyV1({ ...f.input, operation: 'generate' })
    const detail = await db.detailedOutlines.get(id)
    const keys = result.contextGatewayExecution.retrievalTrace.mandatory.map(x => x.resourceKey)
    expect(keys).toContain(`detailed-outline:${detail!.ragDocumentId}:field:openingHook`)
    expect(keys).not.toContain(`detailed-outline:${detail!.ragDocumentId}:field:endingCliffhanger`)
    expect(keys).not.toContain(`detailed-outline:${detail!.ragDocumentId}:field:emotionArc`)
  })

  it('different predicates and multiple knowledge events for one subject coexist', async () => {
    const f = await seed()
    await fact(f, 'location', '潮门')
    await fact(f, 'healthStatus', '健康')
    await fact(f, 'knows', '潮门会关闭')
    await fact(f, 'knows', '钟声来自地下')
    const result = await prepareDetailedOutlineGatewayAssemblyV1({ ...f.input, operation: 'scenes' })
    expect(result.contextGatewayExecution.retrievalTrace.mandatory.filter(x => x.resourceKey.startsWith('fact:'))).toHaveLength(4)
  })

  it('the same knowledge event recorded in separate chapters keeps separate source identities', async () => {
    const f = await seed()
    for (const order of [-2, -1]) {
      const outlineNodeId = await f.add('outlineNodes', { parentId: null, type: 'chapter', title: `前章 ${order}`, summary: '得知秘密', order })
      const chapterId = await f.add('chapters', { outlineNodeId, title: `前章 ${order}`, content: '<p>钟声来自地下。</p>', wordCount: 7, status: 'final', order })
      await fact(f, 'knows', '钟声来自地下', chapterId)
    }
    const result = await prepareDetailedOutlineGatewayAssemblyV1({ ...f.input, operation: 'scenes' })
    expect(result.contextGatewayExecution.retrievalTrace.mandatory.filter(x => x.resourceKey.startsWith('fact:'))).toHaveLength(2)
  })

  it('different values of a single-valued state still fail closed', async () => {
    const f = await seed()
    await fact(f, 'location', '潮门')
    await fact(f, 'location', '旧港')
    await expect(prepareDetailedOutlineGatewayAssemblyV1({ ...f.input, operation: 'scenes' }))
      .rejects.toThrow('same-name-different-canon')
  })
})
