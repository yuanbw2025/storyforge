import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { addCurrentWorldFixtureV1, addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useWorldviewStore } from '../../src/stores/worldview'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { useGeographyStore } from '../../src/stores/project-singletons'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { Location, Project, WorldGroup } from '../../src/lib/types'
import WorldviewNaturalPanel from '../../src/components/worldview/WorldviewNaturalPanel'
import WorldviewHumanityPanel from '../../src/components/worldview/WorldviewHumanityPanel'
import GeographyPanel from '../../src/components/geography/GeographyPanel'
import { ToastProvider } from '../../src/components/shared/Toast'

const ai = vi.hoisted(() => ({ start: vi.fn(async () => '') }))
vi.mock('../../src/hooks/useAIStream', () => ({ useAIStream: () => ({ ...ai, isStreaming: false, output: '', error: null, tokenUsage: null }) }))
vi.mock('../../src/components/agent/useMasterCopilot', () => ({ useMasterCopilot: () => ({ pendingCandidates: [], loading: false, busy: false, readVisibleCandidateDraft: () => undefined }) }))
vi.mock('../../src/components/codex/CodexPanel', () => ({ default: () => null }))
vi.mock('../../src/components/codex/CodexSearchBar', () => ({ default: () => null }))
vi.mock('../../src/components/geography/LocationTreeMap', () => ({ default: () => null }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const oldLocation: Location = { id: 'only-A', name: 'A港口', type: 'city', description: 'A原文', significance: '', parentId: null, order: 0 }

async function fixture() {
  const made = await seedCurrentWorkspace('世界草稿隔离', { enableMultiWorld: true })
  const groups = await Promise.all((['primary', 'parallel'] as const).map(async (type, order) => {
    const row = stampNewRecord(made.scope, 'worldGroups', {
      projectId: made.project.id!, name: order ? '空世界B' : '世界A', description: '', type, order, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }) as WorldGroup
    const id = await db.worldGroups.add(row)
    return { ...row, id }
  }))
  await db.worldviews.add(stampNewRecord(made.scope, 'worldviews', {
    projectId: made.project.id!, worldGroupId: groups[0].id, worldStructure: 'A世界结构', races: 'A种族', createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }))
  await db.geographies.add(stampNewRecord(made.scope, 'geographies', {
    projectId: made.project.id!, worldGroupId: groups[0].id, overview: 'A地理总述', locations: JSON.stringify([oldLocation]), createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }))
  useWorldGroupStore.setState({ groups, activeGroupId: groups[0].id })
  return { ...made, a: groups[0].id!, b: groups[1].id! }
}

async function settle(check: () => boolean) {
  for (let index = 0; index < 100; index++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    if (check()) return
  }
  expect(check()).toBe(true)
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text))
  expect(button, text).toBeTruthy()
  await act(async () => button!.click())
}
async function input(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function visible(text: string) {
  return [...host.querySelectorAll<HTMLElement>('*')].some(node => node.textContent === text && !node.closest('.hidden'))
}
function render(variant: 'natural' | 'humanity' | 'geography', project: Project) {
  const panel = variant === 'natural' ? createElement(WorldviewNaturalPanel, { project })
    : variant === 'humanity' ? createElement(WorldviewHumanityPanel, { project, onOpenHistory: () => undefined })
    : createElement(GeographyPanel, { project })
  return act(async () => root.render(createElement(ToastProvider, null, panel)))
}
async function group(id: number) {
  await act(async () => useWorldGroupStore.getState().setActiveGroup(id))
}

beforeEach(async () => {
  resetPendingEditCoordinatorForTestsV1()
  await db.delete(); await db.open()
  useWorldviewStore.setState({ worldview: null, loadedScope: null, loading: false, loadError: null })
  useGeographyStore.setState({ geography: null, loading: false, activeWorldGroupId: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network request') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  await flushPendingEditsV1().catch(() => undefined)
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); db.close()
})

describe('SFQA-122 · actual world editors', () => {
  for (const variant of ['natural', 'humanity'] as const) {
    it(`${variant}: A → empty B → A agrees with fresh mount and never copies Canon`, async () => {
      const made = await fixture()
      const text = variant === 'natural' ? 'A世界结构' : 'A种族'
      await render(variant, made.project)
      if (variant === 'humanity') await click('种族与民族')
      await settle(() => visible(text))
      await group(made.b)
      await settle(() => !useWorldviewStore.getState().loading && useWorldviewStore.getState().activeWorldGroupId === made.b)
      expect(visible(text)).toBe(false)
      expect(await db.worldviews.count()).toBe(1)
      await act(async () => root.render(null))
      await render(variant, made.project)
      await settle(() => !useWorldviewStore.getState().loading)
      expect(visible(text)).toBe(false)
      await group(made.a)
      if (variant === 'humanity') await click('种族与民族')
      await settle(() => visible(text))
    })

    it(`${variant}: a direct owner change flushes an unblurred InlineDraft to its original group`, async () => {
      const made = await fixture()
      const text = variant === 'natural' ? 'A世界结构' : 'A种族'
      await render(variant, made.project)
      if (variant === 'humanity') await click('种族与民族')
      await settle(() => visible(text))
      const display = [...host.querySelectorAll<HTMLElement>('div.cursor-text')].find(node => node.textContent === text)!
      await act(async () => display.click())
      await input(host.querySelector('textarea')!, '作者未失焦的新输入')
      await group(made.b)
      await settle(() => !useWorldviewStore.getState().loading && useWorldviewStore.getState().activeWorldGroupId === made.b)
      const row = await db.worldviews.filter(row => row.worldGroupId === made.a).first()
      expect(row?.[variant === 'natural' ? 'worldStructure' : 'races']).toBe('作者未失焦的新输入')
      expect(visible('作者未失焦的新输入')).toBe(false)
      expect(await db.worldviews.filter(row => row.worldGroupId === made.b).count()).toBe(0)
    })

    it(`${variant}: failed saves keep the original InlineDraft mounted and retryable`, async () => {
      const made = await fixture()
      const text = variant === 'natural' ? 'A世界结构' : 'A种族'
      await render(variant, made.project)
      if (variant === 'humanity') await click('种族与民族')
      await settle(() => visible(text))
      await act(async () => [...host.querySelectorAll<HTMLElement>('div.cursor-text')].find(node => node.textContent === text)!.click())
      await input(host.querySelector('textarea')!, '不能丢的输入')
      const save = useWorldviewStore.getState().saveWorldview
      // Editing captured the original callback; inject failure at its actual domain write.
      const adopted = vi.spyOn(db.worldviews, 'update').mockRejectedValue(new Error('测试写入失败'))
      await group(made.b)
      await settle(() => host.textContent?.includes('尚未切换') === true)
      expect(host.querySelector('textarea')?.value).toBe('不能丢的输入')
      expect(await db.worldviews.count()).toBe(1)
      adopted.mockRestore()
      expect(useWorldviewStore.getState().saveWorldview).toBe(save)
      await click('重试保存并切换')
      await settle(() => useWorldviewStore.getState().activeWorldGroupId === made.b && !useWorldviewStore.getState().loading)
      expect((await db.worldviews.toArray())[0][variant === 'natural' ? 'worldStructure' : 'races']).toBe('不能丢的输入')
      expect(visible('不能丢的输入')).toBe(false)
    })
  }

  it('Geography Add and overview blur in empty B preserve A byte for byte', async () => {
    const made = await fixture()
    const before = await db.geographies.toArray()
    await render('geography', made.project)
    await settle(() => host.querySelector('textarea')?.value === 'A地理总述')
    await group(made.b)
    await settle(() => !useGeographyStore.getState().loading && useGeographyStore.getState().activeWorldGroupId === made.b)
    expect(host.querySelector('textarea')!.value).toBe('')
    await click('添加地点')
    await settle(() => useGeographyStore.getState().geography?.worldGroupId === made.b)
    const b = (await db.geographies.filter(row => row.worldGroupId === made.b).first())!
    const locations = JSON.parse(b.locations) as Location[]
    expect(locations).toHaveLength(1)
    expect(locations[0].id).not.toBe(oldLocation.id)
    const overview = host.querySelector('textarea')!
    await input(overview, 'B新总述')
    await act(async () => overview.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    await act(async () => { await flushPendingEditsV1() })
    expect((await db.geographies.get(b.id!))?.overview).toBe('B新总述')
    expect(await db.geographies.get(before[0].id!)).toEqual(before[0])
  })

  it('Geography direct World/Work prop changes save an unblurred overview to the original owner', async () => {
    const made = await fixture()
    const world = await addCurrentWorldFixtureV1({ projectId: made.scope.projectId, name: '同壳另一World' })
    const work = await addCurrentWorkFixtureV1({ projectId: made.scope.projectId, worldId: world.id!, create: { title: '另一Work', kind: 'novel', novelProfile: 'long' } })
    const nextProject = { ...made.project, activeWorldId: world.id!, activeWorkId: work.id!, enableMultiWorld: false }
    await render('geography', made.project)
    await settle(() => host.querySelector('textarea')?.value === 'A地理总述')
    await input(host.querySelector('textarea')!, '原World未失焦输入')
    // Workspace preloads may move the shared store before this panel receives its new props.
    await act(async () => useGeographyStore.getState().loadAll({ projectId: made.scope.projectId, worldId: world.id!, workId: work.id! }))
    await render('geography', nextProject)
    await settle(() => useGeographyStore.getState().loadedScope?.worldId === world.id && !useGeographyStore.getState().loading)
    expect(host.querySelector('textarea')?.value).toBe('')
    expect((await db.geographies.toArray())[0].overview).toBe('原World未失焦输入')
    await click('添加地点')
    await act(async () => { await flushPendingEditsV1() })
    const rows = await db.geographies.toArray()
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.id !== rows[0].id)?.locations).not.toContain('only-A')
  })

  it('Geography retains a failed overview save and retries before switching groups', async () => {
    const made = await fixture()
    await render('geography', made.project)
    await settle(() => host.querySelector('textarea')?.value === 'A地理总述')
    await input(host.querySelector('textarea')!, '失败仍保留的总述')
    const failing = vi.spyOn(db.geographies, 'update').mockRejectedValue(new Error('磁盘配额测试'))
    await group(made.b)
    await settle(() => host.textContent?.includes('尚未切换') === true)
    expect(host.querySelector('textarea')?.value).toBe('失败仍保留的总述')
    expect((await db.geographies.toArray())[0].overview).toBe('A地理总述')
    failing.mockRestore()
    await click('重试保存并切换')
    await settle(() => useGeographyStore.getState().activeWorldGroupId === made.b && !useGeographyStore.getState().loading)
    expect((await db.geographies.toArray())[0].overview).toBe('失败仍保留的总述')
    expect(host.querySelector('textarea')?.value).toBe('')
  })

  it('Geography corrupt JSON blocks Add without washing the original bytes into []', async () => {
    const made = await fixture()
    const before = (await db.geographies.toArray())[0]
    await db.geographies.update(before.id!, { locations: '{broken' })
    await render('geography', made.project)
    await settle(() => host.textContent?.includes('地理内容无法读取') === true)
    const protection = host.querySelector<HTMLFieldSetElement>('[aria-label="地理读取保护"]')!
    expect(protection.disabled).toBe(true)
    expect((await db.geographies.get(before.id!))?.locations).toBe('{broken')
    await db.geographies.update(before.id!, { locations: '[]', overview: '' })
    await click('重新读取地理')
    await settle(() => !protection.disabled)
    await click('添加地点')
    await act(async () => { await flushPendingEditsV1() })
    expect(JSON.parse((await db.geographies.get(before.id!))!.locations)).toHaveLength(1)
  })

  it('a late concept map from A cannot appear in B and derived prompts reset with the owner', async () => {
    const made = await fixture()
    let complete!: (value: string) => void
    ai.start.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    await render('geography', made.project)
    await settle(() => host.querySelector('textarea')?.value === 'A地理总述')
    await click('AI地图')
    await click('生成图像 Prompt')
    expect(host.textContent).toContain('A港口')
    await click('生成 AI 概念地图')
    await group(made.b)
    await settle(() => useGeographyStore.getState().activeWorldGroupId === made.b && !useGeographyStore.getState().loading)
    await act(async () => complete('<svg><text>仅属于A的地图</text></svg>'))
    expect(host.textContent).not.toContain('仅属于A的地图')
    expect(host.textContent).not.toContain('A港口')
  })
})
