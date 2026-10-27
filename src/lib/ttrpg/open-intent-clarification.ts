/** Current original-candidate routing and jointly visible human clarification options. */
import type { ProductRuntimeSession, ProductRuntimeState, WorkspaceScope } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { loadTtrpgOpenHumanViewV1, loadTtrpgOpenPlayerContextV1 } from './open-player-context'
import { routeTtrpgOpenIntentV1, routeTtrpgOpenIntentV2 } from './open-intent'
import { ttrpgOpenMechanicalStateHashV1, ttrpgOpenPredicateContextV1, parseTtrpgOpenRuleRequestV1,
  createTtrpgOpenRulePlanV1, type TtrpgOpenRuleRequestV1 } from './open-rule-plan'
import { buildTtrpgOpenManualCatalogV1 } from './open-manual-catalog'
import { clarifiedTtrpgOpenIntentV1, hashTtrpgOpenIntentClarificationV1, type TtrpgOpenIntentSelectionV1 } from './open-intent-clarification-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import type { TtrpgOpenOperationV1 } from './open-operation'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import type { TtrpgOpenIntentV1 } from './open-intent'
import { resolveTtrpgOpenIntentTargetV1, resolveTtrpgOpenIntentTargetV2, type TtrpgOpenSceneScopeV1 } from './open-rule-request-contract'

type View = Awaited<ReturnType<typeof loadTtrpgOpenHumanViewV1>>['view']
function knownRefs(view: View, actorKey: string) {
  return new Set([actorKey, ...view.actorsHere.map(a => a.actorKey),
    ...view.initialObservations.flatMap(o => [o.subjectRef,o.objectRef].filter((v): v is string => v !== null)),
    ...view.self.inventory.flatMap(i => [i.itemInstanceId,i.definitionRef]), ...(view.self.locationKey ? [view.self.locationKey] : [])])
}
type IntentRoutingInspectionInput = {
  scope: WorkspaceScope; session: ProductRuntimeSession; state: ProductRuntimeState; content: TtrpgRuntimeContentV2
  viewerKey: string; candidate: TtrpgOpenIntentCandidateV1
}
export async function inspectTtrpgOpenIntentRoutingV1(input: IntentRoutingInspectionInput) {
  return inspectIntentRouting(input,1)
}
/** Explicit human editing and binding completion; legacy inspection keeps its original eligibility. */
export async function inspectTtrpgOpenIntentRoutingV2(input: IntentRoutingInspectionInput) {
  return inspectIntentRouting(input,2)
}
async function inspectIntentRouting(input: IntentRoutingInspectionInput,reviewVersion: 1 | 2) {
  const { state,session,content,candidate,viewerKey } = input, runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  const run = runtime?.openRun, auth = runtime?.authorization, original = candidate.intent
  const call = run?.coordination.calls.find(c => c.requestKey === candidate.requestKey)
  const epoch = run?.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const human = auth?.seats.find(s => s.viewerKey === viewerKey && s.controller !== 'ai' && s.assignmentState === 'claimed')
  if (!runtime || !run || !auth || !call || !epoch || !human?.actorKey || !original || call.status !== 'succeeded' || call.intentRejection
    || epoch.status !== 'active' || epoch.viewerKey !== viewerKey || call.authorizationEpochKey !== epoch.epochKey
    || candidate.viewerKey !== viewerKey || candidate.productRuntimeSessionId !== session.id
    || candidate.actorKey !== call.actorKey || candidate.epochKey !== epoch.epochKey || candidate.runtimeSourceHash !== session.runtimeSourceHash
    || runtime.product.safety.status !== 'active' || run.stage.status !== 'open'
    || run.operations.some(o => o.intentEvidence?.runContractHash === call.runContractHash)) throw Error('原行动候选、真人身份或窗口已变化，请重新读取')
  const approved = original.source.startsWith('companion:')
    ? content.campaign.companionPolicy.approvalBindings.some(b => b.companionActorKey === original.actorKey && b.approverSeatKeys.includes(human.seatKey))
    : original.actorKey === human.actorKey
  if (!approved) throw Error('当前真人没有这名行动者的澄清或确认权限')
  const [actor, reviewer] = await Promise.all([
    loadTtrpgOpenPlayerContextV1({ scope: input.scope,sessionId: session.id!,actorKey: candidate.actorKey }),
    loadTtrpgOpenHumanViewV1({ scope: input.scope,sessionId: session.id!,actorKey: human.actorKey,viewerKey }),
  ])
  if (candidate.admissionStateHash !== await ttrpgOpenMechanicalStateHashV1(state) || candidate.visibilityHash !== actor.visibilityHash
    || actor.readEvidence.sequence !== state.lastSequence || reviewer.readEvidence.sequence !== state.lastSequence) throw Error('候选的机械状态或角色读取范围已变化，请重新核对')
  const actors = content.campaign.characterTemplates.map(template => {
    const seat = auth.seats.find(s => s.actorKey === template.characterKey)
    return { ...template,...(seat ? { controller: seat.controller,seatKey: seat.seatKey } : {}),
      ...(template.characterKey === candidate.actorKey ? { actionKeys: actor.view.rules.actions.map(a => a.actionKey) } : {}) }
  })
  const snapshot = { rulePack: content.rulePack.content,campaign: content.campaign,actors,predicateContext: ttrpgOpenPredicateContextV1(state,content) }
  const originalPreview = (call.intentRoutingVersion === 2 ? routeTtrpgOpenIntentV2 : routeTtrpgOpenIntentV1)(original,snapshot)
  const records = call.intentClarifications ?? [], latest = records[records.length - 1]
  for (const entry of records) if (entry.candidateHash !== candidate.candidateHash || entry.threadKey !== original.clarificationThreadKey
    || entry.viewerKey !== viewerKey || await hashTtrpgOpenIntentClarificationV1(entry) !== entry.clarificationHash) throw Error('原人工澄清证据不一致，保留候选等待核对')
  const routingVersion = latest?.version ?? call.intentRoutingVersion ?? 1
  const intent = clarifiedTtrpgOpenIntentV1(original,latest), preview = (routingVersion === 2 ? routeTtrpgOpenIntentV2 : routeTtrpgOpenIntentV1)(intent,snapshot)
  const currentLocationRef = actor.view.self.locationKey
  const sceneTarget = (value: TtrpgOpenIntentV1, routed: typeof preview): { invalid: boolean; sceneScope?: TtrpgOpenSceneScopeV1 } => {
    const action = content.rulePack.content.actions.find(a => a.key === routed.routeDetail.actionKey)
    if (action?.target !== 'scene' || !(routed.route === 'existing-action' || routed.route === 'no-roll' && routed.routeDetail.interactionKey)) return { invalid: false }
    try { return { invalid: false,...resolveTtrpgOpenIntentTargetV1({ route: 'existing-action',actionTarget: action.target,
      actorKey: candidate.actorKey,targetRefs: value.targetRefs,currentLocationRef }) } } catch { return { invalid: true } }
  }
  const originalScene = sceneTarget(original,originalPreview), currentScene = sceneTarget(intent,preview)
  const originalRequiresClarification = originalPreview.route === 'needs-clarification' || originalScene.invalid
  const actorCatalog = buildTtrpgOpenManualCatalogV1({ state,content,runtime,view: actor.view,actorKey: candidate.actorKey })
  const reviewerCatalog = buildTtrpgOpenManualCatalogV1({ state,content,runtime,view: reviewer.view,actorKey: human.actorKey })
  const actorRefs = knownRefs(actor.view,candidate.actorKey), reviewerRefs = knownRefs(reviewer.view,human.actorKey)
  const sharedCurrentScene = currentLocationRef !== null && reviewerRefs.has(currentLocationRef)
  const shared = (key: string | null) => key === null || key === candidate.actorKey || actorRefs.has(key) && reviewerRefs.has(key)
  const label = (key: string | null, index: number) => key === null ? '当前地点' : key === candidate.actorKey ? '行动者自身'
    : reviewer.view.actorsHere.find(a => a.actorKey === key)?.name ?? `共同可识别的对象 ${index + 1}`
  const parameters = (rows: typeof actorCatalog.rules[number]['parameters']) => rows.map(p => ({ ...p,
    options: p.options.filter(o => shared(o.key)).map((o,i) => ({ key: o.key,name: label(o.key,i) })) }))
  const rules = actorCatalog.rules.flatMap(rule => {
    const common = reviewerCatalog.rules.find(r => r.route === rule.route && r.ruleKey === rule.ruleKey && r.interactionKey === rule.interactionKey)
    if (!common || rule.parameters.some(p => !common.parameters.some(q => q.key === p.key))) return []
    return [{ ...rule,targets: rule.targets.filter(t => shared(t.key)).map((t,i) => ({ key: t.key,name: label(t.key,i) })),parameters: parameters(rule.parameters) }]
  })
  const discoveries = actorCatalog.discoveries.flatMap(d => {
    const common = reviewerCatalog.discoveries.find(r => r.key === d.key)
    if (!common) return []
    const available = d.available && common.available
    // The reviewer sees their own numbering, never gaps/counts from an AI's private directions.
    return [{ ...d,label: common.label,directionNumber: common.directionNumber,available,
      unavailableReason: available ? null : '这条方向需要作者修订。',parameters: parameters(d.parameters) }]
  })
  const executable = (preview.route === 'existing-action' || preview.route === 'generic-check' || preview.route === 'no-roll' && !!preview.routeDetail.interactionKey)
    && (!latest || !!latest.request) && !currentScene.invalid
  const rule = rules.find(r => r.ruleKey === (preview.routeDetail.actionKey ?? preview.routeDetail.checkKey)
    && r.route === (preview.route === 'no-roll' ? 'existing-action' : preview.route) && r.interactionKey === preview.routeDetail.interactionKey)
  const needsBindings = reviewVersion === 2 && !latest && !!rule?.templateKeys.length
  const savedDiscovery = latest?.request?.discovery
  const discoveryAvailable = !savedDiscovery || discoveries.some(d => d.available && d.situationKey === savedDiscovery.situationKey
    && d.evidenceRef === savedDiscovery.evidenceRef && d.interventionPointKey === savedDiscovery.interventionPointKey
    && d.route === latest!.request!.route && d.ruleKey === latest!.request!.ruleKey)
  const review = { route: currentScene.invalid ? 'needs-clarification' as const : preview.route,
    missingFields: currentScene.invalid ? [...new Set([...preview.missingFields,'targetRefs'])] : preview.missingFields,canConfirm: executable && !needsBindings && discoveryAvailable,
    message: currentScene.invalid ? '场景行动的目标不是行动者的当前场景，请明确补充目标。'
      : !discoveryAvailable ? '这条发现方向需要作者修订，请选择可用方向或明确取消本次线索发现。'
      : needsBindings ? '请先补充并核对本次规则后果的对象，再确认行动意图。'
      : preview.route === 'needs-clarification' ? '请补充行动方式和可识别的对象，再核对规则。'
      : preview.route === 'rejected' ? '这份行动目前不能执行，请核对规则或明确放弃。'
        : !executable ? '这份意图需要对应的裁定入口，不能直接作为规则行动执行。'
          : currentScene.sceneScope ? '该地点已核对为行动者的当前场景；确认后仍需核对风险与代价。' : null,
    canClarify: (reviewVersion === 2 || originalRequiresClarification) && records.length < 3,attempts: records.length,
    clarificationHash: latest?.clarificationHash ?? null,selection: latest?.selection ?? null,
    request: latest?.request ?? null,catalog: { actorKey: candidate.actorKey,rules,discoveries } }
  return { review,intent,preview,originalPreview,originalRequiresClarification,snapshot,call,runtime,epoch,human,currentLocationRef,sharedCurrentScene,routingVersion }
}
type ClarifiedRuleInput = {
  inspected: Awaited<ReturnType<typeof inspectTtrpgOpenIntentRoutingV1>>; candidate: TtrpgOpenIntentCandidateV1
  selection: TtrpgOpenIntentSelectionV1; bindings: TtrpgOpenRuleRequestV1['effectBindings']; discovery?: TtrpgOpenRuleRequestV1['discovery']
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; runtimeSourceHash: string
}
export async function prepareTtrpgOpenClarifiedRuleRequestV1(input: ClarifiedRuleInput) {
  return prepareClarifiedRuleRequest(input,1)
}
export async function prepareTtrpgOpenClarifiedRuleRequestV2(input: ClarifiedRuleInput) {
  return prepareClarifiedRuleRequest(input,2)
}
async function prepareClarifiedRuleRequest(input: ClarifiedRuleInput,routingVersion: 1 | 2): Promise<{ request: TtrpgOpenRuleRequestV1 | null; sceneScope?: TtrpgOpenSceneScopeV1 }> {
  const { inspected,selection,candidate } = input
  const knownTargets = new Set(inspected.review.catalog.rules.flatMap(rule => rule.targets.map(t => t.key)))
  if (inspected.sharedCurrentScene) knownTargets.add(inspected.currentLocationRef!)
  if (selection.targetRefs.some(ref => !knownTargets.has(ref))) throw Error('澄清目标不在双方可识别的对象中')
  const effective = { ...candidate.intent!,...selection }, preview = (routingVersion === 2 ? routeTtrpgOpenIntentV2 : routeTtrpgOpenIntentV1)(effective,inspected.snapshot)
  const interactionKey = preview.routeDetail.interactionKey,route = preview.route === 'no-roll' && interactionKey ? 'existing-action' : preview.route
  const ruleKey = route === 'existing-action' ? preview.routeDetail.actionKey : route === 'generic-check' ? preview.routeDetail.checkKey : null
  if (!ruleKey || route !== 'existing-action' && route !== 'generic-check') return { request: null }
  const rule = inspected.review.catalog.rules.find(r => r.route === route && r.ruleKey === ruleKey && r.interactionKey === interactionKey)
  const target = (routingVersion === 2 ? resolveTtrpgOpenIntentTargetV2 : resolveTtrpgOpenIntentTargetV1)({ route,actorKey: candidate.actorKey,targetRefs: selection.targetRefs,
    actionTarget: input.content.rulePack.content.actions.find(a => a.key === ruleKey)?.target,currentLocationRef: inspected.currentLocationRef })
  const request = parseTtrpgOpenRuleRequestV1({ route,ruleKey,actorKey: candidate.actorKey,targetKey: target.targetKey,
    controllerMode: candidate.intent!.source.startsWith('companion:') ? 'ai' : 'human',effectBindings: input.bindings,
    ...(interactionKey ? { interactionKey } : {}),...(input.discovery ? { discovery: input.discovery } : {}) })
  if (!rule?.available || !rule.targets.some(t => t.key === request.targetKey)) throw Error('本次方法或目标不在双方可见的可用规则中')
  const allowed = new Set(rule.parameters.flatMap(p => p.options.map(o => o.key)))
  if (Object.values(request.effectBindings).some(rows => Object.values(rows).some(ref => ref !== null && !allowed.has(ref)))) throw Error('澄清后果引用了未共同识别的对象')
  if (request.discovery) {
    const path = inspected.review.catalog.discoveries.find(d => d.situationKey === request.discovery!.situationKey && d.evidenceRef === request.discovery!.evidenceRef
      && d.interventionPointKey === request.discovery!.interventionPointKey && d.route === request.route && d.ruleKey === request.ruleKey)
    if (!path?.available) throw Error('发现路径不在双方可见的可用目录中')
    const refs = new Set(path.parameters.flatMap(p => p.options.map(o => o.key)))
    if (Object.values(request.discovery.effectBindings).some(rows => Object.values(rows).some(ref => ref !== null && !refs.has(ref)))) throw Error('发现后果引用了未共同识别的对象')
  }
  await createTtrpgOpenRulePlanV1({ state: input.state,content: input.content,runtimeSourceHash: input.runtimeSourceHash,request })
  return { request,...(target.sceneScope ? { sceneScope: target.sceneScope } : {}) }
}
export function assertTtrpgOpenClarifiedRequestEqualV1(left: TtrpgOpenRuleRequestV1, right: TtrpgOpenRuleRequestV1 | null) {
  if (!right || stable(left) !== stable(right)) throw Error('本次行动不是已核对的原人工澄清版本')
}
export async function ttrpgOpenOperationSemanticIntentV1(operation: TtrpgOpenOperationV1,call: TtrpgOpenModelCallV1,original: TtrpgOpenIntentV1) {
  const ref = operation.intentEvidence?.clarificationRef
  if (!ref) return original
  const records = call.intentClarifications ?? [],record = records[records.length - 1]
  if (!record || record.clarificationHash !== ref.clarificationHash || stable(record.sourceRef) !== stable(ref.sourceRef)
    || record.candidateHash !== operation.intentEvidence!.candidateHash || await hashTtrpgOpenIntentClarificationV1(record) !== record.clarificationHash) throw Error('人工澄清的原记录已变化')
  assertTtrpgOpenClarifiedRequestEqualV1(operation.plan.request,record.request)
  return clarifiedTtrpgOpenIntentV1(original,record)
}
