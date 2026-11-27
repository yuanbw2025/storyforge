import { resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMasterAgentPlan,
  createMasterAgentReplanV1,
  type MasterAgentPlan,
} from '../../src/lib/agent/orchestrator'
import { chat } from '../../src/lib/ai/client'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { db } from '../../src/lib/db/schema'
import type { Project } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { putCurrentWorkspaceFixtureV1 } from '../helpers/current-workspace'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

const project: Project = {
  id: 73110,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000073110',
  workspacePurpose: 'independent-work',
  name: '主 Agent 计划配额测试',
  enableMultiWorld: false,
  activeWorldId: 73110,
  activeWorkId: 73110,
  createdAt: 1,
  updatedAt: 1,
}

const planJson = JSON.stringify({
  summary: '先设定世界，再创建角色，然后逐章生成正文。',
  tasks: [
    { id: 'world', agentId: 'world-origin', instruction: '建立潮汐世界', dependsOn: [] },
    { id: 'hero', agentId: 'character', instruction: '设计守灯人主角', dependsOn: ['world'] },
    { id: 'prose-1', agentId: 'prose', instruction: '写第一章《海床之光》正文', dependsOn: ['hero'] },
    { id: 'prose-2', agentId: 'prose', instruction: '写第二章《雾中钟声》正文', dependsOn: ['prose-1'] },
  ],
})

describe('B10d · 主 Agent 计划/重规划派发不再带固定输出配额', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete()
    await db.open()
    resetModelCapacityForTestsV1()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.setState({ presets: [], taskRoutes: {} })
    db.close()
  })

  it('任务规划调用不再注入固定 1,800 maxTokens，整卷长计划不被截断退回小计划', async () => {
    await putCurrentWorkspaceFixtureV1(project)
    const seenMeta: { configOverrides?: { maxTokens?: number; temperature?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number; temperature?: number } })
      return planJson
    })
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '建立潮汐世界，设计守灯人主角，然后逐章写完前两章正文',
    })
    expect(chat).toHaveBeenCalledOnce()
    // 旧实现在这条多任务规划调用上注入固定 maxTokens: 1_800；整卷/全书的逐章
    // 任务计划超过该额度时被截断，JSON 解析失败后退回每领域一任务的确定性
    // 小计划，形成事实上的章数配额。新实现按连接配置执行（作者显式上限或
    // 容量自动），wire 输出不带应用固定配额。
    const overrides = seenMeta[0]!.configOverrides
    expect(overrides?.maxTokens).toBeUndefined()
    expect(overrides?.temperature).toBe(0.2)
    expect(plan.tasks.map(task => task.id)).toEqual(['world', 'hero', 'prose-1', 'prose-2'])
  })

  it('自由讨论保持其专用应答上限（非任务规划路径不受本片影响）', async () => {
    await putCurrentWorkspaceFixtureV1(project)
    const seenMeta: { configOverrides?: { maxTokens?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number } })
      return '潮汐世界的基调可以偏温柔一点，先从守灯人的日常写起。'
    })
    const plan = await createMasterAgentPlan({
      projectId: project.id!,
      worldGroupId: null,
      request: '聊聊潮汐世界的基调',
      freeDiscussion: true,
    })
    expect(chat).toHaveBeenCalledOnce()
    expect(seenMeta[0]!.configOverrides?.maxTokens).toBe(8192)
    expect(plan.tasks).toHaveLength(0)
  })

  it('重规划补丁调用不再注入固定 1,200 maxTokens，多下游任务补丁不被截断', async () => {
    await putCurrentWorkspaceFixtureV1(project)
    const seenMeta: { configOverrides?: { maxTokens?: number; temperature?: number } }[] = []
    vi.mocked(chat).mockImplementation(async (_messages, _config, meta) => {
      seenMeta.push(meta as { configOverrides?: { maxTokens?: number; temperature?: number } })
      return JSON.stringify({
        summary: '收紧失败章与其下游章的指令。',
        tasks: [
          { id: 'prose-1', instruction: '重写第一章《海床之光》正文，退潮视角从灯塔写起', dependsOn: ['hero'] },
          { id: 'prose-2', instruction: '重写第二章《雾中钟声》正文，衔接新第一章结尾', dependsOn: ['prose-1'] },
        ],
      })
    })
    const basePlan: MasterAgentPlan = {
      summary: '逐章生成前两章正文。',
      tasks: [
        { id: 'hero', agentId: 'character', skillId: 'character.create', instruction: '设计守灯人主角', dependsOn: [] },
        { id: 'prose-1', agentId: 'prose', skillId: 'prose.generate', instruction: '写第一章《海床之光》正文', dependsOn: ['hero'] },
        { id: 'prose-2', agentId: 'prose', skillId: 'prose.generate', instruction: '写第二章《雾中钟声》正文', dependsOn: ['prose-1'] },
      ],
      workflow: { version: 1, workflowId: 'multi-domain-sequential', reasonCodes: ['multiple-explicit-domains'] },
    }
    const replanned = await createMasterAgentReplanV1({
      projectId: project.id!,
      plan: basePlan,
      failures: [{ taskId: 'prose-1', code: 'candidate_invalid', category: 'structure', fingerprint: 'fp-1' }],
      budget: new AgentTeamBudgetTracker('service-capacity'),
    })
    expect(chat).toHaveBeenCalledOnce()
    // 旧实现在这条受限重规划调用上注入固定 maxTokens: 1_200；整卷/全书运行中
    // 失败章的下游任务补丁超过该额度时被截断，重规划整体失败。新实现按连接
    // 配置执行；预算预留（1,200 预测）仍是纯会计证据。
    const overrides = seenMeta[0]!.configOverrides
    expect(overrides?.maxTokens).toBeUndefined()
    expect(overrides?.temperature).toBe(0.1)
    const patched = replanned.tasks.find(task => task.id === 'prose-1')!
    expect(patched.instruction).toContain('退潮视角从灯塔写起')
  })
})
