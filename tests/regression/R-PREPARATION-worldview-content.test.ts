import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { prepareWorldviewFieldCopilot, formatWorldviewFieldGenerationRequestV1 } from '../../src/lib/agent/worldview-field-copilot'
import { createPromptExecutionRequestV1, freezePromptExecutionOptionsV1 } from '../../src/lib/agent/prompt-execution'
import { worldviewFieldContentGuidanceV1 } from '../../src/lib/creation/worldview-content-skill'
import { runGenerationNode } from '../../src/lib/generation/generation-node'

describe('创作准备 · 世界方法实际冻结与作者模板', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it.each([false, true])('共同入口实际发送目标领域方法，作者模板路径=%s，生成不提前写入', async custom => {
    const { project, scope } = await seedCurrentWorkspace('阿照修船铺')
    const template = { id: 71, scope: 'user' as const, moduleKey: 'worldview.dimension' as const, promptType: 'generate', name: '作者经济模板', description: '', systemPrompt: '以朴素口吻写修船行业', userPromptTemplate: '{{dimension}}：{{projectName}}', variables: ['dimension', 'projectName'], isActive: true, createdAt: 10, updatedAt: 20 }
    const original = JSON.stringify(template)
    const options = custom ? await freezePromptExecutionOptionsV1({ request: createPromptExecutionRequestV1({ moduleKey: 'worldview.dimension' }), template }) : undefined
    let sent = ''
    const prepared = await prepareWorldviewFieldCopilot({ projectId: project.id!, scope, worldGroupId: null, authorRequest: formatWorldviewFieldGenerationRequestV1({ field: 'economyOverview', mode: 'expand', hint: '保留阿照修船铺，温暖经营' }), promptExecution: options }, { runAI: async messages => { sent = messages.map(m => m.content).join('\n'); return JSON.stringify({ field: 'economyOverview', value: '阿照提前预订晒干木料；公用船台按出航日期协商排期。' }) } })
    const result = await runGenerationNode(prepared.node, prepared.prepared)
    expect(result.gate?.status).toBe('pass')
    expect(sent).toContain(worldviewFieldContentGuidanceV1('economyOverview'))
    expect(sent).not.toContain(worldviewFieldContentGuidanceV1('divineDesign'))
    expect(sent).toContain('只允许生成这个字段')
    if (custom) { expect(sent).toContain(template.systemPrompt); expect(prepared.promptExecutionEvidence?.templateId).toBe(71) }
    expect(JSON.stringify(template)).toBe(original)
    expect(await db.worldviews.count()).toBe(0)
  })
})
