/** Closed P9 proposal/preflight contract. A successful preflight never accepts, activates or writes a template. */
import type { RulePackV2, TtrpgCampaignContentV2, TtrpgSituationTemplateV1 } from './open-contract'
import type { TtrpgSessionFactV1 } from './session-facts'
import { parseTtrpgSituationTemplateV1 } from './situation-engine'
import { assertTtrpgOpenSituationUsesCurrentFactsV1, validateTtrpgOpenSessionSituationReferencesV1 } from './open-content-references'
import { checkTtrpgSituationGenerationV1, type TtrpgSituationGenerationHistoryItemV1 } from './situation-generation'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import * as p from './open-contract-parse'
import type { TtrpgOpenRuntimeEntityReferencesV1, TtrpgOpenRuntimeEntityReferenceV1 } from './open-runtime-entity-references'

export const TTRPG_OPEN_SITUATION_INPUT_SOURCE_V1 = 'ttrpgOpenSituationInput'
export interface TtrpgOpenSituationPersonalizationSourceV1 {
  sourceKey: string; kind: 'identity' | 'choice' | 'commitment'; actorKeys: string[]; knownByActorKeys: string[];
  sourceRef: TtrpgOpenSourceRefV1 | null; contentHash: string;
}
export interface TtrpgOpenGeneratedSituationProposalV1 {
  schema: 'storyforge.ttrpg-open-situation-proposal'; version: 1;
  template: TtrpgSituationTemplateV1; personalizationSourceKeys: string[];
}
export interface TtrpgOpenSituationProposalBasisV1 {
  runtimeSourceHash: string; worldReleaseHash: string; sourceLineageHash: string; sessionKey: string;
  assignedTemplateKey: string; selectedActorKeys: string[]; worldTurn: number; authorizationHash: string; mechanicalStateHash: string;
  campaign: TtrpgCampaignContentV2; rule: RulePackV2; sessionFacts: TtrpgSessionFactV1[];
  retiredSessionFacts?: TtrpgSessionFactV1[];
  runtimeEntityReferences?: TtrpgOpenRuntimeEntityReferencesV1;
  /** Internal validation only; prior adoption never widens this new model request. */
  historicalRuntimeEntityReferences?: TtrpgOpenRuntimeEntityReferenceV1[];
  sessionTemplates: TtrpgSituationTemplateV1[]; history: Array<TtrpgSituationGenerationHistoryItemV1 & { sourceRef: TtrpgOpenSourceRefV1; situationKey: string; sourceKind?: 'adopted-definition' }>;
  cooldownUntilWorldTurn: Record<string, number>; personalizationSources: TtrpgOpenSituationPersonalizationSourceV1[];
}
/** The caller supplies the system-owned key; the model has no field for a template identity or proof. */
export function parseTtrpgOpenGeneratedSituationProposalV1(value: unknown, assignedTemplateKey: string): TtrpgOpenGeneratedSituationProposalV1 {
  const r = p.record(p.json(value), ['schema', 'version', 'template', 'personalizationSourceKeys'], 'generated situation proposal')
  const raw = p.object(r.template, 'proposed template')
  if (Object.prototype.hasOwnProperty.call(raw, 'templateKey')) p.fail('生成器不能声明系统拥有的 templateKey')
  const template = parseTtrpgSituationTemplateV1({ ...raw, templateKey: p.key(assignedTemplateKey, 'assigned template') })
  if (template.evidence.some(e => !e.clueRef.startsWith(`${template.templateKey}.`))) p.fail('生成线索身份必须位于本候选的独立命名空间')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-situation-proposal', 'proposal schema'), version: p.literal(r.version, 1, 'proposal version'),
    template, personalizationSourceKeys: p.keys(r.personalizationSourceKeys, 'personalization sources', 100, 1) }
}
export function parseTtrpgOpenSituationPersonalizationSourceV1(value: unknown): TtrpgOpenSituationPersonalizationSourceV1 {
  const r = p.record(value, ['sourceKey', 'kind', 'actorKeys', 'knownByActorKeys', 'sourceRef', 'contentHash'], 'personalization source')
  const source = { sourceKey: p.key(r.sourceKey, 'personalization source key'), kind: p.oneOf(r.kind, ['identity', 'choice', 'commitment'], 'personalization kind'),
    actorKeys: p.keys(r.actorKeys, 'personalization actors', 1000, 1), knownByActorKeys: p.keys(r.knownByActorKeys, 'personalization recipients', 1000, 1),
    sourceRef: r.sourceRef === null ? null : parseTtrpgOpenSourceRefV1(r.sourceRef), contentHash: p.hash(r.contentHash, 'personalization source hash') }
  if (source.kind !== 'identity' && source.sourceRef === null) p.fail('玩家选择或承诺必须绑定真实来源事件')
  return source
}
export async function reviewTtrpgOpenGeneratedSituationProposalV1(input: { value: unknown; basis: TtrpgOpenSituationProposalBasisV1 }) {
  const { basis } = input, proposal = parseTtrpgOpenGeneratedSituationProposalV1(input.value, basis.assignedTemplateKey)
  const existing = [...basis.campaign.situationTemplates, ...basis.sessionTemplates]
  if (existing.some(t => t.templateKey === proposal.template.templateKey)) p.fail('新局势不得覆盖已冻结或已确认的模板身份')
  const sources = basis.personalizationSources.map(parseTtrpgOpenSituationPersonalizationSourceV1)
  p.unique(sources.map(s => s.sourceKey), 'personalization directory')
  const selected = proposal.personalizationSourceKeys.map(key => sources.find(s => s.sourceKey === key) ?? p.fail('A3: 引用没有真实玩家来源'))
  if (selected.some(s => s.actorKeys.some(k => !basis.selectedActorKeys.includes(k)) || s.knownByActorKeys.some(k => !basis.selectedActorKeys.includes(k)))) p.fail('A3: 个性化引用越过当前活动角色')
  const driver = proposal.template.driverBinding
  if (driver.kind === 'player-commitment'
    && !selected.some(s => s.kind === 'commitment' && s.sourceKey === driver.factRef)) p.fail('玩家承诺驱动必须引用真实已确认承诺，不得由 Oracle 或模型代替玩家承诺')
  assertTtrpgOpenSituationUsesCurrentFactsV1(proposal.template, [...basis.sessionFacts, ...(basis.retiredSessionFacts ?? [])])
  const catalog = [...basis.sessionTemplates, proposal.template]
  parseTtrpgSituationTemplateV1(proposal.template, { ...basis.campaign, situationTemplates: [...existing, proposal.template], sessionFactKeys: basis.sessionFacts.map(f => f.factKey),
    ...(basis.runtimeEntityReferences ? { runtimeEntityReferences: basis.runtimeEntityReferences.references } : {}) }, basis.rule)
  const currentReferences = basis.runtimeEntityReferences?.references ?? []
  validateTtrpgOpenSessionSituationReferencesV1({ campaign: basis.campaign, rule: basis.rule, sessionTemplates: catalog, sessionFacts: basis.sessionFacts,
    runtimeEntityReferences: currentReferences, onlySessionTemplateKey: proposal.template.templateKey })
  const historicalReferences = new Map((basis.historicalRuntimeEntityReferences ?? []).map(row => [row.entityRef, row]))
  for (const row of currentReferences) {
    const prior = historicalReferences.get(row.entityRef)
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) p.fail('局势实例当前与历史身份冲突')
    historicalReferences.set(row.entityRef, row)
  }
  validateTtrpgOpenSessionSituationReferencesV1({ campaign: basis.campaign, rule: basis.rule, sessionTemplates: catalog, sessionFacts: [...basis.sessionFacts, ...(basis.retiredSessionFacts ?? [])],
    runtimeEntityReferences: [...historicalReferences.values()] })
  const evaluation = checkTtrpgSituationGenerationV1({ candidate: proposal.template, recentSituations: basis.history,
    worldTurn: basis.worldTurn, cooldownUntilWorldTurn: basis.cooldownUntilWorldTurn, playerFactKeys: sources.map(s => s.sourceKey), playerActorKeys: basis.selectedActorKeys,
    personalizationRefs: selected.map(s => ({ factKey: s.sourceKey, kind: s.kind, actorScope: s.actorKeys, knownByActorKeys: s.knownByActorKeys })) })
  const proposalHash = await hash(proposal), basisHash = await hash(basis)
  return { schema: 'storyforge.ttrpg-open-situation-preflight' as const, version: 1 as const, proposal, proposalHash, basisHash,
    personalizationEvidence: selected, evaluation, runtimeSourceHash: p.hash(basis.runtimeSourceHash, 'proposal source'),
    sourceLineageHash: p.hash(basis.sourceLineageHash, 'proposal lineage'), outputIsCandidate: true as const, grantsAcceptance: false as const }
}
