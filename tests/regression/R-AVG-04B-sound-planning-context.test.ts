import { describe, expect, it } from 'vitest'
import { AGENT_SKILLS, getAgentSkillV1, getDefaultAgentSkillV1, validateAgentSkillDefinitionsV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { AVG_SOUND_CONTEXT_V1 } from '../../src/lib/avg/sound-production-brief'
import { avgSoundPlanOutputExampleV1, avgSoundPlanningMethodV1 } from '../../src/lib/avg/sound-planning-role'
import { parseAvgSoundPlanV1 } from '../../src/lib/avg/sound-plan-contract'
import { projectAvgSoundPlanningInputsV1, readAvgSoundPlanningContextV1 } from '../../src/lib/avg/sound-planning-context'
import { freezeAvgSoundPlanningScopeV1 } from '../../src/lib/avg/sound-source'
import { avgSoundProductionFixtureV1 } from '../helpers/avg-sound-production-fixture'
import { startNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { buildAvgSoundProductionPlanV1 } from '../../src/lib/avg/sound-production-plan'
import { productProductionTaskUsesWorldGatewayV1 } from '../../src/lib/product-production/source-contracts'

describe('AVG registered sound planning projection and closed real execution authority', () => {
  it('registers exact Work-owned protected candidate-only roles without creating a second context/write engine', () => {
    expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS)).not.toThrow()
    for (const [agent, id] of [['avg-sound-director', 'avg.sound-plan.v1'], ['avg-sound-operator', 'avg.sound-request.v1']] as const) {
      const skill = getAgentSkillV1(id)
      expect(getDefaultAgentSkillV1(agent)).toBe(skill)
      expect(skill).toMatchObject({ executionMode: 'product-production', contextSourceKeys: [AVG_SOUND_CONTEXT_V1], optionalContextSourceKeys: [] })
      expect(skill.writeTargets).toEqual([{ table: 'productBuildArtifacts', fields: agent === 'avg-sound-director' ? ['payloadJson'] : [], adoptionExtension: 'product-production-artifacts' }])
      expect(skill.contextGateway).toBeUndefined()
    }
    expect(CONTEXT_SOURCE_BY_KEY.get(AVG_SOUND_CONTEXT_V1)).toMatchObject({ ownerFrom: 'work', layer: 'L0', budgetTokens: 24_000, protectedFromTrim: true })
    expect(parseAvgSoundPlanV1(avgSoundPlanOutputExampleV1())).toEqual(avgSoundPlanOutputExampleV1())
    const method = avgSoundPlanningMethodV1()
    expect(method).toContain('反例'); expect(method).toContain('不得'); expect(method).toContain('只从本项allowedSourceKeys')
  })
  it('projects only frozen sound purposes, parameters and allowed source metadata; dialogue and rules remain hash-bound but undisclosed', async () => {
    const s = await avgSoundProductionFixtureV1(), source = structuredClone(s.workspace)
    source.scripts[0].lines[0].text = 'PRIVATE_DIALOGUE_NEVER_IN_SOUND_MODEL_CONTEXT'
    const { sourceInputHash: _hash, ...unhashed } = s.brief.avgSoundPlanning!.scope
    const scope = await freezeAvgSoundPlanningScopeV1(unhashed, source)
    const declaration = { ...s.brief.avgSoundPlanning!, scope }
    const packet = await projectAvgSoundPlanningInputsV1(declaration, source), wire = JSON.stringify(packet)
    expect(packet.requirements).toHaveLength(2); expect(packet.librarySources[0].sourceKey).toBe('fixture.click')
    expect(packet.librarySources[0].observation).toContain('not delivered or heard')
    expect(wire).not.toContain('PRIVATE_DIALOGUE_NEVER_IN_SOUND_MODEL_CONTEXT')
    expect(packet).not.toHaveProperty('systemPlan'); expect(packet).not.toHaveProperty('scripts')
    expect(packet).not.toHaveProperty('musicBinding'); expect(packet).not.toHaveProperty('apiKey')
    const changed = structuredClone(source); changed.scripts[0].lines[0].text += ' changed'
    await expect(projectAvgSoundPlanningInputsV1(declaration, changed)).rejects.toThrow(/已变化/)
    const ratio = structuredClone(source); ratio.presentation.aspectRatio = ratio.presentation.aspectRatio === '16:9' ? '4:3' : '16:9'
    await expect(projectAvgSoundPlanningInputsV1(declaration, ratio)).rejects.toThrow(/画幅/)
    const ratioScope = await freezeAvgSoundPlanningScopeV1(unhashed, ratio)
    await expect(projectAvgSoundPlanningInputsV1({ ...declaration, aspectRatio: ratio.presentation.aspectRatio, scope: ratioScope }, ratio)).resolves.toMatchObject({ sourceInputHash: ratioScope.sourceInputHash })
  })
  it('does not borrow a real V1 start command, Brief, Build or caller-supplied dependency projection as sound authority', async () => {
    const s = await avgSoundProductionFixtureV1(), started = await startNativeAvgAssembly(s.owner)
    const input = { scope: s.owner.scope, projectId: s.owner.scope.projectId, productProductionId: s.owner.productionId,
      productBuildId: started.buildId, productProductionTaskKey: 'avg.sound.propose.plan',
      productArtifactKeys: ['avg.system.plan', ...s.workspace.scripts.map(script => `avg.content.scene-script.${script.sceneKey}`)] }
    await expect(readAvgSoundPlanningContextV1(input)).rejects.toThrow(/完整原始声音Brief/)
    await expect(readAvgSoundPlanningContextV1({ ...input, projectId: input.projectId + 1 })).rejects.toThrow(/准确Work/)
    const reader = CONTEXT_SOURCE_BY_KEY.get(AVG_SOUND_CONTEXT_V1)!
    expect(reader.enabled?.(input)).toBe(true)
    await expect(reader.read(input)).rejects.toThrow(/完整原始声音Brief/)
  })
  it('reserves one exact registered projection for each deterministic sound task and gives provider roles no World gateway', async () => {
    const s = await avgSoundProductionFixtureV1(), plan = buildAvgSoundProductionPlanV1({ brief: s.brief,
      briefHash: '0'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    expect(plan.tasks.filter(t => t.executionMode === 'deterministic').every(t => t.contextProfile === 'avg-sound-planning-v1')).toBe(true)
    expect(plan.tasks.filter(t => t.skillId).some(productProductionTaskUsesWorldGatewayV1)).toBe(false)
  })
})
