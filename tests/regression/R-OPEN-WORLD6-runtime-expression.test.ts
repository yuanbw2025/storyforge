import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  generateTextOpenWorldRuntimeExpressionV1,
  TEXT_OPEN_WORLD_RUNTIME_EXPRESSION_STEP_ID_V1,
} from '../../src/lib/open-world/runtime-expression'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { TextOpenWorldFeedbackReceiptV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

function output(
  receipt: TextOpenWorldFeedbackReceiptV1,
  kind: 'scene' | 'combat' | 'quest' | 'system',
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    kind,
    text: kind === 'combat'
      ? '盐鬣犬扑入近前，交锋的结果已经落定。'
      : kind === 'quest'
        ? '委托已经记入旅程，接下来的目标由任务记录给出。'
        : '旧渠边的痕迹被重新检查，时间也随行动向前流动。',
    dialogue: '',
    evidenceEventSequences: receipt.evidenceEventSequences,
    assertedReferences: [
      { kind: 'action', key: receipt.actionKey },
      { kind: 'outcome', key: `outcome.${receipt.status}` },
    ],
    ...overrides,
  })
}

async function fixture(label: string, combatAtPort = false) {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  if (combatAtPort) {
    const actions = runtimePackage.modules.actions.payload as any
    const combat = runtimePackage.modules.combat.payload as any
    actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
    combat.encounters[0].locationKey = 'location.salt-port'
  }
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    runtimeShape: 'vnext-only',
    title: label,
    seed: `g6-expression-${label}`,
  })
}

describe('R-OPEN-WORLD6 · vNext终态结果受治理演绎', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只读取指定终态回执，以只读候选和V3证据演绎场景结果', async () => {
    const created = await fixture('场景结果')
    const receipt = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.investigate-channel',
      targetKey: 'location.salt-port',
      commandId: 'command.expression.investigate',
      requestedAt: 1_000,
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.rest',
      commandId: 'command.expression.other',
      requestedAt: 1_100,
    })
    const beforeEvents = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()
    let prompt = ''
    const result = await generateTextOpenWorldRuntimeExpressionV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      receipt,
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return output(receipt, 'scene')
      },
    })

    expect(prompt).toContain('command.expression.investigate')
    expect(prompt).toContain(receipt.receiptHash)
    expect(prompt).toContain('effect.investigate-time')
    expect(prompt).not.toContain('command.expression.other')
    expect(result).toMatchObject({
      status: 'generated',
      commandId: 'command.expression.investigate',
      receiptHash: receipt.receiptHash,
      kind: 'scene',
      dialogue: '',
      evidenceEventSequences: receipt.evidenceEventSequences,
    })
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(beforeEvents)
    const run = await readInstanceAgentRunV1(created.scope, result.runId)
    expect(run.projection.state).toBe('completed')
    expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    const manifest = await readContextGatewayManifestV3ForAttemptV1({
      scope: created.scope,
      runId: result.runId,
      stepId: TEXT_OPEN_WORLD_RUNTIME_EXPRESSION_STEP_ID_V1,
      attempt: 1,
    })
    expect(manifest.manifest.manifestHash).toBe(result.contextManifestHash)
  }, 45_000)

  it('由Action与Effect确定性区分任务结果和战斗结果', async () => {
    const questCreated = await fixture('任务结果')
    const questState = (await readProductRuntimeState(questCreated.session.id!)).textOpenWorld!
    const mainInstanceKey = Object.values(questState.state.quests.instancesByKey)
      .find(instance => instance.definitionKey === 'quest.main.1')!.instanceKey
    const questReceipt = await executeTextOpenWorldActionV1({
      sessionId: questCreated.session.id!,
      actionKey: 'action.accept-main',
      targetKey: mainInstanceKey,
      commandId: 'command.expression.quest',
      requestedAt: 1_000,
    })
    await expect(generateTextOpenWorldRuntimeExpressionV1({
      scope: questCreated.scope,
      productRuntimeSessionId: questCreated.session.id!,
      receipt: questReceipt,
      runAI: async () => output(questReceipt, 'quest'),
    })).resolves.toMatchObject({ kind: 'quest' })

    await db.delete(); await db.open()
    const combatCreated = await fixture('战斗结果', true)
    const combatReceipt = await executeTextOpenWorldActionV1({
      sessionId: combatCreated.session.id!,
      actionKey: 'action.start-ridge-jackal',
      targetKey: 'encounter.ridge-jackal',
      commandId: 'command.expression.combat',
      requestedAt: 1_000,
    })
    await expect(generateTextOpenWorldRuntimeExpressionV1({
      scope: combatCreated.scope,
      productRuntimeSessionId: combatCreated.session.id!,
      receipt: combatReceipt,
      runAI: async () => output(combatReceipt, 'combat'),
    })).resolves.toMatchObject({ kind: 'combat' })
  }, 60_000)

  it('拒绝错误类型、额外事件、越界引用、角色对白、未证明数字和扩字段', async () => {
    const created = await fixture('演绎协议拒绝')
    const receipt = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.investigate-channel',
      targetKey: 'location.salt-port',
      commandId: 'command.expression.protocol',
      requestedAt: 1_000,
    })
    const attempt = (candidate: string) => generateTextOpenWorldRuntimeExpressionV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      receipt,
      runAI: async () => candidate,
    })
    await expect(attempt(output(receipt, 'quest'))).rejects.toThrow(/确定性Action\/Effect分类/)
    await expect(attempt(output(receipt, 'scene', {
      evidenceEventSequences: [...receipt.evidenceEventSequences, 999],
    }))).rejects.toThrow(/只能引用本次终态回执/)
    await expect(attempt(output(receipt, 'scene', {
      assertedReferences: [
        { kind: 'action', key: receipt.actionKey },
        { kind: 'outcome', key: `outcome.${receipt.status}` },
        { kind: 'effect', key: 'effect.invented-reward' },
      ],
    }))).rejects.toThrow(/终态回执之外/)
    await expect(attempt(output(receipt, 'scene', { dialogue: '岑阿婆说任务已经完成。' })))
      .rejects.toThrow(/不得借结果演绎生成角色对白/)
    await expect(attempt(output(receipt, 'scene', { text: '你额外获得了99999枚金币。' })))
      .rejects.toThrow(/没有证明的数字/)
    await expect(attempt(output(receipt, 'scene', { inventedReward: true })))
      .rejects.toThrow(/字段不在允许闭集/)
  }, 90_000)

  it('篡改回执或Session在模型返回前推进时失败关闭', async () => {
    const created = await fixture('演绎新鲜度')
    const receipt = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.investigate-channel',
      targetKey: 'location.salt-port',
      commandId: 'command.expression.stale',
      requestedAt: 1_000,
    })
    await expect(generateTextOpenWorldRuntimeExpressionV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      receipt: { ...receipt, presentation: { ...receipt.presentation, headline: '伪造结果' } },
      runAI: async () => output(receipt, 'scene'),
    })).rejects.toThrow(/receiptHash不匹配/)

    let resolve!: (value: string) => void
    const waiting = generateTextOpenWorldRuntimeExpressionV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      receipt,
      runAI: () => new Promise<string>(done => { resolve = done }),
    })
    while (!resolve) await new Promise(done => setTimeout(done, 0))
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.rest',
      commandId: 'command.expression.advance',
      requestedAt: 1_100,
    })
    resolve(output(receipt, 'scene'))
    await expect(waiting).rejects.toThrow(/运行时输入已过期|边界|已经变化/)
  }, 60_000)
})
