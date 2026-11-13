import { afterEach, beforeEach, expect, it } from 'vitest'
import { createAvgDraftV1, selectAvgWorldV1 } from '../../src/lib/avg/draft-service'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { revalidateWorldSourcePurposeV1 } from '../../src/lib/world-engine/source-purpose'
import { readOriginalAuthorWorld } from '../helpers/product-author-world-backup'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

it('recovers the original author world for an AVG draft restored into a clean database', async () => {
  const product = await createAvgDraftV1('AVG 作者世界恢复')
  const source = await createMistHarborWorld()
  const draft = await selectAvgWorldV1(product.scope, 0, source.worldReleaseId)
  const author = await readOriginalAuthorWorld(draft.sourcePurpose, product.scope.projectId)
  expect(author.projectId).toBe(source.scope.projectId)
  const authorBackup = await exportProjectJSON(author.projectId)
  const productBackup = await exportProjectJSON(product.scope.projectId)
  await db.delete()
  await db.open()
  const productId = await importProjectJSON(productBackup)
  const imported = await db.avgAuthoringDrafts.where('projectId').equals(productId).first()
  if (!imported?.worldReleaseId || !imported.sourcePurpose) throw new Error('Expected the restored AVG draft to cite its original release')
  const input = { worldReleaseId: imported.worldReleaseId, expectedProjectId: productId, expectedWorldId: imported.worldId,
    purpose: 'avg' as const, proof: imported.sourcePurpose }
  await expect(revalidateWorldSourcePurposeV1(input)).rejects.toThrow('原作者世界目前不可核实')
  await expect(readOriginalAuthorWorld(input.proof, productId)).rejects.toThrow('original author workspace')
  const restoredId = await importProjectJSON(authorBackup)
  expect(await readOriginalAuthorWorld(input.proof, productId)).toEqual({ ...author, projectId: restoredId })
  expect(await revalidateWorldSourcePurposeV1(input)).toEqual(draft.sourcePurpose)
  expect(await db.avgAuthoringDrafts.get(imported.id!)).toEqual(imported)
})
