import type {ProductReleaseManifestV1, ProductRuntimeEvent, ProductRuntimeSession, ProductRuntimeState} from '../types'
import {applyProductRuntimeEvent, hashProductRuntimeStateV1, parseProductRuntimeState, replayProductRuntimeEvents} from './runtime-api'
import {rebaseInteractionStateForBranch} from './runtime'
import {compareChatReleaseUpgradeV1} from './release-upgrade-contract'
import {assertChatReleaseUpgradeReceiptV1} from './release-upgrade-receipt'

/** The existing chat branch rebase preserves private facts and their causal
 * coordinates. Only the verified compatible package binding changes. */
export function createChatReleaseUpgradeInitialStateV1(parent: ProductRuntimeState, targetPackageHash: string) {
  const state = structuredClone(parent)
  if (!state.interaction || state.narrative?.version !== 2) throw new Error('升级缺少角色聊天或冻结叙事状态')
  state.interaction = rebaseInteractionStateForBranch(state.interaction, state.lastSequence)
  state.lastSequence = 0
  state.narrative.sourceHash = targetPackageHash
  state.narrative.contentHash = targetPackageHash
  return state
}

type Session = Pick<ProductRuntimeSession, 'kind' | 'initialStateJson' | 'runtimeSourceHash' | 'parentThroughSequence'>
export async function verifyChatReleaseUpgradeReceiptV1(input: {childSession: Session; childManifest: ProductReleaseManifestV1; receipt: ProductRuntimeEvent}) {
  const initial = parseProductRuntimeState(input.childSession.initialStateJson), body = JSON.parse(input.receipt.payloadJson)
  assertChatReleaseUpgradeReceiptV1(initial, input.receipt, body)
  // Also check the command envelope via the formal reducer.
  applyProductRuntimeEvent(initial, input.receipt)
  if (input.childSession.kind !== 'character-interaction' || input.childManifest.productType !== 'character-interaction'
    || input.childSession.runtimeSourceHash !== input.childManifest.packageHash
    || body.targetPackageHash !== input.childManifest.packageHash
    || body.baseStateHash !== await hashProductRuntimeStateV1(initial)) throw new Error('升级副本与目标版本或初始状态不一致')
  const {hashProductProductionValueV2} = await import('../product-production/hash')
  if (body.targetReleaseHash !== await hashProductProductionValueV2(input.childManifest)) throw new Error('升级副本的目标发布哈希不一致')
  return body as Record<string, unknown>
}

/** Backup/import verifier, independent of local IDs and current head caches.
 * The exact parent prefix must reconstruct the child's full initial state. */
export async function verifyChatReleaseUpgradeBranchV1(input: {
  parentSession: Session; childSession: Session
  parentManifest: ProductReleaseManifestV1; childManifest: ProductReleaseManifestV1
  parentEvents: ProductRuntimeEvent[]; childEvents: ProductRuntimeEvent[]
}) {
  const through = input.childSession.parentThroughSequence
  if (input.parentSession.kind !== 'character-interaction' || !Number.isSafeInteger(through) || through == null || through < 0) throw new Error('角色聊天升级来源无效')
  const prefix = input.parentEvents.filter(event => event.sequence <= through).sort((a, b) => a.sequence - b.sequence)
  if (prefix.length !== through || prefix.some((event, index) => event.sequence !== index + 1)) throw new Error('升级来源的事件前缀不完整')
  const source = replayProductRuntimeEvents(parseProductRuntimeState(input.parentSession.initialStateJson), prefix)
  const receipt = input.childEvents.find(event => event.sequence === 1 && event.type === 'interaction.release.upgraded')
  if (!receipt) throw new Error('角色聊天跨版本分支缺少升级回执')
  const body = await verifyChatReleaseUpgradeReceiptV1({...input, receipt})
  const report = await compareChatReleaseUpgradeV1(input.parentManifest, input.childManifest)
  if (report.disposition !== 'copy-preserving-story' || input.parentSession.runtimeSourceHash !== report.sourcePackageHash
    || body.sourcePackageHash !== report.sourcePackageHash || body.sourceReleaseHash !== report.sourceReleaseHash
    || body.compatibilityHash !== report.compatibilityHash || body.sourceSequence !== through
    || body.sourceStateHash !== await hashProductRuntimeStateV1(source)) throw new Error('升级回执与原故事或版本兼容性不一致')
  const expected = createChatReleaseUpgradeInitialStateV1(source, report.targetPackageHash)
  if (await hashProductRuntimeStateV1(expected) !== await hashProductRuntimeStateV1(parseProductRuntimeState(input.childSession.initialStateJson))) {
    throw new Error('升级副本没有完整保留原故事进展')
  }
}
