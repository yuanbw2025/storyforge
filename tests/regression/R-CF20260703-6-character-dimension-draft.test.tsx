import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import CharacterDimensionFields from '../../src/components/character/CharacterDimensionFields'
import type { Character } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function character(patch: Partial<Character> = {}): Character {
  return {
    id: 1,
    projectId: 1,
    name: '测试角色',
    role: 'protagonist',
    roleWeight: 'main',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '',
    arc: '',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  } as Character
}

function input(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CF-20260703-6 · 角色完整维度草稿', () => {
  it('切换字段时忽略父级旧值回流，并在失焦/卸载前提交每个字段', async () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const patches: Partial<Character>[] = []
    const onChange = (patch: Partial<Character>) => patches.push(patch)

    await act(async () => {
      root.render(createElement(CharacterDimensionFields, { character: character(), onChange }))
    })
    const personality = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="性格…"]')!
    const background = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="背景故事…"]')!

    await act(async () => {
      personality.focus()
      input(personality, '冷静果断')
      background.focus()
      input(background, '幼年流亡')
      root.render(createElement(CharacterDimensionFields, {
        character: character({ updatedAt: 2 }),
        onChange,
      }))
    })

    expect(personality.value).toBe('冷静果断')
    expect(background.value).toBe('幼年流亡')
    expect(patches).toContainEqual({ personality: '冷静果断' })

    await act(async () => {
      root.unmount()
    })
    expect(patches).toContainEqual({ background: '幼年流亡' })
    expect(patches.filter(patch => patch.personality != null)).toHaveLength(1)
    expect(patches.filter(patch => patch.background != null)).toHaveLength(1)

    host.remove()
    vi.useRealTimers()
  })
})
