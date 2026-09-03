import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NAV_TREE, type TreeNode } from '../../src/components/layout/sidebar-tree'
import { db } from '../../src/lib/db/schema'
import {
  FORMAL_PRODUCT_SESSION_KINDS_V1,
  isFormalProductSessionKindV1,
} from '../../src/lib/product/runtime-boundary'
import * as productRuntime from '../../src/lib/product/runtime-api'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { useTtrpgRuntimePlayerStore } from '../../src/stores/ttrpg-runtime-player'

function allLeafIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap(node => node.kind === 'leaf' ? [node.id] : allLeafIds(node.children))
}

describe('ARCH-03 · 世界/作者草稿不得绕过产品生产直启正式运行', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('同一正式类型注册表覆盖全部上层运行类型，生产 kernel 和 store 均没有无绑定创建入口', async () => {
    await createWorkspace({
      name: 'ARCH-03 三阶段闸门', genre: 'fantasy', genres: ['fantasy'],
      status: 'drafting', description: '', targetWordCount: 100_000,
      enableMultiWorld: false,
    }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })

    expect([...FORMAL_PRODUCT_SESSION_KINDS_V1].sort()).toEqual([
      'avg', 'character-interaction', 'text-adventure', 'text-open-world', 'ttrpg',
    ])
    for (const kind of FORMAL_PRODUCT_SESSION_KINDS_V1) {
      expect(isFormalProductSessionKindV1(kind)).toBe(true)
    }
    expect(productRuntime).not.toHaveProperty('createProductRuntimeSession')
    expect(useTtrpgRuntimePlayerStore.getState()).not.toHaveProperty('createSession')
    expect(EMPTY_PRODUCT_RUNTIME_STATE.lastSequence).toBe(0)
  })

  it('底层实例创建器拒绝 WorldRelease/草稿快照冒充跑团产品，长篇导航也不再暴露入口', async () => {
    const created = await createWorkspace({
      name: 'ARCH-03 世界来源', genre: 'fantasy', genres: ['fantasy'],
      status: 'drafting', description: '', targetWordCount: 100_000,
      enableMultiWorld: false,
    }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })

    await expect(createProductRuntimeInstance({
      scope: created.scope,
      kind: 'ttrpg',
      title: '伪装成产品的作者快照',
      canonSnapshot: { version: 1, sources: [] },
      initialState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    } as any)).rejects.toThrow('必须且只能绑定一个 Product Release/Build')

    const leafIds = NAV_TREE.flatMap(section => [
      ...(section.rootLeaf ? [section.rootLeaf.id] : []),
      ...allLeafIds(section.children ?? []),
    ])
    expect(leafIds).not.toContain('product-runtime')
  })
})
