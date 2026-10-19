import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgVisualProductionBatchV1, type AvgVisualProductionBatchV1, type AvgVisualProductionRequirementV1 } from './media-production-contract'
import type { AvgSystemPlan } from './system-contract'
import { composeAvgCharacterFamilyRequirementsV1, hashAvgCharacterFamilyProposalV1 } from './character-family-contract'
import { avgList, avgProtocolBody, avgRecord, avgUnique } from './protocol-validation'
import { avgMediaBriefArtifactKeyV1, avgVisualPlanningTemplateRequirementsV1, parseAvgMediaBriefV1, parseAvgVisualBibleV1, parseAvgVisualPlanningScopeV1, type AvgVisualDesignKindV1, type AvgVisualPlanningScopeV1, type AvgVisualBibleV1, type AvgMediaBriefV1 } from './visual-planning-contract'

export type AvgMediaSourceInputV1 = Pick<AvgAuthorWorkspaceV1, 'systemPlan' | 'scripts'> & {
  presentation: Pick<AvgAuthorWorkspaceV1['presentation'], 'aspectRatio'>
}

/** Selection, cues, reading preferences and the batch itself cannot recursively
 * invalidate a request. Canonical rules/text/aspect still fence its meaning.
 * This projection is not a SourcePlan, context grant or author adoption. */
export function normalizeAvgMediaSourceInputV1(value: AvgMediaSourceInputV1) {
  const source = parseAvgAuthorWorkspaceV1({ schema: 'storyforge.avg.author-workspace', version: 1, basePreviewHash: null,
    systemPlan: value.systemPlan, scripts: value.scripts,
    presentation: { schema: 'storyforge.avg.author-stage', version: 1, aspectRatio: value.presentation.aspectRatio,
      stage: { version: 1, cues: [], assets: [] } } })
  const scenes = new Set(source.systemPlan.scenes.map(s => s.key)), characters = new Set(source.systemPlan.characters.map(c => c.key))
  for (const script of source.scripts) {
    if (!scenes.has(script.sceneKey) || script.lines.some(line => line.speakerKey !== null && !characters.has(line.speakerKey))) {
      throw new Error('[avg-media] 媒资来源脚本引用未知场景或人物')
    }
  }
  return { schema: 'storyforge.avg.media-source-input' as const, version: 1 as const, systemPlan: source.systemPlan,
    scripts: [...source.scripts].sort((a, b) => a.sceneKey < b.sceneKey ? -1 : a.sceneKey > b.sceneKey ? 1 : 0),
    aspectRatio: source.presentation.aspectRatio }
}

export async function hashAvgMediaSourceInputV1(input: AvgMediaSourceInputV1): Promise<string> {
  return hashProductProductionValueV2(normalizeAvgMediaSourceInputV1(input))
}

/** Verify exact existing consumer slots. A gameplay state is not a display
 * variant; never invent predicates or rewrite rules to make a target exist. */
export async function validateAvgVisualProductionBatchSourceV1(value: unknown, input: AvgMediaSourceInputV1): Promise<AvgVisualProductionBatchV1> {
  const batch = parseAvgVisualProductionBatchV1(value), source = normalizeAvgMediaSourceInputV1(input)
  if (batch.aspectRatio !== source.aspectRatio || batch.sourceInputHash !== await hashProductProductionValueV2(source)) {
    throw new Error('[avg-media] 系统、文本或画幅已变化，请重新冻结媒资需求')
  }
  const plan = source.systemPlan
  if(batch.characterFamily){
    const {proposal}=batch.characterFamily,{proposalHash,...body}=proposal
    if(proposalHash!==await hashAvgCharacterFamilyProposalV1(body)||proposal.sourceInputHash!==batch.sourceInputHash
      ||!plan.characters.some(character=>character.key===proposal.plan.subjectKey)
      ||canonicalProductProductionJsonV2(composeAvgCharacterFamilyRequirementsV1(proposal.plan))!==canonicalProductProductionJsonV2(batch.requirements))throw new Error('[avg-family] 家族提案、授权或准确变体需求已变化，请重新核对')
  }
  assertAvgVisualRequirementSourceConsumersV1(batch.requirements,source)
  return batch
}

/** Exact canonical consumer checks, shared by explicit batch versions. */
export function assertAvgVisualRequirementSourceConsumersV1(requirements:Pick<AvgVisualProductionRequirementV1,'consumer'|'triggerBeatKey'|'itemVariantKey'>[],source:ReturnType<typeof normalizeAvgMediaSourceInputV1>){
  const plan=source.systemPlan
  for (const r of requirements) {
    const c = r.consumer
    if (c.domain === 'stage') {
      const scene = plan.scenes.find(s => s.key === c.sceneKey), script = source.scripts.find(s => s.sceneKey === c.sceneKey)
      // The current script codec requires beatKey === lineKey, and the
      // executable module uses that canonical line identity as its Cue clock.
      if (!scene || !script?.lines.some(line => line.lineKey === r.triggerBeatKey)) throw new Error('[avg-media] 演出消费缺少准确场景和触发拍')
      if (c.slot === 'actor' ? !plan.characters.some(p => p.key === c.subjectKey) : c.subjectKey !== scene.key) {
        throw new Error('[avg-media] 演出消费主体与人物或场景不一致')
      }
    } else if (c.domain === 'inventory' || c.domain === 'evidence') {
      const item = plan.version === 2 ? plan.inventory.items.find(i => i.key === c.subjectKey) : undefined
      if (!item || r.itemVariantKey !== null && !item.variants.some(v => v.key === r.itemVariantKey)) {
        throw new Error('[avg-media] 物件消费缺少准确物件或显示变体；不能用玩法状态代替')
      }
    } else if (c.domain === 'reference') {
      if (!plan.characters.some(p => p.key === c.subjectKey) && !plan.scenes.some(s => s.key === c.subjectKey)
        && !(plan.version === 2 && plan.inventory.items.some(i => i.key === c.subjectKey))) {
        throw new Error('[avg-media] 参考图主体未在当前系统声明')
      }
    } else throw new Error('[avg-media] 未实现的图像消费域')
  }
}

/** Item slots must be declared before media dispatch freezes canonical rules.
 * Draft preparation may propose these references; execution never adds them. */
export function assertAvgMediaConsumerDeclarationsV1(batch: {requirements:Pick<AvgVisualProductionRequirementV1,'consumer'|'itemVariantKey'|'assetKey'>[]}, plan: AvgSystemPlan) {
  for (const r of batch.requirements) {
    if (r.consumer.domain !== 'inventory' && r.consumer.domain !== 'evidence') continue
    const item = plan.version === 2 ? plan.inventory.items.find(item => item.key === r.consumer.subjectKey) : undefined
    const view = r.itemVariantKey === null ? item : item?.variants.find(view => view.key === r.itemVariantKey)
    if (!view || (r.consumer.domain === 'inventory' ? view.iconAssetKey : view.detailAssetKey) !== r.assetKey) {
      throw new Error('[avg-media] 请在生成前确认准确物件显示槽的图片声明，再冻结需求')
    }
  }
}

/** Caller must save and explicitly review/start this bounded input. This helper
 * neither reads provider configuration nor makes a call, candidate or binding. */
export async function freezeAvgVisualProductionBatchV1(value: Omit<AvgVisualProductionBatchV1, 'sourceInputHash' | 'aspectRatio'>, input: AvgMediaSourceInputV1) {
  const batch = { ...value, aspectRatio: input.presentation.aspectRatio, sourceInputHash: await hashAvgMediaSourceInputV1(input) }
  return validateAvgVisualProductionBatchSourceV1(batch, input)
}

/** Planning validates the same canonical facts and real consumer declarations
 * as image dispatch. Placeholder words are local validation input only: no
 * candidate, adopted plan, provider request or call is created here. */
export function hasAvgVisualPlanningSubjectV1(plan: AvgSystemPlan, kind: AvgVisualDesignKindV1, key: string) {
  return kind === 'character' ? plan.characters.some(s => s.key === key)
    : kind === 'environment' ? plan.scenes.some(s => s.key === key)
      : plan.version === 2 && plan.inventory.items.some(s => s.key === key)
}

async function validatePlanningScopeSource(scope: AvgVisualPlanningScopeV1, source: AvgMediaSourceInputV1) {
  const skeleton = await validateAvgVisualProductionBatchSourceV1({ schema: 'storyforge.avg.visual-production-batch', version: 1,
    batchKey: scope.batchKey, revision: scope.revision, aspectRatio: scope.aspectRatio, sourceInputHash: scope.sourceInputHash,
    requirements: avgVisualPlanningTemplateRequirementsV1(scope) }, source)
  assertAvgMediaConsumerDeclarationsV1(skeleton, source.systemPlan)
  for (const t of scope.templates) {
    if (!hasAvgVisualPlanningSubjectV1(source.systemPlan, t.subjectKind, t.parameters.family.subjectKey)) {
      throw new Error('[avg-visual-plan] 策划主体种类与准确系统来源不一致')
    }
  }
}

/** Pure preparation for a future registered S3 planning contract. The caller
 * must verify Work/Build/author authority and persist through Harness/adoption.
 * Neither a metadata catalog nor this hash proves image-byte ownership. */
export async function freezeAvgVisualPlanningScopeV1(value: Omit<AvgVisualPlanningScopeV1, 'sourceInputHash' | 'aspectRatio'>,
  input: AvgMediaSourceInputV1): Promise<AvgVisualPlanningScopeV1> {
  const source = structuredClone(input)
  const scope = parseAvgVisualPlanningScopeV1({ ...value, aspectRatio: source.presentation.aspectRatio, sourceInputHash: await hashAvgMediaSourceInputV1(source) })
  await validatePlanningScopeSource(scope, source)
  return scope
}

/** Same semantic composer for each exact reference contract; no grants or source facts are invented. */
export function composeAvgVisualPlanningRequirementsV1<R>(scope:Pick<AvgVisualPlanningScopeV1,'templates'>&{referenceCatalog:Array<{referenceKey:string;reference:R}>},bible:AvgVisualBibleV1,briefs:AvgMediaBriefV1[],sourcePlan:AvgSystemPlan){
  const subjects = new Map(scope.templates.map(t => [t.parameters.family.subjectKey, t.subjectKind]))
  // Reuse an existing Work-wide direction in a smaller next batch. Other
  // declared subjects neither create image tasks nor acquire reference grants.
  if (bible.subjects.some(s => !hasAvgVisualPlanningSubjectV1(sourcePlan, s.subjectKind, s.subjectKey))) {
    throw new Error('[avg-visual-plan] 视觉基准含当前系统未声明的主体')
  }
  if ([...subjects].some(([key, kind]) => !bible.subjects.some(s => s.subjectKey === key && s.subjectKind === kind))
    || subjects.size !== briefs.length
    || briefs.some(b => subjects.get(b.subjectKey) !== b.subjectKind)) {
    throw new Error('[avg-visual-plan] 视觉基准或媒资方案未准确覆盖冻结主体')
  }
  for (const brief of briefs) {
    const expected = scope.templates.filter(t => t.parameters.family.subjectKey === brief.subjectKey).map(t => t.parameters.requirementKey)
    if (expected.length !== brief.outputs.length || brief.outputs.some(o => !expected.includes(o.requirementKey))) {
      throw new Error('[avg-visual-plan] 主体方案遗漏、重复或扩大了冻结图片需求')
    }
  }
  return scope.templates.map(t => {
    const subject = bible.subjects.find(s => s.subjectKey === t.parameters.family.subjectKey)!
    const brief = briefs.find(b => b.subjectKey === subject.subjectKey)!
    const output = brief.outputs.find(o => o.requirementKey === t.parameters.requirementKey)!
    if (output.referenceKeys.some(key => !t.allowedReferenceKeys.includes(key))
      || t.requiredReferenceKeys.some(key => !output.referenceKeys.includes(key))) {
      throw new Error('[avg-visual-plan] 方案丢弃必需参考或扩大本项参考权限')
    }
    const references = output.referenceKeys.map(key => scope.referenceCatalog.find(entry => entry.referenceKey === key)!.reference)
    const style = bible.style
    return { ...t.parameters, prompt: [`媒介：${style.medium}`, `绘制：${style.rendering}`, `配色：${style.palette.join('；')}`,
      `光照：${style.lighting}`, `构图：${style.composition}`, `本主体制作意图：${brief.designIntent}`,
      `基准允许变化：${subject.allowedChanges.join('；')}`, output.prompt].join('\n'), negativePrompt: output.negativePrompt,
      invariants: [...new Set([...t.requiredDetails, ...subject.identityInvariants, ...output.invariants])],
      forbiddenDepictions: [...new Set([...t.forbiddenDepictions, ...subject.forbiddenDepictions, ...output.forbiddenDepictions])], references }
  })
}

/** Consumers can recompile under their existing read/write transaction.
 * Each WebCrypto hash owns a Dexie keep-alive; overlapping leases can retain
 * one another. Preserve the same subject order and bytes with one at a time. */
export async function hashAvgMediaBriefInputsV1(briefs:AvgMediaBriefV1[]){
  const mediaBriefs:Array<{artifactKey:string;contentHash:string}>=[]
  for(const brief of [...briefs].sort((a,b)=>a.subjectKey<b.subjectKey?-1:a.subjectKey>b.subjectKey?1:0)){
    mediaBriefs.push({artifactKey:avgMediaBriefArtifactKeyV1(brief.subjectKind,brief.subjectKey),contentHash:await hashProductProductionValueV2(brief)})
  }
  return mediaBriefs
}

/** Deterministic semantic proposal, never a producer or adoption receipt.
 * This does not amend any existing V2/V3 Brief or frozen image request. */
export async function compileAvgVisualPlanningProposalV1(input: {
  scope: unknown; visualBible: unknown; mediaBriefs: unknown; source: AvgMediaSourceInputV1
}) {
  const source = structuredClone(input.source), scope = parseAvgVisualPlanningScopeV1(input.scope)
  const bible = parseAvgVisualBibleV1(input.visualBible)
  const briefs = avgUnique(avgList(input.mediaBriefs, 'media briefs', parseAvgMediaBriefV1, 8), b => b.subjectKey, 'media briefs')
  await validatePlanningScopeSource(scope, source)
  const requirements=composeAvgVisualPlanningRequirementsV1(scope,bible,briefs,source.systemPlan)
  // Existing batch checks own concrete byte limits, reference order/purpose,
  // duplicate consumers, supported dimensions and canonical source identity.
  const batch = await validateAvgVisualProductionBatchSourceV1({ schema: 'storyforge.avg.visual-production-batch', version: 1,
    batchKey: scope.batchKey, revision: scope.revision, aspectRatio: scope.aspectRatio, sourceInputHash: scope.sourceInputHash,
    visualReviewPolicy: 'author-visual-v1', requirements }, source)
  assertAvgMediaConsumerDeclarationsV1(batch, source.systemPlan)
  const mediaBriefs = await hashAvgMediaBriefInputsV1(briefs)
  return { schema: 'storyforge.avg.visual-planning-proposal' as const, version: 1 as const, batch,
    inputHashes: { scope: await hashProductProductionValueV2(scope), visualBible: await hashProductProductionValueV2(bible), mediaBriefs },
    batchHash: await hashProductProductionValueV2(batch) }
}

/** Rebuild from the caller's exact trusted inputs. A self-rehashed edited
 * packet still cannot change a consumer, permission or adopted semantic input.
 * Work/Build/Run/adoption authority must be checked by the future caller. */
export async function assertAvgVisualPlanningProposalV1(value: unknown, input: Parameters<typeof compileAvgVisualPlanningProposalV1>[0]) {
  const row = avgRecord(avgProtocolBody(value), ['schema', 'version', 'batch', 'inputHashes', 'batchHash'], 'visual planning proposal')
  const expected = await compileAvgVisualPlanningProposalV1(input)
  if (canonicalProductProductionJsonV2(row) !== canonicalProductProductionJsonV2(expected)) {
    throw new Error('[avg-visual-plan] 策划提案、语义输入或冻结范围已变化')
  }
  return expected
}
