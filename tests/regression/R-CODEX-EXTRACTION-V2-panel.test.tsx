import { installEvalWebLocksFixtureV1 } from '../helpers/eval-web-locks'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIConfig, CodexCategory, Project, WorkspaceScope } from '../../src/lib/types'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as checkpoint from '../../src/lib/agent/run/checkpoint'
import { adoptCodexExtractionCandidateV2, generateCodexExtractionCandidateV2, readCodexExtractionStateV2 } from '../../src/lib/agent/run/codex-extraction-v2-runtime'
import { generateCodexExtractionCandidateV1 } from '../../src/lib/agent/run/codex-extraction-durable'

// Only layout stores/dialogs are replaced. Pending/recovery readers, the V2
// runtime, exact store, author drafts and adoption use the actual isolated DB.
const mocks = vi.hoisted(() => ({ categories: [] as CodexCategory[], loadedScope: null as WorkspaceScope | null,
  activeGroupId: null as number | null, groups: [] as Array<{ id?: number; projectId: number; worldId?: number; name: string }>,
  loadAll: vi.fn(async () => undefined), noop: vi.fn(), confirm: vi.fn(async () => true),
  error: vi.fn(), success: vi.fn(), info: vi.fn() }))
vi.mock('../../src/stores/codex', () => ({ useCodexStore: () => ({ categories: mocks.categories, entries: [], loadedScope: mocks.loadedScope,
  loading: false, loadError: null, loadAll: mocks.loadAll, addCategory: mocks.noop, deleteCategory: mocks.noop,
  setCategoryHidden: mocks.noop, updateCategory: mocks.noop, addEntry: mocks.noop, updateEntry: mocks.noop, deleteEntry: mocks.noop }) }))
vi.mock('../../src/stores/world-group', () => ({ useWorldGroupStore: (select: (state: unknown) => unknown) => select({ activeGroupId: mocks.activeGroupId, groups: mocks.groups }) }))
vi.mock('../../src/components/shared/Toast', () => ({ useToast: () => ({ error: mocks.error, success: mocks.success, info: mocks.info }) }))
vi.mock('../../src/components/shared/Dialog', () => ({ useDialog: () => ({ prompt: mocks.noop, confirm: mocks.confirm }) }))
vi.mock('../../src/components/codex/CodexCategoryFieldsEditor', () => ({ default: () => null }))
vi.mock('../../src/components/codex/CodexEntryDetail', () => ({ default: () => null }))
import CodexPanel from '../../src/components/codex/CodexPanel'
import * as workspaceScope from '../../src/lib/workspace/scope'
import * as rootContracts from '../../src/lib/agent/run/codex-extraction-v2-contract'
import { addCurrentWorkFixtureV1 } from '../helpers/current-workspace'

const reactActGlobal: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true
const config: AIConfig = { provider: 'custom', model: 'panel-synthetic', apiKey: 'synthetic-panel-key', baseUrl: 'https://panel.invalid/v1', temperature: 0, maxTokens: 4000 }
const sourceText = ' \r\n月栖花生于湿地。😀\r\n' + '尾部仍是原文。'.repeat(3000) + '终点\n '
const modelEntry = { name: '月栖花', icon: '🌱', summary: '逐字词条', description: '生于湿地。', fields: {}, tags: [],
  importance: 2, evidenceQuotes: ['月栖花'], provenance: 'verbatim-extraction' }
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
const button = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(text))
function input(host: HTMLElement, label: string) { return host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement }
async function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function fixture() {
  const { scope } = await seedCurrentWorkspace('B01 actual panel fixture')
  const now = Date.now(), categoryId = await db.codexCategories.add(stampNewRecord<CodexCategory>(scope, 'codexCategories', { projectId: scope.projectId,
    domain: 'natural', parentId: null, name: '灵植', icon: '🌱', builtInKey: 'herb', fieldSchema: '[]', hidden: false,
    order: 0, createdAt: now, updatedAt: now }, { owner: 'world' }))
  await stampCurrentFixtureResourceUidsV1(scope.projectId)
  mocks.categories = [(await db.codexCategories.get(categoryId))!]; mocks.loadedScope = scope
  const project = (await db.projects.get(scope.projectId))!
  return { scope, project, aiConfig: config, request: { categoryId, worldGroupId: null, sourceText, supplementTags: false } }
}
async function mount(project: Project, experimentalExtractionV2?: boolean) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(createElement(CodexPanel, { project, ...(experimentalExtractionV2 === undefined ? {} : { experimentalExtractionV2 }), fixedDomain: 'natural',
    fixedCategoryKeys: ['herb'], embedded: true, extractionSourceText: sourceText })))
  await act(async () => button(host, 'AI 从内容拆分词条')!.click())
  return { host, root }
}
function transport() {
  const posts: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') throw new Error('unexpected network')
    posts.push(String(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([modelEntry]) }, finish_reason: 'stop' }] }),
      { headers: { 'Content-Type': 'application/json' } })
  }))
  return posts
}
let restoreWebLocks: (() => void) | undefined
beforeEach(async () => { restoreWebLocks = installEvalWebLocksFixtureV1();
  await db.delete(); await db.open(); resetModelCapacityForTestsV1()
  mocks.activeGroupId = null; mocks.groups = []
  useAIConfigStore.setState({ config, presets: [], taskRoutes: {} })
  vi.stubGlobal('location', { hostname: 'localhost', search: '' })
})
afterEach(async () => { restoreWebLocks?.(); restoreWebLocks = undefined;
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); db.close()
})

describe.sequential('B01 C03/C13/C16/C17/C19/C23 · actual pending/recovery UI', () => {

  it.each(['missing-work', 'wrong-world', 'stale-loaded-scope'] as const)('retains edited input and creates no Run/POST for %s', async kind => {
    const f = await fixture(), posts = transport(), { host, root } = await mount(f.project)
    await vi.waitFor(() => expect(button(host, '开始拆分')?.disabled).toBe(false))
    const textarea = host.querySelector('textarea[placeholder="粘贴或编辑要拆分的整段设定内容"]') as HTMLTextAreaElement
    await setValue(textarea, '作者输入不能丢失')
    // Deliberately malformed runtime input exercises the admission boundary;
    // undefined is neither a valid Project value nor a fabricated Work ID.
    const next: Project = kind === 'missing-work'
      ? { ...f.project, activeWorkId: undefined } as unknown as Project
      : { ...f.project, ...(kind === 'wrong-world' ? { activeWorldId: f.scope.worldId + 100 } : {}) }
    if (kind === 'missing-work') {
      expect(Object.prototype.hasOwnProperty.call(next, 'activeWorkId')).toBe(true)
      expect(next.activeWorkId).toBeUndefined()
    }
    if (kind === 'stale-loaded-scope') mocks.loadedScope = { ...f.scope, workId: f.scope.workId + 100 }
    await act(async () => root.render(createElement(CodexPanel, { project: next, fixedDomain: 'natural', fixedCategoryKeys: ['herb'], embedded: true, extractionSourceText: sourceText })))
    await act(async () => button(host, '开始拆分')?.click())
    expect(textarea.value).toBe('作者输入不能丢失')
    expect(await db.agentRuns.count()).toBe(0); expect(await db.codexEntries.count()).toBe(0); expect(posts).toEqual([])
  })

  it('rejects a real sameWorld Work switch during awaited admission, then admits the newly loaded Work explicitly', async () => {
    const f = await fixture(), posts = transport(), { host, root } = await mount(f.project)
    await vi.waitFor(() => expect(button(host, '开始拆分')?.disabled).toBe(false))
    const textarea = host.querySelector('textarea[placeholder="粘贴或编辑要拆分的整段设定内容"]') as HTMLTextAreaElement
    await setValue(textarea, sourceText)
    const original = workspaceScope.resolveScopeLike
    let release!: () => void, entered = false, armed = true
    const hold = new Promise<void>(resolve => { release = resolve })
    const spy = vi.spyOn(workspaceScope, 'resolveScopeLike').mockImplementation(async value => {
      const actual = await original(value)
      if (armed) { armed = false; entered = true; await hold }
      return actual
    })
    await act(async () => button(host, '开始拆分')!.click())
    await vi.waitFor(() => expect(entered).toBe(true))
    const work = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, create: { kind: 'novel', novelProfile: 'long', title: '同世界新作品' } })
    await db.projects.update(f.scope.projectId, { activeWorkId: work.id })
    expect(work.id).toBeGreaterThan(0)
    const next = { ...f.project, activeWorkId: work.id! }
    mocks.loadedScope = { ...f.scope, workId: work.id! }
    await act(async () => root.render(createElement(CodexPanel, { project: next, fixedDomain: 'natural', fixedCategoryKeys: ['herb'], embedded: true, extractionSourceText: sourceText })))
    await act(async () => { release(); await hold })
    // Switching invalidates the old authorization. Only explicit re-admission
    // below may enable a new start; the original positive candidate assertion stays.
    await vi.waitFor(() => expect(button(host, '开始拆分')?.disabled).toBe(true))
    expect(textarea.value).toBe(sourceText); expect(await db.agentRuns.count()).toBe(0); expect(posts).toEqual([])
    spy.mockRestore()
    // Opening again is a new explicit admission; no Work was borrowed during the old await.
    await act(async () => button(host, 'AI 从内容拆分词条')!.click())
    await vi.waitFor(() => expect(button(host, '开始拆分')?.disabled).toBe(false))
    await act(async () => button(host, '开始拆分')!.click())
    await vi.waitFor(() => expect(input(host, '候选1名称')?.value, host.textContent ?? '').toBe('月栖花'))
    expect(posts).toHaveLength(1)
    expect((await db.agentRuns.toArray())[0].workId).toBe(work.id)
  })

  it('keeps author input and dispatches zero Runs/POST when the browser cannot claim cross-page execution', async () => {
    const f = await fixture(), posts = transport(), { host } = await mount(f.project)
    await vi.waitFor(() => expect(button(host, '开始拆分')?.disabled).toBe(false))
    const textarea = host.querySelector('textarea[placeholder="粘贴或编辑要拆分的整段设定内容"]') as HTMLTextAreaElement
    await setValue(textarea, '作者输入不因平台能力缺失而丢失')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    await act(async () => button(host, '开始拆分')!.click())
    await vi.waitFor(() => expect(host.textContent).toContain('跨页面执行占用'))
    expect(textarea.value).toBe('作者输入不因平台能力缺失而丢失')
    expect(await db.agentRuns.count()).toBe(0); expect(await db.codexEntries.count()).toBe(0); expect(posts).toEqual([])
  })

  it('cancels an awaiting explicit reopen without reusing the old admission or reopening after close', async () => {
    const f = await fixture(), posts = transport(), { host } = await mount(f.project)
    await vi.waitFor(() => expect(button(host, '开始拆分')?.disabled).toBe(false))
    const textarea = host.querySelector('textarea[placeholder="粘贴或编辑要拆分的整段设定内容"]') as HTMLTextAreaElement
    await setValue(textarea, '关闭核验仍保留原输入')
    const original = workspaceScope.resolveScopeLike
    let release!: () => void, entered = false
    const hold = new Promise<void>(resolve => { release = resolve })
    const spy = vi.spyOn(workspaceScope, 'resolveScopeLike').mockImplementation(async value => {
      const scope = await original(value); entered = true; await hold; return scope
    })
    await act(async () => button(host, 'AI 从内容拆分词条')!.click())
    await vi.waitFor(() => expect(entered).toBe(true))
    expect(button(host, '开始拆分')?.disabled).toBe(true)
    expect(textarea.value).toBe('关闭核验仍保留原输入')
    await act(async () => button(host, '开始拆分')!.click())
    expect(await db.agentRuns.count()).toBe(0); expect(posts).toEqual([])
    await act(async () => (host.querySelector('button[aria-label="关闭词条提取"]') as HTMLButtonElement).click())
    await act(async () => { release(); await hold })
    spy.mockRestore()
    expect(host.querySelector('textarea[placeholder="粘贴或编辑要拆分的整段设定内容"]')).toBeNull()
    expect(await db.agentRuns.count()).toBe(0); expect(posts).toEqual([])
  })

  it('restores an actual absent-policy frozen V2 Root after ordinary defaults change without rewriting it or POSTing again', async () => {
    const f = await fixture(), posts = transport(), original = rootContracts.createCodexExtractionRootV2
    const legacy = vi.spyOn(rootContracts, 'createCodexExtractionRootV2').mockImplementation(value => original({ ...value, newProductionPolicy: false }))
    const generated = await generateCodexExtractionCandidateV2(f)
    legacy.mockRestore()
    const before = await readCodexExtractionStateV2({ scope: f.scope, runId: generated.snapshot.run.id })
    expect(before.materials.root).not.toHaveProperty('productionPolicy')
    const saved = await db.agentRuns.get(generated.snapshot.run.id)
    const { host } = await mount(f.project)
    await vi.waitFor(() => expect(input(host, '候选1名称')?.value).toBe('月栖花'))
    const after = await readCodexExtractionStateV2({ scope: f.scope, runId: generated.snapshot.run.id })
    expect(after.materials.root).toEqual(before.materials.root)
    expect(after.candidate).toEqual(before.candidate)
    expect(await db.agentRuns.get(generated.snapshot.run.id)).toEqual(saved)
    expect(posts).toHaveLength(1)
  })

  it('reads an actual V2 pending candidate while the new-start flag remains off', async () => {
    const f = await fixture(), posts = transport(), generated = await generateCodexExtractionCandidateV2(f)
    const { host } = await mount(f.project)
    await vi.waitFor(() => expect(input(host, '候选1名称')?.value).toBe('月栖花'))
    expect(host.textContent).toContain('AI 原文提取')
    expect((host.querySelector('textarea[placeholder="粘贴或编辑要拆分的整段设定内容"]') as HTMLTextAreaElement).value).toBe(sourceText)
    expect(button(host, '开始拆分')?.disabled).toBe(true)
    expect((await readCodexExtractionStateV2({ scope: f.scope, runId: generated.snapshot.run.id })).candidate).toEqual(generated.candidate)
    expect(posts).toHaveLength(1); expect(await db.codexEntries.count()).toBe(0)
  })

  it('starts an ordinary no-query no-prop complete long-source V2 request and saves the independent author draft', async () => {
    const f = await fixture(), posts = transport(), { host } = await mount(f.project)
    await vi.waitFor(() => expect(button(host, '开始拆分')?.disabled).toBe(false))
    await act(async () => button(host, '开始拆分')!.click())
    await vi.waitFor(() => expect(input(host, '候选1名称')?.value).toBe('月栖花'))
    expect(posts).toHaveLength(1); expect(JSON.parse(posts[0]).messages.some((row: { content: string }) => row.content.includes(sourceText))).toBe(true)
    await setValue(input(host, '候选1名称'), '作者命名')
    expect(host.textContent).toContain('作者稿尚未保存')
    await act(async () => button(host, '保存作者稿')!.click())
    await vi.waitFor(() => expect(host.textContent).not.toContain('作者稿尚未保存'))
    const row = (await db.agentRuns.toArray())[0], read = await readCodexExtractionStateV2({ scope: f.scope, runId: row.id! })
    expect(read.candidate?.entries[0].name).toBe('月栖花')
    expect(read.draft?.entries[0].name).toBe('作者命名'); expect(read.draft?.editPaths).toContain('entries.0.name')
    expect(await db.codexEntries.count()).toBe(0)
  })

  it('offers local continuation for actual saved complete HTTP raw with the start flag off and does not POST twice', async () => {
    const f = await fixture(), posts = transport(), original = artifacts.recordAgentRunArtifactV1
    const spy = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async value => {
      if (JSON.parse(value.content).version === 'codex-call-usage-v2') throw Error('usage save failed')
      return original(value)
    })
    await expect(generateCodexExtractionCandidateV2(f)).rejects.toThrow(); spy.mockRestore()
    const { host } = await mount(f.project)
    await vi.waitFor(() => expect(button(host, '核对原请求并继续')).toBeTruthy())
    await act(async () => button(host, '核对原请求并继续')!.click())
    await vi.waitFor(() => expect(input(host, '候选1名称')?.value).toBe('月栖花'))
    expect(posts).toHaveLength(1)
  })

  it('freezes editing once the exact intent artifact committed even if its following checkpoint failed', async () => {
    const f = await fixture(); transport()
    const generated = await generateCodexExtractionCandidateV2(f)
    const spy = vi.spyOn(checkpoint, 'createAgentRunCheckpointV1').mockRejectedValue(new Error('intent checkpoint failed'))
    await expect(adoptCodexExtractionCandidateV2({ scope: f.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] })).rejects.toThrow()
    spy.mockRestore()
    const { host } = await mount(f.project)
    await vi.waitFor(() => expect(input(host, '候选1名称')?.disabled).toBe(true))
    expect(button(host, '继续写入与终验')).toBeTruthy()
    expect(button(host, '否决并关闭')).toBeUndefined(); expect(await db.codexEntries.count()).toBe(0)
  })

  it('preserves original Run ownership after an active-Work switch and refuses adopt into the new pointer', async () => {
    const f = await fixture(); transport()
    const generated = await generateCodexExtractionCandidateV2(f), { host, root } = await mount(f.project)
    await vi.waitFor(() => expect(input(host, '候选1名称')).toBeTruthy())
    await act(async () => root.render(createElement(CodexPanel, { project: { ...f.project, activeWorkId: f.scope.workId + 100 },
      fixedDomain: 'natural', fixedCategoryKeys: ['herb'], embedded: true, extractionSourceText: sourceText })))
    await act(async () => button(host, '写入所选')!.click())
    expect(host.textContent).toContain('原作品')
    expect(await db.codexEntries.count()).toBe(0)
    expect((await db.agentRuns.get(generated.snapshot.run.id))!.workId).toBe(f.scope.workId)
  })

  it.each([1, 2])('keeps a real V%s history readable with new starts off beside a newer partial other-category Run', async version => {
    const f = await fixture(), posts = transport()
    if (version === 1) await generateCodexExtractionCandidateV1({ scope: f.scope,
      request: { ...f.request, sourceText: '月栖花生于湿地。' }, runAI: async () => JSON.stringify([modelEntry]) })
    else await generateCodexExtractionCandidateV2(f)
    const currentCategory = (await db.codexCategories.get(f.request.categoryId))!
    const now = Date.now()
    const otherCategoryId = await db.codexCategories.add(stampNewRecord<CodexCategory>(f.scope, 'codexCategories', {
      projectId: f.scope.projectId, domain: currentCategory.domain, parentId: currentCategory.parentId,
      name: '另一目标', icon: currentCategory.icon, builtInKey: 'mineral', fieldSchema: currentCategory.fieldSchema,
      hidden: currentCategory.hidden, order: currentCategory.order, createdAt: now, updatedAt: now,
    }, { owner: 'world' }))
    await stampCurrentFixtureResourceUidsV1(f.scope.projectId)
    const original = artifacts.recordAgentRunArtifactV1
    const save = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async value => {
      if (JSON.parse(value.content).version === 'codex-extraction-plan-v2') throw new Error('partial other target plan')
      return original(value)
    })
    await expect(generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, categoryId: otherCategoryId } })).rejects.toThrow()
    save.mockRestore()
    const runsAfterFailure = await db.agentRuns.toArray()
    const badId = runsAfterFailure[runsAfterFailure.length - 1]!.id!
    const before = { runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray() }
    const { host } = await mount(f.project)
    await vi.waitFor(() => expect(button(host, '写入所选 1 项')).toBeTruthy())
    const blocked = host.querySelector('aside[aria-label="原提取运行只读阻塞记录"]')!
    expect(blocked.textContent).toContain(`运行 ${badId}`); expect(blocked.textContent).toContain(`分类 ${otherCategoryId}`)
    expect(blocked.querySelectorAll('button')).toHaveLength(0)
    expect(host.textContent).toContain('月栖花')
    if (version === 2) expect(input(host, '候选1名称').value).toBe('月栖花')
    else expect(input(host, '候选1名称')).toBeNull()
    expect(posts).toHaveLength(version === 2 ? 1 : 0)
    expect({ runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray() }).toEqual(before)
  })

  it.each(['unknown-target', 'corrupt-same-target'] as const)('shows %s as an independent readonly block and cannot replace it with a new POST', async kind => {
    const f = await fixture(), posts = transport()
    if (kind === 'unknown-target') {
      const original = artifacts.recordAgentRunArtifactV1
      const save = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async value => {
        if (JSON.parse(value.content).version === 'codex-extraction-root-v2') throw new Error('root did not commit')
        return original(value)
      })
      await expect(generateCodexExtractionCandidateV2(f)).rejects.toThrow(); save.mockRestore()
    } else {
      const generated = await generateCodexExtractionCandidateV2(f)
      const read = await readCodexExtractionStateV2({ scope: f.scope, runId: generated.snapshot.run.id })
      const stored = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.scope.projectId, 'tool-result', read.planRef.contentHash]).first()
      await db.agentRunArtifacts.update(stored!.id!, { content: 'corrupt exact plan' })
    }
    const before = { runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray() }
    const { host } = await mount(f.project)
    await vi.waitFor(() => expect(host.textContent).toContain('原运行只读阻塞记录'))
    expect(button(host, '开始拆分')?.disabled).toBe(true)
    expect(button(host, '核对原请求并继续')).toBeUndefined()
    expect(button(host, '放弃旧运行')).toBeUndefined()
    expect(host.querySelector('aside')?.querySelectorAll('button')).toHaveLength(0)
    await act(async () => button(host, '开始拆分')!.click())
    expect(posts).toHaveLength(kind === 'unknown-target' ? 0 : 1)
    expect({ runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray() }).toEqual(before)
  })

  it.each([
    { current: 'null', blocked: 'first' }, { current: 'first', blocked: 'null' }, { current: 'first', blocked: 'second' },
  ])('keeps same-category history readable across the group-only $current/$blocked axis with starts off', async axis => {
    const f = await fixture(), now = Date.now()
    const first = await db.worldGroups.add({ projectId: f.scope.projectId, worldId: f.scope.worldId, name: '第一分组',
      description: '', type: 'primary', icon: '🌙', order: 1, createdAt: now, updatedAt: now })
    const second = await db.worldGroups.add({ projectId: f.scope.projectId, worldId: f.scope.worldId, name: '第二分组',
      description: '', type: 'primary', icon: '🌊', order: 2, createdAt: now, updatedAt: now })
    const currentGroup = axis.current === 'null' ? null : first
    const blockedGroup = axis.blocked === 'null' ? null : axis.blocked === 'first' ? first : second
    const project = { ...f.project, enableMultiWorld: currentGroup !== null }
    await db.projects.update(f.scope.projectId, { enableMultiWorld: project.enableMultiWorld })
    mocks.groups = [(await db.worldGroups.get(first))!, (await db.worldGroups.get(second))!]; mocks.activeGroupId = currentGroup
    await stampCurrentFixtureResourceUidsV1(f.scope.projectId)
    const posts = transport()
    await generateCodexExtractionCandidateV2({ ...f, request: { ...f.request, worldGroupId: currentGroup } })
    const original = artifacts.recordAgentRunArtifactV1
    const save = vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async value => {
      if (JSON.parse(value.content).version === 'codex-extraction-plan-v2') throw new Error('other group partial plan')
      return original(value)
    })
    const badInput = { ...f, request: { ...f.request, worldGroupId: blockedGroup } }
    await expect(generateCodexExtractionCandidateV2(badInput)).rejects.toThrow(); save.mockRestore()
    const before = { runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray() }
    const { host } = await mount(project)
    await vi.waitFor(() => expect(input(host, '候选1名称')?.value).toBe('月栖花'))
    const diagnostic = host.querySelector('aside[aria-label="原提取运行只读阻塞记录"]')!
    expect(diagnostic.textContent).toContain(`分类 ${f.request.categoryId} / 分组 ${blockedGroup ?? '默认'}`)
    expect(diagnostic.textContent).not.toContain('本分类或目标未核验的原运行尚未解决')
    expect(button(host, '写入所选 1 项')).toBeTruthy(); expect(posts).toHaveLength(1)
    await expect(generateCodexExtractionCandidateV2(badInput)).rejects.toThrow('不重新发送')
    expect(posts).toHaveLength(1)
    expect({ runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(), artifacts: await db.agentRunArtifacts.toArray() }).toEqual(before)
  })
})
