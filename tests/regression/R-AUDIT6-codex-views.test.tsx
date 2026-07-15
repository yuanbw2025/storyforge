import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodexCategoryFieldsEditor from '../../src/components/codex/CodexCategoryFieldsEditor'
import CodexEntryDetail from '../../src/components/codex/CodexEntryDetail'
import {
  parseEntryFields,
  parseEntryRefs,
  parseFieldSchema,
  stringifyFieldSchema,
} from '../../src/lib/types/codex'
import type { CodexCategory, CodexEntry } from '../../src/lib/types/codex'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

async function mount(component: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(component))
  return host
}

function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

function category(patch: Partial<CodexCategory> = {}): CodexCategory {
  return {
    id: 1,
    projectId: 1,
    domain: 'humanity',
    parentId: null,
    name: '人工器物',
    builtInKey: 'artifact',
    fieldSchema: '[]',
    hidden: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function entry(patch: Partial<CodexEntry> = {}): CodexEntry {
  return {
    id: 10,
    projectId: 1,
    categoryId: 1,
    name: '星轨仪',
    icon: '仪',
    summary: '观测星轨',
    description: '由秘银制成',
    fields: '{}',
    refs: '{}',
    tags: '[]',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

describe('AUDIT-6 / HEALTH-4 · 词条受控视图', () => {
  it('字段管理器编辑 schema 并只通过 onSave 交还序列化结果', async () => {
    const onSave = vi.fn()
    const host = await mount(createElement(CodexCategoryFieldsEditor, {
      category: category({
        fieldSchema: stringifyFieldSchema([{ key: 'tier', label: '品级', type: 'select', options: ['一品'] }]),
      }),
      onClose: vi.fn(),
      onSave,
    }))

    const labelInput = host.querySelector<HTMLInputElement>('input[placeholder="字段名(如:品级)"]')!
    await act(async () => setControlValue(labelInput, '器物品级'))
    const optionInput = host.querySelector<HTMLInputElement>('input[placeholder^="选项,用 / 分隔"]')!
    await act(async () => setControlValue(optionInput, '凡品 / 灵品 / 神品'))
    const add = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('添加字段'))!
    await act(async () => add.click())
    expect(host.querySelectorAll('input[placeholder="字段名(如:品级)"]')).toHaveLength(2)

    const save = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '保存')!
    await act(async () => save.click())
    const saved = parseFieldSchema(onSave.mock.calls[0][0])
    expect(saved[0]).toMatchObject({ label: '器物品级', type: 'select', options: ['凡品', '灵品', '神品'] })
    expect(saved[1]).toMatchObject({ label: '新字段', type: 'text' })
  })

  it('词条详情把星级、专属字段和 ref 关联作为 patch 交还父级', async () => {
    const onChange = vi.fn()
    const artifact = category({
      fieldSchema: stringifyFieldSchema([
        { key: 'tier', label: '品级', type: 'select', options: ['凡品', '上品'] },
        { key: 'material', label: '材料', type: 'ref', refCategory: 'mineral', refMulti: true },
      ]),
    })
    const mineral = category({ id: 2, domain: 'natural', name: '矿物灵材', builtInKey: 'mineral' })
    const city = category({ id: 3, name: '城池', builtInKey: 'city' })
    const host = await mount(createElement(CodexEntryDetail, {
      entry: entry({ importance: 2 }),
      category: artifact,
      allCategories: [artifact, mineral, city],
      allEntries: [
        entry(),
        entry({ id: 11, categoryId: 2, name: '秘银' }),
        entry({ id: 12, categoryId: 3, name: '镜城' }),
      ],
      nameDuplicate: true,
      onChange,
    }))

    expect(host.textContent).toContain('本分类下已有同名词条')
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="4 星"]')!.click())
    expect(onChange).toHaveBeenCalledWith({ importance: 4 })

    const tier = host.querySelector<HTMLSelectElement>('select[aria-label="品级"]')!
    await act(async () => setControlValue(tier, '上品'))
    const fieldPatch = onChange.mock.calls.map(call => call[0]).find(patch => patch.fields)
    expect(parseEntryFields(fieldPatch.fields)).toEqual({ tier: '上品' })

    const openRefs = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('点击关联词条'))!
    await act(async () => openRefs.click())
    const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(1)
    expect(checkboxes[0].parentElement?.textContent).toContain('秘银')
    await act(async () => checkboxes[0].click())
    const refPatch = onChange.mock.calls.map(call => call[0]).find(patch => patch.refs)
    expect(parseEntryRefs(refPatch.refs)).toEqual({ material: [11] })
  })
})
