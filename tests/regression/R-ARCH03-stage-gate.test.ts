import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NAV_TREE, type TreeNode } from '../../src/components/layout/sidebar-tree'
import { db } from '../../src/lib/db/schema'
import {
  FORMAL_PRODUCT_SESSION_KINDS_V1,
  isFormalProductSessionKindV1,
} from '../../src/lib/product/runtime-boundary'
import { createSimulationSession } from '../../src/lib/simulation/runtime'
import { EMPTY_SIMULATION_STATE } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/world-engine/create-workspace'
import { createWorldInstance } from '../../src/lib/world-engine/instances'
import { useSimulationRuntimeStore } from '../../src/stores/simulation-runtime'

function allLeafIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap(node => node.kind === 'leaf' ? [node.id] : allLeafIds(node.children))
}

describe('ARCH-03 · 世界/作者草稿不得绕过产品生产直启正式运行', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('同一正式类型注册表覆盖全部上层运行类型，kernel 和 store 均在读取草稿前阻断', async () => {
    const created = await createWorkspace({
      name: 'ARCH-03 三阶段闸门', genre: 'fantasy', genres: ['fantasy'],
      status: 'drafting', description: '', targetWordCount: 100_000,
      enableMultiWorld: false,
    }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })

    expect([...FORMAL_PRODUCT_SESSION_KINDS_V1].sort()).toEqual([
      'avg', 'chatgame', 'storygame', 'textadventure', 'textsimulation', 'textworld', 'ttrpg',
    ])
    for (const kind of FORMAL_PRODUCT_SESSION_KINDS_V1) {
      expect(isFormalProductSessionKindV1(kind)).toBe(true)
      await expect(createSimulationSession({
        projectId: created.scope.projectId,
        kind,
        title: `不得直启 ${kind}`,
        initialState: structuredClone(EMPTY_SIMULATION_STATE),
      })).rejects.toThrow('正式上层产品')
    }
    await expect(useSimulationRuntimeStore.getState().createSession({
      projectId: created.scope.projectId,
      worldGroupId: null,
      scope: created.scope,
      kind: 'ttrpg',
      title: '不得从作者快照创建跑团',
      sourceKeys: [],
    })).rejects.toThrow('产品制作')

    const sandbox = await createSimulationSession({
      projectId: created.scope.projectId,
      kind: 'sandbox',
      title: '允许的内核沙盒',
      initialState: structuredClone(EMPTY_SIMULATION_STATE),
    })
    expect(sandbox.kind).toBe('sandbox')
  })

  it('底层实例创建器拒绝 WorldRelease/草稿快照冒充跑团产品，长篇导航也不再暴露入口', async () => {
    const created = await createWorkspace({
      name: 'ARCH-03 世界来源', genre: 'fantasy', genres: ['fantasy'],
      status: 'drafting', description: '', targetWordCount: 100_000,
      enableMultiWorld: false,
    }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })

    await expect(createWorldInstance({
      scope: created.scope,
      kind: 'ttrpg',
      title: '伪装成产品的作者快照',
      draftSnapshotHash: 'a'.repeat(64),
      canonSnapshot: { version: 1, sources: [] },
      initialState: structuredClone(EMPTY_SIMULATION_STATE),
    } as any)).rejects.toThrow('必须且只能绑定一个 Product Release/Build')

    const leafIds = NAV_TREE.flatMap(section => [
      ...(section.rootLeaf ? [section.rootLeaf.id] : []),
      ...allLeafIds(section.children ?? []),
    ])
    expect(leafIds).not.toContain('simulation-runtime')
  })
})
