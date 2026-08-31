import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import GameProductionStudio from '../../src/components/text-game/GameProductionStudio'
import { db } from '../../src/lib/db/schema'
import { seedStoryGameAcceptanceSample } from '../../src/lib/text-game/authoring'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createLegacyExecutableWorldRevisionFixtureV1 } from '../helpers/legacy-executable-world-release'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function button(host: ParentNode, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!result) throw new Error(`找不到按钮:${label}`)
  return result
}

function checkbox(host: ParentNode, label: string): HTMLInputElement {
  const wrapper = [...host.querySelectorAll('label')].find(item => item.textContent?.includes(label))
  const result = wrapper?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!result) throw new Error(`找不到复选框:${label}`)
  return result
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 5_000) {
    try { await act(async () => { await assertion() }); return }
    catch (cause) { last = cause; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
  }
  throw last
}

async function fixture() {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name: '素材选择 UI', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 10_000, createdAt: now, updatedAt: now,
  } as never) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  await db.characters.bulkAdd([
    {
      projectId, worldId: owned.scope.worldId, workId: owned.scope.workId, isCrossWorld: true,
      name: '林舟', role: 'protagonist', roleWeight: 'main', identity: '谨慎的守灯调查者',
      createdAt: now, updatedAt: now,
    },
    {
      projectId, worldId: owned.scope.worldId, workId: owned.scope.workId, isCrossWorld: true,
      name: '守潮人', role: 'supporting', roleWeight: 'npc', identity: '掌握旧港秘密的向导',
      createdAt: now, updatedAt: now,
    },
  ] as never[])
  await db.importantLocations.add({
    projectId, worldId: owned.scope.worldId, workId: owned.scope.workId, parentId: null,
    name: '雾港灯塔', type: 'lighthouse', description: '潮门关闭前仍可进入的调查起点。',
    createdAt: now, updatedAt: now,
  } as never)
  const story = await seedStoryGameAcceptanceSample({ scope: owned.scope })
  const revision = await createLegacyExecutableWorldRevisionFixtureV1({
    scope: owned.scope, label: 'UI 冻结来源', selectedNarrativeModuleIds: [story.narrativeModuleId],
  })
  await publishWorldRevision(revision.id!)
  return owned
}

describe('GAME-PROD-1B · frozen source selector UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    localStorage.clear(); await db.delete(); await db.open()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  afterAll(() => db.close())

  it('作者选择角色起点后可增删冻结素材，Brief 摘要反映 exact 子集', async () => {
    const owned = await fixture()
    const release = (await db.worldReleases.toArray()).find(row => (
      row.projectId === owned.scope.projectId && row.worldId === owned.scope.worldId
    ))
    await act(async () => {
      root.render(createElement(GameProductionStudio, {
        scope: owned.scope, worldGroupId: owned.world.worldGroupId, initialProduct: 'storygame',
        initialSource: {
          schema: 'storyforge.world-game-production-handoff', version: 2, productType: 'storygame',
          worldReleaseId: release!.id!, worldContentHash: release!.contentHash,
        },
      }))
    })
    await waitFor(() => expect(button(host, '分析可玩起点').disabled).toBe(false))
    const releaseSelect = [...host.querySelectorAll('label')]
      .find(label => label.textContent?.includes('冻结 WorldRelease'))
      ?.querySelector<HTMLSelectElement>('select')
    expect(releaseSelect?.value).toBe(String(release!.id))
    await act(async () => { button(host, '分析可玩起点').click() })
    await waitFor(() => expect(host.textContent).toContain('编辑本次进入游戏的冻结素材'))
    const activity = host.querySelector('[data-testid="game-production-command-activity"]')
    expect(activity?.getAttribute('aria-live')).toBe('polite')
    expect(activity?.textContent).toContain('succeeded')
    await act(async () => { button(host, '跟随角色「林舟」开始').click() })
    expect(checkbox(host, '林舟').checked).toBe(true)
    expect(checkbox(host, '守潮人').checked).toBe(false)
    await act(async () => {
      checkbox(host, '守潮人').click()
      checkbox(host, '雾港灯塔').click()
    })
    expect(checkbox(host, '守潮人').checked).toBe(true)
    expect(checkbox(host, '雾港灯塔').checked).toBe(false)
    await act(async () => { button(host, '生成严格 Brief').click() })
    await waitFor(() => {
      const summary = host.querySelector('[data-testid="game-production-source-selection-summary"]')
      expect(summary?.textContent).toContain('角色 2')
      expect(summary?.textContent).toContain('地点 0')
    })
    expect(host.textContent).toContain('严格 Brief 已生成')
  })
})
