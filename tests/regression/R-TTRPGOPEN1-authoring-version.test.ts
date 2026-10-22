import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db/schema";
import {
  defaultTtrpgSettings, isTtrpgAuthoringSettingsV2, parseTtrpgSettings,
  parseTtrpgSettingsV1, serializeTtrpgSettings, settingsFromTtrpgDraft, ttrpgSettingsRunFormat,
} from "../../src/lib/ttrpg/authoring-contract";
import { defaultTtrpgSettingsV2, parseTtrpgAuthoringSettingsV2 } from "../../src/lib/ttrpg/authoring-contract-v2";
import {
  createTtrpgDraft, prepareTtrpgBrief, readTtrpgDraft, saveTtrpgDraft, selectTtrpgWorld,
  prepareTtrpgOpenBriefCandidateV3, saveTtrpgOpenBriefV3, startTtrpgOpenBriefV3,
  verifyTtrpgOpenBriefV3,
} from "../../src/lib/ttrpg/authoring-service";
import { assertTtrpgScriptedAuthoringSettings } from "../../src/lib/ttrpg/authoring-settings";
import {
  createTtrpgProductionBriefContentV3, createTtrpgProductionBriefV3,
  hashTtrpgProductionBriefContentV3, parseTtrpgProductionBriefV3,
} from "../../src/lib/ttrpg/production-brief-v3";
import { parseTtrpgProductionBriefV2 } from "../../src/lib/ttrpg/production-brief";
import { createStoryForgeRulePackV1 } from "../../src/lib/ttrpg/storyforge-rule-pack";
import { saveTtrpgRulePackV1, saveTtrpgRulePackV2 } from "../../src/lib/ttrpg/rule-pack-library";
import type { RulePackV2 } from "../../src/lib/ttrpg/open-contract";
import { parseRulePackV2 } from "../../src/lib/ttrpg/rule-pack-v2";
import { hashProductProductionValueV2 } from "../../src/lib/product-production/hash";
import { executeProductProductionCommand } from "../../src/lib/product-production/commands";
import { createConfirmedProductBriefV1, resolveProductSourceReadBoundaryV1 } from "../../src/lib/product/source-contracts";
import { listWorldSemanticResourceDescriptorsV1, readWorldSemanticResourceV1 } from "../../src/lib/context-gateway/world-release-client";
import { createMistHarborWorld } from "../../src/lib/world-engine/mist-harbor-preset";
import { createWorldRevision, publishWorldRevision } from "../../src/lib/world-engine/releases";
import * as worldReferenceApi from "../../src/lib/world-engine/world-reference";
import type { ProductSourcePlanV1 } from "../../src/lib/types";
import { exportProjectJSON, importProjectJSON } from "../../src/lib/export/json-export";
import { deleteWork } from "../../src/lib/workspace/lifecycle";
import { openCampaignFixture, openRuleFixture } from "../helpers/ttrpg-open-content";

// The first real scripted compile loads the shared production graph. Keep cold
// module transformation outside the per-test database lifetime. Allow cold
// transformation to finish while the main thread runs the full coverage suite.
beforeAll(async () => {
  await import("../../src/lib/product-production/service");
  await import("../../src/lib/product-production/commands");
}, 60_000);
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => db.close());

function openSettings() {
  const settings = defaultTtrpgSettingsV2("open");
  if (settings.runFormat !== "open") throw new Error("fixture format");
  return settings;
}

function readySettings() {
  const settings = openSettings();
  settings.openingSituation = "船离港前找回失踪的信使";
  settings.playerRole = "共同调查港口的旅人";
  settings.wizard.confirmAll = true;
  settings.wizard.targetSceneCount = 0;
  settings.wizard.targetEndingCount = 0;
  const campaign = openCampaignFixture();
  settings.openAuthoring = {
    factPolicy: campaign.frozenWorldPredicateIndex.entries.map((fact) => ({ fact, authorConfirmed: true })),
    situationTemplates: campaign.situationTemplates,
    openingSituationKeys: campaign.openingSituationKeys,
    effectPlanTemplates: campaign.effectPlanTemplates,
    pressure: { clocks: campaign.clocks, fronts: campaign.fronts },
    companionPolicy: {
      ...campaign.companionPolicy,
      approvalBindings: campaign.companionPolicy.approvalBindings.map((binding) => ({
        ...binding,
        approverSeatKeys: [...binding.approverSeatKeys],
      })),
    },
    stageClosurePolicy: campaign.stageClosurePolicy,
    dynamicEntityTemplates: campaign.dynamicEntityTemplates,
    runtimePolicy: campaign.runtimePolicy,
  };
  return settings;
}

function openRule(): RulePackV2 {
  return parseRulePackV2(openRuleFixture());
}

async function scriptedProduction() {
  const settings = defaultTtrpgSettingsV2("scripted");
  settings.wizard.confirmAll = true;
  settings.openingSituation = "调查码头";
  const made = await createTtrpgDraft("作者版本兼容", settings);
  const world = await createMistHarborWorld();
  const chosen = await selectTtrpgWorld(made.scope, 0, world.worldReleaseId);
  const productionId = await prepareTtrpgBrief(made.scope, chosen.revision);
  const briefRow = await db.productProductionBriefs.where("productionId").equals(productionId).first();
  if (!briefRow) throw new Error("missing Brief fixture");
  return { made, briefRow, world, draft: await readTtrpgDraft(made.scope) };
}

async function openBriefFixture() {
  const scripted = await scriptedProduction();
  const sourcePlan = JSON.parse(scripted.briefRow.sourcePlanJson) as ProductSourcePlanV1;
  const input = {
    settingsRevision: scripted.draft.revision,
    settings: readySettings(),
    rulePack: openRule(),
    worldReference: sourcePlan.worldReference,
    sourcePlan,
  };
  const content = await createTtrpgProductionBriefContentV3(input);
  // Fixture uses the SAME shared confirmation contract as production, not an open-only grant.
  const startAuthorization = await createConfirmedProductBriefV1({
    productType: "ttrpg",
    productInstanceKey: sourcePlan.productInstanceKey,
    sourcePlan,
    briefRevision: 1,
    briefContentHash: await hashTtrpgProductionBriefContentV3(content),
    authorStartRevision: 1,
    confirmedAt: Date.now(),
  });
  const brief = await createTtrpgProductionBriefV3({ content, startAuthorization });
  return { ...scripted, input, content, brief };
}

async function openDomainFixture() {
  const existing = await scriptedProduction();
  const settings = readySettings();
  const sourcePlan = JSON.parse(existing.briefRow.sourcePlanJson) as ProductSourcePlanV1;
  const boundary = await resolveProductSourceReadBoundaryV1(sourcePlan);
  const descriptors = await listWorldSemanticResourceDescriptorsV1(boundary.sourceScope);
  const descriptor = descriptors.find(item => boundary.allowedResourceKeys.includes(item.resourceKey) && item.worldSemantic?.resourceKind === "location")!;
  const resource = await readWorldSemanticResourceV1({ scope: boundary.sourceScope, descriptor });
  if (typeof resource.value.name !== "string") throw new Error("fixture location has no canonical name");
  for (const row of settings.openAuthoring.factPolicy) {
    row.fact.sourceResourceRefs = [descriptor.resourceKey];
    row.fact.sourceFieldRefs = [{ resourceKey: descriptor.resourceKey, fieldPath: "name", contentHash: descriptor.contentHash }];
  }
  for (const template of settings.openAuthoring.situationTemplates) {
    template.sourceRefs = [descriptor.resourceKey];
    for (const evidence of template.evidence) evidence.sourceResourceRefs = [descriptor.resourceKey];
  }
  for (const clock of settings.openAuthoring.pressure.clocks) clock.sourceRefs = [descriptor.resourceKey];
  for (const front of settings.openAuthoring.pressure.fronts) front.sourceRefs = [descriptor.resourceKey];
  const rule = await saveTtrpgRulePackV2({ scope: existing.made.scope, rulePack: openRule() });
  settings.wizard.ruleOrigin = "saved-rule-pack";
  settings.wizard.savedRulePackId = rule.id!;
  const draft = await saveTtrpgDraft(existing.made.scope, existing.draft.revision, settings, "open");
  const production = (await db.productProductions.get(draft.productionId!))!;
  return {
    ...existing, draft, rule, production,
    request: {
      scope: existing.made.scope, revision: draft.revision,
      productionId: production.id!, expectedStateRevision: production.stateRevision,
    },
  };
}

// Exercise the real P2d public save and start services. The prior scripted row
// remains immutable and no test writes an authorized state directly.
async function confirmedOpenDomainFixture() {
  const fixture = await openDomainFixture();
  const saved = await saveTtrpgOpenBriefV3({
    ...fixture.request,
    commandId: "test.open.save",
  });
  const started = await startTtrpgOpenBriefV3({
    ...fixture.request,
    expectedStateRevision: saved.receipt.stateRevision,
    commandId: "test.open.start",
  });
  const briefRow = await db.productProductionBriefs
    .where("[productionId+revision]")
    .equals([fixture.production.id!, started.candidate.briefRevision])
    .first();
  if (!briefRow) throw new Error("missing saved open Brief fixture");
  const confirmation = JSON.parse(briefRow.confirmedBriefJson);
  return {
    ...fixture, candidate: started.candidate, confirmation, briefId: briefRow.id!,
    request: {
      ...fixture.request, expectedStateRevision: started.receipt.stateRevision,
      expectedConfirmationHash: confirmation.confirmationHash,
    },
  };
}

describe("Settings V2 版本与闭集", () => {
  it("keeps legacy reads byte-identical and interprets format only in memory", async () => {
    const made = await createTtrpgDraft("legacy");
    const before = await readTtrpgDraft(made.scope);
    expect(JSON.parse(before.settingsJson)).not.toHaveProperty("version");
    expect(JSON.parse(before.settingsJson)).not.toHaveProperty("runFormat");
    const settings = settingsFromTtrpgDraft(before);
    expect(ttrpgSettingsRunFormat(settings)).toBe("scripted");
    expect(isTtrpgAuthoringSettingsV2(settings)).toBe(false);
    expect(serializeTtrpgSettings(settings).settingsJson).toBe(before.settingsJson);
    settings.openingSituation = "内存更改";
    expect(await readTtrpgDraft(made.scope)).toEqual(before);
    expect(await db.ttrpgAuthoringDrafts.get(before.id!)).toEqual(before);
    const saved = await saveTtrpgDraft(made.scope, before.revision, settings, "legacy");
    expect(saved.revision).toBe(1);
    expect(JSON.parse(saved.settingsJson)).not.toHaveProperty("version");
  });

  it.each(["open", "scripted"] as const)("roundtrips %s without losing V2 fields on a wizard edit", async (format) => {
    const settings = defaultTtrpgSettingsV2(format);
    const made = await createTtrpgDraft("V2", settings);
    const row = await readTtrpgDraft(made.scope);
    // Mirrors useState(defaultTtrpgSettings) and the existing UI's spread update.
    let uiState: ReturnType<typeof defaultTtrpgSettings> = settingsFromTtrpgDraft(row);
    uiState = { ...uiState, wizard: { ...uiState.wizard, instruction: "保留局势配置" } };
    const saved = await saveTtrpgDraft(made.scope, row.revision, uiState, "V2 edited");
    const restored = settingsFromTtrpgDraft(await readTtrpgDraft(made.scope));
    expect(restored).toEqual(uiState);
    expect(restored.runFormat).toBe(format);
    expect(restored.openAuthoring).toEqual(settings.openAuthoring);
    expect(saved.revision).toBe(row.revision + 1);
    expect(saved.preparedRevision).toBeNull();
    await expect(saveTtrpgDraft(made.scope, row.revision, uiState, "stale")).rejects.toThrow("其他页面");
    await expect(saveTtrpgDraft(made.scope, saved.revision, defaultTtrpgSettings(), "降级")).rejects.toThrow("legacy");
    expect(await readTtrpgDraft(made.scope)).toEqual(saved);
    expect((await db.works.get(made.scope.workId))!.title).toBe("V2 edited");
  });

  it.each([
    { version: 1 }, { schema: "other" }, { runFormat: "sandbox" },
    { futureField: true }, { openAuthoring: null }, { version: undefined },
  ])("rejects partial, mixed and unknown contracts %j", (patch) => {
    expect(() => parseTtrpgSettings({ ...openSettings(), ...patch })).toThrow();
  });

  it("requires every V2 field and rejects nested extras without changing legacy parser", () => {
    const valid = openSettings();
    for (const key of Object.keys(valid)) {
      const broken = { ...valid } as Record<string, unknown>;
      delete broken[key];
      expect(() => parseTtrpgAuthoringSettingsV2(broken)).toThrow();
    }
    expect(() => parseTtrpgSettings({ ...defaultTtrpgSettings(), runFormat: "scripted" })).toThrow();
    expect(() => parseTtrpgSettingsV1(valid)).toThrow();
    expect(() => parseTtrpgSettings({ ...valid, wizard: { ...valid.wizard, extra: true } })).toThrow();
    expect(() => parseTtrpgSettings({ ...valid, openAuthoring: { ...valid.openAuthoring, extra: true } })).toThrow();
    expect(() => parseTtrpgSettings({ ...valid, runFormat: "scripted" })).toThrow("null");
    expect(parseTtrpgSettings(defaultTtrpgSettingsV2("scripted")).openAuthoring).toBeNull();
  });

  it("rejects invalid seats, revisions and cross-Work writes without side effects", async () => {
    const made = await createTtrpgDraft("A", openSettings());
    const other = await createTtrpgDraft("B", openSettings());
    const before = await readTtrpgDraft(made.scope);
    const settings = openSettings();
    expect(() => parseTtrpgSettings({
      ...settings, wizard: { ...settings.wizard, seats: [{ ...settings.wizard.seats[0], controller: "root" }] },
    })).toThrow();
    for (const revision of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER])
      await expect(saveTtrpgDraft(made.scope, revision, settings, "invalid")).rejects.toThrow("revision");
    await expect(saveTtrpgDraft({ ...made.scope, workId: other.scope.workId }, 0, settings, "越界")).rejects.toThrow();
    expect(await readTtrpgDraft(made.scope)).toEqual(before);
    expect((await db.works.get(other.scope.workId))!.title).toBe("B");
  });

  it("roundtrips V2 through existing backup and Work deletion lifecycle", async () => {
    const made = await createTtrpgDraft("open draft", readySettings());
    const original = await readTtrpgDraft(made.scope);
    const restoredProject = await importProjectJSON(await exportProjectJSON(made.scope.projectId));
    const restored = await db.ttrpgAuthoringDrafts.where("projectId").equals(restoredProject).first();
    expect(restored!.workId).not.toBe(original.workId);
    expect(settingsFromTtrpgDraft(restored!)).toEqual(settingsFromTtrpgDraft(original));
    await deleteWork(restoredProject, restored!.workId);
    expect(await db.ttrpgAuthoringDrafts.where("projectId").equals(restoredProject).count()).toBe(0);
    expect(await readTtrpgDraft(made.scope)).toEqual(original);
  });

  it("preserves the remappable rule locator and rejects another Work's rule before saving", async () => {
    const made = await createTtrpgDraft("A", openSettings());
    const other = await createTtrpgDraft("B");
    const localRule = await saveTtrpgRulePackV1({ scope: made.scope, rulePack: createStoryForgeRulePackV1() });
    const foreignRule = await saveTtrpgRulePackV1({ scope: other.scope, rulePack: createStoryForgeRulePackV1() });
    const settings = openSettings();
    settings.wizard.ruleOrigin = "saved-rule-pack";
    settings.wizard.savedRulePackId = foreignRule.id!;
    await expect(saveTtrpgDraft(made.scope, 0, settings, "越界")).rejects.toThrow("不属于");
    settings.wizard.savedRulePackId = localRule.id!;
    const saved = await saveTtrpgDraft(made.scope, 0, settings, "A");
    expect(saved.savedRulePackId).toBe(localRule.id);
    expect(JSON.parse(saved.settingsJson).wizard.savedRulePackId).toBeNull();
    expect(settingsFromTtrpgDraft(saved).wizard.savedRulePackId).toBe(localRule.id);
    expect(settings.wizard.savedRulePackId).toBe(localRule.id);
    const restoredProject = await importProjectJSON(await exportProjectJSON(made.scope.projectId));
    const restored = await db.ttrpgAuthoringDrafts.where("projectId").equals(restoredProject).first();
    expect(restored!.savedRulePackId).not.toBe(localRule.id);
    const remappedRule = await db.ttrpgRulePacks.get(restored!.savedRulePackId!);
    expect(remappedRule!.workId).toBe(restored!.workId);
    expect(remappedRule!.contentHash).toBe(localRule.contentHash);
    expect(settingsFromTtrpgDraft(restored!).version).toBe(2);
  });

  it("rejects open before source consultation or scripted compilation and preserves the old Brief", async () => {
    const { made, draft, briefRow } = await scriptedProduction();
    const legacy = JSON.parse(briefRow.briefJson).ttrpg;
    const beforeBytes = briefRow.briefJson;
    const parsedBefore = parseTtrpgProductionBriefV2(legacy);
    expect(await hashProductProductionValueV2(parsedBefore)).toBe(await hashProductProductionValueV2(legacy));
    const saved = await saveTtrpgDraft(made.scope, draft.revision, openSettings(), "open");
    expect(() => assertTtrpgScriptedAuthoringSettings(settingsFromTtrpgDraft(saved))).toThrow("P2a");
    await expect(prepareTtrpgBrief(made.scope, saved.revision)).rejects.toThrow("open 制作需要本作品已保存的 RulePack V2");
    expect(await db.productProductionBriefs.get(briefRow.id!)).toEqual(briefRow);
    const after = await db.productProductionBriefs.get(briefRow.id!);
    expect(after!.briefJson).toBe(beforeBytes);
    expect(parseTtrpgProductionBriefV2(JSON.parse(after!.briefJson).ttrpg)).toEqual(parsedBefore);
    expect(await db.productBuilds.count()).toBe(0);
    expect(await readTtrpgDraft(made.scope)).toEqual(saved);
    await expect(parseTtrpgProductionBriefV3(legacy)).rejects.toThrow();
  });
});

describe("open Brief V3 冻結合同", () => {
  it("freezes cloned settings, revision, raw V2 canonical hash, world and existing start confirmation", async () => {
    const fixture = await openBriefFixture();
    const { input, content, brief } = fixture;
    const bytes = JSON.stringify(brief);
    expect(await parseTtrpgProductionBriefV3(bytes)).toEqual(brief);
    expect(brief.rulePackHash).toBe(await hashProductProductionValueV2(input.rulePack));
    expect(brief.settingsRevision).toBe(input.settingsRevision);
    expect(brief.startAuthorization.schema).toBe("storyforge.confirmed-product-brief");
    expect(brief.startAuthorization.sourcePlanHash).toBe(content.sourcePlan.planHash);
    input.settings.openingSituation = "输入已修改";
    input.rulePack.title = "输入规则已修改";
    input.sourcePlan.initialResourceKeys.push("unrelated");
    expect(JSON.stringify(brief)).toBe(bytes);
    expect(() => parseTtrpgProductionBriefV2(brief)).toThrow();
    const remapped = structuredClone(brief);
    remapped.worldReference.localReleaseRecordId += 100;
    remapped.sourcePlan.worldReference.localReleaseRecordId += 100;
    expect((await parseTtrpgProductionBriefV3(remapped)).startAuthorization).toEqual(brief.startAuthorization);
    expect(await db.productBuilds.count()).toBe(0);
  });

  it("rejects tampering, missing confirmation, mixed versions and stale goals", async () => {
    const { brief } = await openBriefFixture();
    const cases: Array<(value: Record<string, any>) => void> = [
      (v) => { v.extra = true; },
      (v) => { v.version = 2; },
      (v) => { v.runFormat = "scripted"; },
      (v) => { v.settingsRevision++; },
      (v) => { v.settingsRevision = -1; },
      (v) => { v.rulePackHash = "0".repeat(64); },
      (v) => { v.rulePack.title = "篡改规则"; },
      (v) => { v.rulePack.version = 1; },
      (v) => { v.settings.openingSituation = "变更目标"; },
      (v) => { v.settings.wizard.confirmAll = false; },
      (v) => { v.settings.openAuthoring.runtimePolicy = null; },
      (v) => { v.settings.openAuthoring.openingSituationKeys = ["missing"]; },
      (v) => { v.worldReference.releaseHash = "0".repeat(64); },
      (v) => { v.worldReference.extra = true; },
      (v) => { v.sourcePlan.permission.allowedAreas = []; },
      (v) => { delete v.startAuthorization; },
      (v) => { v.startAuthorization = null; },
      (v) => { v.startAuthorization.authorStartRevision = 0; },
      (v) => { v.startAuthorization.confirmedBy = "ai"; },
      (v) => { v.startAuthorization.productInstanceKey = "other-production"; },
    ];
    for (const change of cases) {
      const bad = structuredClone(brief);
      change(bad);
      await expect(parseTtrpgProductionBriefV3(bad)).rejects.toThrow();
    }
    const missingConfirmation = { ...brief, startAuthorization: { ...brief.startAuthorization, confirmedBy: "ai" } };
    const { confirmationHash: _, ...authBody } = missingConfirmation.startAuthorization;
    missingConfirmation.startAuthorization.confirmationHash = await hashProductProductionValueV2(authBody);
    await expect(parseTtrpgProductionBriefV3(missingConfirmation)).rejects.toThrow("作者明确开始");
  });

  it("rejects a different valid world and a different valid production confirmation", async () => {
    const { input, content, brief } = await openBriefFixture();
    const otherWorld = await createMistHarborWorld();
    const otherReference = await worldReferenceApi.createWorldReferenceV1(otherWorld.worldReleaseId);
    await expect(createTtrpgProductionBriefContentV3({ ...input, worldReference: otherReference })).rejects.toThrow("不一致");
    const otherPlan = { ...content.sourcePlan, productInstanceKey: "other-production" };
    const { planHash: _, ...planBody } = otherPlan;
    const { localReleaseRecordId: _locator, ...portableReference } = planBody.worldReference;
    otherPlan.planHash = await hashProductProductionValueV2({
      ...planBody, worldReference: portableReference,
    });
    const otherAuth = await createConfirmedProductBriefV1({
      productType: "ttrpg", productInstanceKey: otherPlan.productInstanceKey,
      sourcePlan: otherPlan, briefRevision: 1, authorStartRevision: 1,
      briefContentHash: brief.startAuthorization.briefContentHash,
    });
    await expect(createTtrpgProductionBriefV3({ content, startAuthorization: otherAuth })).rejects.toThrow();
    await expect(createTtrpgProductionBriefContentV3({ ...input, settings: openSettings() })).rejects.toThrow();
  });

  it("does not hide V2 or unconfirmed facts behind a saved-rule locator", async () => {
    const { input } = await openBriefFixture();
    input.settings.wizard.savedRulePackId = 999;
    const content = await createTtrpgProductionBriefContentV3(input);
    expect(content.settings.wizard.savedRulePackId).toBeNull();
    expect(input.settings.wizard.savedRulePackId).toBe(999);
    input.settings.openAuthoring.factPolicy[0].authorConfirmed = false;
    await expect(createTtrpgProductionBriefContentV3(input)).rejects.toThrow("作者确认");
  });
});

describe("open Brief V3 DB domain", () => {
  it.each(["hash", "path", "permission"] as const)("rejects forged source %s before saving a Brief or starting a Build", async mutation => {
    const fixture = await openDomainFixture();
    const settings = settingsFromTtrpgDraft(fixture.draft);
    if (!isTtrpgAuthoringSettingsV2(settings) || settings.runFormat !== "open") throw new Error("requires open Settings");
    const fact = settings.openAuthoring.factPolicy[0].fact;
    if (mutation === "hash") fact.sourceFieldRefs[0].contentHash = "0".repeat(64);
    else if (mutation === "path") fact.sourceFieldRefs[0].fieldPath = "missing.field";
    else {
      fact.sourceResourceRefs = ["world.unselected"];
      fact.sourceFieldRefs[0].resourceKey = "world.unselected";
    }
    const edited = await saveTtrpgDraft(fixture.request.scope, fixture.draft.revision, settings, "open");
    const before = await db.productProductions.get(fixture.production.id!);
    const briefs = await db.productProductionBriefs.where("productionId").equals(fixture.production.id!).toArray();
    const builds = await db.productBuilds.count();
    await expect(saveTtrpgOpenBriefV3({ ...fixture.request, revision: edited.revision, commandId: `forged.source.${mutation}` }))
      .rejects.toThrow(/来源|permission/);
    expect(await db.productProductions.get(fixture.production.id!)).toEqual(before);
    expect(await db.productProductionBriefs.where("productionId").equals(fixture.production.id!).toArray()).toEqual(briefs);
    expect(await db.productBuilds.count()).toBe(builds);
  });
  it("saves raw V3 through the public service, confirms start through authorize-start, and replays duplicates", async () => {
    const fixture = await openDomainFixture();
    const oldBrief = fixture.briefRow;
    const oldProduction = fixture.production;
    const saved = await saveTtrpgOpenBriefV3({
      ...fixture.request,
      commandId: "test.open.public.save",
    });
    const savedRow = await db.productProductionBriefs
      .where("[productionId+revision]")
      .equals([fixture.production.id!, oldBrief.revision + 1])
      .first();
    expect(savedRow?.status).toBe("draft");
    expect(savedRow?.briefHash).toBe(saved.candidate.contentHash);
    expect(JSON.parse(savedRow!.briefJson).schema).toBe("storyforge.ttrpg-production-brief");
    expect(JSON.parse(savedRow!.briefJson).startAuthorization).toBeUndefined();
    expect(await db.productProductionBriefs.get(oldBrief.id!)).toEqual(oldBrief);
    expect(await db.productProductions.get(oldProduction.id!)).toEqual({
      ...oldProduction,
      currentBriefRevision: oldBrief.revision + 1,
      status: "brief-ready",
      stateRevision: oldProduction.stateRevision + 1,
      updatedAt: expect.any(Number),
    });
    expect(await db.productBuilds.count()).toBe(0);

    const duplicateSave = await saveTtrpgOpenBriefV3({
      ...fixture.request,
      commandId: "test.open.public.save",
      candidate: saved.candidate,
    });
    expect(duplicateSave.receipt.replayed).toBe(true);
    expect(await db.productProductionBriefs.where("productionId").equals(fixture.production.id!).count()).toBe(2);

    const started = await startTtrpgOpenBriefV3({
      ...fixture.request,
      expectedStateRevision: saved.receipt.stateRevision,
      commandId: "test.open.public.start",
    });
    const authorizedRow = await db.productProductionBriefs.get(savedRow!.id!);
    expect(authorizedRow?.status).toBe("authorized");
    expect(authorizedRow?.confirmedBriefHash).toMatch(/^[a-f0-9]{64}$/);
    expect(started.receipt.stateRevision).toBe(saved.receipt.stateRevision + 1);
    expect(await db.productBuilds.count()).toBe(1);

    const duplicateStart = await startTtrpgOpenBriefV3({
      ...fixture.request,
      expectedStateRevision: saved.receipt.stateRevision,
      commandId: "test.open.public.start",
      candidate: started.candidate,
    });
    expect(duplicateStart.receipt.replayed).toBe(true);
    expect(await db.productBuilds.count()).toBe(1);
    const frozen = await verifyTtrpgOpenBriefV3({
      ...fixture.request,
      expectedStateRevision: started.receipt.stateRevision,
      expectedConfirmationHash: authorizedRow!.confirmedBriefHash,
    });
    expect(frozen.startAuthorization.confirmationHash).toBe(authorizedRow!.confirmedBriefHash);
  });

  it("keeps the governed records unchanged for stale and failed public saves", async () => {
    const fixture = await openDomainFixture();
    const beforeProduction = await db.productProductions.get(fixture.production.id!);
    const beforeBriefs = await db.productProductionBriefs.where("productionId")
      .equals(fixture.production.id!).toArray();
    await expect(saveTtrpgOpenBriefV3({
      ...fixture.request,
      expectedStateRevision: fixture.request.expectedStateRevision + 1,
      commandId: "test.open.stale",
    })).rejects.toThrow("production revision");
    expect(await db.productProductions.get(fixture.production.id!)).toEqual(beforeProduction);
    expect(await db.productProductionBriefs.where("productionId")
      .equals(fixture.production.id!).toArray()).toEqual(beforeBriefs);

    const candidate = await prepareTtrpgOpenBriefCandidateV3(fixture.request);
    const failed = await executeProductProductionCommand({
      scope: fixture.request.scope,
      productionId: fixture.production.id,
      preparedTtrpgOpenBrief: candidate,
      command: {
        type: "save-brief-revision",
        commandId: "test.open.rollback",
        expectedStateRevision: fixture.request.expectedStateRevision,
        parentRevision: candidate.briefRevision + 99,
        brief: candidate.content,
      },
    });
    expect(failed.ok).toBe(false);
    expect(failed.errorCode).toBe("production-state-conflict");
    expect(await db.productProductions.get(fixture.production.id!)).toEqual(beforeProduction);
    expect(await db.productProductionBriefs.where("productionId")
      .equals(fixture.production.id!).toArray()).toEqual(beforeBriefs);
  });

  it("builds a consumer-ready candidate from scoped DB state without rewriting the scripted Brief or starting a Build", async () => {
    const fixture = await openDomainFixture();
    const candidate = await prepareTtrpgOpenBriefCandidateV3(fixture.request);
    expect(candidate.content.settingsRevision).toBe(fixture.draft.revision);
    expect(candidate.content.rulePackHash).toBe(fixture.rule.contentHash);
    expect(candidate.content.worldReference.localReleaseRecordId).toBe(fixture.draft.worldReleaseId);
    expect(candidate.content.sourcePlan).toEqual(JSON.parse(fixture.briefRow.sourcePlanJson));
    expect(candidate.contentHash).toBe(await hashTtrpgProductionBriefContentV3(candidate.content));
    expect(candidate.content.settings.wizard.savedRulePackId).toBeNull();
    expect(await db.productProductionBriefs.get(fixture.briefRow.id!)).toEqual(fixture.briefRow);
    expect(await readTtrpgDraft(fixture.made.scope)).toEqual(fixture.draft);
    expect(await db.productProductions.get(fixture.production.id!)).toEqual(fixture.production);
    expect(await db.productBuilds.count()).toBe(0);
    await expect(verifyTtrpgOpenBriefV3({
      ...fixture.request, expectedConfirmationHash: "a".repeat(64),
    })).rejects.toThrow("开始确认");
  });

  it("consumes a stored shared start confirmation for the exact open snapshot without producing new records", async () => {
    const fixture = await confirmedOpenDomainFixture();
    const beforeDraft = await readTtrpgDraft(fixture.made.scope);
    const beforeRow = await db.productProductionBriefs.get(fixture.briefId);
    const beforeProduction = await db.productProductions.get(fixture.production.id!);
    const frozen = await verifyTtrpgOpenBriefV3(fixture.request);
    expect(frozen.startAuthorization).toEqual(fixture.confirmation);
    expect(frozen.settingsRevision).toBe(fixture.draft.revision);
    expect(await parseTtrpgProductionBriefV3(JSON.stringify(frozen))).toEqual(frozen);
    expect(await readTtrpgDraft(fixture.made.scope)).toEqual(beforeDraft);
    expect(await db.productProductionBriefs.get(fixture.briefId)).toEqual(beforeRow);
    expect(await db.productProductionBriefs.get(fixture.briefRow.id!)).toEqual(fixture.briefRow);
    expect(await db.productProductions.get(fixture.production.id!)).toEqual(beforeProduction);
    expect(await db.productBuilds.count()).toBe(1);
  });

  it("rejects wrong scope and cross-owner production/Brief records", async () => {
    const fixture = await openDomainFixture();
    const other = await createTtrpgDraft("other");
    await expect(prepareTtrpgOpenBriefCandidateV3({
      ...fixture.request, scope: { ...fixture.request.scope, workId: other.scope.workId },
    })).rejects.toThrow();
    await db.productProductions.update(fixture.production.id!, { workId: other.scope.workId });
    await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow("不属于当前作品");
    await db.productProductions.update(fixture.production.id!, { workId: fixture.made.scope.workId });
    await db.productProductionBriefs.update(fixture.briefRow.id!, { workId: other.scope.workId });
    await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow("SourcePlan");
    expect(await readTtrpgDraft(fixture.made.scope)).toEqual(fixture.draft);
  });

  it("rejects a stale selected world, a foreign world locator, and corrupted frozen world bytes", async () => {
    const fixture = await openDomainFixture();
    const selected = await db.worldReleases.get(fixture.draft.worldReleaseId!);
    await db.ttrpgAuthoringDrafts.update(fixture.draft.id!, { worldReleaseId: fixture.world.worldReleaseId });
    await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow("ID、scope 与冻结 hash");
    await db.ttrpgAuthoringDrafts.update(fixture.draft.id!, { worldReleaseId: fixture.draft.worldReleaseId });
    await db.worldReleases.update(selected!.id!, { contentHash: "0".repeat(64) });
    await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow();
    await db.worldReleases.put(selected!);
    const revision = await createWorldRevision({ scope: fixture.world.scope, label: "新的世界版本" });
    const other = await publishWorldRevision(revision.id!);
    const changed = await selectTtrpgWorld(fixture.made.scope, fixture.draft.revision, other.id!);
    expect(changed.worldReleaseId).not.toBe(fixture.draft.worldReleaseId);
    await expect(prepareTtrpgOpenBriefCandidateV3({
      ...fixture.request, revision: changed.revision,
    })).rejects.toThrow("stale");
    expect(await db.productProductionBriefs.get(fixture.briefRow.id!)).toEqual(fixture.briefRow);
  });

  it("rejects stale Settings/production revisions and rejects legacy/scripted settings at the new domain entry", async () => {
    const fixture = await openDomainFixture();
    await expect(prepareTtrpgOpenBriefCandidateV3({
      ...fixture.request, revision: fixture.request.revision - 1,
    })).rejects.toThrow("Settings revision");
    await expect(prepareTtrpgOpenBriefCandidateV3({
      ...fixture.request, expectedStateRevision: fixture.request.expectedStateRevision + 1,
    })).rejects.toThrow("production revision");
    const scripted = await saveTtrpgDraft(fixture.made.scope, fixture.draft.revision, defaultTtrpgSettingsV2(), "scripted");
    await expect(prepareTtrpgOpenBriefCandidateV3({
      ...fixture.request, revision: scripted.revision,
    })).rejects.toThrow("Settings V2/open");
    expect(await db.productBuilds.count()).toBe(0);
  });

  it("rejects a world changed between provider verification and the consistent DB snapshot", async () => {
    const fixture = await openDomainFixture();
    const original = worldReferenceApi.createWorldReferenceV1;
    const provider = vi.spyOn(worldReferenceApi, "createWorldReferenceV1").mockImplementationOnce(async (id) => {
      const reference = await original(id);
      await db.worldReleases.update(id, { contentHash: "0".repeat(64) });
      return reference;
    });
    try {
      await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow("ID、scope 与冻结 hash");
      expect(provider).toHaveBeenCalledWith(fixture.draft.worldReleaseId);
      expect(await readTtrpgDraft(fixture.made.scope)).toEqual(fixture.draft);
      expect(await db.productProductionBriefs.get(fixture.briefRow.id!)).toEqual(fixture.briefRow);
      expect(await db.productBuilds.count()).toBe(0);
    } finally {
      provider.mockRestore();
    }
  });

  it("rejects cross-owner, unvalidated and hash-corrupted rule locators, plus unsaved house-rule overrides", async () => {
    const fixture = await openDomainFixture();
    const other = await createTtrpgDraft("other");
    const foreign = await saveTtrpgRulePackV2({ scope: other.scope, rulePack: openRule() });
    await db.ttrpgAuthoringDrafts.update(fixture.draft.id!, { savedRulePackId: foreign.id });
    await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow();
    await db.ttrpgAuthoringDrafts.update(fixture.draft.id!, { savedRulePackId: fixture.rule.id });
    await db.ttrpgRulePacks.update(fixture.rule.id!, { status: "draft" });
    await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow("validated");
    await db.ttrpgRulePacks.update(fixture.rule.id!, { status: "validated", contentHash: "0".repeat(64) });
    await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow("contentHash");
    await db.ttrpgRulePacks.put(fixture.rule);
    const settings = settingsFromTtrpgDraft(fixture.draft);
    settings.wizard.actionsPerTurn = 99;
    const edited = await saveTtrpgDraft(fixture.made.scope, fixture.draft.revision, settings, "pending overlay");
    await expect(prepareTtrpgOpenBriefCandidateV3({
      ...fixture.request, revision: edited.revision,
    })).rejects.toThrow("村规修改");
  });

  it("rejects a SourcePlan from a different production even when its canonical hash is valid", async () => {
    const fixture = await openDomainFixture();
    const plan = JSON.parse(fixture.briefRow.sourcePlanJson) as ProductSourcePlanV1;
    const { planHash: _hash, ...body } = plan;
    const { localReleaseRecordId: _locator, ...worldReference } = plan.worldReference;
    const different = { ...plan, productInstanceKey: "other-production" };
    different.planHash = await hashProductProductionValueV2({
      ...body, productInstanceKey: different.productInstanceKey, worldReference,
    });
    await db.productProductionBriefs.update(fixture.briefRow.id!, {
      sourcePlanJson: JSON.stringify(different), sourcePlanHash: different.planHash,
    });
    await expect(prepareTtrpgOpenBriefCandidateV3(fixture.request)).rejects.toThrow("当前 production");
    expect(await db.productBuilds.count()).toBe(0);
  });

  it("rejects mismatched expected/stored confirmation hashes and a rehashed confirmation for other content", async () => {
    const fixture = await confirmedOpenDomainFixture();
    await expect(verifyTtrpgOpenBriefV3({
      ...fixture.request, expectedConfirmationHash: "0".repeat(64),
    })).rejects.toThrow("confirmed hash");
    await db.productProductionBriefs.update(fixture.briefId, {
      confirmedBriefJson: JSON.stringify({ ...fixture.confirmation, briefContentHash: "0".repeat(64) }),
    });
    await expect(verifyTtrpgOpenBriefV3(fixture.request)).rejects.toThrow();
    const other = await createConfirmedProductBriefV1({
      productType: "ttrpg", productInstanceKey: fixture.production.productionKey,
      sourcePlan: fixture.candidate.content.sourcePlan, briefRevision: fixture.confirmation.briefRevision,
      authorStartRevision: fixture.confirmation.authorStartRevision, confirmedAt: fixture.confirmation.confirmedAt,
      briefContentHash: "0".repeat(64),
    });
    await db.productProductionBriefs.update(fixture.briefId, {
      confirmedBriefJson: JSON.stringify(other), confirmedBriefHash: other.confirmationHash,
    });
    await expect(verifyTtrpgOpenBriefV3({
      ...fixture.request, expectedConfirmationHash: other.confirmationHash,
    })).rejects.toThrow("未绑定此 Brief");
  });

  it("rejects persisted content drift and revoked start evidence after successful verification", async () => {
    const fixture = await confirmedOpenDomainFixture();
    await verifyTtrpgOpenBriefV3(fixture.request);
    const row = (await db.productProductionBriefs.get(fixture.briefId))!;
    const content = JSON.parse(row.briefJson);
    content.settings.playerRole = "被悄悄修改的身份";
    await db.productProductionBriefs.update(fixture.briefId, { briefJson: JSON.stringify(content) });
    await expect(verifyTtrpgOpenBriefV3(fixture.request)).rejects.toThrow("已保存内容");
    await db.productProductionBriefs.put({ ...row, status: "withdrawn" });
    await expect(verifyTtrpgOpenBriefV3(fixture.request)).rejects.toThrow("有效的世界 SourcePlan");
    expect(await db.productBuilds.count()).toBe(1);
  });
});
