import {updateWorkTitle} from "../workspace/works";
import { db } from "../db/schema";
import type { WorkspaceScope } from "../types";
import {
  createWorkspace,
  workspaceCreationTransactionTablesV1,
} from "../workspace/create-workspace";
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from "../workspace/scope";
import { cacheWorldReferenceForProductV1 } from "../world-engine/reference-cache";
import {
  DEFAULT_AVG_SETTINGS,
  parseAvgAuthoringSettingsV1,
  type AvgAuthoringDraftV1,
  type AvgAuthoringSettingsV1,
} from "./authoring-contract";

export async function createAvgDraftV1(
  title: string,
  settings: AvgAuthoringSettingsV1 = DEFAULT_AVG_SETTINGS,
) {
  if (!title.trim() || title.length > 200)
    throw new Error("请填写 1～200 字的 AVG 名称");
  const parsed = parseAvgAuthoringSettingsV1(settings);
  return db.transaction(
    "rw",
    [...workspaceCreationTransactionTablesV1(), db.avgAuthoringDrafts],
    async () => {
      const created = await createWorkspace(
        {
          name: title.trim(),
          description: "",
          genres: [],
          status: "drafting",
          targetWordCount: 10000,
        },
        { kind: "avg" },
      );
      const now = Date.now();
      await db.avgAuthoringDrafts.add(
        stampNewRecord(
          created.scope,
          "avgAuthoringDrafts",
          {
            ...created.scope,
            revision: 0,
            settingsJson: JSON.stringify(parsed),
            conversationJson: "[]",
            worldReleaseId: null,
            productionId: null,
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
export async function readAvgDraftV1(
  scopeInput: WorkspaceScope,
): Promise<AvgAuthoringDraftV1> {
  const scope = await resolveScope({ scope: scopeInput });
  const row = await db.avgAuthoringDrafts
    .where("workId")
    .equals(scope.workId)
    .first();
  if (
    !row ||
    !(await assertRecordInScope(scope, "avgAuthoringDrafts", row, {
      owner: "work",
    }))
  )
    throw new Error("AVG 方案不存在或不属于当前作品");
  parseAvgAuthoringSettingsV1(JSON.parse(row.settingsJson));
  return row;
}
export async function saveAvgDraftV1(
  scope: WorkspaceScope,
  revision: number,
  settings: AvgAuthoringSettingsV1,
  title?: string,
) {
  const parsed = parseAvgAuthoringSettingsV1(settings);
  if (title !== undefined && (!title.trim() || title.length > 200))
    throw new Error("请填写 1～200 字的作品名称");
  return db.transaction(
    "rw",
    scopeTransactionTables(db.avgAuthoringDrafts),
    async () => {
      const row = await readAvgDraftV1(scope);
      if (row.revision !== revision)
        throw new Error("AVG 方案已在其他页面修改，请刷新后再保存");
      const next = {
        ...row,
        settingsJson: JSON.stringify(parsed),
        revision: revision + 1,
        updatedAt: Date.now(),
      };
      await db.avgAuthoringDrafts.put(next);
      if(title!==undefined)await updateWorkTitle(scope,title);
      return next;
    },
  );
}
export async function selectAvgWorldV1(
  scope: WorkspaceScope,
  revision: number,
  releaseId: number,
) {
  const current = await readAvgDraftV1(scope);
  if (current.revision !== revision)
    throw new Error("AVG 方案已变化，请刷新后重新选择世界");
  const localId = await cacheWorldReferenceForProductV1(scope, releaseId, { narrativeProductType: 'avg' });
  return db.transaction(
    "rw",
    scopeTransactionTables(db.avgAuthoringDrafts),
    async () => {
      const row = await readAvgDraftV1(scope);
      if (row.revision !== revision)
        throw new Error("AVG 方案已变化，请刷新后重新选择世界");
      const next = {
        ...row,
        worldReleaseId: localId,
        revision: revision + 1,
        updatedAt: Date.now(),
      };
      await db.avgAuthoringDrafts.put(next);
      return next;
    },
  );
}

export interface AvgConversationTurnV1 {
  archived?:boolean
  id: string;
  question: string;
  answer: string;
  settings: AvgAuthoringSettingsV1 | null;
  runId: number | null;
  error: string;
  createdAt: number;
}
export async function saveAvgConversationV1(
  scope: WorkspaceScope,
  revision: number,
  turn: AvgConversationTurnV1,
) {
  if (turn.question.length > 5000 || turn.answer.length > 12000)
    throw new Error("AVG 会谈内容过长");
  if (turn.settings) parseAvgAuthoringSettingsV1(turn.settings);
  return db.transaction(
    "rw",
    scopeTransactionTables(db.avgAuthoringDrafts),
    async () => {
      const row = await readAvgDraftV1(scope);
      if (row.revision !== revision)
        throw new Error("方案已变化，候选保留在任务记录中，请重新对照当前方案");
      const history = JSON.parse(
        row.conversationJson,
      ) as AvgConversationTurnV1[];
      const next = {
        ...row,
        conversationJson: JSON.stringify([
          ...history.filter((t) => t.id !== turn.id),
          turn,
        ]),
        revision: revision + 1,
        updatedAt: Date.now(),
      };
      await db.avgAuthoringDrafts.put(next);
      return next;
    },
  );
}

/** Add an AVG authoring draft to a pre-existing AVG production without moving its Work. */
export async function ensureAvgProductionDraftV1(scope:WorkspaceScope,productionId:number){
 const {readProductProductionDetailsV1}=await import('../product-production/service')
 const {parseProductProductionBriefV3}=await import('../product-production/contracts')
 const details=await readProductProductionDetailsV1(scope,productionId,['avg'])
 const brief=details.brief?parseProductProductionBriefV3(details.brief.briefJson):null
 return db.transaction('rw',scopeTransactionTables(db.avgAuthoringDrafts),async()=>{
  const existing=await db.avgAuthoringDrafts.where('workId').equals(scope.workId).first()
  if(existing)return readAvgDraftV1(scope)
  const now=Date.now();const settings=brief?.avg??{...DEFAULT_AVG_SETTINGS,playerRole:brief?.intent.playerRole??'',openingSituation:brief?.intent.openingSituation??'',experience:brief?.intent.coreExperience.join('\n')??'',qualityProfile:brief?.qualityProfile??'prototype',targetPlayMinutes:Math.min(900,brief?.scale.targetPlayMinutes??30),targetEndingCount:Math.min(8,brief?.scale.targetEndingCount??2)}
  const row=stampNewRecord(scope,'avgAuthoringDrafts',{...scope,revision:0,settingsJson:JSON.stringify(parseAvgAuthoringSettingsV1(settings)),worldReleaseId:brief?.source.worldReleaseId??null,productionId,conversationJson:'[]',createdAt:now,updatedAt:now},{owner:'work'})
  await db.avgAuthoringDrafts.add(row);return readAvgDraftV1(scope)
 })
}

export async function archiveAvgConversationV1(scope:WorkspaceScope,revision:number){
 return db.transaction('rw',scopeTransactionTables(db.avgAuthoringDrafts),async()=>{const row=await readAvgDraftV1(scope);if(row.revision!==revision)throw new Error('会谈已变化，请刷新后重试');const turns=JSON.parse(row.conversationJson) as AvgConversationTurnV1[];await db.avgAuthoringDrafts.put({...row,conversationJson:JSON.stringify(turns.map(t=>({...t,archived:true}))),revision:revision+1,updatedAt:Date.now()})})
}

/** A Work-owned pointer only; production records stay in their registered command lifecycle. */
export async function bindAvgDraftProductionV1(scope: WorkspaceScope, revision: number, productionId: number) {
  const production = await db.productProductions.get(productionId)
  if (!production || production.productType !== 'avg' || !await assertRecordInScope(scope,'productProductions',production,{owner:'work'})) throw new Error('AVG 制作记录不属于当前作品')
  return db.transaction('rw',scopeTransactionTables(db.avgAuthoringDrafts),async () => {
    const row = await readAvgDraftV1(scope)
    if (row.revision !== revision) throw new Error('作者草稿已变化，请刷新后再连接制作记录')
    if (row.productionId === productionId) return row
    if (row.productionId != null) throw new Error('作者草稿已有制作记录，不能静默替换')
    const next = { ...row,productionId,revision:revision+1,updatedAt:Date.now() }
    await db.avgAuthoringDrafts.put(next)
    return next
  })
}
