import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  generateTextOpenWorldRuntimeIntentV1,
  TEXT_OPEN_WORLD_RUNTIME_INTENT_STEP_ID_V1,
} from '../../src/lib/open-world/runtime-intent'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

function output(input: {
  kind: 'dialogue-only' | 'mapped-action' | 'mapped-choice' | 'unsupported'
  confidence?: number
  actionKeys?: string[]
  choiceKeys?: string[]
  targetKey?: string | null
  replyText?: string
}) {
  return JSON.stringify({
    kind: input.kind,
    confidence: input.confidence ?? 0.98,
    actionKeys: input.actionKeys ?? [],
    choiceKeys: input.choiceKeys ?? [],
    extractedArguments: { targetKey: input.targetKey ?? null },
    rationale: '只从当前受治理闭集中选择。',
    requiresConfirmation: false,
    boundaryExplanation: input.kind === 'unsupported' ? '当前没有对应行动。' : null,
    replyText: input.replyText ?? '我理解了你的意思。',
  })
}

async function fixture(label: string) {
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
    runtimeShape: 'vnext-only',
    title: label,
    seed: `g6-intent-${label}`,
  })
}

describe('R-OPEN-WORLD6 · vNext 自然语言意图映射', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('把高置信度唯一Choice映射为低风险Action，并以V3证据和可移植命令来源闭环', async () => {
    const created = await fixture('唯一意图')
    let capturedPrompt = ''
    const result = await generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.offer.main',
      utterance: '我愿意帮她查清盐渠为什么断流',
      runAI: async messages => {
        capturedPrompt = messages.map(message => message.content).join('\n')
        return output({ kind: 'mapped-choice', choiceKeys: ['choice.accept-main'] })
      },
    })

    expect(capturedPrompt).toContain('choice.accept-main')
    expect(capturedPrompt).toContain('玩家原始输入')
    expect(result).toMatchObject({
      status: 'mapped',
      baseSequence: expect.any(Number),
      options: [{
        selectedKind: 'choice',
        selectedKey: 'choice.accept-main',
        actionKey: 'action.accept-main',
        confirmationRequired: false,
      }],
    })
    const run = await readInstanceAgentRunV1(created.scope, result.runId)
    expect(run.projection.state).toBe('completed')
    expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    const manifest = await readContextGatewayManifestV3ForAttemptV1({
      scope: created.scope,
      runId: result.runId,
      stepId: TEXT_OPEN_WORLD_RUNTIME_INTENT_STEP_ID_V1,
      attempt: 1,
    })
    expect(manifest.manifest.manifestHash).toBe(result.contextManifestHash)

    const option = result.options[0]!
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: option.actionKey,
      targetKey: option.targetKey,
      source: 'mapped-intent',
      expectedBaseSequence: result.baseSequence,
      runtimeIntentAuthorization: option.authorization,
      commandId: 'command.g6.intent.accept',
      requestedAt: 2_000,
    })
    expect(feedback.phase).toBe('terminal')
    const commandEvent = (await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).toArray())
      .find(event => event.type === 'text-open-world.command.committed'
        && JSON.parse(event.payloadJson).envelope.commandId === 'command.g6.intent.accept')!
    const envelope = JSON.parse(commandEvent.payloadJson).envelope
    expect(envelope.source).toBe('mapped-intent')
    expect(envelope.payload.runtimeIntent).toMatchObject({
      schema: 'storyforge.text-open-world.runtime-intent-evidence',
      candidateHash: result.candidateHash,
      contextManifestHash: result.contextManifestHash,
      selectedKind: 'choice',
      selectedKey: 'choice.accept-main',
      actionKey: 'action.accept-main',
    })
    expect(JSON.stringify(envelope.payload.runtimeIntent)).not.toContain('runId')
  }, 45_000)

  it('多种合法解释不写玩家状态，并为每个Action提供显式选择', async () => {
    const created = await fixture('多义意图')
    const before = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()
    const result = await generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.offer.main',
      utterance: '我可以答应她，也可能趁机拿走药剂',
      runAI: async () => output({
        kind: 'mapped-action',
        actionKeys: ['action.accept-main', 'action.steal-tonic'],
      }),
    })
    expect(result.status).toBe('needs-selection')
    expect(result.options.map(option => option.actionKey)).toEqual([
      'action.accept-main',
      'action.steal-tonic',
    ])
    expect(result.options.find(option => option.actionKey === 'action.steal-tonic')?.confirmationRequired).toBe(true)
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).count()).toBe(before)
  }, 45_000)

  it('高风险映射仍由Action权威要求二次确认，篡改授权或过期边界均拒绝', async () => {
    const created = await fixture('高风险意图')
    const result = await generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.actor.caretaker',
      utterance: '趁她不注意把药剂拿走',
      runAI: async () => output({ kind: 'mapped-action', actionKeys: ['action.steal-tonic'] }),
    })
    const option = result.options[0]!
    expect(option.confirmationRequired).toBe(true)
    const preflight = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: option.actionKey,
      targetKey: option.targetKey,
      source: 'mapped-intent',
      expectedBaseSequence: result.baseSequence,
      runtimeIntentAuthorization: option.authorization,
      commandId: 'command.g6.intent.steal',
    })
    expect(preflight).toMatchObject({ phase: 'preflight', status: 'confirmation-required' })

    const forged = structuredClone(option.authorization)
    forged.actionKey = 'action.deceive-caretaker'
    await expect(executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.deceive-caretaker',
      targetKey: 'actor.caretaker',
      source: 'mapped-intent',
      expectedBaseSequence: result.baseSequence,
      runtimeIntentAuthorization: forged,
      commandId: 'command.g6.intent.forged',
    })).rejects.toThrow(/intentAuthorization hash不匹配/)

    const committed = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: option.actionKey,
      targetKey: option.targetKey,
      source: 'mapped-intent',
      confirmed: true,
      expectedBaseSequence: result.baseSequence,
      runtimeIntentAuthorization: option.authorization,
      commandId: 'command.g6.intent.steal',
    })
    expect(committed.phase).toBe('terminal')
    await expect(executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: option.actionKey,
      targetKey: option.targetKey,
      source: 'mapped-intent',
      confirmed: true,
      expectedBaseSequence: result.baseSequence,
      runtimeIntentAuthorization: option.authorization,
      commandId: 'command.g6.intent.stale-new',
    })).rejects.toThrow(/已经变化|已变化/)
  }, 45_000)

  it('低置信度、越界键和协议扩字段都不能提交候选行动', async () => {
    const created = await fixture('拒绝错误映射')
    const low = await generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.offer.main',
      utterance: '也许看看再说',
      runAI: async () => output({
        kind: 'mapped-action',
        confidence: 0.4,
        actionKeys: ['action.accept-main'],
      }),
    })
    expect(low).toMatchObject({ status: 'low-confidence', options: [] })

    let invalidRunId = 0
    await expect(generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.offer.main',
      utterance: '直接传送到最终结局',
      onRunCreated: runId => { invalidRunId = runId },
      runAI: async () => output({ kind: 'mapped-action', actionKeys: ['action.finish-ending'] }),
    })).rejects.toThrow(/候选Action不在当前场景闭集/)
    expect((await readInstanceAgentRunV1(created.scope, invalidRunId)).projection.state).toBe('failed')

    await expect(generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.offer.main',
      utterance: '接受任务',
      runAI: async () => JSON.stringify({
        ...JSON.parse(output({ kind: 'mapped-action', actionKeys: ['action.accept-main'] })),
        inventedResult: '任务已经完成',
      }),
    })).rejects.toThrow(/字段不在允许闭集/)
  }, 60_000)
})
