import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, WorkspaceScope } from '../../src/lib/types'

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
import '../../src/components/text-game/TextOpenWorldCreatorWorkflow'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

describe('OPEN-WORLD-5 · creator preview player navigation', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const creatorScope: WorkspaceScope = { projectId: 61, worldId: 62, workId: 69 }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    vi.spyOn(db.projects, 'toArray').mockResolvedValue([
      { id: 51, activeWorldId: 52, activeWorkId: 53, name: '来源小说', workspacePurpose: 'independent-work' },
      { id: 61, activeWorldId: 62, activeWorkId: 63, name: '制作作品', workspacePurpose: 'independent-work' },
    ] as Project[])
    routeMocks.recover.mockResolvedValue({
      scope: creatorScope,
      production: { id: 91, currentBuildNumber: 7, status: 'preview-ready' },
      selection: null,
    })
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
