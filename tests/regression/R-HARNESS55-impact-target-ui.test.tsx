import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  factStore: {
    facts: [] as any[],
    loading: false,
    load: vi.fn(async () => undefined),
    confirmFact: vi.fn(async () => undefined),
    rejectFact: vi.fn(async () => undefined),
    importCandidateDiff: vi.fn(async () => ({ written: 0, skippedDuplicate: 0, skippedInvalid: 0 })),
  },
  relationStore: {
    relations: [] as any[],
    addRelation: vi.fn(async () => 1),
    updateRelation: vi.fn(async () => undefined),
    deleteRelation: vi.fn(async () => undefined),
  },
  characterStore: {
    characters: [] as any[],
    loadAll: vi.fn(async () => undefined),
  },
  stateStore: {
    cards: [] as any[],
    loading: false,
    loadAll: vi.fn(async () => undefined),
    addCard: vi.fn(async () => 1),
    updateCard: vi.fn(async () => undefined),
    buildStateContext: vi.fn(() => ''),
  },
  chapterStore: { chapters: [] as any[], loadAll: vi.fn(async () => undefined) },
  itemStore: { entries: [] as any[], loadAll: vi.fn(async () => undefined) },
  codexStore: { categories: [] as any[], entries: [] as any[], loadAll: vi.fn(async () => undefined) },
  ai: {
    isStreaming: false,
    output: '',
    error: null as string | null,
    start: vi.fn(),
    reset: vi.fn(),
  },
}))

vi.mock('../../src/stores/fact-ledger', () => ({
  useFactLedgerStore: () => mocks.factStore,
}))

vi.mock('../../src/components/facts/KnowledgeLedgerPanel', () => ({
  default: () => createElement('div'),
}))

vi.mock('../../src/components/facts/WorldConstitutionPanel', () => ({
  default: () => createElement('div'),
}))

vi.mock('../../src/stores/character-relation', () => ({
  useCharacterRelationStore: () => mocks.relationStore,
}))

vi.mock('../../src/stores/character', () => ({
  useCharacterStore: Object.assign(() => mocks.characterStore, {
    getState: () => mocks.characterStore,
  }),
}))

vi.mock('../../src/stores/state-card', () => ({
  useStateCardStore: () => mocks.stateStore,
}))

vi.mock('../../src/stores/chapter', () => ({
  useChapterStore: () => mocks.chapterStore,
}))

vi.mock('../../src/stores/item-ledger', () => ({
  useItemLedgerStore: () => mocks.itemStore,
}))

vi.mock('../../src/stores/codex', () => ({
  useCodexStore: () => mocks.codexStore,
}))

vi.mock('../../src/hooks/useAIStream', () => ({
  useAIStream: () => mocks.ai,
}))

vi.mock('../../src/components/shared/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../src/components/relations/RelationGraph', () => ({
  default: () => createElement('div', { 'data-testid': 'relation-graph' }),
}))

import FactLibraryPanel from '../../src/components/facts/FactLibraryPanel'
import CharacterRelationPanel from '../../src/components/relations/CharacterRelationPanel'
import StatePanel from '../../src/components/state/StatePanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1,
  name: '人工落点',
  genre: 'fantasy',
  genres: ['fantasy'],
  enableMultiWorld: false,
} as Project

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function render(element: ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => {
    root.render(element)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return host
}

beforeEach(() => {
  mocks.factStore.facts = []
  mocks.relationStore.relations = []
  mocks.characterStore.characters = []
  mocks.stateStore.cards = []
  mocks.chapterStore.chapters = []
  mocks.itemStore.entries = []
  mocks.codexStore.categories = []
  mocks.codexStore.entries = []
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS55 · 人工交接目标在现有面板精确显露', () => {
  it('事实目标不在默认异常页签时，自动切到真实状态页签并高亮该行', async () => {
    mocks.factStore.facts = [{
      id: 17,
      projectId: 1,
      subjectName: '林飞',
      predicate: 'location',
      value: '雾港',
      status: 'confirmed',
      locked: false,
      sourceType: 'manual',
      factKind: 'state',
      createdAt: 1,
      updatedAt: 1,
    }]
    const host = await render(createElement(FactLibraryPanel, { project, initialFactId: 17 }))
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector('[data-impact-target-id="17"]')).not.toBeNull())
    })
    expect(host.textContent).toContain('林飞')
    expect(host.textContent).toContain('Canon')
    expect(host.querySelector('[data-impact-target-id="17"]')?.className).toContain('ring-2')
  })

  it('关系目标在默认关系图中不可见时，自动切到列表但不自动进入编辑态', async () => {
    mocks.characterStore.characters = [
      { id: 1, projectId: 1, homeWorldGroupId: 7, name: '林飞' },
      { id: 2, projectId: 1, homeWorldGroupId: 7, name: '沈砚' },
    ]
    mocks.relationStore.relations = [{
      id: 23,
      projectId: 1,
      fromCharacterId: 1,
      toCharacterId: 2,
      relationType: 'ally',
      label: '临时盟友',
      description: '共同守住雾港。',
      isBidirectional: true,
      createdAt: 1,
      updatedAt: 1,
    }]
    const host = await render(createElement(CharacterRelationPanel, {
      project,
      worldGroupId: 7,
      initialRelationId: 23,
    }))
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector('[data-impact-target-id="23"]')).not.toBeNull())
    })
    expect(host.querySelector('[data-testid="relation-graph"]')).toBeNull()
    expect(host.textContent).toContain('临时盟友')
    expect(host.textContent).toContain('编辑')
    expect(host.textContent).not.toContain('收起')
  })

  it('非角色或失去角色映射的状态记录只在可信交接中显露，且保持只读初始态', async () => {
    mocks.stateStore.cards = [{
      id: 31,
      projectId: 1,
      category: 'faction',
      entityName: '雾港议会',
      fields: JSON.stringify([{ key: '控制区域', value: '旧港区' }]),
      createdAt: 1,
      updatedAt: 1,
    }]
    const host = await render(createElement(StatePanel, {
      project,
      initialStateCardId: 31,
    }))
    const target = host.querySelector('[data-impact-target-id="31"]')
    expect(target).not.toBeNull()
    expect(target?.textContent).toContain('雾港议会')
    expect(target?.textContent).toContain('控制区域')
    expect(target?.querySelector('button[title="编辑状态"]')).not.toBeNull()
    expect(target?.textContent).not.toContain('保存')
  })
})
