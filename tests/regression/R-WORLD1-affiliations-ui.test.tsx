import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterWorldAffiliations from '../../src/components/character/CharacterWorldAffiliations'
import { db } from '../../src/lib/db/schema'
import { useCultivationStore } from '../../src/stores/cultivation'
import { useCodexStore } from '../../src/stores/codex'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('WORLD-1 · 角色种族与修炼关联视图', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('native missing workspace is visible, hides cached choices and retries only on author request', async () => {
    const projectId = await seedCurrentProject({ name: 'read failure' })
    const workspace = (await db.projects.get(projectId))!
    const systemId = await db.cultivationSystems.add({ projectId, name: '原体系', description: '原文', stages: '[]', createdAt: 1, updatedAt: 1 }) as number
    await finalizeCurrentFixtureV1(projectId)
    const before = await db.cultivationSystems.toArray()
    await db.projects.delete(projectId)
    useCultivationStore.setState({ systems: [{ ...before[0], projectId: projectId + 99, name: '另一作品的缓存' }] })
    const onChange = vi.fn()
    await act(async () => {
      root.render(createElement(CharacterWorldAffiliations, { projectId, worldGroups: [],
        character: { id: 1, projectId, name: '角色', cultivationSystemId: systemId, cultivationStageId: 'old' } as any, onChange }))
    })
    await act(async () => { await vi.waitFor(() => expect(useCultivationStore.getState().loadError).toBeTruthy()) })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('角色关联读取失败')
    expect(host.textContent).not.toContain('另一作品的缓存')
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="主修体系"]')?.disabled).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(await db.cultivationSystems.toArray()).toEqual(before)
    await db.projects.add(workspace)
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    const retry = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '重新读取')!
    await act(async () => { retry.click() })
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); expect(host.textContent).toContain('原体系') })
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="主修体系"]')?.value).toBe(String(systemId))
    expect(onChange).not.toHaveBeenCalled()
    expect(await db.cultivationSystems.toArray()).toEqual(before)
    expect(useCodexStore.getState().loadError).toBeNull()
    const otherScope = { ...useCultivationStore.getState().loadedScope!, projectId: projectId + 99 }
    await act(async () => useCultivationStore.setState({ loadedScope: otherScope, systems: [{ ...before[0], projectId: projectId + 99, name: '另一作品的缓存' }] }))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('来源已切换')
    expect(host.textContent).not.toContain('另一作品的缓存')
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="主修体系"]')?.disabled).toBe(true)
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === '重新读取')!.click())
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); expect(host.textContent).toContain('原体系') })
    expect(onChange).not.toHaveBeenCalled()
    expect(await db.cultivationSystems.toArray()).toEqual(before)
  })

  it('普通角色只看到所属世界选项，选择体系时原子清空旧境界', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'ui', enableMultiWorld: true, createdAt: now, updatedAt: now,
    })
    const worldA = await db.worldGroups.add({
      projectId, name: '镜界', description: '', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '雾界', description: '', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number
    const categoryId = await db.codexCategories.add({
      projectId, domain: 'humanity', builtInKey: 'race', name: '种族',
      parentId: null, fieldSchema: '[]', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    await db.codexEntries.bulkAdd([
      { projectId, categoryId, worldGroupId: worldA, name: '镜裔', createdAt: now, updatedAt: now },
      { projectId, categoryId, worldGroupId: worldB, name: '雾裔', createdAt: now, updatedAt: now },
    ] as any)
    const systemA = await db.cultivationSystems.add({
      projectId, worldGroupId: worldA, name: '镜术', description: '',
      stages: JSON.stringify([{ id: 'mirror', name: '凝镜', parentStageIds: [] }]),
      createdAt: now, updatedAt: now,
    }) as number
    await db.cultivationSystems.add({
      projectId, worldGroupId: worldB, name: '雾术', description: '', stages: '[]',
      createdAt: now, updatedAt: now,
    })
    await finalizeCurrentFixtureV1(projectId)
    const onChange = vi.fn()

    await act(async () => {
      root.render(createElement(CharacterWorldAffiliations, {
        projectId,
        worldGroups: await db.worldGroups.where('projectId').equals(projectId).toArray(),
        character: {
          id: 1, projectId, name: '林舟', homeWorldGroupId: worldA, isCrossWorld: false,
          cultivationSystemId: systemA, cultivationStageId: 'mirror',
        } as any,
        onChange,
      }))
    })
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(host.textContent).toContain('镜裔')
    })

    expect(host.textContent).not.toContain('雾裔')
    expect(host.textContent).toContain('镜术')
    expect(host.textContent).not.toContain('雾术')
    const systemSelect = host.querySelector<HTMLSelectElement>('select[aria-label="主修体系"]')!
    await act(async () => {
      systemSelect.value = ''
      systemSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({
      cultivationSystemId: null,
      cultivationStageId: null,
    })
  })
})
