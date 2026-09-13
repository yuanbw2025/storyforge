import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  generateTextOpenWorldRuntimeQuestPackagingV1,
  projectTextOpenWorldRuntimeQuestPackagingSlotV1,
  readTextOpenWorldRuntimeQuestPackagingPresentationsV1,
  TEXT_OPEN_WORLD_RUNTIME_QUEST_PACKAGING_STEP_ID_V1,
  type TextOpenWorldRuntimeQuestPackagingSlotV1,
} from '../../src/lib/open-world/runtime-quest-packaging'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

function output(slot: TextOpenWorldRuntimeQuestPackagingSlotV1, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    kind: 'region-quest-packaging',
    templateKey: slot.templateKey,
    regionKey: slot.regionKey,
    title: '雾港的一份临时委托',
    summary: '潮雾压过港边，一桩不起眼的短缺正等着旅人顺手照看。',
    introText: '海风把零散的请求吹到广场边缘。它不算惊天动地，却足以让一段寻常旅途有了落脚之处。',
    objectiveText: '留意附近能够缓解短缺的机会，再按任务记录中已经公开的步骤行动。',
    resolutionText: '事情平息后，港边紧绷的气氛终于松动了一些。',
    variantFingerprint: slot.templateFingerprint,
    referencedKeys: slot.requiredReferencedKeys,
    ...overrides,
  })
}

async function fixture(label: string) {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const director = runtimePackage.modules.director.payload as any
  director.decks[0].blankWeight = 0
  director.decks[0].randomEventKeys = []
  director.templates[0].weight = 1
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    runtimeShape: 'vnext-only',
    title: label,
    seed: `g6-quest-packaging-${label}`,
  })
  await executeTextOpenWorldActionV1({
    sessionId: created.session.id!,
    actionKey: 'action.talk-caretaker',
    targetKey: 'actor.caretaker',
    commandId: `command.packaging.${crypto.randomUUID()}`,
    requestedAt: 1_000,
  })
  const projection = (await readProductRuntimeState(created.session.id!)).textOpenWorld!
  const history = projection.state.director.history[0]
  expect(history).toMatchObject({ outcomeKind: 'template-quest', sourceKey: 'template.supplies' })
  const slot = projectTextOpenWorldRuntimeQuestPackagingSlotV1({
    runtimePackage,
    projection,
    questInstanceKey: history.questInstanceKey!,
  })!
  return { ...created, runtimePackage, projection, slot }
}

describe('R-OPEN-WORLD6 · vNext地区模板任务受治理文字包装', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只包装代码已选的模板槽，并保存只读候选与完整V3证据', async () => {
    const created = await fixture('地区任务包装')
    const beforeEvents = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()
    let prompt = ''
    const result = await generateTextOpenWorldRuntimeQuestPackagingV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      questInstanceKey: created.slot.questInstanceKey,
      runAI: async messages => {
        prompt = messages.map(message => message.content).join('\n')
        return output(created.slot)
      },
    })

    expect(prompt).toContain(created.slot.questInstanceKey)
    expect(prompt).toContain('template.supplies')
    expect(prompt).toContain(created.slot.fallback.title)
    expect(prompt).not.toContain('寻找盐晶')
    expect(result).toMatchObject({
      source: 'ai-candidate',
      status: 'generated',
      questInstanceKey: created.slot.questInstanceKey,
      questDefinitionKey: 'quest.template.supplies',
      templateKey: 'template.supplies',
      regionKey: 'region.salt-port',
      variantFingerprint: created.slot.templateFingerprint,
      referencedKeys: created.slot.requiredReferencedKeys,
    })
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(beforeEvents)
    const run = await readInstanceAgentRunV1(created.scope, result.runId)
    expect(run.projection.state).toBe('completed')
    expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    const manifest = await readContextGatewayManifestV3ForAttemptV1({
      scope: created.scope,
      runId: result.runId,
      stepId: TEXT_OPEN_WORLD_RUNTIME_QUEST_PACKAGING_STEP_ID_V1,
      attempt: 1,
    })
    expect(manifest.manifest.manifestHash).toBe(result.contextManifestHash)
    const restored = await readTextOpenWorldRuntimeQuestPackagingPresentationsV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
    })
    expect(restored[created.slot.questInstanceKey]).toEqual(result)
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.travel-port-ridge',
      targetKey: 'location.ridge-channel',
      commandId: 'command.packaging.restore-after-travel',
      requestedAt: 1_100,
    })
    const restoredAfterTravel = await readTextOpenWorldRuntimeQuestPackagingPresentationsV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
    })
    expect(restoredAfterTravel[created.slot.questInstanceKey]).toEqual(result)
    const checkpoint = await db.agentRunCheckpoints.where('runId').equals(result.runId).last()
    await db.agentRunCheckpoints.update(checkpoint!.id!, {
      resumePayloadJson: checkpoint!.resumePayloadJson!.replace(result.title, '被篡改的任务文案'),
    })
    expect(await readTextOpenWorldRuntimeQuestPackagingPresentationsV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
    })).toEqual({})
  }, 45_000)

  it('拒绝改写模板地区、伪造指纹、越界引用、规则数字、隐藏目标和原样复制预制文案', async () => {
    const created = await fixture('地区包装协议拒绝')
    const attempt = (candidate: string) => generateTextOpenWorldRuntimeQuestPackagingV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      questInstanceKey: created.slot.questInstanceKey,
      runAI: async () => candidate,
    })
    await expect(attempt(output(created.slot, { templateKey: 'template.invented' })))
      .rejects.toThrow(/不是代码选中的任务槽/)
    await expect(attempt(output(created.slot, { variantFingerprint: 'fingerprint.invented' })))
      .rejects.toThrow(/确定性模板指纹/)
    await expect(attempt(output(created.slot, { referencedKeys: [...created.slot.requiredReferencedKeys, 'item.invented'] })))
      .rejects.toThrow(/代码冻结的任务包装引用/)
    await expect(attempt(output(created.slot, { summary: '为居民收集20件物资。' })))
      .rejects.toThrow(/不得新增阿拉伯数字/)
    await expect(attempt(output(created.slot, { objectiveText: '寻找盐晶并把它送回去。' })))
      .rejects.toThrow(/未授权的冻结内容/)
    await expect(attempt(output(created.slot, {
      title: created.slot.fallback.title,
      summary: created.slot.fallback.description,
    }))).rejects.toThrow(/预制变体完全重复/)
  }, 120_000)

  it('非Director任务不开放包装，离开发牌地区后保留预制变体但不再调用模型', async () => {
    const created = await fixture('地区包装边界')
    const mainInstance = Object.values(created.projection.state.quests.instancesByKey)
      .find(item => item.definitionKey === 'quest.main.1')!
    expect(projectTextOpenWorldRuntimeQuestPackagingSlotV1({
      runtimePackage: created.runtimePackage,
      projection: created.projection,
      questInstanceKey: mainInstance.instanceKey,
    })).toBeNull()

    const away = structuredClone(created.projection)
    away.state.map.currentLocationKey = 'location.ridge-channel'
    const slot = projectTextOpenWorldRuntimeQuestPackagingSlotV1({
      runtimePackage: created.runtimePackage,
      projection: away,
      questInstanceKey: created.slot.questInstanceKey,
    })!
    expect(slot.generation).toEqual({ available: false, reason: 'left-issuance-region' })
    expect(slot.fallback).toEqual(created.slot.fallback)
  }, 45_000)

  it('模型返回前Session推进时丢弃过期候选且不影响已发任务', async () => {
    const created = await fixture('地区包装新鲜度')
    let resolve!: (value: string) => void
    const waiting = generateTextOpenWorldRuntimeQuestPackagingV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      questInstanceKey: created.slot.questInstanceKey,
      runAI: () => new Promise<string>(done => { resolve = done }),
    })
    while (!resolve) await new Promise(done => setTimeout(done, 0))
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.rest',
      commandId: 'command.packaging.advance',
      requestedAt: 1_100,
    })
    resolve(output(created.slot))
    await expect(waiting).rejects.toThrow(/运行时输入已过期|边界|已经变化/)
    const final = (await readProductRuntimeState(created.session.id!)).textOpenWorld!
    expect(final.state.quests.instancesByKey[created.slot.questInstanceKey]).toMatchObject({
      sourceKind: 'director',
      status: 'revealed',
    })
  }, 60_000)
})
