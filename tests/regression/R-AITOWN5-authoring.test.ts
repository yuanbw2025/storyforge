import { beforeEach, afterEach, it, expect } from "vitest";
import { db } from "../../src/lib/db/schema";
import {
  createAiTownDraft,
  readAiTownDraft,
  saveAiTownDraft,
  selectAiTownWorld,
  prepareAiTownBrief,
} from "../../src/lib/ai-town/authoring-service";
import {
  defaultAiTownSettings,
  settingsFromAiTownDraft,
} from "../../src/lib/ai-town/authoring-contract";
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
  const made = await createAiTownDraft("我的战役");
  let draft = await readAiTownDraft(made.scope);
  expect(made.work.kind).toBe("ai-town");
  expect(draft.worldReleaseId).toBeNull();
  const settings = defaultAiTownSettings();
  settings.town.sharedProjectConcept = "修复旧茶屋";

  draft = await saveAiTownDraft(made.scope, 0, settings, "新标题");
  await expect(saveAiTownDraft(made.scope, 0, settings, "冲突")).rejects.toThrow(
    "其他页面",
  );
  const other = await createAiTownDraft("另一部");
  await expect(
    readAiTownDraft({ ...made.scope, workId: other.scope.workId }),
  ).rejects.toThrow();
  const world = await createMistHarborWorld();
  const original = await db.worldReleases.get(world.worldReleaseId);
  draft = await selectAiTownWorld(
    made.scope,
    draft.revision,
    world.worldReleaseId,
  );
  const copy = await importProjectJSON(
    await exportProjectJSON(made.scope.projectId),
  );
  const restored = await db.aiTownAuthoringDrafts
    .where("projectId")
    .equals(copy)
    .first();
  expect(restored?.workId).not.toBe(made.scope.workId);
  expect(settingsFromAiTownDraft(restored!).town.sharedProjectConcept).toBe(
    "修复旧茶屋",
  );
  expect(
    (await db.worldReleases.get(restored!.worldReleaseId!))?.releaseUid,
  ).toBe(original?.releaseUid);
  await deleteWork(restored!.workId);
  expect(
    await db.aiTownAuthoringDrafts.where("projectId").equals(copy).count(),
  ).toBe(0);
  expect(await db.worldReleases.get(world.worldReleaseId)).toEqual(original);
});

it('requires a world and persists a validated town Brief without starting production',async()=>{
 const {seedCurrentProductWorld}=await import('../helpers/current-product-world');
 const settings=defaultAiTownSettings();settings.town.residentTarget=4;settings.openingSituation='结局之后共同修复旧茶屋';
 const made=await createAiTownDraft('茶屋小镇',settings);
 await expect(prepareAiTownBrief(made.scope,0)).rejects.toThrow('世界引擎');
 const source=await seedCurrentProductWorld('小镇来源',{minimumCharacters:4});
 const original=await db.worldReleases.get(source.release.id!);
 const d=await selectAiTownWorld(made.scope,0,source.release.id!);
 const id=await prepareAiTownBrief(made.scope,d.revision);
 const brief=await db.productProductionBriefs.where('productionId').equals(id).first();
 expect(JSON.parse(brief!.briefJson).aiTown.town.residentTarget).toBe(4);
 expect(await db.productBuilds.count()).toBe(0);
 expect(await db.worldReleases.get(source.release.id!)).toEqual(original);
 const saved=await readAiTownDraft(made.scope);
 await saveAiTownDraft(made.scope,saved.revision,{...settings,openingSituation:'新生活愿景'},'茶屋小镇');
 expect((await readAiTownDraft(made.scope)).preparedRevision).toBeNull();
});
