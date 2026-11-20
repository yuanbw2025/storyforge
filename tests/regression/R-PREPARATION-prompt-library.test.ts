import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { parseMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import type { ChatMessage } from '../../src/lib/types'
import { parseInspirationVersions } from '../../src/lib/inspiration/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { usePromptStore } from '../../src/stores/prompt'
import { INSPIRATION_PREPARATION_MODES, INSPIRATION_PREPARATION_MODULES, type InspirationPreparationMode } from '../../src/lib/inspiration/preparation-contract'
import { prepareInspirationCopilot } from '../../src/lib/agent/inspiration-copilot'
import { freezePromptExecutionOptionsV1 } from '../../src/lib/agent/prompt-execution'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { useInspirationWorkspaceStore } from '../../src/stores/inspiration-workspace'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { encodePromptTemplateExchange, decodePromptTemplateExchange } from '../../src/lib/ai/prompt-template-exchange'

const original = usePromptStore.getState()
const candidate = (mode: InspirationPreparationMode) => JSON.stringify({ summary: '准备稿', authorMaterial: '作者的修伞铺', proposals: mode === 'organize' ? [] : Array.from({ length: mode === 'compare' || mode === 'position-open' ? 2 : 1 }, (_, i) => ({ title: `方向${i}`, content: '可审阅的具体提议' })), openQuestions: [] })
beforeEach(async () => { await db.delete(); await db.open(); usePromptStore.setState({ templates: [], loaded: false }) })
afterEach(() => { usePromptStore.setState(original); db.close() })

describe('R-PREPARATION · 提示词库、功能引用与真实发送一致', () => {
  it.each([false, true])('完整反推由工作区模式选择并冻结原模板，多世界=%s', async multi => {
    await usePromptStore.getState().init()
    const { project } = await seedCurrentWorkspace('完整反推模块')
    await db.projects.update(project.id!, { enableMultiWorld: multi })
    const plan = await createMasterAgentPlan({ projectId: project.id!, worldGroupId: null, request: '完整反推这份灵感', pinnedTask: { agentId: 'inspiration', skillId: 'inspiration.reverse', instruction: '完整反推这份灵感' } })
    const expected = multi ? 'inspiration.reverse.multiworld' : 'inspiration.reverse'
    expect(plan.tasks[0].promptExecution?.moduleKey).toBe(expected)
    expect(plan.tasks[0].instruction).toContain(`灵感反推模式=${multi ? 'multiworld' : 'single'}`)
    expect(parseMasterAgentPlanV1(plan).tasks[0].promptExecution?.templateHash).toBe(plan.tasks[0].promptExecution?.templateHash)
  })

  it('旧库补齐五个独立模块，保留作者模板与激活状态，支持原导入导出', async () => {
    await db.promptTemplates.add({ scope: 'user', moduleKey: 'inspiration.reverse', promptType: 'generate', name: '作者原模板', description: '', systemPrompt: '原文不变', userPromptTemplate: '{{inspiration}}', variables: ['inspiration'], isActive: true, createdAt: 1, updatedAt: 1 })
    await usePromptStore.getState().init()
    const templates = usePromptStore.getState().templates
    const preparation = templates.filter(t => new Set<string>(Object.values(INSPIRATION_PREPARATION_MODULES)).has(t.moduleKey))
    expect(preparation).toHaveLength(5)
    for (const mode of INSPIRATION_PREPARATION_MODES) expect(usePromptStore.getState().getActive(INSPIRATION_PREPARATION_MODULES[mode]).systemPrompt).toContain('产物是可审阅的准备材料')
    expect(usePromptStore.getState().getActive('inspiration.reverse')).toMatchObject({ name: '作者原模板', systemPrompt: '原文不变', isActive: true })
    expect(decodePromptTemplateExchange(encodePromptTemplateExchange(preparation)).map(t => t.moduleKey)).toEqual(preparation.map(t => t.moduleKey))
    await usePromptStore.getState().importTemplates(encodePromptTemplateExchange(preparation))
    expect(usePromptStore.getState().templates.filter(t => t.scope === 'user' && t.moduleKey.startsWith('inspiration.prepare.'))).toHaveLength(5)
    expect(usePromptStore.getState().templates.filter(t => t.scope === 'user' && t.moduleKey.startsWith('inspiration.prepare.')).every(t => !t.isActive)).toBe(true)
  })

  it.each(INSPIRATION_PREPARATION_MODES)('%s实际使用作者激活模板、参数、示例；冻结后切换模板不改变请求', async mode => {
    await usePromptStore.getState().init()
    const moduleKey = INSPIRATION_PREPARATION_MODULES[mode]
    const seed = usePromptStore.getState().getActive(moduleKey)
    const id = await usePromptStore.getState().cloneTemplate(seed.id!, `作者模板-${mode}`)
    const author = usePromptStore.getState().templates.find(t => t.id === id)!
    await usePromptStore.getState().saveTemplate({ ...author, systemPrompt: `作者自定-${mode} {{voice}}`, userPromptTemplate: '作者User {{inspiration}} {{userHint}}', parameters: [{ key: 'voice', label: '口吻', type: 'text', default: '默认口吻' }], examples: { good: [{ id: 'ex', text: '作者好示例标记', source: 'user-marked', createdAt: 1 }] } })
    await usePromptStore.getState().setActive(id)
    const active = usePromptStore.getState().getActive(moduleKey)
    const options = await freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey, parameterValues: { voice: '本轮口吻' } }, template: active })
    const { project, scope } = await seedCurrentWorkspace('修伞铺')
    const fragment = await useInspirationWorkspaceStore.getState().addFragment(scope, { text: '作者的修伞铺', sourceKind: 'author' })
    const runAI = vi.fn(async (_messages: ChatMessage[]) => candidate(mode))
    const prepared = await prepareInspirationCopilot({ projectId: project.id!, scope, skillId: 'inspiration.prepare', selectedFragmentIds: [fragment!.id], authorRequest: `灵感准备任务=${mode}。保留修伞铺。`, promptExecution: options }, { runAI })
    await usePromptStore.getState().setActive(seed.id!)
    expect((await runGenerationNode(prepared.node, prepared.prepared)).gate?.status).toBe('pass')
    const messages = runAI.mock.calls[0][0] as Array<{ content: string }>
    const text = messages.map(m => m.content).join('\n')
    expect(text).toContain(`作者自定-${mode} 本轮口吻`)
    expect(text).toContain('作者User')
    expect(text).toContain('作者好示例标记')
    expect(text).not.toContain('作者可从世界、人物、片段或已有稿任一起步')
    expect(prepared.promptExecutionEvidence).toMatchObject({ moduleKey, templateId: id, templateHash: options.templateHash, renderedPromptHash: await hashCanonicalValue(messages) })
    expect(await db.worldviews.count()).toBe(0)
    expect(parseInspirationVersions((await db.inspirationWorkspaces.toArray())[0].versions)).toEqual([])
  })

  it('功能临时修改进入真实消息；跨动作配置在模型前拒绝', async () => {
    await usePromptStore.getState().init()
    const { project, scope } = await seedCurrentWorkspace('本轮配置')
    const fragment = await useInspirationWorkspaceStore.getState().addFragment(scope, { text: '指定素材', sourceKind: 'author' })
    const moduleKey = INSPIRATION_PREPARATION_MODULES.organize
    const options = await freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey, systemOverride: '本轮System标记', userOverride: '本轮User标记（故意省略资料变量）' }, template: usePromptStore.getState().getActive(moduleKey) })
    const runAI = vi.fn(async (_messages: ChatMessage[]) => candidate('organize'))
    const input = { projectId: project.id!, scope, skillId: 'inspiration.prepare' as const, selectedFragmentIds: [fragment!.id], authorRequest: '灵感准备任务=organize。', promptExecution: options }
    const prepared = await prepareInspirationCopilot(input, { runAI })
    await runGenerationNode(prepared.node, prepared.prepared)
    expect(JSON.stringify(runAI.mock.calls[0])).toContain('本轮System标记')
    expect(JSON.stringify(runAI.mock.calls[0])).toContain('本轮User标记')
    expect(JSON.stringify(runAI.mock.calls[0])).toContain('指定素材')
    expect(prepared.promptExecutionEvidence?.renderedPromptHash).toBe(await hashCanonicalValue(runAI.mock.calls[0][0]))
    runAI.mockClear()
    await expect(prepareInspirationCopilot({ ...input, authorRequest: '灵感准备任务=position-defined。' }, { runAI })).rejects.toThrow('moduleKey 与 Skill 不一致')
    expect(runAI).not.toHaveBeenCalled()
    const overBudget = await freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey, maxTokens: 16000 }, template: usePromptStore.getState().getActive(moduleKey) })
    await expect(prepareInspirationCopilot({ ...input, promptExecution: overBudget }, { runAI })).rejects.toThrow('输出上限超过当前任务预算')
    expect(runAI).not.toHaveBeenCalled()
  })
})
