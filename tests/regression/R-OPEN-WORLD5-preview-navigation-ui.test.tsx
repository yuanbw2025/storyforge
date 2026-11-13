import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, TextOpenWorldCreatorSourceSelectionV1, WorldReferenceV1, WorkspaceScope } from '../../src/lib/types'

const routeMocks = vi.hoisted(() => ({ recover: vi.fn() }))
vi.mock('../../src/lib/open-world/creator-brief', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/open-world/creator-brief')>(),
  recoverLatestTextOpenWorldCreatorBriefSessionV1: routeMocks.recover,
}))
vi.mock('../../src/components/product/ProductProductionStudio', () => ({
  default: (props: {
    onPreviewStarted?: (product: 'text-open-world', sessionId: number) => void
    onPublished?: (product: 'text-open-world') => void
  }) => createElement('section', null,
    createElement('button', {
      onClick: () => props.onPreviewStarted?.('text-open-world', 907),
    }, '模拟已成功创建预览存档'),
    createElement('button', {
      onClick: () => props.onPublished?.('text-open-world'),
    }, '模拟已完成正式发布')),
}))
vi.mock('../../src/components/text-game/TextOpenWorldPlayer', () => ({
  default: function PreviewPlayer(props: { scope: WorkspaceScope; initialSessionId: number | null; onSessionSelected?(id: number | null): void }) {
    const location = useLocation()
    const [localSelection, setLocalSelection] = useState<number | null>(null)
    return createElement('section', null,
      createElement('pre', { 'data-testid': 'preview-player-destination' }, JSON.stringify({
        scope: props.scope, sessionId: props.initialSessionId,
        pathname: location.pathname, search: location.search,
      })),
      createElement('output', { 'data-testid': 'player-local-selection' }, String(localSelection)),
      createElement('button', { onClick: () => {
        setLocalSelection(908)
        props.onSessionSelected?.(908)
      } }, '模拟已核验重试分支'),
      createElement('button', { onClick: () => props.onSessionSelected?.(null) }, '模拟返回游戏库'))
  },
}))
vi.mock('../../src/components/text-game/BuiltinGameShelf', () => ({ BuiltinGameShelf: () => null }))
vi.mock('../../src/lib/product/product-catalog', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/lib/product/product-catalog')>(),
  evaluateProductEntryV1: () => ({ enterable: true, entry: { maturityNote: '测试产品入口' } }),
}))

import { db } from '../../src/lib/db/schema'
import TextGameDevelopmentPage from '../../src/pages/TextGameDevelopmentPage'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { generateWorldCode, isPublicWorldCode } from '../../src/lib/workspace/identity'
import {
  createDefaultTextOpenWorldCreatorBriefDraftV1,
  TEXT_OPEN_WORLD_CREATOR_BRIEF_PURPOSE_PREFIX_V1,
  type TextOpenWorldCreatorBriefSessionV1,
} from '../../src/lib/open-world/creator-brief'
import {
  createTextOpenWorldCreatorSourceLocatorV1,
  parseTextOpenWorldCreatorSourceBindingV1,
  textOpenWorldCreatorProductionLocatorColumnsV1,
  textOpenWorldCreatorSourceBindingFromSelectionV1,
  textOpenWorldCreatorSourceSummaryFromSelectionV1,
} from '../../src/lib/open-world/creator-brief-persistence'
import { worldReleaseUidV1 } from '../../src/lib/world-engine/releases'
import { validatePortableWorldReferenceV1 } from '../../src/lib/world-engine/world-reference'
import '../../src/components/text-game/TextOpenWorldCreatorWorkflow'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

async function waitForUi(assertion: () => void): Promise<void> {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < 5_000) {
    try {
      await act(async () => assertion())
      return
    } catch (cause) {
      last = cause
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

// A complete, codec-checked in-memory recovery DTO for routing only. The
// production studio/player remain mocks; no WorldRelease, Build or runtime
// Session is created, and this fixture does not establish S1 -> S2 delivery.
async function recoveredWorldSession(sourceScope: WorkspaceScope, consumerScope: WorkspaceScope): Promise<TextOpenWorldCreatorBriefSessionV1> {
  const now = Date.now()
  const releaseHash = 'a'.repeat(64)
  const worldCode = generateWorldCode()
  if (!isPublicWorldCode(worldCode)) throw new Error('导航夹具必须使用正式公开世界编号')
  const portable: Omit<WorldReferenceV1, 'referenceHash' | 'localReleaseRecordId'> = {
    schema: 'storyforge.world-reference', version: 1, worldCode,
    releaseUid: worldReleaseUidV1({ worldCode, version: 1, contentHash: releaseHash }),
    releaseVersion: 1, releaseHash,
    manifestIdentity: { schema: 'storyforge.world-release', version: 3, semanticContract: 3,
      schemaHash: await hashCanonicalValue({ schema: 'storyforge.world-release', version: 3, semanticContract: 3 }) },
    capabilityIdentity: { catalogHash: 'b'.repeat(64), profileHash: 'c'.repeat(64) },
  }
  const worldReference = await validatePortableWorldReferenceV1({
    ...portable, localReleaseRecordId: 71, referenceHash: await hashCanonicalValue(portable),
  })
  const selection: TextOpenWorldCreatorSourceSelectionV1 = {
    sourceKind: 'world-release', sourceScope, localReleaseRecordId: 71, expectedReleaseHash: releaseHash,
    preview: {
      schema: 'storyforge.text-open-world-creator-world-source-candidate', version: 1, sourceKind: 'world-release',
      worldReference, label: '导航夹具 · 封存世界 v1', worldName: '导航夹具世界', workTitle: '导航夹具世界', releasedAt: now,
      capabilities: [], resourceCounts: { totalResources: 12, totalRows: 42, byArea: [], byKind: [] },
      requirements: [], readiness: 'ready', gaps: [],
    },
  }
  const sourceBinding = parseTextOpenWorldCreatorSourceBindingV1(textOpenWorldCreatorSourceBindingFromSelectionV1(selection))
  const sourceBindingHash = await hashCanonicalValue(sourceBinding)
  const productInstanceKey = `text-open-world.preview-navigation.${sourceBindingHash.slice(0, 16)}`
  return {
    scope: consumerScope,
    conversation: { id: 81, projectId: consumerScope.projectId, workId: consumerScope.workId, worldGroupId: null,
      purpose: `${TEXT_OPEN_WORLD_CREATOR_BRIEF_PURPOSE_PREFIX_V1}${sourceBindingHash}:preview-navigation`,
      title: '导航夹具会谈', status: 'active', createdAt: now, updatedAt: now },
    production: {
      id: 91, ...consumerScope, productionKey: productInstanceKey, productType: 'text-open-world', title: '导航夹具开放世界',
      status: 'preview-ready', stateRevision: 1, controlEpoch: 0, currentBriefRevision: 1,
      currentBuildNumber: 7, currentProductReleaseId: null,
      ...textOpenWorldCreatorProductionLocatorColumnsV1(createTextOpenWorldCreatorSourceLocatorV1(selection), sourceBinding, sourceBindingHash),
      lastErrorJson: '{}', createdAt: now, updatedAt: now,
    },
    productInstanceKey, selection, sourceBinding, sourceBindingHash,
    sourceSummary: textOpenWorldCreatorSourceSummaryFromSelectionV1(selection),
    draft: createDefaultTextOpenWorldCreatorBriefDraftV1(selection),
    candidate: null, candidateRunId: null, confirmedBrief: null, sourceIssue: null,
  }
}

describe('OPEN-WORLD-5 · creator preview player navigation', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const sourceScope: WorkspaceScope = { projectId: 51, worldId: 52, workId: 53 }
  const creatorScope: WorkspaceScope = { projectId: 61, worldId: 62, workId: 69 }

  beforeEach(async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const now = Date.now()
    const projects: Project[] = [
      { id: 51, workspaceUid: generateWorkspaceUid(), activeWorldId: 52, activeWorkId: 53,
        name: '来源封存世界', workspacePurpose: 'world-engine', createdAt: now, updatedAt: now },
      { id: 61, workspaceUid: generateWorkspaceUid(), activeWorldId: 62, activeWorkId: 63,
        name: '制作作品', workspacePurpose: 'independent-work', createdAt: now, updatedAt: now },
    ]
    vi.spyOn(db.projects, 'toArray').mockResolvedValue(projects)
    routeMocks.recover.mockResolvedValue(await recoveredWorldSession(sourceScope, creatorScope))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    routeMocks.recover.mockReset()
  })

  async function openCreator() {
    await act(async () => root.render(createElement(MemoryRouter, {
      initialEntries: ['/openworld/runtime?project=51&work=53&mode=production&session=808'],
    }, createElement(Routes, null,
      createElement(Route, {
        path: '/openworld/:pageId', element: createElement(TextGameDevelopmentPage, { openWorld: true }),
      }),
    ))))
    await waitForUi(() => expect(host.textContent).toContain('模拟已成功创建预览存档'))
  }

  it('passes the created session through the actual creator workflow and selects its owning Work', async () => {
    await openCreator()
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find(button => button.textContent === '模拟已成功创建预览存档')!.click()
    })
    await waitForUi(() => expect(host.querySelector('[data-testid="preview-player-destination"]')).not.toBeNull())
    expect(JSON.parse(host.querySelector('[data-testid="preview-player-destination"]')!.textContent!)).toEqual({
      scope: creatorScope, sessionId: 907, pathname: '/openworld/runtime',
      search: '?project=61&work=69&session=907&mode=play',
    })
  })

  it('opens the owning published library without carrying a stale preview session', async () => {
    await openCreator()
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find(button => button.textContent === '模拟已完成正式发布')!.click()
    })
    await waitForUi(() => expect(host.querySelector('[data-testid="preview-player-destination"]')).not.toBeNull())
    expect(JSON.parse(host.querySelector('[data-testid="preview-player-destination"]')!.textContent!)).toEqual({
      scope: creatorScope, sessionId: null, pathname: '/openworld/runtime',
      search: '?project=61&work=69&mode=play',
    })
  })

  it('replaces the current session query after a verified player selection without remounting the player', async () => {
    await openCreator()
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find(button => button.textContent === '模拟已成功创建预览存档')!.click()
    })
    await waitForUi(() => expect(host.querySelector('[data-testid="preview-player-destination"]')).not.toBeNull())
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find(button => button.textContent === '模拟已核验重试分支')!.click()
    })
    expect(JSON.parse(host.querySelector('[data-testid="preview-player-destination"]')!.textContent!)).toMatchObject({
      sessionId: 908, search: '?project=61&work=69&session=908&mode=play',
    })
    expect(host.querySelector('[data-testid="player-local-selection"]')!.textContent).toBe('908')
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find(button => button.textContent === '模拟返回游戏库')!.click()
    })
    expect(JSON.parse(host.querySelector('[data-testid="preview-player-destination"]')!.textContent!)).toMatchObject({
      sessionId: null, search: '?project=61&work=69&mode=play',
    })
    expect(host.querySelector('[data-testid="player-local-selection"]')!.textContent).toBe('908')
  })
})
