import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SKILLS, DOMAIN_AGENT_IDS, getAgentSkillV1, getDefaultAgentSkillV1, validateAgentSkillDefinitionsV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { buildAvgVisualPlanningPlanV4 } from '../../src/lib/avg/visual-planning-plan'
import { parseAvgVisualPlanningBriefV4, avgVisualPlanningExecutionReadyV4 } from '../../src/lib/avg/visual-planning-brief'
import { avgVisualPlanningBudgetV4, avgVisualPlanningGateIdsV4 } from '../../src/lib/avg/visual-planning-policy'
import { AVG_VISUAL_PLANNING_AGENT_IDS_V1, AVG_VISUAL_PLANNING_CONTEXT_V1, AVG_VISUAL_PLANNING_ROLES_V1, avgVisualPlanningMethodV1 } from '../../src/lib/avg/visual-planning-roles'
import { projectAvgVisualPlanningTaskV4, readAvgVisualPlanningContextV4 } from '../../src/lib/avg/visual-planning-context'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { assertAvgProfessionalArtifactAdmissionV1 } from '../../src/lib/avg/artifact-admission'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { parseAvgMediaBriefV1, parseAvgVisualBibleV1, type AvgVisualBibleV1 } from '../../src/lib/avg/visual-planning-contract'
import { freezeAvgVisualPlanningScopeV1 } from '../../src/lib/avg/media-source'
import { productProductionTaskUsesWorldGatewayV1 } from '../../src/lib/product-production/source-contracts'

const identity = { briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 }
async function fixture(mode: 'evidence' | 'linear' = 'evidence') {
  const s = await avgVisualPlanningFixtureV4(mode)
  const plan = buildAvgVisualPlanningPlanV4({ ...identity, brief: { ...s.brief, avgVisualPlanning: s.planning } })
  return { ...s, plan }
}
function bible(subjectKey: string): AvgVisualBibleV1 {
  return { schema: 'storyforge.avg.visual-bible', version: 1, style: { medium: '二维插画', rendering: '清晰轮廓', palette: ['暖灰'], lighting: '左上主光', composition: '保留对白区' },
    subjects: [{ subjectKey, subjectKind: 'environment', identityInvariants: ['门窗位置'], allowedChanges: ['已允许光照'], forbiddenDepictions: ['新增秘密'] }] }
}

describe('AVG explicit next private contract and registered professional planning roles', () => {
  afterEach(()=>vi.unstubAllEnvs())
  it('keeps professional dispatch default off and requires both independent experimental switches',()=>{
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','')
    expect(avgVisualPlanningExecutionReadyV4()).toBe(false)
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');expect(avgVisualPlanningExecutionReadyV4()).toBe(false)
    vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1');expect(avgVisualPlanningExecutionReadyV4()).toBe(true)
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','');expect(avgVisualPlanningExecutionReadyV4()).toBe(false)
  })
  it('registers four independent default Skills with one protected Work-owned input and candidate-only writes', () => {
    expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS)).not.toThrow()
    for (const role of AVG_VISUAL_PLANNING_ROLES_V1) {
      const skill = getAgentSkillV1(role.skillId)
      expect(getDefaultAgentSkillV1(role.agentId)).toBe(skill)
      expect(DOMAIN_AGENT_IDS as readonly string[]).not.toContain(role.agentId)
      expect(skill.contextSourceKeys).toEqual([AVG_VISUAL_PLANNING_CONTEXT_V1])
      expect(skill.optionalContextSourceKeys).toEqual([])
      expect(skill.writeTargets).toEqual([{ table: 'productBuildArtifacts', fields: ['payloadJson'], adoptionExtension: 'product-production-artifacts' }])
      expect(avgVisualPlanningMethodV1(role.subjectKind)).toContain('反例')
      expect(avgVisualPlanningMethodV1(role.subjectKind)).toContain('不得')
    }
    expect(AVG_VISUAL_PLANNING_AGENT_IDS_V1).toHaveLength(4)
    expect(CONTEXT_SOURCE_BY_KEY.get(AVG_VISUAL_PLANNING_CONTEXT_V1)).toMatchObject({ ownerFrom: 'work', layer: 'L0', protectedFromTrim: true, budgetTokens: 24_000 })
  })

  it('gives every professional role a complete JSON example accepted by its actual strict output codec', () => {
    for (const role of AVG_VISUAL_PLANNING_ROLES_V1) {
      const prompt = avgVisualPlanningMethodV1(role.subjectKind)
      const example = JSON.parse(prompt.slice(prompt.lastIndexOf('\n{') + 1))
      expect(role.subjectKind === null ? parseAvgVisualBibleV1(example) : parseAvgMediaBriefV1(example)).toEqual(example)
      expect(example).toHaveProperty('schema', role.subjectKind === null ? 'storyforge.avg.visual-bible' : 'storyforge.avg.media-brief')
      expect(example).toHaveProperty('version', 1)
      expect(prompt).toContain('不能用逗号分隔字符串替代')
      expect(prompt).toContain(`根对象字段闭集为 ${Object.keys(example).join('、')}`)
      if (role.subjectKind === null) { expect(prompt).not.toContain('outputs'); expect(prompt).not.toContain('referenceKeys'); expect(prompt).toContain('subjects[].identityInvariants') }
      else { expect(prompt).not.toContain('style.palette'); expect(prompt).toContain('outputs[].referenceKeys') }
      expect(prompt).toContain('必须从本次 subjects 复制')
      expect(getAgentSkillV1(role.skillId).promptVersion).toBe(`${role.skillId}-method-v3`)
    }
  })

  it('freezes proposal receipt, explicit author adoption, compilation and image dispatch as distinct dependent tasks', async () => {
    const { brief, planning, plan } = await fixture()
    expect(parseProductProductionPlanV3(plan, brief, identity.briefHash)).toEqual(plan)
    const model = plan.tasks.filter(t => t.executionMode === 'model')
    expect(model.map(t => t.skillId)).toEqual(['avg.visual-bible.v1', 'avg.environment-assets.v1'])
    expect(model.map(t => t.outputArtifactKeys)).toEqual([['avg.proposal.visual-bible'], [`avg.proposal.environment-brief.${planning.scope.templates[0].parameters.family.subjectKey}`]])
    expect(model.every(t => t.maxAttempts === 1 && t.budgetReservation.modelCalls === 1)).toBe(true)
    expect(model.some(productProductionTaskUsesWorldGatewayV1)).toBe(false)
    const accepted = plan.tasks.find(t => t.taskKey === 'avg.author.visual-bible')!
    expect(accepted.executionMode).toBe('human-import')
    expect(accepted.inputArtifactKeys).toContain('avg.proposal.visual-bible')
    expect(accepted.outputArtifactKeys).toEqual(['avg.media.visual-bible'])
    const compile = plan.tasks.find(t => t.kind === 'avg-v4-visual-requirements-compile')!
    expect(compile.dependsOn).toContain('avg.author.visual-bible')
    const image = plan.tasks.find(t => t.kind === 'avg-media-image-generate')!
    expect(image.dependsOn).toContain(compile.taskKey)
    expect(image.inputArtifactKeys).toContain('avg.media.compiled-visual-requirements')
    expect(image.skillId).toBe('avg.compiled-image-request.v1')
    const operator = getAgentSkillV1(image.skillId!)
    expect(getDefaultAgentSkillV1('avg-image-operator')).toBe(operator)
    expect(DOMAIN_AGENT_IDS as readonly string[]).not.toContain(operator.agentId)
    expect(operator.contextSourceKeys).toEqual([AVG_VISUAL_PLANNING_CONTEXT_V1])
    expect(operator.writeTargets).toEqual([{ table: 'productBuildArtifacts', fields: [], adoptionExtension: 'product-production-artifacts' }])
    expect(brief.productionBudget).toEqual(avgVisualPlanningBudgetV4(brief))
    expect(brief.completionContract.requiredGateIds).toEqual(avgVisualPlanningGateIdsV4(brief))
    expect(brief.productionBudget.maximumModelCalls).toBe(2)
    expect(brief.productionBudget.maximumMediaCalls).toBe(1)
    expect(brief.productionBudget.maximumCostUsd).toBeNull()
    expect(JSON.stringify(brief.avgVisualPlanning)).not.toContain('Topology validation only')
    expect(brief.avgVisualPlanning).not.toHaveProperty('mediaBatch')
  })

  it('uses the same fixed topology for another linear system without first-fixture keys or unnecessary departments', async () => {
    const s = await fixture('linear')
    expect(s.plan.tasks.filter(t => t.executionMode === 'model').map(t => t.skillId)).toEqual(['avg.visual-bible.v1', 'avg.environment-assets.v1'])
    expect(s.planning.scope.templates[0].parameters.family.subjectKey).toBe('dark')
    expect(parseProductProductionBriefV3(s.brief)).toEqual(s.brief)
    expect(s.plan.tasks.some(t => t.skillId === 'avg.character-assets.v1' || t.skillId === 'avg.prop-assets.v1')).toBe(false)
  })

  it('rejects bypassed adoption, changed roles, changed reservations and a forged fixed Plan even if it remains an acyclic graph', async () => {
    const s = await fixture()
    for (const edit of [
      (p: typeof s.plan) => { p.tasks.find(t => t.executionMode === 'model')!.skillId = 'avg.prop-assets.v1' },
      (p: typeof s.plan) => { p.tasks.find(t => t.executionMode === 'model')!.budgetReservation.modelCalls = 2 },
      (p: typeof s.plan) => { const t = p.tasks.find(t => t.kind === 'avg-media-image-generate')!; t.dependsOn.pop(); t.requiredReceipts.pop() },
    ]) {
      const changed = structuredClone(s.plan); edit(changed)
      expect(() => parseProductProductionPlanV3(changed, s.brief, identity.briefHash)).toThrow()
    }
  })

  it('rejects another product, mixed old assembly, missing text/data authority and zeroed paid budget', async () => {
    const s = await fixture()
    for (const edit of [
      (b: typeof s.brief) => { b.intent.productType = 'ai-town' },
      (b: typeof s.brief) => { b.avgAssembly = s.planning.assembly },
      (b: typeof s.brief) => { b.capabilityRequirements = b.capabilityRequirements.filter(c => c.mediaClass !== 'text') },
      (b: typeof s.brief) => { b.externalDataPolicy.allowedDataClasses = ['image-prompt'] },
      (b: typeof s.brief) => { b.productionBudget.maximumModelCalls = 0 },
      (b: typeof s.brief) => { b.media.voiceLineCount = 1 },
    ]) { const changed = structuredClone(s.brief); edit(changed); expect(() => parseProductProductionBriefV3(changed)).toThrow() }
  })

  it('retains frozen consumers and rejects unlisted scenes, runtime assets or unsupported authority fields', async () => {
    const { planning } = await fixture()
    const wrong = structuredClone(planning); wrong.assembly.sceneKeys = ['elsewhere']
    expect(() => parseAvgVisualPlanningBriefV4(wrong)).toThrow(/场景/)
    const missing = structuredClone(planning); missing.assembly.mediaAssetKeys = []
    expect(() => parseAvgVisualPlanningBriefV4(missing)).toThrow(/媒资目录/)
    expect(() => parseAvgVisualPlanningBriefV4({ ...planning, authorAccepted: true })).toThrow(/字段/)
  })

  it('projects visible purpose and declared appearance without full script, item truth, rules or reference bytes', async () => {
    const s = await fixture(), task = s.plan.tasks.find(t => t.skillId === 'avg.visual-bible.v1')!
    s.source.scripts[0].lines[0].text = '不可默认外发的秘密台词'
    if (s.source.systemPlan.version === 2) s.source.systemPlan.inventory.items[0].description = '不应外发的物件真相'
    const packet = projectAvgVisualPlanningTaskV4({ planning: s.planning, task, source: s.source })
    expect(packet.requirements[0].requiredDetails).toEqual(s.planning.scope.templates[0].requiredDetails)
    expect(JSON.stringify(packet)).not.toContain('不可默认外发')
    expect(JSON.stringify(packet)).not.toContain('物件真相')
    expect(packet).not.toHaveProperty('scripts')
    expect(packet).not.toHaveProperty('systemPlan')
    expect(packet.visualDirection).toBeNull()
  })

  it('requires the exact subject and canonical direction for the environment department and rejects borrowed roles', async () => {
    const s = await fixture(), task = s.plan.tasks.find(t => t.skillId === 'avg.environment-assets.v1')!
    const subject = s.planning.scope.templates[0].parameters.family.subjectKey
    expect(() => projectAvgVisualPlanningTaskV4({ planning: s.planning, task, source: s.source })).toThrow(/已确认/)
    const direction = bible(subject)
    direction.subjects.push({ ...direction.subjects[0], subjectKey: 'unselected' })
    const packet = projectAvgVisualPlanningTaskV4({ planning: s.planning, task, source: s.source, visualBible: direction })
    expect(packet.visualDirection?.subjects.map(s => s.subjectKey)).toEqual([subject])
    const borrowed = structuredClone(task); borrowed.skillId = 'avg.prop-assets.v1'
    expect(() => projectAvgVisualPlanningTaskV4({ planning: s.planning, task: borrowed, source: s.source, visualBible: direction })).toThrow(/主体/)
    expect(() => projectAvgVisualPlanningTaskV4({ planning: s.planning, task, source: s.source, visualBible: bible('different') })).toThrow(/覆盖/)
  })

  it('instantiates character and prop departments only for their frozen consumers and isolates reference metadata by subject', async () => {
    const s = await fixture(), base = s.planning.scope.templates[0], actor = structuredClone(base), prop = structuredClone(base)
    actor.subjectKind = 'character'; Object.assign(actor.parameters, { requirementKey: 'keeper.pose', assetKey: 'keeper.pose', mediaKind: 'character-pose', width: 640, height: 960, alpha: 'required' })
    actor.parameters.family.subjectKey = 'keeper'; actor.parameters.family.familyKey = 'keeper.uniform'
    Object.assign(actor.parameters.consumer, { consumerKey: 'keeper.pose', domain: 'stage', slot: 'actor', subjectKey: 'keeper' })
    prop.subjectKind = 'prop'; Object.assign(prop.parameters, { requirementKey: 'letter.icon', assetKey: 'letter.icon', mediaKind: 'ui', width: 512, height: 512, triggerBeatKey: null })
    prop.parameters.family.subjectKey = 'letter'; prop.parameters.family.familyKey = 'letter.public'
    Object.assign(prop.parameters.consumer, { consumerKey: 'letter.icon', domain: 'inventory', slot: 'icon', subjectKey: 'letter', sceneKey: null })
    prop.allowedReferenceKeys = prop.requiredReferenceKeys = ['letter.reference']
    if (s.source.systemPlan.version !== 2) throw new Error('inventory required')
    s.source.systemPlan.inventory.items[0].iconAssetKey = 'letter.icon'
    const { sourceInputHash: _hash, aspectRatio: _ratio, ...scope } = s.planning.scope
    s.planning.scope = await freezeAvgVisualPlanningScopeV1({ ...scope, templates: [base, actor, prop], referenceCatalog: [{ referenceKey: 'letter.reference', reference: {
      assetKey: 'original.letter', assetVersion: 1, contentHash: 'e'.repeat(64), mimeType: 'image/png', byteSize: 128, purpose: 'detail',
      allowedChange: '只改变公开物件的展示尺度', dataClass: 'avg-authorized-reference', license: '不得默认发送的权利声明原文', providerInputAllowed: true,
      derivativeUseAllowed: true, crop: null, mask: null,
    } }] }, s.source)
    s.planning.assembly.mediaAssetKeys.push('keeper.pose', 'letter.icon')
    const plan = buildAvgVisualPlanningPlanV4({ ...identity, brief: { ...s.brief, avgVisualPlanning: s.planning } })
    expect(plan.tasks.filter(t => t.executionMode === 'model').map(t => t.skillId)).toEqual(['avg.visual-bible.v1', 'avg.environment-assets.v1', 'avg.character-assets.v1', 'avg.prop-assets.v1'])
    const direction = bible(base.parameters.family.subjectKey)
    direction.subjects.push({ ...direction.subjects[0], subjectKey: 'keeper', subjectKind: 'character' }, { ...direction.subjects[0], subjectKey: 'letter', subjectKind: 'prop' })
    for (const kind of ['character', 'prop'] as const) {
      const task = plan.tasks.find(t => t.skillId === (kind === 'character' ? 'avg.character-assets.v1' : 'avg.prop-assets.v1'))!
      const packet = projectAvgVisualPlanningTaskV4({ planning: s.planning, task, source: s.source, visualBible: direction })
      expect(packet.subjects.map(s => s.subjectKind)).toEqual([kind])
      expect(packet.requirements).toHaveLength(1)
      expect(packet.references.map(r => r.referenceKey)).toEqual(kind === 'prop' ? ['letter.reference'] : [])
      expect(JSON.stringify(packet)).not.toContain('权利声明原文')
      expect(JSON.stringify(packet)).not.toContain('original.letter')
      expect(packet.references.every(r => r.observation.startsWith('metadata-only'))).toBe(true)
    }
  })

  it('keeps actual new commands, generic dispatch and formal professional writes closed until the adoption/consumer slice exists', async () => {
    const s = await fixture()
    const result = await executeProductProductionCommand({ scope: s.owner.scope, productionId: s.owner.productionId,
      command: { type: 'save-brief-revision', commandId: 'visual.not-yet-ready', expectedStateRevision: s.owner.details.production.stateRevision,
        parentRevision: s.owner.details.brief!.revision, brief: s.brief } })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('尚未接通')
    expect(() => createConfiguredProductProductionExecutorV1({ production: s.owner.details.production, brief: s.brief })).toThrow(/旧通用执行器/)
    expect(() => assertAvgProfessionalArtifactAdmissionV1({ productType: 'avg', artifactKey: 'avg.media.visual-bible', kind: 'narrative', payload: bible('desk'), metadata: {} })).toThrow(/尚未就绪/)
  })

  it('refuses a missing or unrelated persisted source instead of granting authority from a supplied projection', async () => {
    await expect(readAvgVisualPlanningContextV4({ projectId: 1 })).rejects.toThrow(/准确/)
    const s = await fixture()
    await expect(readAvgVisualPlanningContextV4({ projectId: s.owner.scope.projectId, scope: s.owner.scope,
      productProductionId: s.owner.productionId, productBuildId: 999999, productProductionTaskKey: 'avg.visual.propose.direction', productArtifactKeys: [] })).rejects.toThrow(/stale|Work/)
  })
})
