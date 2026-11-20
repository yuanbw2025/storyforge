import { afterEach, describe, expect, it } from 'vitest'
import { usePromptStore } from '../../src/stores/prompt'
import { TOOL_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-tools'
import { buildStyleCalibrationPrompt } from '../../src/lib/ai/adapters/style-adapter'
import { buildSceneVerifyPrompt } from '../../src/lib/ai/adapters/scene-verify-adapter'
import { buildStyleLearningAgentMessagesV1, readStyleLearningBaselineV1 } from '../../src/lib/style/learning-agent'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { db } from '../../src/lib/db/schema'

const original = usePromptStore.getState().templates
function authorTemplate(moduleKey: 'style.learn' | 'style.calibrate' | 'scene.verify') {
  const seed = TOOL_PROMPT_SEEDS.find(seed => seed.moduleKey === moduleKey)!
  return { ...seed, id: 987, scope: 'user' as const, name: '作者自定模板', systemPrompt: '作者自定：保持朴素口吻。', isActive: true, createdAt: 1, updatedAt: 2 }
}
afterEach(() => { usePromptStore.setState({ templates: original }); db.close() })
describe('准备内容方法进入实际模板路径', () => {
  it('学习使用真实绑定的数量、保留作者模板，并冻结证据边界', () => {
    const template = authorTemplate('style.learn'), before = JSON.stringify(template)
    const messages = buildStyleLearningAgentMessagesV1({ template, registeredContext: '登记样本：作者的原文片段', sampleCount: 2, sampleWords: 168 })
    const prompt = messages.map(message => message.content).join('\n')
    expect(prompt).toContain('作者自定：保持朴素口吻')
    expect(prompt).toContain('共 2 章、约 168 字')
    expect(prompt).not.toContain('共 0 章、约 0 字')
    expect(prompt).not.toContain('角色口头禅不能升级为全书旁白')
    expect(TOOL_PROMPT_SEEDS.find(seed => seed.moduleKey === 'style.learn')!.systemPrompt).toContain('角色口头禅不能升级为全书旁白')
    expect(JSON.stringify(template)).toBe(before)
  })
  it('校准和研究使用库中可编辑方法，作者激活模板不受隐藏指令覆盖', () => {
    const calibration = authorTemplate('style.calibrate')
    const research = authorTemplate('scene.verify')
    usePromptStore.setState({ templates: [calibration, research] })
    const before = JSON.stringify(usePromptStore.getState().templates)
    const calibrated = buildStyleCalibrationPrompt({ profile: '', sourceText: '她说我不答应。' }).map(m => m.content).join('\n')
    expect(calibrated).toContain('作者自定：保持朴素口吻')
    expect(calibrated).not.toContain('温暖不等于擅自增加和解')
    usePromptStore.setState({ templates: [] })
    expect(buildStyleCalibrationPrompt({ profile: '', sourceText: '她说我不答应。' }).map(m => m.content).join('\n')).toContain('温暖不等于擅自增加和解')
    const planned = buildSceneVerifyPrompt({ worldContext: '作者提供的原文', historyContext: '', worldRulesContext: '', scene: '码头生活', researchMode: 'plan', hasSuppliedSources: false }).map(m => m.content).join('\n')
    expect(planned).toContain('未读取到可用外部资料')
    expect(planned).toContain('未执行联网检索')
    expect(planned).toContain('制订研究计划')
    expect(planned).not.toContain('只审读作者提供资料')
    const reviewed = buildSceneVerifyPrompt({ worldContext: '作者提供的原文', historyContext: '', worldRulesContext: '', scene: '码头生活', researchMode: 'sources', hasSuppliedSources: true })
    expect(reviewed.map(m => m.content).join('\n')).toContain('只审读作者提供资料')
    usePromptStore.setState({ templates: [calibration, research] })

    expect(JSON.stringify(usePromptStore.getState().templates)).toBe(before)
  })
  it('正式学习没有样本和改稿对照时仍在模型前拒绝', async () => {
    await db.delete(); await db.open()
    const { scope } = await seedCurrentWorkspace('无样本文风准入')
    await expect(readStyleLearningBaselineV1({ scope, chapterIds: [] })).rejects.toThrow('至少需要一章合格正文或一组已保存改稿对照')
  })
})
