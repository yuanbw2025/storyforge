import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  adoptAiTownDirectorCandidateV1,
  generateAiTownDirectorCandidateV1,
} from '../../src/lib/ai-town/director-harness'
import { advanceAiTownTimeV1, resolveAiTownEventSeedV1, runAiTownOfflineBatchV1 } from '../../src/lib/ai-town/runtime-api'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-api'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { seedAiTownRuntimeFixture } from '../helpers/ai-town-runtime'

describe('R-AITOWN2 · AI 小镇自治导演 durable Harness', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('导演上下文源拒绝缺失实例、跨项目和跨世界组读取', async () => {
    const seeded = await seedAiTownRuntimeFixture()
    const source = CONTEXT_SOURCES.find(item => item.key === 'aiTownDirectorRuntime')!
    expect(await source.read({ projectId: seeded.scope.projectId })).toBe('')
    expect(await source.read({
      projectId: seeded.scope.projectId + 1,
      productRuntimeSessionId: seeded.session.id!,
    })).toBe('')
    expect(await source.read({
      projectId: seeded.scope.projectId,
      scope: seeded.scope,
      worldGroupId: 999_999,
      productRuntimeSessionId: seeded.session.id!,
    })).toBe('')
  })

  it('只读取公开运行视角，并只能采用当前可触发事件', async () => {
    const seeded = await seedAiTownRuntimeFixture()
    const generated = await generateAiTownDirectorCandidateV1({
      scope: seeded.scope,
      productRuntimeSessionId: seeded.session.id!,
      runAI: async messages => {
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('后日谈 AI 小镇导演运行上下文')
        expect(prompt).toContain('town.event.1')
        expect(prompt).toContain('可触发')
        expect(prompt).not.toContain('只有居民 1 知道的旧事')
        return JSON.stringify({
          kind: 'ai-town-director',
          decision: 'event',
          seedKey: 'town.event.1',
          majorChange: null,
          summary: '林舟把清晨的第一壶茶放在门口，等候愿意停下来的人。',
          rationale: '当前可观察的低强度日常事件，适合作为小镇的自治起点。',
        })
      },
    })
    const adopted = await adoptAiTownDirectorCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.event.type).toBe('town.event.resolved')
    const state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town?.cadence.seedLastTriggeredDay['town.event.1']).toBe(1)
    expect(state.town?.latestPublicEvents.at(-1)).toBe('生活事件 1：由人物日程、地点和关系共同触发的可观察事件。')
    expect(state.town?.latestPublicEvents.at(-1)).not.toContain('第一壶茶')
    expect(state.town?.memories.some(memory => memory.memoryKey.includes('town.memory.event.'))).toBe(true)
  })

  it('状态变化后候选必须 stale，不得偷偷在新状态采用', async () => {
    const seeded = await seedAiTownRuntimeFixture()
    const generated = await generateAiTownDirectorCandidateV1({
      scope: seeded.scope,
      productRuntimeSessionId: seeded.session.id!,
      runAI: async () => JSON.stringify({
        kind: 'ai-town-director', decision: 'event', seedKey: 'town.event.2', majorChange: null,
        summary: '广场上的零碎工具被重新分类。', rationale: '社区日常事件。',
      }),
    })
    const version = await readProductRuntimeStateVersion(seeded.session.id!)
    await advanceAiTownTimeV1({
      sessionId: seeded.session.id!, commandId: 'town:director:stale:advance',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
    })
    await expect(adoptAiTownDirectorCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow(/already changed|has changed|stale|changed|已变化/)
    const state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town?.cadence.seedLastTriggeredDay['town.event.2']).toBeUndefined()
  })

  it('运行事件已提交但采用回执尚未写入时只能原地恢复，不能吞入后续 SIM 状态', async () => {
    const seeded = await seedAiTownRuntimeFixture()
    const generated = await generateAiTownDirectorCandidateV1({
      scope: seeded.scope,
      productRuntimeSessionId: seeded.session.id!,
      runAI: async () => JSON.stringify({
        kind: 'ai-town-director', decision: 'event', seedKey: 'town.event.1', majorChange: null,
        summary: '模型表现文字不得成为新的结构化小镇事实。', rationale: '当前可用的低强度事件。',
      }),
    })
    const candidate = generated.candidate
    if (candidate.kind !== 'ai-town-director-event-candidate') throw new Error('测试候选类型错误')
    const committed = await resolveAiTownEventSeedV1({
      sessionId: candidate.productRuntimeSessionId,
      commandId: candidate.commandId,
      baseSequence: candidate.baseSequence,
      baseStateHash: candidate.stateHash,
      seedKey: candidate.seedKey,
    })
    expect(committed.sequence).toBe(candidate.baseSequence + 1)
    const recovered = await adoptAiTownDirectorCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(recovered.snapshot.projection.state).toBe('completed')

    const second = await seedAiTownRuntimeFixture()
    const secondGenerated = await generateAiTownDirectorCandidateV1({
      scope: second.scope,
      productRuntimeSessionId: second.session.id!,
      runAI: async () => JSON.stringify({
        kind: 'ai-town-director', decision: 'event', seedKey: 'town.event.1', majorChange: null,
        summary: '另一个中断窗口。', rationale: '当前可用事件。',
      }),
    })
    const secondCandidate = secondGenerated.candidate
    if (secondCandidate.kind !== 'ai-town-director-event-candidate') throw new Error('测试候选类型错误')
    await resolveAiTownEventSeedV1({
      sessionId: secondCandidate.productRuntimeSessionId,
      commandId: secondCandidate.commandId,
      baseSequence: secondCandidate.baseSequence,
      baseStateHash: secondCandidate.stateHash,
      seedKey: secondCandidate.seedKey,
    })
    const version = await readProductRuntimeStateVersion(second.session.id!)
    await advanceAiTownTimeV1({
      sessionId: second.session.id!, commandId: 'town:director:post-commit-advance',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
    })
    await expect(adoptAiTownDirectorCandidateV1({ scope: second.scope, runId: secondGenerated.snapshot.run.id }))
      .rejects.toThrow(/SIM 已继续推进/)
  })

  it('重大变化只能形成待确认候选，不能直接改变居民状态', async () => {
    const seeded = await seedAiTownRuntimeFixture()
    const output = JSON.stringify({
      kind: 'ai-town-director', decision: 'major-change', seedKey: null,
      majorChange: { kind: 'permanent-departure', title: '陆遥考虑远行', residentKeys: ['town.resident.2'] },
      summary: '陆遥开始考虑离开小镇去完成旧日承诺，尚未作出决定。',
      rationale: '这是会改变常驻状态的长期结构性变化，必须由用户确认。',
    })
    await expect(generateAiTownDirectorCandidateV1({
      scope: seeded.scope,
      productRuntimeSessionId: seeded.session.id!,
      runAI: async () => output,
    })).rejects.toThrow(/第 7 个游戏日/)
    for (const commandId of ['town:director:prepare:1', 'town:director:prepare:2', 'town:director:prepare:3']) {
      const version = await readProductRuntimeStateVersion(seeded.session.id!)
      await runAiTownOfflineBatchV1({
        sessionId: seeded.session.id!, commandId, baseSequence: version.sequence,
        baseStateHash: version.stateHash, days: 2,
      })
    }
    const generated = await generateAiTownDirectorCandidateV1({
      scope: seeded.scope,
      productRuntimeSessionId: seeded.session.id!,
      runAI: async () => output,
    })
    const adopted = await adoptAiTownDirectorCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(adopted.event.type).toBe('town.major-change.proposed')
    const state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town?.pendingMajorChanges.at(-1)).toMatchObject({ status: 'pending', kind: 'permanent-departure' })
    expect(state.town?.residents['town.resident.2'].residencyStatus).toBe('resident')
  })
})
