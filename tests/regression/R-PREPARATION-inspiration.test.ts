import { selectAgentSkillIdV1 } from '../../src/lib/agent/workflow-catalog'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useInspirationWorkspaceStore } from '../../src/stores/inspiration-workspace'
import { prepareInspirationCopilot, parseInspirationCandidateDraft, InspirationCopilotStaleError } from '../../src/lib/agent/inspiration-copilot'
import { runGenerationNode, adoptGenerationNodeOutput } from '../../src/lib/generation/generation-node'
import { parseInspirationVersions } from '../../src/lib/inspiration/workspace'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { INSPIRATION_PREPARATION_MODES, inspirationDirectionIndexFromRequest, type InspirationPreparationMode } from '../../src/lib/inspiration/preparation'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { finiteServiceConfigFixtureV1 } from '../helpers/model-capacity-fixture'

const candidate = (mode: InspirationPreparationMode) => ({ summary: '阿照修船铺保留雾中归船与温暖经营。', authorMaterial: '作者原创：阿照、修船铺、雾中归船。', proposals: mode === 'organize' ? [] : mode === 'compare' || mode === 'position-open' ? [{ title: '经营', content: '围绕不同修船委托与铺子成长，重在手艺和经营。' }, { title: '离人与归客', content: '围绕船带回的关系与人的去留，重在重逢。' }] : [{ title: '委托与排期', content: '深入一次修船排期的商量，保留归船未知，不补全世界史。' }], openQuestions: [] })

describe('R-PREPARATION-inspiration · 轻量准备沿原候选与版本生命周期', () => {
  let originalAIState: ReturnType<typeof useAIConfigStore.getState>
  beforeEach(async () => { originalAIState = useAIConfigStore.getState(); await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); useAIConfigStore.setState(originalAIState); db.close() })
  it.each(INSPIRATION_PREPARATION_MODES)('%s只读取选择素材，确认前零版本，确认后按原版本库回读', async mode => {
    expect(selectAgentSkillIdV1('inspiration', `灵感准备任务=${mode}。保留阿照。`)).toBe('inspiration.prepare')
    const { project, scope } = await seedCurrentWorkspace('阿照修船铺')
    if (mode === 'compare') await db.projects.update(project.id!, { enableMultiWorld: true })
    const store = useInspirationWorkspaceStore.getState()
    const fragment = await store.addFragment(scope, { text: '阿照修船铺，雾中老船自己归来。温暖经营。', sourceKind: 'author' })
    await store.addFragment(scope, { text: '本轮不选择的秘密材料', sourceKind: 'reference' })
    let prompt = ''
    const prepared = await prepareInspirationCopilot({ projectId: project.id!, scope, selectedFragmentIds: [fragment!.id], skillId: 'inspiration.prepare', authorRequest: `灵感准备任务=${mode}。保留阿照。` }, { runAI: async messages => { prompt = messages.map(m => m.content).join('\n'); return JSON.stringify(candidate(mode)) } })
    expect(prepared.mode).toBe(mode)
    const workBefore = await db.works.get(scope.workId)
    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    expect(generated.gate?.status).toBe('pass')
    expect(prompt).toContain('阿照修船铺')
    expect(prompt).not.toContain('本轮不选择的秘密材料')
    expect(parseInspirationVersions((await db.inspirationWorkspaces.toArray())[0].versions)).toHaveLength(0)
    await adoptGenerationNodeOutput(prepared.node, generated.output)
    const saved = parseInspirationVersions((await db.inspirationWorkspaces.toArray())[0].versions)
    expect(saved[0].mode).toBe(mode)
    expect(JSON.parse(saved[0].resultJson)).toEqual(candidate(mode))
    expect(await db.worldviews.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
    expect(await db.storyCores.count()).toBe(0)
    expect(await db.works.get(scope.workId)).toEqual(workBefore)
  })
  it('最后的方向标记非法时拒绝，不把小数截成另一个有效选择或回退旧选择', () => {
    expect(() => inspirationDirectionIndexFromRequest('灵感方向选择=1。现改灵感方向选择=1.5。')).toThrow('方向序号')
    expect(() => inspirationDirectionIndexFromRequest('灵感方向选择=2。现改灵感方向选择=。')).toThrow('方向序号')
  })
  it('结构拒绝完整世界空壳、额外字段及不符动作的方向数量', () => {
    expect(() => parseInspirationCandidateDraft('{"worldview":{},"characters":[]}', 'organize')).toThrow()
    expect(() => parseInspirationCandidateDraft(JSON.stringify({ ...candidate('deepen'), worldOrigin: '不允许写入' }), 'deepen')).toThrow()
    expect(() => parseInspirationCandidateDraft(JSON.stringify(candidate('organize')), 'compare')).toThrow()
    expect(() => parseInspirationCandidateDraft(JSON.stringify(candidate('deepen')), 'position-open')).toThrow()
    expect(() => parseInspirationCandidateDraft(JSON.stringify(candidate('compare')), 'position-defined')).toThrow()
  })
  it.each(['organize', 'position-open', 'position-defined'] as const)('%s素材变化后拒绝旧候选，准备版本随项目导出导入和删除保持隔离', async mode => {
    const { project, scope } = await seedCurrentWorkspace('准备生命周期')
    const store = useInspirationWorkspaceStore.getState()
    const fragment = await store.addFragment(scope, { text: '阿照要修一条不认得主人的旧船' })
    const input = { projectId: project.id!, scope, selectedFragmentIds: [fragment!.id], skillId: 'inspiration.prepare' as const, authorRequest: `灵感准备任务=${mode}。先整理。` }
    const deps = { runAI: async () => JSON.stringify(candidate(mode)) }
    const stale = await prepareInspirationCopilot(input, deps)
    await store.addFragment(scope, { text: '作者新增的材料' })
    await expect(adoptGenerationNodeOutput(stale.node, candidate(mode))).rejects.toBeInstanceOf(InspirationCopilotStaleError)
    const fresh = await prepareInspirationCopilot(input, deps)
    const generated = await runGenerationNode(fresh.node, fresh.prepared)
    await adoptGenerationNodeOutput(fresh.node, generated.output)
    const exported = await exportProjectJSON(project.id!)
    const importedId = await importProjectJSON(exported)
    const imported = await db.inspirationWorkspaces.where('projectId').equals(importedId).first()
    expect(parseInspirationVersions(imported!.versions)[0].mode).toBe(mode)
    expect(JSON.parse(parseInspirationVersions(imported!.versions)[0].resultJson)).toEqual(candidate(mode))
    await cascadeDeleteProject(project.id!)
    expect(await db.inspirationWorkspaces.where('projectId').equals(project.id!).count()).toBe(0)
    expect(await db.inspirationWorkspaces.where('projectId').equals(importedId).count()).toBe(1)
  })
  async function largePreparationInput() {
    const { project, scope } = await seedCurrentWorkspace('完整素材预算')
    const ids: string[] = []
    const texts: string[] = []
    for (let index = 0; index < 24; index++) {
      const fragment = await useInspirationWorkspaceStore.getState().addFragment(scope, { text: `${index}：${'原始意象不可静默丢弃'.repeat(180)}`.slice(0, 2000) })
      ids.push(fragment!.id)
      texts.push(fragment!.text)
    }
    return { project, scope, ids, texts, before: await db.inspirationWorkspaces.toArray() }
  }

  it('实际服务容量不足时在模型前明确拒绝，不只整理前几个碎片', async () => {
    useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(2000), presets: [], taskRoutes: {} })
    const { project, scope, ids, before } = await largePreparationInput()
    const fetcher = vi.fn(async () => { throw new Error('Unexpected model transport request') })
    vi.stubGlobal('fetch', fetcher)
    // A custom runAI bypasses chat's physical-window check. Exercise the real
    // dispatch guard with evidenced service capacity and reject before fetch.
    const prepared = await prepareInspirationCopilot({ projectId: project.id!, scope, selectedFragmentIds: ids, skillId: 'inspiration.prepare', authorRequest: '灵感准备任务=organize。整理全部所选素材。' })
    await expect(runGenerationNode(prepared.node, prepared.prepared)).rejects.toThrow(/预算|上下文|窗口/)
    expect(fetcher).not.toHaveBeenCalled()
    expect(await db.inspirationWorkspaces.toArray()).toEqual(before)
  })

  it('实际服务容量充足时把全部所选原文送入候选，不沿用旧11k应用配额', async () => {
    useAIConfigStore.setState({ config: await finiteServiceConfigFixtureV1(128_000), presets: [], taskRoutes: {} })
    const { project, scope, ids, texts, before } = await largePreparationInput()
    let calls = 0
    let prompt = ''
    const prepared = await prepareInspirationCopilot({ projectId: project.id!, scope, selectedFragmentIds: ids, skillId: 'inspiration.prepare', authorRequest: '灵感准备任务=organize。整理全部所选素材。' }, { runAI: async messages => {
      calls++
      prompt = messages.map(message => message.content).join('\n')
      return JSON.stringify(candidate('organize'))
    } })
    expect(calls).toBe(0)
    expect(prepared.selectedFragmentIds).toEqual(ids)
    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    expect(generated.gate?.status).toBe('pass')
    expect(calls).toBe(1)
    for (const text of texts) expect(prompt).toContain(text)
    expect(await db.inspirationWorkspaces.toArray()).toEqual(before)
    expect(parseInspirationVersions(before[0].versions)).toHaveLength(0)
  })

  it.each([{ compareMode: 'compare', deepenMode: 'deepen' }, { compareMode: 'position-open', deepenMode: 'position-defined' }] as const)('$compareMode向$deepenMode显式交接，备选方向不自动成为世界事实', async ({ compareMode, deepenMode }) => {
    const { project, scope } = await seedCurrentWorkspace('方向交接')
    const store = useInspirationWorkspaceStore.getState()
    const fragment = await store.addFragment(scope, { text: '阿照修船铺，方向待选' })
    await store.saveVersion(scope, { mode: compareMode, fragmentIds: [fragment!.id], result: candidate(compareMode) })
    const prepared = await prepareInspirationCopilot({ projectId: project.id!, scope, selectedFragmentIds: [fragment!.id], skillId: 'inspiration.prepare', authorRequest: `灵感准备任务=${deepenMode}。之前灵感方向选择=1；作者本次改选：灵感方向选择=2。从最近已确认方向比较中选择第2项，沿离人与归客深化。` })
    const prompt = prepared.prepared.messages.map(message => message.content).join('\n')
    expect(prompt).toContain('最近已确认的方向比较')
    expect(prompt).toContain('离人与归客')
    expect(prompt).toContain('只能采用作者本轮明确选择')
    expect(prompt).not.toContain('围绕不同修船委托与铺子成长，重在手艺和经营。')
    expect(await db.worldviews.count()).toBe(0)
  })

})
