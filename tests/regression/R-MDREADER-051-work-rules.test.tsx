import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProjectInfoPanel from '../../src/components/project/ProjectInfoPanel'
import CreativeRulesPanel from '../../src/components/rules/CreativeRulesPanel'
import { db } from '../../src/lib/db/schema'
import { useProjectStore } from '../../src/stores/project'
import { useCreativeRulesStore } from '../../src/stores/project-singletons'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { resetCandidateDraftCoordinatorForTestsV1 } from '../../src/lib/agent/candidate-draft-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const raw = '# 原始说明\r\n\r\n**事实**：第七年。\r\n\r\n<script>globalThis.workDescriptionBad=1</script>\r\n![外图](https://blocked.invalid/work.png)\r\n  '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1(); resetCandidateDraftCoordinatorForTestsV1()
  useCreativeRulesStore.setState({ creativeRules: null, loadedScope: null, loading: false, loadError: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or external requests') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); resetCandidateDraftCoordinatorForTestsV1(); await db.delete()
})
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    if (predicate()) return
  }
  throw Error('Work description UI did not settle')
}
async function click(label: string, container: HTMLElement = host) {
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === label)!.click())
}
async function input(text: string) {
  const area = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="作品简介"],textarea[placeholder^="描述期望的写作风格"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return area
}
async function fixture(kind: 'work' | 'rules') {
  const { project, scope } = await seedCurrentWorkspace('说明阅读')
  if (kind === 'work') {
    await useProjectStore.getState().updateActiveWork(scope.projectId, { description: raw }, scope)
    await act(async () => root.render(<ProjectInfoPanel project={project} onUpdate={() => undefined} />))
  } else {
    await useCreativeRulesStore.getState().save({ projectId: scope.projectId, writingStyle: raw, atmosphere: '基调原文', specialRequirements: '特殊要求原文' }, scope)
    await act(async () => root.render(<CreativeRulesPanel project={project} />))
  }
  await waitFor(() => host.querySelector('[data-markdown-read-view] h1')?.textContent === '原始说明')
  return { project, scope, read: async () => kind === 'work'
    ? (await db.works.get(scope.workId))!.description
    : (await db.creativeRules.where('projectId').equals(scope.projectId).first())!.writingStyle }
}

it('keeps the original Work form writer, commits one snapshot once, and does not warn when source is only inspected', async () => {
  const f = await fixture('work')
  const view = host.querySelector<HTMLElement>('[data-markdown-read-view]')!
  expect(view.querySelector('script,img,iframe,svg')).toBeNull(); expect(Reflect.get(globalThis, 'workDescriptionBad')).toBeUndefined()
  await click('查看源码'); expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  let writes = 0
  const count = () => { writes++ }; db.works.hook('updating', count)
  try {
    await click('编辑源码')
    const unload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(unload)).toBe(true); expect(unload.defaultPrevented).toBe(false)
    await act(async () => { await flushPendingEditsV1() })
    expect(writes).toBe(0); expect(await f.read()).toBe(raw)
    await click('编辑源码'); await input('# 修订简介\n\n保留完整中文与尾空白🌊。  ')
    await act(async () => { await flushPendingEditsV1() })
    expect(writes).toBe(1)
    expect(await f.read()).toBe('# 修订简介\n\n保留完整中文与尾空白🌊。  ')
    expect(host.querySelector('[data-markdown-read-view] h1')?.textContent).toBe('修订简介')
    expect(Reflect.get((await db.projects.get(f.scope.projectId))!, 'description')).toBeUndefined()
  } finally { db.works.hook('updating').unsubscribe(count) }
})

it('retains Work description on actual form-write failure and uses the same original writer for explicit retry', async () => {
  const f = await fixture('work'); await click('编辑源码'); const area = await input('# 未保存简介\n\n仍是第七年。  ')
  const reject = () => { throw Error('work-info-write-failure') }; db.works.hook('updating', reject)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('work-info-write-failure') }) }
  finally { db.works.hook('updating').unsubscribe(reject) }
  expect(area.isConnected).toBe(true); expect(await f.read()).toBe(raw)
  await click('重试同步作品简介'); await act(async () => { await flushPendingEditsV1() })
  expect(await f.read()).toBe('# 未保存简介\n\n仍是第七年。  ')
  expect(host.querySelector('[data-markdown-read-view] h1')?.textContent).toBe('未保存简介')
})

it('keeps failed creative-rule source editable and preserves the other original fields on retry', async () => {
  const f = await fixture('rules'); const view = host.querySelector<HTMLElement>('[data-markdown-read-view]')!
  await click('查看源码', view); expect(view.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  await click('编辑源码', view); const area = await input('# 修订写作风格\n\n完整原文尾部。  ')
  const reject = () => { throw Error('rules-write-failure') }; db.creativeRules.hook('updating', reject)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('rules-write-failure') }) }
  finally { db.creativeRules.hook('updating').unsubscribe(reject) }
  expect(area.isConnected).toBe(true); expect(await f.read()).toBe(raw)
  await click('重试保存'); await act(async () => { await flushPendingEditsV1() })
  expect(await f.read()).toBe('# 修订写作风格\n\n完整原文尾部。  ')
  const saved = (await db.creativeRules.where('projectId').equals(f.scope.projectId).first())!
  expect(saved.atmosphere).toBe('基调原文'); expect(saved.specialRequirements).toBe('特殊要求原文')
  expect(saved.narrativePOV).toBe('third-limited'); expect(saved.prohibitions).toBe('[]')
})
