import type { ProductRuntimeSession, ProductRuntimeSourceManifestV1 } from '../types'
import { verifyProductOwnedBranchOriginV1 } from './runtime-product-adapters'
import { assertProductRuntimeSourceSnapshotV2 } from './runtime-source-manifest'

/** V3 composes an unchanged V2 frozen-world receipt with the AVG-owned
 * detached-branch witness. Neither owner can replace the other's evidence. */
export async function assertProductRuntimeSourceSnapshotV3(input: {
  session: Pick<ProductRuntimeSession, 'kind' | 'canonSnapshotJson' | 'initialStateJson' | 'runtimeSourceHash'>
  manifest: ProductRuntimeSourceManifestV1 | null | undefined
}): Promise<void> {
  const { session, manifest } = input
  let snapshot: unknown
  try { snapshot = JSON.parse(session.canonSnapshotJson) } catch {
    throw new Error('[product-runtime-source-manifest] 会话来源快照不是 JSON')
  }
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    && 'schema' in snapshot && snapshot.schema === 'storyforge.product-runtime-source'
    && 'version' in snapshot && snapshot.version === 3) {
    const row = snapshot as Record<string, unknown>
    const keys = Object.keys(row).sort()
    if (!manifest || manifest.productType !== 'avg' || session.kind !== 'avg'
      || session.runtimeSourceHash !== manifest.packageHash
      || keys.join(',') !== 'avgBranchOrigin,schema,source,version') {
      throw new Error('[product-runtime-source-manifest] 增强分支来源的产品或字段不一致')
    }
    assertProductRuntimeSourceSnapshotV2({ canonSnapshot: row.source, manifest })
    const initialState: unknown = JSON.parse(session.initialStateJson)
    if (!initialState || typeof initialState !== 'object'
      || !('avgRules' in initialState && initialState.avgRules || 'avgReading' in initialState && initialState.avgReading)
      || !await verifyProductOwnedBranchOriginV1({ ...session, initialState })) {
      throw new Error('[product-runtime-source-manifest] 增强 AVG 分支缺少准确私域来源')
    }
    return
  }
  assertProductRuntimeSourceSnapshotV2({ canonSnapshot: snapshot, manifest })
}
