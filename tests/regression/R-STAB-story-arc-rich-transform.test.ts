import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareStoryArcCopilot, adoptRestoredStoryArcCandidate, parseStoryArcCandidateDraft, revalidateStoryArcCreativeDraftV1, runStoryArcCreativeReliabilityV1, type StoryArcOperationV1 } from '../../src/lib/agent/story-arc-copilot'
import { runGenerationNode, adoptGenerationNodeOutput } from '../../src/lib/generation/generation-node'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'

const config = useAIConfigStore.getState()
const stage = { id: 'retained-stage', title: '探路', description: '先测绳再核验路线', keyEvents: Array.from({ length: 7 }, (_, i) => `作者已确认事件${i + 1}`), turningPoint: '', authorNote: '作者的额外标记不可丢失' }
async function fixture(stages = [stage]) {
  const f = await seedCurrentWorkspace('较丰富手工故事线继续创作')
  const arcId = await db.storyArcs.add(stampNewRecord(f.scope, 'storyArcs', { projectId: f.scope.projectId, name: '探路主线', type: 'main', description: '按原计划核验路线', stages: JSON.stringify(stages), origin: 'manual', status: 'active', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  return { ...f, arcId, stages }
}
function candidate(stages = [stage]) {
  return [{ name: '探路主线', type: 'main', description: '按原计划核验路线，明确后续交接', stages: stages.map(({ id, authorNote: _authorNote, ...row }) => ({ stageId: id, ...row })) }]
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>, operation: StoryArcOperationV1, output = candidate(f.stages)) {
  const runAI = vi.fn(async () => JSON.stringify({ storyArcs: output }))
  const p = await prepareStoryArcCopilot({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, authorRequest: '保留全部作者阶段和事件，只优化整体描述', mutationRequest: { operation, targetArcId: f.arcId } }, { runAI })
  return { p, runAI }
}
describe.sequential('STAB · rich manual arcs remain usable by the shared transform workflow', () => {
  beforeEach(async () => { await db.delete(); await db.open(); useAIConfigStore.setState({ config: { ...config.config, provider: 'ollama', model: 'rich-arc-test', baseUrl: 'http://localhost:11434', contextWindow: 128000 }, presets: [], taskRoutes: {} }) })
  afterEach(() => { useAIConfigStore.setState(config, true); db.close() })
  it.each(['expand', 'rewrite', 'polish', 'replan'] as const)('%s: one existing stage with seven events survives candidate, restore, adoption and readback', async operation => {
    const f = await fixture(); const { p, runAI } = await prepare(f, operation)
    const before = await db.storyArcs.get(f.arcId)
    const generated = await runGenerationNode(p.node, p.prepared)
    expect(generated.gate?.status).toBe('pass')
    expect(await db.storyArcs.get(f.arcId)).toEqual(before)
    expect((await adoptGenerationNodeOutput(p.node, generated.output)).adopted).toBe(true)
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)).toEqual([stage])
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('eight existing stages are not cut to the new-arc limit during restored author adoption', async () => {
    const stages = Array.from({ length: 8 }, (_, i) => ({ ...stage, id: `old-${i}`, title: `作者阶段${i}`, keyEvents: [`阶段${i}的原事件`] }))
    const f = await fixture(stages); const { p } = await prepare(f, 'polish')
    await adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify(candidate(stages)) })
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)).toEqual(stages)
  })
  it('production creative parsing and author-edited candidate use the same retained-source contract', async () => {
    const f = await fixture(); const { p, runAI } = await prepare(f, 'polish')
    const result = await runStoryArcCreativeReliabilityV1({ prepared: p, qualityMode: 'balanced', budget: new AgentTeamBudgetTracker('balanced') })
    expect(result.artifact.status).toBe('ready')
    const checked = revalidateStoryArcCreativeDraftV1({ draft: JSON.stringify(candidate()), snapshot: p.snapshot, mutation: p.mutation, kind: p.kind, previousArtifact: result.artifact })
    expect(checked.status).toBe('ready'); expect(checked.callEvidence).toEqual(result.artifact.callEvidence)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('retained empty fields, duplicate events, long text and opaque IDs survive without normalizing author data', async () => {
    const stages = [{ ...stage, id: ' retained opaque id ', title: '', description: '', keyEvents: ['', '同一事件', '同一事件', '原'.repeat(450)], endVolume: 2 }]
    const f = await fixture(stages); const { p } = await prepare(f, 'polish')
    await adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify(candidate(stages)) })
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)).toEqual(stages)
  })
  it('existing duplicate titles and empty event arrays retain distinct stage identities', async () => {
    const stages = [{ ...stage, id: 'a', title: '待补', keyEvents: [] }, { ...stage, id: 'b', title: '待补', keyEvents: [] }]
    const f = await fixture(stages); const { p } = await prepare(f, 'replan')
    await adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify(candidate(stages)) })
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)).toEqual(stages)
  })
  it.each(['too-many-events', 'new-duplicate', 'new-overlong', 'unknown-id', 'too-many-new-stages', 'candidate-owner-field'] as const)('%s remains blocked without changing the Arc', async kind => {
    const f = await fixture(); const { p } = await prepare(f, 'rewrite'); const before = await db.storyArcs.get(f.arcId)
    const output: any = candidate()
    if (kind === 'too-many-events') output[0].stages[0].keyEvents.push(...Array.from({ length: 6 }, (_, i) => `额外${i}`))
    if (kind === 'new-duplicate') output[0].stages[0].keyEvents.push(stage.keyEvents[0])
    if (kind === 'new-overlong') output[0].stages[0].keyEvents.push('新'.repeat(401))
    if (kind === 'unknown-id') output[0].stages[0].stageId = 'foreign-stage'
    if (kind === 'too-many-new-stages') output[0].stages = Array.from({ length: 8 }, (_, i) => ({ title: `新阶段${i}`, description: '新阶段描述', keyEvents: ['独立事件'] }))
    if (kind === 'candidate-owner-field') output[0].stages[0].authorNote = '模型不得覆盖作者额外字段'
    await expect(adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify(output) })).rejects.toThrow()
    expect(await db.storyArcs.get(f.arcId)).toEqual(before)
  })
  it('new Arc limits are unchanged, and a source edit still makes the larger restored candidate stale', async () => {
    const f = await fixture(); const { p } = await prepare(f, 'polish')
    expect(() => parseStoryArcCandidateDraft(JSON.stringify(candidate()))).toThrow()
    await db.storyArcs.update(f.arcId, { description: '作者更新后的原稿' })
    await expect(adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify(candidate()) })).rejects.toThrow('变化')
    expect((await db.storyArcs.get(f.arcId))?.description).toBe('作者更新后的原稿')
  })
})
