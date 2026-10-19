import { db } from '../db/schema';
import { assertRecordInScope, resolveScope } from '../workspace/scope';
import type { WorkspaceScope } from '../types';
import { verifyProductBuildPreviewManifest } from '../product-production/preview-manifest';
import { parseProductProductionBriefV3 } from '../product-production/contracts';
import { hashProductProductionValueV2 } from '../product-production/hash';
import { createBuildProductMediaResolver } from '../product-production/media-resolver';
import { verifyProductMediaRuntimeUrlsV1 } from '../product-production/media-runtime-verifier';
import { recordProductMediaRuntimeMeasurementV1, type ProductPlaythroughBrowserEnvironmentV1, type ProductMediaRuntimeAssetEvidenceV1 } from '../product-production/quality-receipts';
import { avgRuntimeStage } from './executable-module';
import { classifyAvgAuthorPrototypeBriefV1 } from './prototype-contract';
import { assertAvgPrototypeBuildWriteEnabledV1 } from './prototype-write-guard';
/** Full immutable catalog validation is separate from the player's lazy scene
 * window. Keep at most two assets alive, but sign only the complete result. */
export async function scanAvgPrototypeMediaV1(input: {
    scope: WorkspaceScope;
    buildId: number;
    expectedPreviewHash: string;
    environment: ProductPlaythroughBrowserEnvironmentV1;
    signal: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
}) {
    const scope = await resolveScope({ scope: input.scope }), build = await db.productBuilds.get(input.buildId);
    if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
        || !['preview-ready', 'release-ready'].includes(build.status) || build.previewHash !== input.expectedPreviewHash)
        throw new Error('[avg] 媒资验收的预览已变化，请刷新');
    const row = await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first();
    if (!row || !await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' }) || row.status !== 'authorized' || row.briefHash !== build.briefHash)
        throw new Error('[avg] 仅允许核验已授权的作者原型');
    const brief = parseProductProductionBriefV3(row.briefJson);
    if (await hashProductProductionValueV2(brief) !== build.briefHash) throw new Error('[avg] 原型方案字节与冻结版本不一致');
    const prototypeKind = classifyAvgAuthorPrototypeBriefV1(brief);
    if (!prototypeKind) throw new Error('[avg] 仅允许核验已授权的作者原型');
    await assertAvgPrototypeBuildWriteEnabledV1(scope, build.id!, brief);
    const preview = await verifyProductBuildPreviewManifest(build.previewManifestJson);
    if (preview.version !== 2 || preview.previewHash !== build.previewHash || preview.packageHash !== build.packageHash)
        throw new Error('[avg] 原生预览来源不闭合');
    const stage = avgRuntimeStage(preview.runtimePackage);
    if (!stage) throw new Error('[avg] 此预览没有已登记的原生舞台');
    const assets = stage.assets;
    const checkActive = () => { if (input.signal.aborted)
        throw new DOMException('媒资验收已取消，未写入全目录回执', 'AbortError'); };
    checkActive();
    if (!assets.length)
        return null;
    const resolver = await createBuildProductMediaResolver({ scope, productBuildId: build.id!, preview });
    const results: ProductMediaRuntimeAssetEvidenceV1[] = [];
    try {
        for (let offset = 0; offset < assets.length; offset += 2) {
            checkActive();
            const batch = assets.slice(offset, offset + 2);
            const catalog = await resolver.preload({ assetKeys: batch.map(asset => asset.assetKey), maximumBytes: 64 * 1024 * 1024, retainOnlyRequested: true });
            checkActive();
            const measurement = await verifyProductMediaRuntimeUrlsV1({ assets: batch.map(asset => ({ ...asset, contentHash: asset.blobContentHash })), urls: catalog.urls, environment: input.environment });
            results.push(...measurement.assets);
            input.onProgress?.(results.length, assets.length);
        }
        checkActive();
        return await recordProductMediaRuntimeMeasurementV1({ scope, productBuildId: build.id!, measurement: { assets: results.sort((left,right)=>left.assetKey.localeCompare(right.assetKey)), environment: input.environment, measuredAt: Date.now() } });
    }
    finally {
        resolver.dispose();
    }
}
