import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdventureGamePlayer from '../../src/components/text-game/AdventureGamePlayer'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { commitAdventureAction, readProductRuntimeStateVersion } from '../../src/lib/adventure/runtime-api'
import { db } from '../../src/lib/db/schema'
import { useAdventureGamePlayerStore } from '../../src/stores/adventure-game-player'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import {
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from '../helpers/current-product-world'
import { createTextAdventureFoundationRuntimePackageV2 } from '../helpers/text-adventure-v2-foundation'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('TEXTADV-2 · 玩家界面纵切面', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('真实加载 V2 存档，展示角色、区域、装备，并在重新装载后恢复正式状态', async () => {
    const owned = await seedCurrentProductWorld('TEXTADV-2 玩家界面')
    const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      productType: 'text-adventure',
    })
    const runtimePackage = createTextAdventureFoundationRuntimePackageV2({
      worldRelease: owned.release as typeof owned.release & { id: number },
      sourceCatalog,
    })
    if (runtimePackage.adventure?.version !== 2) throw new Error('玩家界面夹具未进入 AdventureContentV2')
    const legacyClock = runtimePackage.adventure.resources.find(resource => resource.role === 'clock')!
    legacyClock.initial = 3600
    legacyClock.maximum = 10_000
    runtimePackage.adventure.locations[0].title = '**封港仓房**'
    runtimePackage.interaction.profiles = runtimePackage.interaction.profiles.map((profile, index) => ({
      ...profile, characterKey: `generated:participant.${index + 1}`, name: `产品角色 ${index + 1}`,
    }))
    const built = await seedCurrentProductBuild({
      scope: owned.scope,
      worldRelease: owned.release as typeof owned.release & { id: number },
      runtimePackage,
      title: '雾潮灯塔 V2',
      seed: 'text-adventure-v2-ui-seed',
    })

    const renderPlayer = async () => {
      await act(async () => {
        root.render(createElement(DialogProvider, null, createElement(AdventureGamePlayer, {
          project: owned.project,
          scope: owned.scope,
          worldGroupId: null,
          initialSessionId: built.session.id!,
        })))
      })
      await act(async () => {
        await vi.waitFor(() => {
          const state = useAdventureGamePlayerStore.getState()
          expect(state.loading).toBe(false)
          expect(state.selectedSessionId).toBe(built.session.id!)
        })
      })
      expect(host.textContent).toContain('封港仓房')
    }
    const clickNavigation = async (label: string) => {
      const button = Array.from(host.querySelectorAll<HTMLButtonElement>('nav[aria-label="冒险功能"] button'))
        .find(item => item.textContent?.includes(label))
      if (!button) throw new Error(`缺少玩家界面入口:${label}`)
      await act(async () => button.click())
    }
    const closePanel = async () => {
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="关闭面板"]')
      if (!button) throw new Error('缺少面板关闭入口')
      await act(async () => button.click())
    }

    await renderPlayer()
    expect(host.textContent).toContain('离线确定性模式')
    expect(host.textContent).toContain('雾港 · 内港区')
    expect(host.textContent).toContain('封港钟前 +0 分钟')
    expect(host.textContent).not.toContain('封港钟前 +3600 分钟')
    expect(host.textContent).not.toContain('**封港仓房**')
    expect(host.textContent).toContain('没有可交谈的人')
    expect(host.textContent).not.toContain('产品角色 1')
    expect(host.textContent).not.toContain('交谈：守钟人')

    await clickNavigation('角色')
    const character = host.querySelector('[aria-label="角色状态"]')
    expect(character?.textContent).toContain('守灯学徒 · 等级 1')
    expect(character?.textContent).toContain('生命')
    expect(character?.textContent).toContain('法力')
    expect(character?.textContent).toContain('基础属性')
    await closePanel()

    await clickNavigation('地图')
    const world = host.querySelector('[aria-label="区域地图"]')
    expect(world?.textContent).toContain('雾港')
    expect(world?.textContent).toContain('外海灯塔带')
    expect(world?.textContent).toContain('回声盐沼')
    expect(world?.textContent).toContain('前往')
    expect(world?.textContent).not.toContain('灯塔底层')
    expect(world?.textContent).not.toContain('灯塔核心')
    await closePanel()

    await clickNavigation('背包')
    const inventory = host.querySelector('[aria-label="背包"]')
    expect(inventory?.textContent).toContain('守灯披风')
    expect(inventory?.textContent).toContain('装备守灯披风')
    await closePanel()

    await clickNavigation('装备')
    const initialEquipment = host.querySelector('[aria-label="装备"]')
    expect(initialEquipment?.textContent).toContain('未装备')
    expect(initialEquipment?.textContent).toContain('装备守灯披风')
    await closePanel()

    await clickNavigation('任务')
    const quests = host.querySelector('[aria-label="任务"]')
    expect(quests?.textContent).toContain('主线任务')
    expect(quests?.textContent).toContain('当前阶段 · 穿越盐沼')
    expect(quests?.textContent).toContain('确认穿过盐沼的路线')
    expect(quests?.textContent).toContain('地点：回声盐沼')
    await closePanel()

    await clickNavigation('关系')
    const relationships = host.querySelector('[aria-label="人物关系"]')
    expect(relationships?.textContent).toContain('产品角色 1')
    expect(relationships?.textContent).toContain('关系由玩家行动的正式事件推进')
    await closePanel()

    await clickNavigation('显示')
    const accessibility = host.querySelector('[aria-label="阅读与可访问性"]')
    const fontScale = accessibility?.querySelector<HTMLSelectElement>('select[aria-label="正文字号"]')
    const highContrast = Array.from(accessibility?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])
      .find(input => input.parentElement?.textContent?.includes('高对比度'))
    const reducedMotion = Array.from(accessibility?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])
      .find(input => input.parentElement?.textContent?.includes('减少动态效果'))
    expect(fontScale).toBeTruthy()
    expect(highContrast).toBeTruthy()
    expect(reducedMotion).toBeTruthy()
    await act(async () => {
      if (fontScale) {
        fontScale.value = '1.3'
        fontScale.dispatchEvent(new Event('change', { bubbles: true }))
      }
      highContrast?.click()
      reducedMotion?.click()
    })
    expect(host.querySelector('[data-testid="adventure-game-player"]')?.className).toContain('adventure-high-contrast')
    expect(host.querySelector('[data-testid="adventure-game-player"]')?.className).toContain('adventure-reduced-motion')
    expect(host.querySelector<HTMLElement>('[data-testid="adventure-game-player"]')?.style.getPropertyValue('--adventure-font-scale')).toBe('1.3')
    expect(JSON.parse(localStorage.getItem('storyforge.text-adventure.accessibility') ?? '{}')).toMatchObject({
      fontScale: 1.3,
      highContrast: true,
      reducedMotion: true,
    })
    await closePanel()

    const parentResolver = useAdventureGamePlayerStore.getState().selectedMediaResolver
    expect(parentResolver).not.toBeNull()
    await act(async () => {
      await useAdventureGamePlayerStore.getState().saveCheckpoint('切换分支前')
    })
    const checkpoint = useAdventureGamePlayerStore.getState().checkpoints[0]
    let childSessionId = 0
    await act(async () => {
      childSessionId = await useAdventureGamePlayerStore.getState().forkCheckpoint(checkpoint.id!, '原子媒资分支')
    })
    const branchState = useAdventureGamePlayerStore.getState()
    expect(branchState).toMatchObject({
      selectedSessionId: childSessionId,
      selectedSourceSessionId: childSessionId,
    })
    expect(branchState.selectedMediaResolver).not.toBeNull()
    expect(branchState.selectedMediaResolver).not.toBe(parentResolver)
    await expect(branchState.selectedMediaResolver!.preload({ assetKeys: [], maximumBytes: 1024 }))
      .resolves.toMatchObject({ failures: [], usedBytes: 0 })
    await act(async () => useAdventureGamePlayerStore.getState().select(built.session.id!))

    await act(async () => root.unmount())
    const base = await readProductRuntimeStateVersion(built.session.id!)
    await commitAdventureAction({
      sessionId: built.session.id!,
      actionKey: 'action.equip.cloak',
      commandId: 'ui:equip-cloak',
      baseSequence: base.sequence,
      baseStateHash: base.stateHash,
    })
    await useAdventureGamePlayerStore.getState().select(null)
    root = createRoot(host)
    await renderPlayer()
    expect(host.querySelector('[data-testid="adventure-game-player"]')?.className).toContain('adventure-high-contrast')
    expect(host.querySelector<HTMLElement>('[data-testid="adventure-game-player"]')?.style.getPropertyValue('--adventure-font-scale')).toBe('1.3')
    await clickNavigation('装备')
    const equipment = host.querySelector('[aria-label="装备"]')
    expect(equipment?.textContent).toContain('身体')
    expect(equipment?.textContent).toContain('守灯披风')
    expect(equipment?.textContent).toContain('感知 +1')
  })
})
