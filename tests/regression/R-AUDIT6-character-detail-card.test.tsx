import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CharacterDetailCard from '../../src/components/character/CharacterDetailCard'
import type { Character, WorldGroup } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

function character(patch: Partial<Character> = {}): Character {
  return {
    id: 7,
    projectId: 1,
    name: '林照雪',
    role: 'protagonist',
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

async function renderCard(overrides: Partial<Parameters<typeof CharacterDetailCard>[0]> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  const props = {
    char: character(),
    glyphColor: 'test-glyph',
    projectId: 1,
    multiWorld: true,
    worldGroups: worlds,
    onUpdateField: vi.fn(),
    onPatch: vi.fn(),
    onReload: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  await act(async () => root.render(createElement(CharacterDetailCard, props)))
  return { host, props }
}

describe('AUDIT-6 / HEALTH-4 · 角色详情卡', () => {
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
