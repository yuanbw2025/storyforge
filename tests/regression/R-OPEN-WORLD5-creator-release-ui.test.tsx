import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceScope } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  publish: vi.fn(),
}))

vi.mock('../../src/lib/open-world/creator-release', () => ({
  prepareTextOpenWorldCreatorReleaseV1: mocks.prepare,
  publishTextOpenWorldCreatorReleaseV1: mocks.publish,
}))

import TextOpenWorldCreatorReleaseStudio from '../../src/components/text-game/TextOpenWorldCreatorReleaseStudio'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCOPE: WorkspaceScope = { projectId: 701, worldId: 702, workId: 703 }

function prepared() {
  return {
    intent: {
      schema: 'storyforge.product-production-adoption-intent', version: 1,
      productionId: 71, productionKey: 'creator.release.ui', expectedStateRevision: 9,
      buildId: 81, buildNumber: 3, controlEpoch: 2, briefHash: '1'.repeat(64),
      planHash: '2'.repeat(64), manifestHash: '3'.repeat(64), packageHash: '4'.repeat(64),
      previewHash: '5'.repeat(64), qualityReportHash: '6'.repeat(64),
      rootTerminalReceiptHash: '7'.repeat(64), browserPerformanceReceiptHash: null,
      mainRoutePlaythroughReceiptHash: null, mediaRuntimeReceiptHash: null,
      worldReleaseId: null, worldContentHash: '8'.repeat(64),
    },
    adoptionIntentHash: '9'.repeat(64), productType: 'text-open-world' as const,
    title: '盐脊', releaseVersion: 2, mediaAssetKeys: ['map.world', 'portrait.caretaker'],
    creatorRelease: {
      sourceKind: 'novel' as const, sourceVersionHash: '8'.repeat(64),
      sourceBoundaryHash: 'a'.repeat(64), sourcePlanHash: 'b'.repeat(64),
      sourcePinHash: 'c'.repeat(64), sourceManifestHash: 'd'.repeat(64),
      artifactSetHash: 'e'.repeat(64), integrationReportHash: 'f'.repeat(64),
      governanceSnapshotHash: '0'.repeat(64), releaseQualityReceiptHash: 'a'.repeat(64),
    },
  }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!result) throw new Error(`button not found:${label}`)
  return result
}

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Text Open World G5-10 · Creator release studio UI', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.prepare.mockReset().mockResolvedValue(prepared())
    mocks.publish.mockReset().mockResolvedValue({
      authorization: { authorizationHash: 'a'.repeat(64) },
      receipt: {
        productionId: 71, buildId: 81, buildNumber: 3, productReleaseId: 91,
        releaseVersion: 2, releaseContentHash: 'b'.repeat(64), packageHash: '4'.repeat(64),
        adoptionIntentHash: '9'.repeat(64), stateRevision: 10, replayed: false,
      },
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('展示完整发布证据，四项作者确认前保持禁用，确认后执行专属发布', async () => {
    const onPublished = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldCreatorReleaseStudio, {
      scope: SCOPE, productionId: 71, buildId: 81, refreshToken: '81:9', onPublished,
    })))
    await vi.waitFor(() => expect(host.textContent).toContain('小说 SourcePin'))
    expect(mocks.prepare).toHaveBeenCalledWith({ scope: SCOPE, productionId: 71, expectedBuildId: 81 })
    expect(host.textContent).toContain('Artifact 集合')
    expect(host.textContent).toContain('装配报告')
    expect(host.textContent).toContain('最终质量回执')
    expect(host.textContent).toContain('2 项')

    const publish = button(host, '复验并原子发布 v2')
    expect(publish.disabled).toBe(true)
    const checks = [...host.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')]
    expect(checks).toHaveLength(4)
    for (const checkbox of checks) await act(async () => checkbox.click())
    expect(publish.disabled).toBe(false)
    const label = host.querySelector<HTMLInputElement>('input[aria-label="Creator Release 发布名称"]')!
    await act(async () => setValue(label, '盐脊 公开版'))
    await act(async () => publish.click())
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce())
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({
      scope: SCOPE, productionId: 71, prepared: expect.objectContaining({ releaseVersion: 2 }),
      releaseLabel: '盐脊 公开版',
      acknowledgement: {
        sourceAndRightsReviewed: true, buildAndQualityReviewed: true,
        immutableReleaseReviewed: true, publishNow: true,
      },
      authorizationNonce: expect.any(String),
    }))
    await vi.waitFor(() => expect(host.textContent).toContain('ProductRelease v2 已发布'))
    expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ productReleaseId: 91 }))
  })

  it('发布候选复验失败时展示阻断原因且不出现发布按钮', async () => {
    mocks.prepare.mockRejectedValue(new Error('G5-09质量回执已过期'))
    await act(async () => root.render(createElement(TextOpenWorldCreatorReleaseStudio, {
      scope: SCOPE, productionId: 71, buildId: 81, refreshToken: '81:10', onPublished: vi.fn(),
    })))
    await vi.waitFor(() => expect(host.textContent).toContain('G5-09质量回执已过期'))
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('原子发布'))).toBe(false)
  })
})
