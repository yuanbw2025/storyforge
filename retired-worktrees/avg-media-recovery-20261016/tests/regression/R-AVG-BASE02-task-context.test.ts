import { describe, expect, it } from 'vitest'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { assertAvgVoiceAssemblyRequestsV3, avgVoiceAssemblyGateIdsV3 } from '../../src/lib/avg/voice-assembly-contract'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'
import { buildAvgVoiceAssemblyPlanV3 } from '../../src/lib/avg/voice-assembly-plan'
import { projectAvgTaskRequirementV1, AVG_TASK_CONTEXT_SOURCE_V1 } from '../../src/lib/avg/task-context'
import { stringifyAvgExactJsonV1 } from '../../src/lib/avg/voice-exact-storage'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgImageProcessingRecipeFixture } from '../helpers/avg-image-processing-fixture'
import { assertAvgVoiceProductionPolicyV3, avgVoiceProductionBudgetV3 } from '../../src/lib/avg/voice-production-policy'
import { productProductionTaskExecutionIdentityHashV1 } from '../../src/lib/product-production/scheduler'

const identity = { briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 }

describe('AVG registered exact task input projection', () => {
  it('delivers one maximum-size Unicode line from eight without another line, normalization or duplicate body', async () => {
    const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3()
    const original = assembly.voice.batch.requirements[0]!
    assembly.voice.batch.requirements = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const text = `e\u0301🧪第${i}句` + '台'.repeat(4088)
      expect(text.length).toBeLessThanOrEqual(4096)
      return { ...structuredClone(original), requirementKey: `line.${i}`, assetKey: `voice.${i}`,
        lineKey: `line.${i}`, text, textHash: await hashAvgVoiceTextV1(text) }
    }))
    assembly.mediaAssetKeys = assembly.voice.batch.requirements.map(r => r.assetKey)
    const resolved = await assertAvgVoiceAssemblyRequestsV3(assembly)
    const plan = buildAvgVoiceAssemblyPlanV3({ ...identity, brief: { avgAssembly: assembly, capabilityRequirements: capabilities } })
    const task = plan.tasks.find(t => t.taskKey === 'avg.voice.generate.line.7')!
    const packet = stringifyAvgExactJsonV1(projectAvgTaskRequirementV1({ ...resolved, task }))
    const delivered = JSON.parse(packet)
    expect(delivered.requirement.text).toBe(assembly.voice.batch.requirements[7]!.text)
    expect(delivered.requirement.text).not.toBe(delivered.requirement.text.normalize('NFC'))
    expect(delivered.request.requestBodyHash).toBe(resolved.requests[7]!.requestBodyHash)
    expect(delivered.request).not.toHaveProperty('requestBodyJson')
    expect(packet).not.toContain('voice.0')
    expect(estimateTokens(packet)).toBeLessThan(task.budgetReservation.inputTokens)
    expect(estimateTokens(stringifyAvgExactJsonV1(assembly.voice))).toBeGreaterThan(task.budgetReservation.inputTokens)
  })

  it('keeps one image requirement, exact references and processing scope separate from voice text', async () => {
    const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3(true)
    const resolved = await assertAvgVoiceAssemblyRequestsV3(assembly)
    const plan = buildAvgVoiceAssemblyPlanV3({ ...identity, brief: { avgAssembly: assembly, capabilityRequirements: capabilities } })
    const task = plan.tasks.find(t => t.kind === 'avg-media-image-generate')!
    const delivered = projectAvgTaskRequirementV1({ ...resolved, task })
    expect(delivered.kind).toBe('image')
    expect(delivered).toMatchObject({ requirement: assembly.image!.mediaBatch.requirements[0] })
    expect(stringifyAvgExactJsonV1(delivered)).not.toContain('keeper.line')
  })

  it('registers only the scoped media Skill and keeps deterministic tasks free of Agent bindings', async () => {
    const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3()
    const plan = buildAvgVoiceAssemblyPlanV3({ ...identity, brief: { avgAssembly: assembly, capabilityRequirements: capabilities } })
    const media = plan.tasks.find(t => t.executionMode === 'media-provider')!
    const skill = getAgentSkillV1(media.skillId!)
    expect(skill.contextSourceKeys).toEqual([AVG_TASK_CONTEXT_SOURCE_V1])
    expect(skill.optionalContextSourceKeys).toEqual([])
    expect(skill.writeTargets).toEqual(getAgentSkillV1('product-production.media-request.v1').writeTargets)
    for (const task of plan.tasks.filter(t => t.executionMode === 'deterministic')) {
      expect(task.skillId).toBeNull()
      expect(task.contextProfile).toBe('avg-task-v1')
    }
    expect(parseProductProductionPlanV3(plan)).toEqual(plan)
    const deterministic = plan.tasks.find(t => t.executionMode === 'deterministic')!, legacy = structuredClone(deterministic)
    delete legacy.contextProfile
    expect(await productProductionTaskExecutionIdentityHashV1(deterministic)).not.toBe(await productProductionTaskExecutionIdentityHashV1(legacy))
    for (const executionMode of ['human-import', 'media-provider', 'model'] as const) {
      const wrong = structuredClone(plan), task = wrong.tasks.find(t => t.executionMode === 'deterministic')!
      task.executionMode = executionMode
      expect(() => parseProductProductionPlanV3(wrong)).toThrow()
    }
    expect(() => parseProductProductionPlanV3({ ...plan, productType: 'text-adventure' })).toThrow(/投影/)
    const unknown = structuredClone(plan)
    Object.assign(unknown.tasks.find(t => t.executionMode === 'deterministic')!, { contextProfile: 'unregistered' })
    expect(() => parseProductProductionPlanV3(unknown)).toThrow()
  })

  it('reserves exact-input space for mixed local image processing without another provider call', async () => {
    const policy = await avgVoicePolicyFixtureV3(true), assembly = policy.avgAssembly
    assembly.image!.imageProcessing = { schema: 'storyforge.avg.image-processing-plan', version: 1,
      entries: [{ requirementKey: 'desk.background', recipe: avgImageProcessingRecipeFixture() }] }
    assembly.image!.mediaBatch.visualReviewPolicy = 'author-visual-v1'
    policy.productionBudget = avgVoiceProductionBudgetV3(assembly)
    policy.completionContract.requiredGateIds = avgVoiceAssemblyGateIdsV3(assembly)
    expect(() => assertAvgVoiceProductionPolicyV3(policy)).not.toThrow()
    const plan = buildAvgVoiceAssemblyPlanV3({ ...identity, brief: { avgAssembly: assembly, capabilityRequirements: policy.capabilityRequirements } })
    expect(plan.tasks.reduce((sum, task) => sum + task.budgetReservation.inputTokens, 0)).toBe(policy.productionBudget.maximumInputTokens)
    expect(plan.tasks.reduce((sum, task) => sum + task.budgetReservation.mediaCalls, 0)).toBe(2)
    const task = plan.tasks.find(t => t.kind === 'avg-media-image-process')!
    expect(task.contextProfile).toBe('avg-task-v1')
    expect(task.budgetReservation.inputTokens).toBe(20_000)
    expect(task.budgetReservation.mediaCalls).toBe(0)
  })
})
