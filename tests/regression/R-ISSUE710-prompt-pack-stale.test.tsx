import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import { usePromptStore } from '../../src/stores/prompt'
import PromptManagerPanel from '../../src/components/settings/prompt/PromptManagerPanel'
import { ToastProvider } from '../../src/components/shared/Toast'
import { DialogProvider } from '../../src/components/shared/Dialog'

let host: HTMLDivElement
let root: Root
function row(patch: Partial<PromptTemplate> = {}): PromptTemplate {
  return { scope: 'user', moduleKey: 'chapter.content', promptType: 'generate', name: '710 retained template',
    description: 'SYNTHETIC_ONLY', systemPrompt: 'ORIGINAL_SYSTEM', userPromptTemplate: 'ORIGINAL_INPUT',
    variables: [], isActive: false, createdAt: 1, updatedAt: 1, ...patch }
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No real network authorized') }))
  await db.delete(); await db.open()
  localStorage.clear()
  usePromptStore.setState({ templates: [], loaded: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete(); localStorage.clear()
})
async function setup(genre: string) {
  const prior = await db.promptTemplates.add(row({ name: 'previous active', isActive: true })) as number
  const target = await db.promptTemplates.add(row({ name: 'pack target', scope: 'system', genres: [genre] })) as number
  const other = await db.promptTemplates.add(row({ name: 'other module active', moduleKey: 'chapter.continue', isActive: true })) as number
  localStorage.setItem('sf-genre-pack', genre === 'general' ? 'xianxia' : 'general')
  await usePromptStore.getState().reload()
  await act(async () => root.render(createElement(DialogProvider, null,
    createElement(ToastProvider, null, createElement(PromptManagerPanel)))))
  return { prior, target, other }
}
async function change(genre: string) {
  const select = host.querySelector('select')!
  await act(async () => { select.value = genre; select.dispatchEvent(new Event('change', { bubbles: true })) })
}
for (const genre of ['general', 'xianxia']) {
  for (const damage of ['missing', 'moved']) {
    it(`shows pack failure for ${genre}/${damage} without changing current native rows or resending`, async () => {
      const f = await setup(genre)
      // An independent native writer changes the record after this view's load.
      if (damage === 'missing') await db.promptTemplates.delete(f.target)
      else await db.promptTemplates.update(f.target, { moduleKey: 'chapter.continue' })
      const before = await db.promptTemplates.orderBy('id').toArray()
      await change(genre)
      await vi.waitFor(() => expect(host.textContent).toContain('题材包切换未完成'))
      expect(await db.promptTemplates.orderBy('id').toArray()).toEqual(before)
      expect(await db.promptTemplates.get(f.prior)).toMatchObject({ isActive: true, systemPrompt: 'ORIGINAL_SYSTEM' })
      expect(await db.promptTemplates.get(f.other)).toMatchObject({ isActive: true, moduleKey: 'chapter.continue' })
    })
  }
  it(`activates an existing ${genre} pack through the native store and keeps other module bytes`, async () => {
    const f = await setup(genre), other = await db.promptTemplates.get(f.other)
    await change(genre)
    await vi.waitFor(async () => expect(await db.promptTemplates.get(f.target)).toMatchObject({ isActive: true }))
    expect(await db.promptTemplates.get(f.prior)).toMatchObject({ isActive: false })
    expect(await db.promptTemplates.get(f.other)).toEqual(other)
    expect(host.textContent).not.toContain('题材包切换未完成')
  })
}
