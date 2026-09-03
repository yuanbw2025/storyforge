import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import {
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import {
  commitMasterAgentCandidateAdoptionV1,
  recoverPendingMasterAgentAdoptionsV1,
  rejectMasterAgentCandidateV1,
} from '../../src/lib/agent/run/master-adoption'
import {
  configureHarnessFaultInjectionV1,
  resetHarnessFaultInjectionV1,
} from '../../src/lib/agent/dev-fault-injection'
import { verifyContextGatewayCandidateEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'

const NOW = 1_788_300_000_000

async function seedWorkspace(name: string): Promise<{
  projectId: number
  scope: WorkspaceScope
  primaryGroupId: number
  secondaryGroupId: number
}> {
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(), name, genre: 'fantasy', genres: ['fantasy'],
    description: '', status: 'drafting', targetWordCount: 1_000_000, enableMultiWorld: true,
    createdAt: NOW, updatedAt: NOW,
  } as never) as number
  const scope = (await ensureWorkspaceOwnership(projectId)).scope
  const primaryGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId, worldId: scope.worldId, name: '主世界', order: 0, createdAt: NOW, updatedAt: NOW,
  }, { owner: 'world' }) as never) as number
  const secondaryGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId, worldId: scope.worldId, name: '镜像世界', order: 1, createdAt: NOW, updatedAt: NOW,
  }, { owner: 'world' }) as never) as number
  return { projectId, scope, primaryGroupId, secondaryGroupId }
}

function plan(hint = ''): MasterAgentPlan {
  return {
    summary: '生成种族与民族候选。',
    tasks: [{
      id: 'races-fault-matrix', agentId: 'world-origin', skillId: 'world-origin.worldview-field',
      instruction: `生成世界基座字段。目标字段=races；生成模式=expand。${hint}`,
      dependsOn: [],
    }],
    workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] },
  }
}

function goodResponse(value = '潮民以船籍区分民族身份，与岛上钟匠共用祭潮港，但因航路继承规则长期冲突。') {
  return JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ field: 'races', value }) } }],
    usage: { prompt_tokens: 60, completion_tokens: 50, total_tokens: 110 },
  })
}

async function runCandidate(fixture: Awaited<ReturnType<typeof seedWorkspace>>) {
  const conversation = await getOrCreateAgentConversation({
    projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.primaryGroupId,
  })
  const result = await runDurableMasterAgentPlanV1({
    scope: fixture.scope,
    worldGroupId: fixture.primaryGroupId,
    conversationId: conversation.id!,
    plan: plan('作者补充：新设定需要能推动人物冲突。'),
    budget: new AgentTeamBudgetTracker('balanced'),
  })
  const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
  return { result, candidate: restored.candidates[0] }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  resetHarnessFaultInjectionV1()
})

afterEach(async () => {
  resetHarnessFaultInjectionV1()
  vi.unstubAllGlobals()
  await db.delete()
})

describe.sequential('RACE-4 · races save/refresh/stale/fault matrix', () => {
  it('错字段与非法结构只修复一次，原始尝试和费用均进入 exact evidence', async () => {
    const fixture = await seedWorkspace('无标题绑定的群岛史')
    const responses = [
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '{"field":"wrong","value":' } }],
        usage: { prompt_tokens: 50, completion_tokens: 8, total_tokens: 58 },
      }),
      goodResponse(),
    ]
    const fetchMock = vi.fn(async () => new Response(responses.shift()!, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result, candidate } = await runCandidate(fixture)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.budgetEvidence.calls).toBe(2)
    expect(candidate.payload.worldviewField).toBe('races')
    expect(await db.worldviews.count()).toBe(0)
    const verified = await verifyContextGatewayCandidateEvidenceV1({
      scope: fixture.scope,
      runId: result.runId,
      stepId: 'master:races-fault-matrix',
      attempt: 1,
      candidateHash: candidate.payload.candidateHash!,
    })
    const raw = Object.entries(verified.artifactBodies).find(([key]) => key.startsWith('raw-response:'))?.[1]
    expect(raw).toContain('"version":1')
    expect(raw).toContain('"callIndex":2')
    expect(raw).toContain('"result":"repaired"')
  })

  it('刷新可恢复候选，切换世界组后采纳和拒绝均 fail-closed', async () => {
    const fixture = await seedWorkspace('双世界组隔离')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(goodResponse(), { status: 200 })))
    const { result, candidate } = await runCandidate(fixture)
    const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    expect(restored.candidates).toHaveLength(1)

    const switched = {
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: candidate.event.id!,
      worldGroupId: fixture.secondaryGroupId,
    }
    await expect(commitMasterAgentCandidateAdoptionV1(switched)).rejects.toThrow('当前世界组不一致')
    await expect(rejectMasterAgentCandidateV1(switched)).rejects.toThrow('当前世界组不一致')
    expect(await db.worldviews.count()).toBe(0)
  })

  it('正式 Canon 在生成后改动会 stale；网络结果未知时零候选、零 Canon', async () => {
    const fixture = await seedWorkspace('修订向量与网络失败')
    const worldviewId = await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.projectId,
      worldGroupId: fixture.primaryGroupId,
      races: '潮民成年需经七次退潮。',
      createdAt: NOW, updatedAt: NOW,
    }, { owner: 'world' }) as never) as number
    vi.stubGlobal('fetch', vi.fn(async () => new Response(goodResponse(), { status: 200 })))
    const { result, candidate } = await runCandidate(fixture)
    await db.worldviews.update(worldviewId, { races: '潮民成年改为九次退潮。', updatedAt: NOW + 1 })
    await expect(commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: candidate.event.id!,
      worldGroupId: fixture.primaryGroupId,
    })).rejects.toThrow(/stale|过期/)
    expect((await db.worldviews.get(worldviewId))?.races).toContain('九次')

    const failed = await seedWorkspace('网络结果未知')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network outcome unknown') }))
    await expect(runCandidate(failed)).rejects.toThrow(/network outcome unknown|有限重规划未完成/)
    expect((await db.agentEvents.where('projectId').equals(failed.projectId).toArray())
      .filter(event => event.kind === 'candidate')).toHaveLength(0)
    expect((await db.worldviews.where('projectId').equals(failed.projectId).toArray())).toHaveLength(0)
  })

  it('候选持久化与采纳故障都不会把半成品当成完成，写后中断可幂等恢复', async () => {
    const before = await seedWorkspace('候选写前故障')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(goodResponse(), { status: 200 })))
    configureHarnessFaultInjectionV1(['candidate.before-persist'])
    await expect(runCandidate(before)).rejects.toThrow('candidate.before-persist')
    expect((await db.agentEvents.where('projectId').equals(before.projectId).toArray())
      .filter(event => event.kind === 'candidate')).toHaveLength(0)
    expect((await db.worldviews.where('projectId').equals(before.projectId).toArray())).toHaveLength(0)

    resetHarnessFaultInjectionV1()
    await db.delete()
    await db.open()
    const adoption = await seedWorkspace('采纳写后故障')
    const { result, candidate } = await runCandidate(adoption)
    const ref = {
      scope: adoption.scope,
      runId: result.runId,
      candidateEventId: candidate.event.id!,
      worldGroupId: adoption.primaryGroupId,
    }
    configureHarnessFaultInjectionV1(['adoption.before-write'])
    await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('adoption.before-write')
    expect((await db.worldviews.where('projectId').equals(adoption.projectId).toArray())).toHaveLength(0)

    configureHarnessFaultInjectionV1(['adoption.after-write'])
    await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('adoption.after-write')
    expect((await db.worldviews.where('projectId').equals(adoption.projectId).toArray())).toHaveLength(1)
    resetHarnessFaultInjectionV1()
    await expect(recoverPendingMasterAgentAdoptionsV1(adoption.scope)).resolves.toEqual({
      recoveredRunIds: [result.runId], failed: [],
    })
    expect((await db.worldviews.where('projectId').equals(adoption.projectId).toArray())).toHaveLength(1)
  })
})
