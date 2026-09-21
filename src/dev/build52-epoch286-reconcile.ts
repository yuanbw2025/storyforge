import { db } from '../lib/db/schema'
import {
  readProductProductionDetailsV1,
  runAuthorizedProductProductionV1,
} from '../lib/product-production/service'

const QUERY_FLAG = 'quality-cleanup-v19'
const ONCE_KEY = 'codex.build52.epoch289.stopped-run-cleanup-1'
const PRODUCTION_KEY = 'productprod.mtqcyoyo.ae9e63f7'

export async function reconcileBuild52Epoch289(): Promise<void> {
  if (new URLSearchParams(location.search).get('build') !== QUERY_FLAG) return
  if (localStorage.getItem(ONCE_KEY) === 'started') return
  localStorage.setItem(ONCE_KEY, 'started')
  const production = (await db.productProductions.toArray()).find(row => (
    row.productionKey === PRODUCTION_KEY
  ))
  if (!production?.id) throw new Error('[build52-epoch289-reconcile] production missing')
  const scope = {
    projectId: production.projectId,
    worldId: production.worldId,
    workId: production.workId,
  }
  const before = await readProductProductionDetailsV1(scope, production.id)
  if (!before.build
    || before.build.buildNumber !== 52
    || before.production.controlEpoch !== 289
    || before.build.controlEpoch !== 289
    || before.build.status !== 'recovery-required') {
    throw new Error('[build52-epoch289-reconcile] state guard rejected')
  }
  try {
    await runAuthorizedProductProductionV1({ scope, productionId: production.id })
  } catch (error) {
    const after = await readProductProductionDetailsV1(scope, production.id)
    localStorage.setItem(ONCE_KEY + '.result', JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      buildStatus: after.build?.status ?? null,
      controlEpoch: after.build?.controlEpoch ?? null,
      failureJson: after.build?.failureJson ?? null,
    }))
  }
}
