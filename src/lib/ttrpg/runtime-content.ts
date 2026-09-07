import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSource } from '../product-production/preview-source'
import { assertProductReleaseUnchanged } from '../product/releases'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import { db } from '../db/schema'
import type { ProductRuntimeSourceV1, WorkspaceScope } from '../types'

/** One verified, immutable content reader shared by the playing table and director. */
export async function loadTtrpgRuntimeContentV1(input: { scope: WorkspaceScope; productRuntimeSessionId: number }) {
  const session = await assertInstanceBinding(input.productRuntimeSessionId, input.scope)
  if (session.kind !== 'ttrpg') throw new Error('[ttrpg-content] 不是跑团实例')
  let source: ProductRuntimeSourceV1 = { kind: 'release', productReleaseId: session.productReleaseId! }
  const result = session.productReleaseId != null
    ? await verifyProductReleaseManifestV1((await assertProductReleaseUnchanged(session.productReleaseId)).manifestJson)
    : await (async () => {
      const build = await db.productBuilds.get(session.productBuildId!)
      if (!build?.previewHash) throw new Error('[ttrpg-content] 预览源无效')
      source = { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash }
      return verifyProductRuntimeSource({ scope: input.scope, source })
    })()
  if (!result.runtimePackage.ttrpg || result.packageHash !== session.runtimeSourceHash) throw new Error('[ttrpg-content] 冻结源绑定不一致')
  return { session, source, runtimePackage: result.runtimePackage, campaign: result.runtimePackage.ttrpg.campaign, rulePack: result.runtimePackage.ttrpg.rulePack.content }
}
