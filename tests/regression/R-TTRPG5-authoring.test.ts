import { beforeEach, afterEach, it, expect } from "vitest";
import { db } from "../../src/lib/db/schema";
import {
  createTtrpgDraft,
  readTtrpgDraft,
  saveTtrpgDraft,
  selectTtrpgWorld,
  prepareTtrpgBrief,
} from "../../src/lib/ttrpg/authoring-service";
import {
  defaultTtrpgSettings,
  settingsFromTtrpgDraft,
} from "../../src/lib/ttrpg/authoring-contract";
import { createMistHarborWorld } from "../../src/lib/world-engine/mist-harbor-preset";
import {
  exportProjectJSON,
  importProjectJSON,
} from "../../src/lib/export/json-export";
import { deleteWork } from "../../src/lib/workspace/lifecycle";
beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => db.close());
it("persists an independent pre-world draft, rejects stale/cross-work writes and roundtrips without mutating source canon", async () => {
  const made = await createTtrpgDraft("我的战役");
  let draft = await readTtrpgDraft(made.scope);
  expect(made.work.kind).toBe("ttrpg");
  expect(draft.worldReleaseId).toBeNull();
  const settings = defaultTtrpgSettings();
  settings.wizard.coreConflict = "港口失踪案";
  settings.wizard.seats[0].sourceCharacterResourceKey = "world.character.test";
  draft = await saveTtrpgDraft(made.scope, 0, settings, "新标题");
  await expect(saveTtrpgDraft(made.scope, 0, settings, "冲突")).rejects.toThrow(
    "其他页面",
  );
  const other = await createTtrpgDraft("另一部");
  await expect(
    readTtrpgDraft({ ...made.scope, workId: other.scope.workId }),
  ).rejects.toThrow();
  const world = await createMistHarborWorld();
  const original = await db.worldReleases.get(world.worldReleaseId);
  draft = await selectTtrpgWorld(
    made.scope,
    draft.revision,
    world.worldReleaseId,
  );
  const copy = await importProjectJSON(
    await exportProjectJSON(made.scope.projectId),
  );
  const restored = await db.ttrpgAuthoringDrafts
    .where("projectId")
    .equals(copy)
    .first();
  expect(restored?.workId).not.toBe(made.scope.workId);
  expect(settingsFromTtrpgDraft(restored!).wizard.coreConflict).toBe(
    "港口失踪案",
  );
  expect(
    (await db.worldReleases.get(restored!.worldReleaseId!))?.releaseUid,
  ).toBe(original?.releaseUid);
  await deleteWork(restored!.workId);
  expect(
    await db.ttrpgAuthoringDrafts.where("projectId").equals(copy).count(),
  ).toBe(0);
  expect(await db.worldReleases.get(world.worldReleaseId)).toEqual(original);
});
it("compiles the saved nine-step configuration into a governed draft without starting a Build", async () => {
  const settings = defaultTtrpgSettings();
  settings.wizard.confirmAll = true;
  settings.wizard.coreConflict = "无法投递的信";
  settings.openingSituation = "在旧邮局找出寄信人";
  settings.wizard.maximumGeneratedAssets = 0;
  for (const key of [
    "sceneImages",
    "characterPortraits",
    "characterExpressions",
    "itemIcons",
    "handouts",
    "maps",
    "tokens",
  ] as const)
    settings.wizard[key] = false;
  const made = await createTtrpgDraft("邮局调查", settings);
  await expect(prepareTtrpgBrief(made.scope, 0)).rejects.toThrow("世界引擎");
  const world = await createMistHarborWorld();
  const draft = await selectTtrpgWorld(made.scope, 0, world.worldReleaseId);
  const id = await prepareTtrpgBrief(made.scope, draft.revision);
  const prepared = await readTtrpgDraft(made.scope);
  expect(prepared.productionId).toBe(id);
  expect(prepared.preparedRevision).toBe(prepared.revision);
  expect(await db.productBuilds.count()).toBe(0);
  const brief = await db.productProductionBriefs
    .where("productionId")
    .equals(id)
    .first();
  expect(JSON.parse(brief!.briefJson).ttrpg.campaign.coreConflict).toBe(
    "无法投递的信",
  );
  const changed = await saveTtrpgDraft(
    made.scope,
    prepared.revision,
    { ...settings, openingSituation: "新的开场" },
    "邮局调查",
  );
  expect(changed.preparedRevision).toBeNull();
  expect(await prepareTtrpgBrief(made.scope, changed.revision)).toBe(id);
  expect(await db.productBuilds.count()).toBe(0);
});
it("rejects a tampered world while preserving the prior choice", async () => {
  const made = await createTtrpgDraft("反例");
  const world = await createMistHarborWorld();
  await db.worldReleases.update(world.worldReleaseId, {
    contentHash: "a".repeat(64),
  });
  await expect(
    selectTtrpgWorld(made.scope, 0, world.worldReleaseId),
  ).rejects.toThrow();
  expect((await readTtrpgDraft(made.scope)).worldReleaseId).toBeNull();
});
