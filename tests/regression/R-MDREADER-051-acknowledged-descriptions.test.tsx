import { AuthorRecordSaveScopeV1 } from '../../src/components/shared/AuthorRecordSaveScope'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CharacterDimensionFields from '../../src/components/character/CharacterDimensionFields'
import { OutlineChapterRow } from '../../src/components/outline/OutlineChapterTree'
import AcknowledgedTextField from '../../src/components/shared/AcknowledgedTextField'
import { db } from '../../src/lib/db/schema'
import { useCharacterStore } from '../../src/stores/character'
import { useOutlineStore } from '../../src/stores/outline'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const raw = '# 长描述原文\r\n\r\n**事实**：第七年。\r\n\r\n<script>globalThis.descriptionBad=1</script>\r\n![外图](https://blocked.invalid/description.png)\r\n  '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  useCharacterStore.setState({ characters: [], loadedScope: null }); useOutlineStore.setState({ nodes: [], loadedScope: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or external calls') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); await db.delete()
})
async function click(label: string) {
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click())
}
async function input(text: string) {
  const area = host.querySelector<HTMLTextAreaElement>('textarea[data-test-description],textarea[aria-label="背景故事"],textarea[aria-label="章节摘要"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return area
}
async function fixture(kind: 'character' | 'outline') {
  const { scope } = await seedCurrentWorkspace()
  if (kind === 'character') {
    const id = await useCharacterStore.getState().addCharacter({ projectId: scope.projectId, name: '# 字面姓名', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '', background: raw,
      profile: '# 字面年龄资料', motivation: '', abilities: '', relationships: '', arc: '' })
    await useCharacterStore.getState().loadAll(scope)
    const render = async () => { const character = (await db.characters.get(id))!; await act(async () => root.render(<CharacterDimensionFields character={character}
      onChange={(patch, expected) => useCharacterStore.getState().updateCharacter(id, patch, { scope, expected })} />)) }
    await render()
    return { read: async () => (await db.characters.get(id))!.background, table: db.characters,
      render, readName: async () => (await db.characters.get(id))!.name, retry: '重试保存背景故事' }
  }
  const id = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'chapter', title: '# 字面章节名', summary: raw, order: 0 }, scope)
  await useOutlineStore.getState().loadAll(scope)
  const render = async () => { const ch = (await db.outlineNodes.get(id))!; await act(async () => root.render(<OutlineChapterRow ch={ch} idx={0}
    onUpdate={(recordId, patch, options) => useOutlineStore.getState().updateNode(recordId, patch, { scope, expected: options?.expected })}
    onDelete={() => undefined} activeChapterDrag={null} getActiveChapterDrag={() => null} onChapterDragStart={() => undefined} onChapterDragEnd={() => undefined} />)) }
  await render()
  return { read: async () => (await db.outlineNodes.get(id))!.summary, table: db.outlineNodes,
    render, readName: async () => (await db.outlineNodes.get(id))!.title, retry: '重试保存章节摘要' }
}

it.each(['character', 'outline'] as const)('%s preserves exact safe source and keeps background acknowledgement from ending active typing', async kind => {
  const f = await fixture(kind)
  const view = [...host.querySelectorAll('[data-markdown-read-view]')].find(view => view.querySelector('h1')?.textContent === '长描述原文')!
  expect(view.querySelector('script,img,iframe,svg')).toBeNull(); expect(Reflect.get(globalThis, 'descriptionBad')).toBeUndefined()
  await click('查看源码'); expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  expect(await f.read()).toBe(raw)
  await click('编辑源码')
  const area = await input('# 修订长描述\n\n第七年事实保留。  ')
  expect(document.activeElement).toBe(area)
  await act(async () => { await flushPendingEditsV1() })
  expect(await f.read()).toBe('# 修订长描述\n\n第七年事实保留。  ')
  expect(area.isConnected).toBe(true)
  await act(async () => area.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(host.querySelector('[data-markdown-read-view] h1')?.textContent).toBe('修订长描述')
  expect(await f.readName()).toBe(kind === 'character' ? '# 字面姓名' : '# 字面章节名')
  await act(async () => root.unmount()); root = createRoot(host); await f.render()
  expect(host.querySelector('[data-markdown-read-view] h1')?.textContent).toBe('修订长描述')
})

it.each(['character', 'outline'] as const)('%s keeps failed text and its original expected value until an explicit owner-write retry succeeds', async kind => {
  const f = await fixture(kind); await click('编辑源码'); const area = await input('# 未保存长描述\n\n中文🌊  ')
  const reject = () => { throw Error('description-write-failure') }; f.table.hook('updating', reject)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('description-write-failure') }) }
  finally { f.table.hook('updating').unsubscribe(reject) }
  expect(area.isConnected).toBe(true); expect(area.value).toBe('# 未保存长描述\n\n中文🌊  '); expect(await f.read()).toBe(raw)
  await click(f.retry)
  await act(async () => { await flushPendingEditsV1() })
  expect(await f.read()).toBe('# 未保存长描述\n\n中文🌊  ')
  expect(host.querySelector('[data-markdown-read-view] h1')?.textContent).toBe('未保存长描述')
})

it('preserves the original IME barrier through the newly opened character source editor', async () => {
  const f = await fixture('character'); await click('编辑源码')
  const area = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="背景故事"]')!
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await input('# 中文组合尾字🌊')
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('输入法') })
  expect(await f.read()).toBe(raw); expect(area.isConnected).toBe(true)
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => { await flushPendingEditsV1() })
  expect(await f.read()).toBe('# 中文组合尾字🌊')
})

it('keeps single-line and choice controls literal even if Markdown is requested, and leaves malformed values intact', async () => {
  const save = vi.fn()
  await act(async () => root.render(<>
    <AcknowledgedTextField markdownRead input label="名称" value="# 字面名称" onCommit={save} />
    <AcknowledgedTextField markdownRead choices={[{ value: '# 一', label: '# 一' }]} label="枚举" value="# 一" onCommit={save} />
    <AcknowledgedTextField markdownRead label="异常原值" value={{ raw: '# JSON' }} onCommit={save} />
  </>))
  expect(host.querySelector('[data-markdown-read-view]')).toBeNull(); expect(host.querySelector('input')?.value).toBe('# 字面名称')
  expect(host.querySelector('select')?.value).toBe('# 一'); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(save).not.toHaveBeenCalled()
})

it('050 an acknowledged draft keeps a new IME tail dirty while the old native receipt returns, then saves the completed tail', async () => {
  const { scope } = await seedCurrentWorkspace('050 Ack IME')
  const id = await useCharacterStore.getState().addCharacter({ projectId: scope.projectId, name: '角色', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '', background: '原背景', profile: '', motivation: '', abilities: '', relationships: '', arc: '' })
  await useCharacterStore.getState().loadAll(scope)
  let entered!: () => void, release!: () => void, first = true
  const reached = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  function Harness() {
    const character = useCharacterStore(state => state.characters.find(row => row.id === id)!)
    return <AuthorRecordSaveScopeV1.Provider value={scope}><CharacterDimensionFields character={character} onChange={async (patch, expected, confirmation) => {
      if (!confirmation) throw Error('test requires actual native proof')
      const ack = await useCharacterStore.getState().updateCharacter(id, patch, { scope, expected, confirmation })
      if (first) { first = false; entered(); await gate }
      return ack
    }} /></AuthorRecordSaveScopeV1.Provider>
  }
  await act(async () => root.render(<Harness />))
  for (let i = 0; i < 100 && !host.querySelector('[data-local-save-status]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  await click('编辑源码'); const area = await input('第一稿')
  let saving!: ReturnType<typeof flushPendingEditsV1>
  await act(async () => { saving = flushPendingEditsV1(); await reached })
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await input('第一稿中文尾字')
  await act(async () => { release(); await saving })
  expect((await db.characters.get(id))!.background).toBe('第一稿')
  expect(area.value).toBe('第一稿中文尾字')
  const status = area.parentElement!.querySelector('[data-local-save-status]')!
  expect(status.getAttribute('data-local-save-status')).toBe('dirty')
  await act(async () => { area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); await flushPendingEditsV1() })
  expect((await db.characters.get(id))!.background).toBe('第一稿中文尾字')
  expect(status.getAttribute('data-local-save-status')).toBe('saved')
})
