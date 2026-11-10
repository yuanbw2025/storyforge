import { db } from "../db/schema";
import {
  createWorkspace,
  workspaceCreationTransactionTablesV1,
} from "../workspace/create-workspace";
import {
  resolveScope,
  assertRecordInScope,
  scopeTransactionTables,
  stampNewRecord,
} from "../workspace/scope";
import { updateWorkTitle } from "../workspace/works";
import { cacheWorldReferenceForProductV1 } from "../world-engine/reference-cache";
import type { WorkspaceScope } from "../types";
import {
  defaultAiTownSettings,
  serializeAiTownSettings,
  settingsFromAiTownDraft,
  parseAiTownSettings,
  type AiTownAuthoringSettingsV1,
  type AiTownAuthoringDraftV1,
} from "./authoring-contract";
export async function createAiTownDraft(
  title: string,
  settings = defaultAiTownSettings(),
) {
  if (!title.trim() || title.length > 200)
    throw new Error("请填写 1～200 字的小镇名称");
  const serialized = serializeAiTownSettings(settings);
  return db.transaction(
    "rw",
    [...workspaceCreationTransactionTablesV1(), db.aiTownAuthoringDrafts],
    async () => {
      const created = await createWorkspace(
        {
          name: title.trim(),
          description: "",
          genres: [],
          status: "drafting",
          targetWordCount: 10000,
        },
        { kind: "ai-town" },
      );
      const now = Date.now();
      await db.aiTownAuthoringDrafts.add(
        stampNewRecord(
          created.scope,
          "aiTownAuthoringDrafts",
          {
            ...created.scope,
            ...serialized,
            conversationJson: "[]",
            revision: 0,
            worldReleaseId: null,
            productionId: null,
            selectionJson: null,
            suggestionKey: null,
            preparedRevision: null,
            createdAt: now,
            updatedAt: now,
          },
          { owner: "work" },
        ),
      );
      return created;
    },
  );
}
export async function readAiTownDraft(input: WorkspaceScope) {
  const scope = await resolveScope({ scope: input });
  const row = await db.aiTownAuthoringDrafts
    .where("workId")
    .equals(scope.workId)
    .first();
  if (
    !row ||
    !(await assertRecordInScope(scope, "aiTownAuthoringDrafts", row, {
      owner: "work",
    }))
  )
    throw new Error("小镇方案不存在或不属于当前作品");
  settingsFromAiTownDraft(row);
  return row;
}
export async function saveAiTownDraft(
  scope: WorkspaceScope,
  revision: number,
  settings: AiTownAuthoringSettingsV1,
  title: string,
  options?: { expectedWorkTitle: string },
) {
  const capturedScope = { ...scope };
  const expectedWorkTitle = options?.expectedWorkTitle;
  if (options && typeof expectedWorkTitle !== "string")
    throw new Error("缺少本次编辑时载入的作品名称");
  if (!title.trim() || title.length > 200)
    throw new Error("请填写 1～200 字的小镇名称");
  const data = serializeAiTownSettings(settings);
  return db.transaction(
    "rw",
    scopeTransactionTables(db.aiTownAuthoringDrafts),
    async () => {
      const row = await readAiTownDraft(capturedScope);
      if (row.revision !== revision)
        throw new Error("方案已在其他页面修改，请刷新后再保存");
      if (expectedWorkTitle !== undefined) {
        const work = await db.works.get(capturedScope.workId);
        if (!work || work.title !== expectedWorkTitle)
          throw new Error("作品名称已在其他页面修改，请先比较并确认本地输入后再保存");
      }
      const next = {
        ...row,
        ...data,
        revision: revision + 1,
        preparedRevision: null,
        updatedAt: Date.now(),
      };
      await db.aiTownAuthoringDrafts.put(next);
      await updateWorkTitle(capturedScope, title);
      return next;
    },
  );
}
export async function selectAiTownWorld(
  scope: WorkspaceScope,
  revision: number,
  releaseId: number,
) {
  const row = await readAiTownDraft(scope);
  if (row.revision !== revision) throw new Error("方案已变化，请重新选择");
  const localId = await cacheWorldReferenceForProductV1(scope, releaseId);
  return db.transaction(
    "rw",
    scopeTransactionTables(db.aiTownAuthoringDrafts),
    async () => {
      const latest = await readAiTownDraft(scope);
      if (latest.revision !== revision)
        throw new Error("方案已变化，请重新选择");
      const next = {
        ...latest,
        worldReleaseId: localId,
        selectionJson: null,
        suggestionKey: null,
        preparedRevision: null,
        revision: revision + 1,
        updatedAt: Date.now(),
      };
      await db.aiTownAuthoringDrafts.put(next);
      return next;
    },
  );
}

export async function saveAiTownSourceSelection(
  scope: WorkspaceScope,
  revision: number,
  suggestionKey: string,
  selection: import("../types").ProductProductionSourceSelectionV1,
) {
  const row = await readAiTownDraft(scope);
  if (!row.worldReleaseId) throw new Error("请选择世界版本");
  const { consultProductProductionStartV1 } = await import(
    "../product-production/service"
  );
  const catalog = await consultProductProductionStartV1({
    scope,
    worldReleaseId: row.worldReleaseId,
  });
  if (!catalog.suggestions.some((s) => s.suggestionKey === suggestionKey))
    throw new Error("起点不属于此世界");
  const pairs = [
    ["storyResourceKeys", "storySources"],
    ["characterResourceKeys", "characters"],
    ["importantLocationResourceKeys", "importantLocations"],
    ["artifactResourceKeys", "artifacts"],
    ["codexEntryResourceKeys", "codexEntries"],
    ["storyArcResourceKeys", "storyArcs"],
  ] as const;
  for (const [key, field] of pairs) {
    if (
      !Array.isArray(selection[key]) ||
      selection[key].some(
        (v) => !catalog.sourceOptions[field].some((o) => o.resourceKey === v),
      )
    )
      throw new Error("选择了世界出口之外的资源");
  }
  return db.transaction(
    "rw",
    scopeTransactionTables(db.aiTownAuthoringDrafts),
    async () => {
      const current = await readAiTownDraft(scope);
      if (current.revision !== revision)
        throw new Error("方案已变化，请重新选择");
      const next = {
        ...current,
        suggestionKey,
        selectionJson: JSON.stringify(selection),
        preparedRevision: null,
        revision: revision + 1,
        updatedAt: Date.now(),
      };
      await db.aiTownAuthoringDrafts.put(next);
      return next;
    },
  );
}

export function prepareAiTownBrief(scope: WorkspaceScope, revision: number): Promise<number>;
export function prepareAiTownBrief(
  scope: WorkspaceScope,
  revision: number,
  options: { includeSavedDraft: true },
): Promise<{ productionId: number; draft: AiTownAuthoringDraftV1 }>;
export async function prepareAiTownBrief(
  scope: WorkspaceScope,
  revision: number,
  options?: { includeSavedDraft: true },
) {
  const includeSavedDraft = options?.includeSavedDraft === true;
  const {
    consultProductProductionStartV1,
    compileProductProductionBriefV3,
    createProductProductionWithBriefV1,
    readProductProductionDetailsV1,
  } = await import("../product-production/service");
  const { executeProductProductionCommand } = await import(
    "../product-production/commands"
  );
  const row = await readAiTownDraft(scope);
  if (row.revision !== revision) throw new Error("方案已变化，请刷新");
  if (!row.worldReleaseId) throw new Error("开始制作，需要一个世界引擎");
  const settings = settingsFromAiTownDraft(row);
  const sources = await consultProductProductionStartV1({
    scope,
    worldReleaseId: row.worldReleaseId,
  });
  const suggestion =
    sources.suggestions.find((s) => s.suggestionKey === row.suggestionKey) ??
    sources.suggestions.find((s) =>
      s.recommendedProductTypes.includes("ai-town"),
    ) ??
    sources.suggestions[0];
  if (!suggestion) throw new Error("世界没有可用起点");
  const selection = row.selectionJson
    ? JSON.parse(row.selectionJson)
    : sources.selectionDefaults[suggestion.suggestionKey];
  const work = await db.works.get(scope.workId);
  if (!work) throw new Error("作品不存在");
  const brief = await compileProductProductionBriefV3({
    scope,
    worldReleaseId: row.worldReleaseId,
    suggestionKey: suggestion.suggestionKey,
    productType: "ai-town",
    qualityProfile: settings.qualityProfile,
    scale: "short-arc",
    visualLevel: settings.town.portraits || settings.town.locationCards ? "key-scenes" : "none",
    audioLevel: settings.town.ambientAudio ? "music-sfx" : "none",
    playerRole: settings.town.playerName || "新居民",
    openingSituation: settings.openingSituation || suggestion.openingConflict,
    aiTown: {...settings.town, townTitle:work.title},
    sourceSelection: selection,
  });
  if ((await readAiTownDraft(scope)).revision !== revision)
    throw new Error("编译期间方案已变化，请重新生成");
  let id = row.productionId;
  const prior = id
    ? await readProductProductionDetailsV1(scope, id, ["ai-town"])
    : null;
  if (
    prior &&
    !prior.build &&
    prior.brief?.sourceWorldReleaseId === row.worldReleaseId
  ) {
    const receipt = await executeProductProductionCommand({
      scope,
      productionId: id!,
      command: {
        type: "save-brief-revision",
        commandId: crypto.randomUUID(),
        expectedStateRevision: prior.production.stateRevision,
        parentRevision: prior.production.currentBriefRevision,
        brief,
      },
    });
    if (!receipt.ok)
      throw new Error(String(receipt.result.message ?? "方案保存失败"));
  } else {
    id = await createProductProductionWithBriefV1({
      scope,
      worldReleaseId: row.worldReleaseId,
      title: work.title,
      brief,
    });
  }
  const savedDraft = await db.transaction(
    "rw",
    scopeTransactionTables(db.aiTownAuthoringDrafts),
    async () => {
      const latest = await readAiTownDraft(scope);
      if (latest.revision !== revision)
        throw new Error("方案已变化，已编译版本保留在制作记录中，请重新核对");
      const next: AiTownAuthoringDraftV1 = {
        ...latest,
        productionId: id!,
        preparedRevision: revision + 1,
        revision: revision + 1,
        updatedAt: Date.now(),
      };
      await db.aiTownAuthoringDrafts.put(next);
      return next;
    },
  );
  return includeSavedDraft ? { productionId: id!, draft: savedDraft } : id!;
}

export interface AiTownConversationTurnV1 {
  archived?:boolean
  id: string;
  question: string;
  answer: string;
  settings: AiTownAuthoringSettingsV1 | null;
  runId: number | null;
  error: string;
  createdAt: number;
}
export async function saveAiTownConversationV1(
  scope: WorkspaceScope,
  revision: number,
  turn: AiTownConversationTurnV1,
) {
  if (turn.question.length > 5000 || turn.answer.length > 12000)
    throw new Error("AI 小镇 会谈内容过长");
  if (turn.settings) parseAiTownSettings(turn.settings);
  return db.transaction(
    "rw",
    scopeTransactionTables(db.aiTownAuthoringDrafts),
    async () => {
      const row = await readAiTownDraft(scope);
      if (row.revision !== revision)
        throw new Error("方案已变化，候选保留在任务记录中，请重新对照当前方案");
      const history = JSON.parse(
        row.conversationJson,
      ) as AiTownConversationTurnV1[];
      const next = {
        ...row,
        conversationJson: JSON.stringify([
          ...history.filter((t) => t.id !== turn.id),
          turn,
        ]),
        revision: revision + 1,
        updatedAt: Date.now(),
      };
      await db.aiTownAuthoringDrafts.put(next);
      return next;
    },
  );
}

/** Add an AI 小镇 authoring draft to a pre-existing AI 小镇 production without moving its Work. */

export async function archiveAiTownConversationV1(scope:WorkspaceScope,revision:number){
 return db.transaction('rw',scopeTransactionTables(db.aiTownAuthoringDrafts),async()=>{const row=await readAiTownDraft(scope);if(row.revision!==revision)throw new Error('会谈已变化，请刷新后重试');const turns=JSON.parse(row.conversationJson) as AiTownConversationTurnV1[];await db.aiTownAuthoringDrafts.put({...row,conversationJson:JSON.stringify(turns.map(t=>({...t,archived:true}))),revision:revision+1,updatedAt:Date.now()})})
}
