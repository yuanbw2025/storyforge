import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { parseMasterAgentPlanV1, runDurableMasterAgentPlanV1, restoreMasterAgentCandidatesV1 } from '../../src/lib/agent/run/master-durable'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { createContextAccessPolicyFromSkillV1 } from '../../src/lib/context-gateway/skill-policy'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { contextAccessPolicyHashV1 } from '../../src/lib/context-gateway/contracts'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { usePromptStore } from '../../src/stores/prompt'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { STORY_CORE_PREVIOUS_SEEDS } from '../../src/lib/ai/story-core-seed-history'
import { STORY_CORE_CONTENT_METHODS, STORY_CORE_MODE_METHODS, storyCoreMethodFlags } from '../../src/lib/creation/story-core-content-skill'
import { renderPrompt } from '../../src/lib/ai/prompt-engine'
import { prepareStoryCoreCopilot, formatStoryCoreGenerationRequestV1, parseStoryCoreCandidateDraft } from '../../src/lib/agent/story-core-copilot'
import { freezePromptExecutionOptionsV1 } from '../../src/lib/agent/prompt-execution'

const seed = SYSTEM_PROMPT_SEEDS.find(item => item.moduleKey === 'story.generate')!
const template = { ...seed, createdAt: 1, updatedAt: 1 }
describe.sequential('故事核心可编辑方法与实际请求', () => {
  beforeEach(async () => { await db.delete(); await db.open(); usePromptStore.setState({ templates: [], loaded: false }) })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })
  it('服务容量模式不受旧七次或总 token 额度影响，可恢复计量，权限改变仍使 hash 改变', async () => {
    let tracker = new AgentTeamBudgetTracker('service-capacity')
    for (let index = 0; index < 12; index++) {
      const call = tracker.reserveCall({ label: '容量验证', messages: [{ role: 'user', content: '原始资料' }], maxOutputTokens: 1000000 })
      tracker.settleCall(call, '候选')
      tracker = new AgentTeamBudgetTracker('service-capacity', tracker.snapshot())
    }
    expect(tracker.snapshot().calls).toBe(12)
    const policy = createContextAccessPolicyFromSkillV1(getAgentSkillV1('world-origin.story-core'))
    expect(await contextAccessPolicyHashV1(policy)).toBe(await contextAccessPolicyHashV1({ ...policy, maxRetrievedTokens: 2000000 }))
    expect(await contextAccessPolicyHashV1(policy)).not.toBe(await contextAccessPolicyHashV1({ ...policy, allowedSourceKeys: ['ragSelection'] }))
  })
  it('大候选可进入durable并恢复，不受旧120K持久化长度限制', async () => {
    const { project, scope } = await seedCurrentWorkspace('长候选')
    const value = '完整故事核心候选。'.repeat(20000)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ field: 'concept', value }) } }] }), { status: 200 })))
    const conversation = await getOrCreateAgentConversation({ projectId: project.id!, scope, worldGroupId: null, purpose: 'story-core-generation' })
    const plan = parseMasterAgentPlanV1({ summary: '故事核心', workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] }, tasks: [{ id: 'large-core', agentId: 'world-origin', skillId: 'world-origin.story-core', instruction: '目标字段=concept；生成模式=expand。', dependsOn: [] }] })
    const run = await runDurableMasterAgentPlanV1({ scope, worldGroupId: null, conversationId: conversation.id!, plan })
    const restored = await restoreMasterAgentCandidatesV1({ scope, runId: run.runId })
    expect(JSON.parse(restored.candidates[0].draft).value).toBe(value)
    expect(await db.storyCores.count()).toBe(0)
  })
  it('七字段、四种模式和所有类型包只选择本次方法，不把未选分支发送出去', () => {
    for (const item of SYSTEM_PROMPT_SEEDS.filter(item => item.moduleKey === 'story.generate')) {
      for (const [field, method] of Object.entries(STORY_CORE_CONTENT_METHODS)) {
        for (const [mode, operation] of Object.entries(STORY_CORE_MODE_METHODS)) {
          const rendered = renderPrompt({ ...item, createdAt: 1, updatedAt: 1 }, { ...storyCoreMethodFlags(field, mode), projectName: '原创', genres: '', dimension: field, generationMode: mode, currentValue: '原文', worldContext: '资料', userHint: '' })
          const system = rendered.messages[0].content
          expect(system).toContain(method)
          expect(system).toContain(operation)
          for (const [other, text] of Object.entries(STORY_CORE_CONTENT_METHODS)) if (other !== field) expect(system).not.toContain(text)
          expect(system).not.toContain('{{')
        }
      }
    }
  })
  it('已有安装更新默认内置并存历史，保留自定义模板与激活选择，重复初始化不再克隆', async () => {
    const old = { ...template, ...STORY_CORE_PREVIOUS_SEEDS[seed.name], isActive: true }
    await db.promptTemplates.add(old)
    await usePromptStore.getState().init()
    expect(usePromptStore.getState().getActive('story.generate').systemPrompt).toBe(seed.systemPrompt)
    const history = await db.promptTemplates.where('scope').equals('user').toArray()
    expect(history.some(item => item.systemPrompt === old.systemPrompt && !item.isActive)).toBe(true)
    const id = await usePromptStore.getState().cloneTemplate(usePromptStore.getState().getActive('story.generate').id!, '作者自用')
    const custom = usePromptStore.getState().templates.find(item => item.id === id)!
    await usePromptStore.getState().saveTemplate({ ...custom, systemPrompt: '作者自用方法' })
    await usePromptStore.getState().setActive(id)
    usePromptStore.setState({ loaded: false }); await usePromptStore.getState().init()
    expect(usePromptStore.getState().getActive('story.generate').systemPrompt).toBe('作者自用方法')
    expect(await db.promptTemplates.where('scope').equals('user').count()).toBe(history.length + 1)
  })
  it('直接编辑过的内置模板保留作者版本及激活', async () => {
    await db.promptTemplates.add({ ...template, systemPrompt: '作者已改写内置', isActive: true })
    await usePromptStore.getState().init()
    expect(usePromptStore.getState().getActive('story.generate')).toMatchObject({ scope: 'user', systemPrompt: '作者已改写内置', isActive: true })
  })
  it('没有显式模板也发送激活模板；冻结覆盖、完整作者意图和当前原文进入实际请求，候选仍不写库', async () => {
    const { scope, project } = await seedCurrentWorkspace('候鸟时刻表')
    await db.works.update(scope.workId, { description: '车站调度员收集候鸟误点记录，温暖轻喜剧，无死亡与阴谋。' })
    const config = { provider: 'openai' as const, apiKey: '', baseUrl: '', model: 'gpt-4o', maxTokens: 4096, temperature: 0.5 }
    const longInstruction = formatStoryCoreGenerationRequestV1({ field: 'concept', mode: 'expand', hint: '完整作者方向'.repeat(3000) })
    expect(parseMasterAgentPlanV1({ summary: '故事核心', workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] }, tasks: [{ id: 'core', agentId: 'world-origin', skillId: 'world-origin.story-core', instruction: longInstruction, requestContext: { originalRequest: longInstruction, plannerInstruction: longInstruction }, dependsOn: [] }] }).tasks[0].instruction).toBe(longInstruction)
    const pinned = await createMasterAgentPlan({ projectId: project.id!, scope, worldGroupId: null, request: longInstruction, pinnedTask: { agentId: 'world-origin', skillId: 'world-origin.story-core', instruction: longInstruction } })
    expect(pinned.tasks[0].instruction).toBe(longInstruction)
    const prepared = await prepareStoryCoreCopilot({ projectId: project.id!, scope, worldGroupId: null, configOverride: config, authorRequest: formatStoryCoreGenerationRequestV1({ field: 'concept', mode: 'expand', hint: '从一张被鸟啄破的时刻表出发。'.repeat(800) }) })
    const messages = prepared.prepared.messages.map(item => item.content).join('\n')
    expect(messages).toContain('车站调度员收集候鸟误点记录')
    expect(messages).toContain(STORY_CORE_CONTENT_METHODS.concept)
    expect(messages).toContain(STORY_CORE_MODE_METHODS.create)
    expect(messages).not.toContain('作者所选基调：严肃')
    expect(prepared.contextSources).toContain('workAuthoringIntent')
    const frozen = await freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey: 'story.generate', systemOverride: '临时方法：只处理一张时刻表。' }, template })
    const overridden = await prepareStoryCoreCopilot({ projectId: project.id!, scope, worldGroupId: null, configOverride: config, authorRequest: '目标字段=concept；生成模式=polish。', promptExecution: frozen })
    expect(overridden.prepared.messages[0].content).toContain('临时方法：只处理一张时刻表。')
    expect(overridden.prepared.messages[0].content).not.toContain(STORY_CORE_CONTENT_METHODS.concept)
    expect(await db.storyCores.count()).toBe(0)
    expect(parseStoryCoreCandidateDraft(JSON.stringify({ field: 'concept', value: '完整候选'.repeat(20000) })).value.length).toBe(80000)
    expect(() => parseStoryCoreCandidateDraft('{"field":"concept","value":"候选","theme":"越界"}')).toThrow()
  })
})
