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
import type { ProductProductionBriefRecordV1, WorkspaceScope } from "../types";
import { createWorldReferenceV1 } from "../world-engine/world-reference";
import {
  assertWorldSemanticReleaseCurrentV1,
  worldSemanticReleaseTransactionTablesV1,
} from "../context-gateway/world-release-client";
import {
  parseConfirmedProductBriefV1,
  parseProductProductionSourcePlanV1,
} from "../product-production/source-contracts";
import { readTtrpgRulePackVersionedV1 } from "./rule-pack-library";
import {
  createTtrpgProductionBriefContentV3,
  createTtrpgProductionBriefV3,
  hashTtrpgProductionBriefContentV3,
  type TtrpgProductionBriefContentV3,
  type TtrpgProductionBriefV3,
} from "./production-brief-v3";
import {
  defaultTtrpgSettings,
  serializeTtrpgSettings,
  settingsFromTtrpgDraft,
  isTtrpgAuthoringSettingsV2,
  parseTtrpgSettings,
  type TtrpgAuthoringSettings,
} from "./authoring-contract";
import { assertTtrpgScriptedAuthoringSettings } from "./authoring-settings";
import { verifyTtrpgOpenAuthoringSourceProvenanceV1 } from "./open-source-provenance";
export async function createTtrpgDraft(
  title: string,
  settings: TtrpgAuthoringSettings = defaultTtrpgSettings(),
) {
  if (!title.trim() || title.length > 200)
    throw new Error("请填写 1～200 字的战役名称");
  const serialized = serializeTtrpgSettings(settings);
  if (serialized.savedRulePackId != null) throw new Error("新作品请先保存，再选择属于本作品的规则包");
  return db.transaction(
    "rw",
    [...workspaceCreationTransactionTablesV1(), db.ttrpgAuthoringDrafts],
    async () => {
      const created = await createWorkspace(
        {
          name: title.trim(),
          description: "",
          genres: [],
          status: "drafting",
          targetWordCount: 10000,
        },
        { kind: "ttrpg" },
      );
      const now = Date.now();
      await db.ttrpgAuthoringDrafts.add(
        stampNewRecord(
          created.scope,
          "ttrpgAuthoringDrafts",
          {
            ...created.scope,
            ...serialized,
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
export async function readTtrpgDraft(input: WorkspaceScope) {
  const scope = await resolveScope({ scope: input });
  const row = await db.ttrpgAuthoringDrafts
    .where("workId")
    .equals(scope.workId)
    .first();
  if (
    !row ||
    !(await assertRecordInScope(scope, "ttrpgAuthoringDrafts", row, {
      owner: "work",
    }))
  )
    throw new Error("跑团方案不存在或不属于当前作品");
  settingsFromTtrpgDraft(row);
  return row;
}
export async function saveTtrpgDraft(
  scope: WorkspaceScope,
  revision: number,
  settings: TtrpgAuthoringSettings,
  title: string,
) {
  if (!title.trim() || title.length > 200)
    throw new Error("请填写 1～200 字的战役名称");
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
    throw new Error("方案 revision 无效");
  const snapshot = parseTtrpgSettings(settings);
  const data = serializeTtrpgSettings(snapshot);
  return db.transaction(
    "rw",
    scopeTransactionTables(db.ttrpgAuthoringDrafts, db.ttrpgRulePacks),
    async () => {
      const row = await readTtrpgDraft(scope);
      if (row.revision !== revision)
        throw new Error("方案已在其他页面修改，请刷新后再保存");
      if (isTtrpgAuthoringSettingsV2(settingsFromTtrpgDraft(row)) &&
        !isTtrpgAuthoringSettingsV2(snapshot))
        throw new Error("不能以 legacy 配置覆盖 Settings V2，请刷新并保留版本字段");
      if (data.savedRulePackId != null) {
        const rule = await db.ttrpgRulePacks.get(data.savedRulePackId);
        if (
          !rule ||
          !(await assertRecordInScope(scope, "ttrpgRulePacks", rule, {
            owner: "work",
          }))
        )
          throw new Error("规则包不属于当前作品");
      }
      const next = {
        ...row,
        ...data,
        revision: revision + 1,
        preparedRevision: null,
        updatedAt: Date.now(),
      };
      await db.ttrpgAuthoringDrafts.put(next);
      await updateWorkTitle(scope, title);
      return next;
    },
  );
}
export async function selectTtrpgWorld(
  scope: WorkspaceScope,
  revision: number,
  releaseId: number,
) {
  const row = await readTtrpgDraft(scope);
  if (row.revision !== revision) throw new Error("方案已变化，请重新选择");
  const localId = await cacheWorldReferenceForProductV1(scope, releaseId);
  return db.transaction(
    "rw",
    scopeTransactionTables(db.ttrpgAuthoringDrafts),
    async () => {
      const latest = await readTtrpgDraft(scope);
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
      await db.ttrpgAuthoringDrafts.put(next);
      return next;
    },
  );
}

export async function saveTtrpgSourceSelection(
  scope: WorkspaceScope,
  revision: number,
  suggestionKey: string,
  selection: import("../types").ProductProductionSourceSelectionV1,
) {
  const row = await readTtrpgDraft(scope);
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
    scopeTransactionTables(db.ttrpgAuthoringDrafts),
    async () => {
      const current = await readTtrpgDraft(scope);
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
      await db.ttrpgAuthoringDrafts.put(next);
      return next;
    },
  );
}

export async function prepareTtrpgBrief(
  scope: WorkspaceScope,
  revision: number,
) {
  const row = await readTtrpgDraft(scope);
  if (row.revision !== revision) throw new Error("方案已变化，请刷新");
  const settings = settingsFromTtrpgDraft(row);
  if (isTtrpgAuthoringSettingsV2(settings) && settings.runFormat === 'open') {
    return prepareTtrpgOpenProductionBriefV3({ scope, revision })
  }
  assertTtrpgScriptedAuthoringSettings(settings);
  if (!row.worldReleaseId) throw new Error("开始制作，需要一个世界引擎");
  const {
    consultProductProductionStartV1,
    compileProductProductionBriefV3,
    createProductProductionWithBriefV1,
    readProductProductionDetailsV1,
  } = await import("../product-production/service");
  const { executeProductProductionCommand } = await import(
    "../product-production/commands"
  );
  const { toTtrpgProductionBriefDraftInputV2 } = await import(
    "./authoring-settings"
  );
  const sources = await consultProductProductionStartV1({
    scope,
    worldReleaseId: row.worldReleaseId,
  });
  const suggestion =
    sources.suggestions.find((s) => s.suggestionKey === row.suggestionKey) ??
    sources.suggestions.find((s) =>
      s.recommendedProductTypes.includes("ttrpg"),
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
    productType: "ttrpg",
    qualityProfile: settings.qualityProfile,
    scale: "campaign",
    visualLevel:
      settings.wizard.maximumGeneratedAssets > 0 ? "key-scenes" : "none",
    audioLevel: "none",
    playerRole: settings.playerRole || "扮演本桌玩家角色",
    openingSituation: settings.openingSituation || suggestion.openingConflict,
    confirmTtrpgDefaultMappings: settings.wizard.confirmAll,
    ttrpg: toTtrpgProductionBriefDraftInputV2({
      value: settings.wizard,
      sourceOptions: sources.sourceOptions,
      sourceSelection: selection,
      openingSituation: settings.openingSituation || suggestion.openingConflict,
    }),
    sourceSelection: selection,
  });
  if ((await readTtrpgDraft(scope)).revision !== revision)
    throw new Error("编译期间方案已变化，请重新生成");
  let id = row.productionId;
  const prior = id
    ? await readProductProductionDetailsV1(scope, id, ["ttrpg"])
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
  await db.transaction(
    "rw",
    scopeTransactionTables(db.ttrpgAuthoringDrafts),
    async () => {
      const latest = await readTtrpgDraft(scope);
      if (latest.revision !== revision)
        throw new Error("方案已变化，已编译版本保留在制作记录中，请重新核对");
      await db.ttrpgAuthoringDrafts.put({
        ...latest,
        productionId: id,
        preparedRevision: revision + 1,
        revision: revision + 1,
        updatedAt: Date.now(),
      });
    },
  );
  return id!;
}

/** Normal open S2 preparation: creates its own intent and SourcePlan without a scripted Brief. */
export async function prepareTtrpgOpenProductionBriefV3(input: {
  scope: WorkspaceScope; revision: number; commandId?: string
}): Promise<number> {
  const scope = await resolveScope({ scope: input.scope }), draft = await readTtrpgDraft(scope)
  if (draft.revision !== input.revision) throw new Error('open 方案已变化，请刷新')
  const settings = settingsFromTtrpgDraft(draft)
  if (!isTtrpgAuthoringSettingsV2(settings) || settings.runFormat !== 'open') throw new Error('需要 open Settings V2')
  if (!draft.worldReleaseId) throw new Error('open 制作需要明确选择冻结世界版本')
  if (settings.wizard.ruleOrigin !== 'saved-rule-pack' || !draft.savedRulePackId) throw new Error('open 制作需要本作品已保存的 RulePack V2')
  if ([settings.wizard.initiativeDiceSides, settings.wizard.actionsPerTurn, settings.wizard.reactionsPerRound,
    settings.wizard.deathRecoveryHeroicDiceCost].some(value => value !== null) || settings.wizard.customHouseRulePatches.length) {
    throw new Error('open 村规请先确认并保存为新的 RulePack V2')
  }
  const work = await db.works.get(scope.workId)
  if (!work || work.kind !== 'ttrpg') throw new Error('open 制作必须属于跑团 Work')
  // Capture the original CAS basis before source/contract preparation. A
  // concurrent author-start must never lend its newer state to this save.
  const { prior, priorBuilds, priorBrief } = await db.transaction('r', scopeTransactionTables(
    db.ttrpgAuthoringDrafts, db.productProductions, db.productBuilds, db.productProductionBriefs,
  ), async () => {
    if (JSON.stringify(await readTtrpgDraft(scope)) !== JSON.stringify(draft)) throw new Error('open 方案已变化，请刷新')
    const prior = draft.productionId ? await db.productProductions.get(draft.productionId) : null
    if (prior && !(await assertRecordInScope(scope, 'productProductions', prior, { owner: 'work' }))) throw new Error('open 当前制作记录不属于本作品')
    const priorBuilds = prior?.id ? await db.productBuilds.where('productionId').equals(prior.id).toArray() : []
    const priorBrief = prior?.id && prior.currentBriefRevision !== null ? await db.productProductionBriefs
      .where('[productionId+revision]').equals([prior.id, prior.currentBriefRevision]).first() : null
    return { prior, priorBuilds, priorBrief }
  })
  const { parseProductProductionBriefV3 } = await import('../product-production/contracts')
  const priorEnvelope = priorBuilds.length > 0 && priorBrief ? parseProductProductionBriefV3(priorBrief.briefJson) : null
  if (priorEnvelope?.ttrpgOpen && prior?.status === 'producing') throw new Error('open 当前方案已开始制作，请先在原制作记录核对当前轮次')
  const rule = await readTtrpgRulePackVersionedV1({ scope, rulePackId: draft.savedRulePackId })
  if (rule.rulePack.version !== 2) throw new Error('open 制作不能使用旧 RulePack V1')
  const { draftTtrpgOpenProductionCommonBriefV3, suggestProductStartingPoints } = await import('../product-production/consultation')
  const { createProductProductionSourcePlanV1 } = await import('../product-production/source-contracts')
  const { createTtrpgOpenProductionBriefV3 } = await import('./open-production-brief')
  const { hashProductProductionValueV2 } = await import('../product-production/hash')
  const { executeProductProductionCommand } = await import('../product-production/commands')
  const worldReference = await createWorldReferenceV1(draft.worldReleaseId)
  const suggestions = await suggestProductStartingPoints({ scope, worldReleaseId: draft.worldReleaseId })
  const suggestion = suggestions.suggestions.find(item => item.suggestionKey === draft.suggestionKey)
    ?? suggestions.suggestions.find(item => item.recommendedProductTypes.includes('ttrpg'))
  if (!suggestion) throw new Error('open 世界没有可用起点')
  const selection = draft.selectionJson ? JSON.parse(draft.selectionJson) : suggestions.selectionDefaults[suggestion.suggestionKey]
  const common = await draftTtrpgOpenProductionCommonBriefV3({ scope, worldReleaseId: draft.worldReleaseId,
    suggestionKey: suggestion.suggestionKey, qualityProfile: settings.qualityProfile, scale: 'campaign',
    visualLevel: settings.wizard.maximumGeneratedAssets > 0 ? 'key-scenes' : 'none', audioLevel: 'none',
    playerRole: settings.playerRole, openingSituation: settings.openingSituation, sourceSelection: selection })
  const releaseRevision = priorEnvelope?.ttrpgOpen != null && priorEnvelope.evolution?.base.kind === 'release'
  const reuse = prior && (!priorBuilds.length || releaseRevision) && prior.productType === 'ttrpg' && prior.worldId === scope.worldId
    && priorBrief?.sourceWorldReleaseId === draft.worldReleaseId
  const commandId = input.commandId ?? crypto.randomUUID()
  const productionKey = reuse ? prior.productionKey : `productprod.open.${(await hashProductProductionValueV2({ scope,
    revision: input.revision, commandId, worldReferenceHash: worldReference.referenceHash })).slice(0, 40)}`
  const sourcePlan = releaseRevision
    ? priorEnvelope!.ttrpgOpen!.sourcePlan
    : await createProductProductionSourcePlanV1({ scope, productionKey, brief: common })
  await verifyTtrpgOpenAuthoringSourceProvenanceV1({ sourcePlan, facts: settings.openAuthoring.factPolicy.map(item => item.fact) })
  const content = await createTtrpgProductionBriefContentV3({ settingsRevision: input.revision, settings,
    rulePack: rule.rulePack, worldReference, sourcePlan })
  const brief = releaseRevision && prior && priorBrief
    ? await (await import('./open-pending-runtime-brief')).reviseTtrpgOpenPendingRuntimeBriefV1({
      scope, production: prior, row: priorBrief,
      build: priorBuilds.find(item => item.buildNumber === prior.currentBuildNumber) ?? null,
      release: prior.currentProductReleaseId ? await db.productReleases.get(prior.currentProductReleaseId) : undefined,
      settingsRevision: input.revision, settings, rulePack: rule.rulePack, worldReference, common,
    })
    : await createTtrpgOpenProductionBriefV3({ common, content })
  if (JSON.stringify(await readTtrpgDraft(scope)) !== JSON.stringify(draft)
    || JSON.stringify((await readTtrpgRulePackVersionedV1({ scope, rulePackId: draft.savedRulePackId })).record) !== JSON.stringify(rule.record)) {
    throw new Error('open 编译期间方案或规则已 stale，未保存制作方案')
  }
  await assertWorldSemanticReleaseCurrentV1({ localReleaseRecordId: draft.worldReleaseId,
    expectedProjectId: scope.projectId, expectedWorldId: scope.worldId, expectedReleaseHash: worldReference.releaseHash })
  let productionId = reuse ? prior.id! : null
  if (productionId === null) {
    const created = await executeProductProductionCommand({ scope, command: { type: 'create-intent', commandId: `${commandId}.intent`,
      productionKey, productType: 'ttrpg', worldReleaseId: draft.worldReleaseId, userText: work.title } })
    if (!created.ok) throw new Error(String(created.result.message ?? 'open 制作意图创建失败'))
    productionId = created.productionId
  }
  const production = reuse ? prior! : (await db.productProductions.get(productionId))!
  const saved = await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision',
    commandId: `${commandId}.brief`, expectedStateRevision: production.stateRevision,
    parentRevision: production.currentBriefRevision, brief } })
  if (!saved.ok) throw new Error(String(saved.result.message ?? 'open 制作方案保存失败'))
  await db.transaction('rw', scopeTransactionTables(db.ttrpgAuthoringDrafts), async () => {
    const latest = await readTtrpgDraft(scope)
    if (JSON.stringify(latest) !== JSON.stringify(draft)) throw new Error('open 方案已变化，已保存版本保留在制作记录中，请重新核对')
    await db.ttrpgAuthoringDrafts.put({ ...latest, productionId, preparedRevision: input.revision + 1,
      revision: input.revision + 1, updatedAt: Date.now() })
  })
  return productionId
}

export interface TtrpgOpenBriefRequestV3 {
  scope: WorkspaceScope;
  revision: number;
  productionId: number;
  expectedStateRevision: number;
}
export interface TtrpgOpenBriefCandidateV3 {
  content: TtrpgProductionBriefContentV3;
  contentHash: string;
  productionId: number;
  briefRevision: number;
  productionStateRevision: number;
}

/** Read a consistent DB snapshot, validate contracts outside the transaction,
 * then compare the complete snapshot in a second read transaction. The neutral
 * Gateway checks world identity in both reads; no crypto runs inside either. */
async function withTtrpgOpenBriefSnapshotV3<T>(
  input: TtrpgOpenBriefRequestV3,
  consume: (candidate: TtrpgOpenBriefCandidateV3, row: ProductProductionBriefRecordV1) => Promise<T>,
): Promise<T> {
  const request = structuredClone(input);
  if (!Number.isSafeInteger(request.revision) || request.revision < 0 ||
    !Number.isSafeInteger(request.productionId) || request.productionId < 1 ||
    !Number.isSafeInteger(request.expectedStateRevision) || request.expectedStateRevision < 1)
    throw new Error("open Brief revision/production 无效");
  const selectedDraft = await readTtrpgDraft(request.scope);
  if (selectedDraft.revision !== request.revision) throw new Error("open Brief Settings revision 已 stale");
  if (!selectedDraft.worldReleaseId) throw new Error("open Brief 尚未选择世界版本");
  const worldReference = await createWorldReferenceV1(selectedDraft.worldReleaseId);
  const readSnapshot = () => db.transaction("r", scopeTransactionTables(
    db.ttrpgAuthoringDrafts, db.ttrpgRulePacks,
    db.productProductions, db.productProductionBriefs,
    ...worldSemanticReleaseTransactionTablesV1(),
  ), async () => {
    const scope = await resolveScope({ scope: request.scope });
    const work = await db.works.get(scope.workId);
    if (work?.kind !== "ttrpg") throw new Error("open Brief 必须属于真实跑团 Work");
    const draft = await readTtrpgDraft(scope);
    if (draft.worldId !== scope.worldId) throw new Error("open Brief 草稿世界作用域不一致");
    if (draft.revision !== request.revision) throw new Error("open Brief Settings revision 已 stale");
    const settings = settingsFromTtrpgDraft(draft);
    if (!isTtrpgAuthoringSettingsV2(settings) || settings.runFormat !== "open")
      throw new Error("open Brief 必须使用当前 Settings V2/open");
    if (!draft.worldReleaseId) throw new Error("open Brief 尚未选择世界版本");
    if (settings.wizard.ruleOrigin !== "saved-rule-pack" || !draft.savedRulePackId)
      throw new Error("open Brief 必须选择已保存的 RulePack V2");
    if ([settings.wizard.initiativeDiceSides, settings.wizard.actionsPerTurn,
      settings.wizard.reactionsPerRound, settings.wizard.deathRecoveryHeroicDiceCost].some((v) => v !== null) ||
      settings.wizard.customHouseRulePatches.length)
      throw new Error("open 村规修改须先确认为新的 RulePack V2");
    const production = await db.productProductions.get(request.productionId);
    if (!production || production.productType !== "ttrpg" || production.worldId !== scope.worldId ||
      draft.productionId !== production.id ||
      !(await assertRecordInScope(scope, "productProductions", production, { owner: "work" })))
      throw new Error("open Brief production 不属于当前作品或未关联草稿");
    if (production.stateRevision !== request.expectedStateRevision)
      throw new Error("open Brief production revision 已 stale");
    const currentBriefRevision = production.currentBriefRevision;
    if (currentBriefRevision === null || !Number.isSafeInteger(currentBriefRevision) || currentBriefRevision < 1)
      throw new Error("open Brief 缺少当前有效的 Brief revision/SourcePlan");
    const row = await db.productProductionBriefs.where("[productionId+revision]")
      .equals([request.productionId, currentBriefRevision]).first();
    if (!row || row.worldId !== scope.worldId ||
      !(await assertRecordInScope(scope, "productProductionBriefs", row, { owner: "work" })) ||
      row.status === "withdrawn" || row.status === "superseded" ||
      (row.sourceKind !== undefined && row.sourceKind !== "world-release"))
      throw new Error("open Brief 缺少当前作品有效的世界 SourcePlan");
    if (draft.worldReleaseId !== selectedDraft.worldReleaseId)
      throw new Error("open Brief 世界在核验期间已 stale");
    const ruleRecord = await db.ttrpgRulePacks.get(draft.savedRulePackId);
    if (!ruleRecord || ruleRecord.worldId !== scope.worldId ||
      !(await assertRecordInScope(scope, "ttrpgRulePacks", ruleRecord, { owner: "work" })))
      throw new Error("open Brief 规则 locator 不属于当前作品");
    return { scope, work, draft, settings, production, row, ruleRecord };
  });
  const snapshot = await readSnapshot();
  const { scope, draft, settings, production, row } = snapshot;
  await assertWorldSemanticReleaseCurrentV1({
    localReleaseRecordId: worldReference.localReleaseRecordId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
    expectedReleaseHash: worldReference.releaseHash,
  });
  const sourcePlan = await parseProductProductionSourcePlanV1(row);
  if (sourcePlan.productInstanceKey !== production.productionKey ||
    sourcePlan.productType !== "ttrpg" ||
    row.sourceWorldReleaseId !== draft.worldReleaseId ||
    row.sourceWorldContentHash !== worldReference.releaseHash ||
    sourcePlan.worldReference.localReleaseRecordId !== draft.worldReleaseId ||
    sourcePlan.worldReference.referenceHash !== worldReference.referenceHash)
    throw new Error("open Brief 世界或 SourcePlan 已 stale/不属于当前 production");
  const { record, rulePack } = await readTtrpgRulePackVersionedV1({
    scope, rulePackId: snapshot.ruleRecord.id!,
  });
  if (JSON.stringify(record) !== JSON.stringify(snapshot.ruleRecord))
    throw new Error("open Brief 规则在核验期间已 stale");
  if (record.status !== "validated" || rulePack.version !== 2)
    throw new Error("open Brief 必须绑定当前作品已验证的 RulePack V2");
  await verifyTtrpgOpenAuthoringSourceProvenanceV1({ sourcePlan, facts: settings.openAuthoring.factPolicy.map(item => item.fact) });
  const content = await createTtrpgProductionBriefContentV3({
    settingsRevision: draft.revision, settings, rulePack, worldReference, sourcePlan,
  });
  const contentHash = await hashTtrpgProductionBriefContentV3(content);
  const result = await consume({
    content, contentHash,
    productionId: request.productionId, briefRevision: row.revision,
    productionStateRevision: production.stateRevision,
  }, row);
  const afterSnapshot = await readSnapshot();
  await assertWorldSemanticReleaseCurrentV1({
    localReleaseRecordId: worldReference.localReleaseRecordId,
    expectedProjectId: afterSnapshot.scope.projectId,
    expectedWorldId: afterSnapshot.scope.worldId,
    expectedReleaseHash: worldReference.releaseHash,
  });
  if (JSON.stringify(afterSnapshot) !== JSON.stringify(snapshot))
    throw new Error("open Brief 核验期间草稿、规则或 production 已 stale");
  return result;
}

/** P2d consumes this reviewable candidate through the existing governed save/start path.
 * The SourcePlan comes from the current production row; no caller-supplied world or rules. */
export async function prepareTtrpgOpenBriefCandidateV3(
  input: TtrpgOpenBriefRequestV3,
): Promise<TtrpgOpenBriefCandidateV3> {
  return withTtrpgOpenBriefSnapshotV3(input, async (candidate) => candidate);
}

export interface TtrpgOpenBriefMutationResultV3 {
  candidate: TtrpgOpenBriefCandidateV3;
  receipt: import("../product-production/commands").ProductProductionCommandReceiptV1;
}

/**
 * Persist the single open Brief V3 candidate through the governed production
 * save command. The authoring draft and the legacy/scripted Brief are left
 * untouched; only a new ProductProductionBrief revision is created.
 */
export async function saveTtrpgOpenBriefV3(
  input: TtrpgOpenBriefRequestV3 & {
    commandId?: string;
    now?: number;
    candidate?: TtrpgOpenBriefCandidateV3;
  },
): Promise<TtrpgOpenBriefMutationResultV3> {
  const candidate = input.candidate ?? await prepareTtrpgOpenBriefCandidateV3(input);
  const { executeProductProductionCommand } = await import(
    "../product-production/commands"
  );
  const receipt = await executeProductProductionCommand({
    scope: input.scope,
    productionId: input.productionId,
    now: input.now,
    preparedTtrpgOpenBrief: candidate,
    command: {
      type: "save-brief-revision",
      commandId: input.commandId ?? crypto.randomUUID(),
      expectedStateRevision: input.expectedStateRevision,
      parentRevision: candidate.briefRevision,
      brief: candidate.content,
    },
  });
  if (!receipt.ok)
    throw new Error(String(receipt.result.message ?? receipt.errorCode ?? "open Brief 保存失败"));
  return { candidate, receipt };
}

/**
 * Confirm the already saved open Brief through the existing authorize-start
 * command. The command creates the authorized Build and advances the
 * Production state revision atomically.
 */
export async function startTtrpgOpenBriefV3(
  input: TtrpgOpenBriefRequestV3 & {
    commandId?: string;
    now?: number;
    candidate?: TtrpgOpenBriefCandidateV3;
  },
): Promise<TtrpgOpenBriefMutationResultV3> {
  const candidate = input.candidate ?? await prepareTtrpgOpenBriefCandidateV3(input);
  const current = await db.productProductionBriefs.where("[productionId+revision]")
    .equals([input.productionId, candidate.briefRevision]).first();
  if (!current || current.briefHash !== candidate.contentHash
    || (current.status !== "draft"
      && !(current.status === "authorized" && input.candidate))
    || current.briefKind === "text-open-world-creator-v1") {
    throw new Error("open Brief 尚未按当前候选正式保存，不能开始");
  }
  const { executeProductProductionCommand } = await import(
    "../product-production/commands"
  );
  const commandId = input.commandId ?? crypto.randomUUID();
  const receipt = await executeProductProductionCommand({
    scope: input.scope,
    productionId: input.productionId,
    now: input.now,
    preparedTtrpgOpenBrief: candidate,
    command: {
      type: "authorize-start",
      commandId,
      expectedStateRevision: input.expectedStateRevision,
      briefRevision: current.revision,
      briefHash: current.briefHash,
      // Tie the nonce to the durable command identity so retrying the same
      // public request produces the same payload hash and replays its receipt.
      authorizationNonce: `author.${commandId}`,
    },
  });
  if (!receipt.ok)
    throw new Error(String(receipt.result.message ?? receipt.errorCode ?? "open Brief 开始确认失败"));
  return { candidate, receipt };
}

export async function authorizeTtrpgOpenBriefV3(
  input: TtrpgOpenBriefRequestV3 & {
    commandId?: string;
    now?: number;
    candidate?: TtrpgOpenBriefCandidateV3;
  },
): Promise<TtrpgOpenBriefMutationResultV3> {
  return startTtrpgOpenBriefV3(input);
}

/** Read an already persisted production confirmation, never mint one or start a Build.
 * A legacy Brief/confirmation cannot authorize a newly assembled open candidate. */
export async function verifyTtrpgOpenBriefV3(
  input: TtrpgOpenBriefRequestV3 & { expectedConfirmationHash: string },
): Promise<TtrpgProductionBriefV3> {
  const expectedHash = input.expectedConfirmationHash;
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("open Brief confirmed hash 无效");
  return withTtrpgOpenBriefSnapshotV3(input, async (candidate, row) => {
    if (row.status !== "authorized" || row.confirmedBriefHash !== expectedHash || !row.authorizedAt)
      throw new Error("open Brief 缺少当前 production 的开始确认或 confirmed hash 已 stale");
    if (row.briefHash !== candidate.contentHash ||
      await hashTtrpgProductionBriefContentV3(JSON.parse(row.briefJson)) !== candidate.contentHash)
      throw new Error("open Brief 已保存内容与当前 Settings revision 不一致");
    const startAuthorization = await parseConfirmedProductBriefV1({
      row, sourcePlan: candidate.content.sourcePlan,
    });
    if (startAuthorization.productInstanceKey !== candidate.content.sourcePlan.productInstanceKey ||
      startAuthorization.sourcePlanHash !== candidate.content.sourcePlan.planHash ||
      startAuthorization.briefRevision !== candidate.briefRevision ||
      startAuthorization.briefContentHash !== candidate.contentHash)
      throw new Error("open Brief 开始确认未绑定此 Brief");
    if (startAuthorization.briefRevision !== candidate.briefRevision ||
      startAuthorization.authorStartRevision >= candidate.productionStateRevision ||
      startAuthorization.confirmedAt !== row.authorizedAt)
      throw new Error("open Brief 开始确认 revision/时间与 production 不一致");
    return createTtrpgProductionBriefV3({ content: candidate.content, startAuthorization });
  });
}
export { createTtrpgOpenProductionBriefV3 } from './open-production-brief';
