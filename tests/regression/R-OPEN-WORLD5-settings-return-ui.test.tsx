import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

vi.mock('../../src/components/settings/SettingsPage', () => ({
  default: () => createElement('div', null, '设置内容'),
}))

import SettingsRoutePage from '../../src/pages/SettingsRoutePage'
import {
  parseTextOpenWorldSettingsReturnV1,
  resolveProjectSelectionAfterInitialLoadV1,
} from '../../src/lib/open-world/creator-settings-navigation'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Destination() {
  const location = useLocation()
  return createElement('pre', { 'data-testid': 'settings-return-destination' }, JSON.stringify({
    pathname: location.pathname,
    state: location.state,
  }))
}

describe('TOW-G5-03 · settings return route', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('把无密钥的开放世界制作定位安全转交给当前主干设置页', async () => {
    const sourceBinding = {
      kind: 'novel' as const,
      workCode: 'work.river-lantern',
      sourceVersionHash: 'a'.repeat(64),
      sourceBoundaryHash: 'b'.repeat(64),
      coverage: 'full-text' as const,
      selectionMode: 'entire-work' as const,
      selectedChapterCount: 8,
      selectedOutlineCount: 3,
    }
    const resume = {
      schema: 'storyforge.text-open-world-settings-return',
      version: 1,
      activeWorkProjectId: 41,
      activeWorldProjectId: 42,
      sourceKind: 'novel',
      conversationId: 61,
      productInstanceKey: 'text-open-world.primary.test-source',
      sourceBindingHash: 'c'.repeat(64),
      sourceBinding,
    }
    await act(async () => root.render(createElement(MemoryRouter, {
      initialEntries: [{
        pathname: '/settings',
        state: { storyforgeProductHubReturn: resume },
      }],
    }, createElement(Routes, null,
      createElement(Route, { path: '/settings', element: createElement(SettingsRoutePage) }),
      createElement(Route, { path: '/home/settings', element: createElement(Destination) }),
    ))))

    expect(host.querySelector('[data-testid="settings-return-destination"]')?.textContent)
      .toBe(JSON.stringify({
        pathname: '/home/settings',
        state: { storyforgeProductHubReturn: resume },
      }))
    expect(host.innerHTML).not.toMatch(/api[-_]?key|authorization|bearer/i)
  })

  it('严格解析会谈与来源身份，拒绝跨来源或扩展字段伪造的返回状态', () => {
    const valid = {
      storyforgeProductHubReturn: {
        schema: 'storyforge.text-open-world-settings-return',
        version: 1,
        activeWorkProjectId: 41,
        activeWorldProjectId: null,
        sourceKind: 'novel',
        conversationId: 61,
        productInstanceKey: 'text-open-world.primary.test-source',
        sourceBindingHash: 'c'.repeat(64),
        sourceBinding: {
          kind: 'novel',
          workCode: 'work.river-lantern',
          sourceVersionHash: 'a'.repeat(64),
          sourceBoundaryHash: 'b'.repeat(64),
          coverage: 'full-text',
          selectionMode: 'entire-work',
          selectedChapterCount: 8,
          selectedOutlineCount: 3,
        },
      },
    }
    expect(parseTextOpenWorldSettingsReturnV1(valid)).toMatchObject({
      conversationId: 61,
      productInstanceKey: 'text-open-world.primary.test-source',
      sourceKind: 'novel',
    })
    expect(parseTextOpenWorldSettingsReturnV1({
      storyforgeProductHubReturn: {
        ...valid.storyforgeProductHubReturn,
        sourceKind: 'world-release',
      },
    })).toBeNull()
    expect(parseTextOpenWorldSettingsReturnV1({
      storyforgeProductHubReturn: {
        ...valid.storyforgeProductHubReturn,
        apiKey: 'must-not-be-accepted',
      },
    })).toBeNull()
  })

  it('IndexedDB 首次载入前保留设置返回绑定的项目，不把空 store 快照当作删除', () => {
    expect(resolveProjectSelectionAfterInitialLoadV1({
      currentProjectId: 41,
      projectsInitialized: false,
      authoritativeProjectIds: [],
    })).toBe(41)
    expect(resolveProjectSelectionAfterInitialLoadV1({
      currentProjectId: 42,
      projectsInitialized: false,
      authoritativeProjectIds: [],
      fallbackProjectIds: [],
    })).toBe(42)
    expect(resolveProjectSelectionAfterInitialLoadV1({
      currentProjectId: 41,
      projectsInitialized: true,
      authoritativeProjectIds: [51],
    })).toBe(51)
  })
})
