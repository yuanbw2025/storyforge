import { db } from '../db/schema'
import { scopeTransactionTables } from '../workspace/scope'
import { readWorldPublicationAuthorityRowsV1 } from './publication-authority-rows'
import { fail, readWorldSourcePurposeDeclarationV1, type WorldSourcePurposeInputV1 } from './source-purpose-contract'
import { revalidateWorldSourcePurposeV1 } from './source-purpose-actions'

/** Opaque capabilities for an authorization CAS in a product transaction. */
export function worldSourcePurposeTransactionTablesV1() {
  return scopeTransactionTables(db.worldReleases, db.worldRevisions, db.worldDerivations, db.worldSourceReceipts)
}

/** Frozen local evidence for a compare-and-swap. Cryptographic verification
 * stays outside the write transaction; inside it only reread authority rows. */
async function readPurposeAuthorityRows(input: WorldSourcePurposeInputV1) {
  const [release, project, world] = await Promise.all([
    db.worldReleases.get(input.worldReleaseId), db.projects.get(input.expectedProjectId),
    db.worlds.get(input.expectedWorldId),
  ])
  const origin = input.proof?.origin
  const originWorld = origin && 'authorWorld' in origin ? origin.authorWorld : undefined
  const authors = originWorld
    ? await db.projects.where('workspaceUid').equals(originWorld.workspaceUid).toArray()
    : []
  const authorWorlds = (await Promise.all(authors.flatMap(owner => owner.id == null ? []
    : [db.worlds.where('projectId').equals(owner.id).filter(row => row.code === originWorld!.worldCode).toArray()]))).flat()
  const authorityWorldIds = [...new Set([input.expectedWorldId, ...authorWorlds.flatMap(row => row.id == null ? [] : [row.id])])]
  const rows = await Promise.all(authorityWorldIds.map(async worldId => {
    const derivations = await db.worldDerivations.where('worldId').equals(worldId).toArray()
    const hashes = new Set(derivations.flatMap(row => row.sourceReceiptBinding ? [row.sourceReceiptBinding.declarationHash] : []))
    if (origin?.kind === 'declared') hashes.add(readWorldSourcePurposeDeclarationV1(origin).declarationHash)
    const receipts = (await Promise.all([...hashes].map(declarationHash =>
      db.worldSourceReceipts.where('[worldId+declarationHash]').equals([worldId, declarationHash]).toArray()))).flat()
    const linkedReleases = await Promise.all(receipts.map(row => row.worldReleaseId == null
      ? undefined : db.worldReleases.get(row.worldReleaseId)))
    const releases = worldId === input.expectedWorldId || !release ? [] : await db.worldReleases.where('worldId').equals(worldId)
      .filter(row => row.releaseUid === release.releaseUid && row.contentHash === release.contentHash).toArray()
    const publicationAuthorities = await Promise.all(
      (worldId === input.expectedWorldId && release ? [release] : releases).map(readWorldPublicationAuthorityRowsV1))
    return { derivations, receipts, linkedReleases, releases, publicationAuthorities }
  }))
  return JSON.stringify({ release, project, world, authors, authorWorlds, rows })
}

export interface WorldSourcePurposeCasWitnessV1 {
  readonly input: WorldSourcePurposeInputV1
  readonly rows: string
}

export async function prepareWorldSourcePurposeCasV1(input: WorldSourcePurposeInputV1): Promise<WorldSourcePurposeCasWitnessV1> {
  input = structuredClone(input)
  const rows = await readPurposeAuthorityRows(input)
  await revalidateWorldSourcePurposeV1(input)
  if (rows !== await readPurposeAuthorityRows(input)) fail('来源权限在预检期间变化。')
  return { input, rows }
}

export async function assertWorldSourcePurposeCasV1(witness: WorldSourcePurposeCasWitnessV1) {
  if (witness.rows !== await readPurposeAuthorityRows(witness.input)) fail('来源权限在授权提交前变化。')
}
