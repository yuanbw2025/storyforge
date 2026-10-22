import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import AuthorProposal from '../../src/components/ttrpg/AuthorProposal'
import AuthorInspector from '../../src/components/ttrpg/AuthorInspector'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'
import { prepareTtrpgBrief } from '../../src/lib/ttrpg/authoring-service'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN2 author review reads actual open production', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(async () => {
    await db.delete(); await db.open()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close() })
  async function rendered(check: () => boolean) {
    for (let count = 0; count < 100; count++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
      if (check()) return
    }
    throw new Error(`view did not resolve: ${host.textContent}`)
  }
  it('shows the frozen open brief and routes to production without generating proposals or granting start', async () => {
    const fixture = await createFreshOpenDraftFixtureV1(), productionId = await prepareTtrpgBrief(fixture.scope, fixture.draft.revision)
    const original = (await db.productProductionBriefs.where('productionId').equals(productionId).first())!
    const next = vi.fn()
    await act(async () => root.render(createElement(AuthorProposal, { scope: fixture.scope, productionId, onProduction: next })))
    await rendered(() => Boolean(host.querySelector('[data-testid="ttrpg-open-brief-review"]')))
    expect(host.textContent).toContain('潮水上涨时寻找灯塔钥匙')
    expect(host.textContent).toContain('制作投入上限')
    expect(host.textContent).toContain('尚未授权开始制作')
    expect(host.textContent).not.toContain('这里会显示真实提案')
    const button = [...host.querySelectorAll('button')].find(button => button.textContent === '前往制作页')!
    await act(async () => button.click())
    expect(next).toHaveBeenCalledOnce()
    expect(await db.productBuilds.count()).toBe(0)
    expect((await db.productProductionBriefs.get(original.id!))!.briefJson).toBe(original.briefJson)
  })
  it('inspects the actual protocol 2 campaign and refuses a damaged preview', async () => {
    const fixture = await seedOpenBrowserProductionV1()
    await runOpenBrowserProductionV1(fixture)
    await runOpenBrowserProductionV1(fixture, true)
    expect((await runOpenBrowserProductionV1(fixture, true)).terminal).toBe(true)
    await act(async () => root.render(createElement(AuthorInspector, { ...fixture, page: 'scenes', onProduction: vi.fn() })))
    await rendered(() => (host.textContent ?? '').includes('灯塔钥匙'))
    expect(host.textContent).toContain('局势'); expect(host.textContent).toContain('压力时钟')
    expect(host.textContent).toContain('阶段闭合')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    const build = (await db.productBuilds.where('productionId').equals(fixture.productionId).first())!
    const preview = JSON.parse(build.previewManifestJson); preview.packageHash = 'f'.repeat(64)
    await db.productBuilds.update(build.id!, { previewManifestJson: JSON.stringify(preview) })
    await act(async () => root.render(createElement(AuthorInspector, { ...fixture, page: 'characters', onProduction: vi.fn() })))
    await rendered(() => Boolean(host.querySelector('[role="alert"]')))
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('packageHash')
  }, 60_000)
})
