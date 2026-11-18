import { beforeEach, afterEach, expect, it } from "vitest";
import { db } from "../../src/lib/db/schema";
import {
  createAvgDraftV1,
  readAvgDraftV1,
  saveAvgDraftV1,
  selectAvgWorldV1,
} from "../../src/lib/avg/draft-service";
import {
  DEFAULT_AVG_SETTINGS,
  parseAvgAuthoringSettingsV1,
} from "../../src/lib/avg/authoring-contract";
import { createMistHarborWorld } from "../../src/lib/world-engine/mist-harbor-preset";
import {
  exportProjectJSON,
  importProjectJSON,
} from "../../src/lib/export/json-export";
import { deleteWork } from "../../src/lib/workspace/lifecycle";
import { avgCueTimeline } from "../../src/lib/avg/cue-timeline";
beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => db.close());
it("keeps a pre-world AVG draft, rejects stale writes, and roundtrips a frozen source without copying mutable canon", async () => {
  const avg = await createAvgDraftV1("我的 AVG");
  let draft = await readAvgDraftV1(avg.scope);
  expect(avg.work.kind).toBe("avg");
  expect(draft.worldReleaseId).toBeNull();
  draft = await saveAvgDraftV1(avg.scope, 0, {
    ...DEFAULT_AVG_SETTINGS,
    playerRole: "守灯人",
  });
  await expect(
    saveAvgDraftV1(avg.scope, 0, DEFAULT_AVG_SETTINGS),
  ).rejects.toThrow("其他页面");
  const source = await createMistHarborWorld();
  draft = await selectAvgWorldV1(
    avg.scope,
    draft.revision,
    source.worldReleaseId,
  );
  const frozen = await db.worldReleases.get(draft.worldReleaseId!);
  expect(frozen?.releaseUid).toBe(
    (await db.worldReleases.get(source.worldReleaseId))?.releaseUid,
  );
  expect(frozen?.projectId).toBe(avg.scope.projectId);
  expect(
    await db.characters.where("projectId").equals(avg.scope.projectId).count(),
  ).toBe(0);
  const exported = await exportProjectJSON(avg.scope.projectId);
  const imported = await importProjectJSON(exported);
  const restored = await db.avgAuthoringDrafts
    .where("projectId")
    .equals(imported)
    .first();
  expect(restored?.workId).not.toBe(avg.scope.workId);
  expect(
    (await db.worldReleases.get(restored!.worldReleaseId!))?.releaseUid,
  ).toBe(frozen?.releaseUid);
  expect(JSON.parse(restored!.settingsJson).playerRole).toBe("守灯人");
  await deleteWork(restored!.workId);
  expect(
    await db.avgAuthoringDrafts.where("projectId").equals(imported).count(),
  ).toBe(0);
  expect(await db.worldReleases.get(source.worldReleaseId)).toBeDefined();
});
it("rejects invalid settings and tampered source without changing the selected reference", async () => {
  expect(() =>
    parseAvgAuthoringSettingsV1({
      ...DEFAULT_AVG_SETTINGS,
      targetEndingCount: 9,
    }),
  ).toThrow();
  const avg = await createAvgDraftV1("异常反例");
  const source = await createMistHarborWorld();
  await db.worldReleases.update(source.worldReleaseId, {
    contentHash: "a".repeat(64),
  });
  await expect(
    selectAvgWorldV1(avg.scope, 0, source.worldReleaseId),
  ).rejects.toThrow();
  expect((await readAvgDraftV1(avg.scope)).worldReleaseId).toBeNull();
});
it("schedules waits cumulatively and keeps after cues out of the unfinished dialogue", () => {
  const base = {
    beatKey: "b",
    durationMs: 0,
    easing: "linear" as const,
    order: 0,
  };
  const cues = [
    {
      ...base,
      cueKey: "wait",
      type: "wait" as const,
      phase: "before" as const,
      durationMs: 2000,
    },
    {
      ...base,
      cueKey: "bg",
      type: "set-background" as const,
      phase: "during" as const,
    },
    {
      ...base,
      cueKey: "after",
      type: "clear-background" as const,
      phase: "after" as const,
    },
  ];
  expect(
    avgCueTimeline(cues, false).entries.map((x) => [x.cue.cueKey, x.at]),
  ).toEqual([
    ["wait", 0],
    ["bg", 2000],
  ]);
  expect(avgCueTimeline(cues, true).entries.map((x) => x.cue.cueKey)).toEqual([
    "after",
  ]);
});
it('protects uploaded draft media across backup, scope checks and Work deletion',async()=>{
 const {importAvgMediaV1,readAvgDraftMediaV1}=await import('../../src/lib/avg/editor-service')
 const avg=await createAvgDraftV1('上传素材');const other=await createAvgDraftV1('另一个作品')
 const data=new Uint8Array([137,80,78,71]).buffer
 const asset=await importAvgMediaV1({scope:avg.scope,data,mimeType:'image/png',name:'测试背景',kind:'background',license:'测试自有',altText:'测试',characterTag:''})
 expect(new Uint8Array(await readAvgDraftMediaV1(avg.scope,asset))).toEqual(new Uint8Array(data))
 await expect(readAvgDraftMediaV1(other.scope,asset)).rejects.toThrow('不属于')
 const id=await importProjectJSON(await exportProjectJSON(avg.scope.projectId));const draft=await db.avgAuthoringDrafts.where('projectId').equals(id).first()
 const scope={projectId:id,worldId:draft!.worldId,workId:draft!.workId}
 expect(new Uint8Array(await readAvgDraftMediaV1(scope,asset))).toEqual(new Uint8Array(data))
 await deleteWork(scope.workId);expect(await db.avgDraftMedia.where('workId').equals(scope.workId).count()).toBe(0)
 expect(await db.avgDraftMedia.where('workId').equals(avg.scope.workId).count()).toBe(1)
})
