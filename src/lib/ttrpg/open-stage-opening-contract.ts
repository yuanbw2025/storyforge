/** A confirmed opening retains its exact content and approval basis for replay. */
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenNextStagePlanV1 } from './open-stage-opening-plan'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSituationFrozenContentV1 } from './open-situation-runtime'
import { TTRPG_OPEN_GATE_KEYS } from './open-gates'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import * as p from './open-contract-parse'

export interface TtrpgOpenStageOpeningReceiptV1 {
  plan: TtrpgOpenNextStagePlanV1
  frozenContent: TtrpgRuntimeContentV2
}
export function parseTtrpgOpenStageOpeningReceiptV1(value: unknown): TtrpgOpenStageOpeningReceiptV1 {
  const receipt = p.record(value, ['plan', 'frozenContent'], 'stage opening receipt')
  const r = p.record(receipt.plan, ['schema', 'version', 'commandId', 'sessionKey', 'viewerKey', 'authorizationRevision',
    'basisSequence', 'basisStateHash', 'runtimeSourceHash', 'frozenContentHash', 'previousClosureRef', 'plannedSourceRef',
    'atWorldTurn', 'openingKey', 'stageRevision', 'selected', 'humanChecks', 'gateBasisHash', 'stateWithoutOpeningReceiptHash', 'planHash'], 'stage opening plan')
  const sessionKey = p.key(r.sessionKey, 'stage session'), openingKey = p.hash(r.openingKey, 'stage opening key')
  const basisSequence = p.integer(r.basisSequence, 'stage basis sequence', 0, Number.MAX_SAFE_INTEGER - 1)
  const plannedSourceRef = parseTtrpgOpenSourceRefV1(r.plannedSourceRef)
  if (plannedSourceRef.sessionKey !== sessionKey || plannedSourceRef.sequence !== basisSequence + 1
    || r.stageRevision !== `stage.opening.${openingKey}`) p.fail('新阶段必须绑定当前团局的唯一真实事件')
  const selected = p.list(r.selected, 'selected opening situations', value => {
    const s = p.record(value, ['templateKey', 'definitionHash', 'instanceKey', 'transition', 'origin'], 'selected opening')
    const o = p.record(s.origin, ['kind', 'proofHash', 'sourceRef'], 'opening origin')
    const kind = p.oneOf(o.kind, ['frozen-campaign', 'adopted-session'], 'opening origin kind')
    const sourceRef = o.sourceRef === null ? null : parseTtrpgOpenSourceRefV1(o.sourceRef)
    if ((kind === 'frozen-campaign') !== (sourceRef === null)) p.fail('开局素材必须保留准确发布或会话来源')
    return { templateKey: p.key(s.templateKey, 'opening template'), definitionHash: p.hash(s.definitionHash, 'opening definition'),
      instanceKey: p.key(s.instanceKey, 'opening instance'), transition: p.oneOf(s.transition, ['activated', 'continued', 'promoted'], 'opening transition'),
      origin: { kind, sourceRef, proofHash: p.hash(o.proofHash, 'opening proof') } }
  }, 20, 1)
  if (new Set(selected.map(s => s.templateKey)).size !== selected.length || new Set(selected.map(s => s.instanceKey)).size !== selected.length) p.fail('开局局势不能重复')
  const humanChecks = p.list(r.humanChecks, 'opening human checks', value => {
    const h = p.record(value, ['actorKey', 'viewerKey', 'evaluationHash', 'allApplicablePassed', 'checks'], 'opening human check')
    const checks = p.list(h.checks, 'opening gate verdicts', value => {
      const c = p.record(value, ['gateKey', 'applicable', 'passed'], 'opening gate verdict')
      const applicable = p.bool(c.applicable, 'gate applicability'), passed = c.passed === null ? null : p.bool(c.passed, 'gate passed')
      if (applicable ? passed !== true : passed !== null) p.fail('已确认新阶段不得保留失败或伪造的四门结果')
      return { gateKey: p.oneOf(c.gateKey, TTRPG_OPEN_GATE_KEYS, 'opening gate'), applicable, passed }
    }, TTRPG_OPEN_GATE_KEYS.length, TTRPG_OPEN_GATE_KEYS.length)
    if (checks.map(c => c.gateKey).join(',') !== TTRPG_OPEN_GATE_KEYS.join(',')
      || checks.some(c => ['exit-exists', 'hypothesis-formable'].includes(c.gateKey) && !c.applicable)) p.fail('新开局必须实际检查每位真人的 G1/G2')
    return { actorKey: p.key(h.actorKey, 'opening actor'), viewerKey: p.key(h.viewerKey, 'opening viewer'),
      evaluationHash: p.hash(h.evaluationHash, 'opening evaluation'), allApplicablePassed: p.literal(h.allApplicablePassed, true, 'opening gates passed'), checks }
  }, 1000, 1)
  if (new Set(humanChecks.map(h => h.actorKey)).size !== humanChecks.length || new Set(humanChecks.map(h => h.viewerKey)).size !== humanChecks.length) p.fail('新阶段玩家检查重复')
  return { frozenContent: parseTtrpgOpenSituationFrozenContentV1(receipt.frozenContent), plan: {
    schema: p.literal(r.schema, 'storyforge.ttrpg-open-next-stage-plan', 'opening schema'), version: p.literal(r.version, 1, 'opening version'),
    commandId: p.key(r.commandId, 'opening command'), sessionKey, viewerKey: p.key(r.viewerKey, 'opening approver'),
    authorizationRevision: p.integer(r.authorizationRevision, 'opening authorization revision', 1, Number.MAX_SAFE_INTEGER),
    basisSequence, basisStateHash: p.hash(r.basisStateHash, 'opening state hash'), runtimeSourceHash: p.hash(r.runtimeSourceHash, 'opening runtime source'),
    frozenContentHash: p.hash(r.frozenContentHash, 'opening content hash'), previousClosureRef: parseTtrpgOpenSourceRefV1(r.previousClosureRef),
    plannedSourceRef, atWorldTurn: p.integer(r.atWorldTurn, 'opening world turn'), openingKey, stageRevision: `stage.opening.${openingKey}`,
    selected, humanChecks, gateBasisHash: p.hash(r.gateBasisHash, 'opening gate basis'),
    stateWithoutOpeningReceiptHash: p.hash(r.stateWithoutOpeningReceiptHash, 'opening proposed state'), planHash: p.hash(r.planHash, 'opening plan hash'),
  } }
}

export async function verifyTtrpgOpenStageOpeningReceiptsV1(receipts: readonly TtrpgOpenStageOpeningReceiptV1[]): Promise<void> {
  for (const value of receipts) {
    const { plan, frozenContent } = parseTtrpgOpenStageOpeningReceiptV1(value)
    const { planHash, ...body } = plan
    const expectedOpeningKey = await hash({ commandId: plan.commandId, sessionKey: plan.sessionKey, viewerKey: plan.viewerKey, authorizationRevision: plan.authorizationRevision,
      basisSequence: plan.basisSequence, basisStateHash: plan.basisStateHash, runtimeSourceHash: plan.runtimeSourceHash, frozenContentHash: plan.frozenContentHash,
      previousClosureRef: plan.previousClosureRef, templateKeys: plan.selected.map(s => s.templateKey) })
    if (expectedOpeningKey !== plan.openingKey || await hash(body) !== planHash || await hash(frozenContent) !== plan.frozenContentHash
      || plan.selected.some(s => s.origin.kind === 'frozen-campaign' && s.origin.proofHash !== plan.frozenContentHash)) p.fail('阶段开局回执或冻结来源 hash 不一致')
    for (const selected of plan.selected.filter(s => s.origin.kind === 'frozen-campaign')) {
      const definition = frozenContent.campaign.situationTemplates.find(t => t.templateKey === selected.templateKey)
      if (!definition || await hash(definition) !== selected.definitionHash) p.fail('阶段开局发布素材不匹配')
    }
  }
}
