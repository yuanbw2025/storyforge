import { describe, expect, it } from 'vitest'
import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets'
import { assertAvgProfessionalArtifactAdmissionV1 } from '../../src/lib/avg/artifact-admission'
import { parseAvgProfessionalArtifactV1, prepareAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { assertAvgVisualPlanningProposalV1, compileAvgVisualPlanningProposalV1, freezeAvgVisualPlanningScopeV1, validateAvgVisualProductionBatchSourceV1 } from '../../src/lib/avg/media-source'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  avgMediaBriefArtifactKeyV1, parseAvgMediaBriefV1, parseAvgVisualBibleV1, parseAvgVisualPlanningScopeV1,
  type AvgMediaBriefV1, type AvgVisualBibleV1, type AvgVisualDesignKindV1, type AvgVisualRequirementTemplateV1,
} from '../../src/lib/avg/visual-planning-contract'
import type { AvgMediaReferenceV1 } from '../../src/lib/avg/media-reference-contract'

function template(subjectKind: AvgVisualDesignKindV1, subjectKey: string, requirementKey: string,
  slot: 'actor' | 'background' | 'icon' | 'detail', sceneKey = 'desk'): AvgVisualRequirementTemplateV1 {
  const stage = slot === 'actor' || slot === 'background'
  const reference = subjectKind === 'character' ? 'ref.keeper' : subjectKind === 'prop' ? 'ref.letter' : null
  return { subjectKind, parameters: { requirementKey, revision: 1, assetKey: `planned.${requirementKey}`, name: requirementKey,
    altText: '原创工程方案，不证明真实图像或艺术质量', family: { subjectKey, familyKey: `${subjectKey}.family`, variantKey: requirementKey, revision: 1 },
    consumer: { consumerKey: requirementKey, domain: stage ? 'stage' : slot === 'icon' ? 'inventory' : 'evidence', slot, subjectKey,
      sceneKey: stage ? sceneKey : null, lineKey: null, required: true, fallback: 'none' },
    triggerBeatKey: stage ? `line.${sceneKey}` : null, itemVariantKey: null,
    mediaKind: slot === 'actor' ? 'character-pose' : slot === 'background' ? 'background' : slot === 'icon' ? 'ui' : 'cg',
    width: slot === 'actor' ? 640 : slot === 'icon' ? 512 : 576,
    height: slot === 'actor' ? 960 : slot === 'icon' ? 512 : 324, resolutionTier: '1K', alpha: slot === 'actor' ? 'required' : 'not-required' },
    requiredDetails: ['作者冻结的公开造型细节'], forbiddenDepictions: ['禁止新增物件真相或秘密文字'],
    allowedReferenceKeys: reference ? [reference] : [], requiredReferenceKeys: reference ? [reference] : [] }
}
const reference = (assetKey: string, purpose: AvgMediaReferenceV1['purpose']): AvgMediaReferenceV1 => ({
  assetKey, assetVersion: 1, contentHash: 'a'.repeat(64), mimeType: 'image/png', byteSize: 128, purpose,
  allowedChange: '仅改变冻结需求允许的姿态或展示尺度', dataClass: 'avg-authorized-reference', license: '工程元数据，不证明真实字节、所有权或服务商许可',
  providerInputAllowed: true, derivativeUseAllowed: true, crop: null, mask: null,
})
function bible(templates: AvgVisualRequirementTemplateV1[]): AvgVisualBibleV1 {
  return { schema: 'storyforge.avg.visual-bible', version: 1,
    style: { medium: '二维原创插画', rendering: '稳定轮廓和共同画布', palette: ['冷青', '暖赭'], lighting: '固定光源方向', composition: '保留对白安全区' },
    subjects: [...new Map(templates.map(t => [t.parameters.family.subjectKey, t])).values()].map(t => ({
      subjectKey: t.parameters.family.subjectKey, subjectKind: t.subjectKind, identityInvariants: ['保持主体身份与比例'],
      allowedChanges: ['只作本项已确认变化'], forbiddenDepictions: ['不添加剧情信息'] })) }
}
function briefs(templates: AvgVisualRequirementTemplateV1[]): AvgMediaBriefV1[] {
  return [...new Map(templates.map(t => [t.parameters.family.subjectKey, t])).values()].map(t => ({
    schema: 'storyforge.avg.media-brief', version: 1, subjectKey: t.parameters.family.subjectKey, subjectKind: t.subjectKind,
    designIntent: '满足准确消费槽，不改变规则与对白', outputs: templates.filter(other => other.parameters.family.subjectKey === t.parameters.family.subjectKey)
      .map(other => ({ requirementKey: other.parameters.requirementKey, prompt: '本项准确视觉描述', negativePrompt: '水印',
        invariants: ['设计岗位增加的连续性要求'], forbiddenDepictions: ['不增加额外角色'], referenceKeys: [...other.requiredReferenceKeys] })) }))
}
async function fixture() {
  const source = createAvgAuthoringPresetV1('evidence')
  const templates = [template('environment', 'desk', 'desk.background', 'background'),
    template('character', 'keeper', 'keeper.neutral', 'actor'), template('character', 'keeper', 'keeper.attentive', 'actor', 'wait'),
    template('prop', 'letter', 'letter.icon', 'icon'), template('prop', 'letter', 'letter.detail', 'detail')]
  if (source.systemPlan.version !== 2) throw new Error('Evidence fixture needs inventory')
  source.systemPlan.inventory.items[0].iconAssetKey = 'planned.letter.icon'
  source.systemPlan.inventory.items[0].detailAssetKey = 'planned.letter.detail'
  const scope = await freezeAvgVisualPlanningScopeV1({ schema: 'storyforge.avg.visual-planning-scope', version: 1,
    batchKey: 'professional.visual.fixture', revision: 1, templates, referenceCatalog: [
      { referenceKey: 'ref.keeper', reference: reference('original.keeper', 'identity') },
      { referenceKey: 'ref.letter', reference: reference('original.letter', 'detail') },
    ] }, source)
  return { source, scope, visualBible: bible(templates), mediaBriefs: briefs(templates) }
}

describe('AVG professional visual semantics and frozen request compilation foundation', () => {
  it('compiles a location, two character variants and the same item icon/detail through the existing batch validator without changing source facts', async () => {
    const input = await fixture(), before = structuredClone(input)
    const proposal = await compileAvgVisualPlanningProposalV1(input)
    expect(input).toEqual(before)
    expect(proposal.batch.requirements).toHaveLength(5)
    expect(proposal.batch.visualReviewPolicy).toBe('author-visual-v1')
    for (const [index, requirement] of proposal.batch.requirements.entries()) {
      expect(requirement).toMatchObject(input.scope.templates[index].parameters)
      expect(requirement.invariants).toEqual(['作者冻结的公开造型细节', '保持主体身份与比例', '设计岗位增加的连续性要求'])
      expect(requirement.forbiddenDepictions).toContain('禁止新增物件真相或秘密文字')
      expect(requirement.prompt).toContain('保留对白安全区')
      expect(requirement.references).toEqual(input.scope.templates[index].requiredReferenceKeys.map(key => input.scope.referenceCatalog.find(e => e.referenceKey === key)!.reference))
    }
    expect(await validateAvgVisualProductionBatchSourceV1(proposal.batch, input.source)).toEqual(proposal.batch)
    expect(proposal.batchHash).toBe(await hashProductProductionValueV2(proposal.batch))
    expect(proposal.inputHashes.scope).toBe(await hashProductProductionValueV2(input.scope))
    expect(proposal.inputHashes.mediaBriefs.map(b => b.artifactKey)).toEqual([
      'avg.media.environment-brief.desk', 'avg.media.character-brief.keeper', 'avg.media.prop-brief.letter'])
    expect(await compileAvgVisualPlanningProposalV1({ ...input, mediaBriefs: [...input.mediaBriefs].reverse() })).toEqual(proposal)
  })

  it('uses the same compiler for another linear configuration without characters, inventory or first-fixture keys', async () => {
    const source = createAvgAuthoringPresetV1('linear'), templates = [template('environment', 'dark', 'other.room.background', 'background', 'dark')]
    const scope = await freezeAvgVisualPlanningScopeV1({ schema: 'storyforge.avg.visual-planning-scope', version: 1,
      batchKey: 'another.visual.scope', revision: 3, templates, referenceCatalog: [] }, source)
    const result = await compileAvgVisualPlanningProposalV1({ source, scope, visualBible: bible(templates), mediaBriefs: briefs(templates) })
    expect(result.batch.requirements[0].consumer.subjectKey).toBe('dark')
    expect(result.batch.requirements[0].references).toEqual([])
    expect(result.batch.revision).toBe(3)
  })

  it('reuses the same broader direction in a smaller later batch without generating other subjects or borrowing their references', async () => {
    const input = await fixture(), { sourceInputHash: _hash, aspectRatio: _ratio, ...base } = input.scope
    const scope = await freezeAvgVisualPlanningScopeV1({ ...base, batchKey: 'next.background.only', revision: 2,
      templates: [input.scope.templates[0]], referenceCatalog: [] }, input.source)
    const result = await compileAvgVisualPlanningProposalV1({ ...input, scope, mediaBriefs: [input.mediaBriefs[0]] })
    expect(result.batch.requirements).toHaveLength(1)
    expect(result.batch.requirements[0].consumer.subjectKey).toBe('desk')
    expect(result.batch.requirements[0].references).toEqual([])
    expect(result.inputHashes.visualBible).toBe(await hashProductProductionValueV2(input.visualBible))
    const unknown = structuredClone(input.visualBible)
    unknown.subjects.push({ ...unknown.subjects[0], subjectKey: 'unrelated.location' })
    await expect(compileAvgVisualPlanningProposalV1({ ...input, scope, visualBible: unknown, mediaBriefs: [input.mediaBriefs[0]] })).rejects.toThrow(/未声明/)
  })

  it('recomputes the whole proposal instead of trusting edited consumer data, input hashes or a self-rehashed batch', async () => {
    const input = await fixture(), proposal = await compileAvgVisualPlanningProposalV1(input)
    expect(await assertAvgVisualPlanningProposalV1(JSON.stringify(proposal), input)).toEqual(proposal)
    const altered = structuredClone(proposal)
    altered.batch.requirements[0].prompt += '由外部修改'
    altered.batchHash = await hashProductProductionValueV2(altered.batch)
    await expect(assertAvgVisualPlanningProposalV1(altered, input)).rejects.toThrow(/已变化/)
    const changedInput = structuredClone(input); changedInput.visualBible.style.lighting += '新基准'
    await expect(assertAvgVisualPlanningProposalV1(proposal, changedInput)).rejects.toThrow(/已变化/)
    const forged = structuredClone(proposal); forged.inputHashes.mediaBriefs[0].contentHash = 'f'.repeat(64)
    await expect(assertAvgVisualPlanningProposalV1(forged, input)).rejects.toThrow(/已变化/)
  })

  it('keeps each semantic schema in its own role/key and does not open the reserved professional adoption gate', async () => {
    const input = await fixture()
    expect(parseAvgProfessionalArtifactV1(input.visualBible)).toEqual(input.visualBible)
    for (const brief of input.mediaBriefs) {
      const artifactKey = avgMediaBriefArtifactKeyV1(brief.subjectKind, brief.subjectKey)
      const prepared = prepareAvgProfessionalArtifactV1({ artifactKey, kind: 'narrative', payload: brief, allowedOutputKeys: [artifactKey] })
      expect(prepared.agentId).toBe(`avg-${brief.subjectKind}-designer`)
      expect(() => assertAvgProfessionalArtifactAdmissionV1({ productType: 'avg', artifactKey, kind: 'narrative', payload: brief, metadata: {} })).toThrow(/采用尚未就绪/)
      expect(() => assertAvgProfessionalArtifactAdmissionV1({ productType: 'adventure', artifactKey, kind: 'narrative', payload: brief, metadata: {} })).toThrow(/跨产品/)
    }
    const brief = input.mediaBriefs.find(b => b.subjectKind === 'character')!
    for (const artifactKey of ['avg.media.environment-brief.keeper', 'avg.media.character-brief.someone', 'avg.media.ui-brief.keeper', 'avg.media.key-art-brief.keeper']) {
      expect(() => prepareAvgProfessionalArtifactV1({ artifactKey, kind: 'narrative', payload: brief, allowedOutputKeys: [artifactKey] })).toThrow(/岗位|输出 key/)
    }
  })

  it('rejects self-reported authority and model changes to fixed consumers, dimensions, asset identity or reference grants', async () => {
    const input = await fixture(), brief = input.mediaBriefs[0]
    for (const key of ['sourceInputHash', 'producerReceiptHash', 'authorAccepted', 'license', 'model']) {
      expect(() => parseAvgVisualBibleV1({ ...input.visualBible, [key]: 'model claim' })).toThrow(/字段/)
      expect(() => parseAvgMediaBriefV1({ ...brief, [key]: 'model claim' })).toThrow(/字段/)
    }
    for (const key of ['consumer', 'assetKey', 'width', 'providerInputAllowed', 'contentHash']) {
      expect(() => parseAvgMediaBriefV1({ ...brief, outputs: [{ ...brief.outputs[0], [key]: 'model change' }] })).toThrow(/字段/)
    }
    expect(() => parseAvgVisualPlanningScopeV1({ ...input.scope, templates: input.scope.templates.map((t, i) => i ? t : { ...t, parameters: { ...t.parameters, prompt: 'cannot smuggle a request' } }) })).toThrow(/字段/)
  })

  it('requires exact subject and per-subject requirement coverage without borrowing another design role', async () => {
    const input = await fixture()
    const wrong = structuredClone(input.mediaBriefs); wrong[0].outputs[0].requirementKey = 'unfrozen.requirement'
    const wrongRole = structuredClone(input.mediaBriefs); wrongRole[0].subjectKind = 'prop'
    for (const mediaBriefs of [input.mediaBriefs.slice(1), [...input.mediaBriefs, input.mediaBriefs[0]], wrong, wrongRole]) {
      await expect(compileAvgVisualPlanningProposalV1({ ...input, mediaBriefs })).rejects.toThrow(/覆盖|重复|扩大/)
    }
    const missing = structuredClone(input.visualBible); missing.subjects.pop()
    await expect(compileAvgVisualPlanningProposalV1({ ...input, visualBible: missing })).rejects.toThrow(/覆盖/)
  })

  it('does not drop a required real-reference descriptor or send a reference permitted only for a different consumer', async () => {
    const input = await fixture()
    const dropped = structuredClone(input.mediaBriefs); dropped.find(b => b.subjectKind === 'character')!.outputs[0].referenceKeys = []
    await expect(compileAvgVisualPlanningProposalV1({ ...input, mediaBriefs: dropped })).rejects.toThrow(/必需参考/)
    const expanded = structuredClone(input.mediaBriefs); expanded.find(b => b.subjectKind === 'environment')!.outputs[0].referenceKeys = ['ref.keeper']
    await expect(compileAvgVisualPlanningProposalV1({ ...input, mediaBriefs: expanded })).rejects.toThrow(/参考权限/)
    const unrelated = structuredClone(input.scope); unrelated.referenceCatalog.push({ referenceKey: 'unapproved.catalog', reference: reference('outside', 'style') })
    expect(() => parseAvgVisualPlanningScopeV1(unrelated)).toThrow(/目录/)
    const revoked = structuredClone(input.scope); Object.assign(revoked.referenceCatalog[0].reference, { providerInputAllowed: false })
    expect(() => parseAvgVisualPlanningScopeV1(revoked)).toThrow(/授权/)
  })

  it('rejects stale text and undeclared item display slots instead of modifying rules to make the image fit', async () => {
    const input = await fixture(), stale = structuredClone(input.source)
    stale.scripts[0].lines[0].text += '修订'
    await expect(compileAvgVisualPlanningProposalV1({ ...input, source: stale })).rejects.toThrow(/重新冻结/)
    const undeclared = structuredClone(input.source)
    if (undeclared.systemPlan.version !== 2) throw new Error('inventory fixture required')
    undeclared.systemPlan.inventory.items[0].iconAssetKey = null
    const { sourceInputHash: _hash, aspectRatio: _ratio, ...scope } = input.scope
    await expect(freezeAvgVisualPlanningScopeV1(scope, undeclared)).rejects.toThrow(/生成前确认/)
    expect(undeclared.systemPlan.inventory.items[0].iconAssetKey).toBeNull()
  })

  it('retains existing batch limits and rejects duplicate consumers or oversized composed prompts', async () => {
    const input = await fixture()
    const duplicate = structuredClone(input.scope)
    duplicate.templates[2].parameters.consumer = structuredClone(duplicate.templates[1].parameters.consumer)
    duplicate.templates[2].parameters.triggerBeatKey = duplicate.templates[1].parameters.triggerBeatKey
    await expect(compileAvgVisualPlanningProposalV1({ ...input, scope: duplicate })).rejects.toThrow(/重复/)
    const expanded = structuredClone(input.scope)
    expanded.templates.push(...Array.from({ length: 4 }, () => structuredClone(expanded.templates[0])))
    expect(() => parseAvgVisualPlanningScopeV1(expanded)).toThrow(/有界/)
    const oversized = structuredClone(input.scope)
    oversized.templates[0].requiredDetails = Array.from({ length: 24 }, (_, index) => `${index}:` + '定'.repeat(996))
    const { sourceInputHash: _hash, aspectRatio: _ratio, ...oversizedScope } = oversized
    await expect(freezeAvgVisualPlanningScopeV1(oversizedScope, input.source)).rejects.toThrow(/文本上限/)
    const repeated = structuredClone(oversizedScope)
    repeated.templates[0].requiredDetails = Array.from({ length: 24 }, () => '定'.repeat(1000))
    await expect(freezeAvgVisualPlanningScopeV1(repeated, input.source)).resolves.toHaveProperty('sourceInputHash', input.scope.sourceInputHash)
    const long = structuredClone(input)
    long.visualBible.style.medium = '媒'.repeat(1000); long.visualBible.style.rendering = '绘'.repeat(1000)
    long.visualBible.style.lighting = '光'.repeat(1000); long.visualBible.style.composition = '构'.repeat(2000)
    long.mediaBriefs[0].designIntent = '意'.repeat(2000); long.mediaBriefs[0].outputs[0].prompt = '图'.repeat(6000)
    await expect(compileAvgVisualPlanningProposalV1(long)).rejects.toThrow(/prompt|上限/)
  })

  it('keeps the actual per-request reference byte ceiling after semantic planning without silently dropping selected inputs', async () => {
    const input = await fixture(), selected = Array.from({ length: 4 }, (_, index) => `large.reference.${index}`)
    input.scope.referenceCatalog = input.scope.referenceCatalog.filter(entry => entry.referenceKey !== 'ref.keeper')
    input.scope.referenceCatalog.push(...selected.map(key => ({ referenceKey: key, reference: { ...reference(`original.${key}`, 'identity'), byteSize: 8 * 1024 * 1024 } })))
    for (const t of input.scope.templates.filter(t => t.subjectKind === 'character')) t.allowedReferenceKeys = t.requiredReferenceKeys = [...selected]
    for (const output of input.mediaBriefs.find(b => b.subjectKind === 'character')!.outputs) output.referenceKeys = [...selected]
    expect(parseAvgVisualPlanningScopeV1(input.scope).referenceCatalog).toHaveLength(5)
    const { sourceInputHash: _hash, aspectRatio: _ratio, ...oversizedScope } = input.scope
    await expect(freezeAvgVisualPlanningScopeV1(oversizedScope, input.source)).rejects.toThrow(/参考总字节/)
    await expect(compileAvgVisualPlanningProposalV1(input)).rejects.toThrow(/参考总字节/)
  })
})
