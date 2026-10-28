import Dexie, { type Transaction } from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { readFrozenAvgStageMembershipV1 } from './author-artifacts'
import { readAvgAdoptedGeneratedSoundV1 } from './stage-sound-sources'
import { assertAvgSoundLocalRepairV1, type AvgSoundLocalRepairV1 } from './sound-local-repair-contract'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Proves a retained adopted source and its exact parent Preview. Portable
 * locators never grant a new producer, author choice or frozen write right. */
type RepairRead = { scope: WorkspaceScope; productionId: number; repair: AvgSoundLocalRepairV1 }
const snapshotProofs = new WeakMap<Transaction, Map<string, Awaited<ReturnType<typeof readEvidenceUncached>>>>()
const activeProofs = new WeakMap<Transaction, Set<string>>()

/** Only successful proofs inside one immutable read snapshot are reusable.
 * No pending Promise, RW transaction or later snapshot can reuse the result. */
export async function readAvgSoundLocalRepairEvidenceV1(input: RepairRead) {
  const captured: RepairRead = { scope: { projectId: input.scope.projectId, workId: input.scope.workId, worldId: input.scope.worldId },
    productionId: input.productionId, repair: structuredClone(input.repair) }
  let snapshot = Dexie.currentTransaction
  while (snapshot?.parent) snapshot = snapshot.parent
  const key = JSON.stringify(captured)
  const found = snapshot?.active && snapshot.mode === 'readonly' ? snapshotProofs.get(snapshot)?.get(key) : undefined
  if (found) return structuredClone(found)
  const active = snapshot ? activeProofs.get(snapshot) ?? new Set<string>() : null
  if (active?.has(key) || active && active.size >= 32) throw new Error('[avg-sound-repair] 原声音来源循环或超过32层，不能猜测或重新生成')
  if (snapshot && active) { active.add(key); activeProofs.set(snapshot, active) }
  try {
    const result = await readEvidenceUncached(captured)
    if (snapshot?.active && snapshot.mode === 'readonly') {
      const values = snapshotProofs.get(snapshot) ?? new Map<string, typeof result>()
      if (values.size < 8) values.set(key, structuredClone(result))
      snapshotProofs.set(snapshot, values)
    }
    return result
  } finally { active?.delete(key) }
}

async function readEvidenceUncached(input: RepairRead) {
  const captured = { scope: structuredClone(input.scope), productionId: input.productionId, repair: structuredClone(input.repair) }
  const parsed = await assertAvgSoundLocalRepairV1(captured.repair), r = parsed.repair
  const selected = await readAvgAdoptedGeneratedSoundV1({ scope: captured.scope, source: r.source })
  if (selected.build.stateRevision !== r.sourceBuildRevision || !same(selected.asset, r.sourceAsset)
    || !same(selected.soundPlan.payload, r.sourcePlan) || !same(selected.rawPayload.requirement, parsed.requirement)
    || selected.compiled.artifactKey !== r.source.compiled.artifactKey || selected.compiled.version !== r.source.compiled.version
    || selected.compiled.contentHash !== r.source.compiled.contentHash) {
    throw new Error('[avg-sound-repair] 原声音采用、完整编译身份或所选原件来源已变化')
  }
  const production = await db.productProductions.get(captured.productionId)
  const parent = await db.productBuilds.where('[productionId+buildNumber]').equals([captured.productionId, r.parent.buildNumber]).first()
  const brief = parent ? await db.productProductionBriefs.where('[productionId+revision]').equals([captured.productionId, parent.briefRevision]).first() : null
  if (!production || !parent?.id || !brief || production.productType !== 'avg' || production.productionKey !== r.parent.productionKey
    || !await assertRecordInScope(captured.scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(captured.scope, 'productBuilds', parent, { owner: 'work' })
    || !await assertRecordInScope(captured.scope, 'productProductionBriefs', brief, { owner: 'work' })
    || parent.stateRevision !== r.parent.buildRevision || parent.briefHash !== r.parent.briefHash || parent.planHash !== r.parent.planHash
    || parent.previewHash !== r.parent.previewHash || parent.manifestHash !== r.parent.manifestHash
    || !['preview-ready', 'release-ready', 'released'].includes(parent.status)
    || brief.briefHash !== parent.briefHash || parseProductProductionBriefV3(brief.briefJson).source.worldContentHash !== selected.sourceWorldContentHash) {
    throw new Error('[avg-sound-repair] 声音返修的准确父预览、冻结世界或原授权已变化')
  }
  const membership = await readFrozenAvgStageMembershipV1({ scope: captured.scope, buildId: parent.id,
    expectedBuildRevision: parent.stateRevision, controlEpoch: parent.controlEpoch })
  if (!membership.payload) throw new Error('[avg-sound-repair] 父预览缺少准确已采用Stage')
  const current = membership.inputs.some(e => same({ artifactKey: e.artifactKey, version: e.version, contentHash: e.contentHash }, selected.choice.artifact)
    && e.authorReceiptHash === selected.choice.authorReceiptHash)
  const inherited = membership.payload.inheritedSounds?.some(e => e.assetKey === selected.asset.assetKey && same(e.source, r.source))
  if (!same(membership.payload.stage.assets.find(a => a.assetKey === selected.asset.assetKey), selected.asset) || !(current || inherited)) {
    throw new Error('[avg-sound-repair] 所选声音不属于准确父预览中的已采用演出槽')
  }
  if (!same(await db.productBuilds.get(parent.id), parent) || !same(await db.productProductions.get(captured.productionId), production)
    || !same(await db.productProductionBriefs.get(brief.id!), brief)) {
    throw new Error('[avg-sound-repair] 返修父预览证明读取期间版本已变化')
  }
  return { ...parsed, selected, parent, parentStage: membership.payload }
}
