import { hashProductProductionValueV2 } from '../product-production/hash'
import { estimateTokens } from '../ai/context-budget'
/** Verify P7 against the exact retained request and actual reads, never a caller's copied hash. */
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseTtrpgContextBudgetReceiptV1 } from './context-budget'
import { ttrpgOpenContextConsumerForPurposeV1, ttrpgOpenModelPurposeForSkillV1 } from './open-model-purpose-contract'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import type { AgentRunSnapshotV1 } from '../agent/run/event-store'
import type { WorkspaceScope } from '../types'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { loadTtrpgOpenModelContextV1 } from './open-model-purpose'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import { selectTtrpgOpenContextResourcesV1 } from './open-context-selection'
import { ttrpgOpenPublicSituationMessagesV1 } from './open-public-situation-prompt'
import { ttrpgOpenEntityModelMessagesV1, reviewTtrpgOpenEntityModelDeliveryV1, TTRPG_OPEN_ENTITY_MODEL_INPUT_V1 } from './open-entity-model-contract'
import { selectTtrpgOpenCommonOracleInventoryV1, ttrpgOpenCommonOracleMessagesV1 } from './open-common-oracle-delivery'
import { TTRPG_OPEN_COMMON_ORACLE_INPUT_V1 } from './open-common-oracle-request'

export async function verifyTtrpgOpenContextSelectionEvidenceV1(input: {
  scope: WorkspaceScope; sessionId: number; actorKey: string; skillId: string; stepId: string
  evidence: TtrpgOpenInputEvidenceV1; snapshot: AgentRunSnapshotV1; bodies: Readonly<Record<string, string>>
  sourceKeys: readonly string[]; mode: 'reserve' | 'dispatch' | 'finish'; call?: TtrpgOpenModelCallV1
}) {
  const e = input.evidence, receipt = e.contextSelection
  const modern = input.sourceKeys.some(key => /Context$/.test(key) || key === 'ttrpgOpenCommonOracleInput' || key === 'ttrpgOpenEntityInput' || key === 'ttrpgOpenBriefInput' || key === 'ttrpgOpenSituationInput' || key === 'ttrpgOpenPublicSituationInput')
  const rendered = JSON.parse(input.bodies[e.preflight.promptHash]) as { contextSelection?: unknown; messages: Array<{ role: string; content: string }> }
  if (!modern) {
    if (receipt !== undefined || e.contextAssembly !== undefined || rendered.contextSelection !== undefined) throw new Error('[ttrpg-context] 历史协议不可伪装新情境回执')
    return
  }
  if (!receipt || canonicalStringify(rendered.contextSelection) !== canonicalStringify(receipt)) throw new Error('[ttrpg-context] 情境回执没有绑定原始请求字节')
  if (canonicalStringify(e.contextAssembly) !== canonicalStringify({ schema: 'storyforge.ttrpg-context-assembly', version: 1,
    eventType: 'ttrpg.context.assembled', receiptHash: receipt.receiptHash })) throw new Error('[ttrpg-context] E14 装配记录与原请求回执不一致')
  const { receiptHash, ...body } = receipt
  const definition = ttrpgOpenModelPurposeForSkillV1(input.skillId), binding = input.snapshot.contract.executionBindings?.find(binding => binding.stepId === input.stepId)
  if (definition.purpose === 'common-oracle-interpret' && canonicalStringify(rendered.messages) !== canonicalStringify(ttrpgOpenCommonOracleMessagesV1(e.preflight.contextPacket.content))) throw new Error('共同事实原消息夹带登记共同资料之外的文本')
  if (definition.purpose === 'entity-proposal') {
    if (!input.call?.entityProposal || canonicalStringify(rendered.messages) !== canonicalStringify(ttrpgOpenEntityModelMessagesV1(e.preflight.contextPacket.content))) throw new Error('[ttrpg-entity] 原实体请求夹带登记资料之外的消息')
    reviewTtrpgOpenEntityModelDeliveryV1(input.call.entityProposal, e.preflight.artifacts.filter(ref => ref.role === 'source-snapshot').map(ref => {
      const wrapper = JSON.parse(input.bodies[ref.contentHash]) as { content: string }
      return { sourceKey: ref.sourceKey, resourceKey: ref.resourceKey, content: wrapper.content }
    }))
  }
  if (definition.purpose === 'public-situation-proposal'
    && canonicalStringify(rendered.messages) !== canonicalStringify(ttrpgOpenPublicSituationMessagesV1(e.preflight.contextPacket.content))) {
    throw new Error('[ttrpg-public-situation] 原始公开请求夹带登记资料之外的消息')
  }
  const baseline = input.snapshot.contract.scope.runtime
  if (receipt.schema !== 'storyforge.ttrpg-open-context-selection' || receipt.version !== 1
    || receiptHash !== await hashCanonicalValue(body) || receipt.consumer !== ttrpgOpenContextConsumerForPurposeV1(definition.purpose)
    || receipt.baseSequence !== baseline?.baseSequence || receipt.baseStateHash !== baseline?.stateHash
    || !Number.isSafeInteger(receipt.budgetTokens) || receipt.budgetTokens < 1 || receipt.budgetTokens > 16000
    || !binding || binding.version !== 2) throw new Error('[ttrpg-context] 情境回执、目的或冻结进度不一致')
  parseTtrpgContextBudgetReceiptV1(receipt.tokenBudget); parseTtrpgContextBudgetReceiptV1(receipt.resourceCountBudget)
  const selected = e.selector.selected.map(row => ({ resourceKey: row.resourceKey, sourceKey: row.sourceKey, contentHash: row.contentHash }))
  const expected = receipt.selected.map(({ resourceKey, sourceKey, contentHash }) => ({ resourceKey, sourceKey, contentHash }))
  const sort = (rows: typeof selected) => rows.sort((a, b) => a.resourceKey < b.resourceKey ? -1 : a.resourceKey > b.resourceKey ? 1 : 0)
  if (canonicalStringify(sort(selected)) !== canonicalStringify(sort(expected)) || new Set(expected.map(row => row.resourceKey)).size !== expected.length
    || e.preflight.contextPacket.tokenCount > receipt.budgetTokens) throw new Error('[ttrpg-context] 情境计划与真实读取或硬预算不一致')
  for (const row of receipt.selected) {
    const ref = e.preflight.artifacts.find(ref => ref.role === 'source-snapshot' && ref.sourceKey === row.sourceKey && ref.resourceKey === row.resourceKey)
    if (!ref) throw new Error('[ttrpg-context] 情境条目缺少真实读取工件')
    const wrapper = JSON.parse(input.bodies[ref.contentHash]) as { content: string }
    if (estimateTokens(wrapper.content) !== row.tokens) throw new Error('[ttrpg-context] 情境条目的实际 token 证据不一致')
  }
  if (input.mode === 'finish') return
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  if (!runtime?.openRun) throw new Error('[ttrpg-context] 原团局已关闭')
  const context = await loadTtrpgOpenModelContextV1({ ...input, skillId: input.skillId })
  const user = rendered.messages.filter(message => message.role === 'user')
  const suffix = `\n\n【角色授权上下文】\n${e.preflight.contextPacket.content}`
  let rawInput: string
  if (definition.purpose === 'common-oracle-interpret') rawInput = TTRPG_OPEN_COMMON_ORACLE_INPUT_V1
  else if (definition.purpose === 'entity-proposal') rawInput = TTRPG_OPEN_ENTITY_MODEL_INPUT_V1
  else if (definition.purpose === 'public-situation-proposal') {
    const grant = runtime.openRun.coordination.epochs.find(e => e.epochKey === runtime.openRun!.coordination.activeEpochKey)?.publicSituation
    if (!grant || canonicalStringify(rendered.messages) !== canonicalStringify(ttrpgOpenPublicSituationMessagesV1(e.preflight.contextPacket.content))) {
      throw new Error('[ttrpg-public-situation] 消息不得附加登记资料之外的私域输入')
    }
    rawInput = grant.basis.sharedRequest.text
  } else {
    if (user.length !== 1 || !user[0].content.startsWith('【真人输入】\n') || !user[0].content.endsWith(suffix)) throw new Error('[ttrpg-context] 原始模型消息与实际 Gateway 内容不一致')
    rawInput = user[0].content.slice('【真人输入】\n'.length, -suffix.length)
  }
  const inventory = []
  for (const sourceKey of input.sourceKeys) {
    const provider = CONTEXT_SOURCE_BY_KEY.get(sourceKey)?.resources
    if (!provider) throw new Error('[ttrpg-context] 正式情境来源已缺失')
    let cursor: string | undefined
    do { const page = await provider.listMetadata({ scope: { ...input.scope, productRuntimeSessionId: input.sessionId, runtimeActorKey: input.actorKey }, limit: 1000, cursor }); inventory.push(...page.items); cursor = page.nextCursor ?? undefined } while (cursor)
  }
  const oracleSourceRef = input.call?.commonOracle?.oracleSourceRef ?? input.call?.oracleInterpretation?.oracleSourceRef ?? input.call?.supportSlot?.oracleSourceRef
  if (definition.purpose === 'common-oracle-interpret') {
    const grant = runtime.openRun.coordination.epochs.find(row => row.epochKey === input.call?.authorizationEpochKey)?.commonOracle
    if (!grant) throw new Error('共同事实情境缺少准确原授权')
    const selected = await selectTtrpgOpenCommonOracleInventoryV1(inventory, grant.basis)
    inventory.splice(0, inventory.length, ...selected)
  }
  if (definition.purpose === 'entity-proposal') {
    if (!('epochInputRevision' in context) || !input.call?.entityProposal) throw new Error('[ttrpg-entity] 缺少原实体来源选择')
    const selected = (await import('./open-entity-context')).selectTtrpgOpenEntityModelResourcesV1(context, inventory, input.call.entityProposal)
    inventory.splice(0, inventory.length, ...selected)
  }
  if (definition.actorRole === 'gm' && definition.purpose !== 'common-oracle-interpret' && definition.purpose !== 'entity-proposal' && definition.purpose !== 'kp-narration' && definition.purpose !== 'stage-brief' && definition.purpose !== 'situation-proposal' && definition.purpose !== 'public-situation-proposal') {
    const oracleSuffix = `:oracle.${await hashProductProductionValueV2(oracleSourceRef)}`
    // The runtime owner already validates the exact Oracle/review hash and slot.
    const reviewSuffix = input.call?.supportSlot ? `:review.${await hashProductProductionValueV2(input.call.supportSlot.sourceRef)}` : null
    const filtered = inventory.filter(row => row.sourceKey !== 'ttrpgOpenGmOracleInput' || row.priority === 'must-read'
      || row.resourceKey.endsWith(oracleSuffix) || reviewSuffix && row.resourceKey.endsWith(reviewSuffix))
    inventory.splice(0, inventory.length, ...filtered.map(row => row.sourceKey === 'ttrpgOpenGmOracleInput' ? { ...row, priority: 'must-read' as const } : row))
  }
  const recomputed = await selectTtrpgOpenContextResourcesV1({ ...input, purpose: definition.purpose, runtime, context, inventory, rawInput,
    oracleSourceRef, skill: projectFrozenAgentSkillDefinitionV1(binding), budgetTokens: receipt.budgetTokens })
  const normalize = (value: typeof receipt) => ({ ...value, receiptHash: '', baseSequence: 0, baseStateHash: '' })
  if (canonicalStringify(normalize(recomputed.receipt)) !== canonicalStringify(normalize(receipt))) throw new Error(`[ttrpg-context] 情境触发、预算或派发历史已经 stale: ${Object.keys(normalize(receipt)).filter(key => canonicalStringify(Reflect.get(normalize(receipt), key)) !== canonicalStringify(Reflect.get(normalize(recomputed.receipt), key))).join(',')}`)
}
