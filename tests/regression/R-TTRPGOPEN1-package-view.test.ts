import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db/schema";
import { hashProductProductionValueV2 } from "../../src/lib/product-production/hash";
import {
  parseProductRuntimePackageV1,
  verifyProductReleaseManifestV1,
  verifyProductReleaseRuntimeViewV1,
} from "../../src/lib/product-production/runtime-package";
import {
  createProductBuildPreviewManifestV1,
  verifyProductBuildPreviewRuntimeViewV1,
} from "../../src/lib/product-production/preview-manifest";
import { verifyProductDistributionBundleV2 } from "../../src/lib/product-platform/distribution-bundle";
import { hashStateJson, readProductRuntimeState, readProductRuntimeStateVersion } from "../../src/lib/product/runtime-core";
import { loadTtrpgRuntimeContentV1 } from "../../src/lib/ttrpg/runtime-content";
import { assertTtrpgPlayerProtocolV1, resolveTtrpgRunFormatV1 } from "../../src/lib/ttrpg/run-format";
import { readyAiKpSession } from "../helpers/ready-ttrpg-session";
import { openRuntimePackageFixture } from "../helpers/ttrpg-open-package";
import { createFixtureProductReleaseManifestV1 } from "../helpers/product-release-v1";
import { hashTtrpgFrozenPredicateIndexV1 } from "../../src/lib/ttrpg/content-version";
import { startTtrpgOpenRunV1, advanceTtrpgWorldTurnV1 } from "../../src/lib/ttrpg/runtime-commands";

async function fogHarbor() {
  return verifyProductDistributionBundleV2(
    JSON.parse(readFileSync("public/games/fog-harbor/game.json", "utf8")),
  );
}

describe("R-TTRPGOPEN1 · raw identity and compatibility views", () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  afterEach(() => db.close());

  it("完整 V2 仅由显式 protocol2 reader 读取；无结局预览保留原始身份", async () => {
    const runtimePackage = await openRuntimePackageFixture();
    const raw = JSON.stringify(runtimePackage);
    expect(() => parseProductRuntimePackageV1(runtimePackage)).toThrow();
    const parsed = parseProductRuntimePackageV1(runtimePackage, { ttrpgProtocol: 2 });
    expect(parsed.ttrpg!.campaign.version).toBe(2);
    expect(parsed.narrative.choices).toEqual([]);
    const preview = await createProductBuildPreviewManifestV1({
      productionKey: "open.preview", buildNumber: 1,
      buildManifestHash: "c".repeat(64), runtimePackage: parsed,
    }, { ttrpgProtocol: 2 });
    const view = await verifyProductBuildPreviewRuntimeViewV1(preview, { ttrpgProtocol: 2 });
    expect(view.runtimeView?.runFormat).toBe("open");
    expect(view.runtimeView?.mechanicalRulePack.version).toBe(1);
    expect(view.runtimeView?.rawContent.rulePack.content.version).toBe(2);
    expect(view.validatedHashes.packageHash).toBe(await hashProductProductionValueV2(parsed));
    expect(JSON.stringify(runtimePackage)).toBe(raw);
  });

  it("新格式来源必须属于冻结选择；事实索引哈希不能被外层正确哈希掩盖", async () => {
    const runtimePackage = await openRuntimePackageFixture();
    runtimePackage.sourceWorld.selection = {
      ...runtimePackage.sourceWorld.selection, resourceKeys: [], roleBindings: {},
    };
    expect(() => parseProductRuntimePackageV1(runtimePackage, { ttrpgProtocol: 2 })).toThrow(/来源超出/);
    const badIndex = await openRuntimePackageFixture();
    if (badIndex.ttrpg!.campaign.version !== 2) throw new Error("fixture format");
    badIndex.ttrpg!.campaign.frozenWorldPredicateIndex.indexHash = "0".repeat(64);
    await expect(createProductBuildPreviewManifestV1({
      productionKey: "bad.index", buildNumber: 1, buildManifestHash: "c".repeat(64),
      runtimePackage: badIndex,
    }, { ttrpgProtocol: 2 })).rejects.toThrow(/indexHash/);
  });

  it("事实索引即使重算摘要也必须绑定同一冻结世界", async () => {
    const runtimePackage = await openRuntimePackageFixture();
    const campaign = runtimePackage.ttrpg!.campaign;
    if (campaign.version !== 2) throw new Error("fixture format");
    campaign.frozenWorldPredicateIndex.worldReleaseHash = "f".repeat(64);
    campaign.frozenWorldPredicateIndex.indexHash =
      await hashTtrpgFrozenPredicateIndexV1(campaign.frozenWorldPredicateIndex);
    expect(() => parseProductRuntimePackageV1(runtimePackage, { ttrpgProtocol: 2 }))
      .toThrow(/worldReleaseHash.*来源世界/);
    await expect(createProductBuildPreviewManifestV1({
      productionKey: "wrong.world", buildNumber: 1,
      buildManifestHash: "c".repeat(64), runtimePackage,
    }, { ttrpgProtocol: 2 })).rejects.toThrow(/worldReleaseHash.*来源世界/);
    await expect(createFixtureProductReleaseManifestV1({
      runtimePackage,
    }, { ttrpgProtocol: 2 })).rejects.toThrow(/worldReleaseHash.*来源世界/);
  });

  it.each(["successor", "choice"])("open 包拒绝可执行的通用叙事导航：%s", async route => {
    const runtimePackage = await openRuntimePackageFixture();
    const key = runtimePackage.narrative.entryNodeKey;
    if (route === "successor") {
      runtimePackage.narrative.nodes[0].successorKeys = [key];
    } else {
      runtimePackage.narrative.choices = [{
        choiceKey: "generic.jump", sourceNodeKey: key, targetNodeKey: key,
        text: "跳转", description: "", unavailableReason: "",
        displayConditionJson: "{}", availableConditionJson: "{}",
        effectsJson: "[]", tags: [], order: 0,
      }];
    }
    expect(() => parseProductRuntimePackageV1(runtimePackage, { ttrpgProtocol: 2 }))
      .toThrow(/不允许通用导航/);
  });

  it("V2 发布保留共同外壳及完整 lineage 验真；旧播放器明确拒绝", async () => {
    const manifest = await createFixtureProductReleaseManifestV1({
      runtimePackage: await openRuntimePackageFixture(),
    }, { ttrpgProtocol: 2 });
    const before = JSON.stringify(manifest);
    await expect(verifyProductReleaseManifestV1(manifest)).rejects.toThrow();
    const view = await verifyProductReleaseRuntimeViewV1(manifest, { ttrpgProtocol: 2 });
    expect(view.rawManifest.schema).toBe("storyforge.product-release");
    expect(view.rawManifest.version).toBe(1);
    expect(view.rawManifest).toEqual(manifest);
    expect(view.runtimeView?.runFormat).toBe("open");
    expect(JSON.stringify(manifest)).toBe(before);
    const broken = structuredClone(manifest);
    broken.lineage.releaseHash = "0".repeat(64);
    await expect(verifyProductReleaseRuntimeViewV1(broken, { ttrpgProtocol: 2 })).rejects.toThrow(/lineage/);
  });

  it("真实旧发布包验真后形成 scripted 视图，包/规则/发行身份不变", async () => {
    const bundle = await fogHarbor();
    const manifest = bundle.productRelease.manifest;
    const before = JSON.stringify(manifest);
    const view = await verifyProductReleaseRuntimeViewV1(manifest, { ttrpgProtocol: 2 });
    expect(view.rawManifest).toEqual(manifest);
    expect(view.validatedHashes).toEqual({
      packageHash: manifest.packageHash,
      releaseIdentityHash: manifest.releaseIdentityHash,
      ruleContentHash: manifest.runtimePackage.ttrpg!.rulePack.contentHash,
    });
    expect(view.runtimeView?.runFormat).toBe("scripted");
    expect(view.runtimeView?.rawContent.campaign).not.toHaveProperty("runFormat");
    expect(view.runtimeView?.mechanicalRulePack).toEqual(manifest.runtimePackage.ttrpg!.rulePack.content);
    expect(await hashProductProductionValueV2(view.rawRuntimePackage)).toBe(manifest.packageHash);
    expect(JSON.stringify(manifest)).toBe(before);
  });

  it("新 reader 的旧预览视图不改变 packageHash 或 previewHash", async () => {
    const bundle = await fogHarbor();
    const preview = await createProductBuildPreviewManifestV1({
      productionKey: "preview.compatibility",
      buildNumber: 1,
      buildManifestHash: "a".repeat(64),
      runtimePackage: bundle.productRelease.manifest.runtimePackage,
    });
    const before = JSON.stringify(preview);
    const view = await verifyProductBuildPreviewRuntimeViewV1(preview, { ttrpgProtocol: 2 });
    expect(view.rawManifest).toEqual(preview);
    expect(view.runtimeView?.runFormat).toBe("scripted");
    expect(view.validatedHashes.previewHash).toBe(preview.previewHash);
    expect(JSON.stringify(preview)).toBe(before);
  });

  it("篡改旧规则必须在生成兼容视图前失败", async () => {
    const bundle = await fogHarbor();
    const manifest = structuredClone(bundle.productRelease.manifest);
    manifest.runtimePackage.ttrpg!.rulePack.content.title += " tampered";
    await expect(verifyProductReleaseRuntimeViewV1(manifest, { ttrpgProtocol: 2 })).rejects.toThrow();
  });

  it("混合 V1 内容和 V2 声明不进入兼容路径", async () => {
    const bundle = await fogHarbor();
    const original = bundle.productRelease.manifest.runtimePackage;
    const mixed = {
      ...original,
      ttrpg: {
        ...original.ttrpg,
        compatibility: { runtimeProtocol: 2, minimumPlayerVersion: 2 },
      },
    };
    expect(() => parseProductRuntimePackageV1(mixed)).toThrow();
    expect(() => parseProductRuntimePackageV1(mixed, { ttrpgProtocol: 2 })).toThrow();
    expect(() => resolveTtrpgRunFormatV1({ ...original.ttrpg!.campaign, runFormat: "open" })).toThrow();
  });

  it("协议能力不能由缺字段、未来版本或升级标记绕过", () => {
    expect(() => assertTtrpgPlayerProtocolV1({ runtimeProtocol: 2, minimumPlayerVersion: 2, playerVersion: 1 })).toThrow();
    expect(() => assertTtrpgPlayerProtocolV1({ runtimeProtocol: 2, minimumPlayerVersion: 1, playerVersion: 2 })).toThrow();
    expect(() => assertTtrpgPlayerProtocolV1({ runtimeProtocol: 3, minimumPlayerVersion: 3, playerVersion: 3 })).toThrow();
    expect(() => assertTtrpgPlayerProtocolV1({ runtimeProtocol: 1, minimumPlayerVersion: 1, playerVersion: 2 })).not.toThrow();
  });

  it("旧团局重复读取保留 initialState、runtime head 和原始哈希", async () => {
    const fixture = await readyAiKpSession("旧档兼容视图");
    const before = (await db.productRuntimeSessions.get(fixture.sessionId))!;
    const version = await readProductRuntimeStateVersion(fixture.sessionId);
    const state = await readProductRuntimeState(fixture.sessionId);
    const view = await loadTtrpgRuntimeContentV1({
      scope: fixture.scope, productRuntimeSessionId: fixture.sessionId,
    });
    expect(view.runtimeView.runFormat).toBe("scripted");
    expect(state.ttrpg).not.toHaveProperty("openRun");
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(state);
    expect(await readProductRuntimeStateVersion(fixture.sessionId)).toEqual(version);
    const after = (await db.productRuntimeSessions.get(fixture.sessionId))!;
    expect(after.initialStateJson).toBe(before.initialStateJson);
    expect(after.runtimeHeadStateJson).toBe(before.runtimeHeadStateJson);
    expect(after.runtimeHeadStateHash).toBe(before.runtimeHeadStateHash);
    expect(await hashStateJson(after.runtimeHeadStateJson!)).toBe(version.stateHash);
  });

  it("open formal commands cannot mutate a real scripted session", async () => {
    const fixture = await readyAiKpSession("格式命令边界");
    const before = (await db.productRuntimeSessions.get(fixture.sessionId))!;
    const version = await readProductRuntimeStateVersion(fixture.sessionId);
    const count = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count();
    const envelope = { sessionId: fixture.sessionId, baseSequence: version.sequence, baseStateHash: version.stateHash };
    await expect(startTtrpgOpenRunV1({ ...envelope, commandId: 'wrong.open' })).rejects.toThrow(/scripted/);
    await expect(advanceTtrpgWorldTurnV1({ ...envelope, commandId: 'wrong.tick', reason: 'game-action' })).rejects.toThrow(/scripted/);
    expect(await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).count()).toBe(count);
    expect(await db.productRuntimeSessions.get(fixture.sessionId)).toEqual(before);
  });
});
