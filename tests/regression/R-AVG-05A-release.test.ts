import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db/schema';
import { prepareNativeAvgAssembly, startNativeAvgAssembly, confirmNativeAvgInputs } from '../helpers/avg-production-assembly-fixture';
import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets';
import { runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service';
import { startProductProductionPreviewV1, publishProductProductionV1 } from '../../src/lib/product-production/service';
import { prepareProductProductionAdoption } from '../../src/lib/product-production/adoption';
import { recordProductBuildMainRoutePlaythroughV1 } from '../../src/lib/product-production/quality-receipts';
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands';
import { readProductRuntimeStateVersion, readProductRuntimeState, commitNarrativeChoice } from '../../src/lib/product/runtime-core';
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances';
import { verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package';
import { verifyProductBuildTerminalArtifactSetV1, assertProductBuildTerminalReadSetUnchangedV1 } from '../../src/lib/product-production/artifact-store';
import { scopeTransactionTables } from '../../src/lib/workspace/scope';
import { readAvgSystemPlanForCompilationV1 } from '../../src/lib/avg/author-artifacts';
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export';
import { publishProductProductionBuild } from '../../src/lib/product-production/adoption';
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service';
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service';
import { prepareAvgAssemblyBriefV1 } from '../../src/lib/avg/assembly-service';
const environment = { browserName: 'deterministic-contract-test', browserVersion: '1', platform: 'isolated unit evidence', viewport: { width: 1280, height: 720 } };
async function command(sessionId: number) { const base = await readProductRuntimeStateVersion(sessionId); return { sessionId, baseSequence: base.sequence, baseStateHash: base.stateHash, commandId: crypto.randomUUID() }; }
async function linearPreview() {
    const s = await startNativeAvgAssembly(await prepareNativeAvgAssembly(createAvgAuthoringPresetV1('linear')));
    await confirmNativeAvgInputs(s);
    await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId });
    const preview = await startProductProductionPreviewV1({ scope: s.scope, productionId: s.productionId });
    return { ...s, sessionId: preview.sessionId };
}
async function completeLinear(sessionId: number) {
    await reachAvgPresentationBeat({ ...await command(sessionId), beatKey: 'line.dark' });
    await commitNarrativeChoice({ ...await command(sessionId), choiceKey: 'switch' });
    await reachAvgPresentationBeat({ ...await command(sessionId), beatKey: 'line.light' });
}
describe('AVG authored prototype release uses actual production, post-preview receipts and immutable V2 source', () => {
    beforeEach(async () => { await db.delete(); await db.open(); });
    afterEach(() => db.close());
    it('requires a completed author-confirmed technical route, then freezes V2 and starts an independent Release session', async () => {
        const s = await linearPreview(), before = (await db.productBuilds.get(s.buildId))!;
        expect(JSON.parse(before.qualityReportJson).releaseReady).toBe(false);
        await expect(prepareProductProductionAdoption({ scope: s.scope, productionId: s.productionId })).rejects.toThrow();
        await completeLinear(s.sessionId);
        expect((await readProductRuntimeState(s.sessionId)).narrative!.completed).toBe(true);
        await recordProductBuildMainRoutePlaythroughV1({ scope: s.scope, productBuildId: s.buildId, productRuntimeSessionId: s.sessionId, authorConfirmation: 'author-confirmed-main-route', environment });
        const prepared = await prepareProductProductionAdoption({ scope: s.scope, productionId: s.productionId });
        expect(prepared.mediaAssetKeys).toEqual([]);
        const published = await publishProductProductionV1({ scope: s.scope, productionId: s.productionId });
        const record = (await db.productReleases.get(published.receipt.productReleaseId))!, manifest = await verifyProductReleaseManifest(record.manifestJson);
        expect(manifest).toMatchObject({ version: 2, productType: 'avg', runtimePackage: { version: 2 } });
        expect(manifest.productionProvenance!.rootTerminalReceiptHash).toBe(before.rootTerminalReceiptHash);
        expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(before.previewManifestJson);
        expect((await db.productRuntimeSessions.get(s.sessionId))!.productBuildId).toBe(s.buildId);
        const next = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '隔离本地原型正式来源', productSource: { kind: 'release', productReleaseId: record.id! } });
        expect(next.productReleaseId).toBe(record.id);
        expect((await readProductRuntimeState(next.id!)).narrative!.currentNodeKey).toBe('dark');
        const restoredProjectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId));
        const restoredSession = await db.productRuntimeSessions.where('projectId').equals(restoredProjectId).filter(row => row.productReleaseId != null).first();
        expect(restoredSession!.productReleaseId).not.toBe(record.id);
        expect((await readProductRuntimeState(restoredSession!.id!)).narrative!.currentNodeKey).toBe('dark');
        expect((await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(row => row.artifactKey === 'avg.system.plan').first())!.producerRunId).toBeNull();
    }, 30000);
    it('rejects unfinished routes and preserves the frozen author-write fence', async () => {
        const s = await linearPreview(), build = (await db.productBuilds.get(s.buildId))!;
        await expect(recordProductBuildMainRoutePlaythroughV1({ scope: s.scope, productBuildId: s.buildId, productRuntimeSessionId: s.sessionId, authorConfirmation: 'author-confirmed-main-route', environment })).rejects.toThrow(/尚未到达/);
        await expect(readAvgSystemPlanForCompilationV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })).rejects.toThrow(/不可采用/);
        expect(await db.productQualityGateReceipts.where('buildId').equals(s.buildId).count()).toBe(0);
    }, 30000);
    it('verifies original author commands and fences changes after terminal inspection', async () => {
        const s = await linearPreview(), build = (await db.productBuilds.get(s.buildId))!;
        const proof = await verifyProductBuildTerminalArtifactSetV1({ scope: s.scope, productionId: s.productionId, buildId: s.buildId, expectedControlEpoch: build.controlEpoch, expectedPlanHash: build.planHash });
        const command = (await db.productProductionCommands.where('productionId').equals(s.productionId).filter(row => row.type === 'adopt-avg-artifact').first())!;
        await db.productProductionCommands.update(command.id!, { resultJson: '{}' });
        await expect(db.transaction('r', scopeTransactionTables(db.productProductionCommands), () => assertProductBuildTerminalReadSetUnchangedV1({ readSet: proof.casReadSet }))).rejects.toThrow(/作者命令/);
        await expect(verifyProductBuildTerminalArtifactSetV1({ scope: s.scope, productionId: s.productionId, buildId: s.buildId, expectedControlEpoch: build.controlEpoch, expectedPlanHash: build.planHash })).rejects.toThrow(/作者回执/);
        await db.productProductionCommands.put(command);
        const ledger = JSON.parse(build.budgetLedgerJson);
        ledger.tasks['avg.author.rules'].idempotencyKey = 'a'.repeat(64);
        await db.productBuilds.update(s.buildId, { budgetLedgerJson: JSON.stringify(ledger) });
        await expect(verifyProductBuildTerminalArtifactSetV1({ scope: s.scope, productionId: s.productionId, buildId: s.buildId, expectedControlEpoch: build.controlEpoch, expectedPlanHash: build.planHash })).rejects.toThrow(/作者任务消费回执/);
    }, 30000);
    it('rejects a stale reviewed publication after a newer author-confirmed route receipt', async()=>{
      const s=await linearPreview();await completeLinear(s.sessionId)
      await recordProductBuildMainRoutePlaythroughV1({scope:s.scope,productBuildId:s.buildId,productRuntimeSessionId:s.sessionId,authorConfirmation:'author-confirmed-main-route',environment})
      const prepared=await prepareProductProductionAdoption({scope:s.scope,productionId:s.productionId})
      const updated=await startProductProductionPreviewV1({scope:s.scope,productionId:s.productionId});await completeLinear(updated.sessionId)
      await recordProductBuildMainRoutePlaythroughV1({scope:s.scope,productBuildId:s.buildId,productRuntimeSessionId:updated.sessionId,authorConfirmation:'author-confirmed-main-route',environment})
      await expect(publishProductProductionBuild({scope:s.scope,productionId:s.productionId,command:{type:'publish',commandId:crypto.randomUUID(),expectedStateRevision:prepared.intent.expectedStateRevision,buildNumber:prepared.intent.buildNumber,expectedManifestHash:prepared.intent.manifestHash,adoptionIntentHash:prepared.adoptionIntentHash}})).rejects.toThrow(/已过期/)
      expect(await db.productReleases.where('workId').equals(s.scope.workId).count()).toBe(0)
    },30000)
    it('publishes a successor from a revised author Build while old Release bytes and sessions remain pinned',async()=>{
      const s=await linearPreview();await completeLinear(s.sessionId)
      await recordProductBuildMainRoutePlaythroughV1({scope:s.scope,productBuildId:s.buildId,productRuntimeSessionId:s.sessionId,authorConfirmation:'author-confirmed-main-route',environment})
      const first=await publishProductProductionV1({scope:s.scope,productionId:s.productionId})
      const original=(await db.productReleases.get(first.receipt.productReleaseId))!
      const oldSession=await createProductRuntimeInstance({scope:s.scope,kind:'avg',title:'旧版本存档',productSource:{kind:'release',productReleaseId:original.id!}})
      const draft=await readAvgDraftV1(s.scope),workspace=createAvgAuthoringPresetV1('linear')
      workspace.basePreviewHash=(await db.productBuilds.get(s.buildId))!.previewHash
      workspace.scripts[0]!.lines[0]!.text='第二版原创校准句，系统骨架保持可复用。'
      const saved=await saveAvgAuthorWorkspaceV1(s.scope,draft.revision,workspace)
      const details=await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:saved.revision})
      const next=await startNativeAvgAssembly({...s,details})
      await confirmNativeAvgInputs(next);await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
      const preview=await startProductProductionPreviewV1({scope:s.scope,productionId:s.productionId});await completeLinear(preview.sessionId)
      await recordProductBuildMainRoutePlaythroughV1({scope:s.scope,productBuildId:next.buildId,productRuntimeSessionId:preview.sessionId,authorConfirmation:'author-confirmed-main-route',environment})
      const second=await publishProductProductionV1({scope:s.scope,productionId:s.productionId})
      const manifest=await verifyProductReleaseManifest((await db.productReleases.get(second.receipt.productReleaseId))!.manifestJson)
      expect(second.receipt.releaseVersion).toBe(2)
      expect(manifest.lineage!.parentRelease).toEqual({releaseUid:JSON.parse(original.manifestJson).lineage.releaseUid,releaseHash:JSON.parse(original.manifestJson).lineage.releaseHash})
      expect((await db.productReleases.get(original.id!))!.manifestJson).toBe(original.manifestJson)
      expect((await db.productRuntimeSessions.get(oldSession.id!))!.productReleaseId).toBe(original.id)
      expect((await readProductRuntimeState(oldSession.id!)).narrative!.contentHash).toBe(JSON.parse(original.manifestJson).packageHash)
    },30000)
});
