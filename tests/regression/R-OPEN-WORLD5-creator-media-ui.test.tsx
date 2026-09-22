import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceScope } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  store: vi.fn(),
  preview: vi.fn(),
  authorize: vi.fn(),
}))

vi.mock('../../src/lib/product-production/service', () => ({
  inspectTextOpenWorldCreatorMediaWorkspaceV1: mocks.inspect,
  importTextOpenWorldCreatorMediaBlobV1: mocks.store,
  previewTextOpenWorldCreatorMediaV1: mocks.preview,
  authorizeTextOpenWorldCreatorMediaV1: mocks.authorize,
}))

import TextOpenWorldCreatorMediaStudio from '../../src/components/text-game/TextOpenWorldCreatorMediaStudio'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCOPE: WorkspaceScope = { projectId: 301, worldId: 302, workId: 303 }
const HASH = 'a'.repeat(64)

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!result) throw new Error(`button not found:${label}`)
  return result
}

describe('Text Open World G5-08 · Creator media studio UI', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.inspect.mockReset().mockResolvedValue({
      productionId: 71,
      buildId: 81,
      buildNumber: 4,
      buildStatus: 'release-ready',
      mediaRequirementsHash: HASH,
      slots: [
        {
          artifactKey: 'text-open-world.media.visual.001',
          slotKey: 'media.background',
          slotKind: 'scene-background',
          subjectKey: 'region.harbor',
          mediaKind: 'background',
          title: '盐港背景',
          altText: '盐港背景',
          width: 1200,
          height: 675,
        },
        {
          artifactKey: 'text-open-world.media.visual.002',
          slotKey: 'media.portrait',
          slotKind: 'character-portrait',
          subjectKey: 'actor.guide',
          mediaKind: 'character-pose',
          title: '向导头像',
          altText: '向导头像',
          width: 720,
          height: 1080,
        },
      ],
      currentAssets: [
        { artifactKey: 'text-open-world.media.visual.001', contentHash: HASH, mimeType: 'image/svg+xml', byteSize: 100, source: 'storyforge-procedural-svg-v1', license: 'CC0-1.0' },
        { artifactKey: 'text-open-world.media.visual.002', contentHash: HASH, mimeType: 'image/svg+xml', byteSize: 100, source: 'storyforge-procedural-svg-v1', license: 'CC0-1.0' },
      ],
      proceduralMapReady: true,
      audioFallback: 'silent',
    })
    mocks.preview.mockReset().mockResolvedValue({
      scope: SCOPE,
      production: { id: 71, stateRevision: 9 },
      baseBuild: { id: 81 },
      targetPlanHash: 'b'.repeat(64),
      mediaPlan: {
        mode: 'provider-generate',
        targetBuildNumber: 5,
        capability: { adapterId: 'agnes.image-2.1-flash.v1' },
        staleTaskKeys: ['media.visual', 'v3.runtime-package', 'qa.release'],
        reuseTaskKeys: ['p0.source-lock', 'p1.source-curation'],
        estimatedRerunBudget: {
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          mediaCalls: 2,
          maximumCostUsd: 1,
          durationMs: 10_000,
          storageBytes: 2_000_000,
        },
      },
    })
    mocks.authorize.mockReset().mockResolvedValue({
      ok: true,
      result: {},
      errorCode: null,
    })
    mocks.store.mockReset()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('shows the minimum media contract and requires preview plus four confirmations before creating a child Build', async () => {
    const onChanged = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldCreatorMediaStudio, {
      scope: SCOPE,
      productionId: 71,
      buildId: 81,
      onChanged,
    })))
    await vi.waitFor(() => expect(host.textContent).toContain('盐港背景'))
    expect(host.textContent).toContain('程序 SVG 地图')
    expect(host.textContent).toContain('静音音频降级')
    expect(host.querySelectorAll('input[type="file"]')).toHaveLength(2)

    await act(async () => button(host, 'AI 生成完整图片包').click())
    const previewButton = button(host, '预览媒资子 Build')
    expect(previewButton.disabled).toBe(false)
    await act(async () => previewButton.click())
    await vi.waitFor(() => expect(host.textContent).toContain('Build #5 冻结预览'))
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({
      scope: SCOPE,
      productionId: 71,
      buildId: 81,
      mode: 'provider-generate',
      maximumCostUsd: 1,
    }))

    const create = button(host, '确认并创建媒资子 Build')
    expect(create.disabled).toBe(true)
    const checks = [...host.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')]
    expect(checks).toHaveLength(4)
    for (const check of checks) await act(async () => check.click())
    expect(create.disabled).toBe(false)
    await act(async () => create.click())
    await vi.waitFor(() => expect(mocks.authorize).toHaveBeenCalledOnce())
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({
      acknowledgement: {
        completeBundle: true,
        rightsAndProvenance: true,
        costAndProvider: true,
        oldBuildImmutable: true,
      },
    }))
    expect(onChanged).toHaveBeenCalledOnce()
  })
})
