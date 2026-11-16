/** Immutable runtime source authority: capture the original Release or
 * Build/Production/Brief tuple, verify through the existing reader, and retain
 * that same tuple for deterministic native-transaction CAS. No product policy. */
import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AnyProductRuntimePackage, ProductRuntimeSession, ProductRelease, ProductBuildRecordV1, ProductProductionRecordV1, ProductProductionBriefRecordV1 } from '../types'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { productRuntimeContentReaderV1, type ProductRuntimePackageForAdaptersV1 } from './runtime-product-adapters'
import { stableProductRuntimeJsonV1 as stableJson } from './runtime-values'

export type VerifiedFormalRuntimeSourceV1 = {
  runtimePackage: ProductRuntimePackageForAdaptersV1;
  packageHash: string;
  source:
    | { kind: "release"; release: ProductRelease & { id: number } }
    | {
        kind: "build";
        build: ProductBuildRecordV1 & { id: number };
        production: ProductProductionRecordV1 & { id: number };
        brief: ProductProductionBriefRecordV1 & { id: number };
      };
};

/** Database snapshots only; the original strict reader still grants validity. */
export async function captureFormalRuntimeSourceRecordsV1(input: Pick<ProductRuntimeSession, 'productReleaseId' | 'productBuildId'>): Promise<VerifiedFormalRuntimeSourceV1['source']> {
  if (input.productReleaseId != null) {
    const release = await db.productReleases.get(input.productReleaseId);
    if (!release?.id) throw new Error('[product-runtime] Product Release 已不存在。');
    return { kind: 'release', release: release as ProductRelease & { id: number } };
  }
  const build = await db.productBuilds.get(input.productBuildId!);
  if (!build?.id) throw new Error('[product-runtime] Product Build 已不存在。');
  const [production, brief] = await Promise.all([
    db.productProductions.get(build.productionId),
    db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first(),
  ]);
  if (!production?.id || !brief?.id) throw new Error('[product-runtime] Product Build 的 Production/Brief 来源已损坏。');
  return { kind: 'build', build: build as ProductBuildRecordV1 & { id: number },
    production: production as ProductProductionRecordV1 & { id: number },
    brief: brief as ProductProductionBriefRecordV1 & { id: number } };
}

export function assertFormalRuntimeSourceRecordsUnchangedV1(source: VerifiedFormalRuntimeSourceV1['source']): Promise<void> {
  if (source.kind === 'release') {
    return db.productReleases.get(source.release.id).then(release => {
      if (!release || stableJson(release) !== stableJson(source.release)) {
        throw new Error('[product-runtime] Product Release 在命令提交期间发生变化。');
      }
    });
  }
  return Dexie.Promise.all([
    db.productBuilds.get(source.build.id), db.productProductions.get(source.production.id), db.productProductionBriefs.get(source.brief.id),
  ]).then(([build, production, brief]) => {
    if (!build || !production || !brief || stableJson(build) !== stableJson(source.build)
      || stableJson(production) !== stableJson(source.production) || stableJson(brief) !== stableJson(source.brief)) {
      throw new Error('[product-runtime] Product Build/Production/Brief 在命令提交期间发生变化。');
    }
  });
}

/**
 * Product-neutral runtime source guard shared by every upper-product command.
 * A formal instance may bind one immutable Product Release or one governed
 * Build Preview; product commands must never reopen the WorldRelease directly.
 */
export async function verifyFormalRuntimeSourceV1(
  session: ProductRuntimeSession,
  allowedProductTypes: readonly AnyProductRuntimePackage["productType"][],
): Promise<VerifiedFormalRuntimeSourceV1> {
  session = structuredClone(session);
  const sourceCount = [session.productReleaseId, session.productBuildId]
    .filter((value) => value != null).length;
  if (
    sourceCount !== 1 ||
    session.worldId == null ||
    session.workId == null ||
    !session.runtimeSourceHash
  ) {
    throw new Error("[product-runtime] 正式实例没有唯一冻结 Product Release/Build 来源。");
  }
  // Capture the actual authority before invoking its strict reader. Capturing
  // a new row after that reader returned could turn an unverified replacement
  // into the baseline of every later CAS. The reader and both CAS boundaries
  // must instead share this original tuple.
  const source = await captureFormalRuntimeSourceRecordsV1(session);
  const playable = await verifyProductRuntimeSessionSourceV1({
    scope: {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    session,
    ...productRuntimeContentReaderV1(session.kind),
  });
  if (
    playable.packageHash !== session.runtimeSourceHash ||
    !allowedProductTypes.includes(playable.runtimePackage.productType)
  ) {
    throw new Error("[product-runtime] 实例产品类型或冻结运行包 hash 不匹配。");
  }
  const frozen: VerifiedFormalRuntimeSourceV1 = {
    runtimePackage: playable.runtimePackage,
    packageHash: playable.packageHash,
    source,
  };
  await assertFormalRuntimeSourceUnchangedV1({ previewSession: session, session, frozen });
  return frozen;
}

export function assertFormalRuntimeSourceUnchangedV1(input: {
  previewSession: ProductRuntimeSession;
  session: ProductRuntimeSession;
  frozen: VerifiedFormalRuntimeSourceV1;
}): Promise<void> {
  const session = input.session;
  if (
    session.productReleaseId !== input.previewSession.productReleaseId ||
    session.productBuildId !== input.previewSession.productBuildId ||
    session.runtimeSourceHash !== input.frozen.packageHash ||
    session.seed !== input.previewSession.seed
  ) {
    return Dexie.Promise.reject(new Error("[product-runtime] 实例冻结运行源在命令提交期间发生变化。"));
  }
  return assertFormalRuntimeSourceRecordsUnchangedV1(input.frozen.source);
}
