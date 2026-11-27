import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCultivationStore } from '../../src/stores/cultivation'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { AuthorRecordSaveScopeV1 } from '../../src/components/shared/AuthorRecordSaveScope'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import CultivationSystemsPanel from '../../src/components/worldview/CultivationSystemsPanel'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(async () => {
 Reflect.set(globalThis,'IS_REACT_ACT_ENVIRONMENT',true); resetPendingEditCoordinatorForTestsV1()
 await db.delete(); await db.open(); useCultivationStore.setState({ systems: [], loading: false, loadedScope: null, loadError: null })
 host=document.createElement('div'); document.body.append(host); root=createRoot(host)
})
afterEach(async () => { await act(async()=>root.unmount()); host.remove(); vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
it('retains an original proof-backed draft through preloading another World, then flushes its original writer before changing the panel', async () => {
 const first=await seedCurrentWorkspace('原修炼作品'), second=await seedCurrentWorkspace('另一修炼作品')
 await useCultivationStore.getState().loadAll(first.scope)
 const id=await useCultivationStore.getState().addSystem({ projectId:first.scope.projectId,name:'原路径',description:'原原理',stages:'[]' },first.scope)
 const render=(f:typeof first)=>act(async()=>root.render(<DialogProvider><ToastProvider><AuthorRecordSaveScopeV1.Provider value={f.scope}><CultivationSystemsPanel project={f.project}/></AuthorRecordSaveScopeV1.Provider></ToastProvider></DialogProvider>))
 await render(first)
 await vi.waitFor(()=>expect(host.querySelectorAll('[data-local-save-status="saved"]')).toHaveLength(2))
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='编辑源码')!.click())
 const area=host.querySelector('textarea')!
 await act(async()=>{
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'原作品尚未失焦的新原理 é 😀  ')
  area.dispatchEvent(new Event('input',{bubbles:true}))
 })
 await act(async()=>useCultivationStore.getState().loadAll(second.scope))
 expect(host.querySelector('textarea')).toBe(area); expect(area.value).toContain('原作品尚未失焦')
 expect(host.querySelector<HTMLFieldSetElement>('[aria-label="修炼体系读取保护"]')?.disabled).toBe(true)
 await render(second)
 await vi.waitFor(async()=>expect((await db.cultivationSystems.get(id))?.description).toBe('原作品尚未失焦的新原理 é 😀  '))
 await act(async()=>{await flushPendingEditsV1()})
 await vi.waitFor(()=>expect(useCultivationStore.getState().loadedScope).toEqual(second.scope))
 expect(host.querySelector('textarea')).toBeNull(); expect(await db.cultivationSystems.where('projectId').equals(second.scope.projectId).count()).toBe(0)
})
