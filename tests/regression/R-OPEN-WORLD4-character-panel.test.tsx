import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldCharacterPanel from '../../src/components/text-game/TextOpenWorldCharacterPanel'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type {
  TextOpenWorldActionModuleV1,
  TextOpenWorldActorModuleV1,
  TextOpenWorldItemModuleV1,
  TextOpenWorldProgressionModuleV1,
  TextOpenWorldQuestModuleV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatActionsV1,
} from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function createCharacterUiFixture(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = downgradeTextOpenWorldFixtureCombatActionsV1(createTextOpenWorldVNextFixture())
  const actors = runtimePackage.modules.actors.payload as TextOpenWorldActorModuleV1
  const progression = runtimePackage.modules.progression.payload as TextOpenWorldProgressionModuleV1
  const actions = runtimePackage.modules.actions.payload as TextOpenWorldActionModuleV1
  const quests = runtimePackage.modules.quests.payload as TextOpenWorldQuestModuleV1
  const items = runtimePackage.modules.items.payload as TextOpenWorldItemModuleV1

  actors.player.identity.publicKnowledge = '盐港居民知道这位来客善于观察水势。'
  actors.player.identity.privateKnowledge = '私密身世不应显示'
  progression.rules.attributes.power.label = '腕力'
  progression.rules.attributes.vitality.label = '耐力'
  progression.rules.attributes.agility.label = '身法'
  progression.skills.push(
    {
      key: 'skill.canal-instinct',
      title: '守渠直觉',
      description: '长期观察水势形成的被动判断。',
      tags: ['被动'],
      activation: 'passive',
      kind: 'status',
      target: 'self',
      scalingAttribute: null,
      unlockSources: [{ kind: 'initial', level: null, questKey: null }],
      useConditionKeys: [],
      priority: 20,
      resourceCost: 0,
      cooldownTurns: 0,
      effectKeys: [],
    },
    {
      key: 'skill.hidden-reward',
      title: '藏盐术',
      description: '尚未掌握的盐晶保存技巧。',
      tags: ['秘密'],
      activation: 'active',
      kind: 'status',
      target: 'self',
      scalingAttribute: 'agility',
      unlockSources: [{ kind: 'quest', level: null, questKey: 'quest.template.supplies' }],
      useConditionKeys: [],
      priority: 15,
      resourceCost: 1,
      cooldownTurns: 1,
      effectKeys: [],
    },
  )
  progression.levels[0].unlockedSkillKeys.push('skill.canal-instinct')
  actors.player.build.learnedSkillKeys.push('skill.canal-instinct')
  actions.effects.push({
    key: 'effect.learn-hidden-reward',
    operation: 'learn-skill',
    payload: { skillKey: 'skill.hidden-reward' },
  })
  quests.quests.find(quest => quest.key === 'quest.template.supplies')!
    .rewardEffectKeys.push('effect.learn-hidden-reward')
  items.rewardContracts.find(reward => reward.key === 'reward.quest-supplies')!
    .effectKeys.push('effect.learn-hidden-reward')
  progression.statuses.push(
    {
      key: 'status.salt-burn',
      title: '盐灼',
      description: '盐尘令伤口持续刺痛。',
      polarity: 'harmful',
    },
    {
      key: 'status.unused-catalog-entry',
      title: '目录中但未生效',
      description: '这个状态定义不能因为存在于目录就显示。',
      polarity: 'neutral',
    },
  )
  return runtimePackage
}

function initialProjection(
  runtimePackage = createCharacterUiFixture(),
): TextOpenWorldSessionProjectionV1 {
  return createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
}

function sectionContaining(host: ParentNode, selector: string, text: string): HTMLElement {
  const section = Array.from(host.querySelectorAll(selector))
    .find(candidate => candidate.textContent?.includes(text))
  if (!(section instanceof HTMLElement)) throw new Error(`找不到包含“${text}”的区域`)
  return section
}

describe('Text Open World G4-07 · 角色、成长、技能与状态 UI', () => {
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

  it('使用发布内容的中文名称展示全部技能和活动状态，且不泄露内部键或隐藏任务', async () => {
    const projection = initialProjection()
    const swordInstanceId = Object.entries(projection.state.inventory.itemInstances)
      .find(([, instance]) => instance.itemKey === 'item.rust-sword')![0]
    projection.state.inventory.equippedItemInstanceIdBySlot.weapon = swordInstanceId
    projection.state.player.statusKeys = ['status.rested', 'status.salt-burn']

    await act(async () => {
      root.render(createElement(TextOpenWorldCharacterPanel, { projection }))
    })

    const panel = host.querySelector('[data-testid="text-open-world-character-panel"]')
    expect(panel).toBeInstanceOf(HTMLElement)
    const visibleText = panel!.textContent ?? ''
    expect(visibleText).toContain('腕力')
    expect(visibleText).toContain('耐力')
    expect(visibleText).toContain('身法')
    expect(visibleText).toContain('主动技能 · 攻击 · 单个敌人')
    expect(visibleText).toContain('被动技能 · 状态 · 自身')
    expect(visibleText).toContain('有益')
    expect(visibleText).toContain('有害')
    expect(visibleText).not.toContain('privateKnowledge')
    expect(visibleText).not.toContain('私密身世不应显示')
    expect(visibleText).not.toContain('短缺物资')
    expect(visibleText).not.toContain('目录中但未生效')

    const markup = panel!.outerHTML
    expect(markup).not.toMatch(/skill\.|status\.|quest\.|item\.|condition\.|effect\./)
    expect(markup).not.toContain('world-release:')
    expect(markup).not.toContain('sourceRefs')

    const attackBreakdown = sectionContaining(
      panel!,
      '[data-testid="text-open-world-character-stat-breakdown"]',
      '攻击',
    )
    expect(attackBreakdown.tagName).toBe('DETAILS')
    expect(attackBreakdown.textContent).toContain('旧盐刀')
    expect(attackBreakdown.textContent).toContain('+2')

    const active = sectionContaining(panel!, '[data-skill-state]', '挥击')
    const passive = sectionContaining(panel!, '[data-skill-state]', '守渠直觉')
    const locked = sectionContaining(panel!, '[data-skill-state]', '藏盐术')
    expect(active.textContent).toContain('当前冷却：已结束')
    expect(active.textContent).toContain('条件就绪')
    expect(passive.textContent).toContain('已掌握的被动技能')
    expect(passive.textContent).not.toContain('当前冷却')
    expect(locked.textContent).toContain('未解锁')
    expect(locked.textContent).toContain('尚未发现的任务奖励')
    expect(locked.textContent).not.toContain('当前冷却')
    expect(panel!.textContent).toContain('实际能否施放仍由战斗回合判定')
    expect(panel!.querySelectorAll('button, input, select, textarea')).toHaveLength(0)
  })

  it('满级经验固定为100%，零容量资源保持有限值，并随新投影立即刷新', async () => {
    const initial = initialProjection()
    await act(async () => {
      root.render(createElement(TextOpenWorldCharacterPanel, { projection: initial }))
    })
    expect(host.textContent).toContain('Lv.1')
    expect(host.textContent).toContain('来客')

    const maximumPackage = createCharacterUiFixture()
    const maximumActors = maximumPackage.modules.actors.payload as TextOpenWorldActorModuleV1
    const maximumProgression = maximumPackage.modules.progression.payload as TextOpenWorldProgressionModuleV1
    maximumActors.player.identity.name = '归潮者'
    maximumActors.player.build.initialLevel = 20
    maximumProgression.rules.formulas.baseSkillResource = 0
    maximumProgression.rules.formulas.skillResourcePerLevel = 0
    const maximum = initialProjection(maximumPackage)

    await act(async () => {
      root.render(createElement(TextOpenWorldCharacterPanel, { projection: maximum }))
    })

    expect(host.querySelector('[data-testid="text-open-world-character-identity"] h1')?.textContent)
      .toBe('归潮者')
    expect(host.textContent).toContain('Lv.20')
    expect(host.textContent).toContain('已达 20 级上限')
    const experience = host.querySelector(
      '[data-testid="text-open-world-character-experience"] progress',
    ) as HTMLProgressElement | null
    expect(experience).toBeInstanceOf(HTMLProgressElement)
    expect(experience!.max).toBe(100)
    expect(experience!.value).toBe(100)
    expect(experience!.getAttribute('aria-label')).toBe('等级经验进度 100%')

    const skillResource = Array.from(host.querySelectorAll(
      '[data-testid="text-open-world-character-resources"] > div > div',
    )).find(candidate => candidate.textContent?.includes('技能资源'))
    expect(skillResource).toBeInstanceOf(HTMLDivElement)
    expect(skillResource!.textContent).toContain('0/0')
    const resourceProgress = skillResource!.querySelector('progress') as HTMLProgressElement
    expect(resourceProgress.max).toBe(1)
    expect(resourceProgress.value).toBe(0)
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/)
  })
})
