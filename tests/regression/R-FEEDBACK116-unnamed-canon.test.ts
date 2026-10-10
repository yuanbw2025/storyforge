import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { ContextResourceDescriptorV1, WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function seed() {
  const { scope } = await seedCurrentWorkspace('反馈 116 隔离作品')
  async function add(table: string, row: Record<string, unknown>, owner: 'work' | 'world' = 'work') {
    return (db as any)[table].add(stampNewRecord(scope, table, {
      projectId: scope.projectId, createdAt: 1, updatedAt: 1, ...row,
    }, { owner })) as Promise<number>
  }
  const outlineNodeId = await add('outlineNodes', {
    parentId: null, type: 'chapter', title: '潮门开场', summary: '守灯人与使者在潮门相遇。', order: 0,
  })
  await add('detailedOutlines', { outlineNodeId, scenes: [], openingHook: '潮门开启' })
  const arcIds = await Promise.all(['主线', '支线'].map(name =>
    add('storyArcs', { name, type: name === '主线' ? 'main' : 'sub', description: '', stages: '[]' }),
  ))
  return { scope, add, arcIds, input: {
    projectId: scope.projectId, scope, worldGroupId: null, outlineNodeId,
    operation: 'generate' as const, authorRequest: '按已确认交汇和进度生成正文',
    config: useAIConfigStore.getState().config,
  } }
}

async function addPair(f: Awaited<ReturnType<typeof seed>>, table: 'storylineProgress' | 'storylineCrossings') {
  return Promise.all(f.arcIds.map((arcId, index) => table === 'storylineProgress'
    ? f.add(table, { arcId, status: 'active', progressNote: `进度证据 ${index}`, involvedEntities: '[]', evidenceQuote: `推进 ${index}` })
    : f.add(table, { arcIdA: f.arcIds[0], arcIdB: f.arcIds[1], chapterId: null, chapterTitle: '', note: `交汇证据 ${index}`, evidenceQuote: `相遇 ${index}` })))
}

async function descriptors(scope: WorkspaceScope) {
  const items: ContextResourceDescriptorV1[] = []
  let cursor: string | undefined
  do {
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: { ...scope, worldGroupId: null }, limit: 100, cursor })
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return items.filter(item => item.kind === 'storyline-progress')
}

describe('R-FEEDBACK116 unnamed Canon records keep separate stable identities', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it.each(['storylineProgress', 'storylineCrossings'] as const)('%s rows coexist through the real prose Gateway', async table => {
    const f = await seed()
    await addPair(f, table)
    const result = await prepareProseGatewayAssemblyV1(f.input)
    const content = result.contextGatewayExecution.contextPacket.content
    for (const index of [0, 1]) expect(content).toContain(`${table === 'storylineProgress' ? '进度' : '交汇'}证据 ${index}`)
  })

  it('record and shared-field titles are unique and survive backup ID remapping', async () => {
    const f = await seed()
    const ids = [...await addPair(f, 'storylineProgress'), ...await addPair(f, 'storylineCrossings')]
    const before = await descriptors(f.scope)
    expect(before.filter(item => !item.resourceKey.includes(':field:'))).toHaveLength(4)
    expect(new Set(before.map(item => item.title)).size).toBe(before.length)
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const ownership = await resolveWorkspaceOwnership(projectId)
    const after = await descriptors(ownership.scope)
    const byKey = new Map(after.map(item => [item.resourceKey, item]))
    for (const item of before) {
      const imported = byKey.get(item.resourceKey)!
      expect(imported).toBeTruthy()
      expect(imported.title).toBe(item.title)
      // Foreign-key projections legitimately change with import remapping;
      // the stable title and unchanged semantic fields must not.
      if (item.resourceKey.includes(':field:') && !item.sourceRefs.some(ref => ['arcIdA', 'arcIdB'].includes(ref.field))) {
        expect(imported.contentHash).toBe(item.contentHash)
      }
      expect(imported.sourceRefs[0].recordId).not.toBe(item.sourceRefs[0].recordId)
    }
    expect((await db.storylineProgress.bulkGet(ids.slice(0, 2))).every(Boolean)).toBe(true)
  })

  it('author-named canon with differing content still blocks prose', async () => {
    const f = await seed()
    for (const shortDescription of ['守灯人', '走私者']) {
      await f.add('characters', { name: '岑阿婆', shortDescription, homeWorldGroupId: null, isCrossWorld: false, roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral' }, 'world')
    }
    await expect(prepareProseGatewayAssemblyV1(f.input)).rejects.toThrow('same-name-different-canon')
  })

  it('singleton worldview retains its existing author-facing label', async () => {
    const f = await seed()
    await f.add('worldviews', { worldGroupId: null, races: '潮民' }, 'world')
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: { ...f.scope, worldGroupId: null }, limit: 100 })
    const worldview = page.items.find(item => item.sourceRefs[0]?.table === 'worldviews' && !item.resourceKey.includes(':field:'))!
    expect(worldview).toBeTruthy()
    expect(worldview.title).toContain('主世界观')
    expect(worldview.title).not.toContain('res:v1:')
  })
})
