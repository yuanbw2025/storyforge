import Dexie from 'dexie';
import { db } from "../db/schema";
import type { WorkspaceScope, WorldOwnerScope, WorldRelease } from "../types";
import { resolveScope, resolveWorldOwnerScopeLike, scopeTransactionTables } from "../workspace/scope";
import { createWorldReferenceV1 } from "./world-reference";
import { verifyPureWorldReleaseRecordV3, verifyWorldReleaseRecordV1 } from "./release-codec";
import { createWorldReference } from './world-reference-v2';

interface NarrativeProductReferenceOption {
  narrativeProductType?: 'character-interaction' | 'avg';
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
    manifestJson: source.manifestJson, contentHash: source.contentHash, createdAt: now, updatedAt: now })
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

/** A local library picker; no mutable world content is exposed to the product. */
export async function listLocalWorldReferenceChoicesV1(option: NarrativeProductReferenceOption = {}) {
  const supportsNarrative = enhanced(option);
  const releases = await db.worldReleases.toArray();
  const seen = new Set<string>();
  const choices: {
    id: number;
    label: string;
    worldCode: string;
    version: number;
    hash: string;
    narrative: boolean;
  }[] = [];
  for (const release of releases) {
    if (!release.id || seen.has(release.releaseUid)) continue;
    try {
      const ref = await (supportsNarrative ? createWorldReference : createWorldReferenceV1)(release.id);
      choices.push({
        id: release.id,
        label: release.label,
        worldCode: ref.worldCode,
        version: ref.releaseVersion,
        hash: ref.releaseHash,
        narrative: ref.version === 2,
      });
      seen.add(ref.releaseUid);
    } catch {
      /* Invalid releases cannot be selected; source world UI owns their diagnostics. */
    }
  }
  return choices.sort((a, b) => b.id - a.id);
}
