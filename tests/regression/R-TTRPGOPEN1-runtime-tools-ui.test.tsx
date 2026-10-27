import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useSearchParams } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgRuntimePanel from '../../src/components/ttrpg/TtrpgRuntimePanel'
import { useTtrpgRuntimePlayerStore } from '../../src/stores/ttrpg-runtime-player'
import { seedManualTableV1 } from '../helpers/open-ttrpg-manual'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { startTtrpgOpenConsultationDeskV1, closeTtrpgOpenConsultationDeskV1 } from '../../src/lib/ttrpg/open-consultation-desk'

import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { createCurrentProductBuildPreviewFixture } from '../helpers/current-product-runtime-internal'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
const button = (name: string) => [...host.querySelectorAll('button')].find(row => row.textContent === name)!
async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); if (check()) return }
  throw new Error('Normal runtime save controls did not settle')
}
async function click(name: string) { expect(button(name),name).toBeTruthy(); await act(async () => button(name).click()) }
async function renderSession(f: Pick<Awaited<ReturnType<typeof seedManualTableV1>>['f'],'scope' | 'sessionId'>, authorPanel?: 'history' | 'room') {
  const project = (await db.projects.get(f.scope.projectId))!
  function Route() {
    const [params,setParams] = useSearchParams(), id = Number(params.get('session'))
    return createElement(TtrpgRuntimePanel, { key: id, project, worldGroupId: null, workspaceScope: f.scope, initialSessionId: id, authorPanel,
      onSessionSelected: next => setParams({ session: String(next) }) })
  }
  const router = createMemoryRouter([{ path: '/ttrpg/play', element: createElement(Route) }], { initialEntries: [`/ttrpg/play?session=${f.sessionId}`] })
  await act(async () => root.render(createElement(RouterProvider,{router})))
  await until(() => useTtrpgRuntimePlayerStore.getState().selectedSessionId === f.sessionId && !!host.querySelector('h1'))
  if (!authorPanel) { await until(() => !!button('存档与分支') || !!button('主持、联机与存档工具')); await click(button('存档与分支') ? '存档与分支' : '主持、联机与存档工具') }
  return router
}
async function parentEvidence(sessionId: number) {
  return { row: await db.productRuntimeSessions.get(sessionId), events: await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),
    participants: await db.ttrpgSessionParticipants.where('sessionId').equals(sessionId).sortBy('seatKey') }
}
beforeEach(async () => {
  vi.stubEnv('VITE_ENABLE_TTRPG_OPEN_PREVIEW','1'); await db.delete(); await db.open()
  useTtrpgRuntimePlayerStore.setState({ projectId:null,worldGroupId:null,sessions:[],selectedSessionId:null,events:[],checkpoints:[],loading:false,error:'' })
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount());host.remove();db.close();vi.unstubAllEnvs() })
describe('R-TTRPGOPEN1 normal open save and branch routing', { timeout:60000 }, () => {
  it('branches through the real runtime panel without the scripted parser, preserves the parent and navigates to a freshly authorized child', async () => {
    const {f}=await seedManualTableV1();const parent=await parentEvidence(f.sessionId),state=await readProductRuntimeState(f.sessionId)
    const sources={worlds:await db.worldReleases.toArray(),builds:await db.productBuilds.toArray()}
    const router=await renderSession(f)
    await until(()=>!!host.querySelector('[data-testid="ttrpg-open-save-and-branch"]')||!!host.textContent?.includes('冻结 TTRPG 产品校验失败'))
    expect(host.textContent).not.toContain('冻结 TTRPG 产品校验失败')
    await click('从当前进度建立分支')
    await until(()=>useTtrpgRuntimePlayerStore.getState().selectedSessionId!==f.sessionId)
    const childId=useTtrpgRuntimePlayerStore.getState().selectedSessionId!
    await until(()=>router.state.location.search===`?session=${childId}`)
    const child=(await db.productRuntimeSessions.get(childId))!,actual=await readProductRuntimeState(childId)
    expect(child.parentSessionId).toBe(f.sessionId);expect(child.parentThroughSequence).toBe(state.lastSequence)
    expect(child.runtimeSourceHash).toBe(parent.row!.runtimeSourceHash);expect(child.productBuildId).toBe(parent.row!.productBuildId)
    expect(actual.entities).toEqual(state.entities);expect(actual.ttrpg!.openRun!.worldTime.worldTurn).toBe(state.ttrpg!.openRun!.worldTime.worldTurn)
    expect(actual.ttrpg!.branchLineage!.parentSessionKey).toBe(state.ttrpg!.sessionKey)
    expect(actual.ttrpg!.authorization).toBeNull();expect(actual.ttrpg!.product!.sessionZero.completed).toBe(false)
    expect(actual.lastSequence).toBe(0);expect(await parentEvidence(f.sessionId)).toEqual(parent)
    expect({worlds:await db.worldReleases.toArray(),builds:await db.productBuilds.toArray()}).toEqual(sources)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('saves and restores the exact checkpoint cut through normal controls without replacing later parent progress', async () => {
    const {f,input}=await seedManualTableV1();const router=await renderSession(f,'history')
    expect(host.querySelector('[data-testid="ttrpg-open-save-and-branch"]')).not.toBeNull()
    const cut=await readProductRuntimeState(f.sessionId);await click('保存检查点')
    await until(()=>host.textContent?.includes('检查点已保存。')===true)
    const checkpoints=await db.productRuntimeCheckpoints.where('sessionId').equals(f.sessionId).toArray();expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0].throughSequence).toBe(cut.lastSequence)
    await act(async()=>{
      await startTtrpgOpenConsultationDeskV1({...input,submissionKey:'after-checkpoint',decision:'start-this-consultation-and-sharing'})
      await closeTtrpgOpenConsultationDeskV1({...input,submissionKey:'close-after-checkpoint'})
      await useTtrpgRuntimePlayerStore.getState().select(f.sessionId)
    })
    const parent=await parentEvidence(f.sessionId);expect((await readProductRuntimeState(f.sessionId)).lastSequence).toBeGreaterThan(cut.lastSequence)
    const restore=host.querySelector<HTMLButtonElement>('button[aria-label="从检查点 冒险检查点 建立恢复分支"]')!;expect(restore).not.toBeNull()
    await act(async()=>restore.click());await until(()=>useTtrpgRuntimePlayerStore.getState().selectedSessionId!==f.sessionId)
    const childId=useTtrpgRuntimePlayerStore.getState().selectedSessionId!,child=(await db.productRuntimeSessions.get(childId))!,actual=await readProductRuntimeState(childId)
    await until(()=>router.state.location.search===`?session=${childId}`)
    expect(child.parentSessionId).toBe(f.sessionId);expect(child.parentThroughSequence).toBe(cut.lastSequence)
    expect(actual.entities).toEqual(cut.entities);expect(actual.ttrpg!.branchLineage!.ancestors.at(-1)!.throughSequence).toBe(cut.lastSequence)
    expect(actual.ttrpg!.authorization).toBeNull();expect(await parentEvidence(f.sessionId)).toEqual(parent)
    expect(await db.productRuntimeCheckpoints.where('sessionId').equals(f.sessionId).toArray()).toEqual(checkpoints)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('keeps open save/branch controls hidden when the preview gate is off and does not route the online page into the scripted parser', async () => {
    const {f}=await seedManualTableV1();vi.stubEnv('VITE_ENABLE_TTRPG_OPEN_PREVIEW','0');const before=await parentEvidence(f.sessionId)
    await renderSession(f,'room');await until(()=>host.textContent?.includes('开放跑团的联机桌面尚未开放')===true)
    expect(host.querySelector('[data-testid="ttrpg-open-save-and-branch"]')).toBeNull();expect(button('存档与分支')).toBeUndefined()
    expect(host.textContent).not.toContain('冻结 TTRPG 产品校验失败');expect(await parentEvidence(f.sessionId)).toEqual(before)
    expect(await db.productRuntimeSessions.count()).toBe(1);expect(await db.agentRuns.count()).toBe(0)
  })
  it('keeps the legacy scripted host and checkpoint tools available with the open preview gate off', async () => {
    vi.stubEnv('VITE_ENABLE_TTRPG_OPEN_PREVIEW','0')
    const world=await seedCurrentProductWorld('scripted compatibility'),sourceCatalog=await loadCurrentProductWorldSourceCatalogV1({scope:world.scope,worldReleaseId:world.release.id,productType:'ttrpg'})
    const built=await createCurrentProductBuildPreviewFixture({scope:world.scope,worldRelease:world.release,sourceCatalog,title:'旧版冒险'})
    const f={scope:world.scope,sessionId:built.session.id!},before=await parentEvidence(f.sessionId)
    await renderSession(f,'history');await until(()=>!!host.querySelector('[data-testid="ttrpg-save-and-branch"]'))
    expect(host.querySelector('[data-testid="ttrpg-open-save-and-branch"]')).toBeNull()
    expect(host.textContent).not.toContain('冻结 TTRPG 产品校验失败');expect(await parentEvidence(f.sessionId)).toEqual(before)
    expect(await db.agentRuns.count()).toBe(0)
  })
})
