/** S2 design proposals are drafts, never a production start or a runtime plan.
 * Models may fill only the sections requested by the author. Protected policy,
 * prior facts and ownership come from the captured draft, not model JSON. */
import type { TtrpgOpenAuthoringV1, TtrpgOpenFrozenFactV1, RulePackV2 } from './open-contract'
import { parseTtrpgOpenAuthoringV1 } from './open-content-authoring'
import { frozenFact } from './open-content-predicates'
import { canonicalProductProductionJsonV2 as stable } from '../product-production/hash'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_AUTHORING_DESIGN_SECTIONS_V1 = [
  'situationTemplates', 'openingSituationKeys', 'effectPlanTemplates', 'pressure', 'dynamicEntityTemplates', 'factProposals',
] as const
export type TtrpgOpenAuthoringDesignSectionV1 = typeof TTRPG_OPEN_AUTHORING_DESIGN_SECTIONS_V1[number]
export const TTRPG_OPEN_DESIGN_PROMPT_VERSION_V2 = 'ttrpg-open-authoring-design-v2'
export const TTRPG_OPEN_DESIGN_PROMPT_VERSION_V3 = 'ttrpg-open-authoring-design-v3'
/** These are bounded execution profiles of the same pipeline and authority.
 * Each must match its registered Skill and exact formal-entry binding. */
export const TTRPG_OPEN_DESIGN_PROFILES_V1 = [
  { skillId: 'ttrpg.open.authoring-design.v1', entryId: 'ttrpg.open.authoring-design', maxOutputTokens: 16_000 },
  { skillId: 'ttrpg.open.authoring-design.full.v1', entryId: 'ttrpg.open.authoring-design.full', maxOutputTokens: 24_000 },
] as const
export function ttrpgOpenDesignProfileForSkillV1(skillId: string) {
  return TTRPG_OPEN_DESIGN_PROFILES_V1.find(profile => profile.skillId === skillId)
}
export function ttrpgOpenDesignProfileV1(sections: readonly TtrpgOpenAuthoringDesignSectionV1[]) {
  return TTRPG_OPEN_DESIGN_PROFILES_V1[sections.includes('situationTemplates') ? 1 : 0]
}
/** Per-request intent under the registered Skill ceiling; never used to
 * reinterpret the budget of an already frozen request. */
export function ttrpgOpenDesignOutputBudgetV1(sections: readonly TtrpgOpenAuthoringDesignSectionV1[]): number {
  return ttrpgOpenDesignProfileV1(sections).maxOutputTokens
}
export function ttrpgOpenDesignRuleRefsV1(rule: RulePackV2): string[] {
  return [...new Set([rule.ruleSystemId, ...rule.actions.map(item => item.key), ...rule.checks.map(item => item.key),
    ...rule.oracles.map(item => item.oracleKey)])].sort()
}
export const MAX_TTRPG_OPEN_AUTHORING_DESIGN_CHARACTERS_V1 = 120_000
type DesignFields = Exclude<TtrpgOpenAuthoringDesignSectionV1, 'factProposals'>
export type TtrpgOpenAuthoringDesignPatchV1 = Partial<Pick<TtrpgOpenAuthoringV1, DesignFields>> & { factProposals?: TtrpgOpenFrozenFactV1[] }
export interface TtrpgOpenAuthoringDesignRequestV1 {
  schema: 'storyforge.ttrpg-open-authoring-design-request'; version: 1
  instruction: string; sections: TtrpgOpenAuthoringDesignSectionV1[]
}
export interface TtrpgOpenAuthoringDesignProposalsV1 {
  schema: 'storyforge.ttrpg-open-authoring-design-proposals'; version: 1
  proposals: { proposalKey: string; title: string; pitch: string; patch: TtrpgOpenAuthoringDesignPatchV1 }[]
}
export interface TtrpgOpenAuthoringDesignContextV1 {
  request: TtrpgOpenAuthoringDesignRequestV1
  base: TtrpgOpenAuthoringV1
  /** Producer must derive this from actual Context Manifest reads, not merely
   * the allowed SourcePlan catalogue. Field-body/hash verification stays separate. */
  readWorldResourceKeys: readonly string[]
  /** Only the new frozen prompt protocol supplies this set. Older requests
   * retain their original staged S3 rule-reference validation semantics. */
  ruleRefs?: readonly string[]
}

/** An existing authored design may already declare references whose final
 * source/actor closure belongs to S3. A genuinely empty draft has no such basis;
 * its first situations must request explicit, still-unconfirmed source facts. */
export function ttrpgOpenDesignNeedsInitialFactsV1(base: TtrpgOpenAuthoringV1): boolean {
  return base.factPolicy.length === 0 && base.situationTemplates.length === 0
}

export function parseTtrpgOpenAuthoringDesignRequestV1(input: unknown): TtrpgOpenAuthoringDesignRequestV1 {
  const row = p.record(p.json(input), ['schema', 'version', 'instruction', 'sections'], 'authoring design request')
  const selected = p.unique(p.list(row.sections, 'design sections', (v, l) =>
    p.oneOf(v, TTRPG_OPEN_AUTHORING_DESIGN_SECTIONS_V1, l), 6, 1), 'design sections')
  return { schema: p.literal(row.schema, 'storyforge.ttrpg-open-authoring-design-request', 'design request schema'),
    version: p.literal(row.version, 1, 'design request version'), instruction: p.text(row.instruction, 'author instruction', 5000),
    sections: TTRPG_OPEN_AUTHORING_DESIGN_SECTIONS_V1.filter(key => selected.includes(key)) }
}

function draftFromPatch(value: unknown, context: TtrpgOpenAuthoringDesignContextV1) {
  const request = parseTtrpgOpenAuthoringDesignRequestV1(context.request)
  const base = parseTtrpgOpenAuthoringV1(context.base)
  if (!base.companionPolicy || !base.stageClosurePolicy || !base.runtimePolicy) p.fail('请先填写本桌边界草稿；模型不能代为授予运行或预算权限')
  const row = p.record(value, request.sections, 'requested design patch')
  const read = new Set(context.readWorldResourceKeys)
  const facts = request.sections.includes('factProposals')
    ? p.list(row.factProposals, 'new fact proposals', frozenFact, 20_000) : []
  p.unique(facts.map(fact => fact.factKey), 'new fact keys')
  const retained = new Set(base.factPolicy.map(item => item.fact.factKey))
  for (const fact of facts) {
    if (retained.has(fact.factKey)) p.fail('模型不能替换或重命名现有事实的确认状态')
    if (!fact.sourceResourceRefs.length || !fact.sourceFieldRefs.length) p.fail('新增世界事实必须保留实际读取的字段来源')
    for (const ref of fact.sourceResourceRefs) if (!read.has(ref)) p.fail(`事实引用未实际读取的世界资源:${ref}`)
  }
  const merged: Record<string, unknown> = { ...base, factPolicy: [...base.factPolicy, ...facts.map(fact => ({ fact, authorConfirmed: false }))] }
  for (const key of request.sections) if (key !== 'factProposals') merged[key] = row[key]
  const authoring = parseTtrpgOpenAuthoringV1(merged)
  if (context.ruleRefs && request.sections.includes('effectPlanTemplates')) {
    const rules = new Set(context.ruleRefs)
    for (const plan of authoring.effectPlanTemplates) if (!rules.has(plan.ruleRef)) p.fail(`后果模板引用未冻结规则:${plan.ruleRef}`)
  }
  // Typed draft parsers own the nested shape. Check only actual-world source
  // references here; character bindings and complete campaign closure still need
  // the original S3 production/compiler/publication gates.
  for (const item of [...authoring.situationTemplates, ...authoring.pressure.clocks, ...authoring.pressure.fronts]) {
    for (const ref of item.sourceRefs) if (!read.has(ref)) p.fail(`设计引用未实际读取的世界资源:${ref}`)
  }
  const patch: TtrpgOpenAuthoringDesignPatchV1 = {}
  for (const key of request.sections) {
    if (key === 'factProposals') patch.factProposals = facts
    else Object.assign(patch, { [key]: authoring[key] })
  }
  return { patch, authoring }
}

/** This rejects identical/label-only proposals; human review still determines
 * whether their motives, pressure and choices are meaningfully different. */
function designSignature(value: unknown): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip)
    if (!v || typeof v !== 'object') return v
    return Object.fromEntries(Object.entries(v).filter(([key]) => !['title', 'pitch', 'description'].includes(key))
      .map(([key, child]) => [key, strip(child)]))
  }
  return stable(strip(value))
}

export function parseTtrpgOpenAuthoringDesignProposalsV1(input: unknown, context: TtrpgOpenAuthoringDesignContextV1): TtrpgOpenAuthoringDesignProposalsV1 {
  if (typeof input === 'string' && input.length > MAX_TTRPG_OPEN_AUTHORING_DESIGN_CHARACTERS_V1) p.fail('设计回答过长，原草稿保持不变')
  const row = p.record(p.json(input), ['schema', 'version', 'proposals'], 'authoring design proposals')
  const proposals = p.list(row.proposals, 'design proposals', (v, label) => {
    const item = p.record(v, ['proposalKey', 'title', 'pitch', 'patch'], label)
    return { proposalKey: p.key(item.proposalKey, label), title: p.text(item.title, label, 200), pitch: p.text(item.pitch, label, 1200),
      patch: draftFromPatch(item.patch, context).patch }
  }, 3, 3)
  p.unique(proposals.map(item => item.proposalKey), 'proposal keys')
  if (new Set(proposals.map(item => designSignature(item.patch))).size !== 3) p.fail('三个设计不能只是相同内容或更换标题')
  const result: TtrpgOpenAuthoringDesignProposalsV1 = { schema: p.literal(row.schema, 'storyforge.ttrpg-open-authoring-design-proposals', 'proposals schema'),
    version: p.literal(row.version, 1, 'proposals version'), proposals }
  if (stable(result).length > MAX_TTRPG_OPEN_AUTHORING_DESIGN_CHARACTERS_V1) p.fail('设计回答过长，原草稿保持不变')
  return result
}

/** A selection can combine requested sections from different proposals. This
 * recomputes the typed draft and its local references; it grants no adoption. */
export function composeTtrpgOpenAuthoringDesignV1(input: unknown, selection: unknown, context: TtrpgOpenAuthoringDesignContextV1): TtrpgOpenAuthoringV1 {
  const candidates = parseTtrpgOpenAuthoringDesignProposalsV1(input, context)
  const request = parseTtrpgOpenAuthoringDesignRequestV1(context.request)
  const picks = p.record(selection, request.sections, 'design section selection')
  const patch: Record<string, unknown> = {}
  for (const section of request.sections) {
    const key = p.key(picks[section], section), donor = candidates.proposals.find(item => item.proposalKey === key)
    if (!donor) p.fail(`分区选择没有对应候选:${key}`)
    patch[section] = donor.patch[section]
  }
  return draftFromPatch(patch, context).authoring
}
