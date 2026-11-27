import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInspirationPromptConfig } from '../../src/hooks/useInspirationPromptConfig'
import { useIncrementalInspiration } from '../../src/hooks/useIncrementalInspiration'
import PromptRunPanel from '../../src/components/shared/PromptRunPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { freezePromptExecutionOptionsV1, renderFrozenPromptExecutionV1 } from '../../src/lib/agent/prompt-execution'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { parseInspirationPromptConfigV1, type InspirationPromptConfigModuleV1 } from '../../src/lib/inspiration/prompt-config'
import type { Project } from '../../src/lib/types'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import { usePromptStore } from '../../src/stores/prompt'
import { useInspirationWorkspaceStore as workspaces } from '../../src/stores/inspiration-workspace'

const transport = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => ({ pendingCandidates: [], busy: false, error: null, stop: () => undefined, submitTargetedRequest: transport.submit }),
}))

let root: Root, host: HTMLDivElement
let controller: ReturnType<typeof useInspirationPromptConfig>
let fusion: ReturnType<typeof useIncrementalInspiration>
let renderProject: Project
let renderModule: InspirationPromptConfigModuleV1
function Harness({ project, module }: { project: Project; module: InspirationPromptConfigModuleV1 }) {
  fusion = useIncrementalInspiration(project, () => undefined)
  controller = useInspirationPromptConfig(project, module)
  return <PromptRunPanel moduleKey={module} configuration={controller.configuration}
    parameterValues={controller.parameters} onParamChange={controller.onParamChange}
    systemOverride={controller.system} onSystemOverrideChange={value => controller.editText('system', value)}
    userOverride={controller.user} onUserOverrideChange={value => controller.editText('user', value)} />
}
function template(moduleKey: InspirationPromptConfigModuleV1, name = moduleKey): PromptTemplate {
  return { moduleKey, name, scope: 'system', promptType: 'inspiration', description: '',
    systemPrompt: 'SOURCE {{tone}}', userPromptTemplate: 'IDEA {{inspiration}}', variables: ['inspiration'],
    parameters: [{ key: 'tone', label: '语气', type: 'text', default: 'plain' }],
    modelOverride: { temperature: 0.4 }, isActive: true, createdAt: 1, updatedAt: 1 }
}
async function createProject() {
  const { scope } = await createWorkspace({ name: '059 isolated UI', description: '', genres: [], status: 'drafting', targetWordCount: 1000 }, { kind: 'novel', novelProfile: 'long' })
  return (await db.projects.get(scope.projectId))!
}
async function render(project = renderProject, module = renderModule) {
  renderProject = project; renderModule = module
  await act(async () => root.render(<DialogProvider><ToastProvider><Harness project={project} module={module} /></ToastProvider></DialogProvider>))
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect({ ready: controller.ready, error: controller.error }).toEqual({ ready: true, error: '' })
  })
}
async function flush() { await act(async () => { await flushPendingEditsV1(); await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function row(project = renderProject) { return db.inspirationWorkspaces.where('projectId').equals(project.id!).filter(r => r.workId === project.activeWorkId).first() }
async function choice(project = renderProject) { return parseInspirationPromptConfigV1((await row(project))?.promptConfig)?.modes[renderModule] }
async function select(template: PromptTemplate) { await act(async () => { await controller.configuration.onSelect(template) }); await flush() }
const draftKey = (p = renderProject) => `sf-inspiration-draft-v2-${p.id}-${p.activeWorldId}:${p.activeWorkId}`

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external calls in authoring tests') }))
  await db.delete(); await db.open(); localStorage.clear(); resetPendingEditCoordinatorForTestsV1()
  workspaces.setState({ scope: null, workspace: null, fragments: [], versions: [], loading: false })
  usePromptStore.setState({ templates: [], loaded: true })
  await usePromptStore.getState().saveTemplate(template('inspiration.reverse'))
  await usePromptStore.getState().saveTemplate(template('inspiration.reverse.multiworld'))
  transport.submit.mockReset()
  renderProject = await createProject(); renderModule = 'inspiration.reverse'
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render()
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  expect(fetch).not.toHaveBeenCalled()
  resetPendingEditCoordinatorForTestsV1(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await db.delete()
})

describe('059 Work-owned template controls and actual inspiration submission', () => {
  it('follows system upgrades until edited, retains the selected version, and explicitly restores default', async () => {
    let initial!: Awaited<ReturnType<typeof controller.prepareRequest>>
    await act(async () => { initial = await controller.prepareRequest() })
    expect(await choice()).toEqual({ kind: 'follow-default' })
    const current = usePromptStore.getState().getActive('inspiration.reverse')
    await act(async () => { await usePromptStore.getState().saveTemplate({ ...current, systemPrompt: 'UPGRADED {{tone}}' }) })
    let upgraded!: typeof initial
    await act(async () => { upgraded = await controller.prepareRequest() })
    expect(upgraded.selection?.template.systemPrompt).toBe('UPGRADED {{tone}}')
    act(() => controller.onParamChange({ tone: 'author' })); await flush()
    const pinned = await choice(); expect(pinned?.kind).toBe('bound')
    await act(async () => { await usePromptStore.getState().saveTemplate({ ...current, systemPrompt: 'LATER_DEFAULT {{tone}}' }) })
    const frozen = await freezePromptExecutionOptionsV1({ request: await controller.prepareRequest() })
    expect(frozen.parameterValues).toEqual({ tone: 'author' })
    expect(frozen.template.systemPrompt).toBe('UPGRADED {{tone}}')
    await act(async () => { await controller.configuration.onFollowDefault() })
    expect(await choice()).toEqual({ kind: 'follow-default' })
    const reset = await controller.prepareRequest()
    expect(reset.selection?.template.systemPrompt).toBe('LATER_DEFAULT {{tone}}')
    expect(initial.selection?.template.systemPrompt).toBe('SOURCE {{tone}}')
    expect(frozen.template.systemPrompt).toBe('UPGRADED {{tone}}')
  })

  it('retains temporary text across reload and the original draft writer, then passes that exact request to the real generator hook', async () => {
    act(() => { controller.editText('system', 'AUTHOR {{tone}}'); controller.onParamChange({ tone: 'precise' }) })
    await flush()
    act(() => fusion.setAction('full'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)) })
    expect(JSON.parse(localStorage.getItem(draftKey())!).promptDrafts['inspiration.reverse'].system).toBe('AUTHOR {{tone}}')
    await act(async () => root.unmount()); root = createRoot(host); await render()
    expect(controller.system).toBe('AUTHOR {{tone}}'); expect(controller.parameters).toEqual({ tone: 'precise' })
    await act(async () => { await controller.configuration.onTemperatureChange(0.2) })
    act(() => fusion.setInspiration('SAVED_AUTHOR_IDEA'))
    await act(async () => { await fusion.generate(await controller.prepareRequest()) })
    expect(transport.submit).toHaveBeenCalledOnce()
    const request = transport.submit.mock.calls[0][1].promptExecution
    const frozen = await freezePromptExecutionOptionsV1({ request })
    const rendered = await renderFrozenPromptExecutionV1({ options: frozen, context: { inspiration: 'SAVED_AUTHOR_IDEA' }, hardSystem: 'HARD_JSON_RULE', authorInstruction: 'AUTHOR_INTENT' })
    expect(rendered.messages.map(m => m.content).join('\n')).toContain('AUTHOR precise')
    expect(rendered.messages.map(m => m.content).join('\n')).toContain('HARD_JSON_RULE')
    expect(rendered.generationOverrides.temperature).toBe(0.2)
    expect(await db.promptTemplates.count()).toBe(2)
  })

  it('separates single and multiworld selections and another Work, including draft mismatch disposition', async () => {
    act(() => controller.editText('system', 'SINGLE_DRAFT')); await flush()
    const singleChoice = await choice()
    await render(renderProject, 'inspiration.reverse.multiworld')
    expect(controller.system).toBe(null); act(() => controller.onParamChange({ tone: 'multi' })); await flush()
    expect((await choice())?.kind).toBe('bound')
    await render(renderProject, 'inspiration.reverse')
    expect(controller.system).toBe('SINGLE_DRAFT'); expect(await choice()).toEqual(singleChoice)
    const other = { ...template('inspiration.reverse', 'OTHER_VERSION'), scope: 'user' as const, systemPrompt: 'OTHER_SYSTEM', isActive: false }
    const id = await usePromptStore.getState().saveTemplate(other)
    await select(usePromptStore.getState().templates.find(t => t.id === id)!)
    expect(controller.unapplied).toBe(true); expect(controller.ready).toBe(false)
    expect(JSON.parse(localStorage.getItem(draftKey())!).promptDrafts['inspiration.reverse'].system).toBe('SINGLE_DRAFT')
    act(() => controller.reuseDraft()); await flush()
    expect(controller.system).toBe('SINGLE_DRAFT'); expect(controller.unapplied).toBe(false)
    const previous = await row(), oldProject = renderProject, next = await createProject()
    await render(next)
    expect(controller.system).toBe(null); expect(controller.parameters).toEqual({}); expect(await row(oldProject)).toEqual(previous)
    await render(oldProject)
    expect(controller.system).toBe('SINGLE_DRAFT')
  })

  it('saves from a detached snapshot into a fresh inactive template without cloning a reused source id', async () => {
    const source = usePromptStore.getState().getActive('inspiration.reverse')
    await select(source)
    act(() => { controller.editText('system', 'DETACHED_AUTHOR'); controller.onParamChange({ tone: 'saved-default' }) }); await flush()
    await db.promptTemplates.delete(source.id!)
    await db.promptTemplates.add({ ...template('inspiration.reverse.multiworld', 'ID_COLLISION'), id: source.id })
    await act(async () => { await usePromptStore.getState().reload() })
    const contentBefore = (await row())!.updatedAt
    await act(async () => { await controller.configuration.onSaveAs('我的固定版本') })
    const saved = usePromptStore.getState().templates.find(t => t.name === '我的固定版本')!
    expect(saved).toMatchObject({ scope: 'user', moduleKey: 'inspiration.reverse', systemPrompt: 'DETACHED_AUTHOR', isActive: false })
    expect(saved.id).not.toBe(source.id); expect(saved.parentId).toBeUndefined()
    expect(saved.parameters?.[0].default).toBe('saved-default')
    expect(await db.promptTemplates.get(source.id!)).toMatchObject({ name: 'ID_COLLISION', moduleKey: 'inspiration.reverse.multiworld' })
    expect(controller.system).toBe(null)
    expect((await row())!.updatedAt).toBe(contentBefore)
    expect(await choice()).toMatchObject({ kind: 'bound', template: { id: saved.id, name: saved.name } })
  })

  it('preserves malformed canonical config and blocks execution instead of falling back to global templates', async () => {
    await act(async () => { await controller.prepareRequest() })
    const current = (await row())!
    await db.inspirationWorkspaces.update(current.id!, { promptConfig: '{broken' })
    await act(async () => { await controller.configuration.onRetry() })
    await vi.waitFor(async () => { await act(async () => {}); expect(controller.error).toContain('JSON') })
    expect(controller.ready).toBe(false); expect(controller.configuration.template).toBe(null)
    await expect(controller.prepareRequest()).rejects.toThrow()
    expect((await row())!.promptConfig).toBe('{broken')
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('surfaces a CAS conflict and retains the author draft until explicit reread', async () => {
    await act(async () => { await controller.prepareRequest() })
    const current = (await row())!, config = parseInspirationPromptConfigV1(current.promptConfig)!
    const external = JSON.stringify({ ...config, revision: config.revision + 1, updatedAt: config.updatedAt + 1 })
    await db.inspirationWorkspaces.update(current.id!, { promptConfig: external })
    act(() => controller.editText('system', 'DRAFT_SURVIVES_CONFLICT'))
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow(/变化/) })
    expect((await row())!.promptConfig).toBe(external)
    expect(controller.system).toBe('DRAFT_SURVIVES_CONFLICT')
    await act(async () => { await controller.configuration.onRetry() })
    await vi.waitFor(async () => { await act(async () => {}); expect(controller.ready).toBe(true) })
    expect(controller.unapplied).toBe(false)
    expect(controller.system).toBe('DRAFT_SURVIVES_CONFLICT')
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('cancels a save-as callback captured before switching Work without writing a template or another owner', async () => {
    const saveForPreviousOwner = controller.configuration.onSaveAs
    const previousProject = renderProject, next = await createProject()
    const templates = await db.promptTemplates.toArray(), previous = await row(previousProject)
    await render(next)
    await expect(saveForPreviousOwner('MUST_NOT_SAVE')).rejects.toThrow(/读取/)
    expect(await db.promptTemplates.toArray()).toEqual(templates)
    expect(await row(previousProject)).toEqual(previous)
    expect(await row(next)).toBeUndefined()
    expect(transport.submit).not.toHaveBeenCalled()
  })

  it('finishes an already started single-mode save after switching mode without leaving the new mode loading', async () => {
    const original = workspaces.getState().savePromptConfig
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(workspaces.getState(), 'savePromptConfig').mockImplementation(async (...args) => { await gate; return original(...args) })
    act(() => controller.editText('system', 'SINGLE_QUEUED'))
    await act(async () => root.render(<DialogProvider><ToastProvider><Harness project={renderProject} module="inspiration.reverse.multiworld" /></ToastProvider></DialogProvider>))
    expect(controller.ready).toBe(false)
    await act(async () => { release(); await flushPendingEditsV1() })
    await render(renderProject, 'inspiration.reverse.multiworld')
    expect(controller.saving).toBe(false); expect(controller.system).toBe(null)
    const config = parseInspirationPromptConfigV1((await row())!.promptConfig)!
    expect(config.modes['inspiration.reverse']?.kind).toBe('bound')
    expect(config.modes['inspiration.reverse.multiworld']).toBeUndefined()
  })

  it('uses the visible compact panel to select, edit, save a version and restore follow-default', async () => {
    const customId = await usePromptStore.getState().saveTemplate({ ...template('inspiration.reverse', 'UI_CUSTOM'), scope: 'user', isActive: false })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.includes('当前模板：'))!.click() })
    const picker = host.querySelector<HTMLSelectElement>('[aria-label="灵感模板版本"]')!
    await act(async () => { picker.value = String(customId); picker.dispatchEvent(new Event('change', { bubbles: true })); await flushPendingEditsV1() })
    expect(await choice()).toMatchObject({ kind: 'bound', template: { name: 'UI_CUSTOM' } })
    const field = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'UI_SYSTEM_TEXT')
      field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.includes('另存为我的版本'))!.click() })
    const dialog = host.querySelector('[role="dialog"]')!
    expect(dialog).toBeTruthy()
    await act(async () => { [...dialog.querySelectorAll('button')].find(b => b.textContent === '确认')!.click() })
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(controller.configuration.template?.name).toBe('UI_CUSTOM（我的微调）')
    })
    expect(controller.configuration.template?.systemPrompt).toBe('UI_SYSTEM_TEXT')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.includes('恢复跟随默认'))!.click(); await flushPendingEditsV1() })
    await vi.waitFor(async () => { await act(async () => {}); expect(controller.configuration.mode).toBe('follow-default') })
    expect(await choice()).toEqual({ kind: 'follow-default' })
  })
})
