import type { UpperProductKindV1 } from '../types/product-identity';
import Dexie from 'dexie';
import { db } from "../db/schema";
import type { WorkspaceScope, WorldOwnerScope, WorldRelease } from "../types";
import { resolveScope, resolveWorldOwnerScopeLike, scopeTransactionTables } from "../workspace/scope";
import { createWorldReferenceV1 } from "./world-reference";
import { verifyPureWorldReleaseRecordV3, verifyWorldReleaseRecordV1 } from "./release-codec";
import { createWorldReference } from './world-reference-v2';
import { worldRevisionOriginV1 } from './publication-origin-contract';

interface NarrativeProductReferenceOption {
  narrativeProductType?: 'character-interaction' | 'avg';
  purpose?: UpperProductKindV1;
  scope?: WorldOwnerScope;
}
function enhanced(option: NarrativeProductReferenceOption): boolean {
  if (option.narrativeProductType === undefined) return false;
  if (!['character-interaction', 'avg'].includes(option.narrativeProductType)) throw new Error('此产品尚未支持增强世界引用');
  return true;
}

/** Shared frozen-content writer. The caller owns the transaction and has
 * already verified immutable source bytes; no editable domain records or
 * activity pointers are created here. A source receipt is separately keyed D. */
export async function cacheFrozenWorldReleaseInTransactionV1(
  scopeInput: WorldOwnerScope,
  source: Omit<WorldRelease, 'id' | 'projectId' | 'worldId' | 'revisionId'>,
): Promise<number> {
  if (!Dexie.currentTransaction) throw Error('冻结来源写入需要调用方事务')
  const scope = await resolveWorldOwnerScopeLike(scopeInput)
  const matches = (await db.worldReleases.where('worldId').equals(scope.worldId).toArray())
    .filter(row => row.releaseUid === source.releaseUid)
  for (const row of matches) {
    if (row.projectId !== scope.projectId || row.manifestJson !== source.manifestJson
      || row.contentHash !== source.contentHash || row.version !== source.version
      || row.sourceWorldCode !== source.sourceWorldCode) throw Error('缓存世界版本损坏')
  }
  if (matches[0]?.id) return matches[0].id
  const now = Date.now()
  const revisionId = await db.worldRevisions.add({ projectId: scope.projectId, worldId: scope.worldId,
    parentRevisionId: null, revision: source.version, label: source.label,
    manifestJson: source.manifestJson, contentHash: source.contentHash,
    publicationOrigin: worldRevisionOriginV1('reference-cache', JSON.parse(source.manifestJson), source.contentHash),
    createdAt: now, updatedAt: now })
  return db.worldReleases.add({ ...source, projectId: scope.projectId, worldId: scope.worldId, revisionId })
}

/** Explicit local reference import. Copies only a verified immutable release into
 * the consumer's world storage scope, so backup/deletion never depends on the
 * source author's mutable project. UID, semantic bytes and provenance are unchanged. */
export async function cacheWorldReferenceForProductV1(
  scopeInput: WorkspaceScope,
  releaseId: number,
  option: NarrativeProductReferenceOption = {},
): Promise<number> {
  const scope = await resolveScope({ scope: scopeInput });
  const supportsNarrative = enhanced(option);
  const reference = await (supportsNarrative ? createWorldReference : createWorldReferenceV1)(releaseId);
  const verified = await db.worldReleases.get(releaseId);
  if (!verified) throw new Error("来源世界版本已不存在");
  if (supportsNarrative) await verifyWorldReleaseRecordV1(verified);
  else await verifyPureWorldReleaseRecordV3(verified);
  return db.transaction("rw", scopeTransactionTables(db.worldReleases, db.worldRevisions), async () => {
    await resolveScope({ scope });
    const source = await db.worldReleases.get(releaseId);
    if (!source) throw new Error("来源世界版本已不存在");
    if (
      source.manifestJson !== verified.manifestJson ||
      source.contentHash !== verified.contentHash ||
      source.releaseUid !== verified.releaseUid
      || source.projectId !== verified.projectId || source.worldId !== verified.worldId
      || source.revisionId !== verified.revisionId || source.version !== verified.version
    )
      throw new Error("来源世界在选择期间变化");
    if (source.contentHash !== reference.releaseHash)
      throw new Error("来源世界版本已变化");
    const { id: _sourceId, projectId: _projectId, worldId: _worldId, revisionId: _revisionId, ...frozen } = source;
    return cacheFrozenWorldReleaseInTransactionV1(scope, frozen);
  });
}

export async function selectWorldReferenceForProductPurposeV1(
  scopeInput: WorkspaceScope,
  releaseId: number,
  purpose: UpperProductKindV1,
  selection: NarrativeProductReferenceOption & { sourceDeclarationHash?: string } = {},
) {
  const scope = await resolveScope({ scope: scopeInput })
  const original = await db.worldReleases.get(releaseId)
  if (!original) throw new Error('所选原始世界版本不存在。')
  await (enhanced(selection) ? createWorldReference : createWorldReferenceV1)(releaseId)
  const { freezeWorldSourcePurposeV1, readWorldSourcePurposeDeclarationV1, revalidateWorldSourcePurposeV1 } = await import('./source-purpose')
  const proof = await freezeWorldSourcePurposeV1({ worldReleaseId: releaseId, expectedProjectId: original.projectId,
    expectedWorldId: original.worldId, purpose, sourceDeclarationHash: selection.sourceDeclarationHash })
  let localId: number
  if (proof.origin.kind === 'declared' && proof.origin.relation === 'installed') {
    const { copyWorldSourceReceiptV1 } = await import('./source-receipt')
    const copied = await copyWorldSourceReceiptV1(scope, { projectId: original.projectId, worldId: original.worldId },
      readWorldSourcePurposeDeclarationV1(proof.origin).declarationHash)
    localId = copied.worldReleaseId
  } else {
    localId = await cacheWorldReferenceForProductV1(scope, releaseId, selection)
  }
  await revalidateWorldSourcePurposeV1({ worldReleaseId: localId, expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId, purpose, proof })
  return { localId, sourcePurpose: proof }
}

/** A local library picker; no mutable world content is exposed to the product. */
export async function listLocalWorldReferenceChoicesV1(option: NarrativeProductReferenceOption = {}) {
  const supportsNarrative = enhanced(option);
  const scope = option.scope && await resolveWorldOwnerScopeLike(option.scope)
  const releases = scope ? await db.worldReleases.where('worldId').equals(scope.worldId).toArray() : await db.worldReleases.toArray();
  const seen = new Set<string>();
  const choices: {
    id: number;
    label: string;
    worldCode: string;
    version: number;
    hash: string;
    narrative: boolean;
    choiceKey?: string;
    sourceDeclarationHash?: string;
    attribution?: string;
    authorName?: string;
    license?: string;
    contentWarnings?: string[];
    purposeAllowed?: boolean;
  }[] = [];
  const receiptsByWorld = new Map<number, Awaited<ReturnType<typeof import('./source-receipt').listWorldSourceReceiptsV1>>>()
  for (const release of releases) {
    if ((scope && release.projectId !== scope.projectId) || !release.id || (!option.purpose && seen.has(release.releaseUid))) continue;
    try {
      const ref = await (supportsNarrative ? createWorldReference : createWorldReferenceV1)(release.id);
      const choice = { id: release.id, label: release.label, worldCode: ref.worldCode,
        version: ref.releaseVersion, hash: ref.releaseHash, narrative: ref.version === 2 }
      if (option.purpose) {
        let receipts = receiptsByWorld.get(release.worldId)
        if (!receipts) {
          const { listWorldSourceReceiptsV1 } = await import('./source-receipt')
          receipts = await listWorldSourceReceiptsV1({ projectId: release.projectId, worldId: release.worldId })
          receiptsByWorld.set(release.worldId, receipts)
        }
        const exact = receipts.filter(row => row.worldReleaseId === release.id && row.releaseUid === release.releaseUid)
        for (const row of exact) choices.push({ ...choice, choiceKey: `${release.id}:${row.declarationHash}`,
          sourceDeclarationHash: row.declarationHash, attribution: row.declaration.attribution,
          authorName: row.declaration.authorName, license: row.declaration.license,
          contentWarnings: [...row.declaration.contentWarnings], purposeAllowed: row.declaration.allowedUses[option.purpose] })
        const { freezeWorldSourcePurposeV1, readWorldSourcePurposeDeclarationV1 } = await import('./source-purpose')
        const native = await freezeWorldSourcePurposeV1({ worldReleaseId: release.id, expectedProjectId: release.projectId,
          expectedWorldId: release.worldId, purpose: option.purpose }).catch(() => null)
        const declaration = native?.origin.kind === 'declared' ? readWorldSourcePurposeDeclarationV1(native.origin) : undefined
        if (native) choices.push({ ...choice, choiceKey: `${release.id}:owned`, purposeAllowed: true,
          ...(declaration ? { attribution: declaration.attribution, authorName: declaration.authorName,
            license: declaration.license, contentWarnings: [...declaration.contentWarnings] } : {}) })
        if (!native && !exact.length) choices.push({ ...choice, choiceKey: `${release.id}:unknown`, purposeAllowed: false })
      } else choices.push(choice);
      seen.add(ref.releaseUid);
    } catch {
      /* Invalid releases cannot be selected; source world UI owns their diagnostics. */
    }
  }
  return choices.sort((a, b) => b.id - a.id);
}
