import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CharacterDetailCard from '../../src/components/character/CharacterDetailCard'
import type { Character, Project, WorldGroup } from '../../src/lib/types'
import { AuthorRecordSaveScopeV1 } from '../../src/components/shared/AuthorRecordSaveScope'
import type { LocalSaveAckV1, LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

vi.mock('../../src/lib/authoring/record-text-save-evidence', () => ({
  readRecordTextWitnessesV1: vi.fn(async () => Object.fromEntries([['name', '林照雪'], ['shortDescription', '守城人']].map(([field, value]) => {
    const identity = { projectId: 1, worldId: 11, workId: 12, table: 'characters', field, recordId: 7, worldGroupId: null }
    return [field, { version: 1, source: 'database-read', identity, recordId: 7, resourceUid: 'character-header', present: true, value, valueHash: `hash-${value}`, confirmedAt: 1 }]
  }))),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  resetPendingEditCoordinatorForTestsV1()
})

function character(patch: Partial<Character> = {}): Character {
  return {
    id: 7,
    projectId: 1,
    name: '林照雪',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'lawful',
    shortDescription: '守城人',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '与沈砚并肩作战',
    arc: '',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

const worlds: WorldGroup[] = [{
  id: 12,
  projectId: 1,
  name: '镜城',
  description: '',
  type: 'primary',
  icon: '城',
  order: 0,
  createdAt: 1,
  updatedAt: 1,
}]

const project = {
  id: 1,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
  workspacePurpose: 'independent-work',
  name: '镜城纪事',
  enableMultiWorld: true,
  activeWorldId: 11,
  activeWorkId: 12,
  createdAt: 1,
  updatedAt: 1,
} satisfies Project

async function renderCard(overrides: Partial<Parameters<typeof CharacterDetailCard>[0]> = {}, verified = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  const props = {
    char: character(),
    glyphColor: 'test-glyph',
    project,
    multiWorld: true,
    worldGroups: worlds,
    onUpdateField: vi.fn(),
    onPatch: vi.fn(),
    onReload: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  await act(async () => root.render(createElement(AuthorRecordSaveScopeV1.Provider,
    { value: verified ? { projectId: 1, worldId: 11, workId: 12 } : null }, createElement(CharacterDetailCard, props))))
  return { host, props }
}

describe('AUDIT-6 / HEALTH-4 · 角色详情卡', () => {
  it.each([['name', '角色姓名', '林照雪'], ['shortDescription', '角色一句话简介', '守城人']] as const)('header %s forwards its exact record proof to the original parent callback', async (field, label, oldValue) => {
    const onUpdateField = vi.fn(async (_field: keyof Character, value: string, intent?: LocalSaveIntentV1): Promise<LocalSaveAckV1> => ({
      kind: 'natural-field-local-save-ack-v1', session: intent!.session, generation: intent!.generation,
      witness: { ...intent!.expected, source: 'committed-write', value, valueHash: `hash-${value}` },
    }))
    const { host } = await renderCard({ onUpdateField }, true)
    const readView = Array.from(host.querySelectorAll<HTMLElement>('.cursor-text')).find(el => el.textContent?.replace(/[“”]/g, '') === oldValue)!
    await act(async () => readView.click())
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '作者新文本')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => flushPendingEditsV1())
    expect(onUpdateField).toHaveBeenCalledExactlyOnceWith(field, '作者新文本', expect.objectContaining({
      expected: expect.objectContaining({ value: oldValue, identity: expect.objectContaining({ table: 'characters', field, recordId: 7, worldId: 11, workId: 12 }) }),
    }))
  })
  it('把世界归属、三轴和删除命令交还父级，不在子组件直接写 store', async () => {
    const { host, props } = await renderCard()
    expect(host.textContent).toContain('林照雪')
    expect(host.textContent).toContain('主要')
    expect(host.textContent).toContain('守序善良')

    const select = host.querySelector<HTMLSelectElement>('select[aria-label="角色所属世界"]')!
    await act(async () => {
      select.value = 'cross'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(props.onPatch).toHaveBeenCalledWith({ isCrossWorld: true, homeWorldGroupId: null })

    const secondary = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '次要')!
    await act(async () => secondary.click())
    expect(props.onPatch).toHaveBeenCalledWith({
      roleWeight: 'secondary',
      moralAxis: 'good',
      orderAxis: 'lawful',
    })

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="删除角色"]')!.click())
    expect(props.onDelete).toHaveBeenCalledOnce()
  })

  it('折叠只隐藏维度和人物关系，展开后仍使用同一受控数据', async () => {
    const { host } = await renderCard()
    expect(host.querySelector('textarea[placeholder="性格…"]')).not.toBeNull()
    expect(host.textContent).toContain('与沈砚并肩作战')

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="收起角色详情"]')!.click())
    expect(host.querySelector('textarea[placeholder="性格…"]')).toBeNull()
    expect(host.textContent).not.toContain('与沈砚并肩作战')

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="展开角色详情"]')!.click())
    expect(host.querySelector('textarea[placeholder="性格…"]')).not.toBeNull()
    expect(host.textContent).toContain('与沈砚并肩作战')
  })
})
