import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import {
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { assertContextGatewayCandidateAdoptableV1 } from '../../src/lib/context-gateway/execution'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'

const NOW = 1_788_100_000_000

async function seedWorkspace(name: string): Promise<{ projectId: number; scope: WorkspaceScope }> {
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name,
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 1_000_000,
    createdAt: NOW,
    updatedAt: NOW,
  } as never) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  return { projectId, scope: ownership.scope }
}

function plan(hint = ''): MasterAgentPlan {
  return {
    summary: '生成种族与民族候选。',
    tasks: [{
      id: 'races-1',
      agentId: 'world-origin',
      skillId: 'world-origin.worldview-field',
      instruction: `生成世界基座字段。目标字段=races；生成模式=expand。${hint}`,
      dependsOn: [],
    }],
    workflow: {
      version: 1,
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    },
  }
}

async function runCandidate(fixture: { projectId: number; scope: WorkspaceScope }) {
  const conversation = await getOrCreateAgentConversation({
    projectId: fixture.projectId,
    scope: fixture.scope,
    worldGroupId: null,
  })
  const run = await runDurableMasterAgentPlanV1({
    scope: fixture.scope,
    worldGroupId: null,
    conversationId: conversation.id!,
    plan: plan('请自主设计可直接进入故事的族群结构。'),
    budget: new AgentTeamBudgetTracker('balanced'),
  })
  const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: run.runId })
  return { run, candidate: restored.candidates[0] }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    const prompt = body.messages.map((message: { content: string }) => message.content).join('\n')
    expect(prompt).toContain('项目名')
    expect(prompt).toContain('低权重灵感')
    expect(prompt).toContain('身份/来源')
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        field: 'races',
        value: '雾港人以潮汐记忆辨认亲族；高塔迁民以钟声登记公民身份。两群共享盐路，却因记忆税的继承规则长期冲突。雾港议席按航季轮换，高塔行会则按师徒谱系组织。',
        temporaryAssumptions: ['本轮暂定潮汐记忆可以作为亲缘凭证。'],
      }) } }],
      usage: { prompt_tokens: 80, completion_tokens: 90, total_tokens: 170 },
    }), { status: 200 })
  }))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})

describe.sequential('RACE-1 · races required Gateway canary', () => {
  it('空项目以标题低权重自主生成，持久化 V3 exact evidence，作者修订后仍可采纳', async () => {
    const fixture = await seedWorkspace('“盐”是什么')
    const { run, candidate } = await runCandidate(fixture)

    expect(candidate.payload.contextSources).toEqual([])
    expect(candidate.payload.contextManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(candidate.payload.worldviewField).toBe('races')
    const eventTypes = (await db.agentRunEvents.where('runId').equals(run.runId).toArray())
      .map(event => event.type)
    expect(eventTypes).toContain('context.assembled')
    const manifest = await readContextGatewayManifestV3ForAttemptV1({
      scope: fixture.scope,
      runId: run.runId,
      stepId: 'master:races-1',
      attempt: 1,
    })
    expect(manifest.manifest.manifestHash).toBe(candidate.payload.contextManifestHash)
    expect(manifest.manifest.artifacts.map(item => item.role)).toEqual(expect.arrayContaining([
      'selector-result', 'context-packet', 'rendered-request', 'raw-response',
    ]))
    expect(await db.worldviews.count()).toBe(0)

    const revised = {
      field: 'races',
      value: '雾港人以潮汐记忆辨认亲族，高塔迁民以钟声登记身份；两群共享盐路，却因记忆税继承规则冲突。',
      temporaryAssumptions: ['本轮暂定潮汐记忆可以作为亲缘凭证。'],
    }
    await updateAgentEventCandidate(
      candidate.event.id!,
      fixture.projectId,
      JSON.stringify(revised, null, 2),
      fixture.scope,
    )
    const adoption = await commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: run.runId,
      candidateEventId: candidate.event.id!,
    })
    expect(adoption.message).toContain('种族与民族')
    expect((await db.worldviews.toCollection().first())?.races).toBe(revised.value)
    expect(await db.codexEntries.count()).toBe(0)
  })

  it('已有种族正文是 mandatory 资源，Canon 改动后 V3 验鲜拒绝旧候选', async () => {
    const fixture = await seedWorkspace('群岛旧约')
    const worldviewId = await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.projectId,
      races: '潮民必须记住七次退潮，才会被族群承认为成年人。',
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'world' }) as never) as number
    const { run, candidate } = await runCandidate(fixture)
    const manifest = await readContextGatewayManifestV3ForAttemptV1({
      scope: fixture.scope,
      runId: run.runId,
      stepId: 'master:races-1',
      attempt: 1,
    })
    expect(manifest.manifest.gateway.retrievalTrace.mandatory.some(item => (
      item.sourceRefs.some(ref => ref.table === 'worldviews' && ref.field === 'races')
    ))).toBe(true)

    await db.worldviews.update(worldviewId, {
      races: '潮民改以九次退潮作为成年标准。',
      updatedAt: NOW + 100,
    })
    await expect(assertContextGatewayCandidateAdoptableV1({
      skill: getAgentSkillV1('world-origin.worldview-field'),
      writeTarget: 'worldviews.races',
      scope: fixture.scope,
      worldGroupId: null,
      runId: run.runId,
      stepId: 'master:races-1',
      attempt: 1,
      candidateHash: candidate.payload.candidateHash!,
      contextManifestHash: candidate.payload.contextManifestHash,
    })).rejects.toThrow('candidate-context-stale')
  })
})
