import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldCombatPanel from '../../src/components/text-game/TextOpenWorldCombatPanel'
import type {
  TextOpenWorldPlayerCombatActionV1,
  TextOpenWorldPlayerCombatProjectionV1,
} from '../../src/lib/open-world/player-combat'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function action(
  input: Partial<TextOpenWorldPlayerCombatActionV1>
    & Pick<TextOpenWorldPlayerCombatActionV1, 'actionKey' | 'group' | 'label' | 'targetMode'>,
): TextOpenWorldPlayerCombatActionV1 {
  return {
    description: `${input.label}的公开说明`,
    available: true,
    unavailableReasons: [],
    resourceCost: 0,
    cooldownTurns: 0,
    cooldownRemainingTurns: 0,
    quantity: null,
    effectDetails: [],
    validEnemyTargetKeys: [],
    fixedTargetKey: null,
    confirmationRequired: false,
    ...input,
  }
}

function combatProjection(): TextOpenWorldPlayerCombatProjectionV1 {
  return {
    schema: 'storyforge.text-open-world.player-combat-projection',
    version: 1,
    operationIdentity: {
      sessionId: 41,
      combatInstanceKey: 'combat.private.41',
      expectedBaseSequence: 7,
    },
    mode: 'active',
    compatibility: {
      readOnly: false,
      turnState: true,
      formalActions: true,
      numericResolution: true,
      automaticReward: true,
      notice: null,
    },
    encounter: {
      title: '盐鬣犬伏击',
      description: '两只盐鬣犬封住渠口。',
      openingText: '碎盐从坡上滚落，敌人已经逼近。',
      recommendedLevel: 2,
      intensityLabel: '危险遭遇',
    },
    phase: {
      statusLabel: '战斗进行中',
      phaseLabel: '行动阶段',
      round: 2,
      actorLabel: '来客',
      playerTurn: true,
      waitingForSettlement: false,
    },
    player: {
      combatantKey: 'player.private',
      label: '来客',
      description: null,
      level: 2,
      currentHealth: 27,
      maximumHealth: 37,
      healthRatio: 27 / 37,
      defeated: false,
      activeActor: true,
      skillResource: 1,
      maximumSkillResource: 5,
      statuses: [{
        title: '振奋', description: '下一次行动更加稳定。', polarity: 'beneficial', stacks: 2, remainingTurns: 1,
        effectDetails: ['攻击 +2', '剩余 1 个自身行动'],
      }],
    },
    enemies: [
      {
        combatantKey: 'enemy.private.1',
        label: '盐鬣犬 1',
        description: '前腿受伤，但仍能行动。',
        level: 1,
        currentHealth: 4,
        maximumHealth: 12,
        healthRatio: 1 / 3,
        defeated: false,
        activeActor: false,
        statuses: [{
          title: '流血', description: '持续受到伤害。', polarity: 'harmful', stacks: 1, remainingTurns: 2,
          effectDetails: ['防御 -1', '剩余 2 个自身行动'],
        }],
      },
      {
        combatantKey: 'enemy.private.2',
        label: '盐鬣犬 2',
        description: '正守住退路。',
        level: 1,
        currentHealth: 12,
        maximumHealth: 12,
        healthRatio: 1,
        defeated: false,
        activeActor: false,
        statuses: [],
      },
    ],
    actions: [
      action({
        actionKey: 'action.private.attack',
        group: 'attack',
        label: '挥击',
        targetMode: 'single-enemy',
        validEnemyTargetKeys: ['enemy.private.1', 'enemy.private.2'],
      }),
      action({
        actionKey: 'action.private.skill',
        group: 'skill',
        label: '盐风重击',
        targetMode: 'single-enemy',
        available: false,
        unavailableReasons: ['技能冷却中，还需 2 回合。', '技能资源不足：需要 3 点，当前有 1 点。'],
        resourceCost: 3,
        cooldownTurns: 2,
        cooldownRemainingTurns: 2,
        effectDetails: ['伤害基础：力量 × 3/2 + 技能威力'],
        validEnemyTargetKeys: ['enemy.private.1', 'enemy.private.2'],
      }),
      action({
        actionKey: 'action.private.item',
        group: 'item',
        label: '盐露药剂',
        targetMode: 'fixed-item',
        available: false,
        unavailableReasons: ['背包中没有可使用的该道具。'],
        quantity: 0,
        fixedTargetKey: 'item.private.tonic',
      }),
      action({
        actionKey: 'action.private.escape',
        group: 'escape',
        label: '寻找退路',
        targetMode: 'none',
      }),
    ],
    log: [{
      id: 'combat-log:41:6',
      eventSequence: 6,
      round: 1,
      actorLabel: '盐鬣犬 1',
      actionLabel: '撕咬',
      summary: '盐鬣犬 1 发动撕咬，来客受到 3 点伤害。',
      details: ['来客：生命 30 → 27'],
      tone: 'enemy',
    }],
    result: { status: 'none', title: null, text: null },
    reward: { status: 'not-applicable', title: null, items: [], eventSequence: null },
    recovery: { retryAvailable: false, retryUnavailableReason: null, respawnActions: [] },
  }
}

function buttonContaining(host: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${text}`)
  return button
}

describe('Text Open World G4-09 · 逐回合玩家战斗 UI', () => {
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

  it('展示四组操作且必须显式选择存活敌人，再提交完整 Session 与事件基线', async () => {
    const projection = combatProjection()
    const onExecute = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldCombatPanel, {
        projection, busy: false, onExecute, onRetry: vi.fn(), onDismissResult: vi.fn(),
      }))
      await Promise.resolve()
    })

    expect(Array.from(host.querySelectorAll('[data-action-group]')).map(group => (
      group.getAttribute('data-action-group')
    ))).toEqual(['attack', 'skill', 'item', 'escape'])
    expect(host.textContent).toContain('普通攻击')
    expect(host.textContent).toContain('技能')
    expect(host.textContent).toContain('道具')
    expect(host.textContent).toContain('逃跑')

    const attack = buttonContaining(host, '挥击')
    expect(attack.disabled).toBe(true)
    expect(host.querySelector(`#${attack.getAttribute('aria-describedby')}`)?.textContent)
      .toContain('请先选择一名仍可行动的敌人')
    expect(onExecute).not.toHaveBeenCalled()

    const secondEnemy = host.querySelectorAll<HTMLInputElement>('input[name="text-open-world-combat-target"]')[1]!
    await act(async () => secondEnemy.click())
    expect(secondEnemy.checked).toBe(true)
    expect(attack.disabled).toBe(false)
    await act(async () => attack.click())
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(onExecute).toHaveBeenCalledWith({
      sessionId: 41,
      combatInstanceKey: 'combat.private.41',
      expectedBaseSequence: 7,
      actionKey: 'action.private.attack',
      targetKey: 'enemy.private.2',
    })
    expect(host.textContent).not.toMatch(/combat\.private|action\.private|enemy\.private|item\.private/)

    const nextCombat = structuredClone(projection)
    nextCombat.operationIdentity = {
      sessionId: 42,
      combatInstanceKey: 'combat.private.42',
      expectedBaseSequence: 9,
    }
    await act(async () => {
      root.render(createElement(TextOpenWorldCombatPanel, {
        projection: nextCombat, busy: false, onExecute, onRetry: vi.fn(), onDismissResult: vi.fn(),
      }))
      await Promise.resolve()
    })
    expect(buttonContaining(host, '挥击').disabled).toBe(true)
    expect(host.querySelector<HTMLInputElement>('input[name="text-open-world-combat-target"]:checked')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('#text-open-world-combat-title'))
  })

  it('公开资源、冷却、数量、状态和不可用原因，并只播报挂载后新增的正式日志', async () => {
    const projection = combatProjection()
    const onExecute = vi.fn()
    const render = async (value: TextOpenWorldPlayerCombatProjectionV1) => {
      await act(async () => {
        root.render(createElement(TextOpenWorldCombatPanel, {
          projection: value, busy: false, onExecute, onRetry: vi.fn(), onDismissResult: vi.fn(),
        }))
        await Promise.resolve()
      })
    }
    await render(projection)

    const liveRegion = host.querySelector('.open-world-game-live-announcement')!
    expect(liveRegion.textContent).toBe('')
    const skill = buttonContaining(host, '盐风重击')
    const item = buttonContaining(host, '盐露药剂')
    expect(skill.disabled).toBe(true)
    expect(item.disabled).toBe(true)
    expect(skill.textContent).toContain('消耗 3 点技能资源')
    expect(skill.textContent).toContain('冷却 2 回合')
    expect(skill.textContent).toContain('剩余 2 回合')
    expect(skill.textContent).toContain('伤害基础：力量 × 3/2 + 技能威力')
    expect(host.querySelector(`#${skill.getAttribute('aria-describedby')}`)?.textContent)
      .toContain('技能资源不足：需要 3 点，当前有 1 点')
    expect(item.textContent).toContain('持有 0')
    expect(host.querySelector(`#${item.getAttribute('aria-describedby')}`)?.textContent)
      .toContain('背包中没有可使用的该道具')
    expect(host.querySelector('[aria-label="玩家状态"]')?.textContent).toContain('振奋 ×2 · 1 回合')
    expect(host.querySelector('[aria-label="振奋；攻击 +2；剩余 1 个自身行动"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="盐鬣犬 1的状态"]')?.textContent).toContain('流血 · 2 回合')

    const advanced = structuredClone(projection)
    advanced.log.push({
      id: 'combat-log:41:8',
      eventSequence: 8,
      round: 2,
      actorLabel: '来客',
      actionLabel: '挥击',
      summary: '来客使用挥击，对盐鬣犬 2 造成 5 点伤害。',
      details: ['盐鬣犬 2：生命 12 → 7'],
      tone: 'player',
    })
    advanced.operationIdentity.expectedBaseSequence = 8
    await render(advanced)
    expect(liveRegion.textContent).toBe('来客使用挥击，对盐鬣犬 2 造成 5 点伤害。')
    expect(onExecute).not.toHaveBeenCalled()
  })

  it('同步与旧版只读状态失败关闭；胜利奖励、战前重试和安全复活各走明确按钮', async () => {
    const onExecute = vi.fn()
    const onRetry = vi.fn()
    const onDismissResult = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldCombatPanel, {
        projection: null,
        synchronizing: true,
        busy: false,
        onExecute,
        onRetry,
        onDismissResult,
      }))
    })
    const synchronizing = host.querySelector('[data-testid="text-open-world-combat-panel"]')!
    expect(synchronizing.getAttribute('role')).toBe('status')
    expect(synchronizing.getAttribute('aria-live')).toBe('polite')
    expect(synchronizing.textContent).toContain('战斗记录核对中')
    expect(host.querySelector('button')).toBeNull()

    const legacy = combatProjection()
    legacy.mode = 'legacy'
    legacy.compatibility = {
      readOnly: true,
      turnState: false,
      formalActions: false,
      numericResolution: false,
      automaticReward: false,
      notice: '旧版战斗仅可查看，不会伪造逐回合操作。',
    }
    await act(async () => {
      root.render(createElement(TextOpenWorldCombatPanel, {
        projection: legacy, busy: false, onExecute, onRetry, onDismissResult,
      }))
    })
    expect(host.querySelector('[role="note"]')?.textContent).toContain('旧版战斗仅可查看')
    expect(host.querySelector('[aria-label="战斗操作"]')).toBeNull()
    expect(host.querySelector('input[name="text-open-world-combat-target"]')).toBeNull()

    const victory = combatProjection()
    victory.mode = 'victory'
    victory.phase.statusLabel = '战斗胜利'
    victory.result = { status: 'victory', title: '战斗胜利', text: '盐鬣犬已经退散。' }
    victory.reward = {
      status: 'granted',
      title: '遭遇奖励',
      items: [
        { kind: 'experience', label: '经验 +25' },
        { kind: 'item', label: '盐晶 × 2' },
      ],
      eventSequence: 9,
    }
    await act(async () => {
      root.render(createElement(TextOpenWorldCombatPanel, {
        projection: victory, busy: false, onExecute, onRetry, onDismissResult,
      }))
    })
    expect(host.querySelector('[data-testid="text-open-world-combat-result"]')?.textContent)
      .toContain('经验 +25')
    expect(host.querySelector('[data-testid="text-open-world-combat-result"]')?.textContent)
      .toContain('盐晶 × 2')
    await act(async () => buttonContaining(host, '返回当前场景').click())
    expect(onDismissResult).toHaveBeenCalledTimes(1)

    const defeat = combatProjection()
    defeat.mode = 'defeat'
    defeat.phase.statusLabel = '战斗失败'
    defeat.result = { status: 'defeat', title: '你倒下了', text: '仍可从战前分支或安全点继续。' }
    defeat.recovery = {
      retryAvailable: true,
      retryUnavailableReason: null,
      respawnActions: [{
        actionKey: 'action.private.respawn',
        title: '在盐港广场复活',
        available: true,
        unavailableReasons: [],
      }],
    }
    await act(async () => {
      root.render(createElement(TextOpenWorldCombatPanel, {
        projection: defeat, busy: false, onExecute, onRetry, onDismissResult,
      }))
    })
    const recovery = host.querySelector('[data-testid="text-open-world-defeat-recovery"]')!
    expect(recovery.textContent).toContain('失败时间线')
    expect(recovery.textContent).toContain('不会使主线失败')
    await act(async () => buttonContaining(recovery, '战前重试').click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    await act(async () => buttonContaining(recovery, '在盐港广场复活').click())
    expect(onExecute).toHaveBeenLastCalledWith({
      sessionId: 41,
      combatInstanceKey: 'combat.private.41',
      expectedBaseSequence: 7,
      actionKey: 'action.private.respawn',
      targetKey: null,
    })
  })
})
