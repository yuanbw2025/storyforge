import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextAdventurePackagePanel from '../../src/components/product/TextAdventurePackagePanel'
import type { TextAdventureCommunityPackageV1 } from '../../src/lib/adventure/community-package'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const HASH = 'a'.repeat(64)

function candidate(): TextAdventureCommunityPackageV1 {
  return {
    schema: 'storyforge.text-adventure-community-package', version: 1,
    distributionBundle: {
      schema: 'storyforge.product-distribution-bundle', version: 2,
      productRelease: {
        contentHash: HASH,
        manifest: { lineage: { releaseVersion: 3 } } as never,
      },
      sourceWorld: { contentHash: 'b'.repeat(64) }, media: [], bundleHash: 'c'.repeat(64),
    },
    dossier: {
      schema: 'storyforge.text-adventure-community-candidate-dossier', version: 1,
      status: 'eligible-for-community-submission', title: '潮钟群岛',
      releaseContentHash: HASH, releaseIdentityHash: 'd'.repeat(64),
      runtimePackageHash: 'e'.repeat(64), distributionBundleHash: 'c'.repeat(64),
      sourceWorldHash: 'b'.repeat(64), buildNumber: 7,
      metrics: {
        routeCount: 6, reachableEndingCount: 3, minimumRouteTextUnits: 12_000,
        maximumRouteTextUnits: 15_000, totalPlayableTextUnits: 26_000,
        estimatedMinimumRouteMinutes: 61.2, minimumRouteDialogueTurns: 32,
        minimumRouteNarrativeChoices: 14, minimumRouteStatefulDecisions: 6,
        authoredNpcCount: 5, talkActionCount: 9, mainQuestStageCount: 4,
        mainQuestObjectiveCount: 9, minimumMainProgressActions: 21,
      },
      systems: {
        regions: 2, areas: 8, locations: 18, scenes: 24, mainQuests: 1,
        sideQuests: 4, storylets: 8, items: 12, equipmentItems: 4,
        abilities: 8, resources: 6, mediaAssets: 9,
      },
      evidence: {
        buildManifestHash: 'f'.repeat(64), qualityReportHash: '1'.repeat(64),
        autoplayArtifactHash: '2'.repeat(64), gateReceiptHashes: ['3'.repeat(64)],
        mediaAuditHash: '4'.repeat(64), visualReviewHash: '5'.repeat(64),
        authorMainRouteEndingKey: 'ending.home', authorMainRouteChoiceCount: 14,
      },
      offlineFallback: 'text-only',
    },
    evidence: {} as never,
    candidatePackageHash: '6'.repeat(64),
  }
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 5_000) {
    try { await act(async () => { await assertion() }); return }
    catch (cause) { last = cause; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
  }
  throw last
}

describe('TEXTADV-7 · product package UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => {
    vi.unstubAllGlobals(); vi.restoreAllMocks()
    await act(async () => root.unmount()); host.remove()
  })

  it('复验正式 Release 后下载完整包并展示可计算的候选档案', async () => {
    const value = candidate()
    const exportPackage = vi.fn().mockResolvedValue(value)
    let downloaded: Blob | null = null
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => { downloaded = blob; return 'blob:text-adventure-package' }),
      revokeObjectURL: vi.fn(),
    })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await act(async () => root.render(createElement(TextAdventurePackagePanel, {
      scope: { projectId: 1, worldId: 2, workId: 3 }, productReleaseId: 9, exportPackage,
    })))
    const exportButton = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('复验并导出产品包'))!
    await act(async () => exportButton.click())
    await waitFor(() => expect(host.textContent).toContain('具备社区提交资格：潮钟群岛'))
    expect(exportPackage).toHaveBeenCalledWith({
      scope: { projectId: 1, worldId: 2, workId: 3 }, productReleaseId: 9,
    })
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(downloaded).not.toBeNull()
    expect(await downloaded!.text()).toContain('storyforge.text-adventure-community-package')
    expect(host.textContent).toContain('61.2 分钟')
    expect(host.textContent).toContain('32 / 6')
    expect(host.textContent).toContain('不会自动公开作品')
  })

  it('上传本地产品包后调用原子导入并明确标记为本地副本', async () => {
    const value = candidate()
    const importPackage = vi.fn().mockResolvedValue({
      release: { id: 17, contentHash: HASH } as never,
      package: value,
    })
    const onImported = vi.fn()
    await act(async () => root.render(createElement(TextAdventurePackagePanel, {
      scope: { projectId: 1, worldId: 2, workId: 3 }, importPackage, onImported,
    })))
    const file = new File([JSON.stringify(value)], `flagship.storyforge-adventure.json`, { type: 'application/json' })
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await waitFor(() => expect(importPackage).toHaveBeenCalledOnce())
    expect(importPackage).toHaveBeenCalledWith({
      scope: { projectId: 1, worldId: 2, workId: 3 },
      package: value,
    })
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ release: expect.objectContaining({ id: 17 }) }))
    expect(host.textContent).toContain('本地可玩副本')
    expect(host.textContent).toContain('不代表远程作者身份或社区推荐')
  })
})
