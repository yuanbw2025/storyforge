import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import type { readAvgDraftV1 } from './draft-service'

/** Call in the final draft write transaction. A later start or another Work
 * cannot be overridden by an expensive source/configuration preparation. */
export async function assertAvgMediaProductionDraftEditableV1(scope: WorkspaceScope,
  draft: Awaited<ReturnType<typeof readAvgDraftV1>>, lane: 'voice' | 'sound') {
  if (!draft.productionId) return
  const name = lane === 'voice' ? '配音' : '声音需求', prefix = lane === 'voice' ? '[avg-voice]' : '[avg-sound]'
  const production = await db.productProductions.get(draft.productionId)
  if (!production || production.productType !== 'avg' || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error(`${prefix} ${name}草稿的制作指针不存在或跨作品`)
  }
  if (production.currentBuildNumber === null) return
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([draft.productionId, production.currentBuildNumber]).first()
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) throw new Error(`${prefix} ${name}草稿的制作版本不存在或跨作品`)
  if (!build.previewHash && production.status !== 'brief-ready' && !['cancelled', 'failed', 'recovery-required'].includes(build.status)) {
    throw new Error(`${prefix} 当前${name}批次已开始，请先明确停止并保留调用记录后准备新版本`)
  }
}
