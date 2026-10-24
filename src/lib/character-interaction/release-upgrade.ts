import {createProductRuntimeInstance} from '../product/runtime-instances'
import type {WorkspaceScope} from '../types'
import type {ChatReleaseUpgradeRequestV1} from './release-upgrade-plan'

/** Explicit user confirmation, with all compatibility and concurrency checks
 * recomputed by the sole formal runtime creation boundary. */
export async function copyChatSaveToReleaseV1(input: {scope: WorkspaceScope; request: ChatReleaseUpgradeRequestV1; title: string}) {
  return createProductRuntimeInstance({scope: input.scope, title: input.title, kind: 'character-interaction',
    productSource: {kind: 'release', productReleaseId: input.request.targetReleaseId}, chatReleaseUpgrade: input.request})
}
