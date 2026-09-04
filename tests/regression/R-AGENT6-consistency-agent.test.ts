import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  isConsistencyAgentCurrent,
  persistConsistencyAgentCandidate,
  readLatestConsistencyAgentRun,
  runBackgroundConsistencyAgent,
  runConsistencyAgent,
} from '../../src/lib/agent/consistency-agent'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { Project } from '../../src/lib/types'
import { putCurrentWorkspaceFixtureV1 } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const now = 1_700_000_000_000
const targetText = '林舟再次获得潮汐钥匙。'
const targetHtml = `<p>${targetText}</p>`

async function seedConsistencyProject() {
  const project: Project = {
    id: 82001,
    workspaceUid: 'WS-00000000-0000-4000-8000-000000082001',
    workspacePurpose: 'independent-work',
    name: '一致性 Agent 测试',
    enableMultiWorld: false,
    activeWorldId: 82001,
    activeWorkId: 82001,
    createdAt: now,
    updatedAt: now,
  }
  await putCurrentWorkspaceFixtureV1(project)
  await db.creativeRules.add({
    projectId: project.id!,
    writingStyle: '',
    narrativePOV: 'third-limited',
    atmosphere: '',
    prohibitions: '[]',
    consistencyRules: JSON.stringify(['潮汐钥匙只能获得一次']),
    specialRequirements: '',
    citedReferenceIds: '[]',
    createdAt: now,
    updatedAt: now,
  })
  const volumeId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  const firstOutlineId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: volumeId,
    type: 'chapter',
    title: '第一章 得钥',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  const targetOutlineId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: volumeId,
    type: 'chapter',
    title: '第二章 重逢',
    summary: '',
    order: 1,
    createdAt: now,
    updatedAt: now,
  })
  const firstChapterId = await db.chapters.add({
    projectId: project.id!,
    outlineNodeId: firstOutlineId,
    title: '第一章 得钥',
    content: '<p>林舟拾起潮汐钥匙。</p>',
    wordCount: 10,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  })
  const targetChapterId = await db.chapters.add({
    projectId: project.id!,
    outlineNodeId: targetOutlineId,
    title: '第二章 重逢',
    content: targetHtml,
    wordCount: targetText.length,
    status: 'draft',
    order: 1,
    notes: '',
    createdAt: now,
    updatedAt: now,
  })
  await db.characters.add({
    projectId: project.id!,
    name: '林舟',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'neutral',
    shortDescription: '',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '',
    arc: '',
    createdAt: now,
    updatedAt: now,
  })
  await db.itemLedger.add({
    projectId: project.id!,
    itemName: '潮汐钥匙',
    heldByName: '林舟',
    action: 'gain',
    quantity: 1,
    chapterId: firstChapterId,
    chapterTitle: '第一章 得钥',
    note: '',
    createdAt: now,
  })
  await finalizeCurrentFixtureV1(project.id!)
  return { project, targetChapterId, targetOutlineId }
}

describe('AGENT-1 27.2c · 一致性 Agent', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('后台 Fast Guard 只跑确定性检查，模型调用与上下文 token 均为零', async () => {
    const { project, targetChapterId } = await seedConsistencyProject()
    const candidate = await runBackgroundConsistencyAgent({
      projectId: project.id!,
      chapterId: targetChapterId,
      chapterTitle: '第二章 重逢',
      worldGroupId: null,
      chapterContent: targetHtml,
      budget: new AgentTeamBudgetTracker('economy'),
    })

    expect(candidate.mode).toBe('background')
    expect(candidate.budget.calls).toBe(0)
    expect(candidate.budget.usedTokens).toBe(0)
    expect(candidate.context).toMatchObject({
      included: [],
      inputTokens: 0,
      inputBudget: 0,
    })
    expect(candidate.findings).toHaveLength(1)
    expect(candidate.findings[0]).toMatchObject({
      category: '物品持有连续性',
      quote: targetText,
    })
  })

  it('显式 Fast Guard 最多一次模型调用，伪造正文与证据引用不能进入报告', async () => {
    const { project, targetChapterId, targetOutlineId } = await seedConsistencyProject()
    let calls = 0
    let sentCreativeRule = false
    const candidate = await runConsistencyAgent({
      projectId: project.id!,
      chapterId: targetChapterId,
      outlineNodeId: targetOutlineId,
      chapterTitle: '第二章 重逢',
      worldGroupId: null,
      chapterContent: targetHtml,
      mode: 'fast',
      budget: new AgentTeamBudgetTracker('economy'),
      call: async messages => {
        calls += 1
        sentCreativeRule = messages.some(message => (
          message.content.includes('一致性规则：潮汐钥匙只能获得一次')
        ))
        return JSON.stringify({
          findings: [{
            category: '物品',
            severity: 'hard',
            quote: targetText,
            evidence: [{
              sourceType: 'canon',
              sourceId: 1,
              quote: '潮汐钥匙 ×1',
            }],
            reason: '正文重复写成获得。',
          }, {
            category: '伪造正文',
            severity: 'hard',
            quote: '正文里没有这句话。',
            evidence: [],
            reason: '不应通过。',
          }, {
            category: '伪造证据',
            severity: 'hard',
            quote: targetText,
            evidence: [{
              sourceType: 'canon',
              sourceId: 999,
              quote: '证据上下文里不存在。',
            }],
            reason: '无有效证据时不能保持 hard。',
          }],
          cognitionReferences: [],
          lifecycleReferences: [],
        })
      },
    })

    expect(calls).toBe(1)
    expect(sentCreativeRule).toBe(true)
    expect(candidate.context.included).toContain('creativeRules')
    expect(candidate.budget.calls).toBe(1)
    expect(candidate.context.inputTokens).toBeLessThanOrEqual(16_000)
    expect(candidate.findings.some(finding => finding.category === '伪造正文')).toBe(false)
    expect(candidate.findings.find(finding => finding.category === '伪造证据')?.severity).toBe('unknown')
    expect(candidate.findings.some(finding => (
      finding.category === '物品' && finding.severity === 'hard'
    ))).toBe(true)
  })

  it('报告写入归档事件流后可刷新恢复，同正文同模式重跑只更新一个事件', async () => {
    const { project, targetChapterId } = await seedConsistencyProject()
    const candidate = await runBackgroundConsistencyAgent({
      projectId: project.id!,
      chapterId: targetChapterId,
      chapterTitle: '第二章 重逢',
      worldGroupId: null,
      chapterContent: targetHtml,
      budget: new AgentTeamBudgetTracker('economy'),
    })
    const first = await persistConsistencyAgentCandidate(candidate)
    const second = await persistConsistencyAgentCandidate({
      ...candidate,
      createdAt: candidate.createdAt + 1,
    })

    expect(second.event.id).toBe(first.event.id)
    expect(await db.agentConversations.count()).toBe(1)
    expect(await db.agentEvents.count()).toBe(1)
    const restored = await readLatestConsistencyAgentRun({
      projectId: project.id!,
      chapterId: targetChapterId,
    })
    expect(restored?.candidate.findings[0].quote).toBe(targetText)
    expect(restored?.conversation.status).toBe('archived')
    expect(await isConsistencyAgentCurrent(restored!.candidate)).toBe(true)
  })

  it('正文变化后旧报告仍可查看但会过期，检测过程不写任何业务表', async () => {
    const { project, targetChapterId } = await seedConsistencyProject()
    const candidate = await runBackgroundConsistencyAgent({
      projectId: project.id!,
      chapterId: targetChapterId,
      chapterTitle: '第二章 重逢',
      worldGroupId: null,
      chapterContent: targetHtml,
      budget: new AgentTeamBudgetTracker('economy'),
    })
    await persistConsistencyAgentCandidate(candidate)
    const before = {
      items: await db.itemLedger.count(),
      facts: await db.temporalFacts.count(),
      states: await db.stateCards.count(),
      chapters: await db.chapters.count(),
    }

    await db.chapters.update(targetChapterId, {
      content: '<p>林舟取出潮汐钥匙。</p>',
    })

    expect(await isConsistencyAgentCurrent(candidate)).toBe(false)
    expect({
      items: await db.itemLedger.count(),
      facts: await db.temporalFacts.count(),
      states: await db.stateCards.count(),
      chapters: await db.chapters.count(),
    }).toEqual(before)
  })

  it('模型返回非 JSON 时显式失败，不保存半份报告', async () => {
    const { project, targetChapterId, targetOutlineId } = await seedConsistencyProject()
    await expect(runConsistencyAgent({
      projectId: project.id!,
      chapterId: targetChapterId,
      outlineNodeId: targetOutlineId,
      chapterTitle: '第二章 重逢',
      worldGroupId: null,
      chapterContent: targetHtml,
      mode: 'deep',
      budget: new AgentTeamBudgetTracker('economy'),
      call: async () => '这不是 JSON',
    })).rejects.toThrow('无法解析')
    expect(await db.agentEvents.count()).toBe(0)
  })
})
