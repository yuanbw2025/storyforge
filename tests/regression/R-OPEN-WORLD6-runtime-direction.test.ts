import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldDirectorCatalogV1 } from '../../src/lib/open-world/director'
import {
  TEXT_OPEN_WORLD_RUNTIME_DIRECTION_STEP_ID_V1,
  type TextOpenWorldRuntimeDirectionOutcomeV1,
} from '../../src/lib/open-world/runtime-direction'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent, TextOpenWorldRandomEvidenceV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

function directionOutput(candidateKey: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    kind: 'recommend',
    candidateKey,
    rationale: '近期已有资源型委托，先用一段地区线索维持变化并避免重复。',
    pacingTags: ['regional-flavor', 'variety'],
    conflictKeys: [],
    mainlineSafe: true,
    ...overrides,
  })
}

function appliedDirectorAuthorization(events: ProductRuntimeEvent[]) {
  return events.filter(event => event.type === 'text-open-world.effects.applied')
    .map(event => JSON.parse(event.payloadJson).plan.authorization)
    .find(authorization => authorization?.kind === 'director-settlement')
}

function evidenceFor(
  requests: Array<{ drawKey: string; minimumInclusive: number; maximumInclusive: number }>,
  firstValue: number,
): TextOpenWorldRandomEvidenceV1[] {
  return requests.map((request, drawIndex) => ({
    ...request,
    algorithm: 'sha256-range-v1',
    seedHash: '1'.repeat(64),
    inputHash: '2'.repeat(64),
    drawIndex,
    value: drawIndex === 0 ? firstValue : request.minimumInclusive,
  }))
}

async function fixture(label: string) {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const director = runtimePackage.modules.director.payload as any
  director.decks[0].blankWeight = 0
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    runtimeShape: 'vnext-only',
    title: label,
    seed: `g6-direction-${label}`,
  })
}

describe('R-OPEN-WORLD6 · 受治理叙事导演建议与主线保护', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只在代码已判定的非空合法闭集中采用一次建议，并保存可验V3证据和可重放授权', async () => {
    const created = await fixture('导演合法采用')
    const runAI = vi.fn(async messages => {
      const prompt = messages.map(message => message.content).join('\n')
      expect(prompt).toContain('template.supplies')
      expect(prompt).toContain('event.channel-rumor')
      expect(prompt).toContain('wait-without-mainline-pressure')
      expect(prompt).not.toContain('确定性随机种子')
      return directionOutput('event.channel-rumor')
    })
    let outcome: TextOpenWorldRuntimeDirectionOutcomeV1 | null = null
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.talk-caretaker',
      targetKey: 'actor.caretaker',
      commandId: 'command.direction.adopted',
      requestedAt: 1_000,
      runtimeDirectionRunAI: runAI,
      onRuntimeDirectionOutcome: value => { outcome = value },
    })

    expect(feedback).toMatchObject({ phase: 'terminal', status: 'succeeded' })
    expect(runAI).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({
      status: 'adopted',
      trigger: 'talk',
      recommendedCandidateKey: 'event.channel-rumor',
      selectedCandidateKey: 'event.channel-rumor',
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const authorization = appliedDirectorAuthorization(events)
    expect(authorization.selection).toMatchObject({
      outcomeKind: 'random-event',
      sourceKey: 'event.channel-rumor',
    })
    expect(authorization.selection.reason).toMatch(/^runtime-direction-v1\|/)
    const final = await readProductRuntimeState(created.session.id!)
    expect(replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), events)).toEqual(final)

    const runs = await db.agentRuns.where('productRuntimeSessionId').equals(created.session.id!).toArray()
    expect(runs).toHaveLength(1)
    const run = await readInstanceAgentRunV1(created.scope, runs[0].id!)
    expect(run.projection).toMatchObject({ state: 'completed' })
    const manifest = await readContextGatewayManifestV3ForAttemptV1({
      scope: created.scope,
      runId: runs[0].id!,
      stepId: TEXT_OPEN_WORLD_RUNTIME_DIRECTION_STEP_ID_V1,
      attempt: 1,
    })
    expect(manifest.manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/)
  }, 45_000)

  it('确定性Blank门槛先于AI建议，模型不能把空结果改成任务或事件', () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const director = createTextOpenWorldDirectorCatalogV1(runtimePackage)
    const conditionResults = { 'condition.always': true, 'condition.level-two': false }
    const requests = director.randomRequestsFor({ state: projection.state, trigger: 'talk', conditionResults })
    const authorization = director.resolve({
      state: projection.state,
      trigger: 'talk',
      conditionResults,
      evidence: evidenceFor(requests, 1),
      advice: {
        version: 1,
        source: 'runtime-direction',
        candidateKey: 'event.channel-rumor',
        candidateHash: 'a'.repeat(64),
        contextManifestHash: 'b'.repeat(64),
        terminalReceiptHash: 'c'.repeat(64),
      },
    })
    expect(authorization.selection).toMatchObject({ outcomeKind: 'blank', reason: 'blank-weight' })
  })

  it('越界、冲突或不安全模型输出会失败关闭，但玩家行动与原确定性Director仍成功', async () => {
    const created = await fixture('导演失败降级')
    let outcome: TextOpenWorldRuntimeDirectionOutcomeV1 | null = null
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.talk-caretaker',
      targetKey: 'actor.caretaker',
      commandId: 'command.direction.fallback',
      requestedAt: 1_000,
      runtimeDirectionRunAI: async () => directionOutput('quest.main.1', { mainlineSafe: false }),
      onRuntimeDirectionOutcome: value => { outcome = value },
    })
    expect(feedback).toMatchObject({ phase: 'terminal', status: 'succeeded' })
    expect(outcome).toMatchObject({ status: 'deterministic-fallback', trigger: 'talk' })
    const events = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const authorization = appliedDirectorAuthorization(events)
    expect(authorization.selection.reason).not.toMatch(/^runtime-direction-v1\|/)
    const runs = await db.agentRuns.where('productRuntimeSessionId').equals(created.session.id!).toArray()
    expect(runs).toHaveLength(1)
    expect((await readInstanceAgentRunV1(created.scope, runs[0].id!)).projection.state).toBe('failed')
  }, 45_000)

  it('AI返回blank只表示不偏置，不能覆盖代码已通过的非空选择', async () => {
    const created = await fixture('导演不偏置')
    let outcome: TextOpenWorldRuntimeDirectionOutcomeV1 | null = null
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.talk-caretaker',
      targetKey: 'actor.caretaker',
      commandId: 'command.direction.no-bias',
      requestedAt: 1_000,
      runtimeDirectionRunAI: async () => JSON.stringify({
        kind: 'blank',
        candidateKey: null,
        rationale: '当前合法候选节奏接近，不额外偏置。',
        pacingTags: ['variety'],
        conflictKeys: [],
        mainlineSafe: true,
      }),
      onRuntimeDirectionOutcome: value => { outcome = value },
    })

    expect(feedback).toMatchObject({ phase: 'terminal', status: 'succeeded' })
    expect(outcome).toMatchObject({
      status: 'no-bias',
      trigger: 'talk',
      recommendedCandidateKey: null,
    })
    const events = await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).sortBy('sequence')
    const authorization = appliedDirectorAuthorization(events)
    expect(authorization.selection).toMatchObject({ reason: 'weighted-selection' })
    expect(authorization.selection.outcomeKind).not.toBe('blank')
  }, 45_000)

  it('候选不足或代码抽到Blank时不调用模型，也不创建伪Director Run', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    ;(runtimePackage.modules.director.payload as any).decks[0].blankWeight = 0
    ;(runtimePackage.modules.director.payload as any).decks[0].randomEventKeys = []
    const single = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `导演单候选-${crypto.randomUUID()}`,
      textOpenWorldVNext: runtimePackage,
      runtimeShape: 'vnext-only',
      title: '导演单候选',
      seed: 'g6-direction-single',
    })
    const runAI = vi.fn(async () => directionOutput('template.supplies'))
    await executeTextOpenWorldActionV1({
      sessionId: single.session.id!,
      actionKey: 'action.talk-caretaker',
      targetKey: 'actor.caretaker',
      commandId: 'command.direction.single',
      requestedAt: 1_000,
      runtimeDirectionRunAI: runAI,
    })
    expect(runAI).not.toHaveBeenCalled()
    expect(await db.agentRuns.where('productRuntimeSessionId').equals(single.session.id!).count()).toBe(0)
  }, 45_000)
})
