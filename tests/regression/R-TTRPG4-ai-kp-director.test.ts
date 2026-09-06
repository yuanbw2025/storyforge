import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyAiKpSession } from '../helpers/ready-ttrpg-session'
import { captureTtrpgDirectorViewV1 } from '../../src/lib/ttrpg/director-context'
import { generateTtrpgDirectorDecisionV1, adoptTtrpgDirectorDecisionV1 } from '../../src/lib/ttrpg/director-harness'
import { adoptTtrpgGmNarrationCandidateV1, generateTtrpgGmNarrationCandidateV1 } from '../../src/lib/ttrpg/gm-harness'
import { loadTtrpgGmRuntimeViewV1 } from '../../src/lib/ttrpg/gm-context'
import { createDeterministicGmSynthesisFrameV2 } from '../../src/lib/ttrpg/action-feedback'
import { readProductRuntimeState, readProductRuntimeStateVersion, replayProductRuntimeEvents, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-api'

const empty = { revealClueKeys: [], recommendedSceneKeys: [], recommendedEndingKeys: [], pacing: 'investigate' }
describe('R-TTRPG4 · AI KP durable director', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('规则路径约束的揭示与决策一次提交，恢复候选及重复采纳不重复调用或公开', async () => {
    const fixture = await readyAiKpSession('AI KP 原子主持')
    const input = { scope: fixture.scope, productRuntimeSessionId: fixture.sessionId, objective: '回应玩家调查并推进游戏' }
    const boundary = await captureTtrpgDirectorViewV1(input)
    expect(boundary.view.options.eligibleReveals.length).toBeGreaterThan(0)
    const clueKey = boundary.view.options.eligibleReveals[0].clueKey
    let calls = 0
    const generated = await generateTtrpgDirectorDecisionV1({ ...input, runAI: async () => { calls++; return JSON.stringify({ ...empty, revealClueKeys: [clueKey] }) } })
    expect(generated.candidate.requiresHumanConfirmation).toBe(false)
    const adopted = await adoptTtrpgDirectorDecisionV1({ scope: fixture.scope, runId: generated.candidate.runId })
    const again = await adoptTtrpgDirectorDecisionV1({ scope: fixture.scope, runId: generated.candidate.runId })
    expect(again.event.id).toBe(adopted.event.id)
    expect(calls).toBe(1)
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.snapshot.events.some(event => event.type === 'confirmation.recorded')).toBe(false)
    const state = await readProductRuntimeState(fixture.sessionId)
    expect(state.ttrpg!.product!.directorDecisions).toHaveLength(1)
    expect(state.ttrpg!.product!.discoveredClues).toContainEqual(expect.objectContaining({ clueKey }))
    const events = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).sortBy('sequence')
    const session = await db.productRuntimeSessions.get(fixture.sessionId)
    const replayed = replayProductRuntimeEvents(JSON.parse(session!.initialStateJson), events)
    expect(replayed).toEqual(state)
  })
  it('越权揭示和 provider 失败都不隐藏重发，不写入主持事件', async () => {
    const fixture = await readyAiKpSession('AI KP 拒绝越权')
    let calls = 0
    const base = { scope: fixture.scope, productRuntimeSessionId: fixture.sessionId, objective: '调查' }
    await expect(generateTtrpgDirectorDecisionV1({ ...base, runAI: async () => { calls++; return JSON.stringify({ ...empty, revealClueKeys: ['secret.forbidden'] }) } })).rejects.toThrow('权限')
    expect(calls).toBe(1)
    await expect(generateTtrpgDirectorDecisionV1({ ...base, runAI: async () => { calls++; throw new Error('HTTP 401') } })).rejects.toThrow('401')
    expect(calls).toBe(2)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.product!.directorDecisions).toHaveLength(0)
  })
  it('暂停后旧候选失效；AI 不得继续消费 API 或提交', async () => {
    const fixture = await readyAiKpSession('AI KP 暂停')
    const input = { scope: fixture.scope, productRuntimeSessionId: fixture.sessionId, objective: '调查' }
    const generated = await generateTtrpgDirectorDecisionV1({ ...input, runAI: async () => JSON.stringify(empty) })
    const version = await readProductRuntimeStateVersion(fixture.sessionId)
    await changeTtrpgSafetyStatus({ sessionId: fixture.sessionId, commandId: 'pause', baseSequence: version.sequence, baseStateHash: version.stateHash,
      status: 'paused', reason: '需要休息', changedBy: 'player' })
    await expect(adoptTtrpgDirectorDecisionV1({ scope: fixture.scope, runId: generated.candidate.runId })).rejects.toThrow()
    let called = false
    await expect(generateTtrpgDirectorDecisionV1({ ...input, runAI: async () => { called = true; return JSON.stringify(empty) } })).rejects.toThrow()
    expect(called).toBe(false)
  })
  it('AI KP 叙事凭开团授权自动采纳，模型只看到公开素材', async () => {
    const fixture = await readyAiKpSession('AI KP 公开叙事')
    const input = { scope: fixture.scope, productRuntimeSessionId: fixture.sessionId }
    const view = await loadTtrpgGmRuntimeViewV1(input)
    const generated = await generateTtrpgGmNarrationCandidateV1({ ...input, objective: '回应刚才的行动', runAI: async messages => {
      const prompt = messages.map(item => item.content).join('\n')
      expect(prompt).toContain('storyforge.ttrpg-public-narration-view')
      expect(prompt).not.toContain('gmSecret')
      expect(prompt).not.toContain('privateProfile')
      return JSON.stringify({ narration: '潮声在石阶下回荡。刚才的调查留下了新的思考方向。',
        synthesisFrame: createDeterministicGmSynthesisFrameV2(view.latestAction!.receipt!), offeredClueKeys: [], recommendedNextSceneKeys: [] })
    } })
    const adopted = await adoptTtrpgGmNarrationCandidateV1({ scope: fixture.scope, runId: generated.candidate.runId })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.snapshot.events.some(event => event.type === 'confirmation.recorded')).toBe(false)
  })
})
