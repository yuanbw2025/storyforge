import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { parseHistoryAgentResultStrictV1 } from '../../src/lib/history/ai-plan'
import {
  abandonHistoryAgentRunV1,
  adoptHistoryAgentCandidateV1,
  generateHistoryAgentCandidateV1,
  readPendingHistoryAgentCandidateV1,
  readRecoverableHistoryAgentRunV1,
  rejectHistoryAgentCandidateV1,
  type HistoryAgentAdoptionBoundaryV1,
  type HistoryAgentBoundaryV1,
} from '../../src/lib/agent/run/history-agent-durable'

async function seed(suffix = '') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `镜城史志${suffix}`, genre: 'historical', genres: ['historical'], status: 'drafting',
    description: '镜税署在星历三百年改写了盐晶流通法。', targetWordCount: 90_000,
enableMultiWorld: true,
    createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `history-${now}-${suffix}`, name: '镜海世界', description: '',
    currentVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: `盐晶纪事${suffix}`, description: '', genres: ['historical'],
    status: 'drafting', targetWordCount: 90_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '镜城', description: '', type: 'primary', icon: '🪞', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  await db.worldviews.add({
    projectId, worldId, worldGroupId,
    worldOrigin: '镜海退潮后，记忆凝结为可交易盐晶。',
    factionLayout: '镜税署垄断盐晶登记，拾忆行会负责民间兑付。',
    createdAt: now, updatedAt: now,
  } as any)
  const historyId = await db.histories.add({
    projectId, worldId, worldGroupId,
    overview: '星历建立后，镜税署逐步收紧盐晶流通。',
    eraSystem: '以第一次镜海退潮为星历元年。', events: '[]',
    createdAt: now, updatedAt: now,
  } as any) as number
  const eventId = await db.historicalTimelineEvents.add({
    projectId, worldId, worldGroupId, era: 'custom', year: 300, date: '星历三百年',
    title: '盐晶新律颁布', description: '镜税署要求每枚盐晶登记来源。',
    conceptNote: '允许借鉴前现代盐铁专卖，但官署为架空设定。', impact: '地下交易兴起。',
    isHistorical: false, source: '', consultPrompt: '重点检查垄断制度的执行成本。',
    stormPrompt: '发散市井规避登记的具体场景。', relatedChapterIds: [],
    customTimeRange: '星历三百年至三百零二年', location: '镜城',
    createdAt: now, updatedAt: now,
  } as any) as number
  const keywordId = await db.historicalKeywords.add({
    projectId, worldId, worldGroupId, keyword: '盐晶兑票', category: 'economy', era: 'custom',
    description: '拾忆行会签发的盐晶远程兑付凭证。', conceptNote: '用于商战与诈骗剧情。',
    consultPrompt: '核对票据防伪与兑付责任。', stormPrompt: '强调码头、驿站和黑市细节。',
    relatedChapterIds: [], customTimeRange: '星历三世纪', location: '镜海沿岸',
    createdAt: now, updatedAt: now,
  } as any) as number
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, historyId, eventId, keywordId,
  }
}

function consultResult(tag = '可信') {
  return `## 前提识别\n- ${tag}：镜税署与盐晶均为作者声明的架空设定。\n\n## 可能存在的问题\n- 垄断执行成本需要说明，信心：高。\n\n## 修改方案 / 折中方案\n- 增设分级验票与行会连带责任。\n\n## 时代质感补充\n- 可描写封签、簿册和码头抽验；真实类比出处待考。`
}

function stormResult(tag = '可写') {
  return `## 场景画面\n- ${tag}：码头验票人把盐晶贴近镜灯辨认暗纹。\n\n## 人物与对白触点\n- 脚夫抱怨兑票只能在指定行栈使用。\n\n## 可写进小说的冲突灵感\n- 黑市用旧封签调包新票。\n\n## 可选的史实补强\n- 票据制度类比需要进一步查证，标记为待考。`
}

describe.sequential('R-HARNESS73 · 历史双 Agent durable 候选与定点采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('三注册表闭合，完整登记基线实际进入一次模型调用，确认前零写入', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('historyAgentBaseline')).toMatchObject({ ownerFrom: 'world', protectedFromTrim: true })
    expect(PROJECT_TABLES.find(item => item.name === 'historicalTimelineEvents')).toMatchObject({ exportable: true, worldScoped: true })
    expect(PROJECT_TABLES.find(item => item.name === 'historicalKeywords')).toMatchObject({ exportable: true, worldScoped: true })
    expect(FIELD_BY_TARGET.get('historicalTimelineEvents')?.map(field => field.field)).toContain('aiConsult')
    expect(FIELD_BY_TARGET.get('historicalKeywords')?.map(field => field.field)).toContain('aiBrainstorm')
    expect(getAgentSkillV1('world-origin.history-consult')).toMatchObject({
      agentId: 'world-origin', executionMode: 'history-consult',
    })
    const fixture = await seed()
    let calls = 0
    const generated = await generateHistoryAgentCandidateV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      mode: 'consult',
      targetKind: 'event',
      targetId: fixture.eventId,
      runAI: async messages => {
        calls++
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('镜海退潮后')
        expect(prompt).toContain('盐晶新律颁布')
        expect(prompt).toContain('星历建立后')
        expect(prompt).toContain('重点检查垄断制度的执行成本')
        expect(prompt).toContain('HARNESS-73 严格输出协议')
        expect(prompt.split('【历史 Agent 正式输入基线】')).toHaveLength(2)
        return consultResult()
      },
    })
    expect(calls).toBe(1)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect((await db.historicalTimelineEvents.get(fixture.eventId))?.aiConsult).toBeUndefined()

    const missing = await seed('missing-context')
    const active = (await import('../../src/stores/prompt')).usePromptStore.getState().getActive('history.consult')
    const customId = await db.promptTemplates.add({
      ...active, id: undefined, scope: 'user', name: '缺上下文', isActive: true,
      userPromptTemplate: '请直接给出四段结果。', createdAt: Date.now(), updatedAt: Date.now(),
    } as any) as number
    await (await import('../../src/stores/prompt')).usePromptStore.getState().reload()
    let missingCalls = 0
    await expect(generateHistoryAgentCandidateV1({
      scope: missing.scope, worldGroupId: missing.worldGroupId, mode: 'consult',
      targetKind: 'event', targetId: missing.eventId,
      runAI: async () => { missingCalls++; return consultResult() },
    })).rejects.toThrow('未实际进入模型 Prompt')
    expect(missingCalls).toBe(0)
    await db.promptTemplates.delete(customId)
    await (await import('../../src/stores/prompt')).usePromptStore.getState().reload()
  })

  it('严格 Markdown 协议拒绝围栏、缺标题、乱序和过短输出', () => {
    expect(parseHistoryAgentResultStrictV1('consult', consultResult())).toBe(consultResult())
    expect(parseHistoryAgentResultStrictV1('storm', stormResult())).toBe(stormResult())
    expect(() => parseHistoryAgentResultStrictV1('consult', `\`\`\`md\n${consultResult()}\n\`\`\``)).toThrow('代码围栏')
    expect(() => parseHistoryAgentResultStrictV1('consult', '只有一段简短意见')).toThrow('过短')
    expect(() => parseHistoryAgentResultStrictV1('storm', '## 人物与对白触点\n很多\n## 场景画面\n很多很多很多很多很多很多')).toThrow()
  })

  it('候选 checkpoint 后可恢复；模型请求或响应未知窗口不会自动重试', async () => {
    for (const boundary of ['model.requested', 'model.responded'] satisfies HistoryAgentBoundaryV1[]) {
      const fixture = await seed(boundary)
      let calls = 0
      await expect(generateHistoryAgentCandidateV1({
        scope: fixture.scope, worldGroupId: fixture.worldGroupId, mode: 'consult',
        targetKind: 'event', targetId: fixture.eventId,
        runAI: async () => { calls++; return consultResult(boundary) },
        onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
      })).rejects.toThrow(`interrupt:${boundary}`)
      expect(calls).toBe(boundary === 'model.requested' ? 0 : 1)
      expect((await readRecoverableHistoryAgentRunV1({
        scope: fixture.scope, worldGroupId: fixture.worldGroupId, mode: 'consult',
      }))?.safeToResume).toBe(false)
    }
    const fixture = await seed('checkpoint')
    await expect(generateHistoryAgentCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, mode: 'storm',
      targetKind: 'keyword', targetId: fixture.keywordId, runAI: async () => stormResult(),
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:checkpoint') },
    })).rejects.toThrow('interrupt:checkpoint')
    const pending = await readPendingHistoryAgentCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, mode: 'storm',
    })
    expect(pending?.candidate.result).toBe(stormResult())
  })

  it('考据与风暴分别只写目标字段，且允许另一结果字段独立变化', async () => {
    const fixture = await seed('fields')
    const consult = await generateHistoryAgentCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, mode: 'consult',
      targetKind: 'event', targetId: fixture.eventId, runAI: async () => consultResult(),
    })
    await db.historicalTimelineEvents.update(fixture.eventId, { aiBrainstorm: '作者保留的旧风暴' })
    const acceptedConsult = await adoptHistoryAgentCandidateV1({ scope: fixture.scope, runId: consult.snapshot.run.id })
    expect(acceptedConsult.snapshot.projection.state).toBe('completed')
    expect(await db.historicalTimelineEvents.get(fixture.eventId)).toMatchObject({
      aiConsult: consultResult(), aiBrainstorm: '作者保留的旧风暴',
    })

    const storm = await generateHistoryAgentCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, mode: 'storm',
      targetKind: 'keyword', targetId: fixture.keywordId, runAI: async () => stormResult(),
    })
    await adoptHistoryAgentCandidateV1({ scope: fixture.scope, runId: storm.snapshot.run.id })
    expect((await db.historicalKeywords.get(fixture.keywordId))?.aiBrainstorm).toBe(stormResult())
    expect((await db.historicalKeywords.get(fixture.keywordId))?.aiConsult).toBeUndefined()
  })

  it.each([
    ['目标内容', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.historicalTimelineEvents.update(fixture.eventId, { description: '作者改写目标条目' })
    }],
    ['历史总述', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.histories.update(fixture.historyId, { overview: '作者改写历史总述' })
    }],
    ['世界观', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      const row = await db.worldviews.where('projectId').equals(fixture.projectId).first()
      await db.worldviews.update(row!.id!, { worldOrigin: '作者改写世界来源' })
    }],
    ['目标结果字段', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.historicalTimelineEvents.update(fixture.eventId, { aiConsult: '作者已写新考据' })
    }],
  ] as const)('%s 漂移使候选 stale，正式结果不被覆盖', async (_label, mutate) => {
    const fixture = await seed(_label)
    const generated = await generateHistoryAgentCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, mode: 'consult',
      targetKind: 'event', targetId: fixture.eventId, runAI: async () => consultResult(),
    })
    await mutate(fixture)
    await expect(adoptHistoryAgentCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow('已变化')
    expect((await db.historicalTimelineEvents.get(fixture.eventId))?.aiConsult).not.toBe(consultResult())
  })

  it.each<HistoryAgentAdoptionBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿冻结意图幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generateHistoryAgentCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, mode: 'consult',
      targetKind: 'event', targetId: fixture.eventId, runAI: async () => consultResult(boundary),
    })
    await expect(adoptHistoryAgentCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    const completed = await adoptHistoryAgentCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.historicalTimelineEvents.get(fixture.eventId))?.aiConsult).toBe(consultResult(boundary))
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('拒绝、目标删除、导入取消、Work/世界组隔离、终态过期与旧旁路下线均 fail-closed', async () => {
    const rejected = await seed('reject')
    const rejectedRun = await generateHistoryAgentCandidateV1({
      scope: rejected.scope, worldGroupId: rejected.worldGroupId, mode: 'storm',
      targetKind: 'keyword', targetId: rejected.keywordId, runAI: async () => stormResult(),
    })
    expect((await rejectHistoryAgentCandidateV1({
      scope: rejected.scope, runId: rejectedRun.snapshot.run.id,
    })).projection.state).toBe('cancelled')

    const deleted = await seed('deleted')
    const deletedRun = await generateHistoryAgentCandidateV1({
      scope: deleted.scope, worldGroupId: deleted.worldGroupId, mode: 'consult',
      targetKind: 'event', targetId: deleted.eventId, runAI: async () => consultResult(),
    })
    await db.historicalTimelineEvents.delete(deleted.eventId)
    await expect(adoptHistoryAgentCandidateV1({ scope: deleted.scope, runId: deletedRun.snapshot.run.id })).rejects.toThrow()

    const completed = await seed('terminal')
    const completedRun = await generateHistoryAgentCandidateV1({
      scope: completed.scope, worldGroupId: completed.worldGroupId, mode: 'consult',
      targetKind: 'event', targetId: completed.eventId, runAI: async () => consultResult(),
    })
    await adoptHistoryAgentCandidateV1({ scope: completed.scope, runId: completedRun.snapshot.run.id })
    await db.historicalTimelineEvents.update(completed.eventId, { aiConsult: '作者覆盖终态' })
    await expect(adoptHistoryAgentCandidateV1({ scope: completed.scope, runId: completedRun.snapshot.run.id }))
      .rejects.toThrow('完成回执已过期')

    const pending = await seed('import')
    await generateHistoryAgentCandidateV1({
      scope: pending.scope, worldGroupId: pending.worldGroupId, mode: 'storm',
      targetKind: 'keyword', targetId: pending.keywordId, runAI: async () => stormResult(),
    })
    const importedId = await importProjectJSON(await exportProjectJSON(pending.projectId))
    expect((await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('world-origin.history-storm'))?.status).toBe('cancelled')

    const now = Date.now()
    const otherWorkId = await db.works.add({
      projectId: pending.projectId, worldId: pending.worldId, title: '另一作品', description: '',
      genres: ['historical'], status: 'drafting', targetWordCount: 1_000, createdAt: now, updatedAt: now,
    } as any) as number
    expect(await readPendingHistoryAgentCandidateV1({
      scope: { ...pending.scope, workId: otherWorkId }, worldGroupId: pending.worldGroupId, mode: 'storm',
    })).toBeNull()
    expect(await readPendingHistoryAgentCandidateV1({
      scope: pending.scope, worldGroupId: pending.worldGroupId + 999, mode: 'storm',
    })).toBeNull()

    const panel = readFileSync('src/components/history/HistoryPanel.tsx', 'utf8')
    const hook = readFileSync('src/components/history/useHistoryAI.ts', 'utf8')
    expect(panel).not.toContain('useAIStream')
    expect(panel).not.toContain('assembleContext(')
    expect(hook).not.toContain("target: 'historicalTimelineEvents'")
    expect(hook).not.toContain('adopt(')
    expect(hook).toContain('generateHistoryAgentCandidateV1')
    expect(hook).toContain('adoptHistoryAgentCandidateV1')
  })

  it('结果不可判定运行可显式放弃，但冻结采纳意图后不可取消', async () => {
    const unsafe = await seed('unsafe-abandon')
    await expect(generateHistoryAgentCandidateV1({
      scope: unsafe.scope, worldGroupId: unsafe.worldGroupId, mode: 'consult',
      targetKind: 'event', targetId: unsafe.eventId, runAI: async () => consultResult(),
      onDurableBoundary: boundary => { if (boundary === 'model.requested') throw new Error('interrupt') },
    })).rejects.toThrow('interrupt')
    const recoverable = await readRecoverableHistoryAgentRunV1({
      scope: unsafe.scope, worldGroupId: unsafe.worldGroupId, mode: 'consult',
    })
    expect((await abandonHistoryAgentRunV1({ scope: unsafe.scope, runId: recoverable!.snapshot.run.id })).projection.state)
      .toBe('cancelled')

    const frozen = await seed('frozen')
    const generated = await generateHistoryAgentCandidateV1({
      scope: frozen.scope, worldGroupId: frozen.worldGroupId, mode: 'consult',
      targetKind: 'event', targetId: frozen.eventId, runAI: async () => consultResult(),
    })
    await expect(adoptHistoryAgentCandidateV1({
      scope: frozen.scope, runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => { if (boundary === 'intent.checkpoint') throw new Error('interrupt:intent') },
    })).rejects.toThrow('interrupt:intent')
    await expect(abandonHistoryAgentRunV1({ scope: frozen.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow('意图已冻结')
  })
})
