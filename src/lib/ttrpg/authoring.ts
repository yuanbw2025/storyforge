import { db } from "../db/schema";
import { hashGameProductionValueV2 } from "../game-production/hash";
import {
  buildPlayableWorldBundleFromRelease,
  verifyPlayableWorldBundle,
} from "../simulation/canon-snapshot";
import type {
  GameRulePackRecordV1,
  RulePackV1,
  TtrpgCampaignContentV1,
  TtrpgCampaignModuleRecordV1,
  TtrpgCharacterSheetDraftV2,
  WorkspaceScope,
  WorldReleaseManifestV2,
} from "../types";
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
} from "../world-engine/scope";
import {
  compileTtrpgCampaignDraftV1,
  parseTtrpgCampaignContentV1,
  validateTtrpgCampaignForPublicationV1,
} from "./campaign";
import {
  evaluateRuleNumberExpressionV1,
  parseRulePackV1,
  runRulePackFixturesV1,
} from "./rule-pack";
import { createStoryForgeRulePackV1 } from "./storyforge-rule-pack";
import { createRankLiteRulePackV1 } from "./rank-lite-rule-pack";
import { createD20FantasyRulePackV1 } from "./d20-fantasy-rule-pack";
import { createD100InvestigationRulePackV1 } from "./d100-investigation-rule-pack";
import { createCompleteTtrpgCharacterSheetV2 } from "./character-sheet";

export async function saveGameRulePackV1(input: {
  scope: WorkspaceScope;
  rulePack: RulePackV1 | unknown;
  status?: GameRulePackRecordV1["status"];
}): Promise<GameRulePackRecordV1> {
  const scope = await resolveScope({ scope: input.scope });
  const rulePack = parseRulePackV1(input.rulePack);
  runRulePackFixturesV1(rulePack);
  const status = input.status ?? "validated";
  if (
    status === "validated" &&
    (!rulePack.license.commercialUse || !rulePack.license.attribution.trim())
  ) {
    throw new Error(
      "[ttrpg-authoring] 进入 validated 的 RulePack 必须声明商业使用权和署名",
    );
  }
  const contentHash = await hashGameProductionValueV2(rulePack);
  const rulePackJson = JSON.stringify(rulePack);
  const now = Date.now();
  return db.transaction(
    "rw",
    scopeTransactionTables(db.gameRulePacks),
    async () => {
      const existing = await db.gameRulePacks
        .where("[workId+ruleSystemId+ruleSystemVersion]")
        .equals([
          scope.workId,
          rulePack.ruleSystemId,
          rulePack.ruleSystemVersion,
        ])
        .first();
      if (existing) {
        await db.gameRulePacks.update(existing.id!, {
          title: rulePack.title,
          status,
          rulePackJson,
          contentHash,
          updatedAt: now,
        });
        return {
          ...existing,
          title: rulePack.title,
          status,
          rulePackJson,
          contentHash,
          updatedAt: now,
        };
      }
      const row: GameRulePackRecordV1 = {
        projectId: scope.projectId,
        worldId: scope.worldId,
        workId: scope.workId,
        ruleSystemId: rulePack.ruleSystemId,
        ruleSystemVersion: rulePack.ruleSystemVersion,
        title: rulePack.title,
        status,
        rulePackJson,
        contentHash,
        createdAt: now,
        updatedAt: now,
      };
      const id = (await db.gameRulePacks.add(row)) as number;
      return { ...row, id };
    },
  );
}

export async function installStoryForgeRulePackV1(
  scope: WorkspaceScope,
): Promise<GameRulePackRecordV1> {
  return saveGameRulePackV1({
    scope,
    rulePack: createStoryForgeRulePackV1(),
    status: "validated",
  });
}

export async function installRankLiteRulePackV1(
  scope: WorkspaceScope,
): Promise<GameRulePackRecordV1> {
  return saveGameRulePackV1({
    scope,
    rulePack: createRankLiteRulePackV1(),
    status: "validated",
  });
}

export async function installD20FantasyRulePackV1(
  scope: WorkspaceScope,
): Promise<GameRulePackRecordV1> {
  return saveGameRulePackV1({
    scope,
    rulePack: createD20FantasyRulePackV1(),
    status: "validated",
  });
}

export async function installD100InvestigationRulePackV1(
  scope: WorkspaceScope,
): Promise<GameRulePackRecordV1> {
  return saveGameRulePackV1({
    scope,
    rulePack: createD100InvestigationRulePackV1(),
    status: "validated",
  });
}

export async function saveTtrpgCampaignModuleV1(input: {
  scope: WorkspaceScope;
  sourceWorldReleaseId: number;
  rulePackId: number;
  campaign: TtrpgCampaignContentV1 | unknown;
  status?: TtrpgCampaignModuleRecordV1["status"];
}): Promise<TtrpgCampaignModuleRecordV1> {
  const scope = await resolveScope({ scope: input.scope });
  const [release, ruleRow] = await Promise.all([
    db.worldReleases.get(input.sourceWorldReleaseId),
    db.gameRulePacks.get(input.rulePackId),
  ]);
  if (
    !release ||
    !(await assertRecordInScope(scope, "worldReleases", release, {
      owner: "world",
    }))
  ) {
    throw new Error("[ttrpg-authoring] WorldRelease 不存在或跨 World");
  }
  if (
    !ruleRow ||
    !(await assertRecordInScope(scope, "gameRulePacks", ruleRow, {
      owner: "work",
    }))
  ) {
    throw new Error("[ttrpg-authoring] RulePack 不存在或跨 Work");
  }
  const rulePack = parseRulePackV1(ruleRow.rulePackJson);
  if ((await hashGameProductionValueV2(rulePack)) !== ruleRow.contentHash) {
    throw new Error("[ttrpg-authoring] RulePack hash 校验失败");
  }
  const campaign = parseTtrpgCampaignContentV1(input.campaign, rulePack);
  if (campaign.sourceWorld.contentHash !== release.contentHash) {
    throw new Error(
      "[ttrpg-authoring] CampaignPack 与 WorldRelease hash 不一致",
    );
  }
  const report = validateTtrpgCampaignForPublicationV1(campaign, rulePack);
  const status = input.status ?? (report.valid ? "validated" : "draft");
  if (status === "validated" && !report.valid) {
    throw new Error(
      `[ttrpg-authoring] CampaignPack 未通过发布预检:${report.errors.join("；")}`,
    );
  }
  const contentHash = await hashGameProductionValueV2(campaign);
  const contentJson = JSON.stringify(campaign);
  const now = Date.now();
  return db.transaction(
    "rw",
    scopeTransactionTables(db.ttrpgCampaignModules),
    async () => {
      const existing = await db.ttrpgCampaignModules
        .where("[workId+campaignKey]")
        .equals([scope.workId, campaign.campaignKey])
        .first();
      if (existing) {
        await db.ttrpgCampaignModules.update(existing.id!, {
          title: campaign.title,
          status,
          sourceWorldReleaseId: release.id!,
          rulePackId: ruleRow.id!,
          contentJson,
          contentHash,
          updatedAt: now,
        });
        return {
          ...existing,
          title: campaign.title,
          status,
          sourceWorldReleaseId: release.id!,
          rulePackId: ruleRow.id!,
          contentJson,
          contentHash,
          updatedAt: now,
        };
      }
      const row: TtrpgCampaignModuleRecordV1 = {
        projectId: scope.projectId,
        worldId: scope.worldId,
        workId: scope.workId,
        campaignKey: campaign.campaignKey,
        title: campaign.title,
        status,
        sourceWorldReleaseId: release.id!,
        rulePackId: ruleRow.id!,
        contentJson,
        contentHash,
        createdAt: now,
        updatedAt: now,
      };
      const id = (await db.ttrpgCampaignModules.add(row)) as number;
      return { ...row, id };
    },
  );
}

export async function compileWorldReleaseToTtrpgCampaignDraftV1(input: {
  scope: WorkspaceScope;
  worldReleaseId: number;
  /** Tests and isolated runtime fixtures only. Formal authoring must use Game Production. */
  fixtureOnly?: true;
  rulePackId?: number;
  title?: string;
  campaignKey?: string;
  confirmDefaultMappings?: boolean;
}): Promise<TtrpgCampaignModuleRecordV1> {
  if (import.meta.env.MODE !== "test" || input.fixtureOnly !== true) {
    throw new Error(
      "[ttrpg-authoring] 固定四场景编译器已退出正式产品；请通过跑团制作流程生成并审阅 CampaignPack",
    );
  }
  const scope = await resolveScope({ scope: input.scope });
  const release = await db.worldReleases.get(input.worldReleaseId);
  if (
    !release ||
    !(await assertRecordInScope(scope, "worldReleases", release, {
      owner: "world",
    }))
  ) {
    throw new Error("[ttrpg-authoring] WorldRelease 不存在或跨 World");
  }
  const ruleRow =
    input.rulePackId == null
      ? await installStoryForgeRulePackV1(scope)
      : await db.gameRulePacks.get(input.rulePackId);
  if (
    !ruleRow ||
    !(await assertRecordInScope(scope, "gameRulePacks", ruleRow, {
      owner: "work",
    }))
  ) {
    throw new Error("[ttrpg-authoring] RulePack 不存在或跨 Work");
  }
  const rulePack = parseRulePackV1(ruleRow.rulePackJson);
  const manifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV2;
  const playableWorld = await buildPlayableWorldBundleFromRelease({
    manifest,
    worldContentHash: release.contentHash,
    createdAt: release.createdAt,
  });
  if (!(await verifyPlayableWorldBundle(playableWorld)))
    throw new Error("[ttrpg-authoring] PlayableWorldBundle hash 校验失败");
  const campaign = compileTtrpgCampaignDraftV1({
    playableWorld,
    rulePack,
    fixtureOnly: true,
    title: input.title,
    campaignKey: input.campaignKey,
    confirmDefaultMappings: input.confirmDefaultMappings,
  });
  const report = validateTtrpgCampaignForPublicationV1(campaign, rulePack);
  return saveTtrpgCampaignModuleV1({
    scope,
    sourceWorldReleaseId: release.id!,
    rulePackId: ruleRow.id!,
    campaign,
    status: report.valid ? "validated" : "draft",
  });
}

export async function reviseTtrpgCampaignCharacterMappingsV1(input: {
  scope: WorkspaceScope;
  campaignModuleId: number;
  expectedContentHash: string;
  characters: Array<{
    characterKey: string;
    attributes: Record<string, number>;
  }>;
}): Promise<TtrpgCampaignModuleRecordV1> {
  const scope = await resolveScope({ scope: input.scope });
  const row = await db.ttrpgCampaignModules.get(input.campaignModuleId);
  if (
    !row ||
    !(await assertRecordInScope(scope, "ttrpgCampaignModules", row, {
      owner: "work",
    }))
  ) {
    throw new Error("[ttrpg-authoring] CampaignPack 不存在或跨 Work");
  }
  if (row.contentHash !== input.expectedContentHash) {
    throw new Error(
      "[ttrpg-authoring] CampaignPack 已变化，请刷新后再保存角色数值",
    );
  }
  const ruleRow = await db.gameRulePacks.get(row.rulePackId);
  if (
    !ruleRow ||
    !(await assertRecordInScope(scope, "gameRulePacks", ruleRow, {
      owner: "work",
    }))
  ) {
    throw new Error("[ttrpg-authoring] RulePack 不存在或跨 Work");
  }
  const rulePack = parseRulePackV1(ruleRow.rulePackJson);
  if ((await hashGameProductionValueV2(rulePack)) !== ruleRow.contentHash) {
    throw new Error("[ttrpg-authoring] RulePack hash 校验失败");
  }
  const campaign = parseTtrpgCampaignContentV1(row.contentJson, rulePack);
  const expectedCharacters = new Set(
    campaign.characterTemplates.map((character) => character.characterKey),
  );
  if (
    input.characters.length !== expectedCharacters.size ||
    new Set(input.characters.map((character) => character.characterKey))
      .size !== input.characters.length ||
    input.characters.some(
      (character) => !expectedCharacters.has(character.characterKey),
    )
  ) {
    throw new Error(
      "[ttrpg-authoring] 角色数值修订必须精确覆盖当前 CampaignPack 全部角色",
    );
  }
  const definitions = new Map(
    rulePack.attributes.map((attribute) => [attribute.key, attribute]),
  );
  for (const update of input.characters) {
    const template = campaign.characterTemplates.find(
      (character) => character.characterKey === update.characterKey,
    )!;
    if (
      Object.keys(update.attributes).length !== definitions.size ||
      Object.keys(update.attributes).some((key) => !definitions.has(key))
    ) {
      throw new Error(
        `[ttrpg-authoring] ${template.name} 的属性必须精确覆盖当前 RulePack`,
      );
    }
    const attributes: Record<string, number> = {};
    for (const [key, definition] of definitions) {
      const value = update.attributes[key];
      if (
        !Number.isInteger(value) ||
        value < definition.minimum ||
        value > definition.maximum
      ) {
        throw new Error(
          `[ttrpg-authoring] ${template.name}.${key} 必须是 ${definition.minimum}～${definition.maximum} 的整数`,
        );
      }
      attributes[key] = value;
      template.attributeMappings[key] = {
        value,
        derivationRule: `作者在 CampaignPack 角色数值编辑器中明确设为 ${value}；覆盖规则包默认映射。`,
        sourceRefs: [...template.sourceRefs],
        authorConfirmed: true,
      };
    }
    template.attributes = attributes;
    template.resources = Object.fromEntries(
      rulePack.resources.map((resource) => {
        const maximum = evaluateRuleNumberExpressionV1(
          resource.maximumFormula,
          attributes,
        );
        return [
          resource.key,
          resource.initialMode === "maximum" ? maximum : resource.minimum,
        ];
      }),
    );
  }
  const parsed = parseTtrpgCampaignContentV1(campaign, rulePack);
  const report = validateTtrpgCampaignForPublicationV1(parsed, rulePack);
  if (!report.valid) {
    throw new Error(
      `[ttrpg-authoring] 修订后 CampaignPack 未通过发布预检:${report.errors.join("；")}`,
    );
  }
  const contentJson = JSON.stringify(parsed);
  const contentHash = await hashGameProductionValueV2(parsed);
  const updatedAt = Date.now();
  return db.transaction(
    "rw",
    scopeTransactionTables(db.ttrpgCampaignModules),
    async () => {
      const current = await db.ttrpgCampaignModules.get(row.id!);
      if (
        !current ||
        current.contentHash !== input.expectedContentHash ||
        current.projectId !== scope.projectId ||
        current.worldId !== scope.worldId ||
        current.workId !== scope.workId
      ) {
        throw new Error(
          "[ttrpg-authoring] CampaignPack 已变化，请刷新后再保存角色数值",
        );
      }
      await db.ttrpgCampaignModules.update(row.id!, {
        status: "validated",
        contentJson,
        contentHash,
        updatedAt,
      });
      return {
        ...current,
        status: "validated",
        contentJson,
        contentHash,
        updatedAt,
      };
    },
  );
}

export async function adoptTtrpgCharacterSheetCandidateV2(input: {
  scope: WorkspaceScope;
  campaignModuleId: number;
  expectedContentHash: string;
  candidateHash: string;
  runId: number;
  lockedFields: string[];
  draft: TtrpgCharacterSheetDraftV2;
}): Promise<TtrpgCampaignModuleRecordV1> {
  const scope = await resolveScope({ scope: input.scope });
  if (
    !/^[0-9a-f]{64}$/.test(input.candidateHash) ||
    !Number.isInteger(input.runId) ||
    input.runId < 1
  ) {
    throw new Error("[ttrpg-authoring] AI 车卡候选证据无效");
  }
  const row = await db.ttrpgCampaignModules.get(input.campaignModuleId);
  if (
    !row ||
    !(await assertRecordInScope(scope, "ttrpgCampaignModules", row, {
      owner: "work",
    }))
  ) {
    throw new Error("[ttrpg-authoring] CampaignPack 不存在或跨 Work");
  }
  if (row.contentHash !== input.expectedContentHash)
    throw new Error("[ttrpg-authoring] CampaignPack 已变化，AI 车卡候选已过期");
  const ruleRow = await db.gameRulePacks.get(row.rulePackId);
  if (
    !ruleRow ||
    !(await assertRecordInScope(scope, "gameRulePacks", ruleRow, {
      owner: "work",
    }))
  ) {
    throw new Error("[ttrpg-authoring] RulePack 不存在或跨 Work");
  }
  const rulePack = parseRulePackV1(ruleRow.rulePackJson);
  if ((await hashGameProductionValueV2(rulePack)) !== ruleRow.contentHash)
    throw new Error("[ttrpg-authoring] RulePack hash 校验失败");
  const campaign = parseTtrpgCampaignContentV1(row.contentJson, rulePack);
  const template = campaign.characterTemplates.find(
    (character) =>
      character.characterKey === input.draft.characterKey &&
      character.role === "player",
  );
  if (!template)
    throw new Error("[ttrpg-authoring] AI 车卡目标不是当前玩家角色");
  const { characterSheet: _currentFrozen, ...templateWithoutSheet } = template;
  const currentSheet =
    template.characterSheet ??
    createCompleteTtrpgCharacterSheetV2({
      template: templateWithoutSheet,
      rulePack,
    });
  const knownLocks = new Set([
    ...Object.keys(currentSheet.identity)
      .filter((key) => key !== "relationships" && key !== "worldBindings")
      .map((key) => `identity.${key}`),
    ...rulePack.attributes.map((attribute) => `attribute.${attribute.key}`),
  ]);
  if (
    new Set(input.lockedFields).size !== input.lockedFields.length ||
    input.lockedFields.some((field) => !knownLocks.has(field))
  ) {
    throw new Error("[ttrpg-authoring] AI 车卡包含未知或重复锁定字段");
  }
  const attributes = Object.fromEntries(
    rulePack.attributes.map((attribute) => {
      const value = input.draft.attributes[attribute.key];
      if (
        !Number.isInteger(value) ||
        value < attribute.minimum ||
        value > attribute.maximum
      ) {
        throw new Error(`[ttrpg-authoring] AI 车卡属性越界:${attribute.key}`);
      }
      return [attribute.key, value];
    }),
  );
  if (
    Object.keys(input.draft.attributes).length !== rulePack.attributes.length
  ) {
    throw new Error("[ttrpg-authoring] AI 车卡属性必须精确覆盖 RulePack");
  }
  const previousBudget = rulePack.attributes.reduce(
    (sum, attribute) => sum + template.attributes[attribute.key],
    0,
  );
  const nextBudget = rulePack.attributes.reduce(
    (sum, attribute) => sum + attributes[attribute.key],
    0,
  );
  if (previousBudget !== nextBudget)
    throw new Error(
      `[ttrpg-authoring] AI 车卡属性预算必须保持 ${previousBudget} 点`,
    );
  const stable = (value: unknown) => JSON.stringify(value);
  for (const field of input.lockedFields) {
    const [kind, key] = field.split(".", 2);
    const before =
      kind === "identity"
        ? currentSheet.identity[key as keyof typeof currentSheet.identity]
        : template.attributes[key];
    const after =
      kind === "identity"
        ? input.draft.identity[key as keyof typeof input.draft.identity]
        : attributes[key];
    if (stable(before) !== stable(after))
      throw new Error(`[ttrpg-authoring] AI 候选改写了锁定字段:${field}`);
  }
  template.name = input.draft.identity.name;
  template.description = input.draft.identity.background;
  template.attributes = attributes;
  template.attributeMappings = Object.fromEntries(
    rulePack.attributes.map((attribute) => [
      attribute.key,
      {
        value: attributes[attribute.key],
        derivationRule: `作者采用 AI 车卡候选 Run #${input.runId}（${input.candidateHash.slice(0, 12)}），并由 RulePack 重新验证。`,
        sourceRefs: [...template.sourceRefs],
        authorConfirmed: true,
      },
    ]),
  );
  template.resources = Object.fromEntries(
    rulePack.resources.map((resource) => {
      const maximum = evaluateRuleNumberExpressionV1(
        resource.maximumFormula,
        attributes,
      );
      return [
        resource.key,
        resource.initialMode === "maximum" ? maximum : resource.minimum,
      ];
    }),
  );
  template.playerProfile = {
    privateGoal: input.draft.identity.shortTermGoal,
    secret:
      input.draft.identity.privateKnowledge.join("；") ||
      "由玩家与 KP 在 Session Zero 确认的私人信息。",
    portrayal: input.draft.identity.portrayal,
  };
  const rebuiltWithoutSheet = {
    ...templateWithoutSheet,
    ...template,
    characterSheet: undefined,
  };
  delete rebuiltWithoutSheet.characterSheet;
  template.characterSheet = createCompleteTtrpgCharacterSheetV2({
    template: rebuiltWithoutSheet,
    rulePack,
    authoringMode: "ai",
    identity: {
      ...structuredClone(input.draft.identity),
      relationships: structuredClone(currentSheet.identity.relationships),
      worldBindings: structuredClone(currentSheet.identity.worldBindings),
    },
  });
  template.characterSheet.authoring.rationale = `作者采用 AI 车卡候选 Run #${input.runId}；候选 ${input.candidateHash}；数值已由冻结 RulePack 重验。`;
  template.characterSheet.authoring.lockedFields = [
    ...input.lockedFields,
  ].sort();
  const parsed = parseTtrpgCampaignContentV1(campaign, rulePack);
  const report = validateTtrpgCampaignForPublicationV1(parsed, rulePack);
  if (!report.valid)
    throw new Error(
      `[ttrpg-authoring] AI 车卡采用后未通过发布预检:${report.errors.join("；")}`,
    );
  const contentJson = JSON.stringify(parsed);
  const contentHash = await hashGameProductionValueV2(parsed);
  const updatedAt = Date.now();
  return db.transaction(
    "rw",
    scopeTransactionTables(db.ttrpgCampaignModules),
    async () => {
      const current = await db.ttrpgCampaignModules.get(row.id!);
      if (
        !current ||
        current.contentHash !== input.expectedContentHash ||
        current.projectId !== scope.projectId ||
        current.worldId !== scope.worldId ||
        current.workId !== scope.workId
      ) {
        throw new Error(
          "[ttrpg-authoring] CampaignPack 已变化，AI 车卡候选已过期",
        );
      }
      await db.ttrpgCampaignModules.update(row.id!, {
        status: "validated",
        contentJson,
        contentHash,
        updatedAt,
      });
      return {
        ...current,
        status: "validated",
        contentJson,
        contentHash,
        updatedAt,
      };
    },
  );
}

export async function listTtrpgProductDraftsV1(
  scopeInput: WorkspaceScope,
): Promise<{
  rulePacks: GameRulePackRecordV1[];
  campaigns: TtrpgCampaignModuleRecordV1[];
}> {
  const scope = await resolveScope({ scope: scopeInput });
  const [rulePacks, campaigns] = await Promise.all([
    db.gameRulePacks.where("workId").equals(scope.workId).toArray(),
    db.ttrpgCampaignModules.where("workId").equals(scope.workId).toArray(),
  ]);
  return {
    rulePacks: rulePacks.sort(
      (left, right) => right.updatedAt - left.updatedAt,
    ),
    campaigns: campaigns.sort(
      (left, right) => right.updatedAt - left.updatedAt,
    ),
  };
}
