import {isSha256Hash} from '../product-production/hash'
import type {ProductRuntimeEvent, ProductRuntimeState} from '../types'

/** Portable evidence, with no local foreign keys in JSON. The source save
 * uses the registered parentSessionId/parentThroughSequence relationship. */
export function assertChatReleaseUpgradeReceiptV1(state: ProductRuntimeState, event: ProductRuntimeEvent, body: Record<string, unknown>): void {
  const fields = ['version', 'policy', 'planHash', 'compatibilityHash', 'sourceReleaseHash', 'targetReleaseHash',
    'sourcePackageHash', 'targetPackageHash', 'sourceStateHash', 'sourceSequence', 'commandId', 'baseSequence', 'baseStateHash']
  if (Object.keys(body).some(key => !fields.includes(key)) || Object.keys(body).length !== fields.length
    || body.version !== 1 || body.policy !== 'copy-preserving-story-v1'
    || !Number.isSafeInteger(body.sourceSequence) || (body.sourceSequence as number) < 0
    || !fields.filter(key => key.endsWith('Hash')).every(key => isSha256Hash(body[key]))
    || body.sourceReleaseHash === body.targetReleaseHash
    || event.sequence !== 1 || state.lastSequence !== 0 || body.baseSequence !== 0
    || !state.interaction || state.narrative?.version !== 2
    || body.targetPackageHash !== state.narrative.contentHash
    || body.targetPackageHash !== state.narrative.sourceHash) {
    throw new Error('角色聊天升级回执与新存档的冻结版本或起点不一致')
  }
}
