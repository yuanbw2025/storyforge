import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceProductionPanel from '../../src/components/avg/VoiceProductionPanel'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { createAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { assertAvgVoiceDraftV1 } from '../../src/lib/avg/voice-draft-contract'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
const config = { provider: 'agnes' as const, baseUrl: 'https://speech.fixture.invalid/v1', apiKey: '',
  model: 'text-fixture-unused', temperature: 0.7, maxTokens: 0 }
const fetcher = vi.fn(() => { throw new Error('Inert editor must not send a request') })
beforeEach(async () => {
  await db.delete(); await db.open(); useAIConfigStore.getState().setConfig(config)
  vi.stubEnv('VITE_STORYFORGE_AVG_VOICE_PRODUCTION', '')
  fetcher.mockClear(); vi.stubGlobal('fetch', fetcher)
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close(); document.body.innerHTML = ''
})

async function setup() {
  const owner = await createAvgDraftV1('逐句配音表单工程验证'), workspace = avgAuthorWorkspaceFixture()
  workspace.presentation.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause',
    maximumVoiceWaitMs: 60_000, autoDelayMs: 800, voices: [] }
  await saveAvgAuthorWorkspaceV1(owner.scope, 0, workspace)
  let view = await readAvgAssemblyWorkspaceV1(owner.scope), lastAction = Promise.resolve()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root)
  const onPending = vi.fn(), onGenerate = vi.fn(async () => {}), onNotice = vi.fn(), errors: string[] = []
  const render = () => root.render(<VoiceProductionPanel scope={owner.scope} view={view} workspace={parseAvgAuthorWorkspaceV1(view.draft.editorJson)}
    disabled={false} canEdit canAdopt={false} sourcesReady={false} declaration="工程观察声明" visible generating={false}
    onPending={onPending} onAction={task => { lastAction = task().catch(error => { errors.push(String(error)) }); return lastAction }}
    onReload={async () => { view = await readAvgAssemblyWorkspaceV1(owner.scope); render() }} onGenerate={onGenerate} onCancel={() => {}} onNotice={onNotice} />)
  await act(async () => render())
  return { host, scope: owner.scope, view: () => view, onPending, onGenerate, onNotice, errors, action: () => lastAction }
}
function control(host: HTMLElement, label: string) {
  const wrapper = Array.from(host.querySelectorAll('label')).find(e => e.textContent?.startsWith(label))
  const element = wrapper?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')
  if (!element) throw new Error(`Missing labelled control: ${label}`)
  return element
}
async function fill(host: HTMLElement, label: string, value: string) {
  const element = control(host, label)
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function click(host: HTMLElement, text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(e => e.textContent === text)
  if (!button) throw new Error(`Missing button: ${text}`)
  await act(async () => button.click())
}
async function proposal(s: Awaited<ReturnType<typeof setup>>) {
  await fill(s.host, 'Agnes 配音模型 ID', 'speech-fixture')
  const line = Array.from(s.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(e => e.closest('label')?.textContent?.includes('第 1 句'))!
  await act(async () => line.click())
  await fill(s.host, '音色 ID', 'voice-a')
  await fill(s.host, '音色使用权说明', '工程声明 e\u0301，不是商业许可证明')
  await fill(s.host, '音色条款或授权依据', '本测试原创协议声明')
}
async function save(s: Awaited<ReturnType<typeof setup>>) {
  await act(async () => { await click(s.host, '保存配音需求草稿'); await s.action() })
}
async function noProduction() {
  expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
  expect(await db.productBuildArtifacts.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
  expect(fetcher).not.toHaveBeenCalled()
}

describe('AVG real Work voice batch editor without provider or start authority', () => {
  it('saves exact selected source lines and explicit rights through the actual draft CAS, without a credential or network request', async () => {
    const s = await setup(); await proposal(s)
    expect(s.onPending).toHaveBeenLastCalledWith(true)
    await save(s); expect(s.errors).toEqual([])
    const actual = parseAvgAuthorWorkspaceV1(s.view().draft.editorJson), parsed = await assertAvgVoiceDraftV1(actual.voiceProduction)
    expect(parsed.voice.batch.requirements).toHaveLength(1)
    const requirement = parsed.voice.batch.requirements[0]!
    expect(requirement.text).toBe(actual.scripts.find(x => x.sceneKey === requirement.sceneKey)!.lines.find(x => x.lineKey === requirement.lineKey)!.text)
    expect(parsed.voice.protocol.model).toBe('speech-fixture')
    expect(parsed.voice.batch.presets[0]!.rights.declaration).toContain('e\u0301')
    expect(s.onPending).toHaveBeenLastCalledWith(false); expect(s.host.textContent).toContain('配音收费生产尚未开放')
    expect(s.onGenerate).not.toHaveBeenCalled(); await noProduction()
  })

  it('does not drop unsupported performance instructions, and retains the pending form and original persisted packet on rejection', async () => {
    const s = await setup(); await proposal(s); await save(s)
    const before = s.view().draft.editorJson
    await fill(s.host, '演法指令', '压低声音，保留准确台词')
    await save(s)
    expect(s.errors.at(-1)).toMatch(/不支持.*演法|不支持.*指令/)
    expect(s.onPending).toHaveBeenLastCalledWith(true)
    expect((await readAvgAssemblyWorkspaceV1(s.scope)).draft.editorJson).toBe(before)
    await noProduction()
  })

  it('discards only unsaved voice form changes and restores the saved packet without changing source words or making calls', async () => {
    const s = await setup(); await proposal(s); await save(s)
    const before = s.view().draft.editorJson
    await fill(s.host, 'Agnes 配音模型 ID', 'unsaved-other-model')
    await act(async () => { await click(s.host, '撤销未保存的配音需求'); await s.action() })
    expect(control(s.host, 'Agnes 配音模型 ID').value).toBe('speech-fixture')
    expect(s.view().draft.editorJson).toBe(before); expect(s.onPending).toHaveBeenLastCalledWith(false)
    expect(s.errors).toEqual([]); await noProduction()
  })

  it('rejects a concurrent saved-source revision and preserves both the actual new source and unsaved form', async () => {
    const s = await setup(); await proposal(s)
    const workspace = parseAvgAuthorWorkspaceV1(s.view().draft.editorJson)
    workspace.systemPlan.title += ' 外部作者修订'
    const changed = await saveAvgAuthorWorkspaceV1(s.scope, s.view().draft.revision, workspace)
    await save(s)
    expect(s.errors.at(-1)).toMatch(/变化/)
    expect(s.onPending).toHaveBeenLastCalledWith(true)
    const actual = await readAvgAssemblyWorkspaceV1(s.scope)
    expect(actual.draft.editorJson).toBe(changed.editorJson)
    expect(parseAvgAuthorWorkspaceV1(actual.draft.editorJson)).not.toHaveProperty('voiceProduction')
    await noProduction()
  })

  it('uses only the selected Agnes route and refuses a text-provider fallback without mutating model settings or the Work', async () => {
    const s = await setup(); await proposal(s)
    useAIConfigStore.getState().setConfig({ ...config, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' })
    const before = s.view().draft.editorJson
    await save(s)
    expect(s.errors.at(-1)).toMatch(/明确选择 Agnes/)
    expect(useAIConfigStore.getState().config.provider).toBe('deepseek')
    expect((await readAvgAssemblyWorkspaceV1(s.scope)).draft.editorJson).toBe(before)
    expect(s.onPending).toHaveBeenLastCalledWith(true); await noProduction()
  })
})
